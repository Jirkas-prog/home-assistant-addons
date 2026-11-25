from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import requests
from instagrapi.exceptions import ChallengeRequired, LoginRequired, TwoFactorRequired

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.direct_instagram import DirectInstagram, DirectInstagramError, SingleAttemptMixin, _bounded_session
from app.state import State


class FakeClient:
    def __init__(self):
        self.settings = {"cookies": {"sessionid": "SESSION_PRIVATE_SECRET", "ds_user_id": "123456"},
                         "authorization_data": {"ds_user_id": "123456", "sessionid": "SESSION_PRIVATE_SECRET"}}
        self.login = Mock(side_effect=self._login)
        self.account_info = Mock(return_value=SimpleNamespace(pk="123456", username="czech_this_view"))
        self.photo_upload = Mock(return_value=SimpleNamespace(pk="987654", code="AbCd_12"))
        self.media_info_v1 = Mock(return_value=SimpleNamespace(pk="987654", code="AbCd_12"))
        self.password = None
        self.public, self.private = requests.Session(), requests.Session()
        self.set_settings = Mock(side_effect=self._set_settings)
        self.get_settings = Mock(side_effect=lambda: deepcopy(self.settings))

    def _login(self, username, password, verification_code=""):
        self.password = password
        return True

    def _set_settings(self, settings):
        self.settings = deepcopy(settings)


