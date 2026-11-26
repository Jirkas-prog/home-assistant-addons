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
from app.browser_instagram import _story_receipt, _story_receipt_diagnostic, _story_response_shape, STORY_STEPS, STORY_UNCERTAIN, HOME
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
        self.upload_story = Mock(return_value={'id': '123456', 'permalink': 'https://www.instagram.com/stories/example_account/123456/'})
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
        self.assertEqual((result['mode'], result['width'], result['height']), ('mobile', 360, 640))
        self.runtime.set_mode.assert_called_once_with('mobile')
        self.browser.input({'type': 'click', 'x': 359, 'y': 639})
        self.runtime.tap.assert_called_once_with(359, 639)
        self.runtime.page.mouse.click.assert_not_called()
        for x, y in ((360, 200), (200, 640), (1099, 759)):
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

    def story_photo(self):
        from PIL import Image
        path = self.root / 'story.jpg'
        Image.new('RGB', (1080, 1920), 'navy').save(path)
        return path

    def test_story_uses_same_browser_with_explicit_feed_account_and_own_callback(self):
        self.connected()
        path, marker = self.story_photo(), Mock()
        result = self.browser.upload_story(path, expected_username='example_account', before_share=marker)
        self.assertEqual(result['permalink'], 'https://www.instagram.com/stories/example_account/123456/')
        self.runtime.upload_story.assert_called_once_with(path, 'example_account', before_share=marker)
        self.runtime.upload.assert_not_called()
        marker.assert_not_called()
        self.assertEqual(self.browser.status()['mode'], 'mobile')
        self.browser.check()
        self.assertEqual(self.browser.status()['mode'], 'desktop')

    def test_story_rejects_wrong_account_active_view_and_non_story_image_before_upload(self):
        self.connected()
        path = self.story_photo()
        with self.assertRaises(BrowserNotSent):
            self.browser.upload_story(path, expected_username='other_account')
        self.runtime.upload_story.assert_not_called()
        self.browser.start()
        with self.assertRaises(BrowserNotSent):
            self.browser.upload_story(path, expected_username='example_account')
        self.browser.close_view()
        self.runtime.account.return_value = {'connected': True, 'username': 'other_account'}
        with self.assertRaises(BrowserNotSent):
            self.browser.upload_story(path, expected_username='example_account')
        self.runtime.upload_story.assert_not_called()
        from PIL import Image
        Image.new('RGB', (1080, 1350), 'navy').save(path)
        with self.assertRaisesRegex(BrowserNotSent, '1080 by 1920'):
            self.browser.upload_story(path, expected_username='example_account')

    def test_story_failed_editor_keeps_mobile_view_and_never_retries_upload(self):
        self.connected()
        path = self.story_photo()
        self.runtime.upload_story.side_effect = BrowserNotSent(STORY_STEPS['story_share'])
        with self.assertRaises(BrowserNotSent):
            self.browser.upload_story(path, expected_username='example_account')
        self.runtime.resume_failed_editor.return_value = True
        self.runtime.home.reset_mock()
        self.browser.start()
        self.assertEqual(self.browser.status()['mode'], 'mobile')
        self.runtime.home.assert_not_called()
        self.runtime.upload_story.assert_called_once()

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
    def test_story_receipt_diagnostic_reports_only_whitelisted_schema_and_rejection_reason(self):
        body = {'status': 'ok', 'media': {'pk': '123456789', 'user': {'username': 'example_account'},
                                       'PRIVATE_KEY': 'PRIVATE_VALUE'}, 'PRIVATE_TOP_KEY': 'PRIVATE_TOKEN'}
        response = self.response(url='https://www.instagram.com/api/v1/media/configure_to_story/?secret=PRIVATE_QUERY', json=lambda: body)
        diagnostic = _story_receipt_diagnostic(response, 'example_account')
        self.assertEqual(diagnostic['reason'], 'accepted')
        self.assertEqual(diagnostic['kind'], 'story_api')
        output = json.dumps(diagnostic)
        for private in ('123456789', 'example_account', 'PRIVATE', 'https://'):
            self.assertNotIn(private, output)
        self.assertIn('"username": "string"', output)
        self.assertIn('"other_keys": 1', output)
        for changed, reason in (
            ({'status': 500}, 'http_status'),
            ({'json': lambda: {'status': 'fail'}}, 'status_not_ok'),
            ({'json': lambda: {'status': 'ok', 'media_id': '123'}}, 'media_missing'),
            ({'json': lambda: {'status': 'ok', 'media': {'pk': 'invalid'}}}, 'id_invalid'),
            ({'json': lambda: {'status': 'ok', 'media': {'pk': '123'}}}, 'owner_missing'),
            ({'json': lambda: {'status': 'ok', 'media': {'pk': '123', 'user': {'pk': '456'}}}}, 'username_missing'),
            ({'json': lambda: {'status': 'ok', 'media': {'pk': '123', 'user': {'username': 'other_account'}}}}, 'username_mismatch'),
            ({'json': Mock(side_effect=ValueError('PRIVATE_BODY'))}, 'json_unreadable'),
        ):
            args = {'url': response.url, 'json': lambda: body};args.update(changed)
            item = self.response(**args)
            self.assertEqual(_story_receipt_diagnostic(item, 'example_account')['reason'], reason)
            self.assertIsNone(_story_receipt(item, 'example_account'))
        unrelated = self.response(url='https://elsewhere.example/PRIVATE_PATH', json=Mock())
        self.assertIsNone(_story_receipt_diagnostic(unrelated, 'example_account'))
        unrelated.json.assert_not_called()
        self.assertIsNone(_story_receipt_diagnostic(self.response(request=SimpleNamespace(method='GET')), 'example_account'))

    def test_story_diagnostic_shape_is_bounded_without_unknown_key_or_value_leaks(self):
        payload = 'PRIVATE_VALUE'
        for _ in range(8):
            payload = {key: payload for key in ('media','user','owner','data','item','items','errors','status')}
            payload['PRIVATE_KEY'] = 'PRIVATE_TOKEN'
        shape = json.dumps(_story_response_shape(payload))
        self.assertLess(len(shape), 4000)
        self.assertNotIn('PRIVATE', shape)

    def test_story_receipt_accepts_only_story_configure_for_the_original_account(self):
        body = {'status': 'ok', 'media': {'pk': '123456789', 'media_product_type': 'story',
                                        'user': {'username': 'example_account'}}}
        for endpoint in ('/create/configure_to_story/', '/api/v1/media/configure_to_story/', '/api/v1/media/configure_to_story?example=1'):
            response = self.response(url='https://www.instagram.com' + endpoint, json=lambda: body)
            self.assertEqual(_story_receipt(response, 'example_account'), {
                'id': '123456789', 'permalink': 'https://www.instagram.com/stories/example_account/123456789/'})
            self.assertIsNone(_receipt(response))
            self.assertIsNone(_story_receipt(response, 'other_account'))
        self.assertIsNone(_story_receipt(self.response(json=lambda: body), 'example_account'))
        for changed in ({'status': 500}, {'request': SimpleNamespace(method='GET')},
                        {'url': 'https://elsewhere.example/create/configure_to_story/'},
                        {'json': lambda: {'status': 'fail', 'media': {'pk': '123'}}},
                        {'json': lambda: {'status': 'ok', 'media': {'pk': '123'}}},
                        {'json': lambda: {'status': 'ok', 'media': {'pk': 'not-an-id'}}},
                        {'json': lambda: {'status': 'ok', 'media': {'pk': '123', 'media_product_type': 'feed'}}}):
            args = {'url': 'https://www.instagram.com/create/configure_to_story/', 'json': lambda: body}
            args.update(changed)
            self.assertIsNone(_story_receipt(self.response(**args), 'example_account'))

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


