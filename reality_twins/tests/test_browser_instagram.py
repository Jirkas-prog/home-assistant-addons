"""Browser session isolation, login lease and one-attempt publication tests."""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.browser_instagram import (BrowserInstagram, BrowserInstagramError, BrowserNotSent, _Chromium,
                                   _instagram_url, _public_url, _receipt,
                                   _username_from_profile, EXPIRED, SIGN_IN)
from app.state import State


class FakeRuntime:
    def __init__(self, profile):
        self.thread = threading.get_ident()
        self.profile = profile
        profile.mkdir(parents=True, exist_ok=True)
        (profile / 'session-private').write_text('PRIVATE_SESSION', encoding='utf-8')
        self.page = SimpleNamespace(url='https://www.instagram.com/accounts/login/?next=PRIVATE_QUERY',
                                    mouse=Mock(), keyboard=Mock(),
                                    screenshot=Mock(return_value=b'jpeg-bytes'))
        self.home = Mock()
        self.account = Mock(return_value={'connected': True, 'id': 'browser:example_account',
                                         'username': 'example_account', 'connection_method': 'browser'})
        self.upload = Mock(return_value={'id': '123456', 'permalink': 'https://www.instagram.com/p/ExampleCode/'})
        self.close = Mock()


class BrowserInstagramTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = State(self.root / 'private')
        self.state.data.update(connection_method='browser', browser_session=False)
        self.now = 1000
        self.runtime = None
        def factory(profile):
            self.runtime = FakeRuntime(profile)
            return self.runtime
        self.browser = BrowserInstagram(self.state, runtime_factory=factory, clock=lambda: self.now)

    def tearDown(self):
        self.browser.shutdown()
        self.temp.cleanup()

    def connected(self):
        self.browser.start()
        return self.browser.finish()

    def test_start_is_real_owned_runtime_on_dedicated_thread_and_pauses(self):
        self.state.data['enabled'] = True
        result = self.browser.start()
        self.assertTrue(result['active'])
        self.assertFalse(result['connected'])
        self.assertFalse(self.state.data['enabled'])
        self.assertNotEqual(self.runtime.thread, threading.get_ident())
        self.assertEqual(result['url'], 'https://www.instagram.com/accounts/login/')
        self.assertNotIn('PRIVATE_QUERY', json.dumps(result))

    def test_no_password_or_profile_data_in_public_status_or_state(self):
        self.browser.start()
        self.browser.input({'type': 'text', 'text': 'PRIVATE_PASSWORD'})
        self.runtime.page.keyboard.insert_text.assert_called_once_with('PRIVATE_PASSWORD')
        self.assertNotIn('PRIVATE_PASSWORD', self.state.path.read_text('utf-8'))
        self.assertNotIn('PRIVATE_SESSION', json.dumps(self.browser.status()))
        self.assertNotIn('PRIVATE_SESSION', json.dumps(self.state.settings()))

    def test_frame_is_in_memory_and_requires_active_view(self):
        with self.assertRaisesRegex(BrowserInstagramError, EXPIRED):
            self.browser.frame()
        self.browser.start()
        self.assertEqual(self.browser.frame(), b'jpeg-bytes')
        self.runtime.page.screenshot.assert_called_once_with(type='jpeg', quality=80, full_page=False)
        self.now += 901
        self.assertFalse(self.browser.status()['active'])
        with self.assertRaisesRegex(BrowserInstagramError, EXPIRED):
            self.browser.input({'type': 'key', 'key': 'Enter'})

    def test_polling_does_not_extend_lease_but_user_input_does(self):
        self.browser.start()
        self.now += 850
        self.browser.frame()
        self.browser.input({'type': 'click', 'x': 100, 'y': 200})
        self.now += 60
        self.assertTrue(self.browser.status()['active'])
        self.now += 850
        self.assertFalse(self.browser.status()['active'])

    def test_login_not_complete_does_not_mark_account_connected_or_close_view(self):
        self.browser.start()
        self.runtime.account.side_effect = BrowserInstagramError(SIGN_IN)
        with self.assertRaises(BrowserInstagramError):
            self.browser.finish()
        self.assertFalse(self.state.data['browser_session'])
        self.assertFalse(self.state.data['account']['connected'])
        self.assertTrue(self.browser.status()['active'])

    def test_finish_verifies_dom_before_marking_session_and_keeps_publishing_paused(self):
        account = self.connected()
        self.assertTrue(account['connected'])
        self.assertEqual(account['username'], 'example_account')
        self.assertTrue(self.state.data['browser_session'])
        self.assertFalse(self.state.data['enabled'])
        self.assertFalse(self.browser.status()['active'])
        self.runtime.account.assert_called_once()

    def test_view_blocks_background_check_and_upload(self):
        self.browser.start()
        path = self.root / 'sample.jpg'
        path.write_bytes(b'fixture')
        with self.assertRaises(BrowserInstagramError):
            self.browser.check()
        with self.assertRaises(BrowserInstagramError):
            self.browser.upload(path, 'Caption')
        self.runtime.upload.assert_not_called()

    def test_close_retains_profile_and_ends_input_access(self):
        self.connected()
        self.browser.start()
        self.browser.close_view()
        self.assertTrue(self.browser.profile.exists())
        self.assertTrue(self.state.data['browser_session'])
        with self.assertRaises(BrowserInstagramError):
            self.browser.input({'type': 'key', 'key': 'Enter'})

    def test_inputs_reject_navigation_shortcuts_invalid_bounds_and_extra_fields(self):
        self.browser.start()
        bad = [{'type': 'key', 'key': 'Control+L'}, {'type': 'key', 'key': 'F12'},
               {'type': 'click', 'x': 1100, 'y': 20}, {'type': 'click', 'x': True, 'y': 20},
               {'type': 'click', 'x': float('nan'), 'y': 20},
               {'type': 'text', 'text': 'x' * 1025},
               {'type': 'text', 'text': 'abc', 'url': 'https://example.com'},
               {'type': 'scroll', 'delta_y': 2001},
               {'type': 'navigate', 'url': 'file:///data/settings.json'}]
        for payload in bad:
            with self.subTest(payload=payload), self.assertRaises(BrowserInstagramError):
                self.browser.input(payload)
        self.runtime.page.keyboard.press.assert_not_called()
        self.runtime.page.keyboard.insert_text.assert_not_called()
        self.runtime.page.mouse.click.assert_not_called()

    def test_upload_uses_browser_once_and_does_not_store_caption(self):
        self.connected()
        path = self.root / 'sample.jpg'
        path.write_bytes(b'fixture')
        result = self.browser.upload(path, 'PRIVATE_CAPTION')
        self.assertEqual(result['id'], '123456')
        self.runtime.upload.assert_called_once_with(path, 'PRIVATE_CAPTION')
        self.assertNotIn('PRIVATE_CAPTION', self.state.path.read_text('utf-8'))
        self.assertFalse(self.browser.status()['busy'])

    def test_unexpected_upload_error_is_sanitized_and_never_retried(self):
        self.connected()
        path = self.root / 'sample.jpg'
        path.write_bytes(b'fixture')
        self.runtime.upload.side_effect = RuntimeError('PRIVATE_TOKEN')
        with self.assertRaises(BrowserInstagramError) as caught:
            self.browser.upload(path, 'Caption')
        self.assertNotIn('PRIVATE_TOKEN', str(caught.exception))
        self.runtime.upload.assert_called_once()

    def test_failed_preflight_is_explicitly_not_sent_and_never_opens_composer(self):
        self.connected()
        path = self.root / 'sample.jpg'
        path.write_bytes(b'fixture')
        self.runtime.account.side_effect = BrowserInstagramError(SIGN_IN)
        with self.assertRaises(BrowserNotSent):
            self.browser.upload(path, 'Caption')
        self.runtime.upload.assert_not_called()

    def test_publication_marker_is_forwarded_to_composer_and_not_called_at_preflight(self):
        self.connected()
        path = self.root / 'sample.jpg'
        path.write_bytes(b'fixture')
        marker = Mock()
        self.browser.upload(path, 'Caption', before_share=marker)
        self.runtime.upload.assert_called_once_with(path, 'Caption', before_share=marker)
        marker.assert_not_called()

    def test_account_switch_during_enabled_publishing_is_rejected_and_pauses(self):
        self.connected()
        self.state.data['enabled'] = True
        self.runtime.account.return_value = {'connected': True, 'username': 'other_account'}
        with self.assertRaises(BrowserInstagramError):
            self.browser.check()
        self.assertFalse(self.state.data['enabled'])
        self.assertFalse(self.state.data['account']['connected'])

    def test_paused_account_switch_requires_explicit_finish_even_after_failed_check(self):
        self.connected()
        self.browser.start()
        self.runtime.account.return_value = {'connected': True, 'id': 'browser:other_account',
                                            'username': 'other_account', 'connection_method': 'browser'}
        self.browser.close_view()
        self.assertFalse(self.state.data['enabled'])
        for _ in range(2):
            with self.assertRaisesRegex(BrowserInstagramError, 'account changed'):
                self.browser.check()
            self.assertEqual(self.state.data['account']['username'], 'example_account')
            self.assertFalse(self.state.data['account']['connected'])
        # The user returns to the browser and explicitly verifies this account.
        self.browser.start()
        self.assertEqual(self.browser.finish()['username'], 'other_account')
        self.assertEqual(self.browser.check()['username'], 'other_account')

    def test_upload_rejects_changed_account_while_paused_without_opening_composer(self):
        self.connected()
        self.runtime.account.return_value = {'connected': True, 'username': 'other_account'}
        path = self.root / 'sample.jpg'
        path.write_bytes(b'fixture')
        with self.assertRaises(BrowserNotSent):
            self.browser.upload(path, 'Caption')
        self.runtime.upload.assert_not_called()
        self.assertEqual(self.state.data['account']['username'], 'example_account')

    def test_disconnect_only_removes_private_owned_profile(self):
        self.connected()
        keep = self.state.directory / 'keep.txt'
        keep.write_text('Keep', encoding='utf-8')
        self.browser.disconnect()
        self.assertFalse(self.browser.profile.exists())
        self.assertEqual(keep.read_text('utf-8'), 'Keep')
        self.assertFalse(self.state.data['browser_session'])
        self.assertFalse(self.state.data['account']['connected'])

    def test_disconnected_or_official_mode_cannot_open_browser(self):
        self.state.data['connection_method'] = 'official'
        with self.assertRaises(BrowserInstagramError):
            self.browser.start()
        self.assertIsNone(self.runtime)


