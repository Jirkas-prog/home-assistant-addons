"""Direct Instagram sign-in and one-attempt local photo upload.

The unofficial client is pinned by requirements. Its automatic POST retries,
challenge resolution and recent-feed publication fallback are deliberately not
used. A caller must durably mark an attempt as publishing before upload().
"""
from copy import deepcopy
import hashlib
import json
import logging
from pathlib import Path
import re
import threading
import time

import requests
from requests.adapters import HTTPAdapter

from .instagram import InstagramError


class DirectInstagramError(InstagramError):
    pass


_SILENT = logging.Logger("czech-this-view.instagram.private", level=logging.CRITICAL + 1)
_SILENT.addHandler(logging.NullHandler())
_SILENT.propagate = False
_USERNAME = re.compile(r"^[A-Za-z0-9._]{1,30}$")
_CODE = re.compile(r"^[A-Za-z0-9_-]+$")
_SESSION_KEYS = {
    "uuids", "mid", "ig_u_rur", "ig_www_claim", "authorization_data", "cookies",
    "last_login", "device_settings", "user_agent", "country", "country_code", "locale",
    "timezone_offset", "timezone_name", "push_disabled", "request_timeout",
    "public_request_retries_count", "public_request_retries_timeout", "session_retry_total",
    "session_retry_backoff_factor", "session_retry_statuses", "public_transport",
    "public_user_agent", "public_graphql_user_agent", "private_transport",
    "public_transport_impersonate", "tls_verify", "fbns_auth", "usdid",
}
_PASSWORD_KEYS = {"password", "passwd", "pwd", "verification_code", "two_factor_code",
                  "two_factor_identifier", "totp_secret"}


def _without_passwords(value):
    if isinstance(value, dict):
        return {key: _without_passwords(item) for key, item in value.items()
                if str(key).lower() not in _PASSWORD_KEYS}
    if isinstance(value, list):
        return [_without_passwords(item) for item in value]
    return value


def _session_settings(client):
    settings = client.get_settings()
    if not isinstance(settings, dict):
        raise DirectInstagramError("Instagram did not return a valid session. Sign in again.")
    cleaned = _without_passwords({key: value for key, value in settings.items() if key in _SESSION_KEYS})
    # A JSON round trip also prevents mutable client state leaking into persisted data.
    return json.loads(json.dumps(cleaned))


def _fingerprint(settings):
    return hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()


def _bounded_session(session, preserve_adapter=False):
    if not isinstance(session, requests.Session):
        return
    session.trust_env = False
    session.verify = True
    session.proxies = {}
    for scheme in ("https://", "http://"):
        if preserve_adapter:
            # The supported private HTTP/2 adapter already has no retries and
            # explicitly disables browser impersonation. Do not downgrade it.
            session.adapters[scheme].max_retries = HTTPAdapter(max_retries=0).max_retries
        else:
            session.mount(scheme, HTTPAdapter(max_retries=0))
    if not getattr(session, "_ctv_bounded", False):
        original = session.request
        def bounded(method, url, **kwargs):
            kwargs["timeout"] = (10, 45)
            return original(method, url, **kwargs)
        session.request = bounded
        session._ctv_bounded = True


def _harden(client):
    client.with_challenge_flow = False
    client.handle_exception = None
    client.logger = _SILENT
    client.private_request_logger = _SILENT
    client.public_request_logger = _SILENT
    client.session_retry_total = 0
    client.session_retry_backoff_factor = 0
    client.session_retry_statuses = []
    client.public_request_retries_count = 1
    client.public_request_retries_timeout = 0
    client.private_transport = "curl"
    client.public_transport = "requests"
    client.read_timeout = 45
    client.tls_verify = True
    configure = getattr(client, "_configure_private_session_retry", None)
    if callable(configure):
        configure(private_transport="curl")
    for name in ("private", "public", "graphql"):
        _bounded_session(getattr(client, name, None), preserve_adapter=name == "private")


class SingleAttemptMixin:
    """Replace library retry wrappers while retaining its API serialization."""
    def private_request(self, endpoint, data=None, params=None, login=False,
                        with_signature=True, headers=None, extra_sig=None, domain=None):
        request_headers = dict(headers or {})
        if self.authorization and not any(key.lower() == "authorization" for key in request_headers):
            request_headers["Authorization"] = self.authorization
        self.private_requests_count += 1
        return self._send_private_request(endpoint, data=data, params=params, login=login,
                                          with_signature=with_signature, headers=request_headers,
                                          extra_sig=extra_sig, domain=domain)

    def photo_upload(self, path, caption):
        upload_id, width, height = self.photo_rupload(Path(path))
        # The upstream method waits before configure. Keep that delay, but never
        # its ten-attempt loop or its fallback to an unrelated recent feed post.
        time.sleep(3)
        configured = self.photo_configure(upload_id, width, height, caption,
                                          usertags=[], location=None, extra_data={})
        if not isinstance(configured, dict) or not isinstance(configured.get("media"), dict):
            raise DirectInstagramError("Instagram did not confirm the uploaded post. Check your profile before retrying.")
        media = self._extract_configured_media(configured)
        if media is None:
            raise DirectInstagramError("Instagram did not confirm the uploaded post. Check your profile before retrying.")
        return media