class DirectInstagramTests(unittest.TestCase):
    def setUp(self):
        self.network = patch("requests.sessions.Session.request", side_effect=AssertionError("Unexpected real network access"))
        self.network.start()
        self.timer = patch("app.direct_instagram.threading.Timer")
        self.timer_factory = self.timer.start()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = State(self.root / "DATA")
        self.state.data.update(connection_method="direct", direct_session={})
        self.client = FakeClient()
        self.direct = DirectInstagram(self.state, client_factory=lambda: self.client)

    def tearDown(self):
        self.direct.disconnect()
        self.temp.cleanup()
        self.timer.stop()
        self.network.stop()

    def login(self):
        return self.direct.login("czech_this_view", "PASSWORD_PRIVATE_SECRET")

    def assert_no_password_on_disk(self):
        for path in self.root.rglob("*"):
            if path.is_file():
                payload = path.read_bytes()
                self.assertNotIn(b"PASSWORD_PRIVATE_SECRET", payload)
                self.assertNotIn(b"654321", payload)

    def test_login_persists_session_but_never_password_or_raw_account(self):
        self.client.settings.update(password="PASSWORD_PRIVATE_SECRET", verification_code="654321",
                                    unsupported_secret="PASSWORD_PRIVATE_SECRET")
        self.client.settings["authorization_data"]["password"] = "PASSWORD_PRIVATE_SECRET"
        account = self.login()
        self.assertTrue(account["connected"])
        self.assertEqual(account["connection_method"], "direct")
        self.assertEqual(account["username"], "czech_this_view")
        self.assertNotIn("SESSION_PRIVATE_SECRET", str(account))
        self.assertFalse(self.state.data["enabled"])
        self.assertTrue(self.state.data["direct_session"]["cookies"])
        self.assertIsNone(self.client.password)
        self.assert_no_password_on_disk()

    def test_two_factor_is_memory_only_then_second_call_uses_pending_credentials(self):
        self.client.login.side_effect = [TwoFactorRequired("raw secret PASSWORD_PRIVATE_SECRET"), True]
        first = self.login()
        self.assertEqual(first["challenge"], "two_factor")
        self.assertLessEqual(first["expires_in"], 600)
        self.assertFalse(first["connected"])
        self.assertEqual(self.state.data["direct_session"], {})
        self.assert_no_password_on_disk()
        second = self.direct.login("", "", verification_code="654321")
        self.assertTrue(second["connected"])
        self.client.login.assert_called_with("czech_this_view", "PASSWORD_PRIVATE_SECRET", verification_code="654321")
        self.assertIsNone(self.direct._pending)
        self.assertIsNone(self.client.password)
        self.assert_no_password_on_disk()

    def test_two_factor_expiry_clears_password_without_network(self):
        self.client.login.side_effect = TwoFactorRequired("two factor")
        self.login()
        pending = self.direct._pending
        self.direct._expire_pending(pending)
        self.assertIsNone(self.direct._pending)
        self.assertNotIn("password", pending)
        self.assertIsNone(self.client.password)
        with self.assertRaises(DirectInstagramError):
            self.direct.login("", "", verification_code="654321")
        self.assertEqual(self.client.login.call_count, 1)
        self.assert_no_password_on_disk()

    def test_two_factor_expired_clock_does_not_reuse_credentials(self):
        self.client.login.side_effect = TwoFactorRequired("two factor")
        self.login()
        self.direct._pending["expires"] = time.time() - 1
        with self.assertRaises(DirectInstagramError):
            self.direct.login("", "", verification_code="654321")
        self.assertEqual(self.client.login.call_count, 1)
        self.assertIsNone(self.direct._pending)

    def test_challenge_stops_and_asks_for_official_app_without_raw_response(self):
        self.client.login.side_effect = ChallengeRequired("raw PASSWORD_PRIVATE_SECRET SESSION_PRIVATE_SECRET")
        with self.assertRaises(DirectInstagramError) as caught:
            self.login()
        self.assertIn("official Instagram app", str(caught.exception))
        self.assertNotIn("PASSWORD_PRIVATE_SECRET", str(caught.exception))
        self.assertNotIn("SESSION_PRIVATE_SECRET", str(caught.exception))
        self.assertFalse(self.client.with_challenge_flow)
        self.assertIsNone(self.direct._pending)
        self.assert_no_password_on_disk()

    def test_restart_restores_private_session_without_password_login(self):
        self.login()
        restored_client = FakeClient()
        restored = DirectInstagram(State(self.root / "DATA"), client_factory=lambda: restored_client)
        account = restored.check()
        self.assertEqual(account["id"], "123456")
        restored_client.set_settings.assert_called_once()
        restored_client.account_info.assert_called_once()
        restored_client.login.assert_not_called()
        self.assertIsNone(restored_client.password)
        self.assert_no_password_on_disk()

    def test_expired_session_never_relogs_in_or_uploads_automatically(self):
        self.login()
        self.client.account_info.side_effect = LoginRequired("raw token SESSION_PRIVATE_SECRET")
        with self.assertRaises(DirectInstagramError) as caught:
            self.direct.check()
        self.assertIn("session expired", str(caught.exception))
        self.assertEqual(self.client.login.call_count, 1)
        self.client.photo_upload.assert_not_called()
        self.assertFalse(self.state.data["enabled"])
        self.assertFalse(self.state.data["account"]["connected"])

    def test_upload_calls_photo_upload_once_and_returns_only_media_receipt(self):
        self.login()
        path = self.root / "image.jpg"
        path.write_bytes(b"image fixture; image validation belongs to Service")
        result = self.direct.upload(path, "Caption")
        self.assertEqual(result, {"id": "987654", "permalink": "https://www.instagram.com/p/AbCd_12/"})
        self.client.photo_upload.assert_called_once_with(path, "Caption")
        self.client.media_info_v1.assert_not_called()

    def test_upload_timeout_is_not_retried_and_does_not_expose_exception_data(self):
        self.login()
        path = self.root / "image.jpg"
        path.write_bytes(b"image")
        self.client.photo_upload.side_effect = requests.Timeout("PASSWORD_PRIVATE_SECRET SESSION_PRIVATE_SECRET")
        with self.assertRaises(DirectInstagramError) as caught:
            self.direct.upload(path, "Caption")
        self.assertIn("Check your profile", str(caught.exception))
        self.assertNotIn("PASSWORD_PRIVATE_SECRET", str(caught.exception))
        self.assertNotIn("SESSION_PRIVATE_SECRET", str(caught.exception))
        self.client.photo_upload.assert_called_once()

    def test_known_media_id_survives_missing_permalink(self):
        self.login()
        path = self.root / "image.jpg"
        path.write_bytes(b"image")
        self.client.photo_upload.return_value = SimpleNamespace(pk="987654", code="")
        self.assertEqual(self.direct.upload(path, "Caption"), {"id": "987654", "permalink": ""})
        self.client.media_info_v1.assert_not_called()

    def test_permalink_is_read_only_and_rejects_invalid_media_id(self):
        self.login()
        self.assertEqual(self.direct.permalink("987654"), "https://www.instagram.com/p/AbCd_12/")
        self.client.media_info_v1.assert_called_once_with("987654")
        self.client.photo_upload.assert_not_called()
        with self.assertRaises(DirectInstagramError):
            self.direct.permalink("../settings")

    def test_disconnect_clears_session_pending_and_account_without_remote_calls(self):
        self.client.login.side_effect = TwoFactorRequired("two factor")
        self.login()
        pending = self.direct._pending
        self.direct.disconnect()
        self.assertEqual(self.state.data["direct_session"], {})
        self.assertFalse(self.state.data["account"]["connected"])
        self.assertIsNone(self.direct._pending)
        self.assertNotIn("password", pending)
        self.client.account_info.assert_not_called()
        self.client.photo_upload.assert_not_called()
        self.assert_no_password_on_disk()

    def test_official_mode_cannot_use_saved_direct_session(self):
        self.login()
        self.state.data["connection_method"] = "official"
        before = self.client.account_info.call_count
        with self.assertRaises(DirectInstagramError):
            self.direct.check()
        self.assertEqual(self.client.account_info.call_count, before)

    def test_real_client_construction_uses_no_retries_or_impersonation_transport(self):
        actual = DirectInstagram(self.state)._new_client()
        self.assertIsInstance(actual, SingleAttemptMixin)
        self.assertFalse(actual.with_challenge_flow)
        self.assertEqual(actual.private_transport, "curl")
        self.assertEqual(actual.public_transport, "requests")
        self.assertEqual(type(actual.private.adapters["https://"]).__name__, "_CurlH2Adapter")
        for session in (actual.private, actual.public):
            self.assertEqual(session.adapters["https://"].max_retries.total, 0)
            self.assertFalse(session.trust_env)
            self.assertTrue(session.verify)
            self.assertEqual(session.proxies, {})
            session.close()


