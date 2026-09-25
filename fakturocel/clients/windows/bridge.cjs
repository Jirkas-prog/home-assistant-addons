const fs = require('node:fs/promises'),
  path = require('node:path'),
  https = require('node:https'),
  crypto = require('node:crypto');
async function atomic(file, bytes) {
  await fs.mkdir(path.dirname(file), {
    recursive: true
  });
  const tmp = file + '.tmp';
  const h = await fs.open(tmp, 'w', 0o600);
  try {
    await h.writeFile(bytes);
    await h.sync();
  } finally {
    await h.close();
  }
  await fs.rename(tmp, file);
}
function validatePair(p) {
  let url;
  try {
    url = new URL(p.url);
  } catch {
    throw Error("Invalid pairing address.");
  }
  if (p.format !== 'FakturocelPairing' || p.version !== 1 || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^[a-f0-9]{64}$/.test(p.fingerprint) || !/^[a-f0-9-]{36}$/.test(p.id) || !/^[A-Za-z0-9_-]{43}$/.test(p.token)) throw Error("Invalid pairing file.");
  return {
    ...p,
    url: url.origin
  };
}
function request(pair, {
  route,
  data
}) {
  if (!['snapshot', 'meta', 'commit', 'excel', 'exchange'].includes(route)) throw Error("Illegal operation.");
  const payload = data ? JSON.stringify(data) : null;
  if (Buffer.byteLength(payload || '') > (route === 'exchange' ? 320 : 8) * 1024 * 1024) throw Error("The change is too big.");
  return new Promise((resolve, reject) => {
    const req = https.request(pair.url + '/sync/' + route, {
      method: payload ? 'POST' : 'GET',
      agent: false,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      headers: {
        Authorization: 'Bearer ' + pair.id + '.' + pair.token,
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        } : {})
      }
    }, res => {
      let n = 0;
      const chunks = [];
      res.on('data', b => {
        n += b.length;
        if (n > 320 * 1024 * 1024) {
          req.destroy(Error("Downloaded data is too large."));
          return;
        }
        chunks.push(b);
      });
      res.on('error', reject);
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        if (route === 'excel' && res.statusCode === 200) return resolve({
          base64: bytes.toString('base64')
        });
        let result;
        try {
          result = JSON.parse(bytes.toString('utf8'));
        } catch {
          return reject(Error("The server returned invalid data."));
        }
        if (res.statusCode !== 200) return reject(Object.assign(Error(result.error || "The connection was refused."), {
          status: res.statusCode
        }));
        resolve(result);
      });
    });
    // Native pin validation runs before the HTTP request (and secret token) is sent.
    req.on('socket', socket => socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate(),
        fingerprint = cert.raw && crypto.createHash('sha256').update(cert.raw).digest('hex');
      if (fingerprint !== pair.fingerprint || Date.now() < Date.parse(cert.valid_from) || Date.now() > Date.parse(cert.valid_to)) req.destroy(Error("The server's certificate has changed. The connection has been stopped. Pair the device again via Home Assistant."));
    }));
    const deadline = setTimeout(() => req.destroy(Error("The server is not available. Offline data remains on the device.")), 20000);
    deadline.unref();
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(Error("The server is not available. I am working with an offline copy.")));
    // Wait for verified TLS before writing headers/body. flushHeaders is never used earlier.
    req.on('socket', socket => socket.once('secureConnect', () => {
      if (!req.destroyed) {
        if (payload) req.write(payload);
        req.end();
      }
    }));
  });
}
class ClientStore {
  constructor(root, safeStorage) {
    this.root = root;
    this.safe = safeStorage;
  }
  async key(create = true) {
    if (this.secret) return this.secret;
    if (!this.safe.isEncryptionAvailable()) throw Error("Windows Storage Protection is not available. Data was not written.");
    const file = path.join(this.root, 'client-key.bin');
    let key;
    try {
      key = this.safe.decryptString(await fs.readFile(file));
    } catch (e) {
      if (e.code !== 'ENOENT' || !create) throw Error("The offline storage key cannot be unlocked in this Windows account.");
      key = crypto.randomBytes(32).toString('base64');
      await atomic(file, this.safe.encryptString(key));
    }
    return this.secret = Buffer.from(key, 'base64');
  }
  async read(name) {
    try {
      const b = JSON.parse(await fs.readFile(path.join(this.root, name), 'utf8')),
        d = crypto.createDecipheriv('aes-256-gcm', await this.key(false), Buffer.from(b.iv, 'base64'));
      d.setAAD(Buffer.from(name));
      d.setAuthTag(Buffer.from(b.tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(b.data, 'base64')), d.final()]).toString('utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw Error("The encrypted offline copy is corrupted or cannot be unlocked. The original file is preserved.");
    }
  }
  async write(name, text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 320 * 1024 * 1024) throw Error("Offline copy is too large.");
    const iv = crypto.randomBytes(12),
      c = crypto.createCipheriv('aes-256-gcm', await this.key(), iv);
    c.setAAD(Buffer.from(name));
    const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    await atomic(path.join(this.root, name), JSON.stringify({
      iv: iv.toString('base64'),
      tag: c.getAuthTag().toString('base64'),
      data: data.toString('base64')
    }));
  }
  async backup(arg) {
    if (!/^(Fakturocel|Before-restore|Before-transfer|Pred-obnovou|Pred-prenosem)-[a-zA-Z0-9-]+\.fakturocel$/.test(arg?.name) || typeof arg.text !== 'string' || Buffer.byteLength(arg.text) > 320 * 1024 * 1024) throw Error("Invalid backup.");
    const preferences = JSON.parse((await this.read('client-v3.preferences')) || '{}'),
      folder = preferences.backupFolder || path.join(this.root, 'backups');
    await fs.mkdir(folder, {
      recursive: true
    });
    const file = path.join(folder, arg.name);
    let files = JSON.parse((await this.read('client-v3.backups')) || '[]');
    files.push(file);
    // Register before writing so an interrupted write remains covered by the wipe inventory.
    await this.write('client-v3.backups', JSON.stringify(files));
    await atomic(file, arg.text);
    if (arg.retention > 0) {
      const candidates = files.filter(f => path.dirname(f) === folder && path.basename(f).startsWith("Fakturocel-"));
      for (const old of candidates.slice(0, -Math.max(2, arg.retention))) {
        await this.removeBackup(old);
        files = files.filter(f => f !== old);
      }
      await this.write('client-v3.backups', JSON.stringify(files));
    }
    return {
      path: file
    };
  }
  async removeBackup(file) {
    if (!path.isAbsolute(file) || !/^(Fakturocel|Before-restore|Before-transfer|Pred-obnovou|Pred-prenosem)-[a-zA-Z0-9-]+\.fakturocel$/.test(path.basename(file))) throw Error("Invalid backup list.");
    for (const name of [file, file + '.tmp']) try {
      const st = await fs.lstat(name);
      if (st.isSymbolicLink() || !st.isFile() || path.resolve(await fs.realpath(name)).toLowerCase() !== path.resolve(name).toLowerCase()) throw Error("The backup contains an unauthorized link.");
      await fs.unlink(name);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  async call(name, arg) {
    if (name === 'load') return this.read('client-v3.cache');
    if (name === 'save') {
      const v = JSON.parse(arg);
      if (v.format !== 'FakturocelClient' || ![1, 2].includes(v.version)) throw Error("Invalid locale data.");
      await this.write('client-v3.cache', arg);
      return true;
    }
    if (name === 'pair') {
      const p = validatePair(JSON.parse(arg));
      await request(p, {
        route: 'meta'
      });
      await this.write('client-v3.connection', JSON.stringify(p));
      return true;
    }
    if (name === 'disconnect') {
      for (const n of ['client-v3.connection', 'client-v3.connection.tmp']) await fs.unlink(path.join(this.root, n)).catch(e => {
        if (e.code !== 'ENOENT') throw e;
      });
      return true;
    }
    if (name === 'request') {
      const p = await this.read('client-v3.connection');
      if (!p) throw Object.assign(Error("Home Assistant is not connected."), {
        status: 428
      });
      return request(validatePair(JSON.parse(p)), arg);
    }
    if (name === 'backup') return this.backup(arg);
    if (name === 'backupFolder') {
      if (typeof arg !== 'string' || !path.isAbsolute(arg)) throw Error("Select a valid folder.");
      await this.write('client-v3.preferences', JSON.stringify({
        backupFolder: arg
      }));
      return {
        path: arg
      };
    }
    if (name === 'clear') {
      const files = JSON.parse((await this.read('client-v3.backups')) || '[]');
      for (const file of files) await this.removeBackup(file);
      for (const n of ['client-v3.cache', 'client-v3.connection', 'client-v3.preferences', 'client-v3.backups', 'client-key.bin']) for (const suffix of ['', '.tmp']) await fs.unlink(path.join(this.root, n + suffix)).catch(e => {
        if (e.code !== 'ENOENT') throw e;
      });
      this.secret?.fill(0);
      this.secret = null;
      return true;
    }
    throw Error("Unknown operation.");
  }
}
module.exports = {
  ClientStore,
  validatePair,
  request
};
