import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

from fastshare_app.app import create_app
from fastshare_app.engine import email_links
from fastshare_app.provider import FastShare, ProviderError, file_link, safe_url
from fastshare_app.storage import Store


class Response:
    def __init__(self, content=b'abcdefghij', status=200, headers=None):
        self.status_code = status
        self.headers = {'Content-Length': str(len(content)), 'ETag': '"v1"', 'Content-Type': 'application/octet-stream', **(headers or {})}
        self.content = content
        self.closed = False

    def iter_content(self, size):
        yield self.content

    def close(self):
        self.closed = True


class AddonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(self.tmp.name, start=False)
        self.client = self.app.test_client()
        self.engine = self.app.extensions['engine']
        self.store = self.app.extensions['store']
        self.settings = self.app.extensions['settings']

    def tearDown(self):
        self.engine.close()
        self.store.db.close()
        self.tmp.cleanup()

    def post(self, path, data):
        return self.client.post('/api/' + path, json=data, headers={'X-FastShare-Request': '1'})

    def test_ingress_and_csrf(self):
        self.assertEqual(self.client.get('/api/state', environ_base={'REMOTE_ADDR': '192.168.0.2'}).status_code, 403)
        self.assertEqual(self.client.post('/api/settings', json={'paused': True}).status_code, 403)
        self.assertEqual(self.post('settings', {'paused': True}).status_code, 200)
        with patch.dict(os.environ, {'SUPERVISOR_TOKEN': 'test'}):
            self.assertEqual(self.client.get('/api/state').status_code, 403)
            self.assertEqual(self.client.get('/api/state', environ_base={'REMOTE_ADDR': '172.30.32.2'}).status_code, 200)

    def test_url_boundary_and_action_stripping(self):
        for value in ['http://127.0.0.1/123/a', 'https://fastshare.cloud.evil.org/123/a',
                      'https://fastshare.cloud@evil.org/123/a', 'https://evil.fastshare.cloud/123/a',
                      'https://fastshare.cloud:8080/123/a', 'https://fastshare.cloud/sql.php?id=123&process=delete']:
            with self.assertRaises(ValueError):
                file_link(value)
        self.assertEqual(file_link('http://fastshare.cz/123/test.mp4?delete=1#x')[1], 'https://fastshare.cz/123/test.mp4')
        self.assertEqual(file_link('https://data4.fastshare.cloud/download.php?id=123&process=x')[1], 'https://data4.fastshare.cloud/download.php?id=123')

    def test_email_mime_allowlist_and_dedup(self):
        raw = b'From: sender@example.org\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<a href="https://fastshare.cloud/123/test.mp4">Film</a> https://fastshare.cz/123/test.mp4 https://fastshare.cloud.evil.org/2/x'
        self.assertEqual(len(email_links(raw)), 1)
        self.assertEqual(email_links(raw, 'other@example.org'), [])
        self.assertEqual(len(email_links(raw, 'sender@example.org')), 1)

    def test_dedup_persistence_and_recovery(self):
        first = self.engine.add('https://fastshare.cloud/123/test.mp4')
        second = self.engine.add('https://data4.fastshare.cloud/download.php?id=123', 'email')
        self.assertEqual(first['id'], second['id'])
        self.store.update(first['id'], status='downloading', downloaded=10)
        reopened = Store(self.tmp.name)
        try:
            self.assertEqual(reopened.query('SELECT status FROM jobs')[0]['status'], 'queued')
            self.assertEqual(reopened.query('SELECT downloaded FROM jobs')[0]['downloaded'], 10)
        finally:
            reopened.db.close()

    def test_settings_reject_bad_types_paths_and_secrets_are_masked(self):
        for patch_data in [{'parallel_downloads': 9}, {'parallel_downloads': True}, {'mqtt_topic': 'x/#'}, {'download_dir': str(Path(self.tmp.name).parent)}, {'fastshare_session': {'token': 'injected'}}]:
            self.assertEqual(self.post('settings', patch_data).status_code, 400)
        self.post('settings', {'email_password': 'private-password'})
        self.post('settings', {'email_password': ''})
        self.assertEqual(self.settings.get()['email_password'], 'private-password')
        self.assertNotIn('private-password', self.client.get('/api/settings').text)
        self.assertNotIn('private-password', self.client.get('/api/state').text)

    def test_complete_and_do_not_overwrite(self):
        job = self.engine.add('https://fastshare.cloud/123/test.mp4')
        response = Response()
        with patch.object(FastShare, 'download', return_value=(response, '../../test.mp4')):
            self.engine.download(job, self.settings.get(), threading.Event())
        job = self.store.query('SELECT * FROM jobs')[0]
        self.assertEqual(job['status'], 'completed')
        self.assertEqual(Path(job['path']).read_bytes(), b'abcdefghij')
        with patch.object(FastShare, 'download', return_value=(Response(b'bad'), 'test.mp4')):
            self.engine.download(job, self.settings.get(), threading.Event())
        self.assertEqual(Path(job['path']).read_bytes(), b'abcdefghij')
        self.assertEqual(self.store.query('SELECT status FROM jobs')[0]['status'], 'needs_action')

    def test_resume_and_range_ignored(self):
        for suffix, status, headers in [('a',206,{'Content-Range':'bytes 4-9/10'}), ('b',200,{})]:
            job = self.engine.add('https://fastshare.cloud/' + ('123' if suffix=='a' else '124') + '/file')
            target = Path(self.settings.get()['download_dir']) / ('test-' + suffix + '.mp4')
            target.parent.mkdir(exist_ok=True)
            partial = Path(str(target)+'.part')
            partial.write_bytes(b'abcd')
            self.store.update(job['id'], path=str(target), validator='"v1"')
            job = self.store.query('SELECT * FROM jobs WHERE id=?', (job['id'],))[0]
            response = Response(b'efghij' if status==206 else b'abcdefghij', status, headers)
            with patch.object(FastShare,'download',return_value=(response,'test.mp4')):
                self.engine.download(job,self.settings.get(),threading.Event())
            self.assertEqual(target.read_bytes(),b'abcdefghij')

    def test_truncated_transfer_is_retried_not_completed(self):
        job=self.engine.add('https://fastshare.cloud/123/test.mp4')
        with patch.object(FastShare,'download',return_value=(Response(b'abc',headers={'Content-Length':'10'}),'test.mp4')):
            self.engine.download(job,self.settings.get(),threading.Event())
        row=self.store.query('SELECT * FROM jobs')[0]
        self.assertEqual(row['status'],'queued')
        self.assertGreater(row['retry_at'],time.time())
        self.assertFalse(Path(row['path']).exists())

    def test_cancel_does_not_turn_into_success(self):
        job=self.engine.add('https://fastshare.cloud/123/test.mp4')
        event=threading.Event();event.set()
        self.store.update(job['id'],status='cancelled')
        with patch.object(FastShare,'download',return_value=(Response(),'test.mp4')):
            self.engine.download(job,self.settings.get(),event)
        self.assertEqual(self.store.query('SELECT status FROM jobs')[0]['status'],'cancelled')

    def test_free_scheduler_never_runs_two_jobs(self):
        self.engine.add('https://fastshare.cloud/123/a.mp4')
        self.engine.add('https://fastshare.cloud/124/b.mp4')
        started=[]; release=threading.Event()
        def download(job,cfg,cancel):
            started.append(job['id']);release.wait(4)
        with patch.object(self.engine,'download',side_effect=download):
            thread=threading.Thread(target=self.engine.scheduler);thread.start()
            deadline=time.time()+2
            while not started and time.time()<deadline:time.sleep(.01)
            self.assertEqual(len(started),1)
            self.engine.wake.set();time.sleep(.1)
            self.assertEqual(len(started),1)
            self.engine.stop.set();self.engine.wake.set();release.set();thread.join(2)

    def test_mail_cursor_first_run_and_peek(self):
        cfg={**self.settings.get(),'email_username':'x@example.org','email_password':'secret'}
        mail=MagicMock();mail.__enter__.return_value=mail;mail.select.return_value=('OK',[])
        mail.response.side_effect=lambda k:(k,[b'999' if k=='UIDVALIDITY' else b'8'])
        with patch('imaplib.IMAP4_SSL',return_value=mail):
            self.engine.poll_email(cfg)
            mail.uid.assert_not_called()
            mail.uid.side_effect=[('OK',[b'7 8']),('OK',[(b'8',b'Content-Type: text/plain\r\n\r\nhttps://fastshare.cloud/123/test.mp4')])]
            self.engine.poll_email(cfg)
            self.assertEqual(len(self.store.query('SELECT * FROM jobs')),1)
            self.assertIn('PEEK',mail.uid.call_args.args[2])
            self.assertEqual(self.store.query('SELECT value FROM cursors')[0]['value'],'8')

    def test_mqtt_discovery_has_lwt_and_details(self):
        publisher=self.app.extensions['publisher'];publisher.config=self.settings.get();client=MagicMock()
        publisher.discover(client)
        self.assertEqual(client.publish.call_count,10)
        docs=[json.loads(call.args[1]) for call in client.publish.call_args_list]
        self.assertTrue(all(d['availability_topic']=='mqtt_addon/fastshare/availability' for d in docs))
        self.assertEqual(docs[0]['json_attributes_topic'],'mqtt_addon/fastshare/details')

    def test_english_default_czech_setting_persists(self):
        self.assertEqual(self.client.get('/api/state').json['language'],'en')
        self.assertEqual(self.post('settings',{'language':'cs'}).status_code,200)
        from fastshare_app.storage import Settings
        self.assertEqual(Settings(self.tmp.name).get()['language'],'cs')
        self.assertEqual(self.post('settings',{'language':'xx'}).status_code,400)
        for path in ('/translations.js','/cs.json'):
            with self.client.get(path) as response:
                self.assertEqual(response.status_code,200)

    def test_thumbnail_proxy_rejects_non_images_and_other_servers(self):
        self.assertEqual(self.client.get('/api/thumbnail',query_string={'url':'https://fastshare.cloud/123/a'}).status_code,400)
        self.assertEqual(self.client.get('/api/thumbnail',query_string={'url':'https://img.fastshare.cloud/account'}).status_code,400)
        response=MagicMock();response.__enter__.return_value=response
        response.headers={'Content-Type':'text/html'}
        with patch.object(FastShare,'request',return_value=response):
            self.assertEqual(self.client.get('/api/thumbnail',query_string={'url':'https://img.fastshare.cloud/upload/tn/test.jpg'}).status_code,400)

    def test_free_direct_link_uses_provider_form(self):
        response=Response()
        client=FastShare()
        with patch.object(client,'request',return_value=response) as request:
            actual,_=client.download('https://data4.fastshare.cloud/download.php?id=123')
            self.assertIs(actual,response)
            self.assertTrue(request.call_args.args[0].startswith('https://fastshare.cloud/free/?'))
            self.assertEqual(request.call_args.kwargs['method'],'POST')
        client.close()

    def test_empty_body_is_not_a_successful_file(self):
        job=self.engine.add('https://fastshare.cloud/123/test.mp4')
        with patch.object(FastShare,'download',return_value=(Response(b''),'test.mp4')):
            self.engine.download(job,self.settings.get(),threading.Event())
        self.assertEqual(self.store.query('SELECT status FROM jobs')[0]['status'],'needs_action')


if __name__=='__main__':unittest.main()
