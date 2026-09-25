import { enhanceLists } from './list-layout.js';
import { deviceCard } from './device-ui.js';
import { nativeClient, client, bridge } from './client-sync.js';
import { clientCard, clientBanner, installClientActions } from './client-ui.js';
import { syncCalculators, showCalculator } from './calculators.js';
import { openCalculatorSettings } from './calculator-editor.js';
import './base.css';
import './app.css';
import './theme.css';
import { clone, uid, now, today, norm, money, total, paid, balance, dateLabel, newDocument, customDefaults, textRules, checksFor, fieldsFor, filename, unpackBackup, bytesBase64, base64Bytes, statusNames, fieldValue } from './model.js';
import { $, esc, button, field, area, select, table, on, actions, toast, modal, formDialog, values, closeModal, setDirty, picker, job, confirmDialog, showError, validateForm, requestPassword } from './ui.js';
import { api, assetUrl, loadState, session, loadAsset, downloadBytes, downloadBackup, pickFile, upload, base, loadSecurity, exportExcel, downloadRecovery } from './api.js';
import { renderDocument } from './renderer.js';
import { openEditor, exportTemplate } from './editor.js';
import { showSecurityGate, needsSecurity, installSecurityActions, encryptionNotice, securityCard } from './security-ui.js';
import { hashBytes } from './crypto.js';
import { yearlyRows, sumLabel, reportPdf, worklogText } from './reports.js';
import { applyAppearance } from './appearance.js';
import { openAppearance } from './appearance-editor.js';
import { statusBadge, statusPanel } from './status.js';
import { recordChange } from './sync-details.js';
import JSZip from 'jszip';
import {setLanguage,storedLanguage,currentLanguage,locale,tr,languages} from './i18n.js';
let state,
  revisions = {},
  configRevision = 0,
  revision = 0,
  route = 'overview',
  filter = {},
  sort = {
    key: 'date',
    dir: -1
  },
  search = '',
  columnKeys = ['number', 'customer', 'date', 'amount', 'status', 'modified', 'source'],
  draft = null,
  refreshTimer;
const selectedDocs = {
  invoice: new Set(),
  quote: new Set()
};
const navigation = [['overview', "Overview"], ['invoice', "Invoices"], ['quote', "Quotes"], ['checks', 'Review queue'], ['companies', "Companies"], ['activities', "Activities"], ['worklogs', "Work logs"], ['texts', "Saved texts"], ['templates', "Document templates"], ['fields', "Custom fields"], ['rules', 'Texts and rules'], ['media', "Media library"], ['settings', "Settings and data"]];
const owner = () => session.actor?.role === 'owner',
  canEdit = () => session.actor?.role !== 'reader';
