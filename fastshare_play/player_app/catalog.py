"""Persistent catalog and watch state. Media roots are always read-only."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from urllib.parse import urlsplit

from .nova import VIDEO_TYPES, IMAGE_TYPES, filename_metadata, nfo_metadata, nova_resume


def fingerprint(path):
    stat = path.stat()
    return f'{stat.st_size}:{stat.st_mtime_ns}'


class Catalog:
    def __init__(self, settings):
        self.settings = settings
        self.lock = threading.RLock()
        self.scan_lock = threading.Lock()
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.status = {'scanning': False, 'last_scan': 0, 'unavailable': [], 'truncated': False, 'error': '', 'matching': False}
        self.db = sqlite3.connect(str(settings.directory / 'library.sqlite3'), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, root TEXT NOT NULL,
                size INTEGER NOT NULL, modified REAL NOT NULL, fingerprint TEXT NOT NULL,
                added REAL NOT NULL, metadata TEXT NOT NULL, fallback TEXT NOT NULL,
                available INTEGER NOT NULL DEFAULT 1, match_status TEXT NOT NULL DEFAULT 'pending');
            CREATE TABLE IF NOT EXISTS progress (
                id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, position REAL NOT NULL DEFAULT 0,
                duration REAL NOT NULL DEFAULT 0, watched INTEGER NOT NULL DEFAULT 0,
                favorite INTEGER NOT NULL DEFAULT 0, updated REAL NOT NULL DEFAULT 0,
                external_stamp TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'web',
                session TEXT NOT NULL DEFAULT '', sequence INTEGER NOT NULL DEFAULT 0);
        ''')
        self.db.commit()
        self.matcher = None

    def query(self, sql, args=()):
        with self.lock: return [dict(row) for row in self.db.execute(sql, args).fetchall()]

    def roots(self):
        roots = [Path(root).resolve() for root in self.settings.get()['media_roots']]
        roots = [root for root in roots if any(root == base or base in root.parents for base in self.settings.allowed_roots())]
        return [root for root in roots if not any(other in root.parents for other in roots)]

    def resolve(self, file_id):
        rows = self.query('SELECT * FROM files WHERE id=? AND available=1', (file_id,))
        if not rows: raise FileNotFoundError()
        row = rows[0]; path = Path(row['path']).resolve(); root = Path(row['root'])
        if root not in self.roots() or root not in path.parents or not path.is_file() or path.suffix.lower() not in VIDEO_TYPES:
            raise FileNotFoundError()
        if fingerprint(path) != row['fingerprint']: raise ValueError('The file changed. Refresh the library before playing it.')
        return row, path, root

    @staticmethod
    def confined(path, root):
        resolved = path.resolve()
        return resolved if root in resolved.parents and resolved.is_file() else None

    def metadata_for(self, path, root, siblings):
        meta = filename_metadata(path)
        nfo = next((file for file in [path.with_suffix('.archos.nfo'), path.with_suffix('.nfo'), path.parent / 'movie.nfo']
                    if file in siblings and self.confined(file, root)), None)
        resume = None
        if nfo:
            try:
                data = nfo_metadata(nfo)
                if data:
                    meta.update({k: v for k, v in data.items() if v or k in ('season', 'episode')})
                    resume = {'position': data['position'], 'duration': data['runtime'], 'watched': data['watched'],
                              'lastplayed': data['lastplayed'] or (nfo.stat().st_mtime if data['position'] or data['watched'] else 0), 'external_stamp': f'{nfo.name}:{nfo.stat().st_mtime_ns}'}
            except (OSError, ValueError):
                # Bad sidecars cannot stop indexing the rest of the library.
                meta['metadata_warning'] = 'The local metadata file could not be read.'
        if meta['kind'] == 'episode':
            for parent in [path.parent, path.parent.parent]:
                show_nfo = parent / 'tvshow.nfo'
                if root not in show_nfo.resolve().parents: continue
                if show_nfo.is_file():
                    try:
                        show = nfo_metadata(show_nfo)
                        for key in ('genres', 'poster', 'backdrop', 'cast', 'studios'):
                            if not meta.get(key): meta[key] = show.get(key, [] if key in ('genres', 'cast', 'studios') else '')
                        meta['show'] = meta.get('show') or show.get('title', '')
                    except (OSError, ValueError): pass
                    break
        for kind, suffix in [('poster', 'poster'), ('backdrop', 'fanart')]:
            candidates = [path.with_name(path.stem + '-' + suffix + '.archos.jpg'), path.with_name(path.stem + '-' + suffix + '.jpg'),
                          path.with_name(path.name + '-' + suffix + '.jpg'), path.parent / (suffix + '.jpg')]
            if kind == 'poster': candidates += [path.with_suffix('.jpg'), path.parent / 'folder.jpg']
            local = next((candidate for candidate in candidates if candidate in siblings and self.confined(candidate, root)), None)
            if local: meta[kind] = str(local)
            elif meta.get(kind) and not urlsplit(meta[kind]).scheme:
                candidate = (nfo.parent if nfo else path.parent) / meta[kind]
                meta[kind] = str(candidate.resolve()) if self.confined(candidate, root) else ''
        meta['gallery'] = [uri for uri in meta.get('gallery', []) if urlsplit(uri).scheme == 'https'][:10]
        if self.settings.get()['import_nova_resume']:
            prefix = '.' + path.name + '.'
            candidates = [file for file in siblings if file.name.startswith(prefix) and file.name.endswith('.archos.resume.xml') and self.confined(file, root)]
            for file in sorted(candidates, key=lambda item: item.stat().st_mtime, reverse=True):
                try:
                    external = nova_resume(file, path.name)
                    if external:
                        external['duration'] = meta.get('runtime', 0)
                        if not external['duration'] and 0 < external['percent'] < 100:
                            external['duration'] = external['position'] * 100 / external['percent']
                        if not resume or external['lastplayed'] >= resume['lastplayed']: resume = external
                        break
                except (OSError, ValueError): continue
        return meta, resume

    def scan(self):
        if not self.scan_lock.acquire(blocking=False): return
        self.status.update(scanning=True, error='', truncated=False, unavailable=[])
        now = time.time(); seen = set(); readable = []; count = 0; entries = 0
        try:
            for root in self.roots():
                if not root.is_dir():
                    self.status['unavailable'].append(str(root)); continue
                failed = []
                def on_error(error): failed.append(True)
                for directory, dirs, names in os.walk(root, followlinks=False, onerror=on_error):
                    dirs[:] = [name for name in dirs if not name.startswith('.') and not (Path(directory) / name).is_symlink()]
                    if len(Path(directory).relative_to(root).parts) >= 16: dirs.clear()
                    siblings = {Path(directory) / name for name in names}
                    entries += len(names) + len(dirs)
                    for path in sorted(siblings):
                        if path.name.startswith('.') or path.suffix.lower() not in VIDEO_TYPES or path.is_symlink(): continue
                        try:
                            if not self.confined(path, root): continue
                            stat = path.stat()
                            if stat.st_size == 0: continue
                            identity = hashlib.sha256(str(path).encode()).hexdigest()[:32]
                            stamp = fingerprint(path)
                            meta, resume = self.metadata_for(path, root, siblings)
                            with self.lock:
                                actual = meta
                                state = 'local' if meta.get('source') == 'nfo' else 'filename'
                                self.db.execute('''INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?,1,?)
                                    ON CONFLICT(id) DO UPDATE SET root=excluded.root,size=excluded.size,modified=excluded.modified,
                                    fingerprint=excluded.fingerprint,metadata=excluded.metadata,fallback=excluded.fallback,available=1,match_status=excluded.match_status''',
                                    (identity, str(path), str(root), stat.st_size, stat.st_mtime, stamp, now,
                                     json.dumps(actual, ensure_ascii=False), json.dumps(meta, ensure_ascii=False), state))
                                self.db.execute('INSERT OR IGNORE INTO progress(id,fingerprint) VALUES(?,?)', (identity, stamp))
                                self.db.execute("UPDATE progress SET fingerprint=?,position=0,duration=0,watched=0,updated=0,session='',external_stamp='' WHERE id=? AND fingerprint<>?", (stamp, identity, stamp))
                                if resume and self.settings.get()['import_nova_resume']:
                                    current = self.db.execute('SELECT updated,external_stamp FROM progress WHERE id=?', (identity,)).fetchone()
                                    timestamp = min(resume['lastplayed'], now)
                                    if resume['external_stamp'] != current['external_stamp'] and timestamp > current['updated']:
                                        self.db.execute("UPDATE progress SET position=?,duration=?,watched=?,updated=?,external_stamp=?,source='nova',session='' WHERE id=?",
                                                        (resume['position'], resume.get('duration', 0), int(resume['watched']), timestamp, resume['external_stamp'], identity))
                                self.db.commit()
                            count += 1; seen.add(identity)
                        except (OSError, ValueError): continue
                        if count >= 5000 or entries >= 30000: break
                    if count >= 5000 or entries >= 30000:
                        self.status['truncated'] = True; break
                if failed: self.status['unavailable'].append(str(root))
                else: readable.append(str(root))
                if self.status['truncated']: break
            if not self.status['truncated']:
                with self.lock:
                    for row in self.db.execute('SELECT id,root FROM files').fetchall():
                        if row['root'] in readable and row['id'] not in seen: self.db.execute('UPDATE files SET available=0 WHERE id=?', (row['id'],))
                    self.db.commit()
            self.status['last_scan'] = now
        except Exception:
            self.status['error'] = 'The library scan could not finish. Check the mounted folders.'
        finally:
            self.status['scanning'] = False; self.scan_lock.release()

    def all_items(self):
        roots = {str(root) for root in self.roots()}
        previews = {item['id']: item for item in self.query('SELECT * FROM previews')} if self.matcher else {}
        rows = self.query('''SELECT files.*, progress.position,progress.duration,progress.watched,progress.favorite,
                             progress.updated,progress.source AS progress_source FROM files LEFT JOIN progress USING(id) WHERE available=1''')
        items = []
        for row in rows:
            if row['root'] not in roots: continue
            meta = json.loads(row['metadata'])
            poster, backdrop = meta.pop('poster', ''), meta.pop('backdrop', '')
            gallery = meta.pop('gallery', [])
            preview = previews.get(row['id'])
            preview_status = preview['status'] if preview and preview['fingerprint'] == row['fingerprint'] else 'pending'
            ready = preview_status == 'ready'
            local_poster = bool(poster and not urlsplit(poster).scheme)
            for key in ('position', 'lastplayed', 'external_stamp', 'watched'): meta.pop(key, None)
            item = {**meta, 'id': row['id'], 'filename': Path(row['path']).name, 'format': Path(row['path']).suffix[1:].upper(),
                    'size': row['size'], 'added': row['added'], 'modified': row['modified'],
                    'folder': Path(row['root']).name, 'root': row['root'], 'match_status': row['match_status'],
                    'position': row['position'] or 0, 'duration': (preview['duration'] if ready else 0) or row['duration'] or meta.get('runtime', 0),
                    'watched': bool(row['watched']), 'favorite': bool(row['favorite']), 'lastplayed': row['updated'] or 0,
                    'progress_source': row['progress_source'], 'has_poster': local_poster or ready, 'has_backdrop': ready,
                    'local_poster': local_poster, 'generated_previews': ready, 'preview_status': preview_status,
                    'gallery_count': 3 if ready else 0}
            items.append(item)
        return items

    def listing(self, filters):
        all_items = self.all_items()
        selected = list(all_items)
        query = str(filters.get('q', '')).casefold().strip()[:300]
        if query:
            def fold(text):
                import unicodedata
                return ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c))
            selected = [item for item in selected if fold(query) in fold(' '.join([item['title'], item['filename'], item.get('show', ''), item.get('original_title', '')]))]
        for key in ('year', 'collection', 'show', 'root', 'kind'):
            if filters.get(key): selected = [item for item in selected if str(item.get(key, '')) == str(filters[key])]
        if filters.get('genre'): selected = [item for item in selected if filters['genre'] in item.get('genres', [])]
        view = filters.get('view', 'all')
        if view == 'continue': selected = [item for item in selected if item['position'] > 5 and not item['watched']]
        elif view == 'unwatched': selected = [item for item in selected if not item['watched']]
        elif view == 'favorites': selected = [item for item in selected if item['favorite']]
        elif view == 'unmatched': selected = [item for item in selected if item['source'] == 'filename']
        sorts = {'added': (lambda item: (item['added'], item['modified'], item['title']), True),
                 'year': (lambda item: (item.get('year', 0), item['title']), True),
                 'title': (lambda item: item['title'].casefold(), False),
                 'rating': (lambda item: (item.get('rating', 0), item['title']), True),
                 'played': (lambda item: (item['lastplayed'], item['title']), True),
                 'episode': (lambda item: (item.get('show', ''), item.get('season', 0), item.get('episode', 0)), False)}
        key, reverse = sorts.get(filters.get('sort'), sorts['added']); selected.sort(key=key, reverse=reverse)
        page = max(0, min(1000, int(filters.get('page', 0))))
        page = min(page, max(0, (len(selected) - 1) // 36))
        continuing = sorted([item for item in all_items if item['position'] > 5 and not item['watched']], key=lambda item: -item['lastplayed'])[:12]
        return {'items': selected[page * 36:(page + 1) * 36], 'total': len(selected), 'page': page, 'page_size': 36,
                'continue': continuing, 'stats': {'total': len(all_items), 'watching': len([i for i in all_items if i['position'] > 5 and not i['watched']]), 'watched': sum(i['watched'] for i in all_items),
                                                 'previews_ready': sum(i['generated_previews'] for i in all_items),
                                                 'previews_failed': sum(i['preview_status'] == 'failed' for i in all_items)},
                'facets': {'genres': sorted({genre for item in all_items for genre in item.get('genres', [])}),
                           'years': sorted({item['year'] for item in all_items if item.get('year')}, reverse=True),
                           'collections': sorted({item['collection'] for item in all_items if item.get('collection')}),
                           'shows': sorted({item['show'] for item in all_items if item.get('show')}),
                           'roots': sorted({item['root'] for item in all_items})}, 'status': dict(self.status)}

    def detail(self, file_id):
        row, path, root = self.resolve(file_id)
        item = next(item for item in self.all_items() if item['id'] == file_id)
        tracks = []
        for sidecar in sorted(path.parent.iterdir()):
            if sidecar.suffix.lower() not in ('.srt', '.vtt') or not self.confined(sidecar, root): continue
            if sidecar.stem != path.stem and not sidecar.stem.startswith(path.stem + '.'): continue
            label = sidecar.stem[len(path.stem):].strip('.') or 'Subtitles'
            lang = {'cz': 'cs', 'cze': 'cs', 'eng': 'en'}.get(label.split('.')[0].lower(), label.split('.')[0].lower())
            tracks.append({'index': len(tracks), 'label': label, 'language': lang if re.fullmatch('[a-z]{2,3}', lang) else 'und', 'path': str(sidecar)})
            if len(tracks) >= 16: break
        item['tracks'] = tracks
        if item['kind'] == 'episode':
            episodes = sorted([entry for entry in self.all_items() if entry.get('show') == item['show'] and entry['kind'] == 'episode'], key=lambda entry: (entry['season'], entry['episode']))
            index = next((index for index, entry in enumerate(episodes) if entry['id'] == file_id), -1)
            item['next_episode'] = episodes[index + 1]['id'] if 0 <= index < len(episodes) - 1 else None
        return item

    def begin_play(self, file_id):
        self.resolve(file_id)
        session = secrets.token_urlsafe(24)
        with self.lock:
            self.db.execute('UPDATE progress SET session=?,sequence=0 WHERE id=?', (session, file_id)); self.db.commit()
        return {'session': session, 'item': self.detail(file_id)}

    def progress(self, file_id, data):
        self.resolve(file_id)
        if set(data) - {'session', 'sequence', 'position', 'duration', 'ended'}: raise ValueError('Unknown playback field.')
        import math
        for key in ('position', 'duration'):
            if type(data.get(key)) not in (int, float) or not math.isfinite(data[key]): raise ValueError('Invalid playback position.')
        if not 0 < data['duration'] <= 604800 or not 0 <= data['position'] <= data['duration'] + 2: raise ValueError('Invalid playback position.')
        if type(data.get('sequence')) is not int or not 1 <= data['sequence'] <= 1_000_000: raise ValueError('Invalid playback sequence.')
        if type(data.get('ended', False)) is not bool or not isinstance(data.get('session'), str): raise ValueError('Invalid playback state.')
        with self.lock:
            row = self.db.execute('SELECT * FROM progress WHERE id=?', (file_id,)).fetchone()
            if row['session'] != data['session'] or data['sequence'] <= row['sequence']:
                return {'saved': False}
            watched = data.get('ended', False) or data['position'] >= data['duration'] * .95
            self.db.execute("UPDATE progress SET position=?,duration=?,watched=?,updated=?,sequence=?,source='web' WHERE id=?",
                            (0 if data.get('ended') else data['position'], data['duration'], int(watched), time.time(), data['sequence'], file_id))
            self.db.commit()
        return {'saved': True}

    def flags(self, file_id, data):
        self.resolve(file_id)
        if not data or set(data) - {'watched', 'favorite'} or any(type(value) is not bool for value in data.values()): raise ValueError('Invalid library action.')
        with self.lock:
            for key, value in data.items():
                self.db.execute(f'UPDATE progress SET {key}=? WHERE id=?', (int(value), file_id))
            if 'watched' in data:
                self.db.execute("UPDATE progress SET position=0,updated=?,session='',source='web' WHERE id=?", (time.time(), file_id))
            self.db.commit()

    def start(self):
        def loop():
            while not self.stop.is_set():
                self.wake.clear(); self.scan()
                if self.matcher and not self.stop.is_set(): self.matcher.auto_match()
                self.wake.wait(self.settings.get()['scan_interval'])
        self.thread = threading.Thread(target=loop, daemon=True, name='library-scan')
        self.thread.start()

    def close(self):
        self.stop.set(); self.wake.set()
        if hasattr(self, 'thread'): self.thread.join(timeout=20)
