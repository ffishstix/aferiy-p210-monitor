"""Read-only P210 collector: local MQTT -> local SQLite -> Cloudflare HTTPS."""

from __future__ import annotations

import argparse
import asyncio
import ctypes
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import sqlite3
import sys
from urllib import request as urllib_request
from urllib.error import URLError
import uuid

from sydpower.connector import SydpowerConnector

LOG = logging.getLogger("battery-monitor")
DEFAULT_DATA_DIR = Path.home() / "AppData" / "Local" / "AferiyMonitor"
DEFAULT_TOKEN_FILE = Path.home() / "Downloads" / "temo.txt"
DEFAULT_UPLOAD_URL = "https://aferiy-p210-monitor.pages.dev/api/ingest"


class ReadOnlyConnector(SydpowerConnector):
    async def run_command(self, *_args, **_kwargs):
        raise RuntimeError("Battery control is disabled; this monitor only reads data")


def read_brightems_token(path: Path) -> str:
    for line in path.read_text(encoding="utf-8").splitlines():
        key, _, value = line.partition("=")
        if key.strip() == "BRIGHTEMSAPIToken" and value.strip():
            return value.strip()
    raise ValueError(f"BRIGHTEMSAPIToken is missing from {path}")


def number(data: dict, name: str, low: float = 0, high: float = 100000) -> float | None:
    value = data.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if low <= value <= high else None


def optional_bool(data: dict, name: str) -> bool | None:
    value = data.get(name)
    return value if isinstance(value, bool) else None


def make_sample(device_id: str, data: dict) -> dict:
    raw = {key: value for key, value in data.items() if not key.startswith("_") and "token" not in key.lower()}
    output_w = number(raw, "totalOutput", 0, 10000)
    input_w = number(raw, "totalInput", 0, 10000)
    grid = optional_bool(raw, "gridVoltagePresent")
    discharging = optional_bool(raw, "discharging")
    if discharging is None and grid is False and output_w is not None and input_w is not None:
        discharging = output_w > input_w + 20
    return {
        "sample_id": uuid.uuid4().hex,
        "recorded_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "charge_percent": number(raw, "soc", 0, 100),
        "input_w": input_w,
        "output_w": output_w,
        "ac_input_w": number(raw, "acInput", 0, 10000),
        "dc_input_w": number(raw, "dcInput", 0, 10000),
        "remaining_minutes": number(raw, "remainingDischargeTime", 0, 100000),
        "grid_present": grid,
        "discharging": discharging,
        "fault": optional_bool(raw, "hasFault"),
        "raw": raw,
    }


