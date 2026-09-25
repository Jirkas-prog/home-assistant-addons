import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesBase64, base64Bytes } from './model.js';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
const random = n => crypto.getRandomValues(new Uint8Array(n)),
  encode = s => new TextEncoder().encode(s);
async function seal(bytes, key, purpose) {
  const iv = random(12),
    k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']),
    out = new Uint8Array(await crypto.subtle.encrypt({
      name: 'AES-GCM',
      iv,
      additionalData: encode('FakturocelEncrypted:1:' + purpose),
      tagLength: 128
    }, k, bytes));
  return {
    iv: bytesBase64(iv),
    data: bytesBase64(out.slice(0, -16)),
    tag: bytesBase64(out.slice(-16))
  };
}
export async function clientContext(password) {
  if (password !== undefined && (typeof password !== 'string' || password.length < 12 || password.length > 255)) throw Error("Password must be between 12 and 255 characters long.");
  const key = random(32),
    salt = random(16),
    derived = await scryptAsync(password ?? bytesBase64(random(32)), salt, {
      N: 131072,
      r: 8,
      p: 1,
      dkLen: 32,
      maxmem: 160 * 1024 * 1024
    });
  try {
    return {
      key: bytesBase64(key),
      wrap: {
        kdf: {
          name: 'scrypt',
          N: 131072,
          r: 8,
          p: 1
        },
        salt: bytesBase64(salt),
        ...(await seal(key, derived, 'key:' + bytesBase64(salt)))
      }
    };
  } finally {
    derived.fill(0);
  }
}
export const clientRecoveryKey = context => 'FC3-' + [...base64Bytes(context.key)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{8}/g).join('-');
export async function encryptClientBackup(text, context, purpose = 'backup') {
  return JSON.stringify({
    format: 'FakturocelEncrypted',
    version: 1,
    algorithm: 'AES-256-GCM',
    purpose,
    wrap: context.wrap,
    ...(await seal(encode(text), base64Bytes(context.key), purpose))
  });
}
async function open(value, key, purpose) {
  const iv = base64Bytes(value.iv || ''),
    tag = base64Bytes(value.tag || ''),
    data = base64Bytes(value.data || '');
  if (iv.length !== 12 || tag.length !== 16 || key.length !== 32) throw Error("Invalid encrypted file.");
  const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']),
    bytes = new Uint8Array(data.length + 16);
  bytes.set(data);
  bytes.set(tag, data.length);
  return new Uint8Array(await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv,
    additionalData: encode('FakturocelEncrypted:1:' + purpose),
    tagLength: 128
  }, k, bytes));
}
export async function decryptClientBackup(text, context, password, purpose = 'backup') {
  if (typeof text !== 'string' || text.length > 400 * 1024 * 1024) throw Error("The backup is too large.");
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    throw Error("The file does not contain valid data.");
  }
  if (v.format !== 'FakturocelEncrypted') return text;
  if (v.version !== 1 || v.algorithm !== 'AES-256-GCM' || v.purpose !== purpose) throw Error("Unsupported encrypted file.");
  if (context) try {
    return new TextDecoder('utf-8', {
      fatal: true
    }).decode(await open(v, base64Bytes(context.key), purpose));
  } catch {}
  if (!password) throw Object.assign(Error("Enter the key from PDF or the password of this backup."), {
    status: 422
  });
  try {
    let key;
    if (/^FC3-(?:[A-Fa-f0-9]{8}-){7}[A-Fa-f0-9]{8}$/.test(password)) {
      key = new Uint8Array(password.slice(4).replaceAll('-', '').match(/../g).map(x => parseInt(x, 16)));
    } else {
      const w = v.wrap,
        k = w?.kdf;
      if (k?.name !== 'scrypt' || k.N !== 131072 || k.r !== 8 || k.p !== 1 || base64Bytes(w.salt || '').length !== 16) throw Error();
      const derived = await scryptAsync(password, base64Bytes(w.salt), {
        N: 131072,
        r: 8,
        p: 1,
        dkLen: 32,
        maxmem: 160 * 1024 * 1024
      });
      try {
        key = await open(w, derived, 'key:' + w.salt);
      } finally {
        derived.fill(0);
      }
    }
    try {
      return new TextDecoder('utf-8', {
        fatal: true
      }).decode(await open(v, key, purpose));
    } finally {
      key.fill(0);
    }
  } catch {
    throw Object.assign(Error("The key or password does not match, or the file is damaged."), {
      status: 422
    });
  }
}
export async function clientKeyPdf(context, loadAsset) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await loadAsset('LiberationSans-Regular.ttf'), {
      subset: true
    }),
    bold = await pdf.embedFont(await loadAsset('LiberationSans-Bold.ttf'), {
      subset: true
    }),
    p = pdf.addPage([595.28, 841.89]);
  let y = 782;
  const line = (text, size = 12, strong = false) => {
    p.drawText(text, {
      x: 44,
      y,
      size,
      font: strong ? bold : font,
      color: rgb(.08, .22, .23)
    });
    y -= size + 12;
  };
  const para = text => {
    let row = '';
    for (const word of text.split(' ')) {
      const next = row ? row + ' ' + word : word;
      if (font.widthOfTextAtSize(next, 12) > 500) {
        line(row);
        row = word;
      } else row = next;
    }
    if (row) line(row);
    y -= 12;
  };
  line("FAKTUROCEL", 13, true);
  y -= 12;
  line("This device's backup key", 26, true);
  y -= 14;
  para("This key belongs to the backups created in the application on this device. Store it separately from your backup files. Whoever has the key and the backup can read its contents.");
  p.drawRectangle({
    x: 38,
    y: y - 8,
    width: 519,
    height: 39,
    color: rgb(.91, .96, .94)
  });
  line(clientRecoveryKey(context), 9);
  y -= 35;
  line("Data recovery", 17, true);
  para("1. Open Fakturocel on your phone, computer or Home Assistant (version 3.6 or later). In Settings and data, select Restore data from backup.");
  para("2. Select the .fakturocel file from this device. When prompted for a password, enter the entire key from this PDF including FC3- and hyphens.");
  para("3. Check the overview of recovered data and confirm recovery. The restore replaces the entire database. Also keep a current backup of the target device before it.");
  para("4. The application works without a server. You can optionally connect the Home Assistant in the settings. When transferring data, first check the overview and possible conflicts.");
  line("What the backup contains", 17, true);
  para("Documents, drafts, companies, templates, media and other work data including locally saved edits. Issued invoices include archived PDF and can be reprinted at any time.");
  para("The device pairing key and login are not transferred in this backup. With this key, you can also open Excel created by this application. Each device and HA add-on uses its own key.");
  return pdf.save();
}
