from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.scheduling import due_slots, next_slots, validate_schedule
from app.i18n import ERROR_TRANSLATIONS, ERROR_TEMPLATES, translate_error


class SchedulingTests(unittest.TestCase):
    def daily(self, clock="16:00"):
        return {"timezone": "Europe/Prague", "weekly": [
            {"id": "daily", "days": list(range(7)), "time": clock, "enabled": True}], "once": []}

    def test_prague_16_in_winter_and_summer(self):
        winter = due_slots(self.daily(), datetime.fromisoformat("2026-11-25T15:00:10+00:00"))
        summer = due_slots(self.daily(), datetime.fromisoformat("2026-06-25T14:00:10+00:00"))
        self.assertEqual(len(winter), 1)
        self.assertEqual(len(summer), 1)
        self.assertTrue(winter[0]["at"].endswith("+01:00"))
        self.assertTrue(summer[0]["at"].endswith("+02:00"))

    def test_no_broad_catchup(self):
        self.assertEqual(due_slots(self.daily(), datetime.fromisoformat("2026-11-25T18:00:00+01:00")), [])

    def test_stable_occurrence_key_across_ticks(self):
        first = due_slots(self.daily(), datetime.fromisoformat("2026-11-25T16:00:01+01:00"))
        second = due_slots(self.daily(), datetime.fromisoformat("2026-11-25T16:01:00+01:00"))
        self.assertEqual(first[0]["key"], second[0]["key"])

    def test_spring_gap_is_skipped(self):
        schedule = self.daily("02:30")
        self.assertEqual(due_slots(schedule, datetime.fromisoformat("2026-03-29T03:30:10+02:00")), [])
        slots = next_slots(schedule, datetime.fromisoformat("2026-03-28T03:00:00+01:00"), 2)
        self.assertTrue(slots[0]["at"].startswith("2026-03-30T02:30"))

    def test_autumn_overlap_fires_only_first_fold(self):
        schedule = self.daily("02:30")
        first = due_slots(schedule, datetime.fromisoformat("2026-10-25T00:30:10+00:00"))
        second = due_slots(schedule, datetime.fromisoformat("2026-10-25T01:30:10+00:00"))
        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])

    def test_once_local_datetime_interpreted_in_selected_timezone(self):
        schedule = {"timezone": "Europe/Prague", "once": [{"id": "custom", "at": "2026-11-25T16:00", "enabled": True}]}
        canonical = validate_schedule(schedule)
        self.assertEqual(canonical["once"][0]["at"], "2026-11-25T16:00:00+01:00")
        self.assertEqual(len(due_slots(schedule, datetime.fromisoformat("2026-11-25T15:00:01+00:00"))), 1)

    def test_once_gap_rejected(self):
        with self.assertRaises(ValueError):
            validate_schedule({"once": [{"id": "gap", "at": "2026-03-29T02:30"}]})

    def test_disabled_and_weekday_filter(self):
        schedule = self.daily()
        schedule["weekly"][0]["days"] = [0]
        self.assertEqual(due_slots(schedule, datetime.fromisoformat("2026-11-25T16:00:00+01:00")), [])
        schedule["weekly"][0]["enabled"] = False
        self.assertEqual(next_slots(schedule, datetime.fromisoformat("2026-11-23T12:00:00+01:00")), [])

    def test_far_future_once_is_returned(self):
        schedule = {"once": [{"id": "future", "at": "2035-01-01T16:00:00+01:00"}]}
        self.assertEqual(len(next_slots(schedule, datetime.fromisoformat("2026-01-01T00:00:00+00:00"))), 1)

    def test_invalid_rule_timezone_and_duplicate_ids_rejected(self):
        for schedule in ({"timezone": "Unknown/Zone"}, {"weekly": [{"id": "bad", "days": [7], "time": "16:00"}]},
                         {"weekly": [{"id": "bad", "days": [0], "time": "25:00"}]},
                         {"weekly": [{"id": "bad", "days": [True], "time": "16:00"}]},
                         {"weekly": [{"id": "same", "days": [0], "time": "16:00"}, {"id": "same", "days": [1], "time": "16:00"}]}):
            with self.subTest(schedule=schedule), self.assertRaises(ValueError):
                validate_schedule(schedule)
        with self.assertRaises(ValueError):
            due_slots(self.daily(), datetime(2026, 11, 25, 16))

    def test_known_errors_roundtrip_both_languages(self):
        for english, czech in ERROR_TRANSLATIONS.items():
            with self.subTest(message=english):
                self.assertEqual(translate_error(english, "cs"), czech)
                self.assertEqual(translate_error(czech, "en"), english)
                self.assertEqual(translate_error(english, "en"), english)
                self.assertEqual(translate_error(czech, "cs-CZ"), czech)

    def test_dynamic_errors_preserve_file_names(self):
        filename = "0001__Žlutý-motýl.jpg"
        for en_prefix, en_suffix, cs_prefix, cs_suffix in ERROR_TEMPLATES:
            english = en_prefix + filename + en_suffix
            czech = cs_prefix + filename + cs_suffix
            self.assertEqual(translate_error(english, "cs"), czech)
            self.assertEqual(translate_error(czech), english)
        self.assertEqual(translate_error("Meta API returned code 42", "cs"), "Meta API returned code 42")

    def test_all_queue_and_calendar_errors_have_czech_translation(self):
        import ast
        for module in ("queue_store.py", "scheduling.py"):
            tree = ast.parse((Path(__file__).resolve().parents[1] / "app" / module).read_text("utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Raise) or not isinstance(node.exc, ast.Call) or not node.exc.args:
                    continue
                message = node.exc.args[0]
                if isinstance(message, ast.Constant) and isinstance(message.value, str):
                    english = message.value
                elif isinstance(message, ast.JoinedStr):
                    english = "".join(part.value if isinstance(part, ast.Constant) else "filename" for part in message.values)
                else:
                    continue
                with self.subTest(module=module, message=english):
                    self.assertNotEqual(translate_error(english, "cs"), english)


if __name__ == "__main__":
    unittest.main()
