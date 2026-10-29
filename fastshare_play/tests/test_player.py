import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

from werkzeug.test import Client
from werkzeug.wrappers import Response
from player_app.app import create_app, player_application
from player_app.nova import filename_metadata, nfo_metadata, nova_resume
from player_app.settings import configure


class PlayerTest(unittest.TestCase):
    def setUp(self):
        test_root=Path(__file__).resolve().parents[2]/'qa'
        test_root.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        self.root = Path(self.temp.name).resolve()
        self.app = create_app(self.root, start=False)
        self.catalog = self.app.extensions['catalog']
        self.settings = self.app.extensions['settings']
        self.media = self.root / 'media'; self.media.mkdir()
        self.settings.save({'media_roots':[str(self.media)], 'lan_enabled':True})
        self.admin = self.app.test_client()
        self.public = Client(player_application(self.app), Response)
        self.headers = {'X-Play-Request':'1'}

    def tearDown(self):
        self.catalog.close(); self.catalog.db.close(); self.temp.cleanup()

    def video(self, name='Example.Movie.2020.mp4', content=b'0123456789'):
        path = self.media / name; path.write_bytes(content); return path

    def scan(self):
        self.catalog.scan(); self.assertEqual(self.catalog.status['error'], '')
        return self.catalog.listing({})['items']

    def post(self, path, data): return self.public.post(path, json=data, headers=self.headers)

    def test_public_boundary_and_range_playback(self):
        path = self.video(); self.video('Example.Movie.2020.cs.srt', '1\n00:00:00,000 --> 00:00:02,500\nPříběh\n'.encode())
        item = self.scan()[0]; url = '/api/library/' + item['id']
        self.assertFalse(self.public.get('/api/config').json['admin'])
        for route in ['/api/admin/settings','/api/admin/scan','/api/admin/retry-previews']:
            self.assertEqual(self.public.get(route).status_code,403)
            self.assertEqual(self.post(route,{}).status_code,403)
        for method in ['delete','put','patch']:
            self.assertEqual(getattr(self.public,method)(url,json={},headers=self.headers).status_code,405)
        self.assertEqual(self.admin.get('/api/config',environ_overrides={'REMOTE_ADDR':'10.0.0.1'},headers={'X-Forwarded-For':'127.0.0.1'}).status_code,403)
        self.assertEqual(self.public.post(url+'/play',json={}).status_code,403)
        self.assertEqual(self.public.post(url+'/play',json={},headers={**self.headers,'Origin':'http://evil.test'}).status_code,403)
        with self.public.get(url+'/stream',headers={'Range':'bytes=3-6'}) as response:
            self.assertEqual(response.data,b'3456'); self.assertEqual(response.status_code,206)
        self.assertEqual(self.public.get(url+'/stream',headers={'Range':'bytes=90-'}).status_code,416)
        with self.public.head(url+'/stream') as response: self.assertEqual(response.headers['Content-Length'],'10')
        detail=self.public.get(url).json
        self.assertNotIn('path',detail['tracks'][0])
        self.assertIn('00:00:02.500',self.public.get(url+'/subtitle/0').text)
        self.assertEqual(self.public.get(url+'/subtitle/99').status_code,404)
        self.assertEqual(path.read_bytes(),b'0123456789')

    def test_nova_import_persistence_sessions_and_newer_web_progress(self):
        video=self.video(); before=hashlib.sha256(video.read_bytes()).hexdigest()
        sidecar=self.media / ('.'+video.name+'.30.archos.resume.xml')
        sidecar.write_text(f'<network_database><path>{video.name}</path><last_position>300000</last_position><last_time_played>{time.time()-60}</last_time_played></network_database>')
        item=self.scan()[0]; self.assertEqual(item['position'],300)
        self.assertEqual(item['progress_source'],'nova')
        url='/api/library/'+item['id']; session=self.post(url+'/play',{}).json['session']
        data={'session':session,'sequence':1,'position':500,'duration':1000}
        self.assertTrue(self.post(url+'/progress',data).json['saved'])
        data['position']=600
        self.assertFalse(self.post(url+'/progress',data).json['saved'])
        self.scan(); self.assertEqual(self.catalog.detail(item['id'])['position'],500)
        second=self.post(url+'/play',{}).json['session']; data['sequence']=2
        self.assertFalse(self.post(url+'/progress',data).json['saved'])
        data.update(session=second,sequence=1,position=1000,ended=True)
        self.assertTrue(self.post(url+'/progress',data).json['saved'])
        self.assertTrue(self.catalog.detail(item['id'])['watched'])
        another=create_app(self.root,start=False)
        try: self.assertTrue(another.extensions['catalog'].detail(item['id'])['watched'])
        finally: another.extensions['catalog'].db.close()
        self.assertEqual(hashlib.sha256(video.read_bytes()).hexdigest(),before)
        self.assertEqual(nova_resume(sidecar,video.name)['position'],300)

    def test_nfo_units_episode_facets_and_invalid_xml(self):
        movie=self.video('A.Movie.2021.mp4')
        movie.with_suffix('.nfo').write_text('<movie><title>A movie</title><year>2021</year><genre>Drama / Mystery</genre><set><name>A collection</name></set><runtime>100</runtime><resume>120000</resume></movie>')
        self.video('Show.Name.S02E03.1080p.mkv'); self.video('Show.Name.S02E04.1080p.mkv')
        items=self.scan();self.assertEqual(len(items),3)
        nfo=next(i for i in items if i['source']=='nfo')
        self.assertEqual(nfo['position'],120);self.assertEqual(nfo['collection'],'A collection')
        self.assertEqual(self.catalog.listing({'genre':'Drama'})['total'],1)
        episodes=self.catalog.listing({'kind':'episode','sort':'episode'})['items']
        self.assertEqual([i['episode'] for i in episodes],[3,4])
        self.assertEqual(self.catalog.detail(episodes[0]['id'])['next_episode'],episodes[1]['id'])
        movie.with_suffix('.nfo').write_text('<!DOCTYPE movie [<!ENTITY x "bad">]><movie><title>&x;</title></movie>')
        self.assertEqual(len(self.scan()),3)
        with self.assertRaises(ValueError): nfo_metadata(movie.with_suffix('.nfo'))
        self.assertEqual(filename_metadata(Path('Film.2024.1080p.CZ.mkv'))['title'],'Film')

    def test_replaced_removed_and_unconfigured_files_are_not_served(self):
        video=self.video();item=self.scan()[0];url='/api/library/'+item['id']
        self.post(url+'/flags',{'favorite':True,'watched':True})
        video.write_bytes(b'replacement data')
        self.assertEqual(self.public.get(url+'/stream').status_code,400)
        item=self.scan()[0];self.assertFalse(item['watched']);self.assertTrue(item['favorite'])
        self.settings.save({'media_roots':[]})
        self.assertEqual(self.public.get(url+'/stream').status_code,404)
        self.assertEqual(self.public.get('/api/library').json['total'],0)
        self.settings.save({'media_roots':[str(self.media)]});video.unlink();self.scan()
        self.assertEqual(self.public.get(url+'/stream').status_code,404)

    def test_settings_and_progress_validation(self):
        for data in [{'media_roots':['/outside']},{'lan_port':80},{'lan_host':'bad/name'},{'language':'xx'},{'lan_enabled':'yes'},{'unknown':True}]:
            self.assertEqual(self.admin.post('/api/admin/settings',json=data,headers=self.headers).status_code,400)
        with patch.dict(os.environ,{'SUPERVISOR_TOKEN':'test-token'}), patch('player_app.settings.supervisor',side_effect=ValueError('failed')):
            with self.assertRaises(ValueError): configure(self.settings,{'lan_port':12345,'media_roots':[]})
        self.assertEqual(self.settings.get()['lan_port'],8111)
        self.video();item=self.scan()[0];url='/api/library/'+item['id']
        session=self.post(url+'/play',{}).json['session']
        for data in [{'session':session,'sequence':1,'position':-1,'duration':10},{'session':session,'sequence':True,'position':1,'duration':10}]:
            self.assertEqual(self.post(url+'/progress',data).status_code,400)
        self.assertEqual(self.post(url+'/flags',{'delete':True}).status_code,400)

    def test_three_cached_previews_middle_sixty_percent_and_invalidation(self):
        video=self.video();item=self.scan()[0];worker=self.app.extensions['metadata'];calls=[]
        def fake_run(args,timeout):
            calls.append(args)
            if args[0]=='ffprobe': return subprocess.CompletedProcess(args,0,b'{"format":{"duration":"1000"}}')
            Path(args[-1]).write_bytes(b'\xff\xd8\xff'+b'x'*150)
            return subprocess.CompletedProcess(args,0,b'')
        with patch.object(worker,'run',side_effect=fake_run):
            self.assertTrue(worker.generate(item));self.assertFalse(worker.generate(item))
        self.assertFalse(self.catalog.status['matching'])
        self.assertEqual(len(calls),4)
        preview=self.catalog.query('SELECT * FROM previews')[0];times=json.loads(preview['times'])
        self.assertEqual(len(set(times)),3);self.assertTrue(all(200<t<800 for t in times))
        self.assertTrue(all('-threads' in call and '-protocol_whitelist' in call for call in calls[1:]))
        self.assertTrue(all('scale=640:-2:out_range=full,format=yuvj420p' in call for call in calls[1:]))
        result=self.catalog.detail(item['id']);self.assertEqual(result['gallery_count'],3);self.assertEqual(result['duration'],1000)
        for index in range(3):
            with self.public.get('/api/library/'+item['id']+'/art/gallery?index='+str(index)) as response: self.assertEqual(response.status_code,200)
        self.assertEqual(self.public.get('/api/library/'+item['id']+'/art/gallery?index=3').status_code,404)
        video.write_bytes(b'new data');self.scan()
        self.assertEqual(self.catalog.detail(item['id'])['gallery_count'],0)
        with patch.object(worker,'run',side_effect=subprocess.CalledProcessError(1,['ffprobe'])):
            worker.generate(item)
        self.assertEqual(self.catalog.detail(item['id'])['preview_status'],'failed')
        self.assertEqual(self.catalog.listing({})['stats']['previews_failed'],1)

    def test_art_and_symlink_cannot_escape_media_root(self):
        video=self.video();outside=self.root/'private.jpg';outside.write_bytes(b'private')
        video.with_suffix('.nfo').write_text('<movie><title>Example</title><thumb>../private.jpg</thumb></movie>')
        item=self.scan()[0]
        self.assertEqual(self.public.get('/api/library/'+item['id']+'/art/poster').status_code,404)
        try: (self.media/'Escape.mp4').symlink_to(self.root/'private.jpg')
        except OSError: return
        self.assertEqual(len(self.scan()),1)

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg integration runs inside the add-on image')
    def test_real_ffmpeg_previews(self):
        path=self.media/'Generated.test.2026.mp4'
        subprocess.run(['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=10','-t','8','-c:v','mpeg4','-color_range','tv',str(path)],check=True)
        item=self.scan()[0];self.app.extensions['metadata'].generate(item)
        result=self.catalog.detail(item['id']);self.assertEqual(result['gallery_count'],3)
        self.assertAlmostEqual(result['duration'],8,delta=.2)
        images=[]
        for i in range(3):
            with self.public.get('/api/library/'+item['id']+'/art/gallery?index='+str(i)) as response: images.append(response.data)
        self.assertTrue(all(data.startswith(b'\xff\xd8\xff') for data in images));self.assertEqual(len(set(images)),3)


if __name__=='__main__': unittest.main()
