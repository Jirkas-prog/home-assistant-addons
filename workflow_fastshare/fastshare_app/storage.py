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
SECRETS = {'email_password', 'mqtt_password', 'fastshare_session'}


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
        return value

    def save(self, patch, internal=False):
        with self.lock:
            value = self.get()
            for key, item in patch.items():
                if key not in DEFAULTS or (key == 'fastshare_session' and not internal):
                    raise ValueError('Unknown setting.')
                if key in ('email_password', 'mqtt_password') and item == '' and not internal:
                    continue  # Blank in the UI preserves an existing password.
                if type(item) is not type(DEFAULTS[key]):
                    raise ValueError('Invalid setting type: ' + key)
                value[key] = item
            for key, low, high in [('parallel_downloads', 1, 8), ('email_port', 1, 65535),
                                   ('mqtt_port', 1, 65535), ('email_interval', 30, 3600)]:
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
            if len(value['email_senders']) > 4000:
                raise ValueError('The sender list is too long.')
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
        self.db.execute("UPDATE jobs SET status='queued', speed=0, eta=NULL WHERE status IN ('resolving','downloading')")
        self.db.commit()

    def query(self, sql, args=()):
        with self.lock:
            return [dict(row) for row in self.db.execute(sql, args).fetchall()]

    def add(self, file_id, url, name, source='manual', total=0):
        with self.lock:
            self.db.execute('INSERT OR IGNORE INTO jobs(file_id,url,name,source,total,created) VALUES(?,?,?,?,?,?)',
                            (file_id, url, name[:240], source, total, time.time()))
            self.db.commit()
            return self.query('SELECT * FROM jobs WHERE file_id=?', (file_id,))[0]

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
