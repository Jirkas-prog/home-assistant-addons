"""Copy complete, settled photo/caption pairs into the managed queue once.

The source folder is read-only from this module's perspective. The queue database
is the durable import receipt, including after a post moves to PUBLISHED, so a
crash after committing a pair cannot cause another import on restart.
"""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import stat
import threading
import time

from .importing import IMAGE_SUFFIXES, _validate_image


FOLDER_ERROR = 'Choose an existing import folder inside a mounted share or media folder.'
OVERLAP_ERROR = 'The import folder must be separate from the publishing queue, archive and private app data.'
LINK_ERROR = 'Symbolic links are not allowed in the import folder path.'
READ_ERROR = 'The import folder could not be read. Check that the storage is connected and readable.'
CHANGED_ERROR = 'The source files changed while being read. They will be checked again.'
MAX_IMAGE_BYTES = 16 * 1024 * 1024
MAX_CAPTION_BYTES = 16 * 1024
MAX_BATCH_BYTES = 64 * 1024 * 1024
MAX_BATCH_POSTS = 100


def _inside(path, root):
    return path == root or root in path.parents


def _signature(info):
    # On Windows Python versions differ in whether stat/fstat ctime is birth or
    # change time; the descriptor and pathname must use comparable fields.
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns if os.name != 'nt' else 0)


def _is_link(path):
    # Windows junctions are directory reparse points rather than is_symlink().
    return path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction())


