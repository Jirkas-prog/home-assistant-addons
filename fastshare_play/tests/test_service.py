import json
from pathlib import Path
import tempfile
import unittest

from werkzeug.test import Client
from werkzeug.wrappers import Response

from fastshare_app.local_web import lan_application
from player_app.app import player_application
from player_app.service import create_service


class ServiceTest(unittest.TestCase):
    def test_migrated_downloads_shared_settings_and_public_boundary(self):
        root = Path(__file__).resolve().parents[2] / 'qa'
        root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as folder:
            directory = Path(folder).resolve()
            media = directory / 'downloader' / 'movies'
            media.mkdir(parents=True)
            (media / 'Example.2020.mp4').write_bytes(b'0123456789')
            saved = {'download_dir': str(media), 'language': 'cs', 'mqtt_enabled': False,
                     'viewer_enabled': True, 'viewer_port': 18110, 'lan_enabled': True,
                     'lan_port': 18109, 'email_password': 'test-private',
                     'fastshare_session': {'username': 'example'}}
            (directory / 'downloader' / 'settings.json').write_text(json.dumps(saved))
            application, core, player = create_service(directory, start=False)
            try:
                admin = Client(application, Response)
                lan = Client(lan_application(application), Response)
                public = Client(player_application(player), Response)
                peer = {'REMOTE_ADDR': '127.0.0.1'}
                headers = {'X-FastShare-Request': '1'}
                self.assertEqual(admin.get('/', environ_overrides=peer).status_code, 200)
                self.assertEqual(admin.get('/cinema', environ_overrides=peer).status_code, 302)
                with admin.get('/cinema/', environ_overrides=peer) as response: self.assertEqual(response.status_code, 200)
                self.assertEqual(admin.get('/cinema/api/config', environ_overrides=peer).json['language'], 'cs')
                self.assertEqual(core.extensions['settings'].get()['email_password'], 'test-private')
                response = admin.post('/api/jobs', json={'url':'https://fastshare.cloud/123/example.mp4'}, headers=headers, environ_overrides=peer)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(admin.get('/api/state', environ_overrides=peer).json['queued'], 1)
                for path in ['/api/settings', '/api/state', '/api/jobs', '/api/admin/settings', '/cinema/api/admin/settings']:
                    self.assertNotEqual(public.get(path).status_code, 200)
                    self.assertNotEqual(public.post(path, json={}, headers=headers).status_code, 200)
                self.assertFalse(public.get('/api/config').json['controls'])
                self.assertNotIn('test-private', public.get('/api/config').text)
                self.assertEqual(lan.get('/cinema/api/library').status_code, 401)
                self.assertEqual(lan.get('/cinema/').status_code, 302)
                ticket = core.extensions['local_web'].ticket()
                self.assertEqual(lan.post('/api/local-auth', json={'ticket':ticket}, headers=headers).status_code, 200)
                self.assertEqual(lan.get('/api/state').status_code, 200)
                self.assertEqual(lan.get('/cinema/api/library').status_code, 200)
                self.assertEqual(lan.get('/cinema/api/admin/settings').status_code, 403)
                self.assertEqual(lan.post('/cinema/api/library/x/play', json={}, headers={'X-Play-Request':'1','Origin':'http://evil.test'}).status_code,403)
                response = admin.post('/cinema/api/admin/settings', json={'language':'en'}, headers={'X-Play-Request':'1'}, environ_overrides=peer)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(core.extensions['settings'].get()['language'], 'en')
                self.assertEqual(public.get('/api/config').json['language'], 'en')
                player.extensions['catalog'].scan()
                movie = public.get('/api/library').json['items'][0]
                with public.get('/api/library/'+movie['id']+'/stream', headers={'Range':'bytes=2-4'}) as response:
                    self.assertEqual(response.status_code,206)
                    self.assertEqual(response.data,b'234')
            finally:
                core.extensions['engine'].close(); core.extensions['store'].db.close()
                player.extensions['catalog'].close(); player.extensions['catalog'].db.close()
