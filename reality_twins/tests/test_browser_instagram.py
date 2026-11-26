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
                                   _username_from_profile, _profile_candidates, CAPTION_TEXT,
                                   _normalized_caption, COMPOSER_STEPS, EXPIRED, SIGN_IN)
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
        self.set_mode = Mock()
        self.tap = Mock()
        self.resume_failed_editor = Mock(return_value=False)
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

    def test_mobile_mode_requires_lease_fixed_modes_and_matching_input_bounds(self):
        with self.assertRaisesRegex(BrowserInstagramError, EXPIRED):
            self.browser.set_mode('mobile')
        self.browser.start()
        for invalid in ('tablet', 'https://example.com', None, {}, ['mobile']):
            with self.subTest(mode=invalid), self.assertRaises(BrowserInstagramError):
                self.browser.set_mode(invalid)
        result = self.browser.set_mode('mobile')
        self.assertEqual((result['mode'], result['width'], result['height']), ('mobile', 390, 844))
        self.runtime.set_mode.assert_called_once_with('mobile')
        self.browser.input({'type': 'click', 'x': 389, 'y': 843})
        self.runtime.tap.assert_called_once_with(389, 843)
        self.runtime.page.mouse.click.assert_not_called()
        for x, y in ((390, 200), (200, 844), (1099, 759)):
            with self.assertRaises(BrowserInstagramError):
                self.browser.input({'type': 'click', 'x': x, 'y': y})
        self.now += 901
        with self.assertRaisesRegex(BrowserInstagramError, EXPIRED):
            self.browser.set_mode('desktop')

    def test_mobile_mode_restores_desktop_on_finish_close_and_expired_check(self):
        for action in ('finish', 'close_view', 'check', 'start'):
            with self.subTest(action=action):
                self.browser.start()
                self.browser.set_mode('mobile')
                self.runtime.set_mode.reset_mock()
                if action in ('check', 'start'):
                    self.now += 901
                getattr(self.browser, action)()
                self.runtime.set_mode.assert_called_once_with('desktop')
                self.assertEqual(self.browser.status()['mode'], 'desktop')
                self.assertEqual(self.browser.status()['width'], 1100)
                self.browser.close_view()

    def test_failed_emulation_discards_runtime_and_cannot_leave_mobile_publication(self):
        self.browser.start()
        runtime = self.runtime
        runtime.set_mode.side_effect = RuntimeError('PRIVATE_DETAIL')
        with self.assertRaises(BrowserInstagramError) as error:
            self.browser.set_mode('mobile')
        self.assertNotIn('PRIVATE_DETAIL', str(error.exception))
        runtime.close.assert_called_once()
        self.assertIsNone(self.browser._runtime)
        self.assertFalse(self.browser.status()['active'])
        self.assertEqual(self.browser.status()['mode'], 'desktop')

    def test_expired_mobile_view_restores_desktop_before_upload(self):
        self.connected()
        self.browser.start()
        self.browser.set_mode('mobile')
        self.now += 901
        path = self.root / 'sample.jpg'
        path.write_bytes(b'fixture')
        self.runtime.upload.side_effect = lambda *_: self.assertEqual(self.browser.status()['mode'], 'desktop')
        self.browser.upload(path, 'Caption')
        self.runtime.set_mode.assert_called_with('desktop')

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

    def test_start_keeps_only_a_runtime_verified_failed_editor_for_inspection(self):
        self.connected()
        self.runtime.home.reset_mock()
        self.runtime.resume_failed_editor.return_value = True
        self.browser.start()
        self.runtime.home.assert_not_called()
        self.assertTrue(self.browser.status()['active'])
        self.assertFalse(self.state.data['enabled'])

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
    def test_profile_tooltip_name_must_match_destination_and_avatar_is_only_a_candidate(self):
        strong, weak = _profile_candidates({'links': [
            {'href': '/example_account/', 'labels': ['Profile • example_account']},
            {'href': '/other_account/', 'labels': ['Profile • example_account']},
            {'href': '/avatar_account/', 'labels': [], 'navigation': True,
             'avatar': "avatar_account's profile picture"}]})
        self.assertEqual(strong, {'example_account'})
        self.assertEqual(weak, {'avatar_account'})

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

    def test_caption_normalization_preserves_words_spacing_and_internal_blank_lines(self):
        self.assertEqual(_normalized_caption('First\r\n\r\nLast\r\n'), 'First\n\nLast')
        self.assertEqual(_normalized_caption(''), '')
        response = self.response(json=lambda: {'status': 'ok', 'media': {
            'pk': '123', 'code': 'Example', 'user': {'username': 'example_account'},
            'caption': {'text': 'First\n\nLast'}}})
        self.assertIsNotNone(_receipt(response, 'example_account', 'First\r\n\r\nLast\r\n'))
        for expected in ('First\nLast', 'First\n\nLast missing', 'First \n\nLast'):
            self.assertIsNone(_receipt(response, 'example_account', expected))

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
 document.getElementById('navigation').innerHTML='<a href="/example_account/" aria-label="Profile • example_account"><img alt="example_account profile picture"></a><a href="/create/select/" onclick="create();return false"><svg aria-label="Post" width="12" height="12"></svg><span>Post</span></a>';
 app.innerHTML='<input type="file" accept="image/jpeg" id="avatar-upload" hidden><button>Next</button><button>Share</button><textarea aria-label="Write a caption..."></textarea>';
 window.fixtureNextClicks=[];
}
function create() {
 app.insertAdjacentHTML('beforeend','<div role="dialog" id="editor"><h1>Create new post</h1><input id="photo-upload" type="file" accept="image/jpeg" hidden onchange="setTimeout(crop,100)"><button id="choose-photo">Select from computer</button></div>');
 document.getElementById('choose-photo').onclick=()=>document.getElementById('photo-upload').click();
}
function crop() {
 editor.innerHTML='<h1>Crop</h1><div role="button" aria-label="Select crop"><div role="button" aria-label="Select crop" onclick="original()"><svg aria-label="Select crop" width="24" height="24"></svg></div></div><button id="next" onclick="next(0)" disabled>Next</button>';
}
function original() {
 editor.insertAdjacentHTML('beforeend','<button id="original">Original</button>');
 document.getElementById('original').onclick=()=>{window.fixtureCrop='original';document.getElementById('original').remove();document.getElementById('next').disabled=false};
}
function next(step) {
 window.fixtureNextClicks.push(step);
 // Keep the previous Next visible during the asynchronous stage transition.
 setTimeout(()=>{
  if (step===0) editor.innerHTML='<h1>Edit</h1><button onclick="next(1)">Next</button>';
  else {window.fixtureCaption='';editor.innerHTML='<h1>Create new post</h1><div contenteditable="true" role="textbox" aria-label="Write a caption..."></div><button onclick="share()">Share</button>';editor.querySelector('[contenteditable]').oninput=event=>{if(event.inputType!=='insertText') throw new Error('Unexpected fixture input');window.fixtureCaption+=event.data ?? String.fromCharCode(10)};}
 },250);
}
async function share() {
 await fetch('/api/v1/media/configure/', {method:'POST', body:JSON.stringify({caption:window.fixtureCaption,crop:window.fixtureCrop,next:window.fixtureNextClicks})});
 editor.innerHTML='<h1>Your post has been shared.</h1>';
}
if (document.cookie.includes('fixture_login=1')) home();
</script></body></html>'''


@unittest.skipUnless(_TEST_BROWSER, 'A local Chromium executable is required for the isolated browser fixture.')
class ChromiumFixtureTests(unittest.TestCase):
    def test_mobile_emulation_keeps_private_session_dimensions_input_and_desktop_restore(self):
        from io import BytesIO
        from PIL import Image
        fixture = '''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <nav><a href="/example_account/" aria-label="Profile • example_account">Profile</a></nav>
        <button style="position:fixed;left:320px;top:780px;width:60px;height:40px"
          onclick="localStorage.setItem('fixture_clicked','yes')">Touch</button>'''
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}):
            state = State(Path(temp) / 'private')
            state.data['connection_method'] = 'browser'
            def factory(profile):
                runtime = _Chromium(profile)
                runtime.context.unroute('**/*')
                runtime.context.route('**/*', lambda route: route.fulfill(
                    status=200, content_type='text/html', body=fixture))
                return runtime
            browser = BrowserInstagram(state, runtime_factory=factory)
            def snapshot():
                return browser._runtime.page.evaluate('''() => ({ua:navigator.userAgent,
                  width:innerWidth,height:innerHeight,touch:navigator.maxTouchPoints,
                  session:localStorage.getItem('fixture_session'),clicked:localStorage.getItem('fixture_clicked')})''')
            try:
                browser.start()
                baseline = browser._call(snapshot)
                browser._call(lambda: browser._runtime.page.evaluate("localStorage.setItem('fixture_session','synthetic')"))
                browser.set_mode('mobile')
                mobile = browser._call(snapshot)
                self.assertEqual((mobile['width'], mobile['height']), (390, 844))
                self.assertIn('Mobile', mobile['ua'])
                self.assertEqual(mobile['touch'], 1)
                self.assertEqual(mobile['session'], 'synthetic')
                self.assertEqual(Image.open(BytesIO(browser.frame())).size, (390, 844))
                browser.input({'type': 'click', 'x': 350, 'y': 800})
                self.assertEqual(browser._call(snapshot)['clicked'], 'yes')
                self.assertEqual(browser.finish()['username'], 'example_account')
                restored = browser._call(snapshot)
                self.assertEqual((restored['width'], restored['height']), (1100, 760))
                self.assertEqual(restored['ua'], baseline['ua'])
                self.assertEqual(restored['touch'], baseline['touch'])
                self.assertEqual(restored['session'], 'synthetic')
                self.assertEqual(browser.status()['mode'], 'desktop')
            finally:
                browser.shutdown()

    def test_crop_icon_is_scoped_unique_and_supports_duplicate_names_and_svg_labels(self):
        cases = [
            '<button aria-label="Select crop Select crop" onclick="choose()">Icon</button>',
            '<div role="button" onclick="choose()"><svg aria-label="select CROP" width="24" height="24"></svg></div>',
            '<div onclick="choose()"><svg aria-label="Select crop" width="24" height="24"></svg></div>',
            '<button aria-label="Expand Expand" onclick="choose()">Icon</button>',
            '<div role="button" onclick="choose()"><svg aria-label="Expand" width="24" height="24"></svg></div>',
            '<button aria-label="Select crop" hidden>Hidden</button><button aria-label="Select crop" onclick="choose()">Icon</button>',
            '<div role="button" aria-label="Select crop"><div role="button" aria-label="Select crop" onclick="choose()"><svg aria-label="Select crop" width="24" height="24"></svg></div></div>',
        ]
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}):
            runtime = _Chromium(Path(temp) / 'browser')
            try:
                for controls in cases:
                    runtime.page.set_content('<button aria-label="Expand" onclick="window.outside=true">Background</button>'
                        '<div role="dialog"><h1>Crop</h1>' + controls + '</div>'
                        '<script>window.chosen=0;function choose(){window.chosen++;}</script>')
                    dialog = runtime.page.get_by_role('dialog')
                    runtime._crop_control(dialog).click()
                    self.assertEqual(runtime.page.evaluate('window.chosen'), 1)
                    self.assertIsNone(runtime.page.evaluate('window.outside'))
                runtime.page.set_content('<div role="dialog"><h1>Crop</h1>'
                    '<button aria-label="Select crop">One</button><button aria-label="Select crop">Two</button></div>')
                with self.assertRaises(BrowserNotSent):
                    runtime._crop_control(runtime.page.get_by_role('dialog'))
                for controls in (
                        '<button aria-label="Select crop"><svg aria-label="Select crop" width="24" height="24"></svg></button>' * 2,
                        '<button aria-label="Select crop">' + '<svg aria-label="Select crop" width="24" height="24"></svg>' * 2 + '</button>'):
                    runtime.page.set_content('<div role="dialog"><h1>Crop</h1>' + controls + '</div>')
                    with self.assertRaises(BrowserNotSent):
                        runtime._crop_control(runtime.page.get_by_role('dialog'))
            finally:
                runtime.close()

    def test_caption_reader_preserves_blank_lines_spans_breaks_and_input_text(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}):
            runtime = _Chromium(Path(temp) / 'browser')
            try:
                runtime.page.set_content('<div contenteditable="true" role="textbox"></div>')
                field = runtime.page.get_by_role('textbox')
                for caption in ('First\n\nLast\n', 'First\r\n\r\nLast\r\n', '', '\n\nLast\n', 'First\n\n\nLast\n'):
                    with self.subTest(caption=caption):
                        field.fill(caption)
                        self.assertEqual(_normalized_caption(field.evaluate(CAPTION_TEXT)), _normalized_caption(caption))
                for markup, expected in (
                        ('First<div><br></div><div>Last</div>', 'First\n\nLast'),
                        ('<span>First</span><br><br><span>Last</span>', 'First\n\nLast'),
                        ('<p><span>First</span></p><p><br></p><p><span>Last</span></p>', 'First\n\nLast'),
                        ('First<div>Last</div>', 'First\nLast')):
                    field.evaluate('(element, markup) => element.innerHTML=markup', markup)
                    self.assertEqual(field.evaluate(CAPTION_TEXT), expected)
                self.assertNotEqual(field.evaluate(CAPTION_TEXT), 'First\n\nLast')
                field.evaluate("element => element.innerHTML='<strong>Unknown markup</strong>'")
                with self.assertRaisesRegex(Exception, 'Unsupported caption markup'):
                    field.evaluate(CAPTION_TEXT)
            finally:
                runtime.close()

    def test_pre_share_failure_names_the_stage_and_preserves_only_verified_editor(self):
        from PIL import Image
        current = {}
        fixture = _FIXTURE.replace("if (document.cookie.includes('fixture_login=1')) home();", 'home();')
        cases = [
            ('upload_photo', fixture.replace('<h1>Crop</h1>', '<h1>Preparing photo</h1>')),
            ('open_crop', fixture.replace('aria-label="Select crop"', 'aria-label="Unknown icon"')),
            ('select_crop', fixture.replace('>Original</button>', '>Custom</button>')),
            ('open_edit', fixture.replace('<h1>Edit</h1>', '<h1>Preparing edits</h1>')),
            ('open_caption', fixture.replace('role="textbox"', 'role="note"')),
            ('write_caption', fixture.replace('window.fixtureCaption+=event.data ?? String.fromCharCode(10)', 'window.fixtureCaption+=event.data ?? String.fromCharCode(10);event.target.textContent=String.fromCharCode(120)')),
            ('prepare_share', fixture.replace('onclick="share()">Share', 'onclick="share()">Publish')),
            ('verify_account', fixture.replace("window.fixtureNextClicks.push(step);", "window.fixtureNextClicks.push(step); if(step===1) document.getElementById('navigation').innerHTML='<a href=\"/other_account/\" aria-label=\"Profile • other_account\">Profile</a>';")),
        ]
        def route(request_route):
            self.assertEqual(request_route.request.method, 'GET', 'No publication request is allowed before Share')
            request_route.fulfill(status=200, content_type='text/html; charset=utf-8', body=current['html'])
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}), \
                patch('app.browser_instagram.COMPOSER_TIMEOUT', 1.2):
            image = Path(temp) / 'photo.jpg'
            Image.new('RGB', (1080, 1350), 'navy').save(image)
            runtime = _Chromium(Path(temp) / 'browser')
            runtime.expected_username = 'example_account'
            try:
                runtime.context.unroute('**/*')
                runtime.context.route('**/*', route)
                for stage, html in cases:
                    current['html'] = html
                    marker = Mock()
                    with self.subTest(stage=stage):
                        with self.assertLogs('app.browser_instagram', level='WARNING') as diagnostics:
                            with self.assertRaises(BrowserNotSent) as caught:
                                runtime.upload(image, 'First line.\n\nLast line.', before_share=marker)
                        self.assertEqual(str(caught.exception), COMPOSER_STEPS[stage])
                        self.assertIn('stage=' + stage, diagnostics.output[0])
                        self.assertIn('exception=', diagnostics.output[0])
                        self.assertNotIn('First line', diagnostics.output[0])
                        self.assertNotIn('example_account', diagnostics.output[0])
                        self.assertNotIn('<', diagnostics.output[0])
                        marker.assert_not_called()
                        self.assertEqual(runtime.page.get_by_role('dialog').count(), 1)
                        self.assertEqual(runtime.resume_failed_editor(), stage != 'verify_account')
                        self.assertFalse(runtime.resume_failed_editor(), 'Inspection marker must be consumed')
                        if stage != 'verify_account':
                            self.assertTrue(runtime.page.screenshot(type='jpeg').startswith(b'\xff\xd8'))
                # A saved failure is no permission to inspect a different account.
                runtime._failed_editor_account = 'example_account'
                self.assertFalse(runtime.resume_failed_editor())
                runtime._failed_editor_account = 'example_account'
                runtime.home()
                self.assertIsNone(runtime._failed_editor_account)
            finally:
                runtime.close()

    def test_rendered_account_navigation_variants_and_owner_evidence(self):
        cases = [
            ('tooltip_en', '/', '<a href="/example_account/" aria-label="Profile • example_account"><img alt="Avatar"></a>', True),
            ('tooltip_cs', '/', '<a href="/example_account/" title="Profil • example_account"><img alt="Profilový obrázek"></a>', True),
            ('described_tooltip', '/', '<div><a href="/example_account/" aria-describedby="profile-tip"><img alt="Avatar"></a></div><div role="tooltip" id="profile-tip">Profile • example_account</div>', True),
            ('svg_label', '/', '<div><a href="/example_account/"><svg aria-label="Profile • example_account" width="20" height="20"></svg></a></div>', True),
            ('avatar_en', '/', '<nav><a href="/example_account/"><img alt="example_account\'s profile picture"></a></nav>', True),
            ('avatar_cs', '/', '<aside><a href="/example_account/"><img alt="Profilový obrázek uživatele example_account"></a></aside>', True),
            ('hidden_duplicate', '/', '<nav><a href="/example_account/">Profile</a><a style="display:none" href="/other_account/">Profile</a></nav><input type="password" hidden>', True),
            ('own_profile_en', '/example_account/', '<main><a href="/accounts/edit/">Edit profile</a></main>', True),
            ('own_profile_cs', '/example_account/', '<main><button>Upravit profil</button></main>', True),
            ('other_profile', '/other_account/', '<h1>other_account</h1><article><a href="/other_account/"><img alt="other_account\'s profile picture"></a></article>', False),
            ('signed_out', '/', '<nav><a href="/example_account/">Profile</a></nav><input type="password"><button>Log in</button>', False),
            ('ambiguous', '/', '<nav><a href="/example_account/">Profile</a><a href="/other_account/">Profile</a></nav>', False),
            ('foreign_avatar', '/', '<nav><a href="/other_account/"><img alt="other_account\'s profile picture"></a></nav>', False),
            ('global_edit_menu', '/other_account/', '<header><nav><a href="/accounts/edit/">Edit profile</a></nav></header><main><h1>other_account</h1></main>', False),
            ('identity_conflict', '/other_account/', '<nav><a href="/example_account/">Profile</a></nav><main><a href="/accounts/edit/">Edit profile</a></main>', False),
            ('expected_profile', '/', '<main><h1>Home</h1></main>', True),
            ('expected_profile_other_account', '/', '<main><h1>Home</h1></main>', False),
        ]
        current = {}
        def route(request_route):
            path = request_route.request.url.removeprefix('https://www.instagram.com')
            body = current['body']
            if current['name'] in ('avatar_en', 'avatar_cs', 'expected_profile') and path == '/example_account/':
                body += '<main><a href="/accounts/edit/">Edit profile</a></main>'
            request_route.fulfill(status=200, content_type='text/html; charset=utf-8', body='<!doctype html><body>' + body + '</body>')
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}), \
                patch('app.browser_instagram.IDENTITY_TIMEOUT', 0.4):
            runtime = _Chromium(Path(temp) / 'browser')
            try:
                runtime.context.unroute('**/*')
                runtime.context.route('**/*', route)
                for name, path, body, success in cases:
                    with self.subTest(name=name):
                        current.update(name=name, body=body)
                        runtime.page.goto('https://www.instagram.com' + path, wait_until='domcontentloaded')
                        expected = 'example_account' if name.startswith('expected_profile') else None
                        if success:
                            self.assertEqual(runtime.account(expected_username=expected)['username'], 'example_account')
                            self.assertTrue(runtime._same_account('example_account'))
                            self.assertFalse(runtime._same_account('other_account'))
                        else:
                            with self.assertRaises(BrowserInstagramError):
                                runtime.account(expected_username=expected)
            finally:
                runtime.close()

    def test_post_navigation_entry_supports_english_czech_and_icon_only_controls(self):
        current = {}
        def route(request_route):
            request_route.fulfill(status=200, content_type='text/html; charset=utf-8',
                                 body='<!doctype html><body>' + current['body'] + '</body>')
        entries = [
            '<a href="/create/select/" onclick="document.body.dataset.opened=1;return false">Post</a><button>Post</button>',
            '<nav><button onclick="document.body.dataset.opened=1">Příspěvek</button></nav>',
            '<div role="button" onclick="document.body.dataset.opened=1"><svg aria-label="Post" width="24" height="24"></svg></div>',
            '<div role="button" style="display:none"><svg aria-label="Post" width="24" height="24"></svg></div><div role="button" onclick="document.body.dataset.opened=1"><svg aria-label="Post" width="24" height="24"></svg></div>',
        ]
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}):
            runtime = _Chromium(Path(temp) / 'browser')
            try:
                runtime.context.unroute('**/*')
                runtime.context.route('**/*', route)
                for body in entries:
                    with self.subTest(body=body):
                        current['body'] = body
                        runtime.page.goto('https://www.instagram.com/', wait_until='domcontentloaded')
                        runtime._one(runtime._post_controls()).click()
                        self.assertEqual(runtime.page.locator('body').get_attribute('data-opened'), '1')
                current['body'] = '<div role="button"><svg aria-label="Post" width="24" height="24"></svg></div>' * 2
                runtime.page.goto('https://www.instagram.com/', wait_until='domcontentloaded')
                with self.assertRaises(BrowserNotSent):
                    runtime._one(runtime._post_controls())
                self.assertIsNone(runtime.page.locator('body').get_attribute('data-opened'))
            finally:
                runtime.close()

    def test_real_chromium_input_session_restore_crop_caption_and_single_share(self):
        # All network is fulfilled by this synthetic fixture. This never signs
        # into Instagram or reads the user's normal browser profile.
        from PIL import Image
        shares = []
        markers = []
        runtimes = []
        caption = 'Synthetic caption.\r\n\r\nSecond line.\r\n'
        def route(request_route):
            request = request_route.request
            if request.url == 'https://www.instagram.com/api/v1/media/configure/':
                self.assertEqual(markers, ['before_share'])
                data = request.post_data_json
                self.assertEqual(_normalized_caption(data['caption']), _normalized_caption(caption))
                self.assertEqual(data['crop'], 'original')
                self.assertEqual(data['next'], [0, 1])
                shares.append(request.method)
                request_route.fulfill(status=200, content_type='application/json', body=json.dumps(
                    {'status': 'ok', 'media': {'pk': '123456789', 'code': 'FixturePost',
                     'user': {'username': 'example_account'},
                      'caption': {'text': 'Synthetic caption.\n\nSecond line.'}}}))
            elif request.url == 'https://www.instagram.com/':
                request_route.fulfill(status=200, content_type='text/html; charset=utf-8', body=_FIXTURE)
            else:
                request_route.abort()
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}):
            state = State(Path(temp) / 'private')
            state.data.update(connection_method='browser', browser_session=False)
            def factory(profile):
                runtime = _Chromium(profile)
                runtime.context.unroute('**/*')
                runtime.context.route('**/*', route)
                runtimes.append(runtime)
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
                    browser.upload(image, caption, before_share=failed_marker)
                self.assertEqual(shares, [])
                def mark_share():
                    # The fixture has an independent input-event text model;
                    # it does not reuse the production DOM caption reader.
                    # Chromium emits insertText(null) for each pasted newline.
                    self.assertEqual(_normalized_caption(runtimes[-1].page.evaluate('window.fixtureCaption')),
                                     _normalized_caption(caption))
                    markers.append('before_share')
                receipt = browser.upload(image, caption, before_share=mark_share)
                self.assertEqual(receipt, {'id': '123456789', 'permalink': 'https://www.instagram.com/p/FixturePost/'})
                self.assertEqual(shares, ['POST'])
                self.assertEqual(markers, ['before_share'])
            finally:
                browser.shutdown()


if __name__ == '__main__':
    unittest.main()
