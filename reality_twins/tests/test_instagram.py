"""Instagram authentication tests using deterministic fake HTTP responses only."""
import json
from pathlib import Path
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlsplit
import unittest
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.instagram import Instagram, InstagramError
from app.server import create_apps
from app.service import Service
from app.state import State


def response(payload, status=200):
    result = Mock()
    result.status_code = status
    result.ok = 200 <= status < 300
    result.json.return_value = payload
    result.raise_for_status.side_effect = None if result.ok else requests.HTTPError("mock HTTP failure")
    return result


class InstagramTests(unittest.TestCase):
    def setUp(self):
        self.network = patch("requests.sessions.Session.request", side_effect=AssertionError("Unexpected real network access"))
        self.network.start()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = State(self.root / "DATA")
        self.state.data.update(app_id="123456", app_secret="APP_SECRET_123",
                               public_media_base_url="https://media.example.test",
                               access_token="ORIGINAL_TOKEN_123")
        self.state.save()
        self.session = Mock()
        self.instagram = Instagram(self.state, self.session)

    def tearDown(self):
        self.temp.cleanup()
        self.network.stop()

    def oauth_responses(self, shape="data"):
        short = {"access_token": "SHORT_SECRET_TOKEN", "user_id": "123456", "permissions": "instagram_business_basic"}
        self.session.post.return_value = response({"data": [short]} if shape == "data" else short)
        self.session.get.return_value = response({"access_token": "LONG_SECRET_TOKEN", "expires_in": 5184000})
        self.session.request.return_value = response({"user_id": "123456", "username": "reality_twins_test"})

    def test_oauth_authorize_url_scopes_redirect_and_nonce_no_secrets(self):
        url = self.instagram.oauth_url()
        parsed, query = urlsplit(url), parse_qs(urlsplit(url).query)
        self.assertEqual(parsed.hostname, "www.instagram.com")
        self.assertEqual(query["client_id"], ["123456"])
        self.assertEqual(query["redirect_uri"], ["https://media.example.test/oauth/callback"])
        self.assertEqual(set(query["scope"][0].split(",")), {"instagram_business_basic", "instagram_business_content_publish"})
        self.assertIn(query["state"][0], self.state.data["oauth_states"])
        self.assertNotIn("APP_SECRET_123", url)
        self.assertNotIn("ORIGINAL_TOKEN_123", url)
        self.session.assert_not_called()

    def test_current_data_array_oauth_shape(self):
        self.oauth_responses("data")
        nonce = self.state.oauth_state(time.time())
        result = self.instagram.oauth_callback("AUTHORIZATION_CODE_SECRET", nonce)
        self.assertEqual(result["username"], "reality_twins_test")
        self.assertTrue(result["connected"])
        self.assertEqual(self.state.data["access_token"], "LONG_SECRET_TOKEN")
        self.assertFalse(self.state.data["enabled"])
        self.assertNotIn(nonce, self.state.data["oauth_states"])
        serialized = json.dumps(result)
        for secret in ("SHORT_SECRET_TOKEN", "LONG_SECRET_TOKEN", "APP_SECRET_123", "AUTHORIZATION_CODE_SECRET"):
            self.assertNotIn(secret, serialized)
        exchange = self.session.get.call_args.kwargs["params"]
        self.assertEqual(exchange["access_token"], "SHORT_SECRET_TOKEN")
        self.assertEqual(exchange["grant_type"], "ig_exchange_token")

    def test_legacy_flat_oauth_shape(self):
        self.oauth_responses("flat")
        result = self.instagram.oauth_callback("authorization-code", self.state.oauth_state(time.time()))
        self.assertEqual(result["id"], "123456")
        self.assertEqual(self.state.data["access_token"], "LONG_SECRET_TOKEN")

    def test_expired_and_reused_nonce_stop_before_network(self):
        old = self.state.oauth_state(time.time() - 601)
        with self.assertRaises(ValueError):
            self.instagram.oauth_callback("code", old)
        self.session.post.assert_not_called()
        fresh = self.state.oauth_state(time.time())
        self.state.consume_oauth_state(fresh, time.time())
        with self.assertRaises(ValueError):
            self.instagram.oauth_callback("code", fresh)
        self.session.post.assert_not_called()
        self.session.get.assert_not_called()
        self.session.request.assert_not_called()

    def test_nonce_is_expired_at_exact_expiry_boundary(self):
        nonce = self.state.oauth_state(1000)
        with self.assertRaises(ValueError):
            self.state.consume_oauth_state(nonce, 1600)

    def test_refresh_accepts_rotated_token_and_updates_expiry(self):
        now = 2_000_000_000
        self.state.data["account"] = {"connected": True, "id": "123456", "username": "old_account",
                                      "token_created_at": now - 2 * 86400, "expires_at": now + 86400}
        self.session.get.return_value = response({"access_token": "ROTATED_TOKEN_456", "expires_in": 5184000})
        with patch("app.instagram.time.time", return_value=now):
            self.instagram.refresh_if_needed()
        self.assertEqual(self.state.data["access_token"], "ROTATED_TOKEN_456")
        self.assertEqual(self.state.data["account"]["expires_at"], now + 5184000)
        self.assertEqual(self.state.data["account"]["token_created_at"], now)
        self.assertEqual(self.session.get.call_args.kwargs["params"]["access_token"], "ORIGINAL_TOKEN_123")

    def test_refresh_cannot_overwrite_a_new_connection(self):
        now = 2_000_000_000
        self.state.data["account"] = {"connected": True, "token_created_at": now - 2 * 86400, "expires_at": now + 86400}
        def changing_response(*args, **kwargs):
            self.state.update({"access_token": "NEW_ACCOUNT_TOKEN"})
            return response({"access_token": "STALE_REFRESHED_TOKEN", "expires_in": 5184000})
        self.session.get.side_effect = changing_response
        with patch("app.instagram.time.time", return_value=now):
            self.instagram.refresh_if_needed()
        self.assertEqual(self.state.data["access_token"], "NEW_ACCOUNT_TOKEN")
        self.assertFalse(self.state.data["account"]["connected"])
        self.assertNotIn("expires_at", self.state.data["account"])

    def test_account_check_rejects_stale_identity_after_token_changed(self):
        def response_after_change(*args, **kwargs):
            self.state.update({"access_token": "NEW_ACCOUNT_TOKEN"})
            return response({"user_id": "123456", "username": "stale_account"})
        self.session.request.side_effect = response_after_change
        with self.assertRaises(InstagramError):
            self.instagram.check()
        self.assertEqual(self.state.data["access_token"], "NEW_ACCOUNT_TOKEN")
        self.assertFalse(self.state.data["account"]["connected"])
        self.assertNotIn("username", self.state.data["account"])

    def test_graph_errors_do_not_reflect_meta_secret_message(self):
        self.session.request.return_value = response({"error": {"code": 190, "error_subcode": 463,
            "message": "Debug contains ORIGINAL_TOKEN_123 APP_SECRET_123"}}, status=400)
        with self.assertRaises(InstagramError) as caught:
            self.instagram.request("GET", "me")
        self.assertIn("190", str(caught.exception))
        self.assertNotIn("ORIGINAL_TOKEN_123", str(caught.exception))
        self.assertNotIn("APP_SECRET_123", str(caught.exception))

    def test_malformed_oauth_reply_is_reported_without_server_crash(self):
        for payload in (None, [], {"data": "unexpected"}, {"data": [None]}):
            with self.subTest(payload=payload):
                self.session.post.return_value = response(payload)
                nonce = self.state.oauth_state(time.time())
                with self.assertRaises(InstagramError):
                    self.instagram.oauth_callback("code", nonce)

    def test_malformed_graph_reply_is_reported_without_server_crash(self):
        for payload in (None, [], "not-an-object"):
            with self.subTest(payload=payload):
                self.session.request.return_value = response(payload)
                with self.assertRaises(InstagramError):
                    self.instagram.request("GET", "me")

    def test_public_callback_without_valid_state_never_exchanges_code(self):
        service = Service(self.root / "SERVICE_DATA", self.root / "PLANNED")
        try:
            service.instagram = self.instagram
            admin, public = create_apps(service)
            client = public.test_client()
            result = client.get("/oauth/callback?code=CODE_SECRET&state=unknown")
            self.assertEqual(result.status_code, 400)
            self.assertNotIn("CODE_SECRET", result.get_data(as_text=True))
            self.session.post.assert_not_called()
            self.session.get.assert_not_called()
            self.session.request.assert_not_called()
        finally:
            service.queue.close()

    def test_public_oauth_callback_page_contains_no_token_secret_or_code(self):
        service = Service(self.root / "SERVICE_DATA", self.root / "PLANNED")
        try:
            service.instagram = self.instagram
            self.oauth_responses()
            nonce = self.state.oauth_state(time.time())
            admin, public = create_apps(service)
            result = public.test_client().get("/oauth/callback", query_string={"code": "CODE_SECRET", "state": nonce})
            self.assertEqual(result.status_code, 200)
            html = result.get_data(as_text=True)
            for secret in ("CODE_SECRET", "LONG_SECRET_TOKEN", "SHORT_SECRET_TOKEN", "APP_SECRET_123", nonce):
                self.assertNotIn(secret, html)
            self.assertEqual(result.headers["Cache-Control"], "no-store")
            self.assertEqual(result.headers["Referrer-Policy"], "no-referrer")
        finally:
            service.queue.close()


if __name__ == "__main__":
    unittest.main()