class FolderImporter:
    def __init__(self, queue, roots=('/share', '/media'), settle_seconds=10, clock=time.monotonic):
        self.queue = queue
        self.roots = tuple(Path(root).absolute() for root in roots)
        self.settle_seconds = settle_seconds
        self.clock = clock
        self.lock = threading.RLock()
        self._observed = {}
        self._folder = None

    def _validate(self, value, browse=False):
        if not isinstance(value, str) or not value.strip() or len(value) > 4096 or '\x00' in value:
            raise ValueError(FOLDER_ERROR)
        path = Path(value)
        if not path.is_absolute() or '..' in path.parts:
            raise ValueError(FOLDER_ERROR)
        root = next((root for root in self.roots if _inside(path, root)), None)
        if root is None:
            raise ValueError(FOLDER_ERROR)
        try:
            for component in (path, *path.parents):
                if _is_link(component):
                    raise ValueError(LINK_ERROR)
            resolved = path.resolve(strict=True)
            resolved_root = root.resolve(strict=True)
            if not _inside(resolved, resolved_root) or not resolved.is_dir():
                raise ValueError(FOLDER_ERROR)
        except OSError:
            raise ValueError(FOLDER_ERROR) from None
        protected = (self.queue.queue_dir, self.queue.archive_dir, self.queue.data_dir)
        # Browsing a parent is useful, selecting it would also encompass managed
        # data and is deliberately disallowed even though imports are not recursive.
        if any(_inside(resolved, p) or (not browse and _inside(p, resolved)) for p in protected):
            raise ValueError(OVERLAP_ERROR)
        return resolved, resolved_root

    def validate_folder(self, value):
        return str(self._validate(value)[0])

    def browse(self, value=''):
        roots = []
        for root in self.roots:
            try:
                roots.append(str(self._validate(str(root), browse=True)[0]))
            except ValueError:
                continue
        if not value:
            return {'path': '', 'parent': '', 'roots': roots,
                    'folders': [{'name': Path(root).name, 'path': root, 'selectable': self._selectable(root)}
                                for root in roots]}
        folder, root = self._validate(value, browse=True)
        try:
            children = []
            for path in folder.iterdir():
                if path.name.startswith('.') or _is_link(path) or not path.is_dir():
                    continue
                try:
                    canonical = self._validate(str(path), browse=True)[0]
                    children.append({'name': path.name, 'path': str(canonical),
                                     'selectable': self._selectable(str(canonical))})
                except ValueError:
                    continue
        except OSError:
            raise ValueError(READ_ERROR) from None
        return {'path': str(folder), 'parent': '' if folder == root else str(folder.parent),
                'roots': roots, 'selectable': self._selectable(str(folder)),
                'folders': sorted(children, key=lambda p: (p['name'].casefold(), p['name']))}

    def _selectable(self, value):
        try:
            self._validate(value)
            return True
        except ValueError:
            return False

    @contextmanager
    def _directory(self, folder, root):
        """Keep Linux directory handles open while reading; never follow a swap.

        HA runs on Linux. The checked path fallback keeps isolated Windows tests
        useful without requiring Unix directory-descriptor support.
        """
        descriptor = None
        if os.open in os.supports_dir_fd and hasattr(os, 'O_NOFOLLOW'):
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            descriptor = os.open(root, flags)
            try:
                for component in folder.relative_to(root).parts:
                    child = os.open(component, flags, dir_fd=descriptor)
                    os.close(descriptor)
                    descriptor = child
                yield descriptor
            finally:
                os.close(descriptor)
        else:
            self._validate(str(folder))
            yield None

    def _stat(self, folder, name, descriptor):
        if descriptor is not None:
            info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        else:
            self._validate(str(folder))
            info = (folder / name).lstat()
        if not stat.S_ISREG(info.st_mode):
            raise ValueError('Import each photo and caption as regular files, not links or folders.')
        return _signature(info)

    def _read(self, folder, name, descriptor, expected, limit):
        flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
        if descriptor is None:
            self._validate(str(folder))
        fd = os.open(name if descriptor is not None else folder / name, flags,
                     **({'dir_fd': descriptor} if descriptor is not None else {}))
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or _signature(info) != expected:
                raise ValueError(CHANGED_ERROR)
            payload = stream.read(limit + 1)
            if len(payload) > limit:
                raise ValueError('Import photos smaller than 16 MB and captions with at most 2200 characters.')
            if _signature(os.fstat(stream.fileno())) != expected:
                raise ValueError(CHANGED_ERROR)
        if self._stat(folder, name, descriptor) != expected:
            raise ValueError(CHANGED_ERROR)
        return payload

    def scan(self, value):
        """Caller holds service.queue_guard. Errors never mutate the source.

        Each errors entry is {filename, message}; an invalid root raises ValueError.
        New pairs require two identical observations separated by settle_seconds.
        The returned pending count includes missing captions and changing pairs.
        """
        with self.lock:
            folder, root = self._validate(value)
            if folder != self._folder:
                self._folder, self._observed = folder, {}
            report = {'imported': 0, 'pending': 0, 'duplicates': 0, 'errors': []}
            observed, prepared, total_bytes = {}, [], 0
            now = self.clock()
            with self.queue.lock:
                self.queue.list_items()  # Recover an interrupted durable import.
                seen = {row[0] for row in self.queue.db.execute('SELECT sha256 FROM items')}
            try:
                with self._directory(folder, root) as descriptor:
                    names = os.listdir(descriptor if descriptor is not None else folder)
                    candidates = {name.casefold(): name for name in names if not name.startswith('.')}
                    if len(candidates) != len([name for name in names if not name.startswith('.')]):
                        raise ValueError('Import filenames must be unique without regard to letter case.')
                    images = sorted((name for name in candidates.values() if Path(name).suffix.lower() in IMAGE_SUFFIXES),
                                    key=lambda name: (name.casefold(), name))
                    owners = {}
                    pairs = []
                    for image in images:
                        stem = Path(image).stem
                        captions = [candidates[c.casefold()] for c in (stem + '.txt', stem + '__caption.txt')
                                    if c.casefold() in candidates]
                        if len(captions) != 1:
                            if captions:
                                report['errors'].append({'filename': image, 'message': 'Keep only one TXT caption for each photo.'})
                            else:
                                report['pending'] += 1
                            continue
                        caption = captions[0]
                        owners.setdefault(caption, []).append(image)
                        pairs.append((image, caption))
                    for image, caption in pairs:
                        if len(owners[caption]) != 1:
                            report['errors'].append({'filename': image, 'message': 'Each photo must have its own matching TXT caption.'})
                            continue
                        try:
                            signature = (self._stat(folder, image, descriptor), self._stat(folder, caption, descriptor))
                            previous = self._observed.get(image)
                            unchanged_since = previous[1] if previous and previous[0] == signature else now
                            observed[image] = (signature, unchanged_since)
                            if now - unchanged_since < self.settle_seconds:
                                report['pending'] += 1
                                continue
                            if signature[0][2] > MAX_IMAGE_BYTES or signature[1][2] > MAX_CAPTION_BYTES:
                                raise ValueError('Import photos smaller than 16 MB and captions with at most 2200 characters.')
                            if len(prepared) >= MAX_BATCH_POSTS or total_bytes + sum(s[2] for s in signature) > MAX_BATCH_BYTES:
                                report['pending'] += 1
                                continue
                            photo = self._read(folder, image, descriptor, signature[0], MAX_IMAGE_BYTES)
                            digest = hashlib.sha256(photo).hexdigest()
                            if digest in seen:
                                report['duplicates'] += 1
                                continue
                            text = self._read(folder, caption, descriptor, signature[1], MAX_CAPTION_BYTES)
                            _validate_image(photo)
                            if len(text.decode('utf-8-sig')) > 2200:
                                raise ValueError('Captions must have at most 2200 characters.')
                            # Recheck both after reading: the writer could change the
                            # image while its caption was being read or decoded.
                            if signature != (self._stat(folder, image, descriptor), self._stat(folder, caption, descriptor)):
                                raise ValueError(CHANGED_ERROR)
                            prepared.append({'filename': image, 'image': photo, 'caption': text})
                            seen.add(digest)
                            total_bytes += len(photo) + len(text)
                        except (OSError, UnicodeError, ValueError) as error:
                            observed.pop(image, None)
                            message = str(error) if isinstance(error, ValueError) and not isinstance(error, UnicodeError) else READ_ERROR
                            report['errors'].append({'filename': image, 'message': message})
            except OSError:
                raise ValueError(READ_ERROR) from None
            self._observed = observed
            with self.queue.lock:
                # Finish any durable interrupted journal before reading receipts.
                active = self.queue.list_items()
                known = {row[0] for row in self.queue.db.execute('SELECT sha256 FROM items')}
                unique = []
                for pair in prepared:
                    digest = hashlib.sha256(pair['image']).hexdigest()
                    if digest in known:
                        report['duplicates'] += 1
                    else:
                        known.add(digest)
                        unique.append(pair)
                if any(item['status'] == 'publishing' for item in active):
                    report['pending'] += len(unique)
                elif unique:
                    self.queue.import_pairs(unique)
                    report['imported'] = len(unique)
            return report
