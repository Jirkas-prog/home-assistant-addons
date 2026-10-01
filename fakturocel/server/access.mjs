import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fail } from './store.mjs';
const derive = promisify(scrypt),
  ttl = 12 * 60 * 60 * 1000;
const validPin = pin => {
  if (typeof pin !== 'string' || !/^\d{6,12}$/.test(pin)) throw fail(400, "PIN must be 6 to 12 digits long.");
};
const pinHash = (pin, salt) => derive(pin, Buffer.from(salt, 'hex'), 32, {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 48 * 1024 * 1024
});

// Only opaque session tokens leave the server. PINs are never file-encryption keys.
export class Access {
  constructor(store) {
    this.store = store;
    this.sessions = new Map();
    this.attempts = new Map();
    this.queue = Promise.resolve();
  }
  enabled() {
    return !!this.store.meta('accessPin');
  }
  token(req) {
    return /(?:^|;\s*)fakturocel_access=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  }
  authenticated(req, id) {
    if (!this.enabled()) return true;
    const grant = this.sessions.get(this.token(req));
    return !!grant && grant.id === id && grant.until > Date.now();
  }
  require(req, id) {
    if (!this.authenticated(req, id)) throw fail(423, "Unlock the application with an access PIN.");
  }
  status(req, id) {
    return {
      ...this.store.status(),
      pinRequired: !this.authenticated(req, id)
    };
  }
  cookie(req, res, token) {
    const prefix = String(req.headers['x-ingress-path'] || '');
    const cookiePath = /^\/[A-Za-z0-9_/-]+$/.test(prefix) ? prefix.replace(/\/$/, '') + '/' : '/';
    const secure = req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    res.setHeader('Set-Cookie', `fakturocel_access=${token || ''}; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=${token ? ttl / 1000 : 0}${secure ? '; Secure' : ''}`);
  }
  grant(req, res, id) {
    for (const [token, s] of this.sessions) if (s.until <= Date.now()) this.sessions.delete(token);
    this.sessions.delete(this.token(req));
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, {
      id,
      until: Date.now() + ttl
    });
    this.cookie(req, res, token);
  }
  lock(req, res) {
    this.sessions.delete(this.token(req));
    this.cookie(req, res, null);
  }
  async limited(id, verify) {
    const task = this.queue.then(async () => {
      const now = Date.now(),
        a = this.attempts.get(id) || {
          count: 0,
          until: 0
        };
      if (a.until > now) throw fail(429, "Too many attempts. Wait a moment and try again.");
      try {
        const result = await verify();
        this.attempts.delete(id);
        return result;
      } catch (e) {
        a.count++;
        a.until = Date.now() + Math.min(900000, Math.max(0, a.count - 3) * 30000);
        this.attempts.set(id, a);
        throw e;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async verify(pin, id) {
    return this.limited(id, async () => {
      validPin(pin);
      const saved = this.store.meta('accessPin');
      if (!saved) throw fail(409, "PIN is off.");
      const bytes = await pinHash(pin, saved.salt);
      try {
        if (this.store.meta('accessPin')?.hash !== saved.hash) throw fail(409, "PIN has since changed. Try logging in again.");
        if (!timingSafeEqual(bytes, Buffer.from(saved.hash, 'hex'))) throw fail(400, "PIN is not correct.");
        return saved.hash;
      } finally {
        bytes.fill(0);
      }
    });
  }
  async login(input, req, res, id, name) {
    this.store.securityActor(id, name);
    const verified = await this.verify(input.pin, id);
    if (this.store.meta('accessPin')?.hash !== verified) throw fail(409, "PIN has since changed.");
    this.grant(req, res, id);
  }
  async change(input, actor, req, res) {
    return this.store.serial(async () => {
      this.store.role(actor, 'owner');
      if (typeof input.enabled !== 'boolean') throw fail(400, "Select PIN settings.");
      if (this.enabled()) await this.verify(input.currentPin, actor.id);
      let saved = null;
      if (input.enabled) {
        validPin(input.pin);
        const salt = randomBytes(16).toString('hex'),
          bytes = await pinHash(input.pin, salt);
        saved = {
          salt,
          hash: bytes.toString('hex')
        };
        bytes.fill(0);
      }
      this.store.setMeta('accessPin', saved);
      this.sessions.clear();
      if (saved) this.grant(req, res, actor.id);else this.cookie(req, res, null);
    });
  }
  async recover(input, req, res, id, name) {
    const actor = this.store.securityActor(id, name);
    this.store.role(actor, 'owner');
    await this.limited(id, async () => {
      const expected = Buffer.from(this.store.recoveryKey()),
        provided = Buffer.from(String(input.key || '').replace(/\s/g, '').toUpperCase());
      if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw fail(400, "The recovery key is not correct.");
    });
    await this.store.serial(() => this.store.setMeta('accessPin', null));
    this.sessions.clear();
    this.cookie(req, res, null);
  }
  clear() {
    this.sessions.clear();
    this.attempts.clear();
  }
}
