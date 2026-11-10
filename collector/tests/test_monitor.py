from datetime import datetime, timedelta, timezone
import tempfile
import unittest
from pathlib import Path

from monitor import make_sample, open_db, save_sample, upload_pending
from tray import TrayMonitor, classify, eta


class MonitorTests(unittest.TestCase):
    def test_normalizes_actual_decoder_keys(self):
        sample = make_sample("abc", {"soc": 14.2, "totalInput": 0, "totalOutput": 180,
                                     "acInput": 0, "dcInput": 0, "gridVoltagePresent": False,
                                     "discharging": True, "remainingDischargeTime": 55,
                                     "hasFault": False, "api_token": "must-not-upload"})
        self.assertEqual(sample["charge_percent"], 14.2)
        self.assertEqual(sample["remaining_minutes"], 55)
        self.assertNotIn("api_token", sample["raw"])
        self.assertEqual(classify({**sample, "fault": 0, "grid_present": 0, "discharging": 1}), "low")

    def test_stale_data_never_looks_live(self):
        old = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
        self.assertEqual(classify({"recorded_at": old, "charge_percent": 5,
                                   "grid_present": 0, "discharging": 1}), "stale")

    def test_cloud_power_flow_and_low_battery_alert_once(self):
        now = datetime.now(timezone.utc).isoformat()
        self.assertEqual(classify({"recorded_at": now, "input_w": 451, "output_w": 151,
                                   "grid_present": 0, "discharging": 0}), "charging")
        self.assertEqual(classify({"recorded_at": now, "input_w": 161, "output_w": 160,
                                   "grid_present": 1, "discharging": 0}), "passthrough")

        sample = {"recorded_at": now, "charge_percent": 14, "input_w": 0,
                  "output_w": 150, "grid_present": 0, "discharging": 1,
                  "remaining_minutes": 60}
        tray = TrayMonitor.__new__(TrayMonitor)
        tray.dashboard = type("Dashboard", (), {"fetch": lambda self: sample})()
        tray.icon = type("Icon", (), {"update_menu": lambda self: None})()
        tray.previous_state = "idle"
        tray.alert_level = 0
        alerts = []
        tray.notify = lambda title, message: alerts.append((title, message))
        tray.tick()
        tray.tick()
        self.assertEqual(len(alerts), 2)
        self.assertIn("save your work", alerts[1][0].lower())

    def test_local_history_retains_unsent_samples(self):
        with tempfile.TemporaryDirectory() as folder:
            db = open_db(Path(folder) / "samples.db")
            sample = make_sample("abc", {"soc": 50})
            save_sample(db, "abc", sample)
            row = db.execute("SELECT uploaded, charge_percent FROM samples").fetchone()
            self.assertEqual((row["uploaded"], row["charge_percent"]), (0, 50))
            db.close()


if __name__ == "__main__":
    unittest.main()
