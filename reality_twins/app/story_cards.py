"""Deterministic, full-post Instagram story cards (no external fonts or services)."""
import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


SIZE = (1080, 1920)
POST_BOX = (90, 464, 990, 1589)


def gradient_background():
    """Continuous warm/cool colour fields, kept quiet behind the post."""
    small = Image.new('RGB', (270, 480))
    pixels = small.load()
    for y in range(480):
        for x in range(270):
            u, v = x / 269, y / 479
            warm = math.exp(-(((u + .12) / .77) ** 2 + ((v - .07) / .47) ** 2))
            cool = math.exp(-(((u - 1.06) / .76) ** 2 + ((v - .89) / .57) ** 2))
            violet = math.exp(-(((u - .85) / .7) ** 2 + ((v - .17) / .45) ** 2))
            pixels[x, y] = tuple(min(255, round(base + warm * a + cool * b + violet * c))
                                for base, a, b, c in ((14, 217, 0, 39), (24, 90, 139, 19), (51, 22, 152, 59)))
    return small.resize(SIZE, Image.Resampling.BICUBIC)


def _font(size, bold=False):
    name = 'LiberationSans-Bold.ttf' if bold else 'LiberationSans-Regular.ttf'
    candidates = [Path('/usr/share/fonts/truetype/liberation2') / name,
                  Path('/usr/share/fonts/truetype/liberation') / name,
                  Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / ('arialbd.ttf' if bold else 'arial.ttf')]
    for path in candidates:
        if path.is_file():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


def _text(draw, value, top, size, width=900, bold=False, fill='#ffffff'):
    font = _font(size, bold)
    while draw.textbbox((0, 0), value, font=font)[2] > width and size > 16:
        size -= 1
        font = _font(size, bold)
    if draw.textbbox((0, 0), value, font=font)[2] > width:
        raise ValueError('The story label is too long to fit. Shorten the text and preview it again.')
    draw.text((SIZE[0] // 2, top), value, font=font, fill=fill, anchor='mt')


def render_story(post_path, output_path, settings):
    """Render a 1080×1920 JPEG, retaining every pixel of the feed composition.

    Settings and any custom private background are validated/snapshotted by the
    service before this function runs. The default design needs no brand asset.
    """
    if settings.get('story_template', 'contrast_v1') != 'contrast_v1':
        raise ValueError('Choose an available story template.')
    background = settings.get('story_background', '')
    if background:
        with Image.open(background) as original:
            image = ImageOps.fit(ImageOps.exif_transpose(original).convert('RGB'), SIZE,
                                 method=Image.Resampling.LANCZOS)
        image = Image.blend(image, Image.new('RGB', SIZE, '#081225'), .28)
    else:
        image = gradient_background()
    image = image.convert('RGBA')
    draw = ImageDraw.Draw(image)
    # Safe areas keep copy away from Instagram's account and reply controls.
    _text(draw, settings.get('story_brand_name', 'Czech This View').upper(), 224, 35, bold=True)
    _text(draw, settings.get('story_headline', 'NEW POST').upper(), 292, 112, bold=True)
    draw.line((490, 423, 590, 423), fill='#71e2de', width=5)

    with Image.open(post_path) as original:
        post = ImageOps.exif_transpose(original).convert('RGB')
        post.thumbnail((900, 1125), Image.Resampling.LANCZOS)
    left = (1080 - post.width) // 2
    top = POST_BOX[1] + (1125 - post.height) // 2
    shadow = Image.new('RGBA', SIZE)
    ImageDraw.Draw(shadow).rectangle((left, top + 14, left + post.width, top + post.height + 14),
                                    fill=(0, 0, 0, 110))
    image = Image.alpha_composite(image, shadow.filter(ImageFilter.GaussianBlur(24)))
    image.paste(post, (left, top))
    draw = ImageDraw.Draw(image)
    _text(draw, settings.get('story_footer', 'YOUR TAKE? JOIN THE CONVERSATION.').upper(),
          1641, 32, bold=True)
    _text(draw, 'SEE THE LATEST POST ON OUR PROFILE', 1700, 22, fill='#deedf5')
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix('.tmp')
    image.convert('RGB').save(temporary, format='JPEG', quality=95, subsampling=0)
    os.replace(temporary, output_path)
    return output_path
