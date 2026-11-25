"""Folder selection and automatic ingestion through the real settings/service API."""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.folder_import import FolderImporter
from app.server import create_apps
from app.service import Service
from app.state import State


class ImportSettingsTests(unittest.TestCase):
    def setUp(self):
        self.network = patch('requests.sessions.Session.request', side_effect=AssertionError('No live network in tests'))
        self.network.start()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.share = self.root / 'share'
        self.inbox = self.share / 'incoming'
        self.inbox.mkdir(parents=True)
        self.service = Service(self.root / 'DATA', self.share / 'publisher' / 'PLANNED')
        self.now = 100.0
        self.service.folder_importer = FolderImporter(self.service.queue, roots=(self.share,), clock=lambda: self.now)
        self.app, self.public_app = create_apps(self.service)
        self.client = self.app.test_client()

    def tearDown(self):
        self.service.browser_instagram.shutdown()
        self.service.queue.close()
        self.temp.cleanup()
        self.network.stop()

    def save(self, **changes):
        return self.client.put('/api/settings', json=changes, headers={'X-RT-Request': '1'})

    def scan(self):
        return self.client.post('/api/import/scan', headers={'X-RT-Request': '1'})

    def pair(self):
        picture = io.BytesIO()
        Image.new('RGB', (320, 400), (30, 80, 120)).save(picture, format='JPEG')
        (self.inbox / 'first.jpg').write_bytes(picture.getvalue())
        (self.inbox / 'first.txt').write_text('Prepared post caption', encoding='utf-8')

    def run_one_worker_iteration(self):
        self.service.stop.clear()
        self.service.last_scan = 0
        with patch.object(self.service.stop, 'wait', side_effect=lambda *_: self.service.stop.set()):
            self.service.run()

    def test_new_installation_does_not_watch_any_folder(self):
        state = self.client.get('/api/state').get_json()
        self.assertEqual(state['settings']['import_dir'], '')
        self.assertFalse(state['settings']['import_enabled'])
        self.assertFalse(state['settings']['enabled'])

    def test_settings_validate_and_persist_selected_folder_without_importing_immediately(self):
        self.pair()
        response = self.save(import_dir=str(self.inbox), import_enabled=True)
        self.assertEqual(response.status_code, 200, response.get_json())
        saved = State(self.root / 'DATA').settings()
        self.assertEqual(saved['import_dir'], str(self.inbox.resolve()))
        self.assertTrue(saved['import_enabled'])
        self.assertFalse(saved['enabled'])
        self.assertEqual(self.service.queue.list_items(), [])

    def test_folder_api_exposes_only_mounted_browseable_directories(self):
        response = self.client.get('/api/import/folders')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['roots'], [str(self.share.resolve())])
        response = self.client.get('/api/import/folders', query_string={'path': str(self.share)})
        self.assertEqual(response.status_code, 200)
        folders = {item['name']: item for item in response.get_json()['folders']}
        self.assertTrue(folders['incoming']['selectable'])
        self.assertFalse(folders['publisher']['selectable'])
        for path in (self.root, self.service.queue.queue_dir, self.service.queue.archive_dir):
            with self.subTest(path=path):
                response = self.client.get('/api/import/folders', query_string={'path': str(path)})
                self.assertEqual(response.status_code, 400)

    def test_cannot_select_queue_archive_or_an_ancestor_as_source(self):
        for path in (self.share, self.service.queue.queue_dir.parent, self.service.queue.queue_dir,
                     self.service.queue.archive_dir):
            with self.subTest(path=path):
                response = self.save(import_dir=str(path), import_enabled=True)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(self.service.state.data['import_dir'], '')
                self.assertFalse(self.service.state.data['import_enabled'])

    def test_invalid_mixed_update_changes_neither_memory_nor_disk(self):
        self.assertEqual(self.save(import_dir=str(self.inbox), import_enabled=False).status_code, 200)
        before = self.service.state.path.read_bytes()
        original = json.loads(json.dumps(self.service.state.data))
        response = self.save(import_dir=str(self.inbox), import_enabled=True, api_version='invalid')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.service.state.path.read_bytes(), before)
        self.assertEqual(self.service.state.data, original)
        response = self.save(import_dir=str(self.root / 'missing'), import_enabled=True,
                             calendar_entity='calendar.new_calendar')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.service.state.path.read_bytes(), before)
        self.assertEqual(self.service.state.data, original)

    def test_invalid_types_and_enabling_without_folder_are_rejected(self):
        for changes in ({'import_enabled': True}, {'import_enabled': 'true'}, {'import_dir': []},
                        {'import_dir': str(self.inbox), 'import_enabled': 1}):
            with self.subTest(changes=changes):
                response = self.save(**changes)
                self.assertEqual(response.status_code, 400, response.get_json())
                self.assertFalse(self.service.state.data['import_enabled'])

    def test_manual_scan_uses_saved_folder_and_waits_for_complete_pairs(self):
        self.pair()
        self.save(import_dir=str(self.inbox), import_enabled=False)
        first = self.scan()
        self.assertEqual(first.status_code, 200)
        self.assertEqual((first.get_json()['imported'], first.get_json()['pending']), (0, 1))
        self.now += 11
        second = self.scan()
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.get_json()['imported'], 1)
        self.assertIsNotNone(second.get_json()['checked_at'])
        self.assertEqual(self.service.queue.list_items()[0]['caption'], 'Prepared post caption')
        self.assertFalse(self.service.state.data['enabled'])
        self.assertEqual(self.scan().get_json()['duplicates'], 1)

    def test_manual_scan_without_saved_folder_is_clear_error(self):
        response = self.scan()
        self.assertEqual(response.status_code, 400)
        self.assertIn('Choose an import folder', response.get_json()['error'])
        self.assertIn('error_cs', response.get_json())

    def test_worker_imports_while_publishing_paused_and_never_calls_publisher(self):
        self.pair()
        self.save(import_dir=str(self.inbox), import_enabled=True)
        with patch.object(self.service, 'publish', side_effect=AssertionError('Publishing is paused')):
            self.run_one_worker_iteration()
            self.assertEqual(self.service.import_status['pending'], 1)
            self.now += 11
            self.run_one_worker_iteration()
        self.assertEqual(self.service.import_status['imported'], 1)
        self.assertEqual(len(self.service.queue.list_items()), 1)
        self.assertFalse(self.service.state.data['enabled'])
        self.assertEqual(self.service.queue.history(), [])

    def test_disabled_automatic_import_does_not_read_or_enqueue_source(self):
        self.pair()
        self.save(import_dir=str(self.inbox), import_enabled=False)
        with patch.object(self.service.folder_importer, 'scan', side_effect=AssertionError('Import is disabled')):
            self.run_one_worker_iteration()
        self.assertEqual(self.service.queue.list_items(), [])
        self.assertEqual(self.service.worker_error, '')

    def test_unavailable_source_reports_read_error_and_recovers_when_restored(self):
        self.save(import_dir=str(self.inbox), import_enabled=True)
        self.inbox.rmdir()
        response = self.scan()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()['errors']), 1)
        self.assertIn('message_cs', response.get_json()['errors'][0])
        self.assertNotIn(str(self.inbox), response.get_json()['errors'][0]['message'])
        self.inbox.mkdir()
        self.pair()
        self.scan()
        self.now += 11
        self.assertEqual(self.scan().get_json()['imported'], 1)

    def test_unavailable_import_storage_never_prevents_pausing_publication(self):
        self.save(import_dir=str(self.inbox), import_enabled=True)
        # Simulate an already running connection without making any network call.
        with self.service.state.lock:
            self.service.state.data['enabled'] = True
            self.service.state.save()
        self.inbox.rmdir()
        response = self.save(enabled=False)
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertFalse(self.service.state.data['enabled'])
        self.assertFalse(json.loads(self.service.state.path.read_text('utf-8'))['enabled'])

    def test_unavailable_import_storage_can_be_disabled(self):
        self.save(import_dir=str(self.inbox), import_enabled=True)
        self.inbox.rmdir()
        response = self.save(import_enabled=False)
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertFalse(self.service.state.data['import_enabled'])

    def test_mutating_routes_require_request_header_and_are_not_public(self):
        self.save(import_dir=str(self.inbox), import_enabled=False)
        self.assertEqual(self.client.post('/api/import/scan').status_code, 403)
        self.assertEqual(self.client.put('/api/settings', json={'import_enabled': True}).status_code, 403)
        self.assertEqual(self.public_app.test_client().get('/api/import/folders').status_code, 404)
        self.assertEqual(self.public_app.test_client().post('/api/import/scan').status_code, 404)


if __name__ == '__main__':
    unittest.main()
