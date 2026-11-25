"""An app-owned Instagram browser. Credentials stay in its private profile.

The interactive view and publication share one browser thread. No remote debugging
port, cookie export or arbitrary navigation endpoint is exposed to the dashboard.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import math
import os
from pathlib import Path
import re
import shutil
import threading
import time
from urllib.parse import urljoin, urlsplit, urlunsplit

from .instagram import InstagramError
from .state import atomic_json


HOME = 'https://www.instagram.com/'
WIDTH, HEIGHT = 1100, 760
VIEW_SECONDS = 15 * 60
USERNAME = re.compile(r'[A-Za-z0-9_.]{1,30}')
SHORTCODE = re.compile(r'[A-Za-z0-9_-]{1,64}')
KEYS = {'Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Delete', 'Escape',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
        'PageUp', 'PageDown', 'Control+A'}
BUSY = 'The Instagram browser is busy. Wait for the current operation to finish.'
EXPIRED = 'The browser view expired. Open Instagram sign-in again.'
SIGN_IN = 'Complete Instagram sign-in in the browser, then verify the connection.'
UNCERTAIN = 'Instagram did not confirm the uploaded post. Check your profile before retrying.'
COMPOSER = 'The Instagram post editor changed or could not be opened. No post was sent.'


class BrowserInstagramError(InstagramError):
    pass


class BrowserNotSent(BrowserInstagramError):
    """The browser stopped before the final Share action was attempted."""


def _instagram_url(value):
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == 'https' and parsed.hostname in ('instagram.com', 'www.instagram.com')
                and parsed.port in (None, 443) and not parsed.username and not parsed.password)
    except (ValueError, TypeError):
        return False


def _public_url(value):
    if not _instagram_url(value):
        return HOME
    parsed = urlsplit(value)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, '', ''))


def _username_from_profile(href):
    url = urljoin(HOME, href or '')
    if not _instagram_url(url):
        return None
    name = urlsplit(url).path.strip('/')
    if USERNAME.fullmatch(name) and name.lower() not in {
        'accounts', 'explore', 'direct', 'create', 'reels', 'stories', 'p', 'reel', 'settings'}:
        return name
    return None


def _receipt(response, expected_username=None, expected_caption=None):
    """Accept only the actual successful configure response, never a feed item."""
    try:
        parsed = urlsplit(response.url)
        if (not _instagram_url(response.url) or response.request.method != 'POST'
                or parsed.path.rstrip('/') not in ('/api/v1/media/configure', '/api/v1/media/configure_sidecar')
                or response.status != 200):
            return None
        payload = response.json()
        media = payload.get('media') if isinstance(payload, dict) and payload.get('status') == 'ok' else None
        if not isinstance(media, dict):
            return None
        identity = str(media.get('pk') or media.get('id') or '').split('_', 1)[0]
        code = media.get('code')
        if not identity.isdigit() or not isinstance(code, str) or not SHORTCODE.fullmatch(code):
            return None
        if expected_username is not None and media.get('user', {}).get('username') != expected_username:
            return None
        if expected_caption is not None:
            caption = media.get('caption')
            text = caption.get('text') if isinstance(caption, dict) else '' if caption is None else None
            if text != expected_caption:
                return None
        return {'id': identity, 'permalink': HOME + f'p/{code}/'}
    except Exception:
        return None


class _Chromium:
    """Used only by the owning executor thread; no Playwright object escapes it."""
    def __init__(self, profile):
        from playwright.sync_api import sync_playwright
        self.playwright = None
        self.context = None
        self.page = None
        self.expected_username = None
        profile.mkdir(parents=True, exist_ok=True, mode=0o700)
        profile.chmod(0o700)
        preferences = profile / 'Default' / 'Preferences'
        preferences.parent.mkdir(exist_ok=True, mode=0o700)
        old = json.loads(preferences.read_text('utf-8')) if preferences.exists() else {}
        old['credentials_enable_service'] = False
        old.setdefault('profile', {})['password_manager_enabled'] = False
        atomic_json(preferences, old)
        # Never pass HA's Supervisor credential, proxy secrets or Python env to
        # the untrusted web renderer. Chromium's environment is explicitly small.
        env = {k: v for k, v in os.environ.items() if k in {
            'PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'TEMP', 'TMP',
            'SYSTEMROOT', 'WINDIR', 'LOCALAPPDATA', 'APPDATA', 'DISPLAY', 'XAUTHORITY'}}
        try:
            self.playwright = sync_playwright().start()
            options = {'headless': True, 'viewport': {'width': WIDTH, 'height': HEIGHT},
                       'locale': 'en-US', 'accept_downloads': False, 'service_workers': 'block',
                       'args': ['--disable-dev-shm-usage', '--disable-extensions'], 'env': env,
                       'timeout': 45000}
            executable = os.environ.get('RT_CHROMIUM_EXECUTABLE')
            if executable:
                options['executable_path'] = executable
            self.context = self.playwright.chromium.launch_persistent_context(str(profile), **options)
            self.context.set_default_timeout(12000)
            self.context.set_default_navigation_timeout(45000)
            self.context.route('**/*', self._route)
            self.context.on('page', self._new_page)
            self.page = self.context.pages[0] if self.context.pages else self.context.new_page()
            for extra in self.context.pages[1:]:
                extra.close()
        except Exception:
            self.close()
            raise

    def _new_page(self, page):
        # Instagram password/2FA/challenge flow uses the existing page. A popup
        # must never become an unrelated general-purpose browser or login proxy.
        if self.page is not None and page != self.page:
            page.close()

    @staticmethod
    def _route(route):
        request = route.request
        try:
            parsed = urlsplit(request.url)
            host = parsed.hostname or ''
            if request.is_navigation_request():
                allowed = _instagram_url(request.url)
            else:
                allowed = parsed.scheme == 'https' and parsed.port in (None, 443) and any(
                    host == suffix or host.endswith('.' + suffix)
                    for suffix in ('instagram.com', 'cdninstagram.com', 'fbcdn.net', 'facebook.com', 'fbsbx.com'))
            if allowed:
                route.continue_()
            else:
                route.abort()
        except Exception:
            route.abort()

    def home(self):
        self.page.goto(HOME, wait_until='domcontentloaded')

    def account(self):
        if not _instagram_url(self.page.url) or '/accounts/' in urlsplit(self.page.url).path:
            raise BrowserInstagramError(SIGN_IN)
        if self.page.locator('input[type="password"]').count():
            raise BrowserInstagramError(SIGN_IN)
        profile = self.page.get_by_role('link', name=re.compile(r'^Profile$', re.I))
        try:
            profile = self._one([profile])
            create = self._one([
                self.page.get_by_role('link', name=re.compile(r'^Create$', re.I)),
                self.page.get_by_role('button', name=re.compile(r'^(Create|New post)$', re.I))])
        except BrowserInstagramError:
            raise BrowserInstagramError(SIGN_IN) from None
        username = _username_from_profile(profile.get_attribute('href'))
        if not username:
            raise BrowserInstagramError(SIGN_IN)
        return {'connected': True, 'id': 'browser:' + username, 'username': username,
                'connection_method': 'browser', 'checked_at': time.time()}

    @staticmethod
    def _one(locators):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            for locator in locators:
                if locator.count() == 1 and locator.is_visible():
                    return locator
            locators[0].page.wait_for_timeout(150)
        raise BrowserNotSent(COMPOSER)

    def upload(self, path, caption, before_share=None):
        page = self.page
        try:
            self.home()
            account = self.account()
            if self.expected_username and account['username'] != self.expected_username:
                raise BrowserNotSent('The Instagram account changed. Verify the selected account before resuming publishing.')
            self._one([
                page.get_by_role('link', name=re.compile(r'^Create$', re.I)),
                page.get_by_role('button', name=re.compile(r'^(Create|New post)$', re.I))
            ]).click()
            post = page.get_by_role('menuitem', name=re.compile(r'^Post$', re.I))
            if post.count() == 1 and post.is_visible():
                post.click()
            file_input = page.locator('input[type="file"][accept*="image"]')
            file_input.first.wait_for(state='attached')
            if file_input.count() != 1:
                raise BrowserNotSent(COMPOSER)
            file_input.set_input_files(str(path))
            self._one([
                page.get_by_role('button', name=re.compile(r'^Select crop$', re.I)),
                page.get_by_label('Select crop', exact=True)
            ]).click()
            self._one([page.get_by_text('Original', exact=True)]).click()
            for _ in range(2):
                self._one([page.get_by_role('button', name='Next', exact=True)]).click()
            field = self._one([
                page.get_by_role('textbox', name=re.compile(r'^Write a caption', re.I)),
                page.locator('[contenteditable="true"][role="textbox"]'),
                page.locator('textarea[aria-label="Write a caption…"]')
            ])
            field.fill(caption)
            tag = field.evaluate('(element) => element.tagName')
            actual = field.input_value() if tag in ('TEXTAREA', 'INPUT') else field.inner_text()
            if actual.replace('\r\n', '\n') != caption.replace('\r\n', '\n'):
                raise BrowserNotSent(COMPOSER)
            share = self._one([page.get_by_role('button', name='Share', exact=True)])
            # The interaction lease is closed, and the owner thread serializes
            # all input. Recheck the self-profile link even behind the modal.
            profile = page.get_by_role('link', name=re.compile(r'^Profile$', re.I), include_hidden=True)
            if profile.count() != 1 or _username_from_profile(profile.get_attribute('href')) != account['username']:
                raise BrowserNotSent(COMPOSER)
        except BrowserInstagramError as error:
            raise BrowserNotSent(str(error)) from None
        except Exception:
            raise BrowserNotSent(COMPOSER) from None

        receipt = []
        def capture(response):
            result = _receipt(response, account['username'], caption)
            if result:
                receipt.append(result)
        page.on('response', capture)
        try:
            if before_share is not None:
                try:
                    before_share()
                except Exception:
                    raise BrowserNotSent('The post could not be prepared for publication. No post was sent.') from None
            # Exactly one final Share click. Timeouts are never retried.
            share.click(timeout=20000)
            deadline = time.monotonic() + 60
            while not receipt and time.monotonic() < deadline:
                page.wait_for_timeout(250)
            if not receipt:
                raise BrowserInstagramError(UNCERTAIN)
            return receipt[0]
        except BrowserNotSent:
            raise
        except Exception:
            raise BrowserInstagramError(UNCERTAIN) from None
        finally:
            page.remove_listener('response', capture)

    def close(self):
        try:
            if self.context:
                self.context.close()
        finally:
            if self.playwright:
                self.playwright.stop()
            self.context = self.playwright = self.page = None


class BrowserInstagram:
    def __init__(self, state, runtime_factory=None, clock=None):
        self.state = state
        self.profile = state.directory / 'instagram-browser'
        self._runtime_factory = runtime_factory or _Chromium
        self._clock = clock or time.monotonic
        self._runtime = None
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='instagram-browser')
        self._operation = threading.Lock()
        self._metadata = threading.Lock()
        self._expires = 0
        self._busy = False
        self._url = HOME
        self._closed = False

    def status(self):
        with self._metadata, self.state.lock:
            return {'active': self._expires > self._clock(), 'busy': self._busy,
                    'width': WIDTH, 'height': HEIGHT, 'url': self._url,
                    'connected': bool(self.state.data.get('browser_session') and
                                      self.state.data['account'].get('connected') and
                                      self.state.data['connection_method'] == 'browser')}

    def _call(self, fn):
        if self._closed or not self._operation.acquire(blocking=False):
            raise BrowserInstagramError(BUSY)
        try:
            return self._executor.submit(fn).result()
        except BrowserInstagramError:
            raise
        except Exception:
            raise BrowserInstagramError('The Instagram browser could not complete this operation. Reopen sign-in and try again.') from None
        finally:
            self._operation.release()

    def _ensure(self):
        if self._runtime is None:
            if self.profile.is_symlink() or self.profile.resolve().parent != self.state.directory.resolve():
                raise BrowserInstagramError('The private browser profile path is invalid.')
            try:
                self._runtime = self._runtime_factory(self.profile)
            except Exception:
                raise BrowserInstagramError('The Instagram browser could not start. Update the app and try again.') from None
        return self._runtime

    def _remember_url(self):
        with self._metadata:
            self._url = _public_url(self._runtime.page.url) if self._runtime else HOME

    def _require_view(self):
        if not self.status()['active']:
            raise BrowserInstagramError(EXPIRED)
        if self.state.data['connection_method'] != 'browser':
            raise BrowserInstagramError('Select browser sign-in in the connection settings first.')

    def start(self):
        def work():
            if self.state.data['connection_method'] != 'browser':
                raise BrowserInstagramError('Select browser sign-in in the connection settings first.')
            with self.state.lock:
                self.state.data['enabled'] = False
                self.state.save()
            runtime = self._ensure()
            if not self.status()['active']:
                runtime.home()
            with self._metadata:
                self._expires = self._clock() + VIEW_SECONDS
            self._remember_url()
            return self.status()
        return self._call(work)

    def frame(self):
        def work():
            self._require_view()
            data = self._ensure().page.screenshot(type='jpeg', quality=80, full_page=False)
            self._remember_url()
            return data
        return self._call(work)

    def input(self, payload):
        def work():
            self._require_view()
            if not isinstance(payload, dict):
                raise BrowserInstagramError('Invalid browser input.')
            page = self._ensure().page
            kind = payload.get('type')
            if kind == 'click' and set(payload) == {'type', 'x', 'y'}:
                x, y = payload['x'], payload['y']
                if (type(x) not in (int, float) or type(y) not in (int, float)
                        or not math.isfinite(x) or not math.isfinite(y) or not 0 <= x < WIDTH or not 0 <= y < HEIGHT):
                    raise BrowserInstagramError('Invalid browser input.')
                page.mouse.click(x, y)
            elif kind == 'text' and set(payload) == {'type', 'text'}:
                text = payload['text']
                if not isinstance(text, str) or not 1 <= len(text) <= 1024 or '\x00' in text:
                    raise BrowserInstagramError('Invalid browser input.')
                page.keyboard.insert_text(text)
            elif kind == 'key' and set(payload) == {'type', 'key'} and payload['key'] in KEYS:
                page.keyboard.press(payload['key'])
            elif kind == 'scroll' and set(payload) == {'type', 'delta_y'}:
                delta = payload['delta_y']
                if type(delta) not in (int, float) or not math.isfinite(delta) or not -2000 <= delta <= 2000:
                    raise BrowserInstagramError('Invalid browser input.')
                page.mouse.wheel(0, delta)
            else:
                raise BrowserInstagramError('Invalid browser input.')
            with self._metadata:
                self._expires = self._clock() + VIEW_SECONDS
            self._remember_url()
            return self.status()
        return self._call(work)

    def _verify(self, navigate, allow_account_change=False):
        if self.state.data['connection_method'] != 'browser':
            raise BrowserInstagramError('Select browser sign-in in the connection settings first.')
        runtime = self._ensure()
        if navigate:
            runtime.home()
        try:
            account = runtime.account()
            with self.state.lock:
                previous = self.state.data['account']
                # Pausing or closing the login viewer is not consent to switch
                # the publication destination. Keep the last verified identity
                # even after a failed check; only explicit Finish can replace it.
                if (not allow_account_change and previous.get('username')
                        and previous.get('username') != account['username']):
                    raise BrowserInstagramError('The Instagram account changed. Verify the selected account before resuming publishing.')
                self.state.data.update(account=account, browser_session=True)
                self.state.save()
            self._remember_url()
            return dict(account)
        except BrowserInstagramError as error:
            with self.state.lock:
                self.state.data['enabled'] = False
                self.state.data.setdefault('account', {}).update(connected=False, error=str(error))
                self.state.save()
            raise

    def finish(self):
        def work():
            self._require_view()
            account = self._verify(False, allow_account_change=True)
            with self._metadata:
                self._expires = 0
            return account
        return self._call(work)

    def close_view(self):
        def work():
            with self._metadata:
                self._expires = 0
            # Reset any partially entered form or unfinished composer in memory.
            if self._runtime:
                self._runtime.home()
                self._remember_url()
            return self.status()
        return self._call(work)

    def check(self):
        def work():
            if self.status()['active']:
                raise BrowserInstagramError('Finish or close Instagram sign-in before enabling publishing.')
            return self._verify(True)
        return self._call(work)

    def upload(self, path, caption, before_share=None):
        path = Path(path)
        if path.is_symlink() or not path.is_file() or path.suffix.lower() not in ('.jpg', '.jpeg', '.png'):
            raise BrowserInstagramError('Choose a local JPEG or PNG photo to publish.')
        if not isinstance(caption, str) or len(caption) > 2200:
            raise BrowserInstagramError('The caption must be text with at most 2200 characters.')
        def work():
            if self.status()['active']:
                raise BrowserInstagramError('Finish or close Instagram sign-in before enabling publishing.')
            if self.state.data['connection_method'] != 'browser' or not self.state.data.get('browser_session'):
                raise BrowserInstagramError(SIGN_IN)
            with self._metadata:
                self._busy = True
            try:
                try:
                    account = self._verify(True)
                    runtime = self._ensure()
                    runtime.expected_username = account['username']
                except BrowserInstagramError as error:
                    raise BrowserNotSent(str(error)) from None
                if before_share is None:
                    return runtime.upload(path, caption)
                return runtime.upload(path, caption, before_share=before_share)
            finally:
                with self._metadata:
                    self._busy = False
                self._remember_url()
        return self._call(work)

    def permalink(self, media_id):
        # A confirmed browser upload already contains its permalink. Recoveries
        # without one must be reviewed, never inferred from the profile feed.
        raise BrowserInstagramError('Verify the published post link on the Instagram profile.')

    def disconnect(self):
        def work():
            if self._runtime:
                self._runtime.close()
                self._runtime = None
            root, profile = self.state.directory.resolve(), self.profile.resolve()
            if profile.parent != root or profile.name != 'instagram-browser' or self.profile.is_symlink():
                raise BrowserInstagramError('The private browser profile path is invalid.')
            if profile.exists():
                shutil.rmtree(profile)
            with self._metadata:
                self._expires, self._url = 0, HOME
            with self.state.lock:
                self.state.data.update(enabled=False, browser_session=False, account={'connected': False})
                self.state.save()
            return {'connected': False}
        return self._call(work)

    def shutdown(self):
        if self._closed:
            return
        with self._operation:
            self._closed = True
            def work():
                if self._runtime:
                    self._runtime.close()
                    self._runtime = None
            self._executor.submit(work).result()
            self._executor.shutdown(wait=True)
