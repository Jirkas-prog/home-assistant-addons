import json
import os
import re
import secrets
import threading
from pathlib import Path
from urllib.parse import urlsplit


def atomic_json(path, value):
    path = Path(path)
    tmp = path.with_suffix('.tmp')
    with tmp.open('w', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    try:
        tmp.chmod(0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def public_base(value):
    value = value.strip().rstrip('/')
    if not value:
        return ''
    p = urlsplit(value)
    if p.scheme != 'https' or not p.hostname or p.username or p.password or p.query or p.fragment:
        raise ValueError('The public URL must use HTTPS without credentials, query or fragment.')
    if p.hostname in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('Meta requires a publicly reachable HTTPS URL.')
    return value


class State:
    def __init__(self, directory, timezone='Europe/Prague'):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'settings.json'
        self.lock = threading.RLock()
        self.data = {
            'enabled': False, 'public_media_base_url': '', 'app_id': '', 'app_secret': '',
            'api_version': 'v26.0', 'access_token': '', 'calendar_entity': '',
            'connection_method': 'browser', 'direct_session': {}, 'browser_session': False,
            'import_dir': '', 'import_enabled': False,
            'schedule_source': 'home_assistant', 'installation_id': secrets.token_hex(16),
            'account': {'connected': False}, 'oauth_states': {}, 'grants': {},
            'schedule': {'timezone': timezone, 'weekly': [
                {'id': 'daily-1600', 'days': list(range(7)), 'time': '16:00', 'enabled': True}
            ], 'once': []},
        }
        if self.path.exists():
            stored = json.loads(self.path.read_text('utf-8'))
            if 'connection_method' not in stored and stored.get('access_token'):
                stored['connection_method'] = 'official'
            if (stored.get('connection_method') == 'direct'
                    and not stored.get('direct_session')
                    and not stored.get('account', {}).get('connected')):
                stored.update(connection_method='browser', enabled=False, account={'connected': False})
            self.data.update(stored)
        self.save()

    def save(self):
        with self.lock:
            atomic_json(self.path, self.data)

    def settings(self):
        with self.lock:
            return {k: self.data[k] for k in ('enabled', 'public_media_base_url', 'app_id',
                                             'api_version', 'calendar_entity', 'schedule_source', 'connection_method',
                                             'import_dir', 'import_enabled')} | {
                'has_app_secret': bool(self.data['app_secret']),
                'has_token': bool(self.data['access_token']),
                'has_direct_session': bool(self.data['direct_session']),
                'has_browser_session': bool(self.data['browser_session']),
            }

    def update(self, changes):
        allowed = {'enabled', 'public_media_base_url', 'app_id', 'app_secret', 'api_version',
                   'access_token', 'calendar_entity', 'schedule_source', 'connection_method',
                   'import_dir', 'import_enabled'}
        if set(changes) - allowed:
            raise ValueError('Unknown setting.')
        with self.lock:
            proposed = dict(self.data)
            for key, value in changes.items():
                if key in ('enabled', 'import_enabled'):
                    if not isinstance(value, bool):
                        raise ValueError('enabled must be true/false.')
                elif not isinstance(value, str) or len(value) > 8192:
                    raise ValueError('Invalid setting value.')
                if key == 'public_media_base_url':
                    value = public_base(value)
                if key == 'api_version' and not re.fullmatch(r'v\d+\.0', value):
                    raise ValueError('The API version must use a format such as v26.0.')
                if key == 'schedule_source' and value not in ('home_assistant', 'internal'):
                    raise ValueError('Choose Home Assistant or the internal calendar.')
                if key == 'connection_method' and value not in ('browser', 'direct', 'official'):
                    raise ValueError('Choose browser login, direct login or the official API.')
                if key == 'calendar_entity' and value and not re.fullmatch(r'calendar\.[a-z0-9_]+', value):
                    raise ValueError('Choose an entity named calendar.name.')
                if key == 'app_id' and value and not value.isdigit():
                    raise ValueError('The Instagram App ID must be numeric.')
                proposed[key] = value
            if proposed['import_enabled'] and not proposed['import_dir']:
                raise ValueError('Choose an import folder before enabling automatic import.')
            connection_fields = {'connection_method', 'public_media_base_url', 'app_id', 'app_secret',
                                 'api_version', 'access_token', 'calendar_entity', 'schedule_source'}
            changed = {key for key in connection_fields & changes.keys() if proposed[key] != self.data[key]}
            if changed:
                proposed['enabled'] = False
            if 'connection_method' in changed:
                proposed['account'] = {'connected': False}
                proposed['oauth_states'] = {}
            if changes.get('access_token') and changes['access_token'] != self.data['access_token']:
                proposed['account'] = {'connected': False, 'token_created_at': __import__('time').time()}
                proposed['enabled'] = False
            if proposed['enabled']:
                connected = proposed['account'].get('connected')
                if proposed['connection_method'] == 'browser':
                    if not (connected and proposed['browser_session']):
                        raise ValueError('Connect and verify Instagram first.')
                elif proposed['connection_method'] == 'direct':
                    if not (connected and proposed['direct_session']):
                        raise ValueError('Connect and verify Instagram first.')
                elif not (connected and proposed['access_token'] and proposed['public_media_base_url']):
                    raise ValueError('Connect and verify Instagram and configure the public HTTPS media URL first.')
            if proposed['enabled'] and proposed['schedule_source'] == 'home_assistant' and not proposed['calendar_entity']:
                raise ValueError('Select a Home Assistant calendar first.')
            self.data = proposed
            self.save()

    def oauth_state(self, now):
        with self.lock:
            self.data['oauth_states'] = {k: v for k, v in self.data['oauth_states'].items() if v > now}
            nonce = secrets.token_urlsafe(32)
            self.data['oauth_states'][nonce] = now + 600
            self.save()
            return nonce

    def consume_oauth_state(self, nonce, now):
        with self.lock:
            expires = self.data['oauth_states'].pop(nonce, 0)
            self.save()
            if expires <= now:
                raise ValueError('This login expired or was already used. Start again from the app.')
