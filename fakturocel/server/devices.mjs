import { exchange } from './exchange.mjs';
import https from 'node:https';
import { exportWorkbook } from '../src/excel.js';
import officeCrypto from 'officecrypto-tool';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, X509Certificate, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomic, hash, fail } from './store.mjs';
export function deviceUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw fail(400, "Enter HTTPS the Home Assistant address including the port, for example https://homeassistant.local:8443.");
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw fail(400, "Connection requires HTTPS address without path, password and parameters.");
  return u.origin;
}
export async function tlsIdentity(root) {
  const file = path.join(root, "fakturocel-tls.json");
  let saved;
  try {
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink()) throw Error("Invalid certificate file.");
    saved = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const dir = await fs.mkdtemp(path.join(root, 'tls-'));
    try {
      const gitOpenSsl = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe'),
        openssl = process.env.OPENSSL_PATH || (process.platform === 'win32' && existsSync(gitOpenSsl) ? gitOpenSsl : 'openssl');
      await promisify(execFile)(openssl, ['req', '-x509', '-newkey', 'rsa:3072', '-sha256', '-nodes', '-days', '3650', '-subj', "/CN=Fakturocel", '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], {
        windowsHide: true
      });
      saved = {
        key: await fs.readFile(path.join(dir, 'key.pem'), 'utf8'),
        cert: await fs.readFile(path.join(dir, 'cert.pem'), 'utf8')
      };
      await atomic(file, JSON.stringify(saved));
    } finally {
      for (const name of ['key.pem', 'cert.pem']) await fs.unlink(path.join(dir, name)).catch(() => {});
      await fs.rmdir(dir);
    }
  }
  const certificate = new X509Certificate(saved.cert);
  return {
    ...saved,
    fingerprint: hash(certificate.raw)
  };
}
export class Devices {
  constructor(store) {
    this.store = store;
    this.tls = null;
    this.server = null;
    this.enabled = false;
    this.attempts = new Map();
  }
  list(actor) {
    this.store.role(actor, 'owner');
    return {
      enabled: this.enabled,
      fingerprint: this.tls?.fingerprint || null,
      devices: Object.values(this.store.meta('devices', {})).map(({
        tokenHash,
        ...d
      }) => d)
    };
  }
  async pair(input, actor) {
    return this.store.serial(() => {
      this.store.role(actor, 'owner');
      if (!this.enabled) throw fail(400, "The network port is not enabled. Turn on remote_enabled in addon settings and restart it.");
      const url = deviceUrl(input.url),
        name = String(input.name || '').trim().slice(0, 80);
      if (!name) throw fail(400, "Fill in the name of the device.");
      const all = this.store.meta('devices', {});
      if (Object.keys(all).length >= 100) throw fail(400, "First, remove some of the 100 devices.");
      const id = randomUUID(),
        token = randomBytes(32).toString('base64url');
      all[id] = {
        id,
        name,
        userId: actor.id,
        tokenHash: hash(token),
        createdAt: new Date().toISOString(),
        seq: 0,
        syncProtocol: 2
      };
      this.store.setMeta('devices', all);
      return {
        format: 'FakturocelPairing',
        version: 1,
        url,
        fingerprint: this.tls.fingerprint,
        id,
        token
      };
    });
  }
  async revoke(id, actor) {
    return this.store.serial(() => {
      this.store.role(actor, 'owner');
      const all = this.store.meta('devices', {});
      delete all[id];
      this.store.setMeta('devices', all);
      return {
        saved: true
      };
    });
  }
  auth(req) {
    this.store.available();
    const header = req.headers.authorization || '',
      match = /^Bearer ([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(header),
      device = match && this.store.meta('devices', {})[match[1]],
      incoming = hash(match?.[2] || '');
    if (!device || !timingSafeEqual(Buffer.from(device.tokenHash, 'hex'), Buffer.from(incoming, 'hex'))) throw fail(401, "The device is not paired or access has been revoked.");
    const actor = this.store.actor(device.userId, device.name);
    if (actor.role === 'reader') throw fail(403, "The device account no longer has the right to edit data.");
    actor.validateAccess = () => {
      const current = this.store.meta('devices', {})[device.id];
      if (!current || current.tokenHash !== device.tokenHash) throw fail(401, "Device access has been revoked.");
    };
    actor.deviceId = device.id;
    return actor;
  }
  async snapshot(actor) {
    return this.store.serial(() => {
      this.store.role(actor);
      const d = this.store.meta('devices', {})[actor.deviceId];
      return {
        ...this.store.read(),
        blobs: this.store.allBlobs(),
        actor: {
          id: actor.id,
          name: actor.name,
          role: 'editor'
        },
        deviceId: d.id,
        seq: d.seq,
        serverBackup: this.store.meta('lastBackup'),
        protocol: 1,
        syncProtocol: d.syncProtocol || 1,
        serverTime: new Date().toISOString()
      };
    });
  }
  async start(tls, port = 8443, host = '0.0.0.0') {
    this.tls = tls;
    this.server = https.createServer({
      key: tls.key,
      cert: tls.cert,
      minVersion: 'TLSv1.2',
      maxHeaderSize: 8192
    }, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const json = (status, value) => {
        res.writeHead(status, {
          'Content-Type': 'application/json'
        });
        res.end(JSON.stringify(value));
      };
      try {
        // No Ingress identity, cookies, browser CORS or redirects are accepted on this listener.
        if (req.headers.origin) throw fail(403, "This port is only used by paired applications.");
        const ip = req.socket.remoteAddress,
          now = Date.now(),
          limit = this.attempts.get(ip);
        if (limit && limit.until > now && limit.count >= 15) throw fail(429, "Too many invalid logins. Try it in a minute.");
        let actor;
        try {
          actor = this.auth(req);
          this.attempts.delete(ip);
        } catch (e) {
          if (this.attempts.size > 2048) this.attempts.clear();
          this.attempts.set(ip, {
            until: now + 60000,
            count: limit?.until > now ? limit.count + 1 : 1
          });
          throw e;
        }
        if (req.method === 'GET' && req.url === '/sync/snapshot') return json(200, await this.snapshot(actor));
        if (req.method === 'GET' && req.url === '/sync/excel') return await this.store.serial(async () => {
          this.store.role(actor);
          const bytes = Buffer.from(await exportWorkbook(this.store.read().state, await this.store.backupText())),
            output = this.store.context ? officeCrypto.encrypt(bytes, {
              password: this.store.recoveryKey()
            }) : bytes;
          this.store.role(actor);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          });
          res.end(output);
        });
        if (req.method === 'GET' && req.url === '/sync/meta') return json(200, {
          revision: this.store.revision,
          seq: this.store.meta('devices', {})[actor.deviceId].seq
        });
        if (req.method === 'POST' && req.url === '/sync/exchange') {
          if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, "JSON is required.");
          if (Number(req.headers['content-length']) > 320 * 1024 * 1024) throw fail(413, "Transmission is too large.");
          let size = 0;
          const chunks = [];
          for await (const c of req) {
            size += c.length;
            if (size > 320 * 1024 * 1024) throw fail(413, "Transmission is too large.");
            chunks.push(c);
          }
          let input;
          try {
            input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            throw fail(400, "Invalid transfer.");
          }
          await exchange(this.store, input, actor);
          return json(200, await this.snapshot(actor));
        }
        if (req.method === 'POST' && req.url === '/sync/commit') {
          if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, "JSON is required.");
          let size = 0;
          const chunks = [];
          for await (const c of req) {
            size += c.length;
            if (size > 8 * 1024 * 1024) throw fail(413, "The change is too big.");
            chunks.push(c);
          }
          let input;
          try {
            input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            throw fail(400, "Invalid request.");
          }
          if (!Number.isSafeInteger(input.seq) || input.seq < 1 || !Array.isArray(input.ops) || input.ops.some(o => !['companies', 'activities', 'texts', 'worklogs', 'documents', 'checks', 'payments', 'views'].includes(o.collection))) throw fail(400, "This change is not allowed for the device.");
          const remote = {
            deviceId: actor.deviceId,
            seq: input.seq,
            digest: hash(JSON.stringify(input))
          };
          await this.store.commit({
            ops: input.ops,
            reason: input.reason || '',
            remote
          }, actor);
          return json(200, await this.snapshot(actor));
        }
        throw fail(404, "Unknown operation.");
      } catch (e) {
        if (!res.headersSent) json(e.status || 400, {
          error: e.status ? e.message : "The request could not be completed."
        });else res.destroy();
      }
    });
    this.server.requestTimeout = 180000;
    this.server.headersTimeout = 10000;
    this.server.maxConnections = 64;
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, resolve);
    });
    this.enabled = true;
    return this.server.address();
  }
  async close() {
    this.enabled = false;
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise(r => this.server.close(r));
    }
  }
}