const recRev = (c, id) => revisions[c + ':' + id] || 0;
function adopt(r) {
  state = r.state;
  setLanguage(state.settings.language || 'en');
  revisions = r.revisions;
  configRevision = r.configRevision;
  revision = r.revision;
  if (r.backup !== undefined) session.lastBackup = r;
  render();
}
async function reload() {
  const {
    security
  } = await loadSecurity();
  if (needsSecurity(security)) {
    syncCalculators(null);
    state = null;
    draft = null;
    revisions = {};
    setDirty(false);
    await closeModal();
    document.querySelectorAll('.print-overlay').forEach(x => x.remove());
    applyAppearance();
    showSecurityGate(security, reload);
    return null;
  }
  const r = await loadState();
  adopt(r);
  return r;
}
installSecurityActions(reload);
installClientActions(reload);
on('localDefaultFolder', async () => {
  await client.run(() => client.persist({
    ...client.cache,
    backupFolderChosen: true
  }));
  await reload();
});
addEventListener('client-sync-ready', e => {
  Object.assign(session, e.detail);
  if (!$('#modal').innerHTML) adopt(e.detail);else if ($('#conflict')) $('#conflict').hidden = false;
});
let gateLoading = false;
addEventListener("Fakturocel-locked", () => {
  if (gateLoading) return;
  gateLoading = true;
  void reload().catch(e => showError(e)).finally(() => gateLoading = false);
});
async function save(ops, reason = '') {
  const result = await api('commit', {
    ops,
    reason
  });
  adopt(result);
  toast(result.backup ? "Saved and backed up." : "Saved; backup failed: " + (result.error || result.lastBackup?.error || ''), !result.backup);
  return result;
}
const put = (collection, value, rev = recRev(collection, value.id)) => save([{
  collection,
  id: value.id,
  rev,
  value
}]);
const badge = d => statusBadge(d, state);
const logoUrl = (appearance, media = state.media) => {
  const m = media.find(m => m.id === appearance.logoId);
  return m ? assetUrl(m.hash) : new URL('app-logo.svg', base).href;
};
const fieldOptions = () => Object.entries(fieldsFor(state));
addEventListener('message', e => {
  const frame = document.querySelector('.print-overlay iframe');
  if (e.origin === location.origin && e.source === frame?.contentWindow && e.data?.type === "fakturocel-print-error") void showError(Error(String(e.data.message || "Failed to start printing.")), "Invoice printing");
});
function render() {
  if (!state) return;
  syncCalculators(state);
  const appearance = applyAppearance(state.settings.appearance);
  $('#app').innerHTML = `<aside><a class="brand" href="#" data-action="nav:overview"><img class="brand-logo" src="${esc(logoUrl(appearance))}" alt="Application logo"><span>${esc(appearance.brandName)}${appearance.tagline ? `<small>${esc(appearance.tagline)}</small>` : ''}</span></a><nav aria-label="Main navigation">${navigation.filter(([r]) => owner() || !['fields', 'rules', 'media', 'templates'].includes(r)).map(([r, l]) => button('nav:' + r, l, route === r ? 'active' : '')).join('')}</nav></aside><main><header class="top"><div><p class="eyebrow">MY BUSINESS</p><h1>${navigation.find(([r]) => r === route)?.[1] || "Fakturocel"}</h1></div><div class="top-actions">${button('shortcuts', "Shortcuts")}${button('excel', '↓ Excel')}${canEdit() ? button('newDoc:invoice', "+ New invoice", 'primary') : ''}</div></header><div id="conflict" class="notice" hidden><span>There is newer data on the server.</span> ${button('reload', "Load current data")}</div>${nativeClient ? '<div id="clientStatus">' + clientBanner() + '</div>' + (!client.cache.backupFolderChosen ? "<div class=\"notice\"><strong>Where should automatic backups be stored?</strong><p>They are currently stored in the application's private folder. Choose a folder for your own copies.</p>" + button('backupFolder', "Select backup folder") + button('localDefaultFolder', "Keep private folder") + '</div>' : '') : ''}<div class="backup-strip ${session.lastBackup?.backup === false ? 'pending' : ''}" ${nativeClient ? 'hidden' : ''}><span>${session.lastBackup?.backup ? "Backup saved " + new Date(session.lastBackup.at).toLocaleString() : session.lastBackup?.error ? esc(session.lastBackup.error) : "Data is stored in Home Assistant"}</span>${button('nav:settings', "Backups and settings →", 'text-button')}</div>${encryptionNotice()}<div id="content">${content()}</div><footer>Fakturocel 3 · Appearance, data, and rules are managed directly in the application. ${button('shortcuts', "Keyboard shortcuts", 'text-button')}</footer></main>`;
  bindContent();
  enhanceLists(route);
}
function customForm(scope, source = {}) {
  return state.fields.filter(f => f.scope === scope && !f.archived).map(f => {
    const name = 'custom_' + f.id,
      v = source[f.id] ?? f.default ?? '';
    return f.type === 'choice' ? select(f.name, name, ['', ...(f.options || [])], v) : f.type === 'boolean' ? select(f.name, name, [['', "Unfilled"], ['true', "Yes"], ['false', "No"]], String(v)) : f.type === 'long' ? area(f.name, name, v) : field(f.name, name, v, {
      date: 'date',
      number: 'number',
      money: 'number'
    }[f.type] || 'text', f.required ? 'required' : '');
  }).join('');
}
function customValues(v) {
  return Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith('custom_')).map(([k, v]) => [k.slice(7), v]));
}
function content() {
  if (route === 'overview') return overview();
  if (['invoice', 'quote'].includes(route)) return documentList();
  if (route === 'companies') return catalog('companies', "Company", ["Name", "ID number", "City"], c => [c.name, c.ico, c.city]);
  if (route === 'activities') return catalog('activities', "Activity", ["Activity", "Price", "Unit"], a => [a.name, money(a.price), a.unit]);
  if (route === 'texts') return button('pdfTexts', "↓ PDF of displayed texts") + catalog('texts', 'Text', ["Title / text"], t => [t.name]);
  if (route === 'worklogs') return button('pdfWorklogs', "↓ PDF of the displayed statement") + catalog('worklogs', "Statement", ['Date', "Company", 'Hours', "Description"], w => [dateLabel(w.date), state.companies.find(c => c.id === w.companyId)?.name || '', w.hours, w.description]);
  if (route === 'fields') return `<section class="card"><div class="section-head"><h2>Custom data fields</h2>${button('editField:new', "+ New field", 'primary')}</div><p class="muted">Each field has a stable ID. Renaming preserves template bindings; archive fields that are no longer used.</p>${table(["Name", "Belongs to", 'Type', "State", ''], state.fields.map(f => `<tr><td>${esc(f.name)}</td><td>${esc({
    document: "Document",
    company: "Company",
    supplier: "Supplier",
    item: "Item"
  }[f.scope])}</td><td>${esc(f.type)}</td><td>${f.archived ? "Archived" : f.required ? "Mandatory" : "Optional"}</td><td>${button('editField:' + f.id, 'Edit', 'small')}</td></tr>`))}</section>`;
  if (route === 'templates') return `<section class="card"><div class="section-head"><h2>Templates and their versions</h2><div>${button('importTemplate', "Import template")}${button('templateNew', "+ New template", 'primary')}</div></div><p class="muted">The active template is edited as a new version. Issued PDFs remain unchanged.</p>${table(["Name", 'Version', "State", ''], state.templates.map(t => `<tr><td>${esc(t.name)}${t.id === state.settings.templateId ? "<small>Default for new documents</small>" : ''}</td><td>${t.version}</td><td>${{
    active: "Active",
    draft: 'Koncept',
    archived: "Archived"
  }[t.status]}</td><td>${button('editTemplate:' + t.id, t.status === 'active' ? 'Edit a new version' : "Open the editor", 'small')}${button('exportTemplate:' + t.id, 'Export', 'small')}${t.status === 'active' && t.id !== state.settings.templateId ? button('archiveTemplate:' + t.id, 'Archive', 'small') : ''}${t.status === 'active' ? button('defaultTemplate:' + t.id, "Set default", 'small') : ''}</td></tr>`))}</section>`;
  if (route === 'rules') return `<section class="card"><div class="section-head"><h2>Automatic texts and checks</h2>${button('editRule:new', "+ New rule", 'primary')}</div><p class="muted">Rules are applied in priority order. Manually edited text is preserved unless you explicitly reapply the rules.</p>${table(["Name", 'Type', 'Priority', "State", ''], state.rules.map(r => `<tr><td>${esc(r.name)}</td><td>${r.kind === 'check' ? "Check" : 'Text'}</td><td>${r.priority || 0}</td><td>${r.enabled ? 'Enabled' : 'Disabled'}</td><td>${button('editRule:' + r.id, 'Edit', 'small')}</td></tr>`))}</section>`;
  if (route === 'media') return `<section class="card"><div class="section-head"><h2>Images, signatures and fonts</h2>${button('addMedia', "+ Upload file", 'primary')}</div><p class="muted">PNG, JPEG, SVG, TTF and OTF. SVG is converted to a safe image on import. The original images of the used templates are preserved.</p><div class="media-grid">${state.media.map(m => `<article>${m.mime.startsWith('image/') ? `<img src="${esc(assetUrl(m.hash))}" alt="${esc(m.name)}">` : '<div class="font-preview">Aa</div>'}<strong>${esc(m.name)}</strong><small>${esc(m.mime)} · ${state.templates.filter(t => JSON.stringify(t.nodes).includes(m.id)).length} templates${m.archived ? " · archived" : ''}</small>${button('editMedia:' + m.id, "Rename / archive", 'small')}</article>`).join('') || "<p>No media. Upload your own logo or image.</p>"}</div></section>`;
  if (route === 'checks') return checksPage();
  if (route === 'settings') return settingsPage();
  return '';
}
function overview() {
  const summary = yearlyRows(state),
    currencies = [...new Set(summary.map(r => r.currency))],
    currency = filter.overviewCurrency || currencies[0] || state.settings.currency,
    years = [...new Set(summary.filter(r => r.currency === currency).map(r => r.year))],
    year = filter.overviewYear || years[0] || String(new Date().getFullYear()),
    docs = state.documents.filter(d => d.type === 'invoice' && d.status === 'issued' && d.currency === currency),
    selected = docs.filter(d => d.date?.startsWith(year)),
    row = summary.find(r => r.year === year && r.currency === currency) || {
      invoiced: 0,
      received: 0
    },
    monthly = Array.from({
      length: 12
    }, (_, i) => selected.filter(d => +d.date.slice(5, 7) === i + 1).reduce((v, d) => v + total(d), 0)),
    max = Math.max(1, ...monthly);
  return `${!state.supplier.name ? `<section class="card welcome"><h2>Welcome to Fakturocel</h2><p>The application is empty. Fill in your personal information or restore your backup.</p>${button('nav:settings', "Set up application", 'primary')} ${owner() ? button('restore', "Restore backup") : ''}</section>` : ''}<section class="card"><div class="section-head"><h2>Annual review</h2><div class="form-grid">${select("Year", 'overviewYear', years.length ? years : [year], year)}${select("Currency", 'overviewCurrency', currencies.length ? currencies : [currency], currency)}</div></div><div class="stats"><div><p>Invoiced in ${esc(year)}</p><strong>${money(row.invoiced, currency)}</strong><small>${selected.length} invoices</small></div><div><p>Payments received in the year ${esc(year)}</p><strong>${money(row.received, currency)}</strong><small>By payment date; payments without a date are not counted here.</small></div><div><p>Remaining from this year's invoices</p><strong>${money(selected.reduce((n, d) => n + Math.max(0, balance(d, state)), 0), currency)}</strong><small>It is not a net profit. Currencies are not added together.</small></div></div><div class="bars">${monthly.map((v, i) => `<div title="${i + 1}: ${esc(money(v, currency))}"><small>${money(v, currency)}</small><span style="height:${Math.max(2, v / max * 130)}px"></span><label>${i + 1}</label></div>`).join('')}</div></section><section class="card"><h2>All the years</h2>${table(["Year", "Currency", 'Issued', "Payments received", "Number of invoices"], summary.map(r => `<tr><td>${esc(r.year)}</td><td>${esc(r.currency)}</td><td>${money(r.invoiced, r.currency)}</td><td>${money(r.received, r.currency)}</td><td>${r.count}</td></tr>`))}</section>${checksFor(state).some(c => !['resolved', 'exception'].includes(c.status)) ? `<div class="notice">Some documents are pending review. ${button('nav:checks', "Open checks")}</div>` : ''}`;
}
const listLabels = {
  number: "Number",
  customer: "Customer",
  'customer.ico': "Customer ID number",
  date: 'Issued',
  due: "Due date",
  amount: "Amount",
  balance: "Outstanding",
  currency: "Currency",
  status: "State",
  notes: "Note",
  modified: "Last change",
  source: "Source of change"
};
function recordInfo(collection, id) {
  return recordChange(state, collection, id);
}
function recordMeta(collection, id) {
  const info = recordInfo(collection, id);
  return `<div class="record-meta"><span><strong>Source of last change:</strong> ${esc(info.source)}${info.actor ? ' · ' + esc(info.actor) : ''}</span><span><strong>Changed:</strong> ${info.at ? esc(new Date(info.at).toLocaleString(locale())) : "the time is unknown"}</span></div>`;
}
function docValue(d, key) {
  const info = recordInfo('documents', d.id);
  if (key === 'customer') return d.customer?.name || '';
  if (key === 'customer.ico') return d.customer?.ico || '';
  if (key === 'amount') return total(d);
  if (key === 'balance') return balance(d, state);
  if (key === 'modified') return info.at || '';
  if (key === 'source') return [info.source, info.actor].filter(Boolean).join(' · ');
  if (key.startsWith('custom.')) return fieldValue({
    field: key
  }, d, state);
  return d[key] || '';
}
function filteredDocs() {
  const f = filter[route] || {},
    q = norm(search);
  const rows = state.documents.filter(d => d.type === route).filter(d => (!q || norm([d.number, d.customer?.name, d.notes, ...d.items.map(i => i.name)].join(' ')).includes(q)) && (!f.company || d.customer?.id === f.company) && (!f.number || norm(d.number).includes(norm(f.number))) && (!f.currency || d.currency === f.currency) && (!f.customField || norm(fieldValue({
    field: f.customField
  }, d, state)).includes(norm(f.customValue))) && (!f.year || d.date?.startsWith(f.year)) && (!f.from || d.date >= f.from) && (!f.to || d.date <= f.to) && (!f.status || f.status === 'paid' && balance(d, state) <= 0 && d.status === 'issued' || f.status === 'unpaid' && balance(d, state) > 0 && d.status === 'issued' || f.status === 'overdue' && balance(d, state) > 0 && d.status === 'issued' && d.due && d.due < today() || f.status === d.status) && (!f.min || total(d) >= Number(f.min.replace(/\s/g, '').replace(',', '.'))) && (!f.max || total(d) <= Number(f.max.replace(/\s/g, '').replace(',', '.'))));
  return rows.sort((a, b) => {
    const av = docValue(a, sort.key),
      bv = docValue(b, sort.key);
    return (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), locale(), {
      numeric: true
    })) * sort.dir;
  });
}
function docCell(d, key) {
  if (key === 'number') return button('openDoc:' + d.id, esc(d.number), 'link');
  if (key === 'status') return badge(d);
  if (['date', 'due'].includes(key)) return dateLabel(d[key]);
  if (['amount', 'balance'].includes(key)) return money(docValue(d, key), d.currency);
  if (key === 'modified') {
    const value = docValue(d, key);
    return value ? esc(new Date(value).toLocaleString(locale())) : '—';
  }
  return esc(docValue(d, key));
}
function docResults() {
  const f = filter[route] || {},
    amount = v => Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (f.from && f.to && f.from > f.to || f.min && f.max && amount(f.min) > amount(f.max) || f.min && !Number.isFinite(amount(f.min)) || f.max && !Number.isFinite(amount(f.max))) return `<div class="notice" role="alert">Fix filter range: start date or amount must not exceed end value and amount must be a number. ${button('clearFilters', "Cancel filters")}</div>`;
  const rows = filteredDocs(),
    keys = columnKeys,
    labels = {
      ...listLabels,
      ...Object.fromEntries(state.fields.map(f => ['custom.' + f.id, f.name]))
    },
    chosen = selectedDocs[route];
  return `<div class="list-summary"><span>${rows.length} documents · sum ${sumLabel(rows)}</span>${button('clearFilters', "Cancel filters", 'text-button')}</div><div id="bulkBar" class="bulk-bar" ${chosen.size ? '' : 'hidden'}><strong><span id="bulkCount">${chosen.size}</span> selected</strong>${button('bulkPdf', "Download PDF in ZIP")}${canEdit() ? button('bulkDeleteDrafts', "Delete selected drafts", 'danger') : ''}${button('clearSelection', "Cancel selection")}</div>${table(["<span class=\"sr-only\">Selection</span>", ...keys.map(k => button('sort:' + k, esc(labels[k] || k) + (sort.key === k ? sort.dir === 1 ? ' ↑' : ' ↓' : ' ↕'), 'sort-heading')), ''], rows.map(d => `<tr data-doc-id="${esc(d.id)}"><td><input class="row-select" type="checkbox" data-doc-select="${esc(d.id)}" aria-label="Select document ${esc(d.number)}" ${chosen.has(d.id) ? 'checked' : ''}></td>${keys.map(k => `<td>${docCell(d, k)}</td>`).join('')}<td class="row-actions">${button('pdf:' + d.id, 'PDF', 'small')}${button('print:' + d.id, 'Print', 'small')}${button('openDoc:' + d.id, "Open", 'small')}</td></tr>`))}`;
}
function documentList() {
  const f = filter[route] || {},
    years = [...new Set(state.documents.filter(d => d.type === route).map(d => d.date?.slice(0, 4)))].filter(Boolean).sort().reverse();
  return `<section class="card"><div class="toolbar"><input id="search" value="${esc(search)}" aria-label="Search for documents" placeholder="Search for number, company or note">${canEdit() ? button('newDoc:' + route, "+ New document", 'primary') : ''}${button('listColumns', 'Columns')}${canEdit() ? button('saveView', "Save view") : ''}${button('selectVisible', "Select displayed")}</div><div class="saved-views">${state.views.filter(v => v.route === route).map(v => `<span class="saved-view">${button('useView:' + v.id, esc(v.name), 'small')}${canEdit() ? button('deleteView:' + v.id, '×', 'small view-delete') : ''}</span>`).join('') || "<span class=\"muted\">No saved views.</span>"}</div><div class="filters">${field("The number contains", 'filter_number', f.number || '')}<label>Company${button('filterCustomer', esc(state.companies.find(c => c.id === f.company)?.name || "All companies"), 'select-button')}</label>${select("Year", 'filter_year', [['', "All the years"], ...years], f.year)}${select("Condition / payment", 'filter_status', [['', "All states"], ['draft', "In progress"], ['issued', 'Issued'], ['cancelled', "Cancelled"], ['paid', 'Paid'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue']], f.status)}${field('Issued from', 'filter_from', f.from || '', 'date')}${field('Issued to', 'filter_to', f.to || '', 'date')}${field("Amount from", 'filter_min', f.min || '')}${field("Amount to", 'filter_max', f.max || '')}${select("Currency", 'filter_currency', [['', "All currencies"], ...[...new Set(state.documents.map(d => d.currency))]], f.currency)}${select("Custom field", 'filter_customField', [['', 'No filter'], ...state.fields.filter(f => f.scope !== 'item' && !f.archived).map(f => ['custom.' + f.id, f.name])], f.customField)}${field("Custom field contains", 'filter_customValue', f.customValue || '')}</div><div id="docResults">${docResults()}</div></section>`;
}
function catalog(key, label, heads, cells) {
  const rows = state[key].filter(x => !search || norm(JSON.stringify(x)).includes(norm(search)));
  return `<section class="card"><div class="section-head"><h2>${label} · ${rows.length}</h2>${canEdit() ? button('editRecord:' + key + ':new', "+ Add", 'primary') : ''}</div><input id="search" value="${esc(search)}" placeholder="Hledat…">${table([...heads, "State", "Last change", "Source of change", ''], rows.map(x => {
    const info = recordInfo(key, x.id);
    return `<tr data-record-id="${esc(x.id)}">${cells(x).map(v => `<td>${esc(v)}</td>`).join('')}<td>${x.archived ? "Archived" : ''}</td><td>${info.at ? esc(new Date(info.at).toLocaleString(locale())) : '—'}</td><td>${esc(info.source)}${info.actor ? ' · ' + esc(info.actor) : ''}</td><td>${button('editRecord:' + key + ':' + x.id, "Open", 'small')}</td></tr>`;
  }))}</section>`;
}
function checksPage() {
  const docs = new Map(state.documents.map(d => [d.id, d])),
    all = checksFor(state).filter(c => (filter.checkStatus === 'all' || !['resolved', 'exception'].includes(c.status)) && (!filter.checkSeverity || c.severity === filter.checkSeverity) && (!filter.checkCompany || docs.get(c.documentId)?.customer?.id === filter.checkCompany) && (!search || norm(c.title + ' ' + docs.get(c.documentId)?.number).includes(norm(search))));
  return `<section class="card"><div class="section-head"><h2>Document control</h2>${canEdit() ? button('editCheck:new', "+ Control task", 'primary') : ''}</div><div class="toolbar"><input id="search" value="${esc(search)}" placeholder="Search document or issue">${select("State", 'checkStatus', [['open', "Open"], ['all', "All including resolved"]], filter.checkStatus || 'open')}${select("Severity", 'checkSeverity', [['', "All"], ['error', "Error"], ['warning', "Notice"]], filter.checkSeverity)}${select("Company", 'checkCompany', [['', "All"], ...state.companies.map(c => [c.id, c.name])], filter.checkCompany)}</div>${table(["Document", "Problem", "Severity", "State", "Last change", "Source of change", ''], all.map(c => {
    const info = recordInfo('checks', c.id);
    return `<tr><td>${esc(docs.get(c.documentId)?.number || "General task")}</td><td>${esc(c.title)}</td><td><span class="badge ${c.severity === 'error' ? 'overdue' : 'partial'}">${esc({
      error: "Error",
      warning: "Notice"
    }[c.severity] || c.severity)}</span></td><td>${esc({
      open: "OPEN",
      reviewing: "It is being checked",
      resolved: "Solved",
      exception: "Exception",
      reopened: "Reopened"
    }[c.status] || c.status)}</td><td>${info.at ? esc(new Date(info.at).toLocaleString(locale())) : '—'}</td><td>${esc(info.source)}${info.actor ? ' · ' + esc(info.actor) : ''}</td><td>${button('editCheck:' + c.id, "Resolve or edit", 'small')}${c.documentId ? button('openDoc:' + c.documentId, "Document", 'small') : ''}</td></tr>`;
  }))}</section>`;
}
function settingsPage() {
  return `<section class="card"><div class="section-head"><div><h2>Language</h2><p class="muted">The selected interface language is stored with the application data.</p></div>${select('Interface language','appLanguage',languages,state.settings.language || 'en')}</div></section>${nativeClient ? clientCard() : owner() ? deviceCard() : ''}${securityCard(owner())}<section class="card"><div class="section-head"><h2>Calculator</h2>${owner() ? button('calculatorSettings', "Set calculators", 'primary') : button('calculatorOpen', "Open the calculator")}</div><p>Standard, scientific, 3D-printing, and custom calculations with configurable fields, formulas, results, and list order.</p><p class="muted">Use the icon at the bottom left or Alt+C to open the panel above any screen. Hiding it preserves its memory in this tab.</p></section>${owner() ? `<section class="card"><div class="section-head"><h2>Appearance and readability</h2>${button('appearance', "Set appearance", 'primary')}</div><p>Interface scale, text size, light or dark theme, custom colors, and application logo.</p></section>` : ''}<section class="card"><h2>Backups and recovery</h2><p>A full backup includes documents, templates, images, fonts, checks, and history.</p><div class="folder"><span>${esc(session.backupFolder)}</span>${owner() ? button('backupFolder', "Change folder") : ''}</div><div class="form-actions">${button('backup', nativeClient ? "Backup to folder" : "Backup to server")}${button('downloadBackup', "Download backup to this device", 'primary')}${owner() ? button('restore', "Restore data from backup") : ''}</div></section>${owner() ? `<section class="card"><div class="section-head"><h2>My data and default values</h2>${button('editSettings', 'Edit', 'primary')}</div><p>${esc(state.supplier.name || "No supplier details have been entered yet.")}</p><p class="muted">Number series, payment methods, units, filenames, default text, and custom fields.</p></section>${nativeClient ? '' : `<section class="card"><div class="section-head"><h2>Access via Home Assistant</h2>${button('roles', "Manage access")}</div><p class="muted">Your ID: ${esc(session.actor?.id)}. Authorization is checked by the server.</p></section>`}${nativeClient ? `<section class="card danger-zone"><h2>Clear this device's data</h2><p>A verified backup is mandatory before local data, managed backups, and connections are deleted. Home Assistant data remains available.</p>${button('clientClear', "Prepare backup and deletion", 'danger')}</section>` : `<section class="card danger-zone"><h2>Clear add-on data</h2><p>Deletes the database, attachments, templates, settings, history, and Fakturocel backups in managed folders. You must download the current .fakturocel file and select it again for verification.</p><p class="muted">Home Assistant full backups, other manual copies, and downloaded files must be managed separately. Deletion cannot guarantee physical overwriting of disk blocks.</p>${button('wipe', "Prepare backup and deletion", 'danger')}</section>`}` : ''}`;
}
function updateBulkBar() {
  const bar = $('#bulkBar'),
    count = $('#bulkCount');
  if (!bar || !selectedDocs[route]) return;
  bar.hidden = !selectedDocs[route].size;
  if (count) count.textContent = selectedDocs[route].size;
}
function bindDocSelections() {
  if (!['invoice', 'quote'].includes(route)) return;
  for (const input of document.querySelectorAll('[data-doc-select]')) input.onchange = () => {
    if (input.checked) selectedDocs[route].add(input.dataset.docSelect);else selectedDocs[route].delete(input.dataset.docSelect);
    updateBulkBar();
  };
  updateBulkBar();
}
function redrawDocResults() {
  const box = $('#docResults');
  if (box) {
    box.innerHTML = docResults();
    bindDocSelections();
  }
}
function bindContent() {
  if ($('[name="appLanguage"]')) $('[name="appLanguage"]').onchange = e => void job(() => save([{collection:'config',rev:configRevision,value:{supplier:state.supplier,settings:{...state.settings,language:e.target.value}}}]));
  for (const key of ['overviewCurrency', 'checkSeverity', 'checkCompany']) if ($('[name="' + key + '"]')) $('[name="' + key + '"]').onchange = e => {
    filter[key] = e.target.value;
    if (key === 'overviewCurrency') delete filter.overviewYear;
    render();
  };
  if ($('#search')) $('#search').oninput = e => {
    search = e.target.value;
    if (['invoice', 'quote'].includes(route)) redrawDocResults();else {
      const pos = e.target.selectionStart;
      render();
      $('#search').focus();
      $('#search').setSelectionRange(pos, pos);
    }
  };
  for (const el of document.querySelectorAll('[name^="filter_"]')) el.oninput = e => {
    (filter[route] ||= {})[e.target.name.slice(7)] = e.target.value;
    redrawDocResults();
  };
  if ($('[name="overviewYear"]')) $('[name="overviewYear"]').onchange = e => {
    filter.overviewYear = e.target.value;
    render();
  };
  if ($('[name="checkStatus"]')) $('[name="checkStatus"]').onchange = e => {
    filter.checkStatus = e.target.value;
    render();
  };
  bindDocSelections();
}
on('nav', async r => {
  if ($('#modal').innerHTML && !(await closeModal())) return;
  route = r;
  search = '';
  render();
});
on('reload', async () => {
  if ($('#modal').innerHTML && !(await confirmDialog("Load the current data and close the detailed form?"))) return;
  setDirty(false);
  closeModal();
  await reload();
});
on('sort', key => {
  sort = {
    key,
    dir: sort.key === key ? -sort.dir : 1
  };
  redrawDocResults();
});
on('clearFilters', () => {
  filter[route] = {};
  search = '';
  render();
});
on('filterCustomer', () => picker("Filter by company", [{
  id: '',
  label: "All companies",
  detail: ''
}, ...state.companies.map(c => ({
  id: c.id,
  label: c.name,
  detail: c.ico || ''
}))], c => {
  (filter[route] ||= {}).company = c.id;
  render();
}));
on('saveView', () => formDialog("Save view", `<p>The search, all filters, sorting and selected columns are saved. The same name overwrites the earlier view.</p>${field("Name", 'name', '', 'text', 'required maxlength="80"')}`, v => {
  const name = v.name.trim();
  if (!name) throw Error("Fill in the name of the view.");
  const existing = state.views.find(x => x.route === route && norm(x.name) === norm(name)),
    id = existing?.id || uid();
  return put('views', {
    id,
    name,
    route,
    filters: clone(filter[route] || {}),
    sort: clone(sort),
    columns: [...columnKeys],
    search
  }, existing ? recRev('views', id) : 0);
}));
on('useView', id => {
  const v = state.views.find(v => v.id === id);
  filter[route] = clone(v.filters);
  sort = clone(v.sort);
  columnKeys = v.columns;
  search = v.search || '';
  render();
});
on('deleteView', async id => {
  const view = state.views.find(v => v.id === id);
  if (view && (await confirmDialog(`Delete Saved View "${view.name}“?`, {
    title: 'Delete saved view',
    confirmText: 'Delete',
    danger: true
  }))) await save([{
    collection: 'views',
    id,
    rev: recRev('views', id),
    delete: true
  }]);
});
on('listColumns', () => {
  let keys = [...columnKeys];
  const labels = {
    ...listLabels,
    ...Object.fromEntries(state.fields.map(f => ['custom.' + f.id, f.name]))
  };
  const draw = () => {
    modal("Columns and their order", `<p>Tick ​​the columns and use the arrows to change their order.</p><div id="columnChoices">${[...keys, ...Object.keys(labels).filter(k => !keys.includes(k))].map(k => `<div class="role-row"><label><input style="width:auto;display:inline" type="checkbox" data-column="${esc(k)}" ${keys.includes(k) ? 'checked' : ''}> ${esc(labels[k])}</label>${keys.includes(k) ? button('columnUp:' + k, '↑') + button('columnDown:' + k, '↓') : ''}</div>`).join('')}</div>${button('columnsApply', "Use", 'primary')}`);
    $('#columnChoices').onchange = e => {
      const k = e.target.dataset.column;
      if (!k) return;
      keys = e.target.checked ? [...keys, k] : keys.filter(x => x !== k);
      draw();
    };
  };
  on('columnUp', k => {
    const i = keys.indexOf(k);
    if (i > 0) [keys[i - 1], keys[i]] = [keys[i], keys[i - 1]];
    draw();
  });
  on('columnDown', k => {
    const i = keys.indexOf(k);
    if (i >= 0 && i < keys.length - 1) [keys[i + 1], keys[i]] = [keys[i], keys[i + 1]];
    draw();
  });
  on('columnsApply', () => {
    if (!keys.length) throw Error("Select at least one column.");
    columnKeys = keys;
    setDirty(false);
    closeModal();
    render();
  });
  draw();
});
on('selectVisible', () => {
  for (const d of filteredDocs()) selectedDocs[route].add(d.id);
  redrawDocResults();
});
on('clearSelection', () => {
  selectedDocs[route].clear();
  redrawDocResults();
});
on('bulkPdf', async () => {
  const docs = state.documents.filter(d => selectedDocs[route].has(d.id));
  if (!docs.length) throw Error("Choose at least one document.");
  const zip = new JSZip();
  for (const d of docs) zip.file(filename(d, state), await documentPdf(d, d.status === 'draft'));
  await downloadBytes(await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE'
  }), "Fakturocel-" + route + '-' + today() + '.zip', 'application/zip');
  toast(`Downloaded ${docs.length} documents in one ZIP file.`);
});
on('bulkDeleteDrafts', async () => {
  const docs = state.documents.filter(d => selectedDocs[route].has(d.id) && d.status === 'draft');
  if (!docs.length) throw Error("There is no draft in the selection that can be deleted.");
  if (docs.length > 100) throw Error("A maximum of 100 drafts can be deleted at once. Reduce the selection.");
  if (!(await confirmDialog(`Delete ${docs.length} selected drafts? Their numbers will remain reserved.`, {
    title: "Bulk deletion of drafts",
    confirmText: "Delete drafts",
    danger: true
  }))) return;
  await save(docs.map(d => ({
    collection: 'documents',
    id: d.id,
    rev: recRev('documents', d.id),
    delete: true
  })));
  for (const d of docs) selectedDocs[route].delete(d.id);
  redrawDocResults();
});
function recordEditor(key, id) {
  const current = state[key].find(x => x.id === id),
    r = clone(current || {
      id: uid()
    }),
    rev = recRev(key, r.id);
  let html = current ? recordMeta(key, r.id) : '';
  if (key === 'companies') html = `<div class="form-grid">${[["Name", 'name'], ['Street', 'street'], ["City", 'city'], ["Postal code", 'zip'], ["ID number", 'ico'], ["Tax ID", 'dic'], ["Contact person", 'contact'], ['E-mail', 'email'], ['Phone', 'phone'], ['Export abbreviation', 'exportName']].map(([l, k]) => field(l, k, r[k] || '')).join('')}${customForm('company', r.custom)}</div>${area("Default note for documents", 'defaultNotes', r.defaultNotes || '')}`;
  if (key === 'activities') html = `${field("Activity", 'name', r.name || '')}<div class="form-grid">${field("Price per unit", 'price', r.price || 0, 'number', 'min="0" step="0.01"')}${field("Unit", 'unit', r.unit || state.settings.units[0])}${field("Time in minutes", 'minutes', r.minutes || 0, 'number', 'min="0"')}${select("Hourly rate", 'rate', state.settings.rates.map((x, i) => [String(i), x.name + ' · ' + money(x.value)]), '0')}</div>${button('estimate', "Add price from time")}`;
  if (key === 'texts') html = area('Text', 'name', r.name || '');
  if (key === 'worklogs') html = `<div class="form-grid">${field('Date', 'date', r.date || today(), 'date')}<label>Company${button('recordCompany', esc(state.companies.find(c => c.id === r.companyId)?.name || "Choose a company..."), 'select-button')}<input type="hidden" name="companyId" value="${esc(r.companyId || '')}"></label>${field('Hours', 'hours', r.hours || 0, 'number', 'min="0" step="0.25"')}</div>${area("Job description", 'description', r.description || '')}`;
  html += select("State", 'archived', [['false', "Active"], ['true', "Archived"]], String(!!r.archived));
  formDialog("Edit record", html, async v => {
    if (!canEdit()) throw Error("You have read-only access.");
    const value = {
      ...r,
      ...v,
      archived: v.archived === 'true'
    };
    if (key === 'companies') {
      value.custom = customValues(v);
      for (const k of Object.keys(value)) if (k.startsWith('custom_')) delete value[k];
    }
    for (const k of ['price', 'minutes', 'hours']) if (k in v) value[k] = +v[k];
    if (['companies', 'activities', 'texts'].includes(key) && !value.name.trim()) throw Error("Fill in the name.");
    await put(key, value, rev);
  });
  on('recordCompany', () => picker("Choose a company", state.companies.filter(c => !c.archived).map(c => ({
    id: c.id,
    label: c.name,
    detail: c.ico || ''
  })), c => {
    r.companyId = c.id;
    $('[name="companyId"]').value = c.id;
    $('[data-action="recordCompany"]').textContent = c.label;
    setDirty(true);
  }));
  on('estimate', () => {
    const v = values();
    $('[name="price"]').value = (+v.minutes / 60 * +state.settings.rates[+v.rate].value).toFixed(2);
  });
}
on('editRecord', value => {
  const [key, id] = value.split(':');
  recordEditor(key, id);
});
function editDoc(input) {
  draft = clone(input);
  const originalRev = recRev('documents', draft.id);
  let d = draft;
  d.custom = customDefaults(state, 'document', d.custom);
  d.items.forEach(i => i.custom = customDefaults(state, 'item', i.custom));
  const draw = () => {
    modal((d.type === 'quote' ? "Quote " : "Invoice ") + d.number, `<form id="docForm" novalidate>${state.documents.some(x => x.id === d.id) ? recordMeta('documents', d.id) : ''}${statusPanel(d, state)}<div class="form-grid">${field("Document number", 'number', d.number)}${field('Issue date', 'date', d.date, 'date')}${field("Due date", 'due', d.due, 'date')}${select("Method of payment", 'payment', state.settings.paymentMethods, d.payment)}${field("Variable symbol (empty = document number)", 'vs', d.vs || '')}${select("Template", 'templateId', state.templates.filter(t => t.status === 'active').map(t => [t.id, t.name + ' · v' + t.version]), d.templateId)}${field('Discount (%)', 'discount', d.discount, 'number', 'min="0" max="100" step="0.01"')}${field("Currency", 'currency', d.currency)}${customForm('document', d.custom)}</div><label>Customer${button('docCustomer', esc(d.customer?.name || "Choose a company..."), 'select-button')}</label><div class="section-head"><h3>Items (${d.items.length})</h3><div>${button('docCatalog', '+ From catalog')}${button('docItem', "+ Custom item")}</div></div><div class="item-list">${d.items.map((i, n) => `<div class="item" data-item-index="${n}"><label class="item-name">Item<input data-item="name" value="${esc(i.name)}"></label><label>Quantity<input data-item="qty" type="number" min="0" step="0.001" value="${i.qty}"></label><label>Unit<input data-item="unit" value="${esc(i.unit)}"></label><label>Unit price<input data-item="price" type="number" min="0" step="0.01" value="${i.price}"></label>${button('docRemoveItem:' + n, '×', 'icon')}${state.fields.some(f => f.scope === 'item' && !f.archived) ? `<div class="item-custom">${customForm('item', i.custom)}</div>` : ''}</div>`).join('')}</div><div class="document-total">Total <strong id="docTotal">${money(total(d), d.currency)}</strong></div>${area("Introductory text", 'intro', d.intro)}${area("Note", 'notes', d.notes)}<div class="form-actions">${button('docRules', "Use default text rules")}${button('docSavedText', "Paste saved text")}</div><details><summary>Source of automatic texts</summary><p>Default values: Settings → My data and default values. Manually changed texts take precedence.</p>${(d.ruleTrace || []).map(r => `<p>${esc(r.name)} → ${esc(r.target)}: ${esc(r.value)}</p>`).join('')}</details><div class="form-actions sticky-actions">${button('docSave', "Save draft", 'primary')}${button('docIssue', "Issue and save PDF", 'primary')}${button('docPreview', "Preview PDF")}${state.documents.some(x => x.id === d.id) ? button('docDelete', "Delete draft", 'danger') : ''}${button('closeModal', "Cancel")}</div></form>`, () => {
      $('#docForm').oninput = e => {
        const el = e.target,
          wrap = el.closest('[data-item-index]');
        if (wrap) {
          const item = d.items[+wrap.dataset.itemIndex];
          if (el.dataset.item) item[el.dataset.item] = ['qty', 'price'].includes(el.dataset.item) ? +el.value : el.value;else if (el.name.startsWith('custom_')) item.custom[el.name.slice(7)] = el.value;
        } else if (el.name.startsWith('custom_')) d.custom[el.name.slice(7)] = el.value;else if (el.name) {
          d[el.name] = el.name === 'discount' ? +el.value : el.value;
          if (['intro', 'notes'].includes(el.name)) (d.manualTexts ||= {})[el.name] = true;
        }
        setDirty(true);
        $('#docTotal').textContent = money(total(d), d.currency);
      };
      $('#docForm').onchange = $('#docForm').oninput;
    }, undefined, 'document-editor:' + d.id);
    setDirty(true);
  };
  on('docCustomer', () => {
    picker("Choose a company", state.companies.filter(c => !c.archived).map(c => ({
      id: c.id,
      label: c.name,
      detail: c.ico + ' · ' + (c.city || '')
    })), choice => {
      d.customer = clone(state.companies.find(c => c.id === choice.id));
      if (d.customer.defaultNotes && !d.manualTexts?.notes) d.notes = d.customer.defaultNotes;
      draw();
    });
  });
  on('docItem', () => {
    d.items.push({
      id: uid(),
      name: '',
      qty: 1,
      unit: state.settings.units[0] || 'pcs',
      price: 0,
      custom: customDefaults(state, 'item')
    });
    draw();
  });
  on('docCatalog', () => picker("Select an activity", state.activities.filter(a => !a.archived).map(a => ({
    id: a.id,
    label: a.name,
    detail: money(a.price) + ' / ' + a.unit
  })), choice => {
    const a = state.activities.find(a => a.id === choice.id);
    d.items.push({
      id: uid(),
      activityId: a.id,
      name: a.name,
      qty: 1,
      unit: a.unit,
      price: a.price,
      custom: customDefaults(state, 'item')
    });
    draw();
  }));
  on('docSavedText', () => picker("Paste saved text", state.texts.filter(t => !t.archived).map(t => ({
    id: t.id,
    label: t.name,
    detail: ''
  })), choice => {
    d.notes = choice.label;
    (d.manualTexts ||= {}).notes = true;
    draw();
  }));
  on('docRemoveItem', i => {
    d.items.splice(+i, 1);
    draw();
  });
  on('docRules', async () => {
    if (!(await confirmDialog("Reuse the rules? Manually entered introductory texts and notes can be replaced."))) return;
    d.manualTexts = {};
    d = textRules(d, state);
    draw();
  });
  const persist = async issue => {
    validateForm('#docForm');
    d.status = issue ? 'issued' : 'draft';
    try {
      await put('documents', d, originalRev);
      setDirty(false);
      closeModal();
    } catch (e) {
      d.status = 'draft';
      throw e;
    }
  };
  on('docSave', () => persist(false));
  on('docIssue', async () => {
    if (await confirmDialog("Issue a document " + d.number + " and save the invariant PDF?")) await persist(true);
  });
  on('docPreview', () => showPdf(d, true));
  on('docDelete', async () => {
    if (await confirmDialog("Delete this draft? Its number will remain reserved.")) {
      await save([{
        collection: 'documents',
        id: d.id,
        rev: originalRev,
        delete: true
      }]);
      setDirty(false);
      closeModal();
    }
  });
  draw();
}
on('newDoc', type => editDoc(textRules(newDocument(state, type), state)));
async function documentPdf(d, preview = false) {
  if (d.pdfHash && !preview) return loadAsset(d.pdfHash);
  if (d.status !== 'draft' && !preview) throw Error("Archive PDF is missing. Open the document and attach the certified document.");
  const t = d.templateSnapshot || state.templates.find(t => t.id === d.templateId);
  if (!t) throw Error("Choose a template.");
  return (await renderDocument(d, state, t, loadAsset)).bytes;
}
async function showPdf(d, preview = false, print = false) {
  const bytes = await documentPdf(d, preview);
  if (!print) {
    await downloadBytes(bytes, filename(d, state), 'application/pdf');
    return;
  }
  if (nativeClient) return bridge.call('print', {
    name: filename(d, state),
    base64: bytesBase64(bytes)
  });
  const overlay = document.createElement('section');
  overlay.className = 'print-overlay';
  overlay.innerHTML = `<header><button id="printClose">Close preview</button><button id="printDownload">Download PDF</button></header><iframe title="Invoice preview" src="${esc(new URL('print.html', base).href)}"></iframe>`;
  document.body.append(overlay);
  overlay.querySelector('#printClose').onclick = () => overlay.remove();
  overlay.querySelector('#printDownload').onclick = () => downloadBytes(bytes, filename(d, state), 'application/pdf');
  const frame = overlay.querySelector('iframe');
  await new Promise((resolve, reject) => {
    frame.onload = resolve;
    frame.onerror = () => reject(Error("The print preview could not be loaded. Try opening it again."));
  });
  await frame.contentWindow.renderPdf({
    name: filename(d, state),
    base64: bytesBase64(bytes),
    language: currentLanguage(),
    labels: {
      print: tr('Print'),
      preparing: tr('Preparing document…'),
      error: tr('The PDF could not be prepared for printing: ')
    },
    interfaceStyle: Object.fromEntries(['font-size', 'background', 'surface', 'text', 'sidebar', 'sidebar-text'].map(k => [k, getComputedStyle(document.documentElement).getPropertyValue('--ui-' + k)]))
  });
}
on('pdf', id => showPdf(state.documents.find(d => d.id === id)));
on('print', id => showPdf(state.documents.find(d => d.id === id), false, true));
function viewDoc(d) {
  const problems = checksFor(state).filter(c => c.documentId === d.id),
    events = state.audit.filter(a => a.recordId === d.id),
    payments = state.payments.filter(p => p.documentId === d.id);
  modal("Document " + d.number, `<div class="section-head"><div><p>${esc(d.customer?.name)} · ${dateLabel(d.date)}</p></div><strong>${money(total(d), d.currency)}</strong></div>${recordMeta('documents', d.id)}${statusPanel(d, state)}${problems.map(c => `<div class="notice">${esc(c.title)} · ${esc(c.status)} ${button('editCheck:' + c.id, "Open the check", 'small')}</div>`).join('')}${table(["Item", "Amount", 'Unit', "Price", "Total"], d.items.map(i => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${esc(i.unit)}</td><td>${money(i.price, d.currency)}</td><td>${money(i.qty * i.price, d.currency)}</td></tr>`))}<p>${esc(d.notes)}</p><div class="form-actions">${button('pdf:' + d.id, 'PDF', 'primary')}${button('print:' + d.id, 'Print')}${canEdit() ? button('duplicateDoc:' + d.id, "New follow-up document") : ''}${canEdit() && d.type === 'invoice' && d.status === 'issued' ? button('addPayment:' + d.id, "Enter the payment") : ''}${canEdit() && d.type === 'quote' ? button('quoteToInvoice:' + d.id, "Create an invoice from a quote") : ''}${canEdit() ? button('attachPdf:' + d.id, "Connect / select PDF") : ''}${canEdit() && d.imported ? button('correctEvidence:' + d.id, "Correct the imported data") : ''}${canEdit() ? button('cancelDoc:' + d.id, "Cancel with record", 'danger') : ''}${button('closeModal', "Back")}</div><h3>Payments</h3>${table(['Date', "Amount", "Note", ''], payments.map(p => `<tr><td>${p.date ? dateLabel(p.date) : "Date unknown"}</td><td>${money(p.amount, d.currency)}${p.voided ? " · cancelled" : ''}</td><td>${esc(p.note)}</td><td>${canEdit() && !p.voided ? button('voidPayment:' + p.id, "Cancel payment", 'small') : ''}</td></tr>`))}<details><summary>Change history and source data</summary>${events.map(a => `<p>${esc(a.at)} · ${esc(a.actor || 'Import')} · ${esc(a.action)} · ${esc(a.reason || a.message || '')}</p><details><summary>Original and new values</summary><pre>${esc(JSON.stringify({
    before: a.before,
    after: a.after
  }, null, 2))}</pre></details>`).join('')}<pre>${esc(JSON.stringify({
    custom: d.custom,
    sourceWorkbook: d.sourceWorkbook,
    originalFilename: d.originalFilename
  }, null, 2))}</pre></details>${(d.archiveVariants || []).length ? `<details><summary>Previous PDF</summary>${d.archiveVariants.map(v => button('variant:' + v.hash, esc(v.name || v.source || "Original PDF"))).join('')}</details>` : ''}`);
}
on('openDoc', id => {
  const d = state.documents.find(d => d.id === id);
  if (d.status === 'draft' && canEdit()) editDoc(d);else viewDoc(d);
});
on('variant', async hash => downloadBytes(await loadAsset(hash), 'Original-source.pdf', 'application/pdf'));
on('duplicateDoc', id => {
  const old = state.documents.find(d => d.id === id),
    d = newDocument(state, old.type);
  Object.assign(d, {
    customer: clone(old.customer),
    items: clone(old.items),
    custom: clone(old.custom || {}),
    discount: old.discount,
    notes: old.notes,
    intro: old.intro,
    relatedDocumentId: old.id
  });
  editDoc(d);
});
on('quoteToInvoice', id => {
  const old = state.documents.find(d => d.id === id),
    d = newDocument(state, 'invoice');
  Object.assign(d, {
    customer: clone(old.customer),
    items: clone(old.items),
    custom: clone(old.custom || {}),
    discount: old.discount,
    notes: old.notes,
    intro: old.intro,
    relatedDocumentId: old.id
  });
  editDoc(d);
});
on('pdfWorklogs', async () => {
  const ids = [...document.querySelectorAll('#content tr[data-record-id]:not([hidden])')].map(r => r.dataset.recordId),
    rows = ids.map(id => state.worklogs.find(w => w.id === id)).filter(w => w && !w.archived);
  await downloadBytes(await reportPdf("Statement of work", worklogText(rows, state), state, loadAsset), 'Work-log-' + today() + '.pdf', 'application/pdf');
});
on('pdfTexts', async () => {
  const ids = [...document.querySelectorAll('#content tr[data-record-id]:not([hidden])')].map(r => r.dataset.recordId),
    rows = ids.map(id => state.texts.find(t => t.id === id)).filter(t => t && !t.archived);
  await downloadBytes(await reportPdf("Saved texts", rows.map(t => t.name).join('\n\n'), state, loadAsset), 'Texty-' + today() + '.pdf', 'application/pdf');
});
on('addPayment', id => {
  const d = state.documents.find(d => d.id === id);
  formDialog("Enter the payment", field("Payment date", 'date', today(), 'date') + field("Amount", 'amount', Math.max(0, balance(d, state)), 'number', 'min="0.01" step="0.01"') + area("Note", 'note', ''), v => put('payments', {
    id: uid(),
    documentId: id,
    date: v.date,
    amount: +v.amount,
    note: v.note
  }));
});
on('voidPayment', id => {
  const p = state.payments.find(p => p.id === id);
  formDialog("Cancel payment record", area("Reason", 'reason', ''), v => {
    if (!v.reason.trim()) throw Error("Fill in the reason.");
    return put('payments', {
      ...p,
      voided: true,
      voidReason: v.reason
    });
  });
});
on('attachPdf', async id => {
  const file = await pickFile('.pdf');
  if (!file) return;
  const result = await upload(file);
  formDialog("Connect verified PDF", area("Reason / confirmation of correct assignment", 'reason', ''), async v => {
    adopt(await api('fix', {
      id,
      rev: recRev('documents', id),
      kind: 'attach',
      hash: result.hash,
      reason: v.reason
    }));
  });
});
on('correctEvidence', id => {
  const d = state.documents.find(d => d.id === id);
  formDialog('Correct imported record', `<p>The original PDF remains. Verify the data according to the background.</p>${button('print:' + id, "Open the original PDF")}<div class="form-grid">${field("Number", 'number', d.number)}${field("Issue date", 'date', d.date, 'date')}${field("Due date", 'due', d.due, 'date')}${d.summaryOnly ? field("Recorded amount", 'importedTotal', d.importedTotal, 'number', 'step="0.01"') : ''}</div>${area("Note", 'notes', d.notes)}${area("Reason for repair", 'reason', '')}`, async v => {
    const data = {
      ...v
    };
    delete data.reason;
    if ('importedTotal' in data) data.importedTotal = +data.importedTotal;
    adopt(await api('fix', {
      id,
      rev: recRev('documents', id),
      kind: 'evidence',
      values: data,
      reason: v.reason
    }));
  });
});
on('cancelDoc', id => formDialog("Cancel document with history preservation", area("Reason", 'reason', ''), async v => adopt(await api('fix', {
  id,
  rev: recRev('documents', id),
  kind: 'cancel',
  reason: v.reason
}))));
on('editField', id => {
  const f = clone(state.fields.find(f => f.id === id) || {
      id: uid(),
      scope: 'document',
      type: 'text'
    }),
    rev = recRev('fields', f.id);
  formDialog("Custom field", field("Name", 'name', f.name || '') + select("Belongs to", 'scope', [['document', "Document"], ['company', "Company"], ['supplier', 'Supplier'], ['item', "Document items"]], f.scope) + select('Type', 'type', [['text', 'Text'], ['long', "Long text"], ['number', "Number"], ['money', "Amount"], ['date', 'Date'], ['boolean', "Yes/no"], ['choice', "Selection of values"]], f.type) + field("Default value", 'default', f.default || '') + area("Selection values ​​(each per line)", 'options', (f.options || []).join('\n')) + select("Mandatory on display", 'required', [['false', "No"], ['true', "Yes"]], String(!!f.required)) + select("State", 'archived', [['false', "Active"], ['true', "Archived"]], String(!!f.archived)), v => {
    if (!v.name.trim()) throw Error("Fill in the name.");
    return put('fields', {
      ...f,
      ...v,
      options: v.options.split('\n').filter(Boolean),
      required: v.required === 'true',
      archived: v.archived === 'true'
    }, rev);
  });
});
on('editRule', id => {
  const r = clone(state.rules.find(r => r.id === id) || {
      id: uid(),
      kind: 'text',
      enabled: true,
      priority: 10,
      target: 'notes'
    }),
    rev = recRev('rules', r.id);
  formDialog('Rule', field("Name", 'name', r.name || '') + select('Type', 'kind', [['text', "Automatic text"], ['check', "Document check"]], r.kind) + select('Enabled', 'enabled', [['true', "Yes"], ['false', "No"]], String(r.enabled)) + field("Priority (lower used first)", 'priority', r.priority, 'number') + select("When the data", 'conditionField', [['', "Always"], ...fieldOptions()], r.condition?.field || '') + select("Condition", 'conditionOp', [['eq', 'Equals'], ['neq', "Does not equal"], ['empty', "It is empty"], ['notempty', "It is filled"], ['contains', 'Contains'], ['gt', "It is greater than"]], r.condition?.op || 'eq') + field('Value', 'conditionValue', r.condition?.value || '') + select("Paste into", 'target', [['intro', "Introductory text"], ['notes', "Comment"]], r.target) + area("Text (you insert the variable with the button below)", 'text', r.text || '') + button('ruleInsertField', "Insert the data into the text") + select("Method of insertion", 'append', [['false', "Replace default text"], ['true', "Append to text"]], String(!!r.append)) + select("Severity of control", 'severity', [['warning', "Notice"], ['error', "Blocks issuing"]], r.severity || 'warning'), v => {
    if (!v.name.trim()) throw Error("Fill in the name.");
    const runs = [];
    let cursor = 0;
    for (const m of v.text.matchAll(/\{\{([^}]+)\}\}/g)) {
      if (m.index > cursor) runs.push({
        text: v.text.slice(cursor, m.index)
      });
      if (!fieldsFor(state)[m[1]]) throw Error("Unknown field: " + m[1]);
      runs.push({
        field: m[1]
      });
      cursor = m.index + m[0].length;
    }
    if (cursor < v.text.length) runs.push({
      text: v.text.slice(cursor)
    });
    return put('rules', {
      id: r.id,
      name: v.name,
      kind: v.kind,
      enabled: v.enabled === 'true',
      priority: +v.priority,
      target: v.target,
      text: v.text,
      runs,
      append: v.append === 'true',
      severity: v.severity,
      condition: {
        field: v.conditionField,
        op: v.conditionOp,
        value: v.conditionValue
      }
    }, rev);
  });
  on('ruleInsertField', () => {
    const el = document.createElement('select');
    el.innerHTML = "<option>Select data…</option>" + fieldOptions().map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    $('[name="text"]').after(el);
    el.onchange = () => {
      const input = $('[name="text"]');
      input.value += '{{' + el.value + '}}';
      el.remove();
    };
  });
});
on('editCheck', id => {
  const c = clone(checksFor(state).find(c => c.id === id) || {
      id: uid(),
      status: 'open',
      severity: 'warning'
    }),
    rev = recRev('checks', c.id);
  formDialog("Control case", field("Description of the problem", 'title', c.title || '') + select("Document", 'documentId', [['', "General task"], ...state.documents.map(d => [d.id, d.number + ' · ' + d.customer?.name])], c.documentId) + select("State", 'status', [['open', "OPEN"], ['reviewing', "It is being checked"], ['resolved', "Solved"], ['exception', "Exception"], ['reopened', "Reopened"]], c.status) + select("Severity", 'severity', [['warning', "Notice"], ['error', "Error"]], c.severity) + area("Justification / result of the inspection", 'reason', c.reason || '') + area("Internal note", 'note', c.note || '') + (c.documentId ? button('print:' + c.documentId, "Display PDF next to the data") : ''), v => {
    if (c.code === 'missing-pdf' && ['resolved', 'exception'].includes(v.status) && !state.documents.find(d => d.id === c.documentId)?.pdfHash) throw Error("First connect the missing PDF.");
    return put('checks', {
      ...c,
      ...v
    }, rev);
  });
});
on('editTemplate', id => openEditor(state.templates.find(t => t.id === id), state, t => put('templates', t)));
on('templateNew', () => {
  const t = clone(state.templates[0]);
  t.id = uid();
  t.family = uid();
  t.version = 1;
  t.name = "My new template";
  t.status = 'draft';
  openEditor(t, state, t => put('templates', t));
});
on('defaultTemplate', id => save([{
  collection: 'config',
  rev: configRevision,
  value: {
    supplier: state.supplier,
    settings: {
      ...state.settings,
      templateId: id
    }
  }
}]));
on('archiveTemplate', id => put('templates', {
  ...state.templates.find(t => t.id === id),
  status: 'archived'
}));
on('exportTemplate', id => {
  const t = state.templates.find(t => t.id === id);
  modal("The contents of the template export", `<p>The export contains the layout, custom fields, used media and the following static texts. Check that there is no data among them that you do not want to share.</p><pre>${esc(t.nodes.flatMap(n => (n.runs || []).filter(r => !r.field).map(r => r.text)).join('\n'))}</pre><p>${esc(state.media.filter(m => JSON.stringify(t).includes(m.id)).map(m => m.name).join(', ') || "No media")}</p>${button('confirmTemplateExport', "Download the template", 'primary')}`);
  on('confirmTemplateExport', async () => {
    await exportTemplate(t, state);
    closeModal();
  });
});
on('importTemplate', async () => {
  const f = await pickFile(".fakturocel-template");
  if (!f) return;
  const importText = await f.text();
  let result;
  try {
    result = await api('import/template', {
      text: importText
    });
  } catch (e) {
    if (e.status !== 422) throw e;
    const password = await requestPassword("Enter the recovery key from PDF or the original password of this template.");
    if (password === null) return;
    result = await api('import/template', {
      text: importText,
      password
    });
  }
  const {
    bundle
  } = result;
  if (bundle.format !== 'FakturocelTemplate' || bundle.version !== 1 || !bundle.template) throw Error("Invalid template.");
  if (!(await confirmDialog("Import a template including its fields and media?"))) return;
  const replacements = {},
    ops = [];
  for (const field of bundle.fields || []) {
    const id = uid();
    replacements[field.id] = id;
    ops.push({
      collection: 'fields',
      id,
      rev: 0,
      value: {
        ...field,
        id
      }
    });
  }
  for (const m of bundle.media || []) {
    const a = bundle.blobs?.[m.hash];
    if (!a) throw Error("Template media is missing.");
    const r = await api('upload', a);
    const id = uid();
    replacements[m.id] = id;
    ops.push({
      collection: 'media',
      id,
      rev: 0,
      value: {
        ...m,
        id,
        hash: r.hash
      }
    });
  }
  let text = JSON.stringify(bundle.template);
  for (const [old, id] of Object.entries(replacements)) text = text.replaceAll(old, id);
  const t = JSON.parse(text);
  t.id = uid();
  t.family = uid();
  t.status = 'draft';
  t.version = 1;
  ops.push({
    collection: 'templates',
    id: t.id,
    rev: 0,
    value: t
  });
  await save(ops);
});
async function convertSvg(file) {
  const text = await file.text(),
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror,script,foreignObject,iframe,object,embed') || [...doc.querySelectorAll('*')].some(e => [...e.attributes].some(a => /^on/i.test(a.name) || /href|src/i.test(a.name) && !a.value.startsWith('#') || /url\s*\(/i.test(a.value)))) throw Error("SVG contains external or active content. Use PNG or pure SVG.");
  const blob = new Blob([new XMLSerializer().serializeToString(doc)], {
      type: 'image/svg+xml'
    }),
    url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((r, j) => {
      img.onload = r;
      img.onerror = j;
      img.src = url;
    });
    const canvas = document.createElement('canvas'),
      ratio = Math.min(1, 2500 / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * ratio));
    canvas.height = Math.max(1, Math.round(img.height * ratio));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return new File([await new Promise(r => canvas.toBlob(r, 'image/png'))], file.name.replace(/\.svg$/i, '.png'), {
      type: 'image/png'
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
on('addMedia', async () => {
  let file = await pickFile('.png,.jpg,.jpeg,.svg,.ttf,.otf');
  if (!file) return;
  if (/\.svg$/i.test(file.name)) file = await convertSvg(file);
  const result = await upload(file);
  await put('media', {
    id: uid(),
    ...result,
    archived: false
  });
});
on('editMedia', id => {
  const m = state.media.find(m => m.id === id);
  formDialog("Medium", field("Name", 'name', m.name) + select("State", 'archived', [['false', "Active"], ['true', "Archived"]], String(!!m.archived)), v => put('media', {
    ...m,
    name: v.name,
    archived: v.archived === 'true'
  }));
});
on('calculatorOpen', showCalculator);
on('calculatorSettings', () => {
  const rev = configRevision;
  openCalculatorSettings(state, value => save([{
    collection: 'config',
    rev,
    value: {
      supplier: state.supplier,
      settings: {
        ...state.settings,
        calculators: value
      }
    }
  }]));
});
on('appearance', () => {
  const rev = configRevision;
  openAppearance(state, value => save([{
    collection: 'config',
    rev,
    value: {
      supplier: state.supplier,
      settings: {
        ...state.settings,
        appearance: value
      }
    }
  }]), async () => {
    let file = await pickFile('.png,.jpg,.jpeg,.svg');
    if (!file) return null;
    if (/\.svg$/i.test(file.name)) file = await convertSvg(file);
    const result = await upload(file);
    const media = {
      id: uid(),
      ...result,
      archived: false
    };
    await put('media', media);
    return media;
  }, logoUrl);
});
on('editSettings', () => {
  const current = configRevision;
  formDialog("My data and settings", `<h3>Supplier</h3><div class="form-grid">${[["Title / name", 'name'], ['Street', 'street'], ["City", 'city'], ["Postal code", 'zip'], ["ID number", 'ico'], ["Tax ID", 'dic'], ["Account", 'account'], ["Bank code", 'bank'], ['IBAN', 'iban'], ['SWIFT', 'swift'], ['Phone', 'phone'], ['E-mail', 'email'], ['Web', 'web']].map(([l, k]) => field(l, 'supplier_' + k, state.supplier[k] || '')).join('')}${customForm('supplier', state.supplier.custom)}</div>${area("Footer", 'supplier_footer', state.supplier.footer)}<h3>Default values</h3><div class="form-grid">${field("Payment term (days)", 'dueDays', state.settings.dueDays, 'number', 'min="1" max="365"')}${field("Currency", 'currency', state.settings.currency)}${field("Default payment", 'payment', state.settings.payment)}${field("Invoice prefix ({YYYY} = year)", 'invoicePrefix', state.settings.invoicePrefix)}${field("Quote prefix", 'quotePrefix', state.settings.quotePrefix)}${field("Number of sequence digits", 'digits', state.settings.digits, 'number', 'min="1" max="12"')}${field("Number of backups kept (0 = all)", 'retention', state.settings.retention, 'number', 'min="0"')}</div>${field("PDF filename: {number} {company} {date} {year} {month} {day}", 'filename', state.settings.filename)}${area("Payment methods — each on a line", 'paymentMethods', state.settings.paymentMethods.join('\n'))}${area("Units — each on a line", 'units', state.settings.units.join('\n'))}${area("Hourly rates — name = amount, each on a line", 'rates', state.settings.rates.map(r => r.name + ' = ' + r.value).join('\n'))}${area("Default introduction", 'intro', state.settings.intro)}${area("Default note", 'notes', state.settings.notes)}`, v => {
    const supplier = {
        ...state.supplier
      },
      settings = {
        ...state.settings
      };
    for (const [k, value] of Object.entries(v)) {
      if (k.startsWith('supplier_')) supplier[k.slice(9)] = value;else if (!k.startsWith('custom_')) settings[k] = value;
    }
    supplier.custom = customValues(v);
    for (const k of ['dueDays', 'digits', 'retention']) settings[k] = +v[k];
    settings.paymentMethods = v.paymentMethods.split('\n').filter(Boolean);
    settings.units = v.units.split('\n').filter(Boolean);
    settings.rates = v.rates.split('\n').filter(Boolean).map(l => {
      const i = l.lastIndexOf('=');
      const value = Number(l.slice(i + 1).trim().replace(',', '.'));
      if (i < 1 || !Number.isFinite(value) || value < 0) throw Error("Enter the rates in the format Name = amount.");
      return {
        name: l.slice(0, i).trim(),
        value
      };
    });
    return save([{
      collection: 'config',
      rev: current,
      value: {
        supplier,
        settings
      }
    }]);
  });
});
on('backup', async () => {
  const r = await api('backup', {});
  session.lastBackup = r;
  render();
  if (!r.backup) throw Error(r.error);
  toast("Backup created.");
});
on('downloadBackup', () => downloadBackup('backup', "Fakturocel-" + today() + ".fakturocel"));
on('backupFolder', () => nativeClient ? api('folder', {}).then(reload) : formDialog("Automatic backups folder", field("A subfolder in /share", 'folder', session.backupFolder), async v => {
  const r = await api('folder', {
    folder: v.folder
  });
  await reload();
  session.lastBackup = r;
  render();
  if (!r.backup) throw Error(r.error);
}));
on('restore', async () => {
  const f = await pickFile(".fakturocel");
  if (!f) return;
  const text = await f.text();
  let password, p;
  try {
    p = await api('restore/preview', {
      text
    });
  } catch (e) {
    if (e.status !== 422) throw e;
    password = await requestPassword("Enter the recovery key from PDF or the original password of this backup.");
    if (password === null) return;
    p = await api('restore/preview', {
      text,
      password
    });
  }
  if (!(await confirmDialog(`Restore ${p.documents} documents, ${p.companies} companies a ${p.templates} templates? Current data is first backed up and then replaced.`))) return;
  adopt(await api('restore', {
    text,
    password,
    revision
  }));
  password = '';
  toast("Backup has been restored.");
});
on('excel', async () => {
  const bytes = await exportExcel();
  await downloadBytes(bytes, "Fakturocel-" + today() + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
on('roles', () => {
  const roles = clone(session.roles);
  formDialog("Access to data", `<p>Add a new user using their Home Assistant ID. They will see their ID when they try to open the app.</p>${Object.entries(roles).map(([id, r]) => `<div class="role-row"><strong>${esc(r.name)} <small>${esc(id)}</small></strong>${select('Role', 'role_' + id, [['owner', 'Owner'], ['editor', "Document manager"], ['reader', "Reader"], ['remove', 'Remove']], r.role)}</div>`).join('')}${field("New user ID", 'newId', '')}${field("Display name", 'newName', '')}${select("New user role", 'newRole', [['reader', "Reader"], ['editor', "Document manager"], ['owner', 'Owner']], 'reader')}`, async v => {
    for (const [id, r] of Object.entries(roles)) {
      if (v['role_' + id] === 'remove') delete roles[id];else r.role = v['role_' + id];
    }
    if (v.newId.trim()) roles[v.newId.trim()] = {
      name: v.newName || v.newId,
      role: v.newRole
    };
    await api('roles', {
      roles
    });
    await reload();
  });
});
on('wipe', async () => {
  const prepared = await api('wipe/prepare', {
    revision
  });
  let downloaded = false,
    recoveryDownloaded = !session.security?.encrypted,
    verifiedText = '';
  modal("Backup and complete data wipe", `<div class="notice">When finished, the application will be empty. Other open devices will not be able to return the old data by normal saving.</div><ol><li>Download the current backup to your device.</li><li>Select the file you just downloaded. The application will verify that it contains current data.</li><li>Type <strong>DELETE DATA</strong> and confirm deletion.</li></ol><p>Backup size: ${(prepared.bytes / 1024 / 1024).toFixed(2)} MB</p>${button('wipeDownload', "1. Compulsory download backup", 'primary')}${session.security?.encrypted ? "<p>Before deleting it is mandatory to download PDF with key as well. Without it, the backup cannot be restored.</p>" + button('wipeRecovery', "Must download PDF with key") : ''}<label>2. Select the downloaded file .fakturocel<input type="file" id="wipeFile" accept=".fakturocel" disabled></label><p id="wipeVerified" role="status"></p>${field("3. Confirmation text", 'wipeConfirm', '', 'text', 'autocomplete="off"')}<details><summary>Files on the server to delete (${prepared.files.length})</summary><ul>${prepared.files.map(p => `<li>${esc(p)}</li>`).join('')}</ul></details><p class="muted">This step does not delete backups of the entire Home Assistant and other copies outside of the specified storage. Another device's browser may have old content open until the page is refreshed.</p><button type="button" data-action="wipeFinish" id="wipeFinish" class="danger" disabled>Clear add-on data</button>`);
  const update = () => {
    $('#wipeFinish').disabled = !verifiedText || $('[name="wipeConfirm"]').value !== "DELETE DATA";
  };
  $('[name="wipeConfirm"]').oninput = update;
  on('wipeDownload', async () => {
    await downloadBackup('wipe/download?ticket=' + prepared.ticket, "Fakturocel-before-deletion.fakturocel");
    downloaded = true;
    $('#wipeFile').disabled = !recoveryDownloaded;
    toast("Backup sent for download. Now select the saved file.");
  });
  on('wipeRecovery', async () => {
    await downloadRecovery(prepared.ticket);
    recoveryDownloaded = true;
    $('#wipeFile').disabled = !downloaded;
    toast("PDF with key sent for download. Store it with your backup in a safe place.");
  });
  $('#wipeFile').onchange = e => job(async () => {
    verifiedText = '';
    update();
    const file = e.target.files[0];
    if (!downloaded || !file) return;
    const text = await file.text();
    if ((await hashBytes(new TextEncoder().encode(text))) !== prepared.sha256) throw Error("The selected file is not the current backup that was just downloaded.");
    await api('wipe/verify', {
      ticket: prepared.ticket,
      text
    });
    verifiedText = text;
    $('#wipeVerified').textContent = "Backup verified. Contains current data.";
    update();
  });
  on('wipeFinish', async () => {
    if (!verifiedText) throw Error("First download and verify the backup.");
    await api('wipe/finish', {
      ticket: prepared.ticket,
      backupText: verifiedText,
      confirm: $('[name="wipeConfirm"]').value
    });
    try {
      for (const storage of [localStorage, sessionStorage]) for (const key of Object.keys(storage)) if (key.startsWith("Fakturocel")) storage.removeItem(key);
    } catch {}
    setDirty(false);
    closeModal();
    state = null;
    await reload();
    route = 'overview';
    render();
    toast("Add-on data has been deleted. The application is empty.");
  });
});
on('shortcuts', () => modal("Keyboard shortcuts", `<p>All forms can be accessed with the Tab key and the buttons can be confirmed with Enter or the spacebar.</p>${table(['Shortcut', 'Action'], [['Ctrl + N', "New invoice"], ['Ctrl + S', "Save the currently open form or draft"], ['Ctrl + Z / Ctrl + Y', "Back / again in the template editor"], ['Alt + C', "Open or hide the calculator"], ['Alt + ←', "Back or close the window"], ['/', "Go to search"], ["Alt + 1 to 9", "Go to the main parts of the application"], ['? or F1', "This help"]].map(([key, value]) => `<tr><td><kbd>${esc(key)}</kbd></td><td>${esc(value)}</td></tr>`))}${button('closeModal', "Back", 'primary')}`));
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || $('#messageOverlay') || e.target.closest('#calculator-root')) return;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    const target = $('[data-action="docSave"], [data-action="formSave"], [data-action="edSave"], [data-action="appearanceSave"]');
    if (target) {
      e.preventDefault();
      target.click();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !typing) {
    e.preventDefault();
    if (canEdit() && !$('#modal').innerHTML) actions.get('newDoc')?.('invoice');
    return;
  }
  if (e.altKey && e.key === 'ArrowLeft' && $('#modal').innerHTML) {
    e.preventDefault();
    void closeModal();
    return;
  }
  if (e.altKey && /^Digit[1-9]$/.test(e.code) && !$('#modal').innerHTML) {
    const item = navigation[Number(e.code.slice(-1)) - 1];
    if (item) {
      e.preventDefault();
      actions.get('nav')?.(item[0]);
    }
    return;
  }
  if ((e.key === 'F1' || e.key === '?') && !typing) {
    e.preventDefault();
    actions.get('shortcuts')?.();
    return;
  }
  if (e.key === '/' && !typing && !$('#modal').innerHTML) {
    const input = $('#search');
    if (input) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  }
});
async function init() {
  try {
    setLanguage(storedLanguage());
    applyAppearance();
    $('#app').innerHTML = "<main class=\"recovery\"><h1>Loading Fakturocel...</h1><p>I am loading saved data.</p></main>";
    await reload();
  } catch (e) {
    showStartupProblem(e);
  }
  refreshTimer = setInterval(async () => {
    if (document.hidden || nativeClient && $('#modal').innerHTML) return;
    try {
      const r = await api('meta');
      if (nativeClient) {
        Object.assign(session, r);
        if (r.revision !== revision) adopt(r);else {
          const strip = document.querySelector('#clientStatus');
          if (strip) strip.innerHTML = clientBanner();
        }
      } else if (r.revision !== revision) {
        $('#conflict').hidden = false;
      }
    } catch {}
  }, 15000);
}
async function showStartupProblem(e) {
  $('#app').innerHTML = `<main class="recovery"><h1>The application failed to load</h1><p>${esc(e.message)}</p>${button('reload', 'Try again')}</main>`;
  if (e.status !== 428) await showError(e, "The application failed to load");
}
init();
