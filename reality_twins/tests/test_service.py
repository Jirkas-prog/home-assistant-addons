"""Integration checks with real queue/files and mocked Instagram/HA requests."""
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.instagram import InstagramError
from app.server import create_apps
from app.service import Service


class FakeInstagram:
    def __init__(self, fail_publish=False):
        self.calls = []
        self.fail_publish = fail_publish

    def refresh_if_needed(self):
        self.calls.append(("refresh",))

    def check(self):
        self.calls.append(("check",))
        return {"connected": True, "id": "123456", "username": "test_account"}

    def request(self, method, path, data=None):
        self.calls.append((method, path, data))
        if path.endswith("/media_publish"):
            if self.fail_publish:
                raise requests.Timeout("simulated timeout after sending")
            return {"id": "987654"}
        if path.endswith("/media"):
            return {"id": "container-123"}
        raise AssertionError(f"Unexpected fake Instagram operation: {method} {path}")

    def container_status(self, container_id):
        self.calls.append(("container_status", container_id))
        return "FINISHED"

    def permalink(self, media_id):
        self.calls.append(("permalink", media_id))
        return "https://www.instagram.com/p/verified_post/"


class TwoTicks:
    def __init__(self):
        self.ticks = 0

    def is_set(self):
        return self.ticks >= 2

    def wait(self, seconds):
        self.ticks += 1
        return self.is_set()


