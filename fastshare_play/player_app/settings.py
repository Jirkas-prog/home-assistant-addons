import copy
import json
import os
from pathlib import Path
import re
import threading

import requests

DEFAULTS = {'language': 'en', 'media_roots': [],
            'scan_interval': 120, 'lan_enabled': False, 'lan_port': 8111, 'lan_host': '',
            'generate_previews': True, 'cycle_previews': True, 'import_nova_resume': True}


class Settings:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'settings.json'
        self.lock = threading.RLock()
        self.value = copy.deepcopy(DEFAULTS)
        if self.path.exists(): self.value.update(json.loads(self.path.read_text(encoding='utf-8')))

    def get(self):
        with self.lock: return copy.deepcopy(self.value)

    def public(self):
        return self.get()

    def allowed_roots(self):
        return [Path('/media').resolve(), Path('/share').resolve()] if os.environ.get('SUPERVISOR_TOKEN') else [self.directory]

    def save(self, patch, dry_run=False):
        with self.lock:
            value = self.get()
            if not isinstance(patch, dict) or set(patch) - set(DEFAULTS): raise ValueError('Unknown setting.')
            for key, item in patch.items():
                if type(item) is not type(DEFAULTS[key]): raise ValueError('Invalid setting type: ' + key)
                value[key] = item
            if value['language'] not in ('en', 'cs'):
                raise ValueError('Unsupported language.')
            if not 30 <= value['scan_interval'] <= 3600: raise ValueError('Scan interval must be 30–3600 seconds.')
            if not 1024 <= value['lan_port'] <= 65535: raise ValueError('Use a port between 1024 and 65535.')
            host = value['lan_host']
            if host and (len(host) > 253 or not re.fullmatch(r'[A-Za-z0-9.-]+', host) or
                         any(not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label) for label in host.split('.'))):
                raise ValueError('Enter a DNS name or IPv4 address without a scheme, path or port.')
            if len(value['media_roots']) > 12: raise ValueError('Choose at most 12 media folders.')
            roots = []
            for item in value['media_roots']:
                if not isinstance(item, str) or not item.strip() or len(item) > 1000: raise ValueError('Enter a valid media folder.')
                path = Path(item).resolve()
                if not any(path == root or root in path.parents for root in self.allowed_roots()):
                    raise ValueError('Media folders must be inside /media or /share.')
                if str(path) not in roots: roots.append(str(path))
            value['media_roots'] = roots
            if dry_run: return value
            self._write(value)
            return self.public()

    def _write(self, value):
        temporary = self.path.with_suffix('.tmp')
        fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as file:
            json.dump(value, file, ensure_ascii=False, indent=2)
            file.flush(); os.fsync(file.fileno())
        temporary.replace(self.path)
        self.value = value

def supervisor(method, path, data=None, timeout=20):
    try:
        result = requests.request(method, 'http://supervisor' + path,
                                  headers={'Authorization': 'Bearer ' + os.environ['SUPERVISOR_TOKEN']},
                                  json=data, timeout=timeout)
        result.raise_for_status()
        body = result.json()
        if body.get('result') != 'ok': raise ValueError()
        return body.get('data', {})
    except (requests.RequestException, ValueError, KeyError):
        raise ValueError('Home Assistant could not apply the port. Check for a port conflict.') from None


def configure(settings, patch):
    if hasattr(settings, 'configure_shared'):
        return settings.configure_shared(patch)
    proposed = settings.save(patch, dry_run=True)
    current = settings.get()
    restart = False
    if os.environ.get('SUPERVISOR_TOKEN'):
        info = supervisor('GET', '/addons/self/info')
        mapping = dict(info.get('network') or {})
        desired = proposed['lan_port'] if proposed['lan_enabled'] else None
        if mapping.get('8098/tcp') != desired:
            mapping['8098/tcp'] = desired
            supervisor('POST', '/addons/self/options', {'network': mapping})
            restart = True
    else:
        restart = any(current[key] != proposed[key] for key in ('lan_enabled', 'lan_port'))
    settings.save(patch)
    if restart and os.environ.get('SUPERVISOR_TOKEN'):
        def restart_later():
            try: supervisor('POST', '/addons/self/restart', timeout=60)
            except ValueError: pass
        timer = threading.Timer(2, restart_later); timer.daemon = True; timer.start()
    return {'settings': settings.public(), 'restart_required': restart,
            'automatic_restart': restart and bool(os.environ.get('SUPERVISOR_TOKEN'))}