_STORY_FIXTURE = r'''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media(max-width:500px){#desktop-nav{display:none}}body{margin:0}</style>
<nav id="desktop-nav"><a href="/example_account/" aria-label="Profile • example_account">Profile</a></nav>
<div id="mobile-nav" style="position:fixed;bottom:0;height:48px;width:100%;background:white">
 <a href="/example_account/" style="position:absolute;right:20px;bottom:10px"><img width="24" height="24" alt="Profile" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'/%3E"></a>
</div>
<div role="button" id="new-post" style="position:fixed;left:76%;top:8px;width:40px;height:40px" onclick="openMenu()">
 <div role="button"><svg width="32" height="32"><path d="M16 4v24M4 16h24"/></svg></div>
</div>
<button id="notifications" style="position:fixed;left:90%;top:8px;width:32px;height:32px;padding:0"
 onclick="window.wrongControl=true"><svg width="24" height="24"></svg></button>
<button id="feed-control" style="position:fixed;left:300px;top:200px;width:32px;height:32px;padding:0"
 onclick="window.wrongControl=true"><svg width="24" height="24"></svg></button>
<div id="app"><button style="position:absolute;top:90px">Your story</button></div>
<input type="file" id="avatar-input" hidden>
<input type="file" id="story-input" accept="image/jpeg" hidden onchange="setTimeout(preview,120)">
<script>
const failure=__FAILURE__;window.storyShares=0;
function openMenu(){setTimeout(()=>app.innerHTML='<div role="menu" style="position:fixed;top:50px;right:10px;background:white"><button>Post</button><div role="button" onclick="document.getElementById(\'story-input\').click()"><span>Story</span></div></div>',80)}
function preview(){
 const file=document.getElementById('story-input').files[0];
 window.fixturePhoto={size:file.size,name:file.name};
 document.getElementById('new-post').remove();document.getElementById('mobile-nav').style.display='none';
 document.getElementById('desktop-nav').style.display='none';
 history.pushState({},'',failure==='challenge'?'/challenge/check/':'/create/story/');
 if(screen.orientation.type!=='portrait-primary'||screen.orientation.angle!==0||window.orientation!==0||
    !matchMedia('(orientation: portrait)').matches){app.innerHTML='Rotate your device to add to your story.';return}
 let src=URL.createObjectURL(file);
 if(failure==='preview'){const canvas=document.createElement('canvas');canvas.width=canvas.height=100;src=canvas.toDataURL()}
 if(failure.startsWith('canvas')){
   app.innerHTML='';
   for(let i=0;i<3;i++){
     const canvas=document.createElement('canvas');canvas.width=failure==='canvas_shape'?1000:innerWidth*3;canvas.height=innerHeight*3;
     canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%';app.append(canvas);
   }
   if(['canvas_solid','canvas_delayed'].includes(failure)){
     const canvas=app.querySelector('canvas');canvas.getContext('2d').fillStyle='white';
     canvas.getContext('2d').fillRect(0,0,canvas.width,canvas.height);
   }
   if(!['canvas_blank','canvas_solid'].includes(failure)){
     const photo=new Image();photo.onload=()=>{
       const canvas=app.querySelector('canvas'), scale=Math.min(canvas.width/photo.width,canvas.height/photo.height);
       const draw=()=>{canvas.getContext('2d').drawImage(photo,(canvas.width-photo.width*scale)/2,(canvas.height-photo.height*scale)/2,photo.width*scale,photo.height*scale);window.fixturePhotoRendered=true};
       if(failure==='canvas_delayed')setTimeout(draw,350);else draw();
     };photo.src=src;
   }
   if(failure==='canvas_path')history.replaceState({},'', '/create/post/');
   if(failure==='canvas_cover')app.insertAdjacentHTML('beforeend','<div style="position:fixed;inset:0;z-index:99;background:white"></div>');
   if(failure==='canvas_cover_layer'){
     const canvas=app.querySelector('canvas:last-of-type');canvas.getContext('2d').fillStyle='white';
     canvas.getContext('2d').fillRect(0,0,canvas.width,canvas.height);
   }
 } else app.innerHTML='<img id="preview" style="position:fixed;top:0;width:100%;height:calc(100% - 64px);object-fit:contain" src="'+src+'">';
 if(failure!=='share')app.insertAdjacentHTML('beforeend','<div role="button" aria-label="Add to your story" style="position:fixed;bottom:8px;left:30px"><button id="story-share" style="width:150px;height:40px" onclick="share()">Add to your story</button></div>');
 if(failure==='ambiguous')app.insertAdjacentHTML('beforeend','<button style="position:fixed;bottom:8px;right:10px;width:120px;height:40px" onclick="share()">Share</button>');
 if(failure==='account')app.insertAdjacentHTML('beforeend','<nav style="position:fixed;bottom:60px"><a href="/other_account/" aria-label="Profile • other_account">Profile</a></nav>');
}
async function share(){
 window.storyShares++;
 if(window.fixtureNoise)for(let i=0;i<12;i++)await fetch('/graphql/query/?secret=PRIVATE_QUERY',{method:'POST',body:'PRIVATE_REQUEST'});
 await fetch('/api/v1/media/configure_to_story/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({upload_id:'123',photo:window.fixturePhoto,rendered:window.fixturePhotoRendered})});
}
</script>'''


