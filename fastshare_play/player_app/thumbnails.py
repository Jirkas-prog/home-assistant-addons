"""Three persistent local previews; one low-priority decoder at a time."""
import hashlib
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import threading
import time

from .nova import IMAGE_TYPES, number


class Thumbnails:
    def __init__(self, catalog):
        self.catalog = catalog
        self.cache = catalog.settings.directory / 'previews'
        self.cache.mkdir(exist_ok=True)
        self.lock = threading.Lock()
        self.error = ''
        self.catalog.db.execute('''CREATE TABLE IF NOT EXISTS previews (
            id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
            duration REAL NOT NULL DEFAULT 0, times TEXT NOT NULL DEFAULT '[]',
            updated REAL NOT NULL DEFAULT 0)''')
        self.catalog.db.commit()

    def prefix(self, row):
        return row['id'] + '-' + hashlib.sha256(row['fingerprint'].encode()).hexdigest()[:16]

    def files(self, row):
        prefix = self.prefix(row)
        return [self.cache / (prefix + f'-{i}.jpg') for i in range(3)]

    @staticmethod
    def run(arguments, timeout):
        command = arguments
        if os.name != 'nt' and shutil.which('nice'): command = ['nice', '-n', '15'] + command
        return subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              timeout=timeout, check=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)

    def state(self, file_id, stamp, status, duration=0, times=()):
        with self.catalog.lock:
            self.catalog.db.execute('INSERT OR REPLACE INTO previews VALUES(?,?,?,?,?,?)',
                                    (file_id, stamp, status, duration, json.dumps(times), time.time()))
            self.catalog.db.commit()

    def generate(self, item):
        row, path, _ = self.catalog.resolve(item['id'])
        targets = self.files(row)
        saved = self.catalog.query('SELECT * FROM previews WHERE id=?', (row['id'],))
        if saved and saved[0]['fingerprint'] == row['fingerprint']:
            if saved[0]['status'] == 'ready' and all(file.is_file() for file in targets): return False
            if saved[0]['status'] == 'failed' and time.time() - saved[0]['updated'] < 86400: return False
        self.catalog.status['matching'] = True
        self.state(row['id'], row['fingerprint'], 'processing')
        temporary = None
        try:
            result = self.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file', '-show_entries', 'format=duration', '-of', 'json', str(path)], 25)
            duration = number(json.loads(result.stdout).get('format', {}).get('duration'))
            if not 1 <= duration <= 604800: raise ValueError('Invalid video duration.')
            rng = random.Random(self.prefix(row))
            # One point from each third of the middle 60%; never opening/closing credits.
            times = [duration * (.2 + i * .2 + rng.uniform(.02, .18)) for i in range(3)]
            for index, target in enumerate(targets):
                if self.catalog.stop.is_set(): return
                temporary = target.with_suffix('.tmp.jpg')
                self.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                          '-protocol_whitelist', 'file', '-threads', '1', '-ss', str(round(times[index], 3)), '-i', str(path),
                          '-map', '0:v:0', '-frames:v', '1', '-an', '-sn', '-dn',
                          '-vf', 'scale=640:-2:out_range=full,format=yuvj420p', '-color_range', 'pc',
                          '-filter_threads', '1', '-threads', '1', '-q:v', '4', str(temporary)], 35)
                if not temporary.is_file() or not 100 <= temporary.stat().st_size <= 2_000_000: raise ValueError('Invalid thumbnail.')
                self.catalog.resolve(row['id'])  # Do not publish previews of a changed file.
                temporary.replace(target)
            self.state(row['id'], row['fingerprint'], 'ready', duration, times)
            for stale in self.cache.glob(row['id'] + '-*.jpg'):
                if stale not in targets: stale.unlink(missing_ok=True)
        except (subprocess.SubprocessError, OSError, ValueError):
            self.state(row['id'], row['fingerprint'], 'failed')
        finally:
            if temporary: temporary.unlink(missing_ok=True)
            self.catalog.status['matching'] = False
        return True

    def auto_match(self):
        # Shared catalog worker hook: previews are generated sequentially after each scan.
        if not self.catalog.settings.get()['generate_previews'] or not self.lock.acquire(False): return
        self.error = ''
        try:
            if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
                self.error = 'FFmpeg is not installed. Preview generation is unavailable.'
                return
            for item in self.catalog.all_items():
                if self.catalog.stop.is_set(): break
                try: attempted = self.generate(item)
                except (FileNotFoundError, ValueError): continue
                if attempted and self.catalog.stop.wait(.2): break
        finally:
            self.catalog.status['matching'] = False
            self.lock.release()

    def artwork(self, file_id, kind, index=0):
        row, _, root = self.catalog.resolve(file_id)
        if kind not in ('poster', 'backdrop', 'gallery'): raise FileNotFoundError()
        if not 0 <= index < 3: raise FileNotFoundError()
        if kind == 'poster':
            local = json.loads(row['metadata']).get('poster')
            if local and not local.startswith(('http:', 'https:')):
                path = self.catalog.confined(Path(local), root)
                if path and path.suffix.lower() in IMAGE_TYPES and path.stat().st_size <= 10_000_000:
                    return path, IMAGE_TYPES[path.suffix.lower()]
        ready = self.catalog.query("SELECT id FROM previews WHERE id=? AND fingerprint=? AND status='ready'", (file_id, row['fingerprint']))
        if not ready: raise FileNotFoundError()
        path = self.files(row)[index]
        if not path.is_file(): raise FileNotFoundError()
        return path, 'image/jpeg'

    def retry(self):
        with self.catalog.lock:
            self.catalog.db.execute("DELETE FROM previews WHERE status='failed'"); self.catalog.db.commit()
        self.catalog.wake.set()
