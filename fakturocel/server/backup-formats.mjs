import JSZip from 'jszip';
import sax from 'sax';
import CFB from 'cfb';
import officeCrypto from 'officecrypto-tool';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { exportWorkbook } from '../src/excel.js';
import { fail } from './store.mjs';

const MAX = 300 * 1024 * 1024;
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
export const backupFormats = new Set(['zip', 'excel', 'both']);

export async function backupFiles(store, format, encrypt = store.backupEncryption().download) {
  if (!backupFormats.has(format)) throw fail(400, 'Choose ZIP, Excel, or both backup formats.');
  const text = await store.backupText({ encrypt }), state = store.read().state;
  const files = [];
  if (format !== 'excel') {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ format: 'FakturocelArchive', version: 1, encrypted: encrypt,
      createdAt: new Date().toISOString(), file: 'data.fakturocel', sha256: checksum(text) }, null, 2));
    zip.file('data.fakturocel', text);
    zip.file('README.txt', 'Fakturocel complete application data backup\n\nRestore this ZIP in Settings and data > Restore data from backup.\nThe data file includes invoices, archived PDFs, templates, attachments, and settings.\nEncrypted data requires the recovery key from your separately stored recovery PDF.\nGoogle credentials, access PINs, and device pairings are intentionally excluded.\n');
    files.push({ format: 'zip', extension: 'zip', mime: 'application/zip', bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) });
  }
  if (format !== 'zip') {
    const workbook = Buffer.from(await exportWorkbook(state, text));
    files.push({ format: 'excel', extension: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: encrypt ? officeCrypto.encrypt(workbook, { password: store.recoveryKey() }) : workbook });
  }
  if (files.some(f => f.bytes.length > MAX)) throw fail(413, 'The backup file exceeds the supported size of 300 MB.');
  return files;
}

export async function backupDownload(store, format) {
  if (format === 'fakturocel') return { bytes: Buffer.from(await store.backupText()), extension: 'fakturocel', mime: 'application/octet-stream' };
  const files = await backupFiles(store, format);
  if (files.length === 1) return files[0];
  const zip = new JSZip();
  const entries = files.map(f => ({ name: 'application.' + f.extension, sha256: checksum(f.bytes) }));
  zip.file('manifest.json', JSON.stringify({ format: 'FakturocelBackupSet', version: 1, files: entries }));
  files.forEach((f, i) => zip.file(entries[i].name, f.bytes));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (bytes.length > MAX) throw fail(413, 'The backup file exceeds the supported size of 300 MB.');
  return { bytes, extension: 'zip', mime: 'application/zip' };
}

