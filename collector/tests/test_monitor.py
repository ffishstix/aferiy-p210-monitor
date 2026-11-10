from datetime import datetime, timedelta, timezone
import tempfile
import unittest
from pathlib import Path

from monitor import make_sample, open_db, save_sample, upload_pending
from tray import classify, eta


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