def _default_client():
    try:
        from instagrapi import Client
    except ImportError:
        raise DirectInstagramError("Direct Instagram support is not installed. Rebuild or update the app.") from None
    class SingleAttemptClient(SingleAttemptMixin, Client):
        pass
    return SingleAttemptClient(logger=_SILENT, private_transport="curl", public_transport="requests",
                               with_challenge_flow=False, session_retry_total=0,
                               session_retry_backoff_factor=0, session_retry_statuses=[],
                               public_request_retries_count=1, tls_verify=True)


def _field(value, name, default=None):
    return value.get(name, default) if isinstance(value, dict) else getattr(value, name, default)


def _safe_error(error, uploading=False):
    names = {kind.__name__ for kind in type(error).__mro__}
    if isinstance(error, DirectInstagramError):
        return str(error)
    if names & {"ChallengeRequired", "ChallengeError", "ChallengeUnknownStep", "ChallengeSelfieCaptcha",
                "RecaptchaChallengeForm", "AccountSuspended", "ConsentRequired"}:
        return "Open the official Instagram app, complete its security check, then sign in here again."
    if names & {"TwoFactorRequired", "TwoFactorRequiredException"}:
        return "Enter the two-factor verification code from Instagram."
    if names & {"BadPassword", "BadCredentials"}:
        return "Instagram rejected the sign-in. Check your username and password."
    if names & {"LoginRequired", "ClientLoginRequired", "ClientUnauthorizedError"}:
        return "Your Instagram session expired. Sign in again."
    if names & {"PleaseWaitFewMinutes", "FeedbackRequired", "RateLimitError", "ClientThrottledError", "SentryBlock"}:
        return "Instagram temporarily limited this request. Wait and check the official Instagram app before trying again."
    if uploading:
        return "Instagram did not confirm the uploaded post. Check your profile before retrying."
    return "Instagram sign-in or connection could not be completed. Check the official Instagram app and try again."