def open_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Uploads run in a worker thread while the MQTT event loop stays responsive.
    # Database calls are sequenced: the upload task finishes before a sample is saved.
    db = sqlite3.connect(path, timeout=10, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""CREATE TABLE IF NOT EXISTS samples (
        sample_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, recorded_at TEXT NOT NULL,
        charge_percent REAL, input_w REAL, output_w REAL, remaining_minutes REAL,
        grid_present INTEGER, discharging INTEGER, fault INTEGER,
        payload_json TEXT NOT NULL, uploaded INTEGER NOT NULL DEFAULT 0)""")
    db.execute("CREATE INDEX IF NOT EXISTS samples_upload ON samples(uploaded, recorded_at)")
    db.commit()
    return db


def save_sample(db: sqlite3.Connection, device_id: str, sample: dict) -> None:
    db.execute("""INSERT INTO samples
        (sample_id, device_id, recorded_at, charge_percent, input_w, output_w,
         remaining_minutes, grid_present, discharging, fault, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (sample["sample_id"], device_id, sample["recorded_at"], sample["charge_percent"],
         sample["input_w"], sample["output_w"], sample["remaining_minutes"],
         sample["grid_present"], sample["discharging"], sample["fault"],
         json.dumps(sample, separators=(",", ":"))))
    db.commit()


def upload_pending(db: sqlite3.Connection, secret_path: Path, url: str) -> int:
    oldest = (datetime.now(timezone.utc).timestamp() - 7 * 86400)
    for row in db.execute("SELECT sample_id, recorded_at FROM samples WHERE uploaded=0 ORDER BY recorded_at LIMIT 20").fetchall():
        try:
            timestamp = datetime.fromisoformat(row["recorded_at"].replace("Z", "+00:00")).timestamp()
        except ValueError:
            timestamp = 0
        if timestamp < oldest:
            db.execute("UPDATE samples SET uploaded=2 WHERE sample_id=?", (row["sample_id"],))
    db.commit()
    rows = db.execute("SELECT sample_id, device_id, payload_json FROM samples WHERE uploaded=0 ORDER BY recorded_at LIMIT 20").fetchall()
    if not rows:
        return 0
    device_id = rows[0]["device_id"]
    rows = [row for row in rows if row["device_id"] == device_id]
    body = json.dumps({"device_id": device_id, "samples": [json.loads(row["payload_json"]) for row in rows]}, separators=(",", ":")).encode()
    secret = secret_path.read_text(encoding="utf-8").strip()
    req = urllib_request.Request(url, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"}, method="POST")
    with urllib_request.urlopen(req, timeout=20) as response:
        result = json.load(response)
        if not result.get("ok"):
            raise RuntimeError("Cloud upload was not accepted")
    db.executemany("UPDATE samples SET uploaded=1 WHERE sample_id=?", [(row["sample_id"],) for row in rows])
    db.commit()
    return len(rows)


async def run(args: argparse.Namespace) -> None:
    token = read_brightems_token(args.token_file)
    db = open_db(args.database)
    connector = ReadOnlyConnector(token, args.broker_host, args.broker_port)
    try:
        while True:
            try:
                count = await asyncio.to_thread(upload_pending, db, args.ingest_secret_file, args.upload_url)
                if count:
                    LOG.info("Uploaded %d readings to Cloudflare", count)
            except (OSError, URLError, RuntimeError, ValueError) as exc:
                LOG.warning("Cloud upload delayed: %s", exc)
            if not connector.is_connected():
                fresh_token = read_brightems_token(args.token_file)
                if fresh_token != connector.api_token:
                    await connector.disconnect()
                    connector = ReadOnlyConnector(fresh_token, args.broker_host, args.broker_port)
                LOG.info("Connecting to BrightEMS device list and local MQTT broker")
                if not await connector.connect():
                    LOG.warning("Connection failed; retrying in 60 seconds")
                    await asyncio.sleep(60)
                    continue
            last_sensor = connector.mqtt_client._last_input_communication if connector.mqtt_client else 0
            await connector.get_data()
            client = connector.mqtt_client
            if client and client._last_input_communication > last_sensor:
                for device_id, fields in client.devices.items():
                    if "soc" not in fields:
                        continue
                    sample = make_sample(device_id, fields)
                    save_sample(db, device_id, sample)
                    LOG.info("Saved %s reading (%s%% charge)", device_id, sample["charge_percent"])
            await asyncio.sleep(args.interval)
    finally:
        await connector.disconnect()
        db.close()


def main() -> None:
    if os.name == "nt":
        mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\AferiyP210Collector")
        if ctypes.windll.kernel32.GetLastError() == 183:
            return
    parser = argparse.ArgumentParser(description="Read-only AFERIY P210 monitor")
    parser.add_argument("--broker-host", default="127.0.0.1")
    parser.add_argument("--broker-port", type=int, default=1883)
    parser.add_argument("--token-file", type=Path, default=DEFAULT_TOKEN_FILE)
    parser.add_argument("--ingest-secret-file", type=Path, default=DEFAULT_DATA_DIR / "ingest-secret.txt")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATA_DIR / "samples.db")
    parser.add_argument("--upload-url", default=DEFAULT_UPLOAD_URL)
    parser.add_argument("--interval", type=int, default=30)
    args = parser.parse_args()
    DEFAULT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    handlers = [logging.FileHandler(DEFAULT_DATA_DIR / "collector.log", encoding="utf-8")]
    if sys.stderr:
        handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=handlers)
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        LOG.info("Stopped")
    except (FileNotFoundError, ValueError) as exc:
        LOG.error("Configuration error: %s", exc)
        sys.exit(2)


if __name__ == "__main__":
    main()
