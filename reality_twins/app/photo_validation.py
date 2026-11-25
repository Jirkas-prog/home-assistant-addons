"""Image limits shared by upload preflight and publishing preparation."""


def validate_photo_dimensions(image):
    width, height = image.size
    if width * height > 40_000_000:
        raise ValueError('The image is too large; use at most 40 megapixels.')
    # Instagram receives the EXIF-transposed image, not the stored orientation.
    if image.getexif().get(274) in (5, 6, 7, 8):
        width, height = height, width
    if not 0.8 <= width / height <= 1.91:
        raise ValueError('Instagram photos must have an aspect ratio between 4:5 and 1.91:1.')
    if width < 320:
        raise ValueError('Instagram photos must be at least 320 pixels wide.')
