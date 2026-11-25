"""Upload failures must not strand files or report unpaired captions as imported."""
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.server import create_apps
from app.service import Service
from app.queue_store import QueueStore


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.network = patch('requests.sessions.Session.request', side_effect=AssertionError('No live network in tests'))
        self.network.start()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.service = Service(self.root / 'DATA', self.root / 'PLANNED')
        self.queue = self.service.queue
        self.app, _ = create_apps(self.service)
        self.client = self.app.test_client()

    def tearDown(self):
        self.queue.close()
        self.temp.cleanup()
        self.network.stop()

    @staticmethod
    def picture(size=(320, 400), fmt='JPEG', orientation=None):
        out = io.BytesIO()
        options = {}
        if orientation is not None:
            exif = Image.Exif()
            exif[274] = orientation
            options['exif'] = exif
        Image.new('RGB', size, (20, 100, 160)).save(out, format=fmt, **options)
        return out.getvalue()

    def upload(self, pairs):
        return self.client.post('/api/upload', data={'files': [(io.BytesIO(data), name) for name, data in pairs]},
                                headers={'X-RT-Request': '1'}, content_type='multipart/form-data')

    def disk(self):
        return {p.name: p.read_bytes() for p in self.queue.queue_dir.iterdir() if p.is_file()}

    def test_paired_upload_returns_real_counts_and_persisted_caption(self):
        response = self.upload([('church.jpg', self.picture()), ('church__caption.txt', b'Actual caption'),
                                ('forest.png', self.picture(fmt='PNG'))])
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json(), {'ok': True, 'imported': 2, 'captions_missing': 1})
        items = self.queue.list_items()
        self.assertEqual([i['filename'] for i in items], ['0001__church.jpg', '0002__forest.png'])
        self.assertEqual(items[0]['caption'], 'Actual caption')
        self.assertEqual((self.queue.queue_dir / '0001__church.txt').read_text('utf-8'), 'Actual caption')

    def test_late_caption_rejected_without_stranding_a_txt(self):
        self.assertEqual(self.upload([('church.jpg', self.picture())]).status_code, 200)
        before = self.disk()
        response = self.upload([('church__caption.txt', b'Late caption')])
        self.assertEqual(response.status_code, 400)
        self.assertIn('Edit text', response.get_json()['error'])
        self.assertIn('Upravit text', response.get_json()['error_cs'])
        self.assertEqual(self.disk(), before)
        self.assertEqual(self.queue.list_items()[0]['caption'], '')

    def test_import_order_uses_filenames_not_browser_selection_order(self):
        response = self.upload([('b.jpg', self.picture()), ('b.txt', b'Second'),
                                ('a.jpg', self.picture()), ('a.txt', b'First')])
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual([(item['filename'], item['caption']) for item in self.queue.list_items()],
                         [('0001__a.jpg', 'First'), ('0002__b.jpg', 'Second')])

    def test_unmatched_caption_rejects_entire_batch(self):
        response = self.upload([('church.jpg', self.picture()), ('other.txt', b'Wrong pair')])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.disk(), {})
        self.assertEqual(self.queue.list_items(), [])

    def test_two_captions_rejected_before_any_write(self):
        response = self.upload([('church.jpg', self.picture()), ('church.txt', b'A'), ('church__caption.txt', b'B')])
        self.assertEqual(response.status_code, 400)
        self.assertIn('Multiple caption files', response.get_json()['error'])
        self.assertEqual(self.disk(), {})
        self.assertEqual(self.queue.scan(), [])

    def test_two_images_sharing_an_implicit_caption_rejected(self):
        response = self.upload([('church.jpg', self.picture()), ('church.png', self.picture(fmt='PNG'))])
        self.assertEqual(response.status_code, 400)
        self.assertIn('Multiple images share', response.get_json()['error'])
        self.assertEqual(self.disk(), {})

    def test_generated_caption_cannot_be_a_second_caption_for_another_image(self):
        response = self.upload([('church.jpg', self.picture()), ('church__caption.jpg', self.picture())])
        self.assertEqual(response.status_code, 400)
        self.assertIn('Multiple caption files', response.get_json()['error'])
        self.assertEqual(self.disk(), {})

    def test_existing_differently_cased_caption_cannot_silently_be_ignored(self):
        (self.queue.queue_dir / 'CHURCH.txt').write_text('Existing caption', encoding='utf-8')
        before = self.disk()
        response = self.upload([('church.jpg', self.picture())])
        self.assertEqual(response.status_code, 400)
        self.assertIn('including letter case', response.get_json()['error'])
        self.assertEqual(self.disk(), before)

    def test_existing_unmanaged_ambiguity_preserves_existing_files_and_writes_nothing(self):
        (self.queue.queue_dir / 'existing.jpg').write_bytes(self.picture())
        (self.queue.queue_dir / 'existing.txt').write_text('A', encoding='utf-8')
        (self.queue.queue_dir / 'existing__caption.txt').write_text('B', encoding='utf-8')
        before = self.disk()
        response = self.upload([('new.jpg', self.picture()), ('new.txt', b'New')])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.disk(), before)

    def test_rename_collision_rolls_back_uploaded_files_but_preserves_external_target(self):
        target = self.queue.queue_dir / '0001__church.txt'
        target.write_text('External file must survive', encoding='utf-8')
        before = self.disk()
        response = self.upload([('church.jpg', self.picture())])
        self.assertEqual(response.status_code, 400)
        self.assertIn('Target file already exists', response.get_json()['error'])
        self.assertEqual(self.disk(), before)
        self.assertEqual(self.queue.list_items(), [])
        self.assertFalse(self.queue.journal_path.exists())

    def test_unpublishable_image_rejects_whole_batch_before_queueing(self):
        for size in [(1000, 100), (200, 250)]:
            with self.subTest(size=size):
                response = self.upload([('valid.jpg', self.picture()), ('invalid.jpg', self.picture(size))])
                self.assertEqual(response.status_code, 400)
                self.assertEqual(self.disk(), {})
                self.assertEqual(self.queue.list_items(), [])

    def test_exif_orientation_has_the_same_limits_during_upload_and_prepare(self):
        invalid = self.upload([('rotated.jpg', self.picture((1400, 800), orientation=6))])
        self.assertEqual(invalid.status_code, 400)
        self.assertIn('aspect ratio', invalid.get_json()['error'])
        accepted = self.upload([('rotated.jpg', self.picture((300, 400), orientation=6))])
        self.assertEqual(accepted.status_code, 200, accepted.get_json())
        item = self.queue.list_items()[0]
        prepared = self.service.prepare_image(item['id'])
        with Image.open(prepared) as image:
            self.assertEqual(image.size, (400, 300))

    def test_mixed_case_extension_and_caption_pair_work_on_linux_too(self):
        response = self.upload([('Church.JPG', self.picture()), ('CHURCH__CAPTION.TXT', b'Matched caption')])
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.queue.list_items()[0]['caption'], 'Matched caption')

    def test_image_stem_ending_in_caption_does_not_change_its_caption_stem(self):
        response = self.upload([('own__caption.jpg', self.picture()), ('own__caption.txt', b'Correct stem')])
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.queue.list_items()[0]['caption'], 'Correct stem')

    def test_import_during_publication_is_explicitly_rejected(self):
        self.upload([('first.jpg', self.picture())])
        self.queue.claim('publishing-slot')
        before = self.disk()
        response = self.upload([('second.jpg', self.picture())])
        self.assertEqual(response.status_code, 400)
        self.assertIn('Publishing is in progress', response.get_json()['error'])
        self.assertEqual(self.disk(), before)

    def test_rollback_does_not_remove_an_externally_changed_staged_file(self):
        def fail_after_external_write(ordered, imports):
            (self.queue.queue_dir / imports[0]['filename']).write_bytes(b'Externally replaced content')
            raise ValueError('Simulated conflict')
        with patch.object(self.queue, '_renumber', side_effect=fail_after_external_write):
            response = self.upload([('church.jpg', self.picture())])
        self.assertEqual(response.status_code, 400)
        files = self.disk()
        self.assertEqual(list(files.values()), [b'Externally replaced content'])
        self.assertTrue(next(iter(files)).startswith('.upload-'))
        self.assertEqual(self.queue.scan(), [])

    def test_interrupted_rename_keeps_journal_files_and_recovers_once(self):
        execute = self.queue._execute_plan
        def interrupt(plan):
            if plan.get('imports'):
                raise OSError('Simulated interruption after journal was durable')
            return execute(plan)
        with patch.object(self.queue, '_execute_plan', side_effect=interrupt):
            response = self.upload([('church.jpg', self.picture()), ('church.txt', b'Recover me')])
        self.assertEqual(response.status_code, 400)
        self.assertTrue(self.queue.journal_path.exists())
        self.assertEqual(len(self.disk()), 2)
        self.assertTrue(all(name.startswith('.upload-') for name in self.disk()))
        items = self.queue.list_items()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['caption'], 'Recover me')
        self.assertFalse(self.queue.journal_path.exists())
        self.assertEqual(len(self.queue.scan()), 1)

    def crash_upload_process(self, stage):
        script = '''
import io, os, sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, sys.argv[2])
from app.queue_store import QueueStore
root = Path(sys.argv[1])
queue = QueueStore(root / 'PLANNED', root / 'DATA')
picture = io.BytesIO()
Image.new('RGB', (320, 400), (20, 100, 160)).save(picture, format='JPEG')
if sys.argv[3] == 'staging':
    fsync = os.fsync
    def crash_after_first_write(fd):
        fsync(fd)
        os._exit(73)
    os.fsync = crash_after_first_write
else:
    move = queue._move_no_replace
    def crash_after_visible_image(source, target, expected):
        move(source, target, expected)
        if target.suffix == '.jpg' and not target.name.startswith('.'):
            os._exit(74)
    queue._move_no_replace = crash_after_visible_image
queue.import_pairs([{'filename': 'church.jpg', 'image': picture.getvalue(),
                     'caption': b'The intended caption must survive the crash.'}])
raise AssertionError('Crash injection was not reached')
'''
        self.queue.close()
        try:
            result = subprocess.run([sys.executable, '-c', script, str(self.root),
                                     str(Path(__file__).resolve().parents[1]), stage],
                                    capture_output=True, text=True, timeout=30)
        finally:
            self.queue = QueueStore(self.root / 'PLANNED', self.root / 'DATA')
            self.service.queue = self.queue
        self.assertEqual(result.returncode, 73 if stage == 'staging' else 74, result.stderr)

    def test_real_process_crash_after_first_staged_image_queues_nothing(self):
        self.crash_upload_process('staging')
        self.assertEqual(self.queue.scan(), [])
        self.assertIsNone(self.queue.claim('after-staging-crash'))
        self.assertTrue(all(name.startswith('.') for name in self.disk()))
        self.assertFalse(self.queue.journal_path.exists())

    def test_real_process_crash_after_visible_image_recovers_its_intended_caption(self):
        self.crash_upload_process('visible')
        items = self.queue.scan()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['caption'], 'The intended caption must survive the crash.')
        self.assertEqual(set(self.disk()), {'0001__church.jpg', '0001__church.txt'})
        attempt = self.queue.claim('after-visible-image-crash')
        self.assertEqual(attempt['caption'], 'The intended caption must survive the crash.')
        self.assertFalse(self.queue.journal_path.exists())

    def test_current_batch_of_90_posts_with_captions_fits_file_count_limit(self):
        picture = self.picture()
        files = [(name, data) for index in range(90)
                 for name, data in [(f'photo-{index:03d}.jpg', picture), (f'photo-{index:03d}.txt', b'Caption')]]
        response = self.upload(files)
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json(), {'ok': True, 'imported': 90, 'captions_missing': 0})


if __name__ == '__main__':
    unittest.main()
