import { renderDocument } from './renderer.js';
import { dateLabel, today, money, total, round } from './model.js';
import { tr } from './i18n.js';
export function yearlyRows(s) {
  const groups = new Map(),
    docs = new Map(s.documents.map(d => [d.id, d]));
  const row = (year, currency) => {
    const key = year + ':' + currency;
    if (!groups.has(key)) groups.set(key, {
      year,
      currency,
      invoiced: 0,
      received: 0,
      count: 0
    });
    return groups.get(key);
  };
  for (const d of s.documents.filter(d => d.type === 'invoice' && d.status === 'issued' && d.date)) {
    const r = row(d.date.slice(0, 4), d.currency);
    r.invoiced = round(r.invoiced + total(d));
    r.count++;
  }
  for (const p of s.payments.filter(p => p.date && !p.voided)) {
    const d = docs.get(p.documentId);
    if (d?.type === 'invoice') {
      const r = row(p.date.slice(0, 4), d.currency);
      r.received = round(r.received + +p.amount);
    }
  }
  return [...groups.values()].sort((a, b) => b.year.localeCompare(a.year) || a.currency.localeCompare(b.currency));
}
export function sumLabel(docs) {
  const sums = new Map();
  for (const d of docs) sums.set(d.currency, round((sums.get(d.currency) || 0) + total(d)));
  return [...sums].map(([c, n]) => money(n, c)).join(' + ') || money(0);
}
export async function reportPdf(title, text, s, load) {
  const template = {
    id: 'report',
    name: title,
    status: 'draft',
    page: {
      width: 210,
      height: 297,
      top: 18,
      bottom: 18
    },
    nodes: [{
      id: 'title',
      kind: 'text',
      name: 'Title',
      x: 16,
      y: 18,
      w: 178,
      h: 16,
      size: 18,
      font: 'bold',
      color: '#147b6d',
      runs: [{
        text: title
      }]
    }, {
      id: 'body',
      kind: 'text',
      name: 'Content',
      x: 16,
      y: 10,
      w: 178,
      h: 10,
      size: 10,
      lineHeight: 1.5,
      anchor: 'after',
      after: 'title',
      runs: [{
        text
      }]
    }, {
      id: 'page',
      kind: 'text',
      name: "Page",
      x: 174,
      y: 283,
      w: 20,
      h: 5,
      size: 8,
      repeat: 'all',
      runs: [{
        field: 'page.number'
      }, {
        text: ' / '
      }, {
        field: 'page.count'
      }]
    }]
  };
  return (await renderDocument({
    type: 'invoice',
    number: title,
    date: today(),
    currency: s.settings.currency,
    supplier: s.supplier,
    customer: {},
    items: [],
    discount: 0
  }, s, template, load)).bytes;
}
export const worklogText = (rows, s) => rows.map(w => `${dateLabel(w.date)} · ${w.hours} ${tr('hours')} · ${s.companies.find(c => c.id === w.companyId)?.name || ''}\n${w.description}`).join('\n\n') + `

${tr('Total')}: ${round(rows.reduce((v, w) => v + +w.hours, 0))} ${tr('hours')}`;
