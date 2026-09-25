import http from 'node:http';
import { Devices, tlsIdentity } from './devices.mjs';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fail, finishPendingWipe } from './store.mjs';
import { SecureStore } from './secure-store.mjs';
import { encryptText } from './encryption.mjs';
import { unpackBackup } from '../src/model.js';
import { exportWorkbook } from '../src/excel.js';
import officeCrypto from 'officecrypto-tool';
import { Access } from './access.mjs';
import { recoveryPdf } from './recovery-pdf.mjs';
const MAX = 320 * 1024 * 1024;
async function body(req, limit = MAX) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, "JSON is required.");
  if (Number(req.headers['content-length']) > limit) throw fail(413, "The file is too large.");
  let n = 0;
  const chunks = [];
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw fail(413, "The file is too large.");
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fail(400, "Invalid JSON.");
  }
}
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};
export async function createApp(options) {
  await finishPendingWipe(options);
  const store = new SecureStore(options);
  try {
    await store.init();
  } catch (e) {
    store.close();
    throw e;
  }
  const access = new Access(store),
    devices = new Devices(store);
  let csrf = randomBytes(32).toString('hex');
  const allowed = options.allowRequest || (req => ['172.30.32.2', '::ffff:172.30.32.2'].includes(req.socket.remoteAddress));
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'");
    const json = (status, data) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(data));
    };
    try {
      if (!allowed(req)) throw fail(403, "Open the app via Home Assistant.");
      const id = req.headers['x-remote-user-id'],
        name = req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'];
      if (!id) throw fail(401, "Home Assistant did not pass on the identity of the logged-in user.");
      const url = new URL(req.url, 'http://localhost'),
        p = url.pathname;
      const accessActor = () => ({
        ...store.actor(id, name),
        validateAccess: () => access.require(req, id)
      });
      if (req.method === 'GET' && p === '/api/security') return json(200, {
        security: access.status(req, id),
        csrf
      });
      if (req.method === 'POST' && p.startsWith('/api/security/')) {
        if (req.headers["x-fakturocel-token"] !== csrf) throw fail(403, "The session has changed. Refresh the page.");
        const input = await body(req, 4096);
        if (req.headers["x-fakturocel-token"] !== csrf) throw fail(403, "The session has changed. Refresh the page.");
        if (p === '/api/security/setup') await store.setup(input, id, name);else if (p === '/api/security/unlock') await store.unlock(input.password, id, name);else if (p === '/api/security/pin-login') await access.login(input, req, res, id, name);else if (p === '/api/security/pin-recover') await access.recover(input, req, res, id, name);else {
          access.require(req, id);
          if (p === '/api/security/retry') await store.retryMigration(id, name);else if (p === '/api/security/change') await store.changeSecurity(input, accessActor());else if (p === '/api/security/pin') await access.change(input, accessActor(), req, res);else if (p === '/api/security/lock') access.lock(req, res);else throw fail(404, "Unknown operation.");
        }
        if (!p.endsWith('/pin-login') && !p.endsWith('/lock')) csrf = randomBytes(32).toString('hex');
        return json(200, {
          security: access.status(req, id),
          csrf
        });
      }
      if (p.startsWith('/api/')) access.require(req, id);
      const actor = p.startsWith('/api/') ? store.actor(id, name) : null;
      if (actor) actor.validateAccess = () => access.require(req, id);
      if (req.method === 'GET' && p === '/api/state') return json(200, {
        ...store.read(),
        csrf,
        actor,
        security: access.status(req, id),
        backupFolder: store.meta('backupFolder', store.initialFolder),
        lastBackup: store.meta('lastBackup'),
        roles: actor.role === 'owner' ? store.meta('roles', {}) : {}
      });
      if (req.method === 'GET' && p === '/api/security/recovery.pdf') {
        store.role(actor, 'owner');
        const ticketId = url.searchParams.get('ticket'),
          ticket = ticketId ? store.ticket(ticketId, actor) : null;
        const bytes = await recoveryPdf({
          key: store.recoveryKey(),
          keyId: store.keyId(),
          webRoot: options.webRoot
        });
        access.require(req, id);
        store.role(actor, 'owner');
        if (ticket) res.once('finish', () => {
          ticket.recoveryDownloaded = true;
        });
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': "attachment; filename=\"Fakturocel-renew-key-" + store.keyId() + '.pdf"'
        });
        return res.end(Buffer.from(bytes));
      }
      if (req.method === 'GET' && p === '/api/devices') return json(200, devices.list(actor));
      if (req.method === 'GET' && p === '/api/meta') return json(200, {
        revision: store.revision
      });
      if (req.method === 'GET' && p === '/api/backup') {
        const text = await store.serial(() => {
          access.require(req, id);
          return store.backupText();
        });
        access.require(req, id);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': "attachment; filename=\"Fakturocel-" + new Date().toISOString().slice(0, 10) + ".fakturocel\""
        });
        return res.end(text);
      }
      if (req.method === 'GET' && p === '/api/wipe/download') {
        const t = store.ticket(url.searchParams.get('ticket'), actor);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': "attachment; filename=\"Fakturocel-before-deletion.fakturocel\""
        });
        res.once('finish', () => {
          t.downloaded = true;
        });
        return res.end(t.text);
      }
      if (req.method === 'GET' && p.startsWith('/api/blob/')) {
        const b = store.blob(p.slice(10));
        res.writeHead(200, {
          'Content-Type': b.mime,
          'Content-Length': b.data.length
        });
        return res.end(b.data);
      }
      if (req.method === 'POST' && p.startsWith('/api/')) {
        if (req.headers["x-fakturocel-token"] !== csrf) throw fail(403, "The session has changed. Refresh the page.");
        const input = await body(req);
        if (req.headers["x-fakturocel-token"] !== csrf) throw fail(403, "The session has changed. Refresh the page.");
        access.require(req, id);
        if (p === '/api/devices/pair') return json(200, await devices.pair(input, actor));
        if (p === '/api/devices/revoke') return json(200, await devices.revoke(input.id, actor));
        if (p === '/api/commit') return json(200, await store.commit(input, actor));
        if (p === '/api/fix') return json(200, await store.fix(input, actor));
        if (p === '/api/restore') return json(200, await store.restoreEncrypted(input.text, input.password, input.revision, actor));
        if (p === '/api/restore/preview') {
          store.role(actor, 'owner');
          const value = await unpackBackup(await store.decryptExport(input.text, input.password));
          return json(200, {
            documents: value.data.documents.length,
            companies: value.data.companies.length,
            templates: value.data.templates.length
          });
        }
        if (p === '/api/wipe/verify') return json(200, await store.serial(() => store.verifyWipeBackup(input, actor)));
        if (p === '/api/export/excel') {
          return await store.serial(async () => {
            store.role(actor);
            const backup = await store.backupText(),
              bytes = Buffer.from(await exportWorkbook(store.read().state, backup)),
              output = store.context ? officeCrypto.encrypt(bytes, {
                password: store.recoveryKey()
              }) : bytes;
            store.role(actor);
            res.writeHead(200, {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'Content-Disposition': "attachment; filename=\"Fakturocel.xlsx\""
            });
            res.end(output);
          });
        }
        if (p === '/api/export/template') {
          store.role(actor, 'owner');
          if (input.bundle?.format !== 'FakturocelTemplate') throw fail(400, "Invalid template.");
          const text = JSON.stringify(input.bundle);
          return json(200, {
            text: store.context ? encryptText(text, store.context, 'template') : text
          });
        }
        if (p === '/api/import/template') {
          store.role(actor, 'owner');
          return json(200, {
            bundle: JSON.parse(await store.decryptExport(input.text, input.password, 'template'))
          });
        }
        if (p === '/api/backup') return json(200, await store.serial(() => {
          store.role(actor);
          return store.backup();
        }));
        if (p === '/api/upload') return json(200, await store.serial(() => store.upload(Buffer.from(input.base64 || '', 'base64'), input.mime, String(input.name || "File").slice(0, 200), actor)));
        if (p === '/api/folder') return json(200, await store.serial(async () => {
          store.role(actor, 'owner');
          await store.safeFolder(input.folder);
          store.setMeta('backupFolder', input.folder);
          store.setMeta('revision', store.revision + 1);
          return store.backup();
        }));
        if (p === '/api/roles') return json(200, await store.serial(() => {
          store.role(actor, 'owner');
          if (!input.roles || input.roles[actor.id]?.role !== 'owner' || Object.values(input.roles).some(x => !['owner', 'editor', 'reader'].includes(x.role))) throw fail(400, "You have to maintain your owner attitude.");
          store.setMeta('roles', input.roles);
          store.setMeta('revision', store.revision + 1);
          return {
            saved: true
          };
        }));
        if (p === '/api/wipe/prepare') return json(200, await store.wipePrepare(input.revision, actor));
        if (p === '/api/wipe/finish') {
          const result = await store.wipeFinish(input, actor);
          await devices.close();
          access.clear();
          access.cookie(req, res, null);
          csrf = randomBytes(32).toString('hex');
          return json(200, result);
        }
        throw fail(404, "Unknown operation.");
      }
      if (p.startsWith('/api/')) throw fail(404, "Unknown operation.");
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, "Illegal method.");
      let decoded;
      try {
        decoded = decodeURIComponent(p);
      } catch {
        throw fail(400, "Invalid address.");
      }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(x => x === '..' || x.startsWith('.'))) throw fail(404, "The file does not exist.");
      const file = path.resolve(options.webRoot, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (!file.startsWith(path.resolve(options.webRoot) + path.sep)) throw fail(404, "The file does not exist.");
      let st;
      try {
        st = await fs.stat(file);
      } catch (e) {
        if (e.code === 'ENOENT') throw fail(404, "The file does not exist.");
        throw e;
      }
      if (!st.isFile()) throw fail(404, "The file does not exist.");
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Content-Length': st.size
      });
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (e) {
      if (!res.headersSent) json(e.status || 400, {
        error: e.message
      });else res.destroy();
    }
  });
  server.requestTimeout = 180000;
  server.headersTimeout = 15000;
  return {
    server,
    store,
    access,
    devices,
    close: async () => {
      await devices.close();
      server.closeAllConnections();
      await new Promise(r => server.close(r));
      await store.queue;
      store.close();
    }
  };
}
export async function start() {
  const root = process.env.FAKTUROCEL_DATA || '/data';
  let config = {};
  try {
    config = JSON.parse(await fs.readFile(path.join(root, 'options.json'), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const app = await createApp({
    root,
    backupFolder: config.backup_folder || "/share/invoice/advances",
    shareRoot: '/share',
    webRoot: '/app/web'
  });
  if (config.remote_enabled !== false) await app.devices.start(await tlsIdentity(root));
  app.server.listen(8099, '0.0.0.0', () => console.log("Fakturocel 3 is ready via Home Assistant Ingress."));
  const stop = () => {
    app.close().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 9000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
if (process.env.FAKTUROCEL_RUN === '1' || process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start().catch(e => {
  console.error("Startup failed:", e.message);
  process.exit(1);
});
