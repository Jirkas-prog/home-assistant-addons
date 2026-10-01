import { randomBytes, createCipheriv, createDecipheriv, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt),
  FORMAT = 'FakturocelEncrypted',
  VERSION = 1;
const kdf = {
  name: 'scrypt',
  N: 131072,
  r: 8,
  p: 1
};
let derivationQueue = Promise.resolve();
const purposes = new Set(['storage', 'backup', 'template']);
const fail = message => Object.assign(Error(message), {
  status: 400
});
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 255 || !password.trim()) throw fail("Password must be between 12 and 255 characters long. We recommend a longer passphrase.");
}
function b64(value, bytes, max = 400 * 1024 * 1024) {
  if (typeof value !== 'string' || value.length > max || !value.length || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw fail("Invalid encrypted file.");
  const b = Buffer.from(value, 'base64');
  if (b.toString('base64') !== value || bytes && b.length !== bytes) throw fail("Invalid encrypted file.");
  return b;
}
const aad = purpose => Buffer.from(`${FORMAT}:${VERSION}:${purpose}`);
function seal(bytes, key, purpose) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: 16
    });
  cipher.setAAD(aad(purpose));
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  };
}
function open(value, key, purpose) {
  try {
    const iv = b64(value.iv, 12),
      tag = b64(value.tag, 16),
      data = b64(value.data),
      cipher = createDecipheriv('aes-256-gcm', key, iv, {
        authTagLength: 16
      });
    cipher.setAAD(aad(purpose));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]);
  } catch {
    throw fail("The password is incorrect or the encrypted file is corrupted.");
  }
}
function descriptor(w) {
  if (!w || w.kdf?.name !== kdf.name || w.kdf.N !== kdf.N || w.kdf.r !== kdf.r || w.kdf.p !== kdf.p) throw fail("Unsupported encryption parameters.");
  b64(w.salt, 16);
  b64(w.iv, 12);
  b64(w.tag, 16);
  b64(w.data, 32);
  return w;
}
async function passwordKey(password, salt) {
  if (typeof password !== 'string' || !password || password.length > 255) throw fail("Please enter a valid password.");
  const bytes = b64(salt, 16),
    job = derivationQueue.then(() => derive(password, bytes, 32, {
      N: kdf.N,
      r: kdf.r,
      p: kdf.p,
      maxmem: 160 * 1024 * 1024
    }));
  derivationQueue = job.then(() => {}, () => {});
  return job;
}
export async function createContext(password) {
  validatePassword(password);
  const key = randomBytes(32),
    salt = randomBytes(16).toString('base64'),
    derived = await passwordKey(password, salt);
  try {
    return {
      key,
      wrap: {
        kdf: {
          ...kdf
        },
        salt,
        ...seal(key, derived, 'key:' + salt)
      }
    };
  } finally {
    derived.fill(0);
  }
}
export function isEncrypted(text) {
  try {
    return (typeof text === 'string' ? JSON.parse(text) : text)?.format === FORMAT;
  } catch {
    return false;
  }
}
export function parseEnvelope(text, purpose) {
  if (typeof text !== 'string' || text.length > 400 * 1024 * 1024) throw fail("The encrypted file is too large.");
  let e;
  try {
    e = JSON.parse(text);
  } catch {
    throw fail("Invalid encrypted file.");
  }
  if (e.format !== FORMAT || e.version !== VERSION || e.algorithm !== 'AES-256-GCM' || !purposes.has(e.purpose) || purpose && e.purpose !== purpose) throw fail("Unsupported format or purpose of encrypted file.");
  descriptor(e.wrap);
  b64(e.iv, 12);
  b64(e.tag, 16);
  b64(e.data);
  return e;
}
export function encryptText(text, context, purpose) {
  if (!purposes.has(purpose) || !context?.key) throw Error("The encryption key is not available.");
  if (Buffer.byteLength(text, 'utf8') > 225 * 1024 * 1024) throw fail("The encrypted file exceeds the supported size. Reduce attachments or data volume.");
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    algorithm: 'AES-256-GCM',
    purpose,
    wrap: context.wrap,
    ...seal(Buffer.from(text), context.key, purpose)
  });
}
export function decryptWithContext(text, context, purpose) {
  const e = parseEnvelope(text, purpose);
  return open(e, context.key, e.purpose).toString('utf8');
}
export function recoveryKey(context) {
  return 'FC3-' + context.key.toString('hex').toUpperCase().match(/.{8}/g).join('-');
}
export async function unlockEnvelope(text, password, purpose) {
  const e = parseEnvelope(text, purpose),
    token = typeof password === 'string' ? password.replace(/\s/g, '') : '';
  if (/^FC3-(?:[A-Fa-f0-9]{8}-){7}[A-Fa-f0-9]{8}$/i.test(token)) {
    const key = Buffer.from(token.slice(4).replaceAll('-', ''), 'hex');
    try {
      return {
        content: open(e, key, e.purpose).toString('utf8'),
        context: {
          key,
          wrap: e.wrap
        }
      };
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }
  const derived = await passwordKey(password, e.wrap.salt);
  let key;
  try {
    key = open(e.wrap, derived, 'key:' + e.wrap.salt);
    if (key.length !== 32) throw fail("Invalid encryption key.");
    const content = open(e, key, e.purpose).toString('utf8');
    return {
      content,
      context: {
        key,
        wrap: e.wrap
      }
    };
  } catch (error) {
    key?.fill(0);
    throw error;
  } finally {
    derived.fill(0);
  }
}
export async function verifyPassword(context, password) {
  const derived = await passwordKey(password, context.wrap.salt);
  let key;
  try {
    key = open(context.wrap, derived, 'key:' + context.wrap.salt);
    if (key.length !== 32 || !timingSafeEqual(context.key, key)) throw fail("The password is incorrect.");
  } finally {
    derived.fill(0);
    key?.fill(0);
  }
}
