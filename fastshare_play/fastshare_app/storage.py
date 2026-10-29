import copy
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import time

DEFAULTS = {
    'language': 'en',
    'media_dirs': [],
    'lan_enabled': False, 'lan_port': 8099, 'lan_host': '',
    'viewer_enabled': False, 'viewer_port': 8110, 'viewer_host': '',
    'lan_password_hash': '', 'lan_auth_version': '',
    'download_dir': '/media/FastShare', 'parallel_downloads': 3, 'paused': False,
    'email_enabled': False, 'email_provider': 'seznam', 'email_host': 'imap.seznam.cz',
    'email_port': 993, 'email_username': '', 'email_password': '', 'email_folder': 'INBOX',
    'email_interval': 60, 'email_existing': False, 'email_senders': '',
    'mqtt_enabled': True, 'mqtt_auto': True, 'mqtt_host': 'core-mosquitto',
    'mqtt_port': 1883, 'mqtt_username': '', 'mqtt_password': '', 'mqtt_tls': False,
    'mqtt_topic': 'mqtt_addon/fastshare', 'mqtt_discovery': 'homeassistant',
    'fastshare_session': {},
}
PROVIDERS = {'seznam': 'imap.seznam.cz', 'gmail': 'imap.gmail.com', 'custom': ''}
SECRETS = {'email_password', 'mqtt_password', 'fastshare_session', 'lan_password_hash', 'lan_auth_version'}


class Settings:
    def __init__(self, directory):
        self.lock = threading.RLock()
        self.path = Path(directory) / 'settings.json'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.value = copy.deepcopy(DEFAULTS)
        if self.path.exists():
            self.value.update(json.loads(self.path.read_text(encoding='utf-8')))

    def get(self):
        with self.lock:
            return copy.deepcopy(self.value)

    def public(self):
        value = self.get()
        for key in SECRETS:
            value.pop(key, None)
        value['email_password_saved'] = bool(self.value['email_password'])
        value['mqtt_password_saved'] = bool(self.value['mqtt_password'])
        value['lan_password_saved'] = bool(self.value['lan_password_hash'])
        return value

    def save(self, patch, internal=False, dry_run=False):
        with self.lock:
            value = self.get()
            for key, item in patch.items():
                if key not in DEFAULTS or (not internal and (key == 'fastshare_session' or key.startswith(('lan_', 'viewer_')))):
                    raise ValueError('Unknown setting.')
                if key in ('email_password', 'mqtt_password') and item == '' and not internal:
                    continue  # Blank in the UI preserves an existing password.
                if type(item) is not type(DEFAULTS[key]):
                    raise ValueError('Invalid setting type: ' + key)
                value[key] = item
            for key, low, high in [('parallel_downloads', 1, 8), ('email_port', 1, 65535),
                                   ('mqtt_port', 1, 65535), ('email_interval', 30, 3600),
                                   ('lan_port', 1024, 65535), ('viewer_port', 1024, 65535)]:
                if not low <= value[key] <= high:
                    raise ValueError('Value out of range: ' + key)
            if value['language'] not in ('en', 'cs'):
                raise ValueError('Unsupported interface language.')
            if value['email_provider'] not in PROVIDERS:
                raise ValueError('Unknown email provider.')
            if value['email_provider'] != 'custom':
                value['email_host'] = PROVIDERS[value['email_provider']]
            for key in ('email_host', 'mqtt_host'):
                if not re.fullmatch(r'[A-Za-z0-9.:-]{1,253}', value[key]):
                    raise ValueError('Enter a server name or IP address.')
            for key in ('email_username', 'email_folder', 'mqtt_username'):
                if len(value[key]) > 300 or any(ord(c) < 32 for c in value[key]):
                    raise ValueError('Invalid setting: ' + key)
            for key in ('mqtt_topic', 'mqtt_discovery'):
                if not re.fullmatch(r'[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*', value[key]) or len(value[key]) > 150:
                    raise ValueError('MQTT topic: use letters, numbers, hyphens, underscores and slashes.')
            if value['mqtt_topic'] == value['mqtt_discovery']:
                raise ValueError('The state topic and discovery prefix must differ.')
            folder = Path(value['download_dir']).resolve()
            roots = [Path('/media').resolve(), Path('/share').resolve()]
            if not os.environ.get('SUPERVISOR_TOKEN'):
                roots = [self.path.parent.resolve()]
            if not any(folder == root or root in folder.parents for root in roots):
                raise ValueError('The destination must be inside /media or /share (inside the data directory for local development).')
            if len(value['media_dirs']) > 12:
                raise ValueError('Choose at most 12 additional media folders.')
            for directory in value['media_dirs']:
                if not isinstance(directory, str) or not directory.strip() or len(directory) > 1000:
                    raise ValueError('Enter a valid media folder.')
                target = Path(directory).resolve()
                if not any(target == root or root in target.parents for root in roots):
                    raise ValueError('Media folders must be inside /media or /share (inside the data directory for local development).')
            for key in ('lan_host', 'viewer_host'):
                host = value[key]
                if host and (len(host) > 253 or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', host)
                             or any(not label or len(label) > 63 or label.startswith('-') or label.endswith('-') for label in host.split('.'))):
                    raise ValueError('Enter a DNS name or IPv4 address without a scheme, path or port.')
            if value['lan_enabled'] and value['viewer_enabled'] and value['lan_port'] == value['viewer_port']:
                raise ValueError('Use different ports for local web and playback-only access.')
            if len(value['email_senders']) > 4000:
                raise ValueError('The sender list is too long.')
            if dry_run:
                return value
            temporary = self.path.with_suffix('.tmp')
            fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as output:
                json.dump(value, output, ensure_ascii=False, indent=2)
                output.flush()
                os.fsync(output.fileno())
            temporary.replace(self.path)
            self.value = value
            return self.public()