@unittest.skipUnless(_TEST_BROWSER, 'A local Chromium executable is required for the isolated browser fixture.')
class ChromiumFixtureTests(unittest.TestCase):
    def test_story_viewport_preserves_round_subject_and_rejects_stretched_preview(self):
        import base64
        from io import BytesIO
        from PIL import Image, ImageDraw
        from app.browser_instagram import STORY_PREVIEW
        from app.story_cards import render_story
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}):
            root = Path(temp)
            source = root / 'post.png'
            photo = Image.new('RGB', (1080, 1350), 'black')
            ImageDraw.Draw(photo).ellipse((340, 475, 740, 875), fill='#00ff00')
            photo.save(source)
            card = render_story(source, root / 'story.jpg', {})
            data_url = 'data:image/jpeg;base64,' + base64.b64encode(card.read_bytes()).decode()
            runtime = _Chromium(root / 'profile')
            try:
                runtime.context.unroute('**/*')
                runtime.context.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'))
                runtime.set_mode('mobile')
                runtime.page.goto(HOME + 'create/story/')
                for size, accepted in [({'width':390, 'height':844}, False), ({'width':360, 'height':640}, True)]:
                    runtime.page.set_viewport_size(size)
                    runtime.page.evaluate('''async src => {
                      document.body.innerHTML='<canvas style="position:fixed;inset:0;width:100%;height:100%"></canvas>';
                      const canvas=document.querySelector('canvas');canvas.width=innerWidth*3;canvas.height=innerHeight*3;
                      const photo=new Image();photo.src=src;await photo.decode();
                      canvas.getContext('2d').drawImage(photo,0,0,canvas.width,canvas.height);
                    }''', data_url)
                    self.assertEqual(runtime.page.evaluate(STORY_PREVIEW), accepted)
                    png = runtime.page.evaluate("document.querySelector('canvas').toDataURL().split(',')[1]")
                    with Image.open(BytesIO(base64.b64decode(png))) as rendered:
                        mask = Image.new('1', rendered.size)
                        mask.putdata([g > 180 and r < 40 and b < 40 for r, g, b, *a in rendered.getdata()])
                        left, top, right, bottom = mask.getbbox()
                        if accepted:
                            self.assertLessEqual(abs((right-left) - (bottom-top)), 2)
                        else:
                            self.assertGreater(abs((right-left) - (bottom-top)), 50)
                # Correct natural dimensions must not hide CSS stretching.
                runtime.page.evaluate('''async src => {
                  document.body.innerHTML='<img style="position:fixed;inset:0;width:100%;height:90%;object-fit:fill">';
                  const img=document.querySelector('img');img.src=src;await img.decode();
                }''', data_url)
                self.assertFalse(runtime.page.evaluate(STORY_PREVIEW))
                runtime.page.locator('img').evaluate("img => img.style.objectFit='contain'")
                self.assertTrue(runtime.page.evaluate(STORY_PREVIEW))
            finally:
                runtime.close()

    def test_story_mobile_menu_chooser_preview_callback_and_single_share(self):
        from PIL import Image, ImageDraw
        events = []
        def route(request_route):
            request = request_route.request
            if '/graphql/query/' in request.url:
                request_route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': {'PRIVATE_KEY':'PRIVATE_VALUE'}}))
            elif request.url == 'https://www.instagram.com/api/v1/media/configure_to_story/':
                self.assertEqual(events, ['marker'])
                self.assertEqual(request.post_data_json['photo']['name'], 'story.jpg')
                self.assertTrue(request.post_data_json['rendered'])
                events.append('share')
                request_route.fulfill(status=200, content_type='application/json', body=json.dumps({
                    'status': 'ok', 'media': {'pk': '987654321', 'media_product_type': 'story',
                                            'user': {'username': 'example_account'}}}))
            else:
                self.assertEqual(request.method, 'GET')
                request_route.fulfill(status=200, content_type='text/html', body=_STORY_FIXTURE.replace('__FAILURE__', '"canvas_delayed"').replace('window.storyShares=0;', 'window.storyShares=0;window.fixtureNoise=true;'))
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}):
            state = State(Path(temp) / 'private')
            state.data.update(connection_method='browser', browser_session=True,
                              account={'connected': True, 'username': 'example_account'})
            def factory(profile):
                runtime = _Chromium(profile)
                runtime.context.unroute('**/*');runtime.context.route('**/*', route)
                runtime.upload = Mock(side_effect=AssertionError('A Story must never publish feed'))
                return runtime
            browser = BrowserInstagram(state, runtime_factory=factory)
            path = Path(temp) / 'story.jpg'
            photo = Image.new('RGB', (1080,1920), 'navy')
            ImageDraw.Draw(photo).rectangle((200,500,880,1400), fill='orange')
            photo.save(path)
            try:
                with self.assertRaises(BrowserNotSent):
                    browser.upload_story(path, expected_username='example_account', before_share=lambda: (_ for _ in ()).throw(RuntimeError()))
                self.assertEqual(events, [])
                self.assertEqual(browser.start()['mode'], 'mobile')
                self.assertTrue(browser.status()['url'].endswith('/create/story/'))
                self.assertTrue(browser.frame().startswith(b'\xff\xd8'))
                browser.close_view()
                with self.assertLogs('app.browser_instagram', level='INFO') as logged:
                    result = browser.upload_story(path, expected_username='example_account', before_share=lambda: events.append('marker'))
                details = json.loads(logged.output[-1].split('receipt diagnostics: ', 1)[1])
                self.assertEqual(details['responses'], {'graphql':12, 'story_api':1})
                self.assertEqual(len(details['samples']), 3)
                self.assertEqual(details['samples'][-1]['reason'], 'accepted')
                self.assertNotIn('PRIVATE', logged.output[-1])
                self.assertNotIn('example_account', logged.output[-1])
                self.assertEqual(result, {'id':'987654321','permalink':'https://www.instagram.com/stories/example_account/987654321/'})
                self.assertEqual(events, ['marker','share'])
                self.assertEqual(browser._call(lambda: browser._runtime.page.evaluate('window.storyShares')), 1)
                self.assertEqual(browser._call(lambda: browser._runtime.page.locator('#app canvas').count()), 3)
                self.assertIsNone(browser._call(lambda: browser._runtime.page.evaluate('window.wrongControl')))
                browser.check()
                self.assertEqual(browser.status()['mode'], 'desktop')
                browser._runtime.upload.assert_not_called()
            finally:
                browser.shutdown()

    def test_story_header_fallback_rejects_duplicate_and_covered_icons(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}), \
             patch('app.browser_instagram.COMPOSER_TIMEOUT', .3):
            runtime = _Chromium(Path(temp) / 'profile')
            try:
                runtime.set_mode('mobile')
                fixture = _STORY_FIXTURE.replace('__FAILURE__', '""')
                runtime.page.set_content(fixture)
                self.assertEqual(runtime._story_create_control().evaluate('element => element.parentElement.id'), 'new-post')
                # Responsive hidden copies and feed/notification icons are not candidates.
                runtime.page.locator('#new-post').evaluate("element => {const copy=element.cloneNode(true);copy.hidden=true;document.body.append(copy)}")
                self.assertEqual(tuple(map(len, runtime._story_header_controls())), (1, 1))
                runtime.page.locator('#new-post').first.evaluate("element => {const copy=element.cloneNode(true);copy.style.left='274px';document.body.append(copy)}")
                with self.assertRaisesRegex(BrowserNotSent, STORY_STEPS['story_menu']):
                    runtime._story_create_control()
                runtime.page.set_content(fixture)
                runtime.page.locator('#new-post svg').evaluate('element => element.after(element.cloneNode(true))')
                with self.assertRaisesRegex(BrowserNotSent, STORY_STEPS['story_menu']):
                    runtime._story_create_control()
                runtime.page.set_content(fixture + '<div style="position:fixed;inset:0;z-index:99;background:white"></div>')
                self.assertEqual(tuple(map(len, runtime._story_header_controls())), (1, 0))
                with self.assertRaisesRegex(BrowserNotSent, STORY_STEPS['story_menu']):
                    runtime._story_create_control()
                with self.assertLogs('app.browser_instagram', level='WARNING') as logged:
                    runtime._diagnose_story('story_menu', BrowserNotSent('private detail'))
                self.assertIn('"header_controls": 0', logged.output[0])
                self.assertIn('"header_svg": 1', logged.output[0])
                self.assertNotIn('private detail', logged.output[0])
                self.assertIsNone(runtime.page.evaluate('window.wrongControl'))
            finally:
                runtime.close()

    def test_story_preview_identity_ambiguity_and_uncertain_receipt_stop_without_retry(self):
        from io import StringIO
        import logging
        from PIL import Image, ImageDraw
        scenario = {'failure': ''}
        sent = []
        def route(request_route):
            if request_route.request.method == 'POST':
                sent.append(request_route.request.url)
                request_route.fulfill(status=200, content_type='application/json', body=json.dumps({
                    'status':'ok','media':{'pk':'123','user':{'username':'other_account'}}}))
            else:
                request_route.fulfill(status=200, content_type='text/html', body=_STORY_FIXTURE.replace('__FAILURE__', json.dumps(scenario['failure'])))
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RT_CHROMIUM_EXECUTABLE': _TEST_BROWSER}), \
             patch('app.browser_instagram.COMPOSER_TIMEOUT', .6), patch('app.browser_instagram.STORY_RECEIPT_TIMEOUT', .3):
            runtime = _Chromium(Path(temp) / 'profile')
            path = Path(temp) / 'story.jpg'
            photo = Image.new('RGB', (1080,1920), 'navy')
            ImageDraw.Draw(photo).rectangle((200,500,880,1400), fill='orange')
            photo.save(path)
            try:
                runtime.context.unroute('**/*');runtime.context.route('**/*', route)
                runtime.set_mode('mobile')
                original_share_control = runtime._story_share_control
                def select_share():
                    control = original_share_control()
                    if scenario['failure'] == 'canvas_removed':
                        runtime.page.locator('#app canvas').evaluate_all('nodes => nodes.forEach(node => node.getContext("2d").clearRect(0,0,node.width,node.height))')
                    return control
                runtime._story_share_control = select_share
                for failure, stage in [('preview','story_preview'),('canvas_blank','story_preview'),('canvas_solid','story_preview'),('canvas_path','story_preview'),
                                       ('canvas_shape','story_preview'),('canvas_cover','story_preview'),('canvas_cover_layer','story_preview'),('canvas_removed','story_preview'),
                                       ('share','story_share'),('ambiguous','story_share'),('account','story_account'),('challenge','story_account')]:
                    with self.subTest(failure=failure):
                        scenario['failure']=failure;runtime.home();marker=Mock()
                        with self.assertLogs('app.browser_instagram', level='WARNING') as logged:
                            with self.assertRaisesRegex(BrowserNotSent, STORY_STEPS[stage]):
                                runtime.upload_story(path,'example_account',before_share=marker)
                        if stage == 'story_preview':
                            self.assertIn('"orientation": "portrait-primary"', logged.output[0])
                            self.assertIn('"natural_height": ' + ('1920' if failure.startswith('canvas') else '100'), logged.output[0])
                            self.assertIn('"scheme": "' + ('other' if failure.startswith('canvas') else 'data') + '"', logged.output[0])
                            self.assertNotIn('example_account', logged.output[0])
                            self.assertNotIn('data:image/', logged.output[0])
                        marker.assert_not_called()
                        self.assertEqual(sent,[])
                        self.assertEqual(runtime.resume_failed_editor(), stage != 'story_account')
                scenario['failure']='';runtime.home();marker=Mock()
                log = logging.getLogger('app.browser_instagram')
                output = StringIO()
                handler = logging.StreamHandler(output)
                log.addHandler(handler)
                try:
                    with patch.object(log, 'level', logging.NOTSET), patch.object(logging.getLogger(), 'level', logging.WARNING):
                        self.assertEqual(log.getEffectiveLevel(), logging.WARNING)
                        with self.assertRaisesRegex(BrowserInstagramError, STORY_UNCERTAIN):
                            runtime.upload_story(path,'example_account',before_share=marker)
                finally:
                    log.removeHandler(handler)
                self.assertIn('Instagram Story receipt diagnostics:', output.getvalue())
                self.assertIn('"reason": "username_mismatch"', output.getvalue())
                self.assertNotIn('other_account', output.getvalue())
                marker.assert_called_once()
                self.assertEqual(sent,['https://www.instagram.com/api/v1/media/configure_to_story/'])
                self.assertFalse(runtime.resume_failed_editor())
            finally:
                runtime.close()

    def test_mobile_emulation_keeps_private_session_dimensions_input_and_desktop_restore(self):
        from io import BytesIO
        from PIL import Image
        fixture = '''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <nav><a href="/example_account/" aria-label="Profile • example_account">Profile</a></nav>
        <button style="position:fixed;left:290px;top:580px;width:60px;height:40px"
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
                  orientation:screen.orientation.type,angle:screen.orientation.angle,legacyAngle:window.orientation ?? null,
                  portrait:matchMedia('(orientation: portrait)').matches,
                  session:localStorage.getItem('fixture_session'),clicked:localStorage.getItem('fixture_clicked')})''')
            try:
                browser.start()
                baseline = browser._call(snapshot)
                browser._call(lambda: browser._runtime.page.evaluate("localStorage.setItem('fixture_session','synthetic')"))
                browser.set_mode('mobile')
                mobile = browser._call(snapshot)
                self.assertEqual((mobile['width'], mobile['height']), (360, 640))
                self.assertIn('Mobile', mobile['ua'])
                self.assertEqual(mobile['touch'], 1)
                self.assertEqual((mobile['orientation'], mobile['angle'], mobile['legacyAngle']), ('portrait-primary', 0, 0))
                self.assertTrue(mobile['portrait'])
                self.assertEqual(mobile['session'], 'synthetic')
                self.assertEqual(Image.open(BytesIO(browser.frame())).size, (360, 640))
                browser.input({'type': 'click', 'x': 320, 'y': 600})
                self.assertEqual(browser._call(snapshot)['clicked'], 'yes')
                self.assertEqual(browser.finish()['username'], 'example_account')
                restored = browser._call(snapshot)
                self.assertEqual((restored['width'], restored['height']), (1100, 760))
                self.assertEqual(restored['ua'], baseline['ua'])
                self.assertEqual(restored['touch'], baseline['touch'])
                self.assertEqual((restored['orientation'], restored['angle']), ('landscape-primary', 0))
                self.assertIn(restored['legacyAngle'], (None, 0))
                self.assertFalse(restored['portrait'])
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
