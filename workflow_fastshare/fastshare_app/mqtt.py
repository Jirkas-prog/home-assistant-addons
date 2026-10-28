import json
import os
import threading
import time

import paho.mqtt.client as mqtt
import requests


class Publisher:
    def __init__(self, engine):
        self.engine = engine
        self.client = None
        self.config = None
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.discovery_topics = []

    def start(self):
        self.thread.start()

    def credentials(self, config):
        if config['mqtt_auto']:
            token = os.environ.get('SUPERVISOR_TOKEN')
            if not token:
                raise ValueError('Automatic MQTT is available inside Home Assistant. Set a broker manually for local development.')
            response = requests.get('http://supervisor/services/mqtt', headers={'Authorization': 'Bearer ' + token}, timeout=15)
            response.raise_for_status()
            service = response.json()['data']
            return service['host'], int(service['port']), service['username'], service['password'], bool(service.get('ssl'))
        return tuple(config[k] for k in ('mqtt_host', 'mqtt_port', 'mqtt_username', 'mqtt_password', 'mqtt_tls'))

    def discover(self, client):
        cfg = self.config
        topic = cfg['mqtt_topic']
        device = {'identifiers': ['workflow_fastshare'], 'name': 'WorkFlow FastShare',
                  'manufacturer': 'WorkFlow', 'model': 'FastShare add-on', 'sw_version': '1.2.1'}
        definitions = [
            ('sensor', 'downloads', 'Downloading', 'active', 'mdi:download', None),
            ('sensor', 'queued', 'Queued', 'queued', 'mdi:playlist-play', None),
            ('sensor', 'completed', 'Finished', 'completed', 'mdi:check-circle-outline', None),
            ('sensor', 'failed', 'Needs attention', 'failed', 'mdi:alert-circle-outline', None),
            ('sensor', 'speed', 'Speed', 'speed', 'mdi:speedometer', 'B/s'),
            ('sensor', 'eta', 'Remaining time', 'eta', 'mdi:timer-sand', 's'),
            ('binary_sensor', 'online', 'Online', 'online', 'mdi:cloud-check', None),
            ('binary_sensor', 'fastshare', 'FastShare available', 'health.fastshare', 'mdi:cloud', None),
            ('binary_sensor', 'email', 'Email available', 'health.email', 'mdi:email-check-outline', None),
            ('binary_sensor', 'downloading', 'Download in progress', 'active > 0', 'mdi:download', None),
        ]
        self.discovery_topics = []
        for component, key, name, field, icon, unit in definitions:
            discovery_topic = cfg['mqtt_discovery'] + '/' + component + '/workflow_fastshare/' + key + '/config'
            self.discovery_topics.append(discovery_topic)
            data = {'name': name, 'unique_id': 'workflow_fastshare_' + key,
                    'default_entity_id': component + '.workflow_fastshare_' + key,
                    'state_topic': topic + '/state', 'availability_topic': topic + '/availability',
                    'payload_available': 'online', 'payload_not_available': 'offline',
                    'device': device, 'icon': icon, 'expire_after': 90}
            if component == 'binary_sensor':
                data.update(value_template="{{ 'ON' if value_json." + field + " else 'OFF' }}",
                            payload_on='ON', payload_off='OFF')
                if key != 'downloading':
                    data['device_class'] = 'connectivity'
            else:
                data['value_template'] = '{{ value_json.' + field + ' }}'
            if unit:
                data['unit_of_measurement'] = unit
            if key == 'eta':
                data['device_class'] = 'duration'
                data['value_template'] = "{{ value_json.eta if value_json.eta is not none else 'None' }}"
            if key == 'downloads':
                data['json_attributes_topic'] = topic + '/details'
            client.publish(discovery_topic, json.dumps(data, ensure_ascii=False), qos=1, retain=True)

    def connect(self, cfg):
        host, port, user, password, tls = self.credentials(cfg)
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='workflow-fastshare', clean_session=True)
        if user:
            client.username_pw_set(user, password)
        if tls:
            client.tls_set()
        client.will_set(cfg['mqtt_topic'] + '/availability', 'offline', qos=1, retain=True)

        def connected(client, userdata, flags, reason, properties):
            if reason.is_failure:
                self.engine.health.update(mqtt=False, mqtt_message='MQTT rejected the credentials.')
                return
            self.engine.health.update(mqtt=True, mqtt_message='Connected to MQTT · ' + host + ':' + str(port))
            self.discover(client)
            client.subscribe(cfg['mqtt_discovery'] + '/status', qos=1)
            client.publish(cfg['mqtt_topic'] + '/availability', 'online', qos=1, retain=True)

        def message(client, userdata, msg):
            if msg.topic == cfg['mqtt_discovery'] + '/status' and msg.payload == b'online':
                self.discover(client)

        def disconnected(client, userdata, flags, reason, properties):
            self.engine.health.update(mqtt=False, mqtt_message='MQTT disconnected. Reconnecting…')

        client.on_connect, client.on_disconnect, client.on_message = connected, disconnected, message
        self.client, self.config = client, cfg
        client.connect_async(host, port, keepalive=30)
        client.reconnect_delay_set(min_delay=2, max_delay=60)
        client.loop_start()

    def disconnect(self, cleanup=False):
        if self.client:
            if self.client.is_connected():
                if cleanup:
                    for topic in self.discovery_topics:
                        self.client.publish(topic, '', qos=1, retain=True).wait_for_publish(timeout=3)
                self.client.publish(self.config['mqtt_topic'] + '/availability', 'offline', qos=1, retain=True).wait_for_publish(timeout=3)
            self.client.disconnect()
            self.client.loop_stop()
            self.client = None

    def run(self):
        fingerprint = None
        while not self.engine.stop.is_set():
            cfg = self.engine.settings.get()
            current = {k: v for k, v in cfg.items() if k.startswith('mqtt_')}
            try:
                if current != fingerprint:
                    self.disconnect(cleanup=True)
                    if cfg['mqtt_enabled']:
                        self.connect(cfg)
                    else:
                        self.engine.health.update(mqtt=False, mqtt_message='MQTT is disabled.')
                    fingerprint = current
                if self.client and self.client.is_connected():
                    state = self.engine.snapshot()
                    base = cfg['mqtt_topic']
                    # Bounded details prevent oversized MQTT packets; counts always cover the whole queue.
                    details = {**state, 'jobs': state['jobs'][:25], 'fastshare_widget': True}
                    self.client.publish(base + '/details', json.dumps(details, ensure_ascii=False), qos=0, retain=True)
                    self.client.publish(base + '/state', json.dumps({k: v for k, v in state.items() if k not in ('jobs', 'account')}), qos=0, retain=True)
            except Exception:
                self.engine.health.update(mqtt=False, mqtt_message='MQTT is unavailable. Check the broker and credentials.')
                fingerprint = None
            self.engine.stop.wait(3 if self.client else 15)
        self.disconnect()

    def close(self):
        self.thread.join(timeout=20)
