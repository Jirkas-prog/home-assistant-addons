"""A read-only media library with signed, root-confined file references."""
import hashlib
import os
from pathlib import Path
import re
import threading
import time

from flask import Blueprint, Response, abort, jsonify, request, send_file
from itsdangerous import BadSignature, URLSafeSerializer

VIDEO_TYPES = {'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
               '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
               '.ts': 'video/mp2t', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg', '.ogv': 'video/ogg'}


class MediaLibrary:
    def __init__(self, settings, secret):
        self.settings = settings
        self.signer = URLSafeSerializer(secret, salt='media-file-v1')
        self.lock = threading.Lock()
        self.cache = None
        self.cached_at = 0
        self.cached_roots = []

    def roots(self):
        cfg = self.settings.get()
        allowed = [Path('/media').resolve(), Path('/share').resolve()] if os.environ.get('SUPERVISOR_TOKEN') else [self.settings.path.parent.resolve()]
        result = []
        for name in [cfg['download_dir'], *cfg['media_dirs']]:
            root = Path(name).resolve()
            if root not in result and any(root == base or base in root.parents for base in allowed):
                result.append(root)
        return [root for root in result if not any(parent in root.parents for parent in result)]

    def identify(self, path, root):
        return self.signer.dumps([str(root), path.relative_to(root).as_posix()])

    def resolve(self, file_id, subtitles=False):
        if len(file_id) > 4096:
            abort(404)
        try:
            root_name, relative = self.signer.loads(file_id)
            root = Path(root_name)
            path = (root / relative).resolve()
            extensions = {'.srt', '.vtt'} if subtitles else VIDEO_TYPES
            if root not in self.roots() or root not in path.parents or path.suffix.lower() not in extensions or not path.is_file():
                abort(404)
            return path, root
        except (BadSignature, ValueError, TypeError, OSError):
            abort(404)

    def listing(self, refresh=False):
        roots = self.roots()
        with self.lock:
            if not refresh and self.cache is not None and roots == self.cached_roots and time.monotonic() - self.cached_at < 20:
                return self.cache
            items, unavailable, scanned, truncated = [], [], 0, False
            for root in roots:
                if not root.is_dir():
                    unavailable.append(str(root))
                    continue
                def on_error(error):
                    if str(root) not in unavailable:
                        unavailable.append(str(root))
                for directory, dirs, files in os.walk(root, followlinks=False, onerror=on_error):
                    dirs[:] = [name for name in dirs if not name.startswith('.') and not (Path(directory) / name).is_symlink()]
                    if len(Path(directory).relative_to(root).parts) >= 16:
                        dirs.clear()
                    scanned += len(files) + len(dirs)
                    for name in files:
                        if name.startswith('.') or Path(name).suffix.lower() not in VIDEO_TYPES:
                            continue
                        try:
                            path = (Path(directory) / name).resolve()
                            if root not in path.parents or not path.is_file():
                                continue
                            stat = path.stat()
                            if stat.st_size <= 0:
                                continue
                            items.append({'id': self.identify(path, root), 'name': name,
                                          'folder': str(root), 'relative': str(path.relative_to(root).parent),
                                          'size': stat.st_size, 'modified': stat.st_mtime,
                                          'format': path.suffix[1:].upper(), 'mime': VIDEO_TYPES[path.suffix.lower()]})
                            if len(items) >= 5000:
                                truncated = True
                                break
                        except OSError:
                            continue
                    if scanned >= 20000 or len(items) >= 5000:
                        truncated = True
                        break
                if truncated:
                    break
            unique = {item['id']: item for item in items}
            self.cache = {'items': sorted(unique.values(), key=lambda item: (-item['modified'], item['name'].casefold())),
                          'folders': [str(root) for root in roots], 'unavailable': unavailable, 'truncated': truncated}
            self.cached_roots, self.cached_at = roots, time.monotonic()
            return self.cache

    def details(self, file_id):
        path, root = self.resolve(file_id)
        stat = path.stat()
        tracks = []
        for sidecar in sorted(path.parent.iterdir()):
            stem, prefix = sidecar.stem.casefold(), path.stem.casefold()
            if sidecar.suffix.lower() not in ('.srt', '.vtt') or not (stem == prefix or stem.startswith(prefix + '.')):
                continue
            resolved = sidecar.resolve()
            if root not in resolved.parents or not resolved.is_file():
                continue
            label = sidecar.stem[len(path.stem):].strip('.') or 'Subtitles'
            language = label.lower().split('.')[0]
            language = {'cz': 'cs', 'cze': 'cs', 'eng': 'en'}.get(language, language)
            tracks.append({'id': self.identify(resolved, root), 'label': label,
                           'language': language if re.fullmatch(r'[a-z]{2,3}', language) else 'und'})
            if len(tracks) == 16:
                break
        key = hashlib.sha256(f'{path}:{stat.st_size}:{stat.st_mtime_ns}'.encode()).hexdigest()
        return {'id': file_id, 'name': path.name, 'size': stat.st_size, 'mime': VIDEO_TYPES[path.suffix.lower()],
                'resume_key': key, 'tracks': tracks, 'format': path.suffix[1:].upper()}


def install_media(app, settings, secret):
    library = MediaLibrary(settings, secret)
    app.extensions['media'] = library
    routes = Blueprint('media', __name__)

    @routes.get('/api/library')
    def listing():
        result = library.listing(request.args.get('refresh') == '1')
        query = request.args.get('q', '').strip().casefold()[:300]
        folder = request.args.get('folder', '')
        items = [item for item in result['items'] if (not query or query in item['name'].casefold())
                 and (not folder or item['folder'] == folder)]
        try:
            page = max(0, min(10000, int(request.args.get('page', '0'))))
        except ValueError:
            abort(400)
        return jsonify(**{key: value for key, value in result.items() if key != 'items'},
                       items=items[page * 24:(page + 1) * 24], total=len(items), page=page)

    @routes.get('/api/media/<file_id>')
    def details(file_id):
        return jsonify(library.details(file_id))

    @routes.get('/api/media/<file_id>/stream')
    def stream(file_id):
        path, _ = library.resolve(file_id)
        # Werkzeug implements byte ranges, conditional requests and HEAD without
        # reading the movie into memory. Waitress applies bounded output buffering.
        return send_file(path, mimetype=VIDEO_TYPES[path.suffix.lower()], conditional=True,
                         as_attachment=request.args.get('download') == '1', download_name=path.name)

    @routes.get('/api/media/<file_id>/subtitle')
    def subtitle(file_id):
        path, _ = library.resolve(file_id, subtitles=True)
        if path.stat().st_size > 2_000_000:
            abort(413)
        raw = path.read_bytes()
        try:
            text = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            text = raw.decode('cp1250')
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        if path.suffix.lower() == '.srt':
            text = re.sub(r'(\d{2}:\d{2}:\d{2}),(\d{3})', r'\1.\2', text)
            text = 'WEBVTT\n\n' + text
        elif not text.startswith('WEBVTT'):
            abort(415)
        return Response(text, mimetype='text/vtt')

    app.register_blueprint(routes)