class BrowserValidationTests(unittest.TestCase):
    def test_safe_urls_never_reflect_query_password_or_fragment(self):
        for url in ('http://www.instagram.com/', 'https://www.instagram.com.evil.example/',
                    'https://user:secret@www.instagram.com/', 'file:///data/settings.json',
                    'https://www.instagram.com:444/'):
            self.assertFalse(_instagram_url(url))
        self.assertEqual(_public_url('https://www.instagram.com/challenge/?token=SECRET#SECRET'),
                         'https://www.instagram.com/challenge/')

    def test_profile_username_is_validated_and_cannot_be_a_feature_path(self):
        self.assertEqual(_username_from_profile('/example.account/'), 'example.account')
        for href in ('/accounts/', '/direct/inbox/', 'https://elsewhere.example/user/', '/explore/', None):
            self.assertIsNone(_username_from_profile(href))

    def response(self, **changes):
        values = {'url': 'https://www.instagram.com/api/v1/media/configure/',
                  'request': SimpleNamespace(method='POST'), 'status': 200,
                  'json': lambda: {'status': 'ok', 'media': {'id': '12345_6789', 'code': 'Example_12'}}}
        values.update(changes)
        return SimpleNamespace(**values)

    def test_receipt_requires_successful_exact_publish_response(self):
        self.assertEqual(_receipt(self.response()),
                         {'id': '12345', 'permalink': 'https://www.instagram.com/p/Example_12/'})
        for change in ({'url': 'https://www.instagram.com/api/v1/feed/user/'},
                       {'url': 'https://evil.example/api/v1/media/configure/'},
                       {'request': SimpleNamespace(method='GET')}, {'status': 400},
                       {'json': lambda: {'status': 'fail', 'media': {'pk': '123', 'code': 'abc'}}},
                       {'json': lambda: {'status': 'ok', 'media': {'pk': '123', 'code': '../x'}}}):
            self.assertIsNone(_receipt(self.response(**change)))

    def test_receipt_must_match_intended_account_and_caption(self):
        response = self.response(json=lambda: {'status': 'ok', 'media': {
            'pk': '123', 'code': 'Example', 'user': {'username': 'example_account'},
            'caption': {'text': 'Exact caption'}}})
        self.assertIsNotNone(_receipt(response, 'example_account', 'Exact caption'))
        self.assertIsNone(_receipt(response, 'other_account', 'Exact caption'))
        self.assertIsNone(_receipt(response, 'example_account', 'Changed caption'))

    def test_request_policy_rejects_local_network_and_non_instagram_navigation(self):
        for url in ('http://supervisor/core/api/', 'file:///data/settings.json', 'https://127.0.0.1/',
                    'https://www.instagram.com.evil.example/', 'https://facebook.com/'):
            route = Mock()
            route.request = SimpleNamespace(url=url, is_navigation_request=lambda: True)
            _Chromium._route(route)
            route.abort.assert_called_once()
            route.continue_.assert_not_called()
        for url in ('https://www.instagram.com/accounts/login/', 'https://www.instagram.com/challenge/'):
            route = Mock()
            route.request = SimpleNamespace(url=url, is_navigation_request=lambda: True)
            _Chromium._route(route)
            route.continue_.assert_called_once()
        asset = Mock()
        asset.request = SimpleNamespace(url='https://scontent.cdninstagram.com/photo.jpg', is_navigation_request=lambda: False)
        _Chromium._route(asset)
        asset.continue_.assert_called_once()


