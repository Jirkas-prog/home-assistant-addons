"""Automatic folder import preserves sources and never recycles published images."""
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.folder_import import FolderImporter, CHANGED_ERROR
from app.queue_store import QueueStore


class FolderImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.share = self.root / 'share'
        self.media = self.root / 'media'
        self.inbox = self.share / 'incoming'
        self.inbox.mkdir(parents=True)
        self.media.mkdir()
        self.queue = QueueStore(self.share / 'publisher' / 'PLANNED', self.root / 'DATA')
        self.now = 100.0
        self.importer = self.make_importer()

    def tearDown(self):
        self.queue.close()
        self.temp.cleanup()

    def make_importer(self):
        return FolderImporter(self.queue, roots=(self.share, self.media), clock=lambda: self.now)

    @staticmethod
    def picture(color=(20, 100, 160), size=(320, 400)):
        output = io.BytesIO()
        Image.new('RGB', size, color).save(output, format='JPEG')
        return output.getvalue()

    def pair(self, name='a.jpg', caption='A prepared caption', color=(20, 100, 160), suffix='.txt'):
        image = self.inbox / name
        image.write_bytes(self.picture(color))
        text = image.with_name(image.stem + suffix)
        text.write_text(caption, encoding='utf-8')
        return image, text

    def scan(self, settle=False):
        if settle:
            self.now += 11
        return self.importer.scan(str(self.inbox))

    def settled_scan(self):
        self.scan()
        return self.scan(settle=True)

    def source_files(self):
        return {p.name: p.read_bytes() for p in self.inbox.iterdir() if p.is_file()}

    def symlink(self, target, link, directory=False):
        try:
            link.symlink_to(target, target_is_directory=directory)
        except OSError:
            self.skipTest('This platform does not permit unprivileged symbolic links.')

    def test_two_observations_and_elapsed_settle_time_required(self):
        self.pair()
        self.assertEqual(self.scan()['pending'], 1)
        self.now += 5
        self.assertEqual(self.scan()['imported'], 0)
        self.assertEqual(self.queue.list_items(), [])
        self.assertEqual(self.scan(settle=True)['imported'], 1)

    def test_pairs_copy_alphabetically_and_preserve_source_bytes(self):
        self.pair('0002__second.jpg', 'Second', (1, 2, 3), suffix='__caption.txt')
        self.pair('0001__first.jpg', 'First')
        before = self.source_files()
        result = self.settled_scan()
        self.assertEqual(result['imported'], 2)
        self.assertEqual(result['errors'], [])
        self.assertEqual([i['caption'] for i in self.queue.list_items()], ['First', 'Second'])
        self.assertEqual(self.source_files(), before)
        self.assertEqual([i['filename'] for i in self.queue.list_items()], ['0001__first.jpg', '0002__second.jpg'])

    def test_missing_or_late_caption_never_creates_captionless_post(self):
        (self.inbox / 'a.jpg').write_bytes(self.picture())
        self.assertEqual(self.settled_scan()['pending'], 1)
        self.assertEqual(self.queue.list_items(), [])
        (self.inbox / 'a.txt').write_text('Late but intentional', encoding='utf-8')
        self.assertEqual(self.scan()['imported'], 0)
        self.assertEqual(self.scan(settle=True)['imported'], 1)
        self.assertEqual(self.queue.list_items()[0]['caption'], 'Late but intentional')

    def test_changing_either_file_restarts_settle_window(self):
        image, text = self.pair()
        self.scan()
        self.now += 11
        text.write_text('Changed caption', encoding='utf-8')
        self.assertEqual(self.scan()['pending'], 1)
        self.now += 11
        image.write_bytes(self.picture((99, 44, 11)))
        self.assertEqual(self.scan()['pending'], 1)
        self.assertEqual(self.scan(settle=True)['imported'], 1)
        self.assertEqual(self.queue.list_items()[0]['caption'], 'Changed caption')

    def test_repeated_scan_and_restart_do_not_duplicate(self):
        self.pair()
        self.assertEqual(self.settled_scan()['imported'], 1)
        self.assertEqual(self.scan()['duplicates'], 1)
        self.queue.close()
        self.queue = QueueStore(self.share / 'publisher' / 'PLANNED', self.root / 'DATA')
        self.importer = self.make_importer()
        self.assertEqual(self.settled_scan()['duplicates'], 1)
        self.assertEqual(len(self.queue.list_items()), 1)

    def test_published_image_is_not_recycled_even_with_new_name_or_caption(self):
        image, text = self.pair()
        self.settled_scan()
        attempt = self.queue.claim('one')
        self.queue.finish(attempt['attempt_id'], '123', 'https://www.instagram.com/p/example/')
        self.assertEqual(self.queue.list_items(), [])
        image.rename(self.inbox / 'renamed.jpg')
        text.rename(self.inbox / 'renamed.txt')
        (self.inbox / 'renamed.txt').write_text('Changed source caption', encoding='utf-8')
        self.importer = self.make_importer()
        self.assertEqual(self.settled_scan()['duplicates'], 1)
        self.assertEqual(self.queue.list_items(), [])

    def test_duplicate_images_in_one_batch_are_imported_once(self):
        self.pair('a.jpg', 'First')
        self.pair('b.jpg', 'Second')
        result = self.settled_scan()
        self.assertEqual((result['imported'], result['duplicates']), (1, 1))
        self.assertEqual(self.queue.list_items()[0]['caption'], 'First')

    def test_many_existing_sources_do_not_starve_new_files_after_batch_boundary(self):
        self.pair()
        self.settled_scan()
        original = self.picture()
        for index in range(105):
            (self.inbox / f'b-{index:03d}.jpg').write_bytes(original)
            (self.inbox / f'b-{index:03d}.txt').write_text('Already queued', encoding='utf-8')
        self.pair('z-new.jpg', 'New', color=(99, 11, 55))
        result = self.settled_scan()
        self.assertEqual(result['imported'], 1)
        self.assertEqual(len(self.queue.list_items()), 2)

    def test_same_filename_with_new_image_is_a_new_post(self):
        image, _ = self.pair()
        self.settled_scan()
        image.write_bytes(self.picture((11, 22, 33)))
        self.assertEqual(self.settled_scan()['imported'], 1)
        self.assertEqual(len(self.queue.list_items()), 2)

    def test_interruption_after_commit_does_not_import_again(self):
        self.pair()
        self.scan()
        original = self.queue.import_pairs
        def committed_then_interrupted(pairs):
            original(pairs)
            raise OSError('Simulated interruption after commit')
        with patch.object(self.queue, 'import_pairs', side_effect=committed_then_interrupted):
            with self.assertRaises(OSError):
                self.scan(settle=True)
        self.importer = self.make_importer()
        self.assertEqual(self.settled_scan()['duplicates'], 1)
        self.assertEqual(len(self.queue.list_items()), 1)

    def test_durable_interrupted_import_is_recovered_before_deduplication(self):
        self.pair()
        self.scan()
        execute = self.queue._execute_plan
        def interrupt(plan):
            if plan.get('imports'):
                raise OSError('Simulated interruption after journal')
            return execute(plan)
        with patch.object(self.queue, '_execute_plan', side_effect=interrupt):
            with self.assertRaises(OSError):
                self.scan(settle=True)
        self.assertTrue(self.queue.journal_path.exists())
        self.importer = self.make_importer()
        self.assertEqual(self.settled_scan()['duplicates'], 1)
        self.assertEqual(len(self.queue.list_items()), 1)
        self.assertEqual(self.queue.list_items()[0]['caption'], 'A prepared caption')

    def test_file_modified_during_read_is_not_queued(self):
        image, _ = self.pair()
        self.scan()
        read = self.importer._read
        def mutate_after_caption(folder, name, descriptor, expected, limit):
            value = read(folder, name, descriptor, expected, limit)
            if name.endswith('.txt'):
                image.write_bytes(self.picture((50, 60, 70)))
            return value
        with patch.object(self.importer, '_read', side_effect=mutate_after_caption):
            result = self.scan(settle=True)
        self.assertEqual(result['imported'], 0)
        self.assertEqual(result['errors'][0]['message'], CHANGED_ERROR)
        self.assertEqual(self.queue.list_items(), [])

    def test_ambiguous_captions_and_shared_caption_are_reported(self):
        self.pair()
        (self.inbox / 'a__caption.txt').write_text('Other', encoding='utf-8')
        self.assertEqual(len(self.scan()['errors']), 1)
        (self.inbox / 'a__caption.txt').unlink()
        (self.inbox / 'a.png').write_bytes(self.picture())
        self.assertEqual(len(self.scan()['errors']), 2)
        self.assertEqual(self.queue.list_items(), [])

    def test_mixed_case_pair_is_matched_and_ignored_files_are_not_read(self):
        self.pair('Church.JPG', suffix='__CAPTION.TXT')
        (self.inbox / 'irrelevant.json').write_text('Do not import', encoding='utf-8')
        (self.inbox / '.copy.jpg').write_bytes(b'Incomplete hidden file')
        self.assertEqual(self.settled_scan()['imported'], 1)

    def test_invalid_photo_and_invalid_utf8_do_not_import(self):
        image, text = self.pair()
        image.write_bytes(b'Partially copied image')
        self.assertEqual(len(self.settled_scan()['errors']), 1)
        image.write_bytes(self.picture())
        text.write_bytes(b'\xff\xfe\xff')
        self.assertEqual(len(self.settled_scan()['errors']), 1)
        self.assertEqual(self.queue.list_items(), [])

    def test_oversized_file_reports_error_instead_of_waiting_forever(self):
        image, _ = self.pair()
        with image.open('wb') as stream:
            stream.truncate(17 * 1024 * 1024)
        result = self.settled_scan()
        self.assertEqual(result['pending'], 0)
        self.assertEqual(len(result['errors']), 1)

    def test_publication_in_progress_defers_import_without_touching_source(self):
        self.pair()
        self.settled_scan()
        attempt = self.queue.claim('running')
        self.pair('b.jpg', color=(2, 3, 4))
        before = self.source_files()
        self.assertEqual(self.settled_scan()['pending'], 1)
        self.assertEqual(len(self.queue.list_items()), 1)
        self.assertEqual(self.source_files(), before)
        self.queue.fail(attempt['attempt_id'], 'Before sending')
        self.assertEqual(self.scan()['imported'], 1)

    def test_only_existing_absolute_mounted_folders_are_accepted(self):
        for value in ('', 'relative', str(self.root), str(self.share / '..' / 'DATA'),
                      str(self.share / 'missing'), str(self.inbox / 'file.jpg')):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.importer.validate_folder(value)
        self.assertEqual(self.importer.validate_folder(str(self.inbox)), str(self.inbox.resolve()))

    def test_queue_archive_private_data_and_their_parents_or_children_are_rejected(self):
        nested = self.queue.queue_dir / 'nested'
        nested.mkdir()
        for path in (self.share, self.queue.queue_dir, self.queue.archive_dir, self.queue.queue_dir.parent, nested):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'separate'):
                self.importer.validate_folder(str(path))
        importer = FolderImporter(self.queue, roots=(self.root,))
        with self.assertRaisesRegex(ValueError, 'separate'):
            importer.validate_folder(str(self.queue.data_dir))

    def test_folder_browser_shows_safe_children_and_never_exposes_managed_data(self):
        root = self.importer.browse()
        self.assertEqual(root['roots'], [str(self.share.resolve()), str(self.media.resolve())])
        result = self.importer.browse(str(self.share))
        self.assertFalse(result['selectable'])
        self.assertEqual([f['name'] for f in result['folders']], ['incoming', 'publisher'])
        result = self.importer.browse(str(self.share / 'publisher'))
        self.assertEqual(result['folders'], [])
        self.assertFalse(result['selectable'])
        with self.assertRaises(ValueError):
            self.importer.browse(str(self.queue.queue_dir))

    def test_symlink_folder_and_parent_are_not_selectable(self):
        outside = self.root / 'outside'
        outside.mkdir()
        self.symlink(outside, self.share / 'escape', directory=True)
        with self.assertRaisesRegex(ValueError, 'Symbolic'):
            self.importer.validate_folder(str(self.share / 'escape'))
        self.assertNotIn('escape', [f['name'] for f in self.importer.browse(str(self.share))['folders']])

    def test_symlink_photo_or_caption_never_imports_external_bytes(self):
        image, text = self.pair()
        outside = self.root / 'private.txt'
        outside.write_text('Private unrelated content', encoding='utf-8')
        text.unlink()
        self.symlink(outside, text)
        result = self.settled_scan()
        self.assertEqual(result['imported'], 0)
        self.assertEqual(len(result['errors']), 1)
        self.assertEqual(self.queue.list_items(), [])

    def test_changing_selected_folder_resets_settle_window(self):
        self.pair()
        self.scan()
        other = self.media / 'incoming'
        other.mkdir()
        (other / 'a.jpg').write_bytes(self.picture((1, 2, 3)))
        (other / 'a.txt').write_text('Other', encoding='utf-8')
        self.now += 20
        self.assertEqual(self.importer.scan(str(other))['pending'], 1)
        self.now += 11
        self.assertEqual(self.importer.scan(str(other))['imported'], 1)


if __name__ == '__main__':
    unittest.main()
