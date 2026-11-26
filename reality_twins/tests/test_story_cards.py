import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from app.story_cards import render_story


class StoryCardsTests(unittest.TestCase):
    def test_portrait_square_and_landscape_keep_a_circle_round(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for size in ((1080, 1350), (1080, 1080), (1800, 1000)):
                with self.subTest(size=size):
                    source = root / 'post.png'
                    post = Image.new('RGB', size, 'black')
                    x, y = size[0] // 2, size[1] // 2
                    ImageDraw.Draw(post).ellipse((x-200, y-200, x+200, y+200), fill='#00ff00')
                    post.save(source)
                    before = source.read_bytes()
                    with Image.open(render_story(source, root / 'story.jpg', {})) as image:
                        pixels = image.crop((90, 464, 990, 1589)).convert('RGB')
                        mask = Image.new('1', pixels.size)
                        mask.putdata([g > 180 and r < 40 and b < 40 for r, g, b in pixels.getdata()])
                        left, top, right, bottom = mask.getbbox()
                        self.assertLessEqual(abs((right-left) - (bottom-top)), 2)
                        expected = 401 * min(900 / size[0], 1125 / size[1])
                        self.assertAlmostEqual(right-left, expected, delta=3)
                    self.assertEqual(source.read_bytes(), before)

    def test_full_feed_and_brand_safe_area_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'post.png'
            post = Image.new('RGB', (1080, 1350), '#267a36')
            draw = ImageDraw.Draw(post)
            for rectangle, color in (((0, 0, 100, 100), 'red'), ((979, 0, 1079, 100), 'blue'),
                                     ((0, 1249, 100, 1349), 'yellow'), ((979, 1249, 1079, 1349), 'white')):
                draw.rectangle(rectangle, fill=color)
            post.save(source)
            before = source.read_bytes()
            result = render_story(source, root / 'story.jpg', {})
            with Image.open(result) as image:
                self.assertEqual((image.size, image.mode), ((1080, 1920), 'RGB'))
                for point, expected in (((120, 494), (255, 0, 0)), ((960, 494), (0, 0, 255)),
                                        ((120, 1559), (255, 255, 0)), ((960, 1559), (255, 255, 255))):
                    self.assertTrue(all(abs(a - b) < 12 for a, b in zip(image.getpixel(point), expected)))
                self.assertNotEqual(image.getpixel((30, 30)), image.getpixel((1050, 1890)))
            self.assertEqual(source.read_bytes(), before)

    def test_render_is_repeatable_and_unknown_template_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'post.png'
            Image.new('RGB', (1080, 1350), '#276c51').save(source)
            one = render_story(source, root / 'one.jpg', {})
            two = render_story(source, root / 'two.jpg', {})
            self.assertEqual(one.read_bytes(), two.read_bytes())
            with self.assertRaises(ValueError):
                render_story(source, root / 'wrong.jpg', {'story_template': 'unknown'})
            with self.assertRaisesRegex(ValueError, 'too long to fit'):
                render_story(source, root / 'overflow.jpg', {'story_footer': 'W' * 160})