_TEST_BROWSER = (os.environ.get('RT_BROWSER_TEST_EXECUTABLE') or shutil.which('chromium')
                 or shutil.which('chromium-browser'))
_FIXTURE = '''<!doctype html><html lang="en"><body><nav id="navigation"></nav>
<main id="app"><input aria-label="Username"><input aria-label="Password" type="password">
<button onclick="document.cookie='fixture_login=1;path=/;max-age=3600';home()">Log in</button></main>
<script>
function home() {
 document.getElementById('navigation').innerHTML='<a href="/example_account/">Profile</a><button onclick="create()">Create</button>';
 app.innerHTML='';
}
function create() {
 app.innerHTML='<input type="file" accept="image/jpeg" onchange="crop()">';
}
function crop() {
 app.innerHTML='<button aria-label="Select crop" onclick="original()">Crop</button>';
}
function original() {
 app.innerHTML='<button onclick="next(0)">Original</button>';
}
function next(step) {
 if (step < 2) app.innerHTML='<button onclick="next('+(step+1)+')">Next</button>';
 else app.innerHTML='<textarea aria-label="Write a caption..."></textarea><button onclick="share()">Share</button>';
}
async function share() {
 await fetch('/api/v1/media/configure/', {method:'POST', body:'fixture'});
 app.innerHTML='<h1>Your post has been shared.</h1>';
}
if (document.cookie.includes('fixture_login=1')) home();
</script></body></html>'''


