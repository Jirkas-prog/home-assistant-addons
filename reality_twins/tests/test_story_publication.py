"""A story is a separate external operation; it must never resend its feed post."""
from datetime import datetime, timezone
import copy
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import uuid

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.scheduling import story_requested
from app.service import Service
from app.browser_instagram import BrowserInstagramError, BrowserNotSent
from app.queue_store import QueueConflict, QueueStore
from app.server import create_apps


class StoryCalendarTests(unittest.TestCase):
    def test_only_whole_case_insensitive_command_disables_story(self):
        for description in ('/nostory', '/NOSTORY', 'Before\n/noSTORY\nAfter', '\t/nostory\r\n',
                            'Publish this /nostory today'):
            with self.subTest(description=description):
                self.assertIs(story_requested(description), False)
        for description in (None, '', {}, 42, '/nostoryfoo', 'prefix/nostory', '/nostory/extra',
                            'https://example.test/nostory', '/nostory=true', 'normal notes'):
            with self.subTest(description=description):
                self.assertIs(story_requested(description), True)

    def test_calendar_description_controls_both_views_without_changing_slot_identity(self):
        with tempfile.TemporaryDirectory() as temp, patch('requests.sessions.Session.request',
                side_effect=AssertionError('No live network in tests')):
            service = Service(Path(temp) / 'DATA', Path(temp) / 'PLANNED')
            service.state.data.update(schedule_source='home_assistant', calendar_entity='calendar.example')
            now = datetime.now(timezone.utc).replace(microsecond=0)
            event = {'uid': 'event-1', 'summary': '/nostory', 'start': {'dateTime': now.isoformat()}}
            service.ha_get = Mock(return_value=[event])
            try:
                service.refresh_calendar(now)
                slot = service.slots(now, due=True)[0]
                self.assertTrue(slot['story_requested'], 'The title is not a command source')
                key = slot['key']
                event['description'] = 'Publication note\n/NoStory\nKeep the normal feed post.'
                service.refresh_calendar(now)
                changed = service.slots(now, due=True)[0]
                view = service.calendar_week(now.date().isoformat())['slots'][0]
                self.assertFalse(changed['story_requested'])
                self.assertFalse(view['story_requested'])
                self.assertEqual(changed['key'], key)
                self.assertEqual(view['key'], key)
                self.assertNotIn('description', view)
            finally:
                service.browser_instagram.shutdown()
                service.queue.close()