class DirectInstagram:
    def __init__(self, state, client_factory=None):
        self.state = state
        self.client_factory = client_factory or _default_client
        self.lock = threading.RLock()
        self._client = None
        self._saved_fingerprint = None
        self._pending = None
        self._pending_timer = None

    @staticmethod
    def _forget_password(client):
        if client is not None:
            client.password = None
            client.last_response = None
            client.last_json = {}

    def _clear_pending(self):
        if self._pending_timer:
            self._pending_timer.cancel()
            self._pending_timer = None
        if self._pending:
            self._forget_password(self._pending["client"])
            self._pending.pop("password", None)
        self._pending = None

    def _expire_pending(self, pending):
        with self.lock:
            if self._pending is pending:
                self._clear_pending()

    def _new_client(self):
        client = self.client_factory()
        _harden(client)
        return client

    def _restore(self):
        with self.state.lock:
            settings = deepcopy(self.state.data.get("direct_session") or {})
            method = self.state.data.get("connection_method", "direct")
        if method != "direct" or not settings:
            raise DirectInstagramError("Direct Instagram is not connected. Sign in with your username and password.")
        fingerprint = _fingerprint(settings)
        if self._client is None or self._saved_fingerprint != fingerprint:
            client = self._new_client()
            client.set_settings(settings)
            _harden(client)
            self._forget_password(client)
            self._client, self._saved_fingerprint = client, fingerprint
        return self._client

    def _store(self, client, account):
        settings = _session_settings(client)
        if not settings.get("authorization_data") and not settings.get("cookies"):
            raise DirectInstagramError("Instagram did not return a valid session. Sign in again.")
        with self.state.lock:
            self.state.data.update(direct_session=settings, connection_method="direct", account=account)
            self.state.save()
        self._client, self._saved_fingerprint = client, _fingerprint(settings)
        self._forget_password(client)
        return dict(account)

    @staticmethod
    def _account(info):
        identity = str(_field(info, "pk", "") or _field(info, "id", ""))
        username = _field(info, "username", "")
        if not identity.isdigit() or not isinstance(username, str) or not _USERNAME.fullmatch(username):
            raise DirectInstagramError("Instagram did not return a valid account. Sign in again.")
        return {"connected": True, "id": identity, "username": username,
                "connection_method": "direct", "checked_at": time.time()}

    def _failed(self, message):
        with self.state.lock:
            self.state.data["enabled"] = False
            self.state.data.setdefault("account", {}).update(connected=False, error=message)
            self.state.save()

    def login(self, username, password, verification_code=""):
        with self.lock:
            if not all(isinstance(value, str) for value in (username, password, verification_code)):
                raise DirectInstagramError("Enter your Instagram username and password.")
            username = username.strip().removeprefix("@")
            code = verification_code.strip().replace(" ", "").replace("-", "")
            if code and not re.fullmatch(r"\d{6}(?:\d{2})?", code):
                raise DirectInstagramError("Enter a valid six-digit verification code or an eight-digit backup code.")
            if self._pending and self._pending["expires"] <= time.time():
                self._clear_pending()
            pending = self._pending
            if code and pending and (not username or username == pending["username"]):
                username, password, client = pending["username"], pending["password"], pending["client"]
            else:
                if code and not password:
                    raise DirectInstagramError("Two-factor sign-in expired. Enter your username and password again.")
                if not _USERNAME.fullmatch(username) or not password or len(password) > 1024:
                    raise DirectInstagramError("Enter your Instagram username and password.")
                self._clear_pending()
                pending = None
                client = self._new_client()
                self._client, self._saved_fingerprint = None, None
                with self.state.lock:
                    self.state.data.update(enabled=False, direct_session={}, connection_method="direct",
                                           account={"connected": False, "username": username, "connection_method": "direct"})
                    self.state.save()
            try:
                logged_in = client.login(username, password, verification_code=code)
                if not logged_in:
                    raise DirectInstagramError("Instagram did not confirm sign-in. Check the official Instagram app and try again.")
                account = self._account(client.account_info())
                self._clear_pending()
                return self._store(client, account)
            except Exception as error:
                names = {kind.__name__ for kind in type(error).__mro__}
                if "TwoFactorRequired" in names:
                    if not pending:
                        pending = {"username": username, "password": password, "client": client,
                                   "expires": time.time() + 600}
                        self._pending = pending
                        timer = threading.Timer(600, self._expire_pending, args=(pending,))
                        timer.daemon = True
                        self._pending_timer = timer
                        timer.start()
                    return {"connected": False, "challenge": "two_factor", "username": username,
                            "message": "Enter the two-factor verification code from Instagram.",
                            "expires_in": max(0, int(pending["expires"] - time.time()))}
                self._clear_pending()
                self._forget_password(client)
                message = _safe_error(error)
                self._failed(message)
                raise DirectInstagramError(message) from None

    def check(self):
        with self.lock:
            try:
                client = self._restore()
                original = self._saved_fingerprint
                account = self._account(client.account_info())
                with self.state.lock:
                    if _fingerprint(self.state.data.get("direct_session") or {}) != original:
                        raise DirectInstagramError("The Instagram connection changed. Check the new connection again.")
                return self._store(client, account)
            except Exception as error:
                self._client = None
                message = _safe_error(error)
                self._failed(message)
                raise DirectInstagramError(message) from None

    def upload(self, path, caption):
        with self.lock:
            path = Path(path)
            if path.is_symlink() or not path.is_file() or path.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                raise DirectInstagramError("Choose a local JPEG or PNG photo to publish.")
            if not isinstance(caption, str) or len(caption) > 2200:
                raise DirectInstagramError("The caption must be text with at most 2200 characters.")
            try:
                client = self._restore()
                media = client.photo_upload(path, caption)
                identity = str(_field(media, "pk", "") or _field(media, "id", "")).split("_", 1)[0]
                code = _field(media, "code", "")
                if not identity.isdigit():
                    raise DirectInstagramError("Instagram did not confirm the uploaded post. Check your profile before retrying.")
                link = f"https://www.instagram.com/p/{code}/" if isinstance(code, str) and _CODE.fullmatch(code) else ""
                # Do not turn a valid media ID into a failed upload merely because
                # a session-save or permalink lookup fails. The caller records it.
                return {"id": identity, "permalink": link}
            except Exception as error:
                raise DirectInstagramError(_safe_error(error, uploading=True)) from None

    def permalink(self, media_id):
        identity = str(media_id).split("_", 1)[0]
        if not identity.isdigit():
            raise DirectInstagramError("Invalid Instagram media ID.")
        with self.lock:
            try:
                media = self._restore().media_info_v1(identity)
                code = _field(media, "code", "")
                if not isinstance(code, str) or not _CODE.fullmatch(code):
                    raise DirectInstagramError("Instagram did not return a post link. Verify the post on your profile.")
                return f"https://www.instagram.com/p/{code}/"
            except Exception as error:
                raise DirectInstagramError(_safe_error(error)) from None

    def disconnect(self):
        with self.lock:
            self._clear_pending()
            self._forget_password(self._client)
            self._client, self._saved_fingerprint = None, None
            with self.state.lock:
                self.state.data.update(enabled=False, direct_session={}, account={"connected": False})
                self.state.save()
            return {"connected": False}
