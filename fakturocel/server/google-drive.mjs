import { createHash, randomUUID } from 'node:crypto';
import { fail } from './store.mjs';
import { backupFiles, backupFormats } from './backup-formats.mjs';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN = 'https://oauth2.googleapis.com/token';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,md5Checksum';
const KEY = 'googleDrive';
const idPattern = /^[A-Za-z0-9_-]{1,200}$/;
const defaults = { enabled: false, intervalHours: 24, keepCount: 10, format: 'zip' };

// Credentials live only in the encrypted server vault, outside portable backups.
// Network work has its own queue so a slow upload cannot hold up invoice saves.
export class GoogleDrive {
  constructor(store, { googleFetch = fetch, googleNow = Date.now, googleTimer = true } = {}) {
    this.store = store;
    this.fetch = googleFetch;
    this.now = googleNow;
    this.queue = Promise.resolve();
    this.epoch = 0;
    this.controllers = new Set();
    this.busy = false;
    this.pending = null;
    this.closed = false;
    if (googleTimer) this.timer = setInterval(() => { void this.tick().catch(() => {}); }, 60000).unref();
  }

  config() { return { ...defaults, ...this.store.meta(KEY, {}) }; }
  encrypted() {
    this.store.available();
    if (!this.store.context) throw fail(400, 'Enable data encryption before connecting or backing up to Google Drive.');
  }
  status(actor) {
    this.store.role(actor, 'owner');
    const c = this.config();
    return {
      connected: !!c.refreshToken, enabled: c.enabled, intervalHours: c.intervalHours,
      keepCount: c.keepCount, format: c.format, folderId: c.folderId || null,
      lastSuccess: c.lastSuccess || null, lastAttempt: c.lastAttempt || null,
      lastError: c.lastError || null, nextAttempt: c.nextAttempt || null, busy: this.busy,
      encrypted: !!this.store.context,
      encryptBackups: this.store.backupEncryption().cloud,
      authorization: this.pending && this.pending.expiresAt > this.now() ? {
        userCode: this.pending.userCode, verificationUrl: this.pending.verificationUrl,
        expiresAt: new Date(this.pending.expiresAt).toISOString()
      } : null
    };
  }
  serial(fn) {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => {});
    return task;
  }
  cancel() {
    this.epoch++;
    for (const controller of this.controllers) controller.abort();
  }
  check(epoch) {
    if (this.closed || this.wiping || this.epoch !== epoch) throw fail(409, 'Google Drive settings changed. Try the action again.');
    this.encrypted();
  }
  async request(url, init = {}, epoch = this.epoch, binary = false) {
    this.check(epoch);
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const response = await this.fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]) });
      this.check(epoch);
      if (binary && response.ok) {
        const limit = 300 * 1024 * 1024;
        if (Number(response.headers.get('content-length')) > limit) throw fail(413, 'The cloud backup is too large.');
        let size = 0;
        const chunks = [];
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > limit) { controller.abort(); throw fail(413, 'The cloud backup is too large.'); }
          chunks.push(chunk);
        }
        this.check(epoch);
        return { ok: true, bytes: Buffer.concat(chunks) };
      }
      // Consume the response while the abort controller still protects the operation.
      let data;
      try { data = await response.json(); } catch { data = {}; }
      this.check(epoch);
      return { ok: response.ok, status: response.status, headers: response.headers, data };
    } catch (e) {
      this.check(epoch);
      if (e.status) throw e;
      throw fail(502, 'Google Drive could not be reached. Check the internet connection and try again.');
    } finally { this.controllers.delete(controller); }
  }
  error(response) {
    const code = response.data.error;
    if (code === 'invalid_grant' || code === 'access_denied' || code === 'expired_token' || response.status === 401)
      return fail(401, 'Google Drive authorization expired or was denied. Connect the account again.');
    if (code === 'invalid_client' || code === 'unauthorized_client')
      return fail(400, 'Check the Google client ID, client secret, and the TVs and Limited Input devices client type.');
    if (response.status === 429 || code === 'rate_limit_exceeded')
      return fail(429, 'Google Drive is temporarily limiting requests. The automatic backup will retry later.');
    if (response.status === 403)
      return fail(403, 'Google Drive refused access. Check the granted permission, available storage, and whether the Drive API is enabled.');
    return fail(502, 'Google Drive could not complete the request. Check the connection, account permissions, and available storage.');
  }
  async oauth(parameters, epoch) {
    return this.request(TOKEN, { method: 'POST', body: new URLSearchParams(parameters) }, epoch);
  }
  async save(patch, epoch) {
    return this.store.serial(() => {
      this.check(epoch);
      this.store.setMeta(KEY, { ...this.config(), ...patch });
    });
  }
  async configure(input, actor) {
    this.store.role(actor, 'owner');
    if (typeof input.enabled !== 'boolean' || !Number.isInteger(input.intervalHours) || input.intervalHours < 1 || input.intervalHours > 720 ||
        !Number.isInteger(input.keepCount) || input.keepCount < 2 || input.keepCount > 100)
      throw fail(400, 'Choose an interval of 1 to 720 hours and keep 2 to 100 backups.');
    const format = input.format || this.config().format;
    if (!backupFormats.has(format)) throw fail(400, 'Choose ZIP, Excel, or both backup formats.');
    if (input.enabled) this.encrypted();
    this.cancel();
    const epoch = this.epoch;
    await this.store.serial(() => {
      this.store.role(actor, 'owner');
      if (epoch !== this.epoch) throw fail(409, 'Google Drive settings changed. Try the action again.');
      const c = this.config();
      if (input.enabled && !c.refreshToken) throw fail(400, 'Connect a Google account before enabling automatic backups.');
      this.store.setMeta(KEY, { ...c, enabled: input.enabled, intervalHours: input.intervalHours, keepCount: input.keepCount, format, nextAttempt: null });
    });
    return this.status(actor);
  }
  async begin(input, actor) {
    this.store.role(actor, 'owner');
    this.encrypted();
    const clientId = String(input.clientId || '').trim(), clientSecret = String(input.clientSecret || '').trim();
    if (!/^[A-Za-z0-9_.-]{10,250}\.apps\.googleusercontent\.com$/.test(clientId) || !clientSecret || clientSecret.length > 500 || /\s/.test(clientSecret))
      throw fail(400, 'Enter a valid Google client ID and client secret.');
    this.cancel();
    this.pending = null;
    const epoch = this.epoch;
    return this.serial(async () => {
      this.store.role(actor, 'owner');
      const r = await this.request('https://oauth2.googleapis.com/device/code', {
        method: 'POST', body: new URLSearchParams({ client_id: clientId, scope: SCOPE })
      }, epoch);
      if (!r.ok) throw this.error(r);
      const d = r.data;
      let url;
      try { url = new URL(d.verification_url); } catch {}
      if (!url || url.protocol !== 'https:' || !['www.google.com', 'accounts.google.com'].includes(url.hostname) || url.username || url.password || url.port ||
          typeof d.device_code !== 'string' || typeof d.user_code !== 'string' || !/^[\x21-\x7e]{1,100}$/.test(d.user_code) || !(d.expires_in > 0 && d.expires_in <= 3600))
        throw fail(502, 'Google returned an invalid authorization response. Try connecting again.');
      this.store.role(actor, 'owner');
      this.pending = { clientId, clientSecret, deviceCode: d.device_code, userCode: d.user_code, verificationUrl: d.verification_url,
        expiresAt: this.now() + d.expires_in * 1000, interval: Math.max(5, Number(d.interval) || 5) * 1000, nextPoll: this.now() + Math.max(5, Number(d.interval) || 5) * 1000 };
      return this.status(actor);
    });
  }
  async poll(actor) {
    this.store.role(actor, 'owner');
    const epoch = this.epoch;
    return this.serial(async () => {
      this.store.role(actor, 'owner');
      this.check(epoch);
      const p = this.pending;
      if (!p) return this.status(actor);
      if (p.expiresAt <= this.now()) { this.pending = null; throw fail(400, 'The Google authorization code expired. Start the connection again.'); }
      if (this.now() < p.nextPoll) return this.status(actor);
      p.nextPoll = this.now() + p.interval;
      const r = await this.oauth({ client_id: p.clientId, client_secret: p.clientSecret, device_code: p.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, epoch);
      if (!r.ok) {
        if (r.data.error === 'authorization_pending') return this.status(actor);
        if (r.data.error === 'slow_down') { p.interval += 5000; p.nextPoll = this.now() + p.interval; return this.status(actor); }
        this.pending = null;
        throw this.error(r);
      }
      if (!r.data.refresh_token || !r.data.access_token || !String(r.data.scope || SCOPE).split(' ').includes(SCOPE))
        throw fail(502, 'Google did not grant renewable backup access. Connect the account again.');
      const installationId = this.config().installationId || randomUUID();
      const headers = { Authorization: 'Bearer ' + r.data.access_token, 'Content-Type': 'application/json' };
      const folder = await this.request(DRIVE + '?fields=id', { method: 'POST', headers, body: JSON.stringify({
        name: 'Fakturocel backups ' + installationId.slice(0, 8), mimeType: 'application/vnd.google-apps.folder',
        appProperties: { fakturocel: 'folder', installation: installationId }
      }) }, epoch);
      if (!folder.ok) throw this.error(folder);
      if (!idPattern.test(folder.data.id || '')) throw fail(502, 'Google returned an invalid backup folder. Connect the account again.');
      this.store.role(actor, 'owner');
      await this.save({ clientId: p.clientId, clientSecret: p.clientSecret, refreshToken: r.data.refresh_token,
        folderId: folder.data.id, installationId, enabled: false, lastSuccess: null, lastAttempt: null, lastError: null, nextAttempt: null, failures: 0 }, epoch);
      this.pending = null;
      return this.status(actor);
    });
  }
  async disconnect(actor) {
    this.store.role(actor, 'owner');
    this.cancel();
    this.pending = null;
    await this.store.serial(() => { this.store.role(actor, 'owner'); this.store.setMeta(KEY, null); });
    return this.status(actor);
  }
  async run(actor) {
    this.store.role(actor, 'owner');
    await this.backup(this.epoch, actor);
    return this.status(actor);
  }
  async headers(c, epoch) {
    if (!c.refreshToken || !idPattern.test(c.folderId || '') || !/^[a-f0-9-]{36}$/.test(c.installationId || ''))
      throw fail(400, 'Connect a Google account before creating a cloud backup.');
    const token = await this.oauth({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }, epoch);
    if (!token.ok) throw this.error(token);
    if (!token.data.access_token) throw fail(502, 'Google did not return backup access. Connect the account again.');
    return { Authorization: 'Bearer ' + token.data.access_token };
  }
  owned(file, c) {
    return idPattern.test(file.id || '') && !file.trashed && file.parents?.includes(c.folderId) &&
      file.appProperties?.fakturocel === 'backup' && file.appProperties?.installation === c.installationId;
  }
  async listFiles(c, headers, epoch) {
    const q = `'${c.folderId}' in parents and trashed = false and appProperties has { key='fakturocel' and value='backup' } and appProperties has { key='installation' and value='${c.installationId}' }`;
    const files = [], seen = new Set();
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q, fields: 'nextPageToken,files(id,name,size,createdTime,parents,appProperties)', pageSize: '1000', orderBy: 'createdTime desc' });
      if (pageToken) params.set('pageToken', pageToken);
      const list = await this.request(DRIVE + '?' + params, { headers }, epoch);
      if (!list.ok) throw this.error(list);
      if (!Array.isArray(list.data.files)) throw fail(502, 'Google returned an invalid backup list. Older backups were kept.');
      files.push(...list.data.files.filter(f => this.owned(f, c)));
      pageToken = list.data.nextPageToken || '';
      if (pageToken && (seen.has(pageToken) || seen.size >= 100)) throw fail(502, 'Google returned an incomplete backup list. Older backups were kept.');
      seen.add(pageToken);
    } while (pageToken);
    return [...new Map(files.map(f => [f.id, f])).values()];
  }
  async folderContext(folderId, c, headers, epoch) {
    if (!folderId || folderId === c.folderId) return c;
    if (!idPattern.test(folderId)) throw fail(400, 'Select a valid cloud backup folder.');
    const folder = await this.request(DRIVE + '/' + folderId + '?fields=id,mimeType,appProperties,trashed', { headers }, epoch);
    if (!folder.ok) throw this.error(folder);
    if (folder.data.trashed || folder.data.mimeType !== 'application/vnd.google-apps.folder' || folder.data.appProperties?.fakturocel !== 'folder' || !/^[a-f0-9-]{36}$/.test(folder.data.appProperties?.installation || ''))
      throw fail(403, 'Select a backup folder created by Fakturocel.');
    return { ...c, folderId, installationId: folder.data.appProperties.installation };
  }
  async folders(actor) {
    this.store.role(actor, 'owner');
    const epoch = this.epoch;
    return this.serial(async () => {
      this.store.role(actor, 'owner');
      const c = this.config(), headers = await this.headers(c, epoch), folders = [], seen = new Set();
      let pageToken = '';
      do {
        const params = new URLSearchParams({ q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='fakturocel' and value='folder' }", fields: 'nextPageToken,files(id,name,appProperties)', pageSize: '1000' });
        if (pageToken) params.set('pageToken', pageToken);
        const result = await this.request(DRIVE + '?' + params, { headers }, epoch);
        if (!result.ok) throw this.error(result);
        if (!Array.isArray(result.data.files)) throw fail(502, 'Google returned an invalid backup folder list.');
        folders.push(...result.data.files.filter(f => idPattern.test(f.id || '') && f.appProperties?.fakturocel === 'folder' && /^[a-f0-9-]{36}$/.test(f.appProperties.installation)).map(f => ({ id: f.id, name: f.name })));
        pageToken = result.data.nextPageToken || '';
        if (pageToken && (seen.has(pageToken) || seen.size >= 100)) throw fail(502, 'Google returned an incomplete backup folder list.');
        seen.add(pageToken);
      } while (pageToken);
      this.store.role(actor, 'owner');
      return { folders, currentFolderId: c.folderId };
    });
  }
  async list(actor, folderId) {
    this.store.role(actor, 'owner');
    const epoch = this.epoch;
    return this.serial(async () => {
      this.store.role(actor, 'owner');
      const c = this.config(), headers = await this.headers(c, epoch);
      const folder = await this.folderContext(folderId, c, headers, epoch);
      const files = await this.listFiles(folder, headers, epoch);
      this.store.role(actor, 'owner');
      return { files: files.sort((a,b) => String(b.createdTime).localeCompare(String(a.createdTime))).map(f => ({
        id: f.id, name: f.name, createdAt: f.createdTime, size: f.size, format: f.appProperties.format || 'fakturocel'
      })) };
    });
  }
  async download(id, actor, folderId) {
    this.store.role(actor, 'owner');
    if (!idPattern.test(id || '')) throw fail(400, 'Select a valid cloud backup.');
    const epoch = this.epoch;
    return this.serial(async () => {
      this.store.role(actor, 'owner');
      const c = this.config(), headers = await this.headers(c, epoch);
      const folder = await this.folderContext(folderId, c, headers, epoch);
      const meta = await this.request(DRIVE + '/' + id + '?fields=id,name,size,md5Checksum,parents,appProperties,trashed', { headers }, epoch);
      if (!meta.ok) throw this.error(meta);
      if (!this.owned(meta.data, folder) || !/\.(zip|xlsx|fakturocel)$/i.test(meta.data.name || '')) throw fail(403, 'This file is not a backup belonging to the selected Fakturocel folder.');
      if (Number(meta.data.size) > 300 * 1024 * 1024) throw fail(413, 'The cloud backup is too large.');
      const file = await this.request(DRIVE + '/' + id + '?alt=media', { headers }, epoch, true);
      if (!file.ok) throw this.error(file);
      if (Number(meta.data.size) !== file.bytes.length || meta.data.md5Checksum !== createHash('md5').update(file.bytes).digest('hex'))
        throw fail(502, 'The downloaded cloud backup could not be verified. Current data was kept.');
      this.store.role(actor, 'owner');
      return { bytes: file.bytes, name: meta.data.name };
    });
  }
  async tick() {
    if (this.closed || this.wiping || this.busy || this.scheduled || !this.store.ready || !this.store.context || this.store.locked || this.store.transitioning) return;
    const c = this.config();
    if (!c.enabled || !c.refreshToken) return;
    const due = c.nextAttempt ? Date.parse(c.nextAttempt) : c.lastSuccess ? Date.parse(c.lastSuccess) + c.intervalHours * 3600000 : 0;
    if (this.now() >= due) {
      this.scheduled = true;
      try { await this.backup(this.epoch); } finally { this.scheduled = false; }
    }
  }
  async backup(epoch, actor) {
    return this.serial(async () => {
      this.check(epoch);
      if (actor) this.store.role(actor, 'owner');
      const c = this.config();
      if (!c.refreshToken || !idPattern.test(c.folderId || '')) throw fail(400, 'Connect a Google account before creating a cloud backup.');
      this.busy = true;
      try {
        await this.save({ lastAttempt: new Date(this.now()).toISOString(), lastError: null }, epoch);
        const headers = await this.headers(c, epoch);
        const exports = await this.store.serial(async () => {
          this.check(epoch);
          if (actor) this.store.role(actor, 'owner');
          return backupFiles(this.store, c.format, this.store.backupEncryption().cloud);
        });
        this.check(epoch);
        const batch = randomUUID(), uploadedIds = new Set(), properties = new Map();
        const baseName = 'Fakturocel-' + new Date(this.now()).toISOString().replace(/[:.]/g, '-') + '-' + batch.slice(0, 8);
        for (const exported of exports) {
          const { bytes } = exported, name = baseName + '.' + exported.extension;
          const appProperties = { fakturocel: 'backup', installation: c.installationId, batch, format: exported.format, expectedCount: String(exports.length), verified: 'false' };
          const start = await this.request(UPLOAD, { method: 'POST', headers: { ...headers,
            'Content-Type': 'application/json; charset=utf-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(bytes.length) },
            body: JSON.stringify({ name, parents: [c.folderId], appProperties }) }, epoch);
          if (!start.ok) throw this.error(start);
          let location;
          try { location = new URL(start.headers.get('location')); } catch {}
          if (!location || location.origin !== 'https://www.googleapis.com' || location.username || location.password || !location.pathname.startsWith('/upload/drive/v3/files'))
            throw fail(502, 'Google returned an invalid upload address. The backup was not uploaded.');
          const upload = await this.request(location.href, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) }, body: bytes }, epoch);
          if (!upload.ok) throw this.error(upload);
          const file = upload.data;
          if (!idPattern.test(file.id || '') || Number(file.size) !== bytes.length || file.md5Checksum !== createHash('md5').update(bytes).digest('hex'))
            throw fail(502, 'The uploaded backup could not be verified. Older backups were kept.');
          uploadedIds.add(file.id);
          properties.set(file.id, appProperties);
        }
        // A partially uploaded pair must never displace an older complete backup.
        for (const id of uploadedIds) {
          const mark = await this.request(DRIVE + '/' + id + '?fields=id', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ appProperties: { ...properties.get(id), verified: 'true' } }) }, epoch);
          if (!mark.ok) throw this.error(mark);
        }
        // Retention only touches this installation's backups in its own folder.
        const files = await this.listFiles(c, headers, epoch), batches = new Map();
        for (const f of files) {
          if (uploadedIds.has(f.id) || f.appProperties.batch === batch) continue;
          const key = f.appProperties.batch || f.id;
          if (!batches.has(key)) batches.set(key, []);
          batches.get(key).push(f);
        }
        const complete = [], incomplete = [];
        for (const group of batches.values()) {
          const valid = !group[0].appProperties.batch || group.every(f => f.appProperties.verified === 'true' && Number(f.appProperties.expectedCount) === group.length);
          (valid ? complete : incomplete).push(group);
        }
        const older = complete.sort((a,b) => String(b[0].createdTime).localeCompare(String(a[0].createdTime)));
        for (const old of [...older.slice(c.keepCount - 1), ...incomplete].flat()) {
          const removed = await this.request(DRIVE + '/' + old.id, { method: 'DELETE', headers }, epoch);
          if (!removed.ok && removed.status !== 404) throw this.error(removed);
        }
        await this.save({ lastSuccess: new Date(this.now()).toISOString(), lastError: null, nextAttempt: null, failures: 0 }, epoch);
      } catch (e) {
        if (this.epoch === epoch && !this.closed && this.store.ready && this.store.context && !this.store.transitioning) {
          const failures = (this.config().failures || 0) + 1;
          await this.save({ lastError: e.message, failures,
            nextAttempt: new Date(this.now() + Math.min(3600000, 60000 * 2 ** Math.min(failures - 1, 6))).toISOString() }, epoch);
        }
        throw e;
      } finally { this.busy = false; }
    });
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.cancel();
    this.pending = null;
    await this.queue;
  }
}