class Store:
    def __init__(self, directory):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(Path(directory) / 'queue.sqlite3'), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY, file_id TEXT UNIQUE NOT NULL, url TEXT NOT NULL,
                name TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
                total INTEGER DEFAULT 0, downloaded INTEGER DEFAULT 0, speed REAL DEFAULT 0,
                eta REAL, error TEXT DEFAULT '', path TEXT DEFAULT '', validator TEXT DEFAULT '',
                attempts INTEGER DEFAULT 0, retry_at REAL DEFAULT 0, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS cursors (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        ''')
        if 'queue_order' not in {row['name'] for row in self.db.execute('PRAGMA table_info(jobs)')}:
            self.db.execute('ALTER TABLE jobs ADD COLUMN queue_order INTEGER NOT NULL DEFAULT 0')
            self.db.execute('UPDATE jobs SET queue_order=id')
        self.db.execute("UPDATE jobs SET status='queued', speed=0, eta=NULL WHERE status IN ('resolving','downloading')")
        self.db.commit()

    def query(self, sql, args=()):
        with self.lock:
            return [dict(row) for row in self.db.execute(sql, args).fetchall()]

    def add(self, file_id, url, name, source='manual', total=0):
        with self.lock:
            order = self.db.execute('SELECT COALESCE(MAX(queue_order),0)+1 FROM jobs').fetchone()[0]
            self.db.execute('INSERT OR IGNORE INTO jobs(file_id,url,name,source,total,created,queue_order) VALUES(?,?,?,?,?,?,?)',
                            (file_id, url, name[:240], source, total, time.time(), order))
            self.db.commit()
            return self.query('SELECT * FROM jobs WHERE file_id=?', (file_id,))[0]

    def move(self, job_id, direction):
        with self.lock:
            rows = self.query("SELECT id,queue_order FROM jobs WHERE status='queued' ORDER BY queue_order,id")
            index = next((i for i, row in enumerate(rows) if row['id'] == job_id), None)
            if index is None:
                raise ValueError('Only waiting files can be reordered.')
            if direction == 'first':
                self.db.execute('UPDATE jobs SET queue_order=? WHERE id=?', (rows[0]['queue_order'] - 1, job_id))
            else:
                other = index + (-1 if direction == 'up' else 1)
                if not 0 <= other < len(rows):
                    return
                self.db.executemany('UPDATE jobs SET queue_order=? WHERE id=?',
                                    [(rows[other]['queue_order'], job_id), (rows[index]['queue_order'], rows[other]['id'])])
            self.db.commit()

    def update(self, job_id, **values):
        allowed = {'name', 'status', 'total', 'downloaded', 'speed', 'eta', 'error', 'path', 'validator', 'attempts', 'retry_at'}
        if not set(values) <= allowed:
            raise ValueError('Unknown job field.')
        with self.lock:
            self.db.execute('UPDATE jobs SET ' + ','.join(k + '=?' for k in values) + ' WHERE id=?', (*values.values(), job_id))
            self.db.commit()

    def cursor(self, key, value=None):
        with self.lock:
            if value is not None:
                self.db.execute('INSERT OR REPLACE INTO cursors(key,value) VALUES(?,?)', (key, str(value)))
                self.db.commit()
            rows = self.query('SELECT value FROM cursors WHERE key=?', (key,))
            return rows[0]['value'] if rows else None
