import { createHash } from 'node:crypto';

export const credentials = { clientId: 'synthetic-google-client.apps.googleusercontent.com', clientSecret: 'synthetic-client-secret' };
export class FakeGoogle {
  constructor() {
    this.calls = [];
    this.files = [];
    this.uploads = [];
    this.deleted = [];
    this.folders = [];
    this.contents = new Map();
    this.authorized = true;
    this.badChecksum = false;
  }
  json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers }); }
  fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    this.calls.push({ url: u.href, method, headers: init.headers, body: init.body });
    if (u.href === 'https://oauth2.googleapis.com/device/code')
      return this.json({ device_code: 'synthetic-device-code', user_code: 'WWWWWWWWWWWWWWW', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 });
    if (u.href === 'https://oauth2.googleapis.com/token') {
      if (init.body.get('grant_type') === 'refresh_token') {
        if (this.tokenError) return this.json({ error: this.tokenError }, 400);
        return this.json({ access_token: 'synthetic-access-token', expires_in: 3600 });
      }
      if (this.pollError) return this.json({ error: this.pollError }, 403);
      if (!this.authorized) return this.json({ error: 'authorization_pending' }, 428);
      return this.json({ refresh_token: 'synthetic-refresh-token', access_token: 'synthetic-access-token', scope: 'https://www.googleapis.com/auth/drive.file' });
    }
    if (u.origin !== 'https://www.googleapis.com') throw Error('Unexpected external request in the test.');
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      this.folder = { ...JSON.parse(init.body), id: 'synthetic-folder' };
      this.folders.push(this.folder);
      return this.json({ id: this.folder.id });
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      this.metadata = JSON.parse(init.body);
      return this.json({}, 200, { Location: this.location || 'https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic' });
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'PUT') {
      if (this.uploadWait) await this.uploadWait(init.signal);
      const bytes = Buffer.from(init.body), id = 'uploaded-' + this.uploads.length;
      this.uploads.push(bytes);
      const f = { ...this.metadata, id, createdTime: new Date().toISOString(), size: String(bytes.length), md5Checksum: createHash('md5').update(bytes).digest('hex') };
      this.files.push(f);
      this.contents.set(id, bytes);
      return this.json({ id, size: String(bytes.length), md5Checksum: this.badChecksum || this.badChecksumAt === this.uploads.length ? 'wrong-checksum' : createHash('md5').update(bytes).digest('hex') });
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      if (this.listError) return this.json({ error: {} }, 503);
      return this.json({ files: u.searchParams.get('q')?.includes("value='folder'") ? this.folders : this.files, nextPageToken: this.nextPageToken });
    }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'GET') {
      const id = u.pathname.split('/').at(-1);
      if (u.searchParams.get('alt') === 'media') return new Response(this.contents.get(id));
      return this.json(this.files.find(f => f.id === id) || this.folders.find(f => f.id === id) || {}, 200);
    }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'PATCH') {
      const id = u.pathname.split('/').at(-1);
      Object.assign(this.files.find(f => f.id === id), JSON.parse(init.body));
      return this.json({ id });
    }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'DELETE') {
      const id = u.pathname.split('/').at(-1);
      this.deleted.push(id);
      this.files = this.files.filter(f => f.id !== id);
      return new Response(null, { status: 204 });
    }
    throw Error('Unexpected Google API request in the test.');
  };
}
