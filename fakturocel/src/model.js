import { defaultCalculators, validateCalculators } from './calculators-model.js';
import JSZip from 'jszip';
import { defaultAppearance, validateAppearance } from './appearance-model.js';
import { hashBytes, randomId } from './crypto.js';
export const uid = randomId,
  clone = x => structuredClone(x),
  now = () => new Date().toISOString();
export const today = () => new Date().toLocaleDateString('sv-SE');
export const norm = x => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const displayLocale = () => typeof document !== 'undefined' && document.documentElement?.lang === 'cs' ? 'cs-CZ' : 'en-GB';
export const money = (n, currency = 'CZK') => new Intl.NumberFormat(displayLocale(), {
  style: 'currency',
  currency
}).format(+n || 0);
export const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const total = d => d.summaryOnly ? +d.importedTotal : round((d.items || []).reduce((s, i) => s + round(+i.qty * +i.price), 0) * (1 - (+d.discount || 0) / 100));
export const paid = (d, s) => (s.payments || []).filter(p => p.documentId === d.id && !p.voided).reduce((v, p) => round(v + +p.amount), 0);
export const balance = (d, s) => round(total(d) - paid(d, s));
export const dateLabel = d => d ? String(d).split('-').reverse().join('. ') : '';
export const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d + 'T12:00Z')) && new Date(d + 'T12:00Z').toISOString().slice(0, 10) === d;
export const addDays = (d, n) => {
  const x = new Date(d + 'T12:00Z');
  x.setUTCDate(x.getUTCDate() + +n);
  return x.toISOString().slice(0, 10);
};
export const collections = ['companies', 'activities', 'texts', 'worklogs', 'documents', 'templates', 'fields', 'rules', 'media', 'checks', 'payments', 'views'];
export const statusNames = {
  draft: "In progress",
  issued: 'Issued',
  cancelled: "Cancelled"
};
export const fieldLabels = {
  'doc.number': "Document number",
  'doc.title': "Type of document",
  'doc.date': "Issue date",
  'doc.due': 'Due date',
  'doc.payment': "Method of payment",
  'doc.vs': "Variable symbol",
  'doc.intro': "Introductory text",
  'doc.notes': "Note",
  'doc.currency': "Currency",
  'doc.discount': 'Discount (%)',
  'supplier.name': "Supplier · name",
  'supplier.street': "Supplier · street",
  'supplier.city': "Supplier · city",
  'supplier.zip': "Supplier · postal code",
  'supplier.ico': "Supplier · ID number",
  'supplier.dic': "Supplier · tax ID",
  'supplier.account': "Bank account",
  'supplier.bank': "Bank code",
  'supplier.iban': 'IBAN',
  'supplier.swift': 'SWIFT',
  'supplier.footer': "Footer",
  'supplier.phone': 'Phone',
  'supplier.email': 'E-mail',
  'supplier.web': 'Web',
  'customer.name': "Customer · name",
  'customer.street': "Customer · street",
  'customer.city': "Customer · city",
  'customer.zip': "Customer · postal code",
  'customer.ico': "Customer · ID number",
  'customer.dic': "Customer · tax ID",
  'customer.contact': "Contact person",
  'totals.total': "Total payable",
  'totals.paid': 'Paid',
  'totals.balance': "Outstanding",
  'page.number': "Page number",
  'page.count': "Number of pages"
};
export function fieldsFor(s) {
  return {
    ...fieldLabels,
    ...Object.fromEntries(s.fields.filter(f => !f.archived).map(f => ['custom.' + f.id, f.name]))
  };
}
const text = (id, x, y, w, h, runs, size = 10, extra = {}) => ({
  id,
  kind: 'text',
  name: id,
  x,
  y,
  w,
  h,
  size,
  color: '#172f35',
  font: 'regular',
  align: 'left',
  overflow: 'grow',
  repeat: 'first',
  runs: typeof runs === 'string' ? [{
    text: runs
  }] : runs,
  ...extra
});
const token = (field, extra = {}) => ({
  field,
  ...extra
});
export function defaultTemplate(classic = false) {
  if (classic) return classicTemplate();
  return {
    id: classic ? 'builtin-classic' : 'builtin-clean',
    family: classic ? 'classic' : 'clean',
    name: classic ? "Classic invoice" : "Clean invoice",
    version: 1,
    status: 'active',
    page: {
      width: 210,
      height: 297,
      top: 20,
      bottom: 23
    },
    nodes: [text('Title', 14, 22, 112, 12, [token('doc.title')], 20, {
      color: classic ? '#999999' : '#147b6d'
    }), text("Number", 135, 22, 61, 12, [token('doc.number')], 18, {
      font: 'bold',
      align: 'right'
    }), text("Supplier", 14, 42, 86, 8, "SUPPLIER", 11, {
      color: '#789090'
    }), text("Customer", 126, 42, 70, 8, "CUSTOMER", 11, {
      color: '#789090'
    }), text('Supplier address', 14, 51, 88, 44, [token('supplier.name', {
      bold: true
    }), {
      text: '\n'
    }, token('supplier.street'), {
      text: '\n'
    }, token('supplier.zip'), {
      text: ' '
    }, token('supplier.city'), {
      text: "\nID number: "
    }, token('supplier.ico'), {
      text: "\nTax ID: "
    }, token('supplier.dic')]), text("Customer address", 126, 51, 70, 44, [token('customer.name', {
      bold: true
    }), {
      text: '\n'
    }, token('customer.street'), {
      text: '\n'
    }, token('customer.zip'), {
      text: ' '
    }, token('customer.city'), {
      text: "\nID number: "
    }, token('customer.ico'), {
      text: "\nTax ID: "
    }, token('customer.dic')]), text("Payment details", 14, 96, 100, 27, [{
      text: "Account: "
    }, token('supplier.account'), {
      text: '/'
    }, token('supplier.bank'), {
      text: '\nIBAN: '
    }, token('supplier.iban'), {
      text: "\nVariable symbol: "
    }, token('doc.vs'), {
      text: "\nPayment: "
    }, token('doc.payment')]), text('Data', 126, 96, 70, 24, [{
      text: 'Issued: '
    }, token('doc.date'), {
      text: "\nDue date: "
    }, token('doc.due')]), {
      id: 'Divider',
      name: 'Divider',
      kind: 'line',
      x: 14,
      y: 128,
      w: 182,
      h: 0.3,
      color: '#93aaa7',
      repeat: 'first'
    }, text("Introduction", 14, 135, 182, 10, [token('doc.intro')]), {
      id: "Items",
      name: "Items",
      kind: 'table',
      x: 14,
      y: 151,
      w: 182,
      h: 30,
      size: 9,
      color: '#172f35',
      headerColor: '#e8f3ef',
      repeat: 'first',
      columns: [{
        key: 'name',
        label: "Item",
        width: 50
      }, {
        key: 'qty',
        label: "Quantity",
        width: 12
      }, {
        key: 'unit',
        label: 'Unit',
        width: 8
      }, {
        key: 'price',
        label: "Unit price",
        width: 15
      }, {
        key: 'total',
        label: "Total",
        width: 15
      }]
    }, text("Total", 90, 8, 106, 13, [{
      text: "Total payable  "
    }, token('totals.total', {
      bold: true
    })], 14, {
      anchor: 'after',
      after: "Items",
      align: 'right',
      keepTogether: true
    }), text("Note", 14, 9, 182, 10, [token('doc.notes')], 10, {
      anchor: 'after',
      after: "Total"
    }), text("Footer", 14, 279, 170, 8, [token('supplier.footer')], 8, {
      repeat: 'all',
      overflow: 'error',
      color: '#778787'
    }), text("Page", 185, 284, 11, 5, [token('page.number'), {
      text: '/'
    }, token('page.count')], 8, {
      repeat: 'all',
      align: 'right'
    })]
  };
}
export function classicTemplate() {
  const t = defaultTemplate();
  Object.assign(t, {
    id: 'builtin-classic',
    family: 'classic',
    name: "Classic invoice",
    page: {
      width: 210,
      height: 297,
      top: 24,
      bottom: 26
    }
  });
  t.nodes = [];
  const add = (id, x, y, w, h, runs, size = 10, extra = {}) => t.nodes.push(text(id, x, y, w, h, runs, size, {
    color: '#000000',
    ...extra
  }));
  add('Title', 14.2, 19.8, 68, 12, [token('doc.title')], 18, {
    color: '#a6a6a6'
  });
  add("Number", 82.2, 19.8, 110, 12, [token('doc.number')], 18, {
    font: 'bold',
    color: '#808080'
  });
  add("Supplier", 14, 33.9, 90, 9, "SUPPLIER", 14, {
    color: '#808080'
  });
  add("Customer", 128.7, 33.9, 65, 9, "CUSTOMER", 14, {
    color: '#808080'
  });
  add('Supplier address', 13.8, 41.6, 95, 25, [token('supplier.name', {
    bold: true
  }), {
    text: '\n'
  }, token('supplier.street'), {
    text: '\n'
  }, token('supplier.city'), {
    text: '\n'
  }, token('supplier.zip')], 10, {
    overflow: 'error'
  });
  add("Customer address", 128.5, 41.6, 65, 28, [token('customer.name', {
    bold: true
  }), {
    text: '\n\n'
  }, token('customer.street'), {
    text: '\n'
  }, token('customer.city'), {
    text: '\n'
  }, token('customer.zip')], 10, {
    overflow: 'error'
  });
  const pair = (id, label, key, y) => {
    add(id + ' popisek', 13.8, y, 35, 6, label, 9.96, {
      color: '#808080',
      overflow: 'error'
    });
    add(id, 50.6, y, 63, 6, Array.isArray(key) ? key : [token(key)], 9.96, {
      overflow: 'error'
    });
  };
  pair("Supplier ID number", "ID number", 'supplier.ico', 66.5);
  pair("Supplier tax ID", "TAX ID", 'supplier.dic', 71.4);
  pair("Account", "BANK ACCOUNT", [token('supplier.account'), {
    text: '/'
  }, token('supplier.bank')], 76.9);
  pair('IBAN', 'IBAN', 'supplier.iban', 82.5);
  pair('SWIFT', 'SWIFT', 'supplier.swift', 88.1);
  pair('Symbol', "VARIABLE SYMBOL", 'doc.vs', 93.8);
  pair("Payment", "PAYMENT METHOD", 'doc.payment', 99.4);
  add("Customer ID number", 128.5, 71.4, 65, 6, [{
    text: "ID number    "
  }, token('customer.ico')], 9.96);
  add("DI Customer number", 128.5, 76.9, 65, 6, [{
    text: "Tax ID    "
  }, token('customer.dic')], 9.96);
  add('Issued', 128.5, 88.1, 65, 6, [{
    text: "ISSUE DATE   "
  }, token('doc.date')], 9);
  add("Due date", 128.5, 93.8, 65, 7, [{
    text: 'DUE DATE  '
  }, token('doc.due')], 9);
  t.nodes.push({
    id: 'Divider',
    name: 'Divider',
    kind: 'line',
    x: 13.4,
    y: 111.1,
    w: 180.6,
    h: .21,
    color: '#808080'
  });
  add("Introduction", 13.8, 116.9, 179, 10, [token('doc.intro')], 9.96);
  add("Note", 13.8, 3, 179, 10, [token('doc.notes')], 9.96, {
    anchor: 'after',
    after: "Introduction"
  });
  const table = structuredClone(defaultTemplate().nodes.find(n => n.kind === 'table'));
  Object.assign(table, {
    x: 13.8,
    y: 9,
    w: 179,
    size: 9.96,
    headerColor: '#ffffff',
    anchor: 'after',
    after: "Note"
  });
  t.nodes.push(table);
  add("Total", 101.8, 12, 91.8, 16, [{
    text: "Total payable  "
  }, token('totals.total', {
    bold: true
  })], 14, {
    anchor: 'after',
    after: "Items",
    align: 'right',
    keepTogether: true
  });
  add("Footer", 13.3, 279, 180, 11, [token('supplier.footer')], 9.96, {
    repeat: 'all',
    overflow: 'error'
  });
  add("Page", 185, 290, 10, 4, [token('page.number'), {
    text: '/'
  }, token('page.count')], 8, {
    repeat: 'all',
    align: 'right'
  });
  return t;
}
export function emptyState() {
  return {
    schema: 3,
    supplier: {
      name: '',
      street: '',
      city: '',
      zip: '',
      ico: '',
      dic: '',
      account: '',
      bank: '',
      iban: '',
      swift: '',
      phone: '',
      email: '',
      web: '',
      footer: '',
      custom: {}
    },
    settings: {
      language: 'en',
      calculators: defaultCalculators(),
      appearance: defaultAppearance(),
      currency: 'CZK',
      dueDays: 30,
      payment: "Bank transfer",
      paymentMethods: ["Bank transfer", "Cash"],
      units: ['pcs', 'hours', 'm', 'kg'],
      rates: [{
        name: "Hourly rate",
        value: 0
      }],
      year: new Date().getFullYear(),
      invoicePrefix: '{YYYY}',
      quotePrefix: 'N{YYYY}',
      digits: 4,
      filename: '{number}_{company}_{date}',
      templateId: 'builtin-clean',
      intro: "We invoice you for the following items",
      notes: '',
      retention: 0
    },
    ...Object.fromEntries(collections.map(k => [k, []])),
    templates: [defaultTemplate(), defaultTemplate(true)],
    usedNumbers: [],
    audit: [],
    migrations: []
  };
}
export function numberFor(s, type = 'invoice') {
  const p = (type === 'quote' ? s.settings.quotePrefix : s.settings.invoicePrefix).replaceAll('{YYYY}', String(new Date().getFullYear()));
  const used = [...s.usedNumbers, ...s.documents.map(d => d.type + ':' + d.number)].filter(x => x.startsWith(type + ':' + p)).map(x => x.slice(type.length + 1 + p.length)).filter(x => /^\d+$/.test(x)).map(Number);
  return p + String(Math.max(0, ...used) + 1).padStart(s.settings.digits || 4, '0');
}
export function newDocument(s, type = 'invoice') {
  return {
    id: uid(),
    type,
    status: 'draft',
    number: numberFor(s, type),
    date: today(),
    due: addDays(today(), s.settings.dueDays),
    payment: s.settings.payment,
    currency: s.settings.currency,
    customer: {},
    supplier: clone(s.supplier),
    items: [],
    discount: 0,
    intro: s.settings.intro,
    notes: s.settings.notes,
    templateId: s.settings.templateId,
    custom: {},
    ruleTrace: [],
    manualTexts: {}
  };
}
export function condition(c, d, s) {
  if (!c?.field) return true;
  const value = rawField(c.field, d, s);
  switch (c.op) {
    case 'empty':
      return value === undefined || value === null || value === '';
    case 'notempty':
      return value !== undefined && value !== null && value !== '';
    case 'gt':
      return +value > +c.value;
    case 'contains':
      return norm(value).includes(norm(c.value));
    case 'neq':
      return String(value ?? '') !== String(c.value ?? '');
    default:
      return String(value ?? '') === String(c.value ?? '');
  }
}
export function rawField(key, d, s, page = 1, count = 1) {
  if (key.startsWith('custom.')) {
    const id = key.slice(7),
      f = s.fields.find(f => f.id === id);
    return f?.scope === 'company' ? d.customer?.custom?.[id] : f?.scope === 'supplier' ? d.supplier?.custom?.[id] : d.custom?.[id];
  }
  const [group, k] = key.split('.');
  return {
    doc: {
      ...d,
      vs: d.vs || d.number.replace(/\D/g, ''),
      title: d.type === 'quote' ? "QUOTE" : "INVOICE",
      ...d.custom
    },
    supplier: d.supplier,
    customer: d.customer,
    totals: {
      total: total(d),
      paid: paid(d, s),
      balance: balance(d, s)
    },
    page: {
      number: page,
      count
    }
  }[group]?.[k];
}
export function fieldValue(run, d, s, page = 1, count = 1) {
  let v = rawField(run.field, d, s, page, count);
  if (v === null || v === undefined || v === '') return run.fallback || '';
  const format = run.format || (/^totals\./.test(run.field) ? 'money' : ['doc.date', 'doc.due'].includes(run.field) ? 'date' : 'text');
  if (format === 'date') return dateLabel(String(v));
  if (format === 'money') return money(v, d.currency);
  if (format === 'number') return new Intl.NumberFormat(displayLocale(), {
    minimumFractionDigits: run.decimals ?? 0,
    maximumFractionDigits: run.decimals ?? 2
  }).format(+v);
  if (typeof v === 'boolean' || s.fields.find(f => 'custom.' + f.id === run.field)?.type === 'boolean') return v === true || v === 'true' ? "Yes" : "No";
  return String(v);
}
export function textRules(d, s) {
  const result = clone(d);
  result.ruleTrace = [];
  for (const r of [...s.rules].filter(r => r.enabled && r.kind !== 'check').sort((a, b) => (a.priority || 0) - (b.priority || 0))) {
    if (condition(r.condition, result, s) && !d.manualTexts?.[r.target]) {
      const value = (r.runs || [{
        text: r.text || ''
      }]).map(x => x.field ? fieldValue(x, result, s) : x.text || '').join('');
      result[r.target || 'notes'] = r.append ? [result[r.target || 'notes'], value].filter(Boolean).join('\n') : value;
      result.ruleTrace.push({
        id: r.id,
        name: r.name,
        target: r.target || 'notes',
        value
      });
    }
  }
  return result;
}
export function customDefaults(s, scope, existing = {}) {
  return Object.fromEntries(s.fields.filter(f => !f.archived && f.scope === scope).map(f => [f.id, existing[f.id] ?? f.default ?? '']));
}
export function validateDoc(d, s, issue = false) {
  if (!/^[A-Z]{3}$/.test(d.currency || '')) throw Error("The currency must have a three-digit code, for example CZK or EUR.");
  if (!['invoice', 'quote'].includes(d.type) || !['draft', 'issued', 'cancelled'].includes(d.status)) throw Error("Invalid document type or status.");
  if (!d.number?.trim() || s.documents.some(x => x.id !== d.id && x.type === d.type && norm(x.number) === norm(d.number))) throw Error("The document number is missing or already exists.");
  if (d.date && !validDate(d.date) || d.due && !validDate(d.due)) throw Error("Invalid document date.");
  if (d.date && d.due && d.due < d.date) throw Error("The due date cannot be earlier than the issue date.");
  if (!Number.isFinite(+d.discount) || +d.discount < 0 || +d.discount > 100 || !Number.isFinite(total(d)) || total(d) < 0 || total(d) > 1e12) throw Error("Invalid amount or discount.");
  if (!Array.isArray(d.items) || d.items.length > 5000) throw Error("A document can have a maximum of 5,000 items.");
  for (const i of d.items) if (!Number.isFinite(+i.qty) || +i.qty < 0 || !Number.isFinite(+i.price) || +i.price < 0) throw Error("Invalid item quantity or price.");
  for (const f of s.fields.filter(f => !f.archived)) {
    const vals = f.scope === 'item' ? d.items.map(i => i.custom?.[f.id]) : [rawField('custom.' + f.id, d, s)];
    for (const v of vals) {
      if (v === undefined || v === null || v === '') continue;
      if (['number', 'money'].includes(f.type) && !Number.isFinite(+v) || f.type === 'date' && !validDate(v) || f.type === 'boolean' && ![true, false, 'true', 'false'].includes(v) || f.type === 'choice' && !f.options?.includes(v)) throw Error("Invalid custom field value: " + f.name);
    }
  }
  if (issue) {
    if (!validDate(d.date) || !validDate(d.due) || !d.customer?.name?.trim() || !d.supplier?.name?.trim() || !d.items.length || d.items.some(i => !i.name?.trim() || +i.qty <= 0)) throw Error("To display, fill in the dates, suppliers, customers and at least one valid item.");
    for (const f of s.fields.filter(f => f.required && !f.archived)) {
      const v = f.scope === 'item' ? d.items.map(i => i.custom?.[f.id]) : [rawField('custom.' + f.id, d, s)];
      if (v.some(x => x === undefined || x === null || x === '')) throw Error("Complete the required fields: " + f.name);
    }
  }
}
export function validateState(s) {
  if (s?.schema !== 3 || !s.supplier || !s.settings) throw Error("Invalid data format.");
  validateAppearance(s.settings.appearance, s.media || []);
  validateCalculators(s.settings.calculators);
  for (const k of collections) {
    if (!Array.isArray(s[k]) || s[k].length > 100000) throw Error("Invalid collection " + k);
    const ids = new Set();
    for (const x of s[k]) {
      if (!x?.id || typeof x.id !== 'string' || ids.has(x.id)) throw Error("Invalid or duplicate ID in " + k);
      ids.add(x.id);
    }
  }
  for (const d of s.documents) validateDoc(d, s);
  if (!Number.isInteger(+s.settings.dueDays) || +s.settings.dueDays < 1 || +s.settings.dueDays > 365 || !Number.isInteger(+s.settings.digits) || +s.settings.digits < 1 || +s.settings.digits > 12) throw Error("Invalid payment term or number series length.");
  if (!['en','cs'].includes(s.settings.language || 'en')) throw Error('Invalid interface language.');
  if (!Array.isArray(s.usedNumbers) || s.usedNumbers.some(n => typeof n !== 'string') || !Array.isArray(s.audit) || !Array.isArray(s.settings.units) || !Array.isArray(s.settings.paymentMethods) || !Array.isArray(s.settings.rates) || !s.settings.rates.every(r => Number.isFinite(+r.value) && +r.value >= 0) || !Number.isInteger(+s.settings.retention) || +s.settings.retention < 0 || !s.settings.invoicePrefix || !s.settings.quotePrefix || !s.settings.filename || !/^[A-Z]{3}$/.test(s.settings.currency)) throw Error("Invalid setting or number series.");
  for (const r of s.rules) {
    if (!['check', 'text'].includes(r.kind) || r.kind === 'text' && !['intro', 'notes'].includes(r.target) || !Number.isFinite(+r.priority) || r.condition?.field && !fieldsFor(s)[r.condition.field]) throw Error("Invalid rule: " + r.name);
  }
  return s;
}
export function checksFor(s) {
  const cases = [...s.checks];
  for (const d of s.documents) {
    if (d.status === 'issued' && !d.pdfHash && !cases.some(x => x.documentId === d.id && x.code === 'missing-pdf')) cases.push({
      id: 'missing:' + d.id,
      documentId: d.id,
      title: "PDF is missing from the archive",
      code: 'missing-pdf',
      status: 'open',
      severity: 'error',
      system: true
    });
    for (const r of s.rules.filter(r => r.enabled && r.kind === 'check')) if (condition(r.condition, d, s) && !cases.some(x => x.documentId === d.id && x.ruleId === r.id && x.status !== 'reopened')) cases.push({
      id: 'rule:' + r.id + ':' + d.id,
      documentId: d.id,
      title: r.name,
      ruleId: r.id,
      status: 'open',
      severity: r.severity || 'warning'
    });
  }
  return cases;
}
export function filename(d, s, ext = 'pdf') {
  const parts = {
    number: d.number,
    company: d.customer?.exportName || d.customer?.name || "Company",
    date: d.date?.replaceAll('-', '_') || '',
    year: d.date?.slice(0, 4) || '',
    month: d.date?.slice(5, 7) || '',
    day: d.date?.slice(8, 10) || ''
  };
  return (d.status === 'draft' ? 'Draft_' : '') + (s.settings.filename || '{number}_{company}_{date}').replace(/\{(\w+)\}/g, (_, k) => parts[k] ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 160) + '.' + ext;
}
export const bytesBase64 = b => {
  let s = '';
  for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768));
  return btoa(s);
};
export const base64Bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function packBackup(state, blobs) {
  validateState(state);
  const payload = JSON.stringify({
    data: state,
    blobs
  });
  if (payload.length > 145 * 1024 * 1024) throw Error("Full backup exceeds supported size 145 MB. Minimize attachments before making further changes.");
  return JSON.stringify({
    format: 'FakturocelBackup',
    version: 3,
    createdAt: now(),
    sha256: await hashBytes(new TextEncoder().encode(payload)),
    payload
  });
}
export async function unpackBackup(text) {
  if (typeof text !== 'string' || text.length > 300 * 1024 * 1024) throw Error("The backup is too large.");
  const b = JSON.parse(text);
  if (b.format !== 'FakturocelBackup' || ![2, 3].includes(b.version) || typeof b.payload !== 'string' || (await hashBytes(new TextEncoder().encode(b.payload))) !== b.sha256) throw Error("The backup has an invalid format or checksum.");
  const p = JSON.parse(b.payload);
  let result;
  if (b.version === 2) result = await migrateV2(p);else result = p;
  validateState(result.data);
  for (const [hash, a] of Object.entries(result.blobs || {})) {
    if ((await hashBytes(base64Bytes(a.base64))) !== hash) throw Error("Corrupt backup attachment.");
  }
  for (const d of result.data.documents) if (d.pdfHash && !result.blobs[d.pdfHash]) throw Error("PDF is missing from the backup.");
  for (const d of result.data.documents) for (const a of d.archiveVariants || []) if (!result.blobs[a.hash]) throw Error("The original PDF is missing from the backup.");
  if (result.data.legacyTemplateHash && !result.blobs[result.data.legacyTemplateHash]) throw Error("The original Excel is missing from the backup.");
  for (const m of result.data.media) if (!result.blobs[m.hash]) throw Error("There is no media in the backup.");
  return result;
}
export async function migrateV2(p) {
  if (p.data?.schema !== 2) throw Error("Unsupported original data.");
  const s = emptyState(),
    old = p.data;
  s.supplier = {
    ...s.supplier,
    ...old.supplier
  };
  s.settings = {
    ...s.settings,
    ...old.settings,
    templateId: 'builtin-classic'
  };
  const rates = ['rate1', 'rate2'].filter(k => Number.isFinite(+old.settings?.[k])).map((k, i) => ({
    name: "Hourly rate " + (i + 1),
    value: +old.settings[k]
  }));
  if (rates.length) s.settings.rates = rates;
  for (const k of ['companies', 'activities', 'texts', 'worklogs']) s[k] = clone(old[k] || []);
  s.documents = clone(old.documents || []);
  s.usedNumbers = old.usedNumbers || [];
  s.migrations = ['v2'];
  s.legacyExtras = Object.fromEntries(Object.entries(old).filter(([k]) => !['schema', 'supplier', 'settings', 'companies', 'activities', 'texts', 'worklogs', 'documents', 'attachments', 'usedNumbers'].includes(k)));
  if (old.gdpr) s.texts.push({
    id: uid(),
    name: old.gdpr,
    label: "Original consent"
  });
  const blobs = {};
  for (const [h, a] of Object.entries(old.attachments || {})) blobs[h] = {
    base64: a.base64,
    mime: 'application/pdf',
    name: a.name || 'Archiv.pdf'
  };
  if (p.templateBase64) {
    const hash = await hashBytes(base64Bytes(p.templateBase64));
    blobs[hash] = {
      base64: p.templateBase64,
      mime: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      name: "Original Excel.xlsm"
    };
    s.legacyTemplateHash = hash;
    if (p.templateBase64.startsWith('UEs')) {
      const zip = await JSZip.loadAsync(p.templateBase64, {
        base64: true
      });
      let expanded = 0;
      for (const [name, entry] of Object.entries(zip.files)) {
        if (!/^xl\/media\/[^/]+\.(png|jpe?g)$/i.test(name)) continue;
        if (s.media.length >= 100) throw Error("The original template contains too many images.");
        const expected = entry._data?.uncompressedSize || 0;
        if (expected > 25 * 1024 * 1024 || expanded + expected > 80 * 1024 * 1024) throw Error("The original images are too large.");
        const bytes = await entry.async('uint8array');
        expanded += bytes.length;
        const h = await hashBytes(bytes),
          mime = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg',
          label = "Original Excel · " + name.split('/').at(-1);
        blobs[h] = {
          base64: bytesBase64(bytes),
          mime,
          name: label
        };
        s.media.push({
          id: uid(),
          hash: h,
          mime,
          name: label,
          archived: false
        });
      }
      if (s.media.length) s.checks.push({
        id: uid(),
        title: "Check the original images and their placement in the editable template",
        status: 'open',
        severity: 'warning',
        code: 'migration-design',
        note: "Backup media is in the Media Library. Choose a logo and signature in a new version of the classic template; archive PDF remained unchanged."
      });
    }
  }
  for (const d of s.documents) {
    if (d.status === 'paid') {
      s.payments.push({
        id: uid(),
        documentId: d.id,
        amount: total(d),
        date: d.paidDate || '',
        note: "Taken from previous version; a blank date means an unknown payment date."
      });
      d.status = 'issued';
    }
    d.imported = true;
    d.currency ||= 'CZK';
    d.custom ||= {};
    d.templateId ||= 'builtin-classic';
    for (const title of d.sourceIssues || []) s.checks.push({
      id: uid(),
      documentId: d.id,
      title,
      status: 'open',
      severity: 'warning',
      code: 'legacy'
    });
    for (const a of d.audit || []) s.audit.push({
      id: uid(),
      ...a,
      recordId: d.id,
      action: 'historical'
    });
  }
  s.audit.push({
    id: uid(),
    at: now(),
    action: 'migration',
    message: "Stored Data Conversion Version 2; no bundled history is added."
  });
  return {
    data: s,
    blobs
  };
}