class StoryPublicationTests(unittest.TestCase):
    def setUp(self):
        self.network = patch('requests.sessions.Session.request', side_effect=AssertionError('No live network in tests'))
        self.network.start()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.service = Service(self.root / 'DATA', self.root / 'PLANNED')
        self.service.state.data.update(connection_method='browser', browser_session=True,
            account={'connected': True, 'username': 'example_account', 'id': 'browser:example_account'})
        self.service.state.save()
        self.operations = []
        self.service.browser_instagram.check = Mock(return_value=dict(self.service.state.data['account']))
        self.service.browser_instagram.upload = Mock(side_effect=self.feed)
        self.service.browser_instagram.upload_story = Mock(side_effect=self.story)
        self.renderer = Mock(side_effect=self.render)
        self.renderer_module = patch.dict(sys.modules, {'app.story_cards': SimpleNamespace(render_story=self.renderer)})
        self.renderer_module.start()

    def tearDown(self):
        self.service.browser_instagram.shutdown()
        self.service.queue.close()
        self.renderer_module.stop()
        self.temp.cleanup()
        self.network.stop()

    def add(self):
        Image.new('RGB', (320, 400), 'navy').save(self.service.queue.queue_dir / 'first.jpg')
        (self.service.queue.queue_dir / 'first.txt').write_text('A prepared feed caption.', encoding='utf-8')
        return self.service.queue.scan()[0]

    def claim(self, enabled=True):
        self.add()
        return self.service.queue.claim('slot-' + uuid.uuid4().hex,
            story_settings=self.service.story_settings(enabled))

    def feed(self, image, caption, before_share):
        before_share()
        self.operations.append('feed')
        return {'id': '101', 'permalink': 'https://www.instagram.com/p/ExamplePost/'}

    def render(self, source, output, settings):
        self.assertEqual(source.parent.parent.name, 'PUBLISHED', 'The feed must be archived first')
        self.operations.append('render')
        output.write_bytes(source.read_bytes())
        return output

    def story(self, image, expected_username, before_share):
        self.assertEqual(expected_username, 'example_account')
        self.assertTrue(image.is_file())
        before_share()
        self.operations.append('story')
        return {'id': '202', 'permalink': 'https://www.instagram.com/stories/example_account/202/'}

    def attempt(self, attempt):
        return self.service.queue.get_attempt(attempt['attempt_id'])

    def test_feed_then_story_once_with_separate_receipts_and_unchanged_schedule(self):
        attempt = self.claim()
        settings = copy.deepcopy(self.service.state.data)
        self.service.publish(attempt)
        self.service.publish(attempt)
        self.service.publish_story(attempt['attempt_id'])
        result = self.attempt(attempt)
        self.assertEqual(self.operations, ['feed', 'render', 'story'])
        self.assertEqual((result['state'], result['story_state']), ('published', 'published'))
        self.assertEqual(result['media_id'], '101')
        self.assertEqual(result['story_media_id'], '202')
        self.assertTrue(result['story_started_at'])
        self.assertEqual(self.service.queue.list_items(), [])
        self.assertEqual(self.service.state.data, settings)
        with self.assertRaises(QueueConflict):
            self.service.queue.retry(attempt['item_id'])

    def test_scheduler_claim_snapshots_description_opt_out_and_title_does_not_opt_out(self):
        self.service.state.data.update(enabled=True, calendar_entity='calendar.example', schedule_source='home_assistant')
        now = datetime.now(timezone.utc).replace(microsecond=0)
        for index, description in enumerate(('/nostory', 'Ordinary publication notes')):
            self.add()
            self.service.ha_get = Mock(return_value=[{'uid': str(index), 'summary': '/nostory',
                'description': description, 'start': {'dateTime': now.isoformat()}}])
            self.service.last_calendar_read = 0
            self.service.stop = Mock()
            self.service.stop.is_set.side_effect = [False, True]
            with patch('app.service.datetime') as clock:
                clock.now.return_value = now
                clock.fromisoformat.side_effect = datetime.fromisoformat
                self.service.run()
            receipt = self.service.queue.history()[0]
            self.assertEqual(receipt['story_requested'], bool(index))
            self.assertEqual(receipt['story_state'], 'published' if index else 'skipped')
        self.assertEqual(self.operations, ['feed', 'feed', 'render', 'story'])

    def test_nostory_claim_and_global_switch_publish_only_feed(self):
        self.service.state.update({'story_enabled': False})
        self.assertIsNone(self.service.story_settings())
        self.service.state.update({'story_enabled': True})
        attempt = self.claim(enabled=False)
        self.service.publish(attempt)
        self.assertEqual(self.operations, ['feed'])
        result = self.attempt(attempt)
        self.assertFalse(result['story_requested'])
        self.assertEqual(result['story_state'], 'skipped')

    def test_settings_are_snapshot_even_if_template_changes_after_claim(self):
        attempt = self.claim()
        expected = copy.deepcopy(attempt['story_settings']['renderer'])
        self.service.state.update({'story_headline': 'LATER SETTINGS', 'story_enabled': False})
        self.service.publish(attempt)
        self.assertEqual(self.renderer.call_args.args[2], expected)
        self.assertEqual(self.attempt(attempt)['story_state'], 'published')

    def test_background_change_after_claim_blocks_only_story(self):
        image = self.root / 'DATA' / 'background.jpg'
        Image.new('RGB', (320, 400), 'navy').save(image)
        self.service.state.update({'story_background': str(image)})
        attempt = self.claim()
        Image.new('RGB', (320, 400), 'red').save(image)
        self.service.publish(attempt)
        self.assertEqual(self.operations, ['feed'])
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'error'))
        self.assertFalse(result['story_started_at'])

    def test_settings_reject_background_outside_private_folder_atomically(self):
        image = self.root / 'outside.jpg'
        Image.new('RGB', (100, 100), 'navy').save(image)
        before = copy.deepcopy(self.service.state.data)
        with self.assertRaises(ValueError):
            self.service.state.update({'story_enabled': False, 'story_background': str(image)})
        self.assertEqual(self.service.state.data, before)

    def test_missing_background_at_claim_does_not_suppress_feed_publication(self):
        image = self.root / 'DATA' / 'background.jpg'
        Image.new('RGB', (100, 100), 'navy').save(image)
        self.service.state.update({'story_background': str(image)})
        image.unlink()
        attempt = self.claim()
        self.service.publish(attempt)
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'error'))
        self.assertEqual(self.operations, ['feed'])
        Image.new('RGB', (100, 100), 'navy').save(image)
        self.assertTrue(self.service.retry_story(attempt['attempt_id'])['ok'])
        self.service.browser_instagram.upload.assert_called_once()

    def test_wrong_account_after_feed_blocks_story_without_resending_feed(self):
        attempt = self.claim()
        def switch_account(image, caption, before_share):
            result = self.feed(image, caption, before_share)
            self.service.state.data['account']['username'] = 'other_account'
            return result
        self.service.browser_instagram.upload.side_effect = switch_account
        self.service.publish(attempt)
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'error'))
        self.assertIn('account', result['story_error'])
        self.assertEqual(self.operations, ['feed'])

    def test_feed_failure_or_uncertainty_never_attempts_story(self):
        attempt = self.claim()
        self.service.browser_instagram.upload.side_effect = BrowserNotSent('No feed was sent.')
        self.service.publish(attempt)
        self.assertEqual(self.attempt(attempt)['state'], 'error')
        self.assertEqual(self.attempt(attempt)['story_state'], 'skipped')
        self.renderer.assert_not_called()
        self.service.browser_instagram.upload_story.assert_not_called()

    def test_story_error_preserves_successful_feed_and_replay_does_not_retry_story(self):
        attempt = self.claim()
        self.service.browser_instagram.upload_story.side_effect = BrowserNotSent('Story editor unavailable. No story was sent.')
        self.service.publish(attempt)
        self.service.publish(attempt)
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'error'))
        self.assertFalse(result['story_started_at'])
        self.service.browser_instagram.upload.assert_called_once()
        self.service.browser_instagram.upload_story.assert_called_once()
        self.assertEqual(self.service.queue.list_items(), [])

    def test_unavailable_story_connector_is_reported_without_affecting_feed(self):
        attempt = self.claim()
        self.service.browser_instagram.upload_story = None
        self.service.publish(attempt)
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'error'))
        self.assertIn('cannot publish stories yet', result['story_error'])
        self.assertEqual(self.operations, ['feed'])

    def test_story_timeout_is_uncertain_and_never_replays_feed_or_story(self):
        attempt = self.claim()
        def uncertain(image, expected_username, before_share):
            before_share()
            self.operations.append('story')
            raise BrowserInstagramError('Story result uncertain.')
        self.service.browser_instagram.upload_story.side_effect = uncertain
        self.service.publish(attempt)
        self.service.publish(attempt)
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'uncertain'))
        self.assertTrue(result['story_started_at'])
        self.assertEqual(self.operations, ['feed', 'render', 'story'])

    def test_missing_story_receipt_after_share_is_uncertain(self):
        attempt = self.claim()
        def unconfirmed(image, expected_username, before_share):
            before_share()
            return {'id': '202', 'permalink': ''}
        self.service.browser_instagram.upload_story.side_effect = unconfirmed
        self.service.publish(attempt)
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'uncertain'))

    def test_story_marker_failure_never_sends_and_does_not_change_feed_receipt(self):
        attempt = self.claim()
        with patch.object(self.service.queue, 'start_story', side_effect=OSError('Synthetic journal failure')):
            self.service.publish(attempt)
        self.assertEqual(self.operations, ['feed', 'render'])
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'error'))

    def test_restart_recovers_only_story_state_without_calling_any_publisher(self):
        attempt = self.claim()
        self.service.queue.update_attempt(attempt['attempt_id'], state='publishing')
        self.service.queue.finish(attempt['attempt_id'], '101', 'https://www.instagram.com/p/ExamplePost/')
        self.service.queue.claim_story(attempt['attempt_id'])
        self.service.queue.start_story(attempt['attempt_id'])
        self.service.browser_instagram.shutdown()
        self.service.queue.close()
        self.service = Service(self.root / 'DATA', self.root / 'PLANNED')
        self.service.browser_instagram.upload = Mock(side_effect=AssertionError('No feed replay'))
        self.service.browser_instagram.upload_story = Mock(side_effect=AssertionError('No story replay'))
        self.service.recover()
        self.service.recover()
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'uncertain'))
        self.service.browser_instagram.upload.assert_not_called()
        self.service.browser_instagram.upload_story.assert_not_called()

    def test_restart_before_story_share_preserves_feed_and_marks_safe_error(self):
        attempt = self.claim()
        self.service.queue.finish(attempt['attempt_id'], '101', 'https://www.instagram.com/p/ExamplePost/')
        self.service.queue.claim_story(attempt['attempt_id'])
        self.service.recover()
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'error'))
        self.assertFalse(result['story_started_at'])
        self.assertEqual(self.operations, [])

    def test_recovery_finishes_known_feed_receipt_without_sending_feed_or_story(self):
        attempt = self.claim()
        self.service.queue.update_attempt(attempt['attempt_id'], state='publishing', media_id='101',
                                          permalink='https://www.instagram.com/p/ExamplePost/')
        self.service.recover()
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'error'))
        self.assertEqual(self.service.queue.list_items(), [])
        self.assertEqual(self.operations, [])

    def test_explicit_feed_confirmation_can_finish_original_story_without_resending_feed(self):
        attempt = self.claim()
        self.service.queue.update_attempt(attempt['attempt_id'], state='publishing')
        self.service.queue.fail(attempt['attempt_id'], 'Synthetic uncertain feed.', uncertain=True)
        result = self.service.resolve(attempt['attempt_id'], {
            'published': True, 'permalink': 'https://www.instagram.com/p/ExamplePost/'})
        self.assertEqual((result['state'], result['story_state']), ('published', 'published'))
        self.assertEqual(self.operations, ['render', 'story'])
        self.service.browser_instagram.upload.assert_not_called()

    def test_confirming_no_feed_was_sent_skips_its_original_story(self):
        attempt = self.claim()
        self.service.queue.update_attempt(attempt['attempt_id'], state='publishing')
        self.service.queue.fail(attempt['attempt_id'], 'Synthetic uncertain feed.', uncertain=True)
        self.service.resolve(attempt['attempt_id'], {'published': False, 'note': 'Verified no feed post was sent.'})
        self.assertEqual(self.attempt(attempt)['story_state'], 'skipped')
        self.assertEqual(self.operations, [])

    def test_manual_opt_out_and_idempotent_replay_preserve_original_story_intent(self):
        item = self.add()
        admin, _ = create_apps(self.service)
        client = admin.test_client()
        data = {'expected_post_id': item['id'], 'request_id': uuid.uuid4().hex, 'story_requested': False}
        first = client.post('/api/publish-next', json=data, headers={'X-RT-Request': '1'}).get_json()
        data['story_requested'] = True
        replay = client.post('/api/publish-next', json=data, headers={'X-RT-Request': '1'}).get_json()
        self.assertTrue(first['ok'])
        self.assertTrue(replay['replayed'])
        self.assertFalse(replay['attempt']['story_requested'])
        self.assertEqual(self.operations, ['feed'])

    def test_queue_claim_without_new_story_intent_stays_skipped_after_restart(self):
        self.add()
        attempt = self.service.queue.claim('legacy-slot')
        self.service.queue.close()
        self.service.queue = QueueStore(self.root / 'PLANNED', self.root / 'DATA')
        result = self.attempt(attempt)
        self.assertFalse(result['story_requested'])
        self.assertEqual(result['story_state'], 'skipped')

    def test_pre_story_database_migration_never_creates_retroactive_story(self):
        self.add()
        attempt = self.service.queue.claim('legacy-slot')
        self.service.queue.finish(attempt['attempt_id'], '101', 'https://www.instagram.com/p/ExamplePost/')
        self.service.queue.close()
        with sqlite3.connect(self.root / 'DATA' / 'queue.sqlite3') as database:
            columns = [row[1] for row in database.execute('PRAGMA table_info(attempts)') if row[1].startswith('story_')]
            for column in columns:
                database.execute('ALTER TABLE attempts DROP COLUMN ' + column)
        database.close()
        self.service.queue = QueueStore(self.root / 'PLANNED', self.root / 'DATA')
        self.service.recover()
        self.service.publish(attempt)
        result = self.attempt(attempt)
        self.assertEqual((result['state'], result['story_state']), ('published', 'skipped'))
        self.assertEqual(self.operations, [])

    def test_explicit_story_retry_sends_only_story_and_retains_original_error(self):
        attempt = self.claim()
        self.service.browser_instagram.upload_story.side_effect = BrowserNotSent('Synthetic pre-Share story failure.')
        self.service.publish(attempt)
        self.service.browser_instagram.upload_story.side_effect = self.story
        result = self.service.retry_story(attempt['attempt_id'])
        self.assertTrue(result['ok'])
        self.assertEqual(self.operations, ['feed', 'render', 'render', 'story'])
        self.assertEqual(result['attempt']['story_history'][0]['story_error'], 'Synthetic pre-Share story failure.')
        self.assertEqual(result['attempt']['story_history'][0]['action'], 'retry')
        with self.assertRaises(QueueConflict):
            self.service.retry_story(attempt['attempt_id'])
        self.service.browser_instagram.upload.assert_called_once()

    def test_uncertain_story_requires_explicit_resolution_before_story_only_retry(self):
        attempt = self.claim()
        def uncertain(image, expected_username, before_share):
            before_share()
            raise BrowserInstagramError('Synthetic uncertain story.')
        self.service.browser_instagram.upload_story.side_effect = uncertain
        self.service.publish(attempt)
        with self.assertRaises(QueueConflict):
            self.service.retry_story(attempt['attempt_id'])
        with self.assertRaises(ValueError):
            self.service.resolve_story(attempt['attempt_id'], {'published': False, 'note': 'no'})
        note = 'Verified the account story archive; the story was not sent.'
        resolved = self.service.resolve_story(attempt['attempt_id'], {'published': False, 'note': note})
        self.assertEqual(resolved['attempt']['state'], 'published')
        self.assertEqual(resolved['attempt']['story_state'], 'error')
        self.assertIsNone(resolved['attempt']['story_started_at'])
        self.assertTrue(resolved['attempt']['story_history'][0]['story_started_at'])
        self.assertEqual(resolved['attempt']['story_note'], note)
        self.service.browser_instagram.upload_story.side_effect = self.story
        self.assertTrue(self.service.retry_story(attempt['attempt_id'])['ok'])
        self.service.browser_instagram.upload.assert_called_once()

    def test_story_receipt_rejects_foreign_account_and_resolution_keeps_feed_immutable(self):
        attempt = self.claim()
        def wrong_receipt(image, expected_username, before_share):
            before_share()
            return {'id': '202', 'permalink': 'https://www.instagram.com/stories/other_account/202/'}
        self.service.browser_instagram.upload_story.side_effect = wrong_receipt
        self.service.publish(attempt)
        before = self.attempt(attempt)
        self.assertEqual(before['story_state'], 'uncertain')
        for link in ('https://evil.example/stories/example_account/202/',
                     'https://www.instagram.com/stories/other_account/202/',
                     'https://example:secret@www.instagram.com/stories/example_account/202/',
                     'https://www.instagram.com/p/ExamplePost/'):
            with self.assertRaises(ValueError):
                self.service.resolve_story(attempt['attempt_id'], {'published': True, 'permalink': link})
        result = self.service.resolve_story(attempt['attempt_id'], {'published': True,
            'permalink': 'https://www.instagram.com/stories/example_account/202/?tracking=private'})
        self.assertTrue(result['ok'])
        self.assertEqual(result['attempt']['story_state'], 'published')
        self.assertNotIn('tracking', result['attempt']['story_permalink'])
        self.assertEqual(result['attempt']['permalink'], before['permalink'])
        self.assertEqual(result['attempt']['media_id'], before['media_id'])
        self.service.browser_instagram.upload.assert_called_once()
        self.service.browser_instagram.upload_story.assert_called_once()

    def test_story_journal_failure_never_reclassifies_published_feed(self):
        attempt = self.claim()
        with patch.object(self.service.queue, 'claim_story', side_effect=OSError('Synthetic database failure')):
            self.service.publish(attempt)
        self.assertEqual(self.attempt(attempt)['state'], 'published')
        self.assertEqual(self.service.queue.list_items(), [])
        self.assertIn('feed post is published', self.service.worker_error)
        self.service.browser_instagram.upload.assert_called_once()

    def test_story_routes_keep_admin_and_csrf_boundaries_and_localized_errors(self):
        attempt = self.claim()
        self.service.browser_instagram.upload_story.side_effect = BrowserNotSent('Synthetic pre-Share story failure.')
        self.service.publish(attempt)
        admin, public = create_apps(self.service)
        client = admin.test_client()
        retry = '/api/attempts/' + attempt['attempt_id'] + '/story/retry'
        resolve = '/api/attempts/' + attempt['attempt_id'] + '/story/resolve'
        self.assertEqual(client.post(retry, json={}).status_code, 403)
        self.assertEqual(client.post(resolve, json={'published': False}).status_code, 403)
        self.assertEqual(public.test_client().post(retry, json={}, headers={'X-RT-Request': '1'}).status_code, 404)
        self.assertEqual(client.post(retry, json={}, headers={'X-RT-Request': '1', 'Sec-Fetch-Site': 'cross-site'}).status_code, 403)
        response = client.post(resolve, json={'published': False, 'note': 'Checked the archive.'}, headers={'X-RT-Request': '1'})
        self.assertEqual(response.status_code, 409)
        self.assertIn('error_cs', response.get_json())
        self.service.browser_instagram.upload_story.side_effect = self.story
        response = client.post(retry, json={}, headers={'X-RT-Request': '1'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['ok'])
        self.service.browser_instagram.upload.assert_called_once()

    def test_explicit_create_backfills_one_archived_post_even_when_global_stories_are_off(self):
        attempt = self.claim(enabled=False)
        self.service.publish(attempt)
        self.service.state.update({'story_enabled': False, 'story_headline': 'MANUAL STORY'})
        before_state = copy.deepcopy(self.service.state.data)
        before = self.attempt(attempt)
        feed_fields = {key: value for key, value in before.items() if not key.startswith('story_')}
        source = self.service.queue.image_path(attempt['item_id'])
        archived = source.read_bytes()
        result = self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
        self.assertTrue(result['ok'])
        self.assertFalse(result['replayed'])
        self.assertEqual(result['attempt']['story_state'], 'published')
        self.assertTrue(result['attempt']['story_requested'])
        self.assertEqual(result['attempt']['story_settings']['renderer']['story_headline'], 'MANUAL STORY')
        self.assertEqual(result['attempt']['story_history'][0]['action'], 'manual_create')
        self.assertEqual(result['attempt']['story_history'][0]['story_state'], 'skipped')
        self.assertEqual({key: value for key, value in result['attempt'].items() if not key.startswith('story_')}, feed_fields)
        self.assertEqual(self.service.state.data, before_state)
        self.assertEqual(source.read_bytes(), archived)
        replay = self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
        self.assertTrue(replay['replayed'])
        self.assertEqual(self.operations, ['feed', 'render', 'story'])
        self.service.browser_instagram.upload.assert_called_once()
        self.service.browser_instagram.upload_story.assert_called_once()

    def test_repeated_create_returns_error_or_uncertain_receipt_without_retrying(self):
        for uncertain in (False, True):
            with self.subTest(uncertain=uncertain):
                attempt = self.claim(enabled=False)
                self.service.publish(attempt)
                def failed_story(image, expected_username, before_share):
                    if uncertain:
                        before_share()
                        raise BrowserInstagramError('Synthetic uncertain story.')
                    raise BrowserNotSent('Synthetic pre-Share story failure.')
                self.service.browser_instagram.upload_story.reset_mock(side_effect=True)
                self.service.browser_instagram.upload_story.side_effect = failed_story
                first = self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
                replay = self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
                self.assertFalse(first['ok'])
                self.assertFalse(first['replayed'])
                self.assertTrue(replay['replayed'])
                self.assertEqual(replay['attempt']['story_state'], 'uncertain' if uncertain else 'error')
                self.assertEqual(len(replay['attempt']['story_history']), 1)
                self.service.browser_instagram.upload_story.assert_called_once()

    def test_create_rejects_stale_disconnected_wrong_method_or_active_login_before_intent(self):
        attempt = self.claim(enabled=False)
        self.service.publish(attempt)
        original = copy.deepcopy(self.service.state.data)
        for changes in ({'account': {'connected': True, 'username': 'other_account'}},
                        {'account': {'connected': False, 'username': 'example_account'}},
                        {'connection_method': 'official'}):
            self.service.state.data = copy.deepcopy(original)
            self.service.state.data.update(changes)
            with self.assertRaises(QueueConflict):
                self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
            self.assertEqual(self.attempt(attempt)['story_state'], 'skipped')
            self.assertEqual(self.attempt(attempt)['story_history'], [])
        self.service.state.data = original
        with patch.object(self.service.browser_instagram, 'status', return_value={'active': True}):
            with self.assertRaises(QueueConflict):
                self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
        self.service.browser_instagram.upload_story.assert_not_called()

    def test_create_requires_published_feed_and_unchanged_archived_image(self):
        attempt = self.claim(enabled=False)
        with self.assertRaises(QueueConflict):
            self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
        self.service.publish(attempt)
        self.service.queue.image_path(attempt['item_id']).write_bytes(b'changed archived image')
        with self.assertRaises(QueueConflict):
            self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
        self.assertEqual(self.attempt(attempt)['story_state'], 'skipped')
        self.assertEqual(self.attempt(attempt)['story_history'], [])
        self.service.browser_instagram.upload_story.assert_not_called()

    def test_concurrent_create_returns_inflight_receipt_and_sends_only_one_story(self):
        attempt = self.claim(enabled=False)
        self.service.publish(attempt)
        sending, finish = threading.Event(), threading.Event()
        results, errors = [], []
        def slow_story(image, expected_username, before_share):
            before_share()
            sending.set()
            if not finish.wait(10):
                raise AssertionError('Test release timed out')
            self.operations.append('story')
            return {'id': '202', 'permalink': 'https://www.instagram.com/stories/example_account/202/'}
        self.service.browser_instagram.upload_story.side_effect = slow_story
        def create():
            try:
                results.append(self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'}))
            except BaseException as error:
                errors.append(error)
        worker = threading.Thread(target=create)
        worker.start()
        try:
            self.assertTrue(sending.wait(5))
            replay = self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
            self.assertTrue(replay['replayed'])
            self.assertEqual(replay['attempt']['story_state'], 'publishing')
        finally:
            finish.set()
            worker.join(15)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(results[0]['ok'])
        self.assertEqual(self.operations, ['feed', 'render', 'story'])

    def test_create_replay_after_restart_never_touches_publisher(self):
        attempt = self.claim(enabled=False)
        self.service.publish(attempt)
        self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
        self.service.browser_instagram.shutdown()
        self.service.queue.close()
        self.service = Service(self.root / 'DATA', self.root / 'PLANNED')
        self.service.browser_instagram.upload_story = Mock(side_effect=AssertionError('No story replay'))
        self.service.browser_instagram.upload = Mock(side_effect=AssertionError('No feed replay'))
        result = self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
        self.assertTrue(result['ok'])
        self.assertTrue(result['replayed'])
        self.service.browser_instagram.upload.assert_not_called()
        self.service.browser_instagram.upload_story.assert_not_called()

    def test_create_does_not_take_over_existing_pending_story_intent(self):
        attempt = self.claim()
        self.service.queue.finish(attempt['attempt_id'], '101', 'https://www.instagram.com/p/ExamplePost/')
        result = self.service.create_story(attempt['attempt_id'], {'expected_username': 'example_account'})
        self.assertTrue(result['replayed'])
        self.assertEqual(result['attempt']['story_state'], 'pending')
        self.assertEqual(self.operations, [])

    def test_create_api_is_explicit_admin_only_and_validates_exact_account_payload(self):
        attempt = self.claim(enabled=False)
        self.service.publish(attempt)
        admin, public = create_apps(self.service, ingress=True)
        client = admin.test_client()
        route = '/api/attempts/' + attempt['attempt_id'] + '/story/create'
        account = {'expected_username': 'example_account'}
        headers = {'X-RT-Request': '1'}
        source = {'REMOTE_ADDR': '172.30.32.2'}
        self.assertEqual(public.test_client().post(route, json=account, headers=headers).status_code, 404)
        self.assertEqual(client.post(route, json=account, headers=headers).status_code, 403)
        self.assertEqual(client.post(route, json=account, environ_overrides=source).status_code, 403)
        self.assertEqual(client.post(route, json=account, headers=headers | {'Sec-Fetch-Site': 'cross-site'},
                                     environ_overrides=source).status_code, 403)
        for invalid in ({}, [], {'expected_username': None}, {'expected_username': '../other'},
                        account | {'story_requested': True}):
            self.assertEqual(client.post(route, json=invalid, headers=headers, environ_overrides=source).status_code, 400)
        self.assertEqual(self.attempt(attempt)['story_state'], 'skipped')
        response = client.post(route, json=account, headers=headers, environ_overrides=source)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['ok'])
        self.service.browser_instagram.upload.assert_called_once()
