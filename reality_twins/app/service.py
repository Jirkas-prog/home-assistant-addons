import hashlib
import io
import json
import os
import re
import secrets
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import requests
from PIL import Image, ImageCms, ImageOps

from .instagram import Instagram, InstagramError
from .direct_instagram import DirectInstagram
from .browser_instagram import BrowserInstagram, BrowserNotSent
from .folder_import import FolderImporter
from .queue_store import QueueConflict, QueueStore
from .scheduling import _slots, due_slots, next_slots, validate_schedule
from .photo_validation import validate_photo_dimensions
from .state import State


class Service:
    def __init__(self, data_dir, queue_dir, tz='Europe/Prague'):
        self.data_dir = Path(data_dir)
        self.state = State(data_dir, tz)
        self.state.data['schedule'] = validate_schedule(self.state.data['schedule'])
        self.queue = QueueStore(Path(queue_dir), self.data_dir)
        self.instagram = Instagram(self.state)
        self.direct_instagram = DirectInstagram(self.state)
        self.browser_instagram = BrowserInstagram(self.state)
        self.folder_importer = FolderImporter(self.queue)
        self.import_status = {'imported': 0, 'pending': 0, 'duplicates': 0, 'errors': [], 'checked_at': None}
        self.stop = threading.Event()
        self.queue_guard = threading.RLock()
        self.connection_guard = threading.RLock()
        self.calendar_slots = []
        self.calendar_error = ''
        self.worker_error = ''
        self.last_calendar_read = 0
        self.last_scan = 0
        self.media_dir = self.data_dir / 'media'
        self.media_dir.mkdir(exist_ok=True)

    def ha_get(self, path, params=None):
        token = os.environ.get('SUPERVISOR_TOKEN')
        if not token:
            raise ValueError('Home Assistant calendars are available when installed as an app in Home Assistant OS.')
        try:
            r = requests.get('http://supervisor/core/api/' + path,
                             headers={'Authorization': f'Bearer {token}'}, params=params, timeout=(5, 12))
            if r.status_code == 404 and path == 'calendars':
                return []
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError):
            raise ValueError('Home Assistant calendar could not be read. Check the selected entity and permissions.') from None

    def calendars(self):
        return self.ha_get('calendars')

    def calendar_week(self, start):
        """Read seven local dates for the UI without changing publishing state."""
        with self.state.lock:
            source = self.state.data['schedule_source']
            entity = self.state.data['calendar_entity']
            schedule = json.loads(json.dumps(self.state.data['schedule']))
        zone = ZoneInfo(schedule['timezone'])
        try:
            first_day = date.fromisoformat(start)
            if first_day.isoformat() != start:
                raise ValueError()
        except (ValueError, TypeError):
            raise ValueError('The calendar week must start with a date in YYYY-MM-DD format.') from None
        if abs((first_day - datetime.now(zone).date()).days) > 366:
            raise ValueError('Choose a calendar week within 366 days of today.')
        first = datetime.combine(first_day, datetime.min.time(), tzinfo=zone)
        end = datetime.combine(first_day + timedelta(days=7), datetime.min.time(), tzinfo=zone)
        result = {'start': first.isoformat(), 'end': end.isoformat(),
                  'timezone': zone.key, 'source': source, 'slots': []}
        first_utc, end_utc = first.astimezone(timezone.utc), end.astimezone(timezone.utc)
        if source == 'internal':
            result['slots'] = _slots(schedule, first_utc, end_utc - timedelta(microseconds=1))
            return result
        if not entity:
            raise ValueError('Select a Home Assistant calendar first.')
        events = self.ha_get('calendars/' + entity,
                             {'start': first.isoformat(), 'end': end.isoformat()})
        if not isinstance(events, list):
            raise ValueError('Home Assistant returned an invalid calendar response.')
        for event in events:
            if not isinstance(event, dict) or str(event.get('status', '')).lower() in ('cancelled', 'canceled'):
                continue
            event_start = event.get('start')
            raw = event_start.get('dateTime') if isinstance(event_start, dict) else None
            if not isinstance(raw, str):  # All-day events do not publish.
                continue
            try:
                at = datetime.fromisoformat(raw.replace('Z', '+00:00'))
            except ValueError:
                continue
            if at.tzinfo is None or at.utcoffset() is None:
                continue
            at = at.astimezone(timezone.utc)
            if not first_utc <= at < end_utc:
                continue
            identity = json.dumps([entity, event.get('uid', ''), at.isoformat()])
            result['slots'].append({'key': 'ha-' + hashlib.sha256(identity.encode()).hexdigest(),
                                    'at': at.isoformat(), 'label': event.get('summary') or 'Calendar event'})
        result['slots'].sort(key=lambda slot: (slot['at'], slot['key']))
        return result

    @property
    def account_client(self):
        method = self.state.data['connection_method']
        return {'browser': self.browser_instagram, 'direct': self.direct_instagram,
                'official': self.instagram}[method]

    def update_settings(self, changes):
        changes = dict(changes)
        with self.queue_guard:
            folder = changes.get('import_dir', self.state.data['import_dir'])
            enabled = changes.get('import_enabled', self.state.data['import_enabled'])
            if folder and ('import_dir' in changes or ('import_enabled' in changes and enabled)):
                changes['import_dir'] = self.folder_importer.validate_folder(folder)
            self.state.update(changes)

    def scan_import_folder(self, automatic=False):
        with self.queue_guard:
            with self.state.lock:
                folder = self.state.data['import_dir']
                enabled = self.state.data['import_enabled']
            if automatic and not enabled:
                return self.import_status
            if not folder:
                raise ValueError('Choose an import folder first.')
            try:
                result = self.folder_importer.scan(folder)
            except (ValueError, OSError) as error:
                message = str(error) if isinstance(error, ValueError) else 'The import folder could not be read. Check its availability and permissions.'
                result = {'imported': 0, 'pending': 0, 'duplicates': 0,
                          'errors': [{'filename': '', 'message': message}]}
            self.import_status = result | {'checked_at': datetime.now(timezone.utc).isoformat()}
            return self.import_status

    def enable(self):
        with self.connection_guard:
            with self.state.lock:
                source = self.state.data['schedule_source']
                entity = self.state.data['calendar_entity']
                method = self.state.data['connection_method']
            if source == 'home_assistant':
                if not entity:
                    raise ValueError('Select a Home Assistant calendar first.')
                if not any(c.get('entity_id') == entity for c in self.calendars()):
                    raise ValueError('The selected Home Assistant calendar is unavailable. Choose an existing calendar.')
                self.refresh_calendar(datetime.now(timezone.utc))
                if self.calendar_error:
                    raise ValueError(self.calendar_error)
            if method == 'official':
                self.verify_public_endpoint()
            self.account_client.check()
            self.state.update({'enabled': True})

    @staticmethod
    def _manual_result(attempt, expected_post_id, replayed):
        if attempt['item_id'] != expected_post_id:
            raise QueueConflict('The manual request belongs to a different post. Refresh the queue before publishing.')
        return {'ok': attempt['state'] == 'published', 'replayed': replayed, 'attempt': attempt}

    def publish_next(self, data):
        """Publish one explicitly selected head, without changing its calendar.

        The existing attempts table is the idempotency receipt. A retry after an
        HTTP timeout returns that receipt, including an in-flight/uncertain state,
        instead of consuming the next item. The connection lock rejects concurrent
        manual requests rather than putting several publications into a wait queue.
        """
        if (not isinstance(data, dict) or set(data) != {'expected_post_id', 'request_id'}
                or not isinstance(data.get('expected_post_id'), str)
                or not re.fullmatch(r'[0-9a-f]{32}', data['expected_post_id'])
                or not isinstance(data.get('request_id'), str)
                or not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', data['request_id'])):
            raise ValueError('The manual publication request is invalid. Refresh the queue and try again.')
        expected = data['expected_post_id']
        event_key = 'manual:' + data['request_id']
        previous = self.queue.attempt_for_event(event_key)
        if previous:
            return self._manual_result(previous, expected, True)
        if not self.connection_guard.acquire(blocking=False):
            raise QueueConflict('Another publication or account operation is in progress. Wait for it to finish.')
        try:
            with self.queue_guard:
                # Another request may have completed between the first lookup
                # and taking the lock. Recheck before authentication or claiming.
                previous = self.queue.attempt_for_event(event_key)
                if previous:
                    return self._manual_result(previous, expected, True)
                with self.state.lock:
                    method = self.state.data['connection_method']
                    connected = self.state.data['account'].get('connected')
                if not connected:
                    raise QueueConflict('Connect and verify Instagram before publishing a post.')
                if method == 'browser' and self.browser_instagram.status()['active']:
                    raise QueueConflict('Finish or close Instagram sign-in before publishing a post.')
                # Reordering must not bypass an unresolved external result.
                if self.queue.open_attempts():
                    raise QueueConflict('Resolve the pending or uncertain publication in History before publishing another post.')
                attempt = self.queue.claim(event_key, expected_item_id=expected)
                if attempt is None:
                    previous = self.queue.attempt_for_event(event_key)
                    if previous:
                        return self._manual_result(previous, expected, True)
                    raise QueueConflict('The next post could not be claimed. Refresh the queue and check its files.')
            self.publish(attempt)
            return self._manual_result(self.queue.get_attempt(attempt['attempt_id']), expected, False)
        finally:
            self.connection_guard.release()

    def refresh_calendar(self, now):
        with self.state.lock:
            entity = self.state.data['calendar_entity']
            source = self.state.data['schedule_source']
        self.last_calendar_read = time.monotonic()
        if not entity or source != 'home_assistant':
            self.calendar_slots = []
            self.calendar_error = ''
            return
        try:
            events = self.ha_get('calendars/' + entity, {
                'start': (now - timedelta(seconds=90)).isoformat(),
                'end': (now + timedelta(days=8)).isoformat()})
            slots = []
            for event in events:
                if event.get('status', '').lower() in ('cancelled', 'canceled'):
                    continue
                raw = event.get('start', {}).get('dateTime')
                if not raw:  # All-day events do not publish.
                    continue
                at = datetime.fromisoformat(raw.replace('Z', '+00:00'))
                if at.tzinfo is None:
                    continue
                identity = json.dumps([entity, event.get('uid', ''), at.astimezone(timezone.utc).isoformat()])
                slots.append({'key': 'ha-' + hashlib.sha256(identity.encode()).hexdigest(),
                              'at': at.astimezone(timezone.utc).isoformat(),
                              'label': event.get('summary') or 'Calendar event'})
            self.calendar_slots = sorted(slots, key=lambda slot: slot['at'])
            self.calendar_error = ''
        except ValueError as e:
            self.calendar_error = str(e)
            self.calendar_slots = []  # Do not use stale, possibly cancelled events.

    def slots(self, now, due=False):
        with self.state.lock:
            source, schedule = self.state.data['schedule_source'], self.state.data['schedule']
        if source == 'internal':
            return due_slots(schedule, now) if due else next_slots(schedule, now, limit=14)
        slots = self.calendar_slots
        if due:
            return [s for s in slots if 0 <= (now - datetime.fromisoformat(s['at'])).total_seconds() <= 90]
        return [s for s in slots if datetime.fromisoformat(s['at']) >= now][:14]

    def snapshot(self):
        now = datetime.now(timezone.utc)
        with self.state.lock:
            schedule = json.loads(json.dumps(self.state.data['schedule']))
            account = dict(self.state.data['account'])
        warnings = [m for m in (self.calendar_error, self.worker_error) if m]
        if self.state.data['schedule_source'] == 'home_assistant' and not self.state.data['calendar_entity']:
            warnings.append('Select a Home Assistant calendar to schedule posts.')
        browser_status = self.browser_instagram.status()
        return {'queue': self.queue.list_items(), 'schedule': schedule,
                'next_slots': self.slots(now), 'history': self.queue.history(),
                'settings': self.state.settings(), 'account': account,
                'server_time': now.isoformat(), 'queue_path': str(self.queue.queue_dir), 'warnings': warnings,
                'import_status': json.loads(json.dumps(self.import_status)),
                'browser_status': {key: browser_status[key] for key in ('active', 'busy')}}

    def verify_public_endpoint(self):
        with self.state.lock:
            base, expected = self.state.data['public_media_base_url'], self.state.data['installation_id']
        if not base:
            raise ValueError('Set the public HTTPS media URL first.')
        try:
            r = requests.get(base + '/healthz', timeout=(5, 10))
            r.raise_for_status()
            if r.json().get('installation_id') != expected:
                raise ValueError()
        except (requests.RequestException, ValueError):
            raise ValueError('The public HTTPS URL does not reach this app media endpoint on port 8098.') from None

    def prepare_image(self, item_id):
        source = self.queue.image_path(item_id)
        if source.stat().st_size > 16 * 1024 * 1024:
            raise ValueError('Each uploaded file must be smaller than 16 MB.')
        payload = source.read_bytes()
        if hashlib.sha256(payload).hexdigest() != self.queue.get(item_id)['sha256']:
            raise ValueError('The image is missing or has changed since import. Restore the original file.')
        with Image.open(io.BytesIO(payload)) as im:
            validate_photo_dimensions(im)
            image = ImageOps.exif_transpose(im)
            ratio = image.width / image.height
            if im.info.get('icc_profile'):
                try:
                    image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(im.info['icc_profile'])),
                                                      ImageCms.createProfile('sRGB'), outputMode='RGB')
                except (ValueError, OSError, ImageCms.PyCMSError):
                    raise ValueError('The embedded color profile could not be converted to sRGB.') from None
            if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
                rgba = image.convert('RGBA')
                image = Image.new('RGB', rgba.size, 'white')
                image.paste(rgba, mask=rgba.getchannel('A'))
            else:
                image = image.convert('RGB')
            if image.width > 1440:
                image = image.resize((1440, round(1440 / ratio)), Image.Resampling.LANCZOS)
            grant = secrets.token_urlsafe(32)
            target = self.media_dir / f'{grant}.jpg'
            image.save(target, 'JPEG', quality=95, subsampling=0)
        if target.stat().st_size > 8_000_000:
            target.unlink()
            raise ValueError('The prepared JPEG exceeds the Instagram 8 MB limit.')
        return target

    def media_url(self, item_id):
        target = self.prepare_image(item_id)
        grant = target.stem
        with self.state.lock:
            self.state.data['grants'][grant] = {'file': target.name, 'expires': time.time() + 86400}
            self.state.save()
            return self.state.data['public_media_base_url'] + f'/media/{grant}.jpg'

    def public_media(self, grant):
        with self.state.lock:
            record = self.state.data['grants'].get(grant)
        if not record or record['expires'] < time.time():
            return None
        path = self.media_dir / record['file']
        if path.parent.resolve() != self.media_dir.resolve() or path.is_symlink() or not path.is_file():
            return None
        return path

    def cleanup_media(self):
        with self.state.lock:
            expired = [k for k, v in self.state.data['grants'].items() if v['expires'] < time.time()]
            for key in expired:
                record = self.state.data['grants'].pop(key)
                path = self.media_dir / record['file']
                if path.parent.resolve() == self.media_dir.resolve() and path.is_file() and not path.is_symlink():
                    path.unlink()
            if expired:
                self.state.save()

    def publish(self, attempt):
        attempt_id = attempt['attempt_id']
        publish_started = False
        prepared = None
        try:
            with self.connection_guard:
                if self.state.data['connection_method'] in ('browser', 'direct'):
                    client = self.account_client
                    client.check()
                    prepared = self.prepare_image(attempt['item_id'])
                    def before_share():
                        nonlocal publish_started
                        self.queue.update_attempt(attempt_id, state='publishing')
                        publish_started = True
                    if self.state.data['connection_method'] == 'browser':
                        result = client.upload(prepared, attempt['caption'], before_share=before_share)
                    else:
                        before_share()
                        result = client.upload(prepared, attempt['caption'])
                    media_id = str(result['id'])
                    if not media_id:
                        raise InstagramError('Instagram did not confirm the published post. Check the profile before retrying.')
                    permalink = result.get('permalink', '')
                    self.queue.update_attempt(attempt_id, media_id=media_id, permalink=permalink)
                    self.queue.finish(attempt_id, media_id, permalink)
                    return
                self.instagram.refresh_if_needed()
                account = self.instagram.check()
                user_id = account['id']
                url = self.media_url(attempt['item_id'])
                result = self.instagram.request('POST', user_id + '/media',
                                                {'image_url': url, 'caption': attempt['caption']})
                container = str(result['id'])
                self.queue.update_attempt(attempt_id, state='container_created', container_id=container)
                for _ in range(30):
                    status = self.instagram.container_status(container)
                    if status == 'FINISHED':
                        break
                    if status in ('ERROR', 'EXPIRED', 'PUBLISHED'):
                        raise InstagramError('The Instagram container cannot be published in its current state.')
                    if self.stop.wait(2):
                        raise InstagramError('The app stopped before publication; no post was sent.')
                else:
                    raise InstagramError('Instagram is still processing the image. No post was sent.')
                self.queue.update_attempt(attempt_id, state='publishing')
                publish_started = True
                result = self.instagram.request('POST', user_id + '/media_publish', {'creation_id': container})
                media_id = str(result['id'])
                self.queue.update_attempt(attempt_id, media_id=media_id)
                try:
                    permalink = self.instagram.permalink(media_id)
                except InstagramError:
                    permalink = ''
                if result.get('config_issue'):
                    self.queue.update_attempt(attempt_id, note='Instagram published the image with a caption warning. Check the post.')
                self.queue.finish(attempt_id, media_id, permalink)
        except Exception as e:
            safe = str(e) if isinstance(e, (ValueError, InstagramError)) else 'Publication was interrupted. Check the Instagram profile before retrying.'
            self.queue.fail(attempt_id, safe, uncertain=publish_started and not isinstance(e, BrowserNotSent))
        finally:
            if prepared is not None:
                prepared.unlink(missing_ok=True)

    def recover(self):
        for attempt in self.queue.open_attempts():
            if attempt.get('media_id'):
                try:
                    permalink = attempt.get('permalink') or self.account_client.permalink(attempt['media_id'])
                    self.queue.finish(attempt['attempt_id'], attempt['media_id'], permalink)
                    continue
                except Exception:
                    pass
            if attempt.get('state') == 'publishing' or attempt.get('media_id'):
                self.queue.fail(attempt['attempt_id'], 'The app restarted during publication. Verify the Instagram profile; automatic retry is blocked.', uncertain=True)
            elif attempt.get('state') in ('claimed', 'container_created'):
                self.queue.fail(attempt['attempt_id'], 'The app restarted before publishing. You can retry this post.')

    def run(self):
        self.recover()
        while not self.stop.is_set():
            try:
                now = datetime.now(timezone.utc)
                if time.monotonic() - self.last_scan > 30:
                    with self.queue_guard:
                        self.queue.scan()
                        self.scan_import_folder(automatic=True)
                    self.cleanup_media()
                    self.last_scan = time.monotonic()
                if time.monotonic() - self.last_calendar_read > 30:
                    self.refresh_calendar(now)
                with self.state.lock:
                    enabled = self.state.data['enabled']
                if enabled:
                    for slot in self.slots(now, due=True):
                        with self.connection_guard:
                            with self.state.lock:
                                if not self.state.data['enabled']:
                                    break
                            # A manual publication/account operation may have held
                            # this lock. Never replay a calendar slot after its
                            # normal grace window merely because we waited here.
                            age = (datetime.now(timezone.utc) - datetime.fromisoformat(slot['at'])).total_seconds()
                            if not 0 <= age <= 90:
                                continue
                            with self.queue_guard:
                                attempt = self.queue.claim(slot['key'])
                            if attempt:
                                self.publish(attempt)
                self.worker_error = ''
            except Exception as e:
                self.worker_error = str(e) if isinstance(e, ValueError) else 'The scheduler encountered an error. Check the queue before resuming.'
            self.stop.wait(5)

    def resolve(self, attempt_id, data):
        attempt = self.queue.get_attempt(attempt_id)
        if attempt['state'] not in ('uncertain', 'publishing'):
            raise ValueError('Only uncertain publications can be resolved manually.')
        if data.get('published') is True:
            link = data.get('permalink', '')
            parsed = urlsplit(link)
            if parsed.scheme != 'https' or parsed.hostname not in ('www.instagram.com', 'instagram.com') or not parsed.path.startswith(('/p/', '/reel/')):
                raise ValueError('Provide the verified Instagram post URL.')
            return self.queue.finish(attempt_id, attempt.get('media_id') or '', link)
        if data.get('published') is False and len(data.get('note', '').strip()) >= 8:
            return self.queue.resolve_not_published(attempt['item_id'], data['note'].strip())
        raise ValueError('Confirm that you checked the Instagram profile and provide a note.')
