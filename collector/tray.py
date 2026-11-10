"""Windows notification-area battery monitor reading the Cloudflare dashboard."""

from __future__ import annotations

import ctypes
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import subprocess
import threading
import traceback
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

from PIL import Image, ImageDraw

from monitor import DEFAULT_DATA_DIR

DASHBOARD_URL = "https://aferiy-p210-monitor.pages.dev"


def open_compact():
    url = DASHBOARD_URL + "/?compact=1"
    edge = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
    if edge.exists():
        subprocess.Popen([str(edge), "--app=" + url, "--window-size=440,700"])
    else:
        webbrowser.open(url)


class CloudDashboard:
    def fetch(self) -> dict | None:
        try:
            with urlopen(DASHBOARD_URL + "/api/status", timeout=8) as response:
                return json.load(response).get("sample")
        except (URLError, TimeoutError, ValueError):
            return None


def recent_sample(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        with sqlite3.connect(path, timeout=2) as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT * FROM samples ORDER BY recorded_at DESC LIMIT 1").fetchone()
            return dict(row) if row else None
    except sqlite3.Error:
        return None


def classify(sample: dict | None, now: datetime | None = None) -> str:
    if not sample:
        return "offline"
    now = now or datetime.now(timezone.utc)
    try:
        age = (now - datetime.fromisoformat(sample["recorded_at"].replace("Z", "+00:00"))).total_seconds()
    except (ValueError, TypeError, KeyError):
        return "offline"
    if age > 120:
        return "stale"
    if sample.get("fault") == 1:
        return "fault"
    if sample.get("discharging") == 1 and sample.get("grid_present") != 1:
        return "low" if sample.get("charge_percent") is not None and sample["charge_percent"] < 15 else "discharging"
    if sample.get("grid_present") == 1 and (sample.get("output_w") or 0) > 0 and abs((sample.get("input_w") or 0) - (sample.get("output_w") or 0)) <= 25:
        return "passthrough"
    if (sample.get("input_w") or 0) > (sample.get("output_w") or 0) + 25:
        return "charging"
    return "idle"


def eta(sample: dict | None) -> str:
    minutes = sample.get("remaining_minutes") if sample else None
    if minutes is None or minutes < 0:
        return "ETA unavailable"
    minutes = round(minutes)
    return f"{minutes} min remaining" if minutes < 60 else f"{minutes // 60} h {minutes % 60} min remaining"


def image_for(state: str, percent: float | None) -> Image.Image:
    colours = {
        "charging": "#70d99f", "passthrough": "#70c7d9", "idle": "#a6c3b9", "discharging": "#f1c765",
        "low": "#f1756f", "stale": "#87949b", "offline": "#69747b", "fault": "#e97685",
    }
    colour = colours.get(state, "#87949b")
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((10, 13, 51, 54), radius=8, outline=colour, width=5)
    draw.rounded_rectangle((23, 6, 38, 16), radius=3, fill=colour)
    if percent is not None and state not in ("stale", "offline"):
        height = round(max(0, min(100, percent)) / 100 * 29)
        if height:
            draw.rounded_rectangle((16, 49 - height, 45, 49), radius=3, fill=colour)
    if state in ("stale", "offline"):
        draw.line((17, 47, 44, 20), fill=colour, width=4)
    return image


class TrayMonitor:
    def __init__(self, database: Path | None = None):
        import pystray

        self.dashboard = CloudDashboard()
        self.stop_event = threading.Event()
        self.previous_state = "offline"
        self.alert_level = 0
        self.status_text = "Waiting for battery readings"
        self.icon = pystray.Icon("aferiy-p210", image_for("offline", None), "P210: waiting for data", menu=pystray.Menu(
            pystray.MenuItem(lambda _: self.status_text, None, enabled=False),
            pystray.MenuItem("Open dashboard", lambda _icon, _item: webbrowser.open(DASHBOARD_URL)),
            pystray.MenuItem("Open compact widget", lambda _icon, _item: open_compact()),
            pystray.MenuItem("Exit", self.quit),
        ))

    def quit(self, _icon=None, _item=None):
        self.stop_event.set()
        self.icon.stop()

    def notify(self, title: str, message: str):
        try:
            self.icon.notify(message, title)
        except (NotImplementedError, OSError):
            pass

    def tick(self):
        sample = self.dashboard.fetch()
        state = classify(sample)
        percent = sample.get("charge_percent") if sample else None
        pct_text = f"{percent:.0f}%" if percent is not None else "unknown charge"
        self.status_text = f"P210: {state} · {pct_text}" + (f" · {eta(sample)}" if state in ("discharging", "low") else "")
        self.icon.title = self.status_text[:127]
        self.icon.icon = image_for(state, percent)
        self.icon.update_menu()
        if state in ("discharging", "low") and self.previous_state not in ("discharging", "low"):
            self.notify("P210 running on battery", f"{pct_text}. {eta(sample)}.")
        if state == "low" and percent is not None:
            level = 3 if percent <= 5 else 2 if percent <= 10 else 1
            if level > self.alert_level:
                self.notify("Low P210 battery — save your work", f"{pct_text} left. Save your work and shut down this PC soon. {eta(sample)}.")
                self.alert_level = level
        elif state in ("charging", "passthrough", "idle") and percent is not None and percent >= 17:
            self.alert_level = 0
        if state in ("stale", "offline") and self.previous_state in ("discharging", "low"):
            self.notify("P210 status unavailable", "The last battery reading is old. Check the power station before relying on the ETA.")
        self.previous_state = state

    def run(self):
        def poll():
            while not self.stop_event.is_set():
                self.tick()
                self.stop_event.wait(20)
        def setup(_icon):
            threading.Thread(target=poll, daemon=True).start()
        try:
            self.icon.run(setup=setup)
        except KeyboardInterrupt:
            self.quit()


if __name__ == "__main__":
    if os.name == "nt":
        mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\AferiyP210Tray")
        if ctypes.windll.kernel32.GetLastError() == 183:
            raise SystemExit(0)
    try:
        TrayMonitor().run()
    except Exception:
        DEFAULT_DATA_DIR.mkdir(parents=True, exist_ok=True)
        (DEFAULT_DATA_DIR / "tray-error.log").write_text(traceback.format_exc(), encoding="utf-8")
        raise
