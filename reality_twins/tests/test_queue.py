import hashlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from queue_store import QueueStore, QueueConflict, QueueError


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.queue, self.data = self.root / "PLANNED", self.root / "DATA"
        self.queue.mkdir()
        self.store = QueueStore(self.queue, self.data)

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def add(self, name, content=b"image-data", caption="Caption"):
        (self.queue / name).write_bytes(content)
        (self.queue / Path(name).with_suffix(".txt")).write_text(caption, encoding="utf-8")

    def two(self):
        self.add("zebra.jpg", b"zebra", "Zebra caption")
        self.add("alpha.png", b"alpha", "Alpha caption")
        return self.store.scan()

    def test_import_reorder_preserves_bytes_captions_and_ids_on_restart(self):
        first = self.two()
        self.assertEqual([x["filename"] for x in first], ["0001__alpha.png", "0002__zebra.jpg"])
        changed = self.store.reorder([x["id"] for x in first[::-1]])
        self.assertEqual([x["filename"] for x in changed], ["0001__zebra.jpg", "0002__alpha.png"])
        self.assertEqual((self.queue / "0001__zebra.jpg").read_bytes(), b"zebra")
        self.assertEqual((self.queue / "0001__zebra.txt").read_text("utf-8"), "Zebra caption")
        self.store.close()
        self.store = QueueStore(self.queue, self.data)
        self.assertEqual([x["id"] for x in self.store.scan()], [x["id"] for x in changed])

    def test_stale_order_is_rejected_without_renaming(self):
        items = self.two()
        with self.assertRaises(QueueConflict):
            self.store.reorder([items[0]["id"], items[0]["id"]])
        self.assertEqual(self.store.list_items(), items)

    def test_unknown_destination_never_overwritten(self):
        self.add("alpha.jpg", b"alpha")
        (self.queue / "0001__alpha.txt").write_text("External file", encoding="utf-8")
        with self.assertRaises(QueueConflict):
            self.store.scan()
        self.assertEqual((self.queue / "alpha.jpg").read_bytes(), b"alpha")
        self.assertEqual((self.queue / "0001__alpha.txt").read_text("utf-8"), "External file")
        self.assertEqual(self.store.list_items(), [])

    def test_ambiguous_caption_is_rejected(self):
        self.add("alpha.jpg")
        (self.queue / "alpha__caption.txt").write_text("Other", encoding="utf-8")
        with self.assertRaises(QueueConflict):
            self.store.scan()

    def test_caption_without_file_created_and_existing_workflow_caption_imported(self):
        (self.queue / "foo.jpg").write_bytes(b"foo")
        (self.queue / "bar.png").write_bytes(b"bar")
        (self.queue / "bar__caption.txt").write_text("Bar", encoding="utf-8")
        items = self.store.scan()
        self.assertEqual([x["caption"] for x in items], ["Bar", ""])
        self.assertEqual(len(list(self.queue.glob("*.txt"))), 2)

    def test_claim_unique_event_and_restart_does_not_republish(self):
        self.two()
        attempt = self.store.claim("weekly:daily:2026-11-25:16:00")
        self.assertEqual(attempt["state"], "claimed")
        self.assertIsNone(self.store.claim(attempt["event_key"]))
        self.store.close()
        self.store = QueueStore(self.queue, self.data)
        self.assertEqual(self.store.open_attempts()[0]["attempt_id"], attempt["attempt_id"])
        self.assertIsNone(self.store.claim("other-slot"))
        with self.assertRaises(QueueConflict):
            self.store.reorder([x["id"] for x in self.store.list_items()][::-1])

    def test_blocked_head_never_skipped_and_safe_retry_keeps_history(self):
        self.two()
        attempt = self.store.claim("one")
        self.store.fail(attempt["attempt_id"], "Image URL unavailable")
        self.assertIsNone(self.store.claim("two"))
        self.store.retry(attempt["item_id"])
        second = self.store.claim("two")
        self.assertEqual(attempt["item_id"], second["item_id"])
        self.assertEqual(len(self.store.history()), 2)

    def test_publish_started_is_always_uncertain_until_reviewed(self):
        self.two()
        attempt = self.store.claim("one")
        self.store.update_attempt(attempt["attempt_id"], container_id="123", state="container_created")
        self.store.update_attempt(attempt["attempt_id"], state="publishing")
        result = self.store.fail(attempt["attempt_id"], "Connection reset")
        self.assertEqual(result["state"], "uncertain")
        with self.assertRaises(QueueConflict):
            self.store.retry(attempt["item_id"])
        self.store.resolve_not_published(attempt["item_id"], "Checked Instagram profile; this post was not published.")
        old = self.store.get_attempt(attempt["attempt_id"])
        self.assertEqual(old["state"], "confirmed_not_published")
        self.assertIn("Checked Instagram", old["note"])
        self.assertIsNotNone(self.store.claim("second-slot"))

    def test_finish_archives_pair_and_renumbers_remaining(self):
        self.two()
        attempt = self.store.claim("one")
        finished = self.store.finish(attempt["attempt_id"], "instagram-id", "https://www.instagram.com/p/example/")
        self.assertEqual(finished["state"], "published")
        self.assertEqual(self.store.list_items()[0]["filename"], "0001__zebra.jpg")
        archived = self.store.image_path(attempt["item_id"])
        self.assertEqual(archived.read_bytes(), b"alpha")
        self.assertEqual(archived.parent.parent, self.root / "PUBLISHED")
        self.assertEqual(archived.with_suffix(".txt").read_text("utf-8"), "Alpha caption")
        self.assertIsNone(self.store.claim("one"))
        self.assertEqual(self.store.finish(attempt["attempt_id"], "instagram-id", finished["permalink"]), finished)

    def test_manual_publish_confirmation_accepts_missing_media_id(self):
        self.two()
        attempt = self.store.claim("one")
        self.store.fail(attempt["attempt_id"], "Uncertain", uncertain=True)
        result = self.store.finish(attempt["attempt_id"], None, "https://www.instagram.com/p/verified/")
        self.assertEqual(result["media_id"], "")
        self.assertEqual(result["state"], "published")

    def test_success_receipt_survives_missing_file_during_archive(self):
        item = self.two()[0]
        attempt = self.store.claim("one")
        (self.queue / item["filename"]).unlink()
        with self.assertRaises(QueueConflict):
            self.store.finish(attempt["attempt_id"], "known-media-id", "https://www.instagram.com/p/known/")
        receipt = self.store.get_attempt(attempt["attempt_id"])
        self.assertEqual(receipt["media_id"], "known-media-id")
        self.assertEqual(receipt["state"], "publishing")
        self.assertIsNone(self.store.claim("second-slot"))
        self.store.fail(attempt["attempt_id"], "Archive file missing")
        with self.assertRaises(QueueConflict):
            self.store.retry(item["id"])

    def test_journal_cannot_move_file_outside_queue(self):
        external = self.root / "external.txt"
        external.write_text("Keep me", encoding="utf-8")
        plan = {"version": 1, "stage": 0, "index": 0, "timestamp": "now", "items": [],
                "moves": [{"source": str(external), "target": str(self.queue / "target.txt"),
                           "temporary": str(self.queue / ".temporary.tmp"), "sha256": hashlib.sha256(b"Keep me").hexdigest()}]}
        self.store.journal_path.write_text(json.dumps(plan), encoding="utf-8")
        with self.assertRaises(QueueError):
            self.store.list_items()
        self.assertEqual(external.read_text("utf-8"), "Keep me")
        self.store.journal_path.unlink()

    def test_changed_or_missing_image_is_blocked(self):
        items = self.two()
        changed = self.queue / items[0]["filename"]
        changed.write_bytes(b"modified")
        self.assertEqual(self.store.scan()[0]["status"], "error")
        self.assertIsNone(self.store.claim("one"))
        with self.assertRaises(QueueConflict):
            self.store.image_path(items[0]["id"])
        with self.assertRaises(QueueConflict):
            self.store.retry(items[0]["id"])
        changed.write_bytes(b"alpha")
        self.store.retry(items[0]["id"])
        self.assertIsNotNone(self.store.claim("one"))

    def test_caption_updates_sidecar_and_attempt_snapshot(self):
        item = self.two()[0]
        self.store.update_caption(item["id"], "Updated caption")
        self.assertEqual((self.queue / item["caption_filename"]).read_text("utf-8"), "Updated caption")
        attempt = self.store.claim("one")
        self.assertEqual(attempt["caption"], "Updated caption")
        with self.assertRaises(QueueConflict):
            self.store.update_caption(item["id"], "Cannot edit in flight")

    def test_rename_recovers_crash_at_each_file_stage(self):
        items = self.two()
        for crash_after in (1, 3, 5, 7):
            ids = [x["id"] for x in self.store.list_items()][::-1]
            original = self.store._move_no_replace
            count = 0
            def crashing_move(source, target, digest):
                nonlocal count
                original(source, target, digest)
                count += 1
                if count == crash_after:
                    raise OSError("simulated process interruption")
            with patch.object(self.store, "_move_no_replace", side_effect=crashing_move):
                with self.assertRaises(OSError):
                    self.store.reorder(ids)
            self.store.close()
            self.store = QueueStore(self.queue, self.data)
            recovered = self.store.list_items()
            self.assertEqual([x["id"] for x in recovered], ids)
            for item in recovered:
                self.assertEqual(hashlib.sha256((self.queue / item["filename"]).read_bytes()).hexdigest(), item["sha256"])
                self.assertEqual((self.queue / item["caption_filename"]).read_text("utf-8"), item["caption"])
            self.assertFalse(self.store.journal_path.exists())
            self.assertEqual(list(self.queue.glob(".queue-*.tmp")), [])

    def test_import_recovery_after_files_moved_before_database_commit(self):
        self.add("first.jpg", b"first")
        original = self.store._execute_plan
        def crash_after_plan(plan):
            original(plan)
            raise OSError("crash before commit")
        with patch.object(self.store, "_execute_plan", side_effect=crash_after_plan):
            with self.assertRaises(OSError):
                self.store.scan()
        self.store.close()
        self.store = QueueStore(self.queue, self.data)
        item = self.store.list_items()[0]
        self.assertEqual(item["filename"], "0001__first.jpg")
        self.assertEqual(self.store.image_path(item["id"]).read_bytes(), b"first")

    def test_archive_recovery_after_files_moved_before_database_commit(self):
        self.two()
        attempt = self.store.claim("one")
        original = self.store._execute_plan
        def crash_after_plan(plan):
            original(plan)
            raise OSError("crash before commit")
        with patch.object(self.store, "_execute_plan", side_effect=crash_after_plan):
            with self.assertRaises(OSError):
                self.store.finish(attempt["attempt_id"], "42", "https://www.instagram.com/p/test/")
        self.store.close()
        self.store = QueueStore(self.queue, self.data)
        self.assertEqual(self.store.get_attempt(attempt["attempt_id"])["state"], "published")
        self.assertEqual(self.store.list_items()[0]["filename"], "0001__zebra.jpg")

    def test_two_store_instances_cannot_claim_same_item(self):
        self.two()
        another = QueueStore(self.queue, self.data)
        results = []
        barrier = threading.Barrier(2)
        def claim(store, slot):
            barrier.wait()
            results.append(store.claim(slot))
        threads = [threading.Thread(target=claim, args=(self.store, "one")),
                   threading.Thread(target=claim, args=(another, "two"))]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        another.close()
        self.assertEqual(sum(result is not None for result in results), 1)

    def test_symlink_input_rejected(self):
        external = self.root / "outside.jpg"
        external.write_bytes(b"outside")
        try:
            (self.queue / "link.jpg").symlink_to(external)
        except OSError:
            self.skipTest("Symlink creation not permitted on this host")
        with self.assertRaises(QueueError):
            self.store.scan()
        self.assertEqual(external.read_bytes(), b"outside")


if __name__ == "__main__":
    unittest.main()
