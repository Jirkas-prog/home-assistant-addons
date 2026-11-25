"""Validate a whole upload before adding its image/caption pairs to the queue."""
import io
from pathlib import Path

from PIL import Image
from werkzeug.utils import secure_filename

from .photo_validation import validate_photo_dimensions


IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png'}
ORPHAN_CAPTION = 'Upload each TXT together with its matching JPG or PNG. For photos already in the queue, use Edit text.'


def _validate_image(data):
    with Image.open(io.BytesIO(data)) as image:
        if image.format not in ('JPEG', 'PNG'):
            raise ValueError('Only JPEG, PNG and TXT files are supported.')
        image.verify()
    with Image.open(io.BytesIO(data)) as image:
        validate_photo_dimensions(image)
        image.load()


def _pairs(images, names, used_captions=()):
    """Reject ambiguous stems, including two images that would create one TXT."""
    owners = {name.casefold(): None for name in used_captions}
    pairs = {}
    for name in images:
        stem = Path(name).stem
        candidates = [stem + '.txt', stem + '__caption.txt']
        present = [names[candidate.casefold()] for candidate in candidates if candidate.casefold() in names]
        if len(present) > 1:
            raise ValueError(f'Multiple caption files for {name}; keep only one.')
        caption = present[0] if present else candidates[0]
        if caption.casefold() in owners:
            raise ValueError(f'Multiple images share the caption {caption}.')
        owners[caption.casefold()] = name
        pairs[name] = caption
    # Empty captions generated for another image must not create a second match.
    planned_names = set(names) | set(owners)
    for name in images:
        stem = Path(name).stem.casefold()
        if stem + '.txt' in planned_names and stem + '__caption.txt' in planned_names:
            raise ValueError(f'Multiple caption files for {name}; keep only one.')
    return pairs


def import_posts(queue, files):
    """Caller holds queue_guard; the queue lock also excludes caption/claim races."""
    if not files or len(files) > 200:
        raise ValueError('Choose between 1 and 200 image or caption files.')
    uploaded = {}
    for file in files:
        name = secure_filename(file.filename or '')
        suffix = Path(name).suffix.lower()
        if not name or suffix not in IMAGE_SUFFIXES | {'.txt'}:
            raise ValueError('Only JPEG, PNG and TXT files are supported.')
        name = Path(name).stem + suffix
        if name.casefold() in {existing.casefold() for existing in uploaded}:
            raise ValueError('A file with this name already exists. Rename the imported file first.')
        data = file.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024:
            raise ValueError('Each uploaded file must be smaller than 16 MB.')
        if suffix == '.txt':
            if len(data.decode('utf-8-sig')) > 2200:
                raise ValueError('Captions must have at most 2200 characters.')
        else:
            _validate_image(data)
        uploaded[name] = data

    images = sorted((name for name in uploaded if Path(name).suffix in IMAGE_SUFFIXES),
                    key=lambda name: (name.casefold(), name))
    pairs = _pairs(images, {name.casefold(): name for name in uploaded})
    if any(name not in pairs.values() for name in uploaded if name.endswith('.txt')):
        raise ValueError(ORPHAN_CAPTION)
    # Pairs selected from Windows must also match on the case-sensitive HA disk.
    for image, caption in pairs.items():
        if caption not in uploaded:
            continue
        suffix = '__caption.txt' if caption.casefold() == (Path(image).stem + '__caption.txt').casefold() else '.txt'
        canonical = Path(image).stem + suffix
        if canonical != caption:
            uploaded[canonical] = uploaded.pop(caption)

    with queue.lock:
        active = queue.list_items()  # Completes any existing rename journal first.
        if any(item['status'] == 'publishing' for item in active):
            raise ValueError('Publishing is in progress. Add posts after it finishes.')
        disk = {path.name.casefold(): path for path in queue.queue_dir.iterdir()}
        if any(name.casefold() in disk for name in uploaded):
            raise ValueError('A file with this name already exists. Rename the imported file first.')
        known = {item['filename'].casefold() for item in active}
        pending = [path.name for key, path in disk.items()
                   if path.suffix.lower() in IMAGE_SUFFIXES and key not in known and not path.name.startswith('.')]
        names = {key: path.name for key, path in disk.items()}
        names.update({name.casefold(): name for name in uploaded})
        combined = _pairs(pending + images, names, (item['caption_filename'] for item in active))
        for name in pending:
            path = queue.queue_dir / name
            if path.is_symlink() or not path.is_file():
                raise ValueError('The item is not a regular file.')
            if path.stat().st_size > 16 * 1024 * 1024:
                raise ValueError('Each uploaded file must be smaller than 16 MB.')
            _validate_image(path.read_bytes())
        for image, caption in combined.items():
            path = disk.get(caption.casefold())
            if path is not None:
                if path.is_symlink() or not path.is_file():
                    raise ValueError('The item is not a regular file.')
                if caption not in (Path(image).stem + '.txt', Path(image).stem + '__caption.txt'):
                    raise ValueError('Existing TXT filenames must match their image filenames exactly, including letter case.')
                if len(path.read_text('utf-8-sig')) > 2200:
                    raise ValueError('Captions must have at most 2200 characters.')

        # Existing unmanaged files must be importable before uploaded files are written.
        baseline = queue.scan()
        baseline_ids = {item['id'] for item in baseline}
        disk = {path.name.casefold(): path for path in queue.queue_dir.iterdir()}
        if any(name.casefold() in disk for name in uploaded):
            raise ValueError('A file with this name already exists. Rename the imported file first.')
        pairs = _pairs(images, {**{key: path.name for key, path in disk.items()},
                               **{name.casefold(): name for name in uploaded}},
                       (item['caption_filename'] for item in baseline))
        complete_pairs = []
        for image, caption in pairs.items():
            existing_caption = disk.get(caption.casefold())
            caption_bytes = (existing_caption.read_bytes() if existing_caption else uploaded.get(caption, b''))
            complete_pairs.append({'filename': image, 'image': uploaded[image], 'caption': caption_bytes,
                                   'caption_source': existing_caption.name if existing_caption else None})
        result = queue.import_pairs(complete_pairs)
        imported = [item for item in result if item['id'] not in baseline_ids]
        return {'ok': True, 'imported': len(imported),
                'captions_missing': sum(not item['caption'].strip() for item in imported)}
