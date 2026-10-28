from concurrent.futures import ThreadPoolExecutor
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
import hashlib
from html import unescape
import imaplib
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import threading
import time

import requests

from .provider import FastShare, ProviderError, file_link, free_url, response_name


def email_links(raw, senders=''):
    message = BytesParser(policy=policy.default).parsebytes(raw)
    allowed = {x.strip().lower() for x in senders.replace(';', ',').split(',') if x.strip()}
    if allowed and parseaddr(str(message.get('From', '')))[1].lower() not in allowed:
        return []
    found = {}
    for part in message.walk():
        if part.get_content_type() not in ('text/plain', 'text/html') or part.get_content_disposition() == 'attachment':
            continue
        try:
            body = part.get_content()
        except (LookupError, ValueError):
            body = (part.get_payload(decode=True) or b'').decode('utf-8', 'replace')
        for url in re.findall(r'https?://[^\s<>"\']+', unescape(body)):
            try:
                file_id, canonical, _ = file_link(url.rstrip('.,;!?)'))
                found[file_id] = canonical
            except ValueError:
                continue
    return list(found.values())


class Engine:
    def __init__(self, settings, store):
        self.settings, self.store = settings, store
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.lock = threading.RLock()
        self.active = {}
        self.priority = json.loads(self.store.cursor('priority_override') or 'null')
        self.health = {'fastshare': None, 'email': None, 'email_message': 'Email is not configured.',
                       'fastshare_message': 'Checking connection…', 'mqtt': False, 'mqtt_message': 'Connecting…'}
        self.pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix='download')
        self.threads = []

    def start(self):
        for target in (self.scheduler, self.mail_loop, self.probe_loop):
            thread = threading.Thread(target=target, daemon=True)
            thread.start()
            self.threads.append(thread)

    def close(self):
        self.stop.set()
        self.wake.set()
        with self.lock:
            for event, future in self.active.values():
                event.set()
        self.pool.shutdown(wait=True)
        for thread in self.threads:
            thread.join(timeout=40)

    def add(self, url, source='manual', name=None, total=0):
        file_id, url, hint = file_link(url)
        job = self.store.add(file_id, url, name or hint, source, max(0, int(total)))
        self.wake.set()
        return job

    def clear_priority(self):
        with self.lock:
            self.priority = None
            self.store.cursor('priority_override', 'null')
        self.wake.set()

    def action(self, job_id, action, mode=None):
        with self.lock:
            rows = self.store.query('SELECT * FROM jobs WHERE id=?', (job_id,))
            if not rows:
                raise ValueError('The job does not exist.')
            job = rows[0]
            if action in ('up', 'down', 'first'):
                self.store.move(job_id, action)
            elif action == 'priority':
                if mode not in ('slot', 'exclusive'):
                    raise ValueError('Choose Free one slot or Download alone.')
                if job['status'] not in ('queued', 'resolving', 'downloading'):
                    raise ValueError('Only waiting or active files can be prioritized.')
                self.priority = {'job_id': job_id, 'mode': mode}
                self.store.cursor('priority_override', json.dumps(self.priority))
                self.store.update(job_id, retry_at=0)
                self.settings.save({'paused': False})
            elif action == 'cancel':
                if job['status'] == 'completed':
                    raise ValueError('The completed file remains on disk.')
                self.store.update(job_id, status='cancelled', speed=0, eta=None, error='')
                if job_id in self.active:
                    self.active[job_id][0].set()
            elif action == 'retry':
                if job_id in self.active:
                    raise ValueError('Wait for the transfer to stop.')
                if job['status'] not in ('failed', 'needs_action', 'cancelled'):
                    raise ValueError('This job cannot be retried right now.')
                self.store.update(job_id, status='queued', attempts=0, retry_at=0, error='')
            else:
                raise ValueError('Unknown action.')
        self.wake.set()

    def snapshot(self):
        config = self.settings.get()
        rows = self.store.query('SELECT * FROM jobs ORDER BY created DESC')
        live = [row for row in rows if row['status'] in ('downloading', 'resolving')]
        waiting = sorted((row for row in rows if row['status'] == 'queued'), key=lambda row: (row['queue_order'], row['id']))
        positions = {row['id']: i + 1 for i, row in enumerate(waiting)}
        visible = live + waiting + [row for row in rows if row not in live and row not in waiting]
        with self.lock:
            priority = dict(self.priority) if self.priority else None
        if priority:
            priority['name'] = next((row['name'] for row in rows if row['id'] == priority['job_id']), '')
        jobs = []
        for row in visible[:60]:
            item = {key: row[key] for key in ('id', 'file_id', 'name', 'source', 'status', 'total', 'downloaded', 'speed', 'eta', 'error', 'created', 'retry_at')}
            item['url'] = free_url(row['url']) if '/download.php?' in row['url'] else row['url']
            item['progress'] = min(100, round(row['downloaded'] / row['total'] * 100, 1)) if row['total'] else 0
            item['queue_position'] = positions.get(row['id'])
            jobs.append(item)
        session = config['fastshare_session']
        estimates = [row['eta'] for row in live if row['eta'] is not None]
        return {'online': True, 'language': config['language'], 'updated_at': time.time(), 'health': dict(self.health),
                'active': len(live), 'queued': len(waiting),
                'completed': sum(row['status'] == 'completed' for row in rows),
                'failed': sum(row['status'] in ('failed', 'needs_action') for row in rows),
                'speed': round(sum(row['speed'] for row in live)), 'eta': max(estimates) if estimates else None,
                'paused': config['paused'], 'priority': priority,
                'limit': 1 if priority and priority['mode'] == 'exclusive' else config['parallel_downloads'] if session else 1,
                'account': {k: v for k, v in session.items() if k != 'token'},
                'email_enabled': config['email_enabled'], 'jobs': jobs, 'total_jobs': len(rows)}

    def scheduler(self):
        while not self.stop.is_set():
            self.schedule()
            self.wake.wait(1)
            self.wake.clear()

    def schedule(self):
        with self.lock:
            config = self.settings.get()
            self.active = {key: value for key, value in self.active.items() if not value[1].done()}
            target = None
            if self.priority:
                rows = self.store.query('SELECT * FROM jobs WHERE id=?', (self.priority['job_id'],))
                target = rows[0] if rows else None
                if not target or target['status'] not in ('queued', 'resolving', 'downloading'):
                    self.clear_priority()
                    target = None
            if config['paused']:
                for event, _ in self.active.values():
                    event.set()
                return
            limit = config['parallel_downloads'] if config['fastshare_session'] else 1
            exclusive = bool(target and self.priority['mode'] == 'exclusive')
            if target:
                others = [key for key in reversed(self.active) if key != target['id']]
                if exclusive:
                    victims = others
                    limit = 1
                elif target['id'] not in self.active and target['retry_at'] <= time.time():
                    needed = max(0, len(self.active) - limit + 1)
                    # An already stopping transfer frees a slot; don't stop another
                    # transfer on each scheduler tick while waiting for that slot.
                    needed -= sum(self.active[key][0].is_set() for key in others)
                    victims = [key for key in others if not self.active[key][0].is_set()][:max(0, needed)]
                else:
                    victims = []
                for key in victims:
                    self.active[key][0].set()
            waiting = self.store.query("SELECT * FROM jobs WHERE status='queued' AND retry_at<=? ORDER BY queue_order,id", (time.time(),))
            if target:
                waiting.sort(key=lambda job: job['id'] != target['id'])
                if exclusive:
                    waiting = [job for job in waiting if job['id'] == target['id']]
            for job in waiting:
                if len(self.active) >= limit or self.stop.is_set():
                    break
                if job['id'] in self.active:
                    continue
                cancel = threading.Event()
                self.store.update(job['id'], status='resolving', error='', speed=0, eta=None)
                future = self.pool.submit(self.download, job, config, cancel)
                self.active[job['id']] = (cancel, future)

    def download(self, job, config, cancel):
        client = FastShare(config['fastshare_session'])
        response = None
        job_id = job['id']
        try:
            if cancel.is_set() or self.stop.is_set():
                return
            root = Path(config['download_dir']).resolve()
            root.mkdir(parents=True, exist_ok=True)
            target = Path(job['path']) if job['path'] else None
            if target and (target.is_symlink() or target.resolve().parent != root):
                raise ProviderError('The destination folder changed. Restore the original folder to resume this job.', action=True)
            partial = target.with_name(target.name + '.part') if target else None
            if partial and partial.is_symlink():
                raise ProviderError('A partial file must not be a symbolic link.')
            offset = partial.stat().st_size if partial and partial.exists() else 0
            response, hint = client.download(job['url'], offset, job['validator'])
            if cancel.is_set() or self.stop.is_set():
                return
            if target is None:
                name = response_name(response, hint)
                base = Path(name)
                target = root / (base.stem + '-' + job['file_id'] + base.suffix)
                partial = target.with_name(target.name + '.part')
            if target.exists() or target.is_symlink() or partial.is_symlink():
                raise ProviderError('The target file already exists and will not be overwritten.', action=True)
            total = int(response.headers.get('Content-Length', '0'))
            append = False
            if response.status_code == 206:
                match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers.get('Content-Range', ''))
                if not match or int(match[1]) != offset or not job['validator']:
                    raise ProviderError('The server returned an invalid byte range.')
                total = int(match[3])
                append = True
            if not append:
                offset = 0
            if shutil.disk_usage(root).free < max(0, total - offset) + 64 * 1024 * 1024:
                raise ProviderError('There is not enough free space in the destination folder.', action=True)
            validator = response.headers.get('ETag', '')
            if validator.startswith('W/'):
                validator = ''
            validator = validator or response.headers.get('Last-Modified', '')
            self.store.update(job_id, name=target.name, path=str(target), total=total,
                              downloaded=offset, validator=validator)
            downloaded, start, last = offset, time.monotonic(), 0
            with partial.open('ab' if append else 'wb') as output:
                for chunk in response.iter_content(128 * 1024):
                    if cancel.is_set() or self.stop.is_set():
                        return
                    if not chunk:
                        continue
                    output.write(chunk)
                    downloaded += len(chunk)
                    now = time.monotonic()
                    if now - last >= 1:
                        speed = (downloaded - offset) / max(.1, now - start)
                        with self.lock:
                            if cancel.is_set():
                                return
                            self.store.update(job_id, status='downloading', downloaded=downloaded, speed=speed,
                                              eta=max(0, (total - downloaded) / speed) if total and speed else None)
                        last = now
                output.flush()
                os.fsync(output.fileno())
            if total and downloaded != total:
                raise ProviderError('The transfer ended before the file was complete.', retryable=True)
            if not downloaded:
                raise ProviderError('FastShare returned no data. Check your account or file availability.', action=True)
            with self.lock:
                if cancel.is_set() or self.stop.is_set():
                    return
                partial.replace(target)
                self.store.update(job_id, status='completed', downloaded=downloaded, total=downloaded, speed=0, eta=0, error='')
        except Exception as error:
            if isinstance(error, ProviderError):
                message, action, retry = str(error), error.action, error.retryable
            elif isinstance(error, (requests.RequestException, TimeoutError)):
                message, action, retry = 'The transfer was interrupted. Reconnecting.', False, True
            elif isinstance(error, OSError):
                message, action, retry = 'Cannot write to the destination. Check permissions and free space.', True, False
            else:
                message, action, retry = 'Unexpected server response. Try the job again.', True, False
            with self.lock:
                if not cancel.is_set() and not self.stop.is_set():
                    attempts = job['attempts'] + 1
                    retry = retry and attempts < 6
                    self.store.update(job_id, status='queued' if retry else ('needs_action' if action else 'failed'),
                                      error=message, attempts=attempts, retry_at=time.time() + min(1800, 60 * 2 ** (attempts - 1)), speed=0, eta=None)
        finally:
            if response is not None:
                response.close()
            client.close()
            with self.lock:
                rows = self.store.query('SELECT status FROM jobs WHERE id=?', (job_id,))
                if rows and rows[0]['status'] in ('resolving', 'downloading'):
                    self.store.update(job_id, status='queued', speed=0, eta=None)
            self.wake.set()

    def poll_email(self, config, test=False):
        if not config['email_username'] or not config['email_password']:
            raise ValueError('Enter your email and app password.')
        with imaplib.IMAP4_SSL(config['email_host'], config['email_port'],
                              ssl_context=ssl.create_default_context(), timeout=25) as mail:
            mail.login(config['email_username'], config['email_password'])
            status, _ = mail.select('"' + config['email_folder'].replace('\\', '\\\\').replace('"', '\\"') + '"', readonly=True)
            if status != 'OK':
                raise ValueError('The mailbox folder is unavailable.')
            if test:
                return 0
            validity = mail.response('UIDVALIDITY')[1][0]
            if not validity:
                raise ValueError('The server did not provide UIDVALIDITY.')
            identity = '\0'.join(str(config[k]) for k in ('email_host', 'email_port', 'email_username', 'email_folder'))
            key = hashlib.sha256(identity.encode()).hexdigest() + ':' + validity.decode()
            cursor = self.store.cursor(key)
            if cursor is None and not config['email_existing']:
                next_uid = mail.response('UIDNEXT')[1][0]
                if not next_uid:
                    raise ValueError('The server did not provide UIDNEXT.')
                self.store.cursor(key, max(0, int(next_uid) - 1))
                return 0
            high = int(cursor or 0)
            status, rows = mail.uid('search', None, 'UID', str(high + 1) + ':*')
            if status != 'OK':
                raise ValueError('Cannot read the mailbox folder.')
            count = 0
            for uid in sorted(int(x) for x in (rows[0] or b'').split() if int(x) > high)[:100]:
                if self.stop.is_set():
                    break
                # Partial PEEK caps memory and does not mark messages as read.
                status, data = mail.uid('fetch', str(uid), '(BODY.PEEK[]<0.2097152>)')
                if status != 'OK':
                    raise ValueError('Cannot read this message; it will be retried next time.')
                payloads = [item[1] for item in data if isinstance(item, tuple)]
                if not payloads:
                    raise ValueError('The message was not fetched; the cursor has not advanced.')
                for url in email_links(payloads[0], config['email_senders']):
                    self.add(url, 'email')
                    count += 1
                self.store.cursor(key, uid)
            return count

    def mail_loop(self):
        while not self.stop.is_set():
            config = self.settings.get()
            if config['email_enabled']:
                try:
                    count = self.poll_email(config)
                    self.health.update(email=True, email_message='Connection OK · links found: %s' % count)
                except Exception:
                    self.health.update(email=False, email_message='Email sign-in or reading failed. Check the server, folder and app password.')
            else:
                self.health.update(email=None, email_message='Email monitoring is disabled.')
            self.stop.wait(config['email_interval'])

    def probe_loop(self):
        while not self.stop.is_set():
            client = FastShare()
            try:
                with client.request('https://fastshare.cloud/'):
                    self.health.update(fastshare=True, fastshare_message='FastShare is available.')
            except Exception:
                self.health.update(fastshare=False, fastshare_message='FastShare is not responding right now.')
            finally:
                client.close()
            self.stop.wait(60)