class ServiceTests(unittest.TestCase):
    def setUp(self):
        # Any unmocked network access immediately fails rather than reaching the web.
        self.network = patch("requests.sessions.Session.request", side_effect=AssertionError("Unexpected real network access"))
        self.network.start()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data, self.queue = self.root / "DATA", self.root / "PLANNED"
        self.service = Service(self.data, self.queue)
        self.instagram = FakeInstagram()
        self.service.instagram = self.instagram
        self.service.state.data.update(public_media_base_url="https://media.example.test",
                                       schedule_source="internal", connection_method="official", access_token="TOKEN_SECRET_1324",
                                       app_secret="APP_SECRET_5678",
                                       account={"connected": True, "id": "123456", "username": "test_account"})
        self.service.state.save()

    def tearDown(self):
        self.service.queue.close()
        self.temp.cleanup()
        self.network.stop()

    def add(self, name="one.jpg", caption="A real caption.", mode="RGB"):
        image = Image.new(mode, (800, 1000), (40, 100, 160, 255) if mode == "RGBA" else (40, 100, 160))
        image.save(self.queue / name)
        (self.queue / Path(name).with_suffix(".txt")).write_text(caption, encoding="utf-8")
        return self.service.queue.scan()[-1]

    def publish_calls(self):
        return [call for call in self.instagram.calls if len(call) >= 2 and call[0] == "POST" and call[1].endswith("/media_publish")]

    def test_two_scheduler_ticks_publish_only_one_and_archive_pair(self):
        self.add("a.jpg", "First caption")
        self.add("b.jpg", "Second caption")
        self.service.state.data["enabled"] = True
        self.service.stop = TwoTicks()
        fixed = datetime.fromisoformat("2026-11-25T15:00:10+00:00")
        class FixedDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)
        with patch("app.service.datetime", FixedDatetime):
            self.service.run()
        self.assertEqual(len(self.publish_calls()), 1)
        self.assertEqual(len(self.service.queue.list_items()), 1)
        self.assertEqual(self.service.queue.list_items()[0]["filename"], "0001__b.jpg")
        receipt = self.service.queue.history()[0]
        self.assertEqual(receipt["state"], "published")
        archived = self.service.queue.image_path(receipt["item_id"])
        self.assertEqual(archived.parent.parent.name, "PUBLISHED")
        self.assertEqual(archived.with_suffix(".txt").read_text("utf-8"), "First caption")

    def test_publish_timeout_blocks_retries_and_preserves_container(self):
        item = self.add()
        self.instagram.fail_publish = True
        attempt = self.service.queue.claim("slot-one")
        self.service.publish(attempt)
        receipt = self.service.queue.get_attempt(attempt["attempt_id"])
        self.assertEqual(receipt["state"], "uncertain")
        self.assertEqual(receipt["container_id"], "container-123")
        self.assertEqual(self.service.queue.get(item["id"])["status"], "uncertain")
        self.assertIsNone(self.service.queue.claim("slot-two"))
        self.assertEqual(len(self.publish_calls()), 1)

    def test_restart_with_known_media_id_recovers_without_republishing(self):
        self.add()
        attempt = self.service.queue.claim("slot-one")
        self.service.queue.update_attempt(attempt["attempt_id"], state="publishing", media_id="987654")
        self.service.queue.close()
        self.service = Service(self.data, self.queue)
        self.service.instagram = self.instagram
        self.service.recover()
        receipt = self.service.queue.get_attempt(attempt["attempt_id"])
        self.assertEqual(receipt["state"], "published")
        self.assertEqual(receipt["permalink"], "https://www.instagram.com/p/verified_post/")
        self.assertEqual(len(self.publish_calls()), 0)
        self.assertEqual(self.service.queue.list_items(), [])

    def test_restart_before_publish_becomes_retryable_error(self):
        self.add()
        attempt = self.service.queue.claim("slot-one")
        self.service.queue.update_attempt(attempt["attempt_id"], state="container_created", container_id="container-123")
        self.service.recover()
        self.assertEqual(self.service.queue.get_attempt(attempt["attempt_id"])["state"], "error")
        self.service.queue.retry(attempt["item_id"])
        self.assertEqual(len(self.publish_calls()), 0)

    def test_home_assistant_event_key_survives_title_and_offset_changes(self):
        self.service.state.data.update(schedule_source="home_assistant", calendar_entity="calendar.instagram")
        now = datetime.fromisoformat("2026-11-25T15:00:00+00:00")
        original = {"uid": "event-1", "summary": "Original title", "start": {"dateTime": "2026-11-25T16:00:00+01:00"}}
        changed = {"uid": "event-1", "summary": "Renamed title", "start": {"dateTime": "2026-11-25T15:00:00Z"}}
        self.service.ha_get = Mock(return_value=[original])
        self.service.refresh_calendar(now)
        key = self.service.slots(now, due=True)[0]["key"]
        self.service.ha_get.return_value = [changed]
        self.service.refresh_calendar(now)
        self.assertEqual(self.service.slots(now, due=True)[0]["key"], key)

    def test_calendar_ignores_all_day_and_cancelled_events(self):
        self.service.state.data.update(schedule_source="home_assistant", calendar_entity="calendar.instagram")
        now = datetime.fromisoformat("2026-11-25T15:00:00+00:00")
        self.service.ha_get = Mock(return_value=[
            {"uid": "all-day", "summary": "All day", "start": {"date": "2026-11-25"}},
            {"uid": "cancelled", "status": "cancelled", "start": {"dateTime": now.isoformat()}},
            {"uid": "canceled", "status": "canceled", "start": {"dateTime": now.isoformat()}},
            {"uid": "valid", "summary": "Publish", "start": {"dateTime": now.isoformat()}},
        ])
        self.service.refresh_calendar(now)
        self.assertEqual(len(self.service.slots(now, due=True)), 1)
        self.assertEqual(self.service.slots(now, due=True)[0]["label"], "Publish")

    def test_calendar_failure_discards_cached_events(self):
        self.service.state.data.update(schedule_source="home_assistant", calendar_entity="calendar.instagram")
        now = datetime.fromisoformat("2026-11-25T15:00:00+00:00")
        self.service.ha_get = Mock(return_value=[{"uid": "one", "start": {"dateTime": now.isoformat()}}])
        self.service.refresh_calendar(now)
        self.assertEqual(len(self.service.slots(now, due=True)), 1)
        self.service.ha_get.side_effect = ValueError("Calendar unavailable")
        self.service.refresh_calendar(now)
        self.assertEqual(self.service.slots(now, due=True), [])
        self.assertEqual(self.service.calendar_error, "Calendar unavailable")

    def test_png_becomes_jpeg_with_expiring_media_grant(self):
        item = self.add("alpha.png", mode="RGBA")
        original = (self.queue / item["filename"]).read_bytes()
        url = self.service.media_url(item["id"])
        grant = url.rsplit("/", 1)[1].removesuffix(".jpg")
        self.assertGreaterEqual(len(grant), 40)
        path = self.service.public_media(grant)
        with Image.open(path) as image:
            self.assertEqual(image.format, "JPEG")
            self.assertEqual(image.mode, "RGB")
            self.assertEqual(image.size, (800, 1000))
        self.assertEqual((self.queue / item["filename"]).read_bytes(), original)
        self.service.state.data["grants"][grant]["expires"] = time.time() - 1
        self.assertIsNone(self.service.public_media(grant))
        self.service.cleanup_media()
        self.assertFalse(path.exists())
        self.assertNotIn(grant, self.service.state.data["grants"])

    def test_public_server_exposes_media_but_no_private_routes(self):
        item = self.add()
        url = self.service.media_url(item["id"])
        media_route = "/media/" + url.rsplit("/", 1)[1]
        admin, public = create_apps(self.service)
        client = public.test_client()
        for route in ("/", "/api/state", "/api/settings", "/api/account/check", "/static/app.js"):
            self.assertEqual(client.get(route).status_code, 404, route)
        response = client.get(media_route)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "image/jpeg")
        self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
        response.close()
        self.assertEqual(client.get("/media/unknown.jpg").status_code, 404)
        self.assertEqual(client.post(media_route).status_code, 405)

    def test_ingress_ip_and_csrf_guards(self):
        admin, public = create_apps(self.service, ingress=True)
        client = admin.test_client()
        self.assertEqual(client.get("/api/state").status_code, 403)
        source = {"REMOTE_ADDR": "172.30.32.2"}
        self.assertEqual(client.get("/api/state", environ_overrides=source).status_code, 200)
        self.assertEqual(client.post("/api/queue/scan", environ_overrides=source).status_code, 403)
        headers = {"X-RT-Request": "1"}
        self.assertEqual(client.post("/api/queue/scan", environ_overrides=source, headers=headers).status_code, 200)
        self.assertEqual(client.post("/api/queue/scan", environ_overrides=source,
                                     headers=headers | {"Sec-Fetch-Site": "cross-site"}).status_code, 403)
        self.assertEqual(client.get("/api/state", environ_overrides=source,
                                    headers={"Sec-Fetch-Site": "cross-site"}).status_code, 403)
        # Proxy headers supplied by clients never grant ingress access.
        self.assertEqual(client.get("/api/state", headers={"X-Forwarded-For": "172.30.32.2"}).status_code, 403)

    def test_state_never_returns_tokens_secrets_or_oauth_nonces(self):
        self.service.state.data["oauth_states"] = {"OAUTH_NONCE_SECRET": time.time() + 600}
        admin, public = create_apps(self.service)
        response = admin.test_client().get("/api/state")
        self.assertEqual(response.status_code, 200)
        payload = response.get_data(as_text=True)
        for secret in ("TOKEN_SECRET_1324", "APP_SECRET_5678", "OAUTH_NONCE_SECRET"):
            self.assertNotIn(secret, payload)
        data = response.get_json()
        self.assertTrue(data["settings"]["has_token"])
        self.assertTrue(data["settings"]["has_app_secret"])
        self.assertNotIn("access_token", data["settings"])
        self.assertNotIn("app_secret", data["settings"])

    def test_upload_and_reorder_pair_through_api(self):
        admin, public = create_apps(self.service)
        client = admin.test_client()
        buffer = io.BytesIO()
        Image.new("RGB", (800, 1000), "navy").save(buffer, "JPEG")
        data = {"files": [(io.BytesIO(buffer.getvalue()), "b.jpg"), (io.BytesIO(b"Caption B"), "b.txt"),
                          (io.BytesIO(buffer.getvalue()), "a.jpg"), (io.BytesIO(b"Caption A"), "a.txt")]}
        response = client.post("/api/upload", data=data, headers={"X-RT-Request": "1"}, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        items = self.service.queue.list_items()
        response = client.post("/api/queue/reorder", json={"ids": [item["id"] for item in items[::-1]]}, headers={"X-RT-Request": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual((self.queue / "0001__b.txt").read_text("utf-8"), "Caption B")
        self.assertEqual(self.service.queue.list_items()[0]["id"], items[1]["id"])


if __name__ == "__main__":
    unittest.main()
