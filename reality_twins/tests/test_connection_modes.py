"""Publishing through direct login needs neither a media server nor OAuth."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from PIL import Image
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.instagram import InstagramError
from app.server import create_apps
from app.service import Service
from app.state import State


class ConnectionModesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.service = Service(self.root / 'DATA', self.root / 'PLANNED')
        self.network = patch('requests.sessions.Session.request', side_effect=AssertionError('Unexpected real network'))
        self.network.start()
        self.admin, self.public = create_apps(self.service)
        self.client = self.admin.test_client()
        self.headers = {'X-RT-Request': '1'}

    def tearDown(self):
        self.service.queue.close()
        self.network.stop()
        self.temp.cleanup()

    def direct_account(self):
        account = {'connected': True, 'id': '12345', 'username': 'test_account'}
        self.service.state.data.update(connection_method='direct', direct_session={'authorization_data': {'sessionid': 'PRIVATE_SESSION'}},
                                       account=account, schedule_source='internal')
        self.service.direct_instagram = Mock()
        self.service.direct_instagram.check.return_value = account
        return self.service.direct_instagram

    def add_image(self):
        folder = self.service.queue.queue_dir
        Image.new('RGB', (800, 1000), 'navy').save(folder / 'sample.png')
        (folder / 'sample.txt').write_text('Example caption.', encoding='utf-8')
        return self.service.queue.scan()[0]

    def test_new_install_defaults_direct_without_domain(self):
        settings = self.client.get('/api/state').get_json()['settings']
        self.assertEqual(settings['connection_method'], 'direct')
        self.assertFalse(settings['enabled'])
        self.assertEqual(settings['public_media_base_url'], '')

    def test_direct_can_enable_without_public_endpoint(self):
        direct = self.direct_account()
        self.service.verify_public_endpoint = Mock(side_effect=AssertionError('Direct login must not need HTTPS'))
        response = self.client.put('/api/settings', json={'enabled': True}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.service.state.data['enabled'])
        direct.check.assert_called_once()

    def test_enable_rejects_combined_settings_without_mutation(self):
        self.direct_account()
        before = json.dumps(self.service.state.data, sort_keys=True)
        response = self.client.put('/api/settings', json={'enabled': True, 'public_media_base_url': 'https://changed.example.com'}, headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.dumps(self.service.state.data, sort_keys=True), before)

    def test_calendar_removed_cannot_enable(self):
        self.direct_account()
        self.service.state.data.update(schedule_source='home_assistant', calendar_entity='calendar.removed')
        self.service.calendars = Mock(return_value=[{'entity_id': 'calendar.available'}])
        response = self.client.put('/api/settings', json={'enabled': True}, headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.service.state.data['enabled'])

    def test_direct_upload_uses_local_jpeg_and_archives_once(self):
        direct = self.direct_account()
        item = self.add_image()
        before = self.service.queue.image_path(item['id']).read_bytes()
        def upload(path, caption):
            attempt = self.service.queue.history()[0]
            self.assertEqual(attempt['state'], 'publishing')
            self.assertEqual(caption, 'Example caption.')
            with Image.open(path) as image:
                self.assertEqual(image.format, 'JPEG')
            return {'id': '45678', 'permalink': 'https://www.instagram.com/p/example/'}
        direct.upload.side_effect = upload
        self.service.instagram = Mock()
        self.service.instagram.request.side_effect = AssertionError('No official API in direct mode')
        attempt = self.service.queue.claim('first')
        self.service.publish(attempt)
        result = self.service.queue.get_attempt(attempt['attempt_id'])
        self.assertEqual(result['state'], 'published')
        self.assertEqual(result['media_id'], '45678')
        self.assertEqual(self.service.queue.image_path(item['id']).read_bytes(), before)
        self.assertEqual(list(self.service.media_dir.iterdir()), [])
        self.assertEqual(self.service.state.data['grants'], {})
        direct.upload.assert_called_once()

    def test_direct_upload_timeout_is_uncertain_and_not_repeated(self):
        direct = self.direct_account()
        self.add_image()
        direct.upload.side_effect = InstagramError('Publication was interrupted. Check the Instagram profile before retrying.')
        attempt = self.service.queue.claim('first')
        self.service.publish(attempt)
        self.assertEqual(self.service.queue.get_attempt(attempt['attempt_id'])['state'], 'uncertain')
        self.assertIsNone(self.service.queue.claim('second'))
        self.service.recover()
        direct.upload.assert_called_once()
        self.assertEqual(list(self.service.media_dir.iterdir()), [])

    def test_changing_connection_pauses_and_clears_verified_identity(self):
        self.direct_account()
        self.service.state.data.update(enabled=True, oauth_states={'old_nonce': 9999999999})
        self.service.state.update({'connection_method': 'official'})
        self.assertFalse(self.service.state.data['enabled'])
        self.assertFalse(self.service.state.data['account']['connected'])
        self.assertEqual(self.service.state.data['oauth_states'], {})

    def test_session_and_login_password_never_appear_in_state_response(self):
        direct = self.direct_account()
        direct.login.return_value = {'challenge': 'two_factor', 'message': 'Enter the verification code from Instagram.'}
        response = self.client.post('/api/account/login', json={'username': 'test_account', 'password': 'PRIVATE_PASSWORD'}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        direct.login.assert_called_once_with('test_account', 'PRIVATE_PASSWORD', '')
        state = self.client.get('/api/state').get_data(as_text=True)
        self.assertNotIn('PRIVATE_SESSION', state)
        self.assertNotIn('PRIVATE_PASSWORD', state)
        self.assertNotIn('direct_session', json.loads(state)['settings'])

    def test_old_config_keeps_official_connection_and_calendar(self):
        folder = self.root / 'LEGACY'
        folder.mkdir()
        (folder / 'settings.json').write_text(json.dumps({'access_token': 'OLD_TOKEN', 'calendar_entity': 'calendar.existing'}), encoding='utf-8')
        migrated = State(folder)
        self.assertEqual(migrated.data['connection_method'], 'official')
        self.assertEqual(migrated.data['calendar_entity'], 'calendar.existing')

    def test_calendar_404_is_empty_but_permission_failure_is_not(self):
        response = Mock(status_code=404)
        response.raise_for_status.side_effect = requests.HTTPError()
        with patch.dict('os.environ', {'SUPERVISOR_TOKEN': 'TEST_ONLY'}), patch('app.service.requests.get', return_value=response):
            self.assertEqual(self.service.calendars(), [])
            with self.assertRaisesRegex(ValueError, 'could not be read'):
                self.service.ha_get('calendars/calendar.removed')
            response.status_code = 403
            with self.assertRaisesRegex(ValueError, 'could not be read'):
                self.service.calendars()


if __name__ == '__main__':
    unittest.main()