class SingleAttemptTests(unittest.TestCase):
    def test_private_post_timeout_has_one_network_attempt(self):
        class Stub(SingleAttemptMixin):
            authorization = "private bearer value"
            private_requests_count = 0
        client = Stub()
        client._send_private_request = Mock(side_effect=requests.Timeout("timeout"))
        with self.assertRaises(requests.Timeout):
            client.private_request("media/configure/", data={"caption": "Test"})
        client._send_private_request.assert_called_once()
        self.assertEqual(client.private_requests_count, 1)

    def test_configure_missing_media_has_no_recent_feed_fallback_or_retry(self):
        client = SingleAttemptMixin()
        client.photo_rupload = Mock(return_value=("upload-id", 800, 1000))
        client.photo_configure = Mock(return_value={"status": "ok"})
        client._extract_configured_media = Mock()
        with patch("app.direct_instagram.time.sleep"), self.assertRaises(DirectInstagramError):
            client.photo_upload(Path("image.jpg"), "Caption")
        client.photo_rupload.assert_called_once()
        client.photo_configure.assert_called_once()
        client._extract_configured_media.assert_not_called()

    def test_single_successful_rupload_and_configure(self):
        client = SingleAttemptMixin()
        client.photo_rupload = Mock(return_value=("upload-id", 800, 1000))
        client.photo_configure = Mock(return_value={"media": {"pk": "987654"}})
        client._extract_configured_media = Mock(return_value=SimpleNamespace(pk="987654", code="abc"))
        with patch("app.direct_instagram.time.sleep"):
            self.assertEqual(client.photo_upload(Path("image.jpg"), "Caption").pk, "987654")
        client.photo_rupload.assert_called_once()
        client.photo_configure.assert_called_once()

    def test_session_requests_always_have_bounded_timeout(self):
        session = requests.Session()
        with patch.object(session, "request", return_value=object()) as original:
            _bounded_session(session)
            session.request("POST", "https://example.test/upload", data=b"image")
            self.assertEqual(original.call_args.kwargs["timeout"], (10, 45))
            session.request("POST", "https://example.test/upload", timeout=None)
            self.assertEqual(original.call_args.kwargs["timeout"], (10, 45))
        session.close()


if __name__ == "__main__":
    unittest.main()
