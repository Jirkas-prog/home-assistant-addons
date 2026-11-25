"""Browser credentials remain in the app-owned profile behind the admin guard."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.instagram import InstagramError
from app.browser_instagram import BrowserNotSent
from app.server import create_apps
from app.service import Service
from app.state import State


class BrowserRoutesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.service = Service(self.root / 'DATA', self.root / 'PLANNED')
        self.original_browser = self.service.browser_instagram
        self.browser = self.service.browser_instagram = Mock()
        self.browser.status.return_value = {'active': True, 'connected': False}
        self.browser.start.return_value = self.browser.status.return_value
        self.browser.input.return_value = self.browser.status.return_value
        self.browser.close_view.return_value = {'active': False}
        self.browser.frame.return_value = b'image'
        self.account = {'connected': True, 'username': 'example_account', 'id': 'browser:example_account'}
        self.browser.finish.return_value = self.account
        self.browser.check.return_value = self.account
        self.admin, self.public = create_apps(self.service, ingress=True)
        self.client = self.admin.test_client()
        self.source = {'REMOTE_ADDR': '172.30.32.2'}
        self.headers = {'X-RT-Request': '1'}

    def tearDown(self):
        self.original_browser.shutdown()
        self.service.queue.close()
        self.temp.cleanup()

    def test_browser_routes_are_admin_only_and_mutations_require_csrf(self):
        for route in ('start', 'input', 'finish', 'close'):
            url = '/api/browser/' + route
            self.assertEqual(self.public.test_client().post(url).status_code, 404)
            self.assertEqual(self.client.post(url, headers=self.headers).status_code, 403)
            self.assertEqual(self.client.post(url, environ_overrides=self.source).status_code, 403)
            self.assertEqual(self.client.post(url, environ_overrides=self.source,
                                             headers=self.headers | {'Sec-Fetch-Site': 'cross-site'}).status_code, 403)
        for route in ('status', 'frame'):
            self.assertEqual(self.public.test_client().get('/api/browser/' + route).status_code, 404)
            self.assertEqual(self.client.get('/api/browser/' + route).status_code, 403)
        self.browser.start.assert_not_called()
        self.browser.input.assert_not_called()

    def test_real_view_actions_delegate_without_echoing_typed_secrets(self):
        for route, data in (('start', {}), ('input', {'type': 'text', 'text': 'PRIVATE_PASSWORD'}),
                            ('finish', {}), ('close', {})):
            response = self.client.post('/api/browser/' + route, json=data,
                                        headers=self.headers, environ_overrides=self.source)
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertNotIn('PRIVATE_PASSWORD', response.get_data(as_text=True))
        self.browser.input.assert_called_once_with({'type': 'text', 'text': 'PRIVATE_PASSWORD'})
        self.browser.finish.assert_called_once()
        response = self.client.get('/api/browser/frame', environ_overrides=self.source)
        self.assertEqual(response.mimetype, 'image/jpeg')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_browser_actions_reject_wrong_connection_method(self):
        self.service.state.data['connection_method'] = 'official'
        response = self.client.post('/api/browser/start', json={}, headers=self.headers,
                                    environ_overrides=self.source)
        self.assertEqual(response.status_code, 400)
        self.browser.start.assert_not_called()

    def test_input_size_limited_without_forwarding_to_browser(self):
        response = self.client.post('/api/browser/input', json={'type': 'text', 'text': 'x' * 9000},
                                    headers=self.headers, environ_overrides=self.source)
        self.assertEqual(response.status_code, 413)
        self.browser.input.assert_not_called()

    def test_failed_direct_config_migrates_but_preserves_calendar_and_queue(self):
        folder = self.root / 'MIGRATION'
        folder.mkdir()
        saved = {'connection_method': 'direct', 'direct_session': {}, 'account': {'connected': False},
                 'calendar_entity': 'calendar.existing', 'schedule_source': 'home_assistant'}
        (folder / 'settings.json').write_text(json.dumps(saved), encoding='utf-8')
        state = State(folder)
        self.assertEqual(state.data['connection_method'], 'browser')
        self.assertEqual(state.data['calendar_entity'], 'calendar.existing')
        self.assertFalse(state.data['enabled'])
        self.assertFalse(state.data['import_enabled'])

    def test_working_direct_session_is_not_migrated(self):
        folder = self.root / 'WORKING'
        folder.mkdir()
        saved = {'connection_method': 'direct', 'direct_session': {'test': 'session'},
                 'account': {'connected': True}, 'enabled': True}
        (folder / 'settings.json').write_text(json.dumps(saved), encoding='utf-8')
        state = State(folder)
        self.assertEqual(state.data['connection_method'], 'direct')
        self.assertTrue(state.data['enabled'])

    def prepare_publication(self):
        self.service.state.data.update(browser_session=True, account=self.account, schedule_source='internal')
        folder = self.service.queue.queue_dir
        Image.new('RGB', (320, 400), 'navy').save(folder / 'sample.jpg')
        (folder / 'sample.txt').write_text('Exact caption.', encoding='utf-8')
        self.service.queue.scan()
        return self.service.queue.claim('test-slot')

    def test_browser_publication_uses_no_mobile_client_or_public_media(self):
        attempt = self.prepare_publication()
        self.service.direct_instagram = Mock()
        self.service.instagram = Mock()
        self.browser.upload.return_value = {'id': '123', 'permalink': 'https://www.instagram.com/p/example/'}
        self.service.publish(attempt)
        self.assertEqual(self.service.queue.get_attempt(attempt['attempt_id'])['state'], 'published')
        self.browser.upload.assert_called_once()
        self.service.direct_instagram.upload.assert_not_called()
        self.service.instagram.request.assert_not_called()
        self.assertEqual(self.service.state.data['grants'], {})

    def test_browser_uncertain_receipt_blocks_automatic_retry(self):
        attempt = self.prepare_publication()
        def uncertain(path, caption, before_share):
            before_share()
            raise InstagramError('Instagram did not confirm the uploaded post. Check your profile before retrying.')
        self.browser.upload.side_effect = uncertain
        self.service.publish(attempt)
        self.assertEqual(self.service.queue.get_attempt(attempt['attempt_id'])['state'], 'uncertain')
        self.assertIsNone(self.service.queue.claim('later-slot'))
        self.service.recover()
        self.browser.upload.assert_called_once()

    def test_known_failure_before_share_can_be_retried_after_fixing(self):
        attempt = self.prepare_publication()
        self.browser.upload.side_effect = BrowserNotSent('The Instagram post editor changed or could not be opened. No post was sent.')
        self.service.publish(attempt)
        self.assertEqual(self.service.queue.get_attempt(attempt['attempt_id'])['state'], 'error')
        self.service.queue.retry(attempt['item_id'])
        self.assertIsNotNone(self.service.queue.claim('later-slot'))


if __name__ == '__main__':
    unittest.main()