@unittest.skipUnless(_TEST_BROWSER, 'A local Chromium executable is required for the isolated browser fixture.')
class ChromiumFixtureTests(unittest.TestCase):
    def test_real_chromium_input_session_restore_crop_caption_and_single_share(self):
        # All network is fulfilled by this synthetic fixture. This never signs
        # into Instagram or reads the user's normal browser profile.
        from PIL import Image
        shares = []
        markers = []
        def route(request_route):
            request = request_route.request
            if request.url == 'https://www.instagram.com/api/v1/media/configure/':
                self.assertEqual(markers, ['before_share'])
                shares.append(request.method)
                request_route.fulfill(status=200, content_type='application/json', body=json.dumps(
                    {'status': 'ok', 'media': {'pk': '123456789', 'code': 'FixturePost',
                     'user': {'username': 'example_account'},
                     'caption': {'text': 'Synthetic caption.\nSecond line.'}}}))
            elif request.url == 'https://www.instagram.com/':
                request_route.fulfill(status=200, content_type='text/html', body=_FIXTURE)
            else:
                request_route.abort()
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}):
            state = State(Path(temp) / 'private')
            state.data.update(connection_method='browser', browser_session=False)
            def factory(profile):
                runtime = _Chromium(profile)
                runtime.context.unroute('**/*')
                runtime.context.route('**/*', route)
                return runtime
            browser = BrowserInstagram(state, runtime_factory=factory)
            try:
                browser.start()
                # In this fixture the tab order starts with username/password.
                browser.input({'type': 'key', 'key': 'Tab'})
                browser.input({'type': 'text', 'text': 'example_account'})
                browser.input({'type': 'key', 'key': 'Tab'})
                browser.input({'type': 'text', 'text': 'fixture_password'})
                browser.input({'type': 'key', 'key': 'Tab'})
                browser.input({'type': 'key', 'key': 'Enter'})
                self.assertTrue(browser.frame().startswith(b'\xff\xd8'))
                self.assertEqual(browser.finish()['username'], 'example_account')
                browser.shutdown()
                browser = BrowserInstagram(State(state.directory), runtime_factory=factory)
                self.assertEqual(browser.check()['username'], 'example_account')
                image = Path(temp) / 'image.jpg'
                Image.new('RGB', (1080, 1350), 'navy').save(image)
                def failed_marker():
                    raise RuntimeError('Synthetic queue write failure')
                with self.assertRaises(BrowserNotSent):
                    browser.upload(image, 'Synthetic caption.\nSecond line.', before_share=failed_marker)
                self.assertEqual(shares, [])
                receipt = browser.upload(image, 'Synthetic caption.\nSecond line.',
                                         before_share=lambda: markers.append('before_share'))
                self.assertEqual(receipt, {'id': '123456789', 'permalink': 'https://www.instagram.com/p/FixturePost/'})
                self.assertEqual(shares, ['POST'])
                self.assertEqual(markers, ['before_share'])
            finally:
                browser.shutdown()


if __name__ == '__main__':
    unittest.main()
