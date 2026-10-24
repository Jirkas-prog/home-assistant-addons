"""Run with Python 3.9+: python -m unittest discover -s tests -p test_local.py."""
import importlib.util
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rules = load("workflow_rules", ROOT / "custom_components/scheduler/workflow_rules.py")
installer = load("installer", ROOT / "install.py")


class LocalTests(unittest.TestCase):
    def test_skip_survives_json_restart_and_expires_at_local_midnight(self):
        tags = json.loads(json.dumps([rules.MANAGED_TAG, "workflow-skip:2026-10-24"]))
        for service in ["light.turn_on", "switch.turn_on", "fan.turn_on", "cover.open_cover"]:
            self.assertTrue(rules.skip_action(tags, date(2026, 10, 24), service))
            self.assertFalse(rules.skip_action(tags, date(2026, 10, 25), service))
        for service in ["light.turn_off", "switch.turn_off", "fan.turn_off", "cover.close_cover"]:
            self.assertFalse(rules.skip_action(tags, date(2026, 10, 24), service))
        self.assertFalse(rules.skip_action(tags[1:], date(2026, 10, 24), "light.turn_on"))

    def test_install_update_backup_and_runtime_preservation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = root / "config"
            config.mkdir()
            storage = config / ".storage"
            storage.mkdir()
            (storage / "scheduler.storage").write_text("existing schedules")
            backup = installer.install(ROOT, config, root / "data")
            self.assertTrue(backup.is_dir())
            self.assertTrue((config / "www/workflow-timers/workflow-timers.js").exists())
            self.assertIsNone(installer.install(ROOT, config, root / "data"))
            file = config / "custom_components/scheduler/workflow_rules.py"
            file.write_text("old version")
            backup = installer.install(ROOT, config, root / "data")
            self.assertEqual((backup / "custom_components/scheduler/workflow_rules.py").read_text(), "old version")
            self.assertEqual((storage / "scheduler.storage").read_text(), "existing schedules")

    def test_existing_other_scheduler_is_not_silently_replaced(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = root / "config"
            target = config / "custom_components/scheduler"
            target.mkdir(parents=True)
            (target / "manifest.json").write_text('{"version":"3.3.8"}')
            with self.assertRaises(RuntimeError):
                installer.install(ROOT, config, root / "data")
            self.assertFalse((config / "www").exists())


if __name__ == "__main__":
    unittest.main()