async function zipEntry(zip, name, limit = MAX) {
  const entry = zip.file(name);
  if (!entry) throw fail(400, 'The backup is incomplete or its required data file is missing.');
  if (entry._data?.uncompressedSize > limit) throw fail(413, 'The expanded backup file is too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of Readable.wrap(entry.nodeStream('nodebuffer'))) {
    size += chunk.length;
    if (size > limit) throw fail(413, 'The expanded backup file is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const localName = name => name.split(':').at(-1);
function xmlParser(open, text = () => {}, close = () => {}) {
  const parser = sax.parser(true);
  parser.ondoctype = () => { throw fail(400, 'Document types and external entities are not allowed in a backup.'); };
  parser.onopentag = node => open(localName(node.name), node.attributes);
  parser.ontext = text;
  parser.oncdata = text;
  parser.onclosetag = name => close(localName(name));
  return parser;
}
async function parseXml(zip, name, parser, limit = MAX) {
  const entry = zip.file(name);
  if (!entry || entry._data?.uncompressedSize > limit) throw fail(400, 'The Excel backup is incomplete or too large.');
  const stream = Readable.wrap(entry.nodeStream('nodebuffer'));
  stream.setEncoding('utf8');
  let size = 0;
  for await (const chunk of stream) {
    size += Buffer.byteLength(chunk);
    if (size > limit) throw fail(413, 'The expanded backup file is too large.');
    parser.write(chunk);
  }
  parser.close();
}
const excelText = value => value.replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

async function workbookBackup(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  if (Object.keys(zip.files).length > 10000) throw fail(400, 'The Excel backup contains too many files.');
  let sheetId, target;
  await parseXml(zip, 'xl/workbook.xml', xmlParser((name, attrs) => {
    if (name === 'sheet' && attrs.name === 'Application backup') sheetId = attrs['r:id'];
  }), 1024 * 1024);
  if (!sheetId) throw fail(400, 'This Excel file has no complete Application backup sheet. Summary tables cannot restore archived PDFs and attachments.');
  await parseXml(zip, 'xl/_rels/workbook.xml.rels', xmlParser((name, attrs) => {
    if (name === 'Relationship' && attrs.Id === sheetId && attrs.TargetMode !== 'External') target = attrs.Target;
  }), 1024 * 1024);
  if (typeof target !== 'string' || !/^(?:\/xl\/|)?worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(target))
    throw fail(400, 'The Excel backup has an invalid worksheet reference.');
  target = target.startsWith('/xl/') ? target.slice(1) : 'xl/' + target;
  const shared = [];
  if (zip.file('xl/sharedStrings.xml')) {
    let current = '', inside = false;
    await parseXml(zip, 'xl/sharedStrings.xml', xmlParser(name => {
      if (name === 'si') current = '';
      if (name === 't') inside = true;
    }, value => { if (inside) current += value; }, name => {
      if (name === 't') inside = false;
      if (name === 'si') { if (shared.length >= 1000000) throw fail(413, 'The Excel backup contains too many text values.'); shared.push(excelText(current)); }
    }));
  }
  const parts = new Map();
  let cell, value = '', inValue = false, row = {}, rowNumber = 0;
  await parseXml(zip, target, xmlParser((name, attrs) => {
    if (name === 'row') { row = {}; rowNumber = Number(attrs.r); }
    if (name === 'c') { cell = { ref: attrs.r, type: attrs.t }; value = ''; }
    if (name === 't' || name === 'v') inValue = true;
  }, chunk => { if (inValue) value += chunk; }, name => {
    if (name === 't' || name === 'v') inValue = false;
    if (name === 'c') {
      const column = cell?.ref?.match(/^[A-Z]+/)?.[0];
      if (column === 'A' || column === 'B') row[column] = cell.type === 's' ? shared[Number(value)] : excelText(value);
      cell = null;
    }
    if (name === 'row' && rowNumber > 1) {
      const part = Number(row.A);
      if (!Number.isInteger(part) || part < 1 || part > 20000 || parts.has(part) || typeof row.B !== 'string')
        throw fail(400, 'The Excel backup has missing or duplicate data parts.');
      parts.set(part, row.B);
    }
  }));
  if (!parts.size) throw fail(400, 'The Excel backup does not contain application data.');
  const ordered = [];
  for (let i = 1; i <= parts.size; i++) {
    if (!parts.has(i)) throw fail(400, 'The Excel backup has missing or duplicate data parts.');
    ordered.push(parts.get(i));
  }
  const result = ordered.join('');
  if (Buffer.byteLength(result) > MAX) throw fail(413, 'The expanded backup file is too large.');
  return result;
}

function checkOfficeEncryption(bytes) {
  const cfb = CFB.read(bytes, { type: 'buffer' });
  const info = CFB.find(cfb, '/EncryptionInfo')?.content;
  const data = CFB.find(cfb, '/EncryptedPackage')?.content;
  if (!info || info.length < 8 || info.length > 65536 || info.readUInt16LE(0) !== 4 || info.readUInt16LE(2) !== 4 ||
      !data || data.length < 8 || data.readBigUInt64LE(0) > BigInt(MAX))
    throw fail(400, 'The encrypted Excel backup uses unsupported encryption or exceeds the size limit.');
  let valid = false;
  const parser = xmlParser((name, attrs) => {
    if (name === 'encryptedKey') {
      if (!Number.isInteger(Number(attrs.spinCount)) || Number(attrs.spinCount) < 1 || Number(attrs.spinCount) > 1000000 ||
          attrs.cipherAlgorithm !== 'AES' || !['128', '192', '256'].includes(attrs.keyBits) || !['SHA1', 'SHA256', 'SHA384', 'SHA512'].includes(attrs.hashAlgorithm))
        throw fail(400, 'The encrypted Excel backup uses unsupported encryption parameters.');
      valid = true;
    }
  });
  parser.write(info.subarray(8).toString('utf8')).close();
  if (!valid) throw fail(400, 'The encrypted Excel backup has no supported password key.');
}

export async function readBackupFile(store, bytes, name, password, depth = 0) {
  if (!bytes.length || bytes.length > MAX) throw fail(413, 'The backup file exceeds the supported size of 300 MB.');
  let text;
  if (/\.fakturocel$/i.test(name)) text = bytes.toString('utf8');
  else if (/\.zip$/i.test(name)) {
    const zip = await JSZip.loadAsync(bytes);
    if (Object.keys(zip.files).length > 10000) throw fail(400, 'The backup archive contains too many files.');
    const manifest = JSON.parse((await zipEntry(zip, 'manifest.json', 65536)).toString('utf8'));
    if (manifest.format === 'FakturocelBackupSet' && manifest.version === 1 && depth === 0) {
      if (!Array.isArray(manifest.files) || manifest.files.length !== 2 || manifest.files[0]?.name !== 'application.zip' || manifest.files[1]?.name !== 'application.xlsx')
        throw fail(400, 'The backup set has an invalid manifest.');
      let archive;
      for (const file of manifest.files) {
        const data = await zipEntry(zip, file.name);
        if (checksum(data) !== file.sha256) throw fail(400, 'The backup set has an invalid checksum.');
        if (file.name === 'application.zip') archive = data;
      }
      return readBackupFile(store, archive, 'application.zip', password, 1);
    }
    if (manifest.format !== 'FakturocelArchive' || manifest.version !== 1 || manifest.file !== 'data.fakturocel') throw fail(400, 'This ZIP is not a supported Fakturocel backup.');
    const data = await zipEntry(zip, 'data.fakturocel');
    if (checksum(data) !== manifest.sha256) throw fail(400, 'The ZIP backup has an invalid checksum.');
    text = data.toString('utf8');
  } else if (/\.xlsx$/i.test(name)) {
    let workbook = bytes;
    if (bytes.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1') {
      checkOfficeEncryption(bytes);
      try { workbook = await officeCrypto.decrypt(bytes, { password: password || (store.context ? store.recoveryKey() : '') }); }
      catch { throw fail(password ? 400 : 422, 'Enter the recovery key from the PDF that belongs to this Excel backup.'); }
    }
    text = await workbookBackup(workbook);
  } else throw fail(400, 'Select a Fakturocel .zip, .xlsx, or .fakturocel backup.');
  return store.decryptExport(text, password);
}
