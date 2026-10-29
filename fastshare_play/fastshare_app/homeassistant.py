import json
import os
from pathlib import Path
import shutil
import time

import requests
import websocket

from player_app import VERSION

RESOURCE = f'/local/workflow-fastshare/workflow-fastshare.js?v={VERSION}'


class HomeAssistant:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.error = ''
        self.slug = 'local_workflow_fastshare'

    def commands(self, callback):
        token = os.environ.get('SUPERVISOR_TOKEN')
        if not token:
            raise ValueError('This feature is available after installation in Home Assistant.')
        socket = websocket.create_connection('ws://supervisor/core/websocket', timeout=20)
        try:
            socket.recv()
            socket.send(json.dumps({'type': 'auth', 'access_token': token}))
            if json.loads(socket.recv()).get('type') != 'auth_ok':
                raise ValueError('Home Assistant rejected the connection.')
            sequence = 0

            def call(kind, **data):
                nonlocal sequence
                sequence += 1
                socket.send(json.dumps({'id': sequence, 'type': kind, **data}))
                while True:
                    result = json.loads(socket.recv())
                    if result.get('id') != sequence:
                        continue
                    if not result.get('success'):
                        raise ValueError('Home Assistant rejected the request. Use a dashboard managed in the UI (storage mode).')
                    return result.get('result')
            return callback(call)
        finally:
            socket.close()

    def supervisor(self, method, path, data=None, timeout=20):
        token = os.environ.get('SUPERVISOR_TOKEN')
        if not token:
            raise ValueError('This feature is available after installation in Home Assistant.')
        try:
            response = requests.request(method, 'http://supervisor' + path,
                                        headers={'Authorization': 'Bearer ' + token}, json=data, timeout=timeout)
            response.raise_for_status()
            result = response.json()
            if result.get('result') != 'ok':
                raise ValueError('Supervisor rejected the request.')
            return result.get('data', {})
        except (requests.RequestException, ValueError):
            raise ValueError('Home Assistant could not apply the port. Check for a port conflict and try again.') from None

    def install_resource(self):
        root = Path('/homeassistant/www/workflow-fastshare')
        root.mkdir(parents=True, exist_ok=True)
        for filename in ('workflow-fastshare.js', 'translations.js', 'cs.json'):
            shutil.copyfile(Path(__file__).resolve().parent.parent / 'download_www' / filename, root / filename)

        def register(call):
            resources = call('lovelace/resources')
            existing = next((r for r in resources if r['url'].split('?')[0] == RESOURCE.split('?')[0]), None)
            if existing:
                if existing['url'] != RESOURCE:
                    call('lovelace/resources/update', resource_id=existing['id'], url=RESOURCE, res_type='module')
            else:
                call('lovelace/resources/create', url=RESOURCE, res_type='module')
        self.commands(register)
        response = requests.get('http://supervisor/addons/self/info', headers={'Authorization': 'Bearer ' + os.environ['SUPERVISOR_TOKEN']}, timeout=10)
        response.raise_for_status()
        self.slug = response.json()['data']['slug']
        self.error = ''

    def dashboards(self):
        rows = self.commands(lambda call: call('lovelace/dashboards/list'))
        return [{'title': 'Overview', 'url_path': None}] + [r for r in rows if r.get('mode') == 'storage']

    def add_view(self, dashboard, rows='auto'):
        self.install_resource()

        def install(call):
            args = {'url_path': dashboard} if dashboard else {}
            config = call('lovelace/config', **args)
            if not config or not isinstance(config.get('views'), list):
                raise ValueError('First take control of this dashboard in Home Assistant.')
            if any(v.get('path') == 'fastshare' for v in config['views']):
                return {'url': '/' + (dashboard or 'lovelace') + '/fastshare', 'existing': True}
            backup = self.directory / 'dashboard-backups'
            backup.mkdir(exist_ok=True)
            (backup / ('before-' + str(time.time_ns()) + '.json')).write_text(json.dumps({'dashboard': dashboard, 'config': config}, ensure_ascii=False, indent=2), encoding='utf-8')
            updated = json.loads(json.dumps(config))
            updated['views'].append({'title': 'FastShare', 'path': 'fastshare', 'icon': 'mdi:cloud-download',
                                     'type': 'sections', 'max_columns': 2, 'sections': [{'type': 'grid', 'cards': [
                                         {'type': 'custom:workflow-fastshare-card', 'title': 'FastShare',
                                          'addon': self.slug, 'rows': rows, 'grid_options': {'columns': 12, 'rows': rows}}
                                     ]}]})
            if call('lovelace/config', **args) != config:
                raise ValueError('The dashboard changed in the meantime. Try again.')
            call('lovelace/config/save', config=updated, **args)
            return {'url': '/' + (dashboard or 'lovelace') + '/fastshare', 'existing': False}
        return self.commands(install)
