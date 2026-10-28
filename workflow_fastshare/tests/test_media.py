import os
from pathlib import Path
import time
import unittest
from unittest.mock import patch

import test_app
from fastshare_app.local_web import COOKIE, lan_application
from werkzeug.test import Client
from werkzeug.wrappers import Response


class MediaTests(unittest.TestCase):
    setUp = test_app.AddonTests.setUp
    tearDown = test_app.AddonTests.tearDown
    post = test_app.AddonTests.post

    def video(self, name='movie.mp4', data=b'0123456789'):
        path=Path(self.settings.get()['download_dir'])/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def test_library_range_seek_head_and_subtitles(self):
        path=self.video()
        self.video('incomplete.mp4.part')
        self.video('empty.mp4', b'')
        self.video('movie.cs.srt', '1\n00:00:00,000 --> 00:00:02,500\nPříliš žluťoučký\n'.encode())
        listing=self.client.get('/api/library').json
        self.assertEqual(listing['total'],1)
        media_id=listing['items'][0]['id'];url='/api/media/'+media_id
        details=self.client.get(url).json
        self.assertEqual(details['tracks'][0]['language'],'cs')
        subtitle=self.client.get('/api/media/'+details['tracks'][0]['id']+'/subtitle')
        self.assertTrue(subtitle.text.startswith('WEBVTT'))
        self.assertIn('00:00:02.500',subtitle.text)
        self.assertIn('Příliš',subtitle.text)
        for header,content in [('bytes=3-5',b'345'),('bytes=-2',b'89'),('bytes=7-',b'789')]:
            with self.client.get(url+'/stream',headers={'Range':header}) as result:
                self.assertEqual(result.status_code,206)
                self.assertEqual(result.data,content)
                self.assertEqual(result.mimetype,'video/mp4')
                self.assertEqual(result.headers['Accept-Ranges'],'bytes')
        with self.client.head(url+'/stream') as result:
            self.assertEqual(result.headers['Content-Length'],'10')
            self.assertEqual(result.data,b'')
        with self.client.get(url+'/stream',headers={'Range':'bytes=20-'}) as result:
            self.assertEqual(result.status_code,416)
        with self.client.get(url+'/stream?download=1') as result:
            self.assertIn('attachment',result.headers['Content-Disposition'])
        first_key=details['resume_key'];path.write_bytes(b'changed video')
        self.assertNotEqual(self.client.get(url).json['resume_key'],first_key)

    def test_media_references_cannot_escape_configured_roots(self):
        path=self.video();library=self.app.extensions['media'];root=path.parent
        outside=Path(self.tmp.name)/'private.mp4';outside.write_bytes(b'private')
        for reference in ['bad-token', library.signer.dumps([str(root),'../private.mp4']),
                          library.signer.dumps([str(root),str(outside)]),library.signer.dumps([str(root),'queue.sqlite3'])]:
            self.assertEqual(self.client.get('/api/media/'+reference+'/stream').status_code,404)
        reference=library.identify(path,root)
        self.settings.save({'download_dir':str(Path(self.tmp.name)/'new')})
        self.assertEqual(self.client.get('/api/media/'+reference+'/stream').status_code,404)
        self.assertEqual(self.post('settings',{'media_dirs':[str(Path(self.tmp.name).parent)]}).status_code,400)
        # A symlink swapped after indexing must be checked again when streaming.
        self.settings.save({'download_dir':str(root)})
        path.unlink()
        try:path.symlink_to(outside)
        except OSError:return  # Windows may not grant symlink privileges.
        self.assertEqual(self.client.get('/api/media/'+reference+'/stream').status_code,404)

    def test_library_pagination_and_overlapping_roots(self):
        for n in range(28):self.video(f'sub/video-{n}.mp4')
        self.settings.save({'media_dirs':[str(Path(self.settings.get()['download_dir'])/'sub')]})
        first=self.client.get('/api/library').json
        self.assertEqual(first['total'],28);self.assertEqual(len(first['items']),24)
        self.assertEqual(len(self.client.get('/api/library?page=1').json['items']),4)
        self.assertEqual(self.client.get('/api/library?q=video-27').json['total'],1)

    def test_lan_is_separate_authenticated_and_tickets_are_one_use(self):
        lan=Client(lan_application(self.app),Response)
        self.assertEqual(lan.get('/api/state').status_code,403)
        self.settings.save({'lan_enabled':True},internal=True)
        self.assertEqual(lan.get('/api/state').status_code,401)
        with lan.get('/') as result:self.assertEqual(result.status_code,200)
        headers={'X-FastShare-Request':'1'}
        ticket=self.post('local-ticket',{}).json['ticket']
        self.assertEqual(lan.post('/api/local-auth',json={'ticket':ticket}).status_code,403)
        result=lan.post('/api/local-auth',json={'ticket':ticket},headers=headers)
        self.assertEqual(result.status_code,200)
        self.assertIn('HttpOnly',result.headers['Set-Cookie']);self.assertIn('SameSite=Strict',result.headers['Set-Cookie'])
        self.assertEqual(lan.get('/api/library').status_code,200)
        self.assertEqual(lan.post('/api/local-settings',json={'lan_enabled':False},headers=headers).status_code,403)
        self.assertEqual(lan.post('/api/settings',json={'paused':True},headers={**headers,'Origin':'http://evil.example'}).status_code,403)
        self.assertEqual(lan.post('/api/settings',json={'lan_password_hash':'forged'},headers=headers).status_code,400)
        lan.post('/api/local-signout',json={},headers=headers)
        self.assertEqual(lan.get('/api/state').status_code,401)
        self.assertEqual(lan.post('/api/local-auth',json={'ticket':ticket},headers=headers).status_code,401)
        expired=self.app.extensions['local_web'].ticket();self.app.extensions['local_web'].tickets[expired]=time.monotonic()-1
        self.assertEqual(lan.post('/api/local-auth',json={'ticket':expired},headers=headers).status_code,401)
        self.assertEqual(self.client.get('/api/state',environ_base={'REMOTE_ADDR':'192.168.0.3'},headers={'X-FastShare-Lan':'1'}).status_code,403)

    def test_lan_password_rotation_and_rate_limit(self):
        self.post('local-settings',{'lan_enabled':True,'password':'test-password-only'})
        self.assertNotIn('test-password-only',self.client.get('/api/settings').text)
        self.assertNotIn('lan_password_hash',self.client.get('/api/settings').json)
        lan=Client(lan_application(self.app),Response);headers={'X-FastShare-Request':'1'}
        self.assertEqual(lan.post('/api/local-auth',json={'password':'test-password-only'},headers=headers).status_code,200)
        self.post('local-settings',{'password':'different-test-password'})
        self.assertEqual(lan.get('/api/state').status_code,401)
        for _ in range(8):self.assertEqual(lan.post('/api/local-auth',json={'password':'wrong'},headers=headers).status_code,401)
        self.assertEqual(lan.post('/api/local-auth',json={'password':'wrong'},headers=headers).status_code,429)
        for patch_data in [{'lan_port':80},{'lan_port':True},{'lan_host':'http://host'},{'lan_host':'bad_host'},{'password':'short'}]:
            self.assertEqual(self.post('local-settings',patch_data).status_code,400)

    def test_supervisor_port_mapping_and_failure_preserves_settings(self):
        local=self.app.extensions['local_web'];ha=self.app.extensions['homeassistant']
        with patch.dict(os.environ,{'SUPERVISOR_TOKEN':'test'}), patch.object(self.settings,'save',wraps=self.settings.save) as save:
            # Use HA-valid media paths while exercising own-app port management.
            self.settings.value['download_dir']='/media/FastShare'
            with patch.object(ha,'supervisor',side_effect=[{'network':{'8098/tcp':None}},{}]) as call, patch('fastshare_app.local_web.threading.Timer'):
                result=local.configure({'lan_enabled':True,'lan_port':18099,'lan_host':'fastshare-play.home'})
                self.assertTrue(result['automatic_restart'])
                self.assertEqual(call.call_args.args,('POST','/addons/self/options',{'network':{'8098/tcp':18099}}))
            with patch.object(ha,'supervisor',side_effect=ValueError('Port unavailable')):
                with self.assertRaises(ValueError):local.configure({'lan_port':18100})
                self.assertEqual(self.settings.get()['lan_port'],18099)


if __name__=='__main__':unittest.main()
