"""Preview is an admin-only image read, never a publication or a queue mutation."""
import copy
import io
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.server import create_apps
from app.service import Service
from app.story_cards import render_story


class StoryPreviewTests(unittest.TestCase):
    def setUp(self):
        self.network = patch('requests.sessions.Session.request', side_effect=AssertionError('No live network in tests'))
        self.network.start()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.service = Service(self.root / 'DATA', self.root / 'PLANNED')
        self.admin, self.public = create_apps(self.service, ingress=True)
        self.client = self.admin.test_client()
        self.source = {'REMOTE_ADDR': '172.30.32.2'}

    def tearDown(self):
        self.service.browser_instagram.shutdown()
        self.service.queue.close()
        self.temp.cleanup()
        self.network.stop()

    def add(self, name='first.png', color='#14559a'):
        path = self.service.queue.queue_dir / name
        Image.new('RGB', (1080, 1350), color).save(path)
        path.with_suffix('.txt').write_text('Prepared caption.', encoding='utf-8')
        return self.service.queue.scan()[-1]

    def preview(self, item_id, **kwargs):
        return self.client.get('/api/story/preview', query_string={'post_id': item_id},
                               environ_overrides=kwargs.get('environ_overrides', self.source),
                               headers=kwargs.get('headers', {}))

    def test_preview_returns_full_size_jpeg_without_journal_queue_or_publish_side_effects(self):
        item = self.add()
        self.service.state.update({'story_enabled': False})
        before_state = copy.deepcopy(self.service.state.data)
        before_queue = self.service.queue.list_items()
        image = self.service.queue.image_path(item['id'])
        before_files = {path.name: path.read_bytes() for path in image.parent.iterdir() if path.is_file()}
        before_data_names = {path.name for path in self.service.data_dir.iterdir()}
        with patch.object(self.service, 'publish', side_effect=AssertionError('Preview cannot publish')), \
                patch.object(self.service, 'publish_story', side_effect=AssertionError('Preview cannot publish stories')), \
                patch.object(self.service.queue, 'claim', side_effect=AssertionError('Preview cannot claim')), \
                patch.object(self.service.queue, 'claim_story', side_effect=AssertionError('Preview cannot claim stories')):
            response = self.preview(item['id'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'image/jpeg')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['Referrer-Policy'], 'no-referrer')
        with Image.open(io.BytesIO(response.data)) as preview:
            self.assertEqual((preview.size, preview.mode), ((1080, 1920), 'RGB'))
            for point in ((95, 470), (984, 470), (95, 1582), (984, 1582)):
                self.assertTrue(all(abs(a - b) < 8 for a, b in zip(preview.getpixel(point), (20, 85, 154))))
        self.assertEqual(self.service.queue.list_items(), before_queue)
        self.assertEqual(self.service.queue.history(), [])
        self.assertEqual(self.service.state.data, before_state)
        self.assertFalse(self.service.queue.journal_path.exists())
        self.assertEqual({path.name: path.read_bytes() for path in image.parent.iterdir() if path.is_file()}, before_files)
        self.assertEqual({path.name for path in self.service.data_dir.iterdir()}, before_data_names)

    def test_preview_keeps_ingress_and_cross_site_guards_but_get_requires_no_csrf_header(self):
        item = self.add()
        url = '/api/story/preview?post_id=' + item['id']
        self.assertEqual(self.public.test_client().get(url).status_code, 404)
        self.assertEqual(self.preview(item['id'], environ_overrides={}).status_code, 403)
        self.assertEqual(self.preview(item['id'], environ_overrides={},
                                     headers={'X-Forwarded-For': '172.30.32.2'}).status_code, 403)
        self.assertEqual(self.preview(item['id'], headers={'Sec-Fetch-Site': 'cross-site'}).status_code, 403)
        self.assertEqual(self.preview(item['id']).status_code, 200)
        self.assertEqual(self.client.post(url, environ_overrides=self.source, headers={'X-RT-Request': '1'}).status_code, 405)

    def test_missing_unknown_and_traversal_post_ids_are_not_file_reads(self):
        self.add()
        for item_id in ('', 'not-a-post', '../DATA/settings.json', '../../private.jpg', '/data/settings.json'):
            with self.subTest(item_id=item_id):
                with patch('app.story_cards.render_story', side_effect=AssertionError('Invalid ID must not render')):
                    response = self.preview(item_id)
                self.assertEqual(response.status_code, 400)
                self.assertIn('error_cs', response.get_json())
        self.assertEqual(self.service.queue.history(), [])

    def test_preview_rejects_changed_queue_image_before_rendering(self):
        item = self.add()
        source = self.service.queue.image_path(item['id'])
        source.write_bytes(b'changed source')
        with patch('app.story_cards.render_story', side_effect=AssertionError('Changed image must not render')):
            response = self.preview(item['id'])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.service.queue.history(), [])

    def test_background_paths_are_revalidated_before_preview_not_just_when_saved(self):
        item = self.add()
        outside = self.root / 'outside.png'
        Image.new('RGB', (100, 100), 'red').save(outside)
        paths = (str(outside), str(self.service.data_dir / '..' / 'outside.png'),
                 str(self.service.data_dir / 'missing.png'))
        for background in paths:
            with self.subTest(background=background):
                self.service.state.data['story_background'] = background
                with patch('app.story_cards.render_story', side_effect=AssertionError('Unsafe background must not render')):
                    response = self.preview(item['id'])
                self.assertEqual(response.status_code, 400)
                self.assertIn('private data folder', response.get_json()['error'])
                self.assertNotIn(background, response.get_data(as_text=True))

    def test_background_symlink_is_rejected_even_if_its_target_is_an_image(self):
        item = self.add()
        outside = self.root / 'outside.png'
        Image.new('RGB', (100, 100), 'red').save(outside)
        link = self.service.data_dir / 'linked.png'
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest('This host cannot create test symlinks; Linux CI covers this path.')
        self.service.state.data['story_background'] = str(link)
        with patch('app.story_cards.render_story', side_effect=AssertionError('Symlink background must not render')):
            response = self.preview(item['id'])
        self.assertEqual(response.status_code, 400)

    def test_saved_private_background_is_used_without_changing_original(self):
        item = self.add()
        background = self.service.data_dir / 'background.png'
        Image.new('RGB', (1080, 1920), '#772233').save(background)
        original = background.read_bytes()
        self.service.state.update({'story_background': str(background), 'story_headline': 'SAVED SETTINGS'})
        response = self.preview(item['id'])
        self.assertEqual(response.status_code, 200)
        with Image.open(io.BytesIO(response.data)) as preview:
            expected = tuple(round(a * .72 + b * .28) for a, b in zip((119, 34, 51), (8, 18, 37)))
            self.assertTrue(all(abs(a - b) < 5 for a, b in zip(preview.getpixel((15, 15)), expected)))
        self.assertEqual(background.read_bytes(), original)

    def test_parallel_previews_use_distinct_removed_temporary_outputs(self):
        first = self.add('a.png', '#ee2211')
        second = self.add('b.png', '#1166ee')
        output_paths, responses, errors = [], {}, []
        first_rendering, release_first = threading.Event(), threading.Event()
        def record_render(source, output, settings):
            output_paths.append(output)
            if len(output_paths) == 1:
                first_rendering.set()
                if not release_first.wait(10):
                    raise AssertionError('Test release timed out')
            return render_story(source, output, settings)
        def request_preview(name, item):
            try:
                with self.admin.test_client() as client:
                    responses[name] = client.get('/api/story/preview', query_string={'post_id': item['id']},
                                                  environ_overrides=self.source)
            except BaseException as error:
                errors.append(error)
        with patch('app.story_cards.render_story', side_effect=record_render):
            one = threading.Thread(target=request_preview, args=('first', first))
            two = threading.Thread(target=request_preview, args=('second', second))
            one.start()
            try:
                self.assertTrue(first_rendering.wait(5))
                two.start()
            finally:
                release_first.set()
                one.join(15)
                if two.ident is not None:
                    two.join(15)
        self.assertFalse(one.is_alive())
        self.assertFalse(two.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(set(output_paths)), 2)
        self.assertTrue(all(not path.parent.exists() for path in output_paths))
        for name, expected in (('first', (238, 34, 17)), ('second', (17, 102, 238))):
            self.assertEqual(responses[name].status_code, 200)
            with Image.open(io.BytesIO(responses[name].data)) as preview:
                self.assertTrue(all(abs(a - b) < 8 for a, b in zip(preview.getpixel((540, 1000)), expected)))
        self.assertEqual(self.service.queue.history(), [])
