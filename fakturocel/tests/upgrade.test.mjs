import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { Store, hash, finishPendingWipe } from '../server/store.mjs';
import { emptyState, newDocument, packBackup, unpackBackup, total } from '../src/model.js';
import { renderDocument } from '../src/renderer.js';
import { exportWorkbook } from '../src/excel.js';
import { yearlyRows, reportPdf, worklogText } from '../src/reports.js';
const webRoot = fileURLToPath(new URL('../public', import.meta.url)),
  actor = {
    id: 'owner',
    role: 'owner',
    name: 'Test Owner'
  };
test('uploaded image crop and custom font roundtrip; field styling follows changed data', async () => {
  const {
    store
  } = await fixture();
  try {
    const image = await store.upload(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=', 'base64'), 'image/png', 'Test.png', actor),
      font = await store.upload(await fs.readFile(path.join(webRoot, 'NotoSans-Regular.ttf')), 'font/ttf', 'Test font.ttf', actor),
      s = emptyState();
    s.media = [{
      id: 'test-image',
      ...image
    }, {
      id: 'test-font',
      ...font
    }];
    const t = s.templates[0];
    t.nodes = [{
      id: 'name',
      kind: 'text',
      name: 'Customer',
      x: 14,
      y: 20,
      w: 120,
      h: 20,
      size: 12,
      runs: [{
        field: 'customer.name',
        bold: true,
        color: '#168047'
      }]
    }, {
      id: 'customfont',
      kind: 'text',
      name: 'Font',
      font: 'test-font',
      x: 14,
      y: 60,
      w: 150,
      h: 20,
      size: 12,
      runs: [{
        text: "Too yellow a horse"
      }]
    }, {
      id: 'image',
      kind: 'image',
      name: 'Logo',
      x: 14,
      y: 100,
      w: 50,
      h: 25,
      mediaId: 'test-image',
      fit: 'cover'
    }];
    const d = newDocument(s);
    d.customer = {
      name: 'First customer'
    };
    const load = n => /^[a-f\d]{64}$/.test(n) ? store.blob(n).data : fs.readFile(path.join(webRoot, n));
    const before = await renderDocument(d, s, t, load);
    d.customer.name = 'Second customer';
    const after = await renderDocument(d, s, t, load);
    assert(after.pages.flat().some(o => o.kind === 'text' && o.text === 'Second' && o.font === 'bold' && o.color === '#168047'));
    assert(before.pages.flat().find(o => o.kind === 'image').clip);
    assert(after.pages.flat().some(o => o.font === 'test-font'));
    const p = await unpackBackup(await packBackup(s, store.allBlobs()));
    assert.equal(p.data.media.length, 2);
    assert.equal(Object.keys(p.blobs).length, 2);
  } finally {
    store.close();
  }
});
test('classic template, long reports and currency-separated annual totals', async () => {
  const s = emptyState(),
    d = newDocument(s);
  Object.assign(d, {
    status: 'issued',
    customer: {
      name: 'Customer',
      ico: '12345678',
      dic: 'CZ12345678'
    },
    supplier: {
      ...s.supplier,
      name: 'Supplier'
    },
    items: [{
      name: 'Work',
      qty: 1,
      price: 100,
      unit: 'pcs'
    }]
  });
  const load = n => fs.readFile(path.join(webRoot, n));
  assert((await renderDocument(d, s, s.templates[1], load)).bytes.length);
  s.documents = [d, {
    ...d,
    id: 'eur',
    currency: 'EUR'
  }];
  s.payments = [{
    id: 'p',
    documentId: d.id,
    date: '2027-01-02',
    amount: 25
  }];
  const summary = yearlyRows(s);
  assert.equal(summary.find(r => r.currency === 'EUR').invoiced, 100);
  assert.equal(summary.find(r => r.year === '2027').received, 25);
  const bytes = await reportPdf('Work report', 'Long text '.repeat(2500), s, load);
  assert((await PDFDocument.load(bytes)).getPageCount() > 1);
});
async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "fakturocel-v3-upgrade-")),
    options = {
      root: path.join(base, 'data'),
      shareRoot: path.join(base, 'share'),
      backupFolder: path.join(base, 'share', 'backup'),
      webRoot
    };
  const store = new Store(options);
  await store.init();
  return {
    base,
    options,
    store
  };
}
async function legacy() {
  const p = await PDFDocument.create();
  p.addPage();
  const bytes = await p.save(),
    h = hash(bytes),
    s = emptyState();
  s.schema = 2;
  s.supplier.name = 'Synthetic legacy supplier';
  s.companies = [{
    id: 'c',
    name: 'Synthetic legacy customer'
  }];
  const d = newDocument(s);
  Object.assign(d, {
    id: 'd',
    customer: s.companies[0],
    status: 'paid',
    date: '2025-12-31',
    due: '2026-01-30',
    paidDate: '2026-01-05',
    items: [{
      name: 'Work',
      qty: 2,
      price: 500,
      unit: 'hours'
    }],
    pdfHash: h,
    sourceIssues: ['Verify historical date']
  });
  s.documents = [d];
  s.attachments = {
    [h]: {
      base64: Buffer.from(bytes).toString('base64'),
      sha256: h,
      name: 'Original.pdf'
    }
  };
  s.gdpr = 'Own editable text';
  const payload = JSON.stringify({
    data: s,
    templateBase64: Buffer.from('Synthetic template').toString('base64')
  });
  return {
    text: JSON.stringify({
      format: 'FakturocelBackup',
      version: 2,
      payload,
      sha256: hash(payload)
    }),
    h,
    bytes
  };
}
test('existing version 2 migrates once, preserves PDF and unknown data, fresh remains empty', async () => {
  const f = await fixture();
  f.store.close();
  await fs.unlink(path.join(f.options.root, "fakturocel-v3.sqlite"));
  const old = await legacy();
  await fs.writeFile(path.join(f.options.root, "data.fakturocel"), old.text);
  let store = new Store(f.options);
  try {
    await store.init();
    assert.equal(store.read().state.documents.length, 1);
    assert.equal(store.read().state.payments[0].date, '2026-01-05');
    assert.equal(total(store.read().state.documents[0]), 1000);
    assert.equal(store.read().state.checks.length, 1);
    assert.equal(hash(store.blob(old.h).data), old.h);
    assert(store.read().state.texts.some(t => t.name === 'Own editable text'));
    const backup = await store.backupText();
    assert.equal((await unpackBackup(backup)).data.documents[0].pdfHash, old.h);
    store.close();
    store = new Store(f.options);
    await store.init();
    assert.equal(store.read().state.documents.length, 1);
    assert.equal(store.read().state.payments.length, 1);
  } finally {
    store.close();
  }
});
test('writes queued before wipe cannot restore stale data; restart is empty', async () => {
  const {
    store,
    options
  } = await fixture();
  await store.commit({
    ops: [{
      collection: 'companies',
      id: 'c',
      rev: 0,
      value: {
        id: 'c',
        name: 'PRIVATE_MARKER'
      }
    }]
  }, actor);
  const prepared = await store.wipePrepare(store.revision, actor),
    t = store.ticket(prepared.ticket, actor);
  t.downloaded = true;
  const wipe = store.wipeFinish({
    ticket: prepared.ticket,
    backupText: t.text,
    confirm: "DELETE DATA"
  }, actor);
  const queued = store.commit({
    ops: [{
      collection: 'companies',
      id: 'old-tab',
      rev: 0,
      value: {
        id: 'old-tab',
        name: 'PRIVATE_MARKER'
      }
    }]
  }, actor);
  const results = await Promise.allSettled([wipe, queued]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.status, 409);
  store.close();
  const restarted = new Store(options);
  try {
    await restarted.init();
    assert.equal(restarted.read().state.companies.length, 0);
  } finally {
    restarted.close();
  }
});
test('interrupted approved wipe completes at startup and preserves unrelated files', async () => {
  const {
    store,
    options
  } = await fixture();
  await store.commit({
    ops: [{
      collection: 'companies',
      id: 'c',
      rev: 0,
      value: {
        id: 'c',
        name: 'PRIVATE_MARKER'
      }
    }]
  }, actor);
  const files = await store.wipeFiles();
  await fs.writeFile(path.join(options.root, 'unrelated.txt'), 'safe');
  await fs.writeFile(path.join(options.root, 'wipe-pending.json'), JSON.stringify({
    files
  }));
  store.close();
  await finishPendingWipe(options);
  const clean = new Store(options);
  try {
    await clean.init();
    assert.equal(clean.read().state.companies.length, 0);
    assert.equal(await fs.readFile(path.join(options.root, 'unrelated.txt'), 'utf8'), 'safe');
    assert(!(await fs.readFile(path.join(options.root, "fakturocel-v3.sqlite"))).includes(Buffer.from('PRIVATE_MARKER')));
  } finally {
    clean.close();
  }
});
test('failed backup is reported, saved record remains, failed restore changes nothing', async () => {
  const {
    store,
    options
  } = await fixture();
  try {
    await fs.mkdir(options.shareRoot, {
      recursive: true
    });
    const obstacle = path.join(options.shareRoot, 'file');
    await fs.writeFile(obstacle, 'safe');
    store.setMeta('backupFolder', obstacle);
    const saved = await store.commit({
      ops: [{
        collection: 'companies',
        id: 'c',
        rev: 0,
        value: {
          id: 'c',
          name: 'Keep me'
        }
      }]
    }, actor);
    assert(saved.saved);
    assert.equal(saved.backup, false);
    assert.equal(store.read().state.companies.length, 1);
    await assert.rejects(store.restore(await packBackup(emptyState(), {}), store.revision, actor), /failed/i);
    assert.equal(store.read().state.companies.length, 1);
  } finally {
    store.close();
  }
});
test('duplicate operations, invalid PDFs and missing archive variants are rejected', async () => {
  const {
    store
  } = await fixture();
  try {
    const op = {
      collection: 'companies',
      id: 'c',
      rev: 0,
      value: {
        id: 'c',
        name: 'Customer'
      }
    };
    await assert.rejects(store.commit({
      ops: [op, op]
    }, actor), /only once/);
    await assert.rejects(store.upload(Buffer.from('%PDF-not-really'), 'application/pdf', 'Fake.pdf', actor));
    const s = emptyState(),
      d = newDocument(s);
    d.archiveVariants = [{
      hash: '0'.repeat(64)
    }];
    s.documents.push(d);
    await assert.rejects(unpackBackup(await packBackup(s, {})), /original PDF/);
  } finally {
    store.close();
  }
});
test('overflow and overlapping content cannot silently issue; layout preview explains overlap', async () => {
  const s = emptyState(),
    d = newDocument(s);
  d.items = [{
    name: 'Work',
    qty: 1,
    price: 100,
      unit: 'pcs'
  }];
  d.customer = {
    name: 'Customer'
  };
  const t = s.templates[0];
  t.nodes.push({
    ...structuredClone(t.nodes[0]),
    id: 'collision',
    name: 'Collision'
  });
  const loader = n => fs.readFile(path.join(webRoot, n));
  await assert.rejects(renderDocument(d, s, t, loader), /overlap/);
  assert((await renderDocument(d, s, t, loader, {
    preview: true
  })).errors.length);
  t.nodes.at(-1).allowOverlap = true;
  assert((await renderDocument(d, s, t, loader)).bytes.length);
});
test('Excel includes 150 activities, 100 items, formulas, long content and exact complete backup', async () => {
  const s = emptyState(),
    d = newDocument(s);
  d.items = Array.from({
    length: 100
  }, (_, i) => ({
    name: 'Work ' + i,
    qty: 2,
    price: 125.5,
      unit: 'pcs'
  }));
  s.documents.push(d);
  s.activities = Array.from({
    length: 150
  }, (_, i) => ({
    id: 'a' + i,
    name: 'Activity ' + i,
    price: 125.5,
      unit: 'pcs'
  }));
  s.texts = [{
    id: 'long',
    name: 'Text 🌍 _x0041_ ' + 'a'.repeat(40000)
  }];
  const backup = await packBackup(s, {}),
    bytes = await exportWorkbook(s, backup),
    zip = await JSZip.loadAsync(bytes),
    book = await zip.file('xl/workbook.xml').async('string');
  assert(book.includes("Application backup"));
  const items = await zip.file('xl/worksheets/sheet2.xml').async('string');
  assert.equal((items.match(/<row /g) || []).length, 101);
  assert(items.includes('ROUND(C101*E101,2)'));
  const names = Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const last = await zip.file(names.at(-1)).async('string');
  const decode = x => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/_x005F_/g, '_');
  const chunks = [...last.matchAll(/<c r="B\d+" t="inlineStr"><is><t xml:space="preserve">([\s\S]*?)<\/t>/g)].slice(1).map(m => decode(m[1]));
  assert.equal(chunks.join(''), backup);
  assert.equal((await unpackBackup(chunks.join(''))).data.activities.length, 150);
});
test('optional local legacy backup is read-only and roundtrips all records and PDFs', {
  skip: !process.env.FAKTUROCEL_TEST_BACKUP
}, async () => {
  const file = process.env.FAKTUROCEL_TEST_BACKUP,
    original = await fs.readFile(file),
    old = JSON.parse(JSON.parse(original).payload),
    migrated = await unpackBackup(original.toString()),
    roundtrip = await unpackBackup(await packBackup(migrated.data, migrated.blobs));
  for (const k of ['companies', 'activities', 'documents', 'worklogs']) assert.equal(roundtrip.data[k].length, old.data[k].length);
  assert.equal(roundtrip.data.documents.reduce((n, d) => n + total(d), 0), old.data.documents.reduce((n, d) => n + total(d), 0));
  for (const d of old.data.documents) if (d.pdfHash) assert.equal(hash(Buffer.from(roundtrip.blobs[d.pdfHash].base64, 'base64')), d.pdfHash);
  assert.equal(hash(await fs.readFile(file)), hash(original));
  console.log('Read-only legacy verification:', old.data.documents.length, 'documents;', Object.keys(old.data.attachments || {}).length, 'PDFs preserved.');
});
