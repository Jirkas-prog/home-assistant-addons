"""An explicit extra post must not consume a calendar slot or a second head."""
from datetime import datetime, timedelta, timezone
import copy
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
import uuid

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.browser_instagram import BrowserInstagramError, BrowserNotSent
from app.queue_store import QueueConflict
from app.server import create_apps
from app.service import Service


class ManualPublishTests(unittest.TestCase):
    def setUp(self):
        self.network = patch('requests.sessions.Session.request', side_effect=AssertionError('No live network in tests'))
        self.network.start()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sent = []
        self.service = Service(self.root / 'DATA', self.root / 'PLANNED')
        self.account = {'connected': True, 'id': 'browser:example_account', 'username': 'example_account',
                        'connection_method': 'browser'}
        self.service.state.data.update(connection_method='browser', browser_session=True, account=dict(self.account),
                                       enabled=False, calendar_entity='calendar.example_calendar', schedule_source='home_assistant')
        self.service.state.save()
        self.attach_mocks()

    def attach_mocks(self):
        self.service.browser_instagram.check = Mock(return_value=dict(self.account))
        self.service.browser_instagram.upload = Mock(side_effect=self.upload)
        self.service.browser_instagram.upload_story = Mock(side_effect=lambda image, expected_username, before_share: (
            before_share(), {'id': '2001', 'permalink': 'https://www.instagram.com/stories/example_account/2001/'})[1])
        self.service.ha_get = Mock(side_effect=AssertionError('Manual publishing must not consult or edit the calendar'))
        self.admin, self.public = create_apps(self.service)
        self.client = self.admin.test_client()

    def tearDown(self):
        self.service.browser_instagram.shutdown()
        self.service.queue.close()
        self.temp.cleanup()
        self.network.stop()

    def upload(self, image, caption, before_share):
        before_share()
        self.sent.append(caption)
        return {'id': str(1000 + len(self.sent)), 'permalink': 'https://www.instagram.com/p/ExamplePost/'}

    def add(self, name='first.jpg', caption='First prepared caption'):
        Image.new('RGB', (320, 400), (20, 80, 140)).save(self.service.queue.queue_dir / name)
        (self.service.queue.queue_dir / Path(name).with_suffix('.txt')).write_text(caption, encoding='utf-8')
        return self.service.queue.scan()[-1]

    def request_data(self, item, request_id=None):
        return {'expected_post_id': item['id'], 'request_id': request_id or str(uuid.uuid4())}

    def post(self, data, client=None):
        return (client or self.client).post('/api/publish-next', json=data, headers={'X-RT-Request': '1'})

    def test_paused_manual_post_uses_real_pipeline_and_preserves_settings_and_calendar(self):
        first = self.add()
        self.add('second.jpg', 'Second prepared caption')
        before = copy.deepcopy(self.service.state.data)
        calendar = [{'key': 'ha-future-example', 'at': '2030-01-01T06:00:00+00:00'}]
        self.service.calendar_slots = copy.deepcopy(calendar)
        data = self.request_data(first)
        response = self.post(data)
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()
        self.assertTrue(result['ok'])
        self.assertFalse(result['replayed'])
        self.assertEqual(result['attempt']['event_key'], 'manual:' + data['request_id'])
        self.assertEqual(result['attempt']['state'], 'published')
        self.assertEqual(self.sent, ['First prepared caption'])
        self.assertEqual(self.service.state.data, before)
        self.assertEqual(self.service.calendar_slots, calendar)
        self.assertEqual(self.service.queue.list_items()[0]['filename'], '0001__second.jpg')
        archive = self.service.queue.image_path(first['id'])
        self.assertEqual(archive.parent.parent, self.service.queue.archive_dir)
        self.assertEqual(archive.with_suffix('.txt').read_text('utf-8'), 'First prepared caption')
        self.service.ha_get.assert_not_called()

    def test_manual_post_works_without_calendar_and_does_not_enable_automation(self):
        first = self.add()
        self.service.state.data['calendar_entity'] = ''
        self.service.state.save()
        self.assertTrue(self.post(self.request_data(first)).get_json()['ok'])
        self.assertFalse(self.service.state.data['enabled'])
        self.assertEqual(self.service.state.data['calendar_entity'], '')

    def test_manual_extra_post_does_not_consume_next_scheduled_event(self):
        first = self.add()
        self.add('second.jpg', 'Second scheduled caption')
        self.service.state.data['enabled'] = True
        self.service.state.save()
        response = self.post(self.request_data(first))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.service.state.data['enabled'])
        scheduled = self.service.queue.claim('ha-future-example')
        self.assertIsNotNone(scheduled)
        self.service.publish(scheduled)
        self.assertEqual(self.sent, ['First prepared caption', 'Second scheduled caption'])
        self.assertIsNone(self.service.queue.claim('ha-future-example'))

    def test_same_request_returns_original_receipt_after_publication_and_restart(self):
        first = self.add()
        second = self.add('second.jpg', 'Second caption')
        data = self.request_data(first)
        original = self.post(data).get_json()
        repeated = self.post(data).get_json()
        self.assertTrue(repeated['replayed'])
        self.assertEqual(repeated['attempt']['attempt_id'], original['attempt']['attempt_id'])
        self.service.browser_instagram.shutdown()
        self.service.queue.close()
        self.service = Service(self.root / 'DATA', self.root / 'PLANNED')
        self.attach_mocks()
        repeated = self.post(data).get_json()
        self.assertTrue(repeated['replayed'])
        self.assertTrue(repeated['ok'])
        self.assertEqual(self.sent, ['First prepared caption'])
        self.assertEqual(self.service.queue.list_items()[0]['id'], second['id'])
        self.service.browser_instagram.upload.assert_not_called()

    def test_request_key_cannot_be_rebound_to_a_different_post(self):
        first = self.add()
        second = self.add('second.jpg', 'Second caption')
        data = self.request_data(first)
        self.post(data)
        response = self.post(data | {'expected_post_id': second['id']})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.sent, ['First prepared caption'])

    def test_stale_preview_after_reordering_never_publishes_new_head(self):
        first = self.add()
        second = self.add('second.jpg')
        self.service.queue.reorder([second['id'], first['id']])
        response = self.post(self.request_data(first))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.sent, [])
        self.assertEqual(self.service.queue.history(), [])

    def test_expected_head_is_checked_inside_atomic_claim(self):
        first = self.add()
        second = self.add('second.jpg')
        claim = self.service.queue.claim
        def reordered_before_claim(event_key, expected_item_id=None, **kwargs):
            self.service.queue.reorder([second['id'], first['id']])
            return claim(event_key, expected_item_id=expected_item_id, **kwargs)
        with patch.object(self.service.queue, 'claim', side_effect=reordered_before_claim):
            response = self.post(self.request_data(first))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.sent, [])
        self.assertEqual(self.service.queue.history(), [])

    def test_empty_queue_and_unready_head_are_not_skipped(self):
        response = self.post({'expected_post_id': 'a' * 32, 'request_id': 'empty-queue-request'})
        self.assertEqual(response.status_code, 409)
        first = self.add()
        self.add('second.jpg')
        previous = self.service.queue.claim('ha-error-before-send')
        self.service.queue.fail(previous['attempt_id'], 'Synthetic preflight failure')
        response = self.post(self.request_data(first))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.sent, [])

    def test_reordering_does_not_bypass_an_uncertain_publication_elsewhere(self):
        first = self.add()
        second = self.add('second.jpg')
        previous = self.service.queue.claim('ha-uncertain')
        self.service.queue.update_attempt(previous['attempt_id'], state='publishing')
        self.service.queue.fail(previous['attempt_id'], 'Synthetic uncertain result', uncertain=True)
        self.service.queue.reorder([second['id'], first['id']])
        response = self.post(self.request_data(second))
        self.assertEqual(response.status_code, 409)
        self.assertIn('History', response.get_json()['error'])
        self.assertEqual(self.sent, [])

    def test_active_browser_lease_and_disconnected_account_block_before_claim(self):
        first = self.add()
        with patch.object(self.service.browser_instagram, 'status', return_value={'active': True, 'busy': False}):
            self.assertEqual(self.post(self.request_data(first)).status_code, 409)
        self.service.state.data['account']['connected'] = False
        self.assertEqual(self.post(self.request_data(first)).status_code, 409)
        self.assertEqual(self.service.queue.history(), [])
        self.service.browser_instagram.check.assert_not_called()
        self.service.browser_instagram.upload.assert_not_called()

    def test_file_integrity_is_checked_before_manual_publication(self):
        first = self.add()
        (self.service.queue.queue_dir / first['filename']).write_bytes(b'Changed image')
        response = self.post(self.request_data(first))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.sent, [])
        self.assertEqual(self.service.queue.history(), [])
        self.assertEqual(self.service.queue.get(first['id'])['status'], 'error')

    def test_pre_share_failure_is_retryable_but_reusing_request_never_retries(self):
        first = self.add()
        data = self.request_data(first)
        self.service.state.data['enabled'] = True
        self.service.state.save()
        before = copy.deepcopy(self.service.state.data)
        calendar = [{'key': 'ha-future-example', 'at': '2030-01-01T06:00:00+00:00'}]
        self.service.calendar_slots = copy.deepcopy(calendar)
        self.service.browser_instagram.upload.side_effect = BrowserNotSent('No post was sent.')
        response = self.post(data)
        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        self.assertFalse(result['ok'])
        self.assertEqual(result['attempt']['state'], 'error')
        self.assertIsNone(result['attempt']['publish_started_at'])
        self.assertIn('error_cs', result['attempt'])
        self.assertEqual(self.service.state.data, before)
        self.assertEqual(self.service.calendar_slots, calendar)
        self.service.ha_get.assert_not_called()
        self.service.queue.retry(first['id'])
        self.assertTrue(self.post(data).get_json()['replayed'])
        self.service.browser_instagram.upload.assert_called_once()
        self.service.browser_instagram.upload.side_effect = self.upload
        self.assertTrue(self.post(self.request_data(first)).get_json()['ok'])
        self.assertEqual(len(self.sent), 1)

    def test_share_timeout_returns_uncertain_and_is_never_retried(self):
        first = self.add()
        self.add('second.jpg')
        data = self.request_data(first)
        def uncertain(image, caption, before_share):
            before_share()
            self.sent.append(caption)
            raise BrowserInstagramError('Instagram did not confirm the uploaded post. Check your profile before retrying.')
        self.service.browser_instagram.upload.side_effect = uncertain
        result = self.post(data).get_json()
        self.assertFalse(result['ok'])
        self.assertEqual(result['attempt']['state'], 'uncertain')
        self.assertTrue(self.post(data).get_json()['replayed'])
        self.assertEqual(self.post(self.request_data(first)).status_code, 409)
        self.assertEqual(self.sent, ['First prepared caption'])
        with self.assertRaises(QueueConflict):
            self.service.queue.retry(first['id'])

    def test_simultaneous_requests_return_receipt_or_busy_without_consuming_two_posts(self):
        first = self.add()
        second = self.add('second.jpg', 'Second caption')
        data = self.request_data(first)
        entered, release = threading.Event(), threading.Event()
        results = []
        def blocked_upload(image, caption, before_share):
            before_share()
            entered.set()
            if not release.wait(10):
                raise AssertionError('The test did not release the upload')
            self.sent.append(caption)
            return {'id': '1001', 'permalink': 'https://www.instagram.com/p/ExamplePost/'}
        self.service.browser_instagram.upload.side_effect = blocked_upload
        thread = threading.Thread(target=lambda: results.append(self.post(data, self.admin.test_client()).get_json()))
        thread.start()
        try:
            self.assertTrue(entered.wait(5))
            repeated = self.post(data)
            self.assertEqual(repeated.status_code, 200)
            self.assertTrue(repeated.get_json()['replayed'])
            self.assertEqual(repeated.get_json()['attempt']['state'], 'publishing')
            self.assertEqual(self.post(self.request_data(first)).status_code, 409)
            self.assertEqual(self.post(self.request_data(second)).status_code, 409)
        finally:
            release.set()
            thread.join(10)
        self.assertFalse(thread.is_alive())
        self.assertEqual(len(results), 1)
        self.assertTrue(results[0]['ok'])
        self.assertEqual(self.sent, ['First prepared caption'])
        self.assertEqual(self.service.queue.list_items()[0]['id'], second['id'])

    def test_manual_request_does_not_wait_behind_another_account_operation(self):
        first = self.add()
        acquired, release = threading.Event(), threading.Event()
        def account_operation():
            with self.service.connection_guard:
                acquired.set()
                release.wait(10)
        thread = threading.Thread(target=account_operation)
        thread.start()
        try:
            self.assertTrue(acquired.wait(5))
            self.assertEqual(self.post(self.request_data(first)).status_code, 409)
            self.assertEqual(self.service.queue.history(), [])
        finally:
            release.set()
            thread.join(10)
        self.assertEqual(self.sent, [])

    def test_malformed_requests_cannot_claim_or_publish(self):
        first = self.add()
        valid = self.request_data(first)
        for body in (None, [], {}, valid | {'extra': True}, valid | {'request_id': 'short'},
                     valid | {'request_id': 'bad!value' * 4}, valid | {'expected_post_id': 'missing'},
                     valid | {'expected_post_id': 123}, valid | {'request_id': 'a' * 81}):
            with self.subTest(body=body):
                response = self.client.post('/api/publish-next', json=body if body is not None else 'invalid',
                                            headers={'X-RT-Request': '1'})
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.service.queue.history(), [])
        self.assertEqual(self.sent, [])

    def test_manual_route_is_admin_only_and_keeps_csrf_protection(self):
        first = self.add()
        data = self.request_data(first)
        self.assertEqual(self.client.post('/api/publish-next', json=data).status_code, 403)
        self.assertEqual(self.client.post('/api/publish-next', json=data,
                         headers={'X-RT-Request': '1', 'Sec-Fetch-Site': 'cross-site'}).status_code, 403)
        self.assertEqual(self.public.test_client().post('/api/publish-next', json=data).status_code, 404)
        ingress, _ = create_apps(self.service, ingress=True)
        self.assertEqual(ingress.test_client().post('/api/publish-next', json=data,
                         headers={'X-RT-Request': '1'}).status_code, 403)
        self.assertEqual(self.service.queue.history(), [])

    def test_snapshot_exposes_only_browser_eligibility_flags(self):
        with patch.object(self.service.browser_instagram, 'status', return_value={
                'active': True, 'busy': False, 'url': 'https://www.instagram.com/private/path/', 'connected': True}):
            value = self.client.get('/api/state').get_json()['browser_status']
        self.assertEqual(value, {'active': True, 'busy': False})

    def test_scheduler_does_not_replay_slot_after_waiting_past_grace_window(self):
        self.add()
        self.service.state.data['enabled'] = True
        fixed = datetime.fromisoformat('2030-01-01T06:00:10+00:00')
        later = fixed + timedelta(seconds=100)
        current = [fixed]
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                value = current[0]
                return value.astimezone(tz) if tz else value.replace(tzinfo=None)
        class DelayedGuard:
            def __enter__(self):
                current[0] = later
            def __exit__(self, *_):
                return False
        self.service.connection_guard = DelayedGuard()
        slot = {'key': 'ha-delayed-example', 'at': '2030-01-01T06:00:00+00:00'}
        with patch('app.service.datetime', Clock), patch.object(self.service, 'slots', return_value=[slot]), \
                patch.object(self.service, 'refresh_calendar'), \
                patch.object(self.service.stop, 'wait', side_effect=lambda *_: self.service.stop.set()):
            self.service.run()
        self.assertEqual(self.service.queue.history(), [])
        self.assertEqual(self.sent, [])


if __name__ == '__main__':
    unittest.main()
