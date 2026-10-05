import { esc } from './escape.js';
import { tr } from './i18n.js';

export const sections = [
  { id: 'overview', label: 'Overview', icon: 'overview', routes: [['overview', 'Overview']], description: 'Income, payments, and outstanding invoices at a glance.' },
  { id: 'documents', label: 'Documents', icon: 'documents', routes: [['invoice', 'Invoices'], ['quote', 'Quotes'], ['checks', 'Review queue'], ['worklogs', 'Work logs']], description: 'Create, track, review, and print your documents.' },
  { id: 'companies', label: 'Companies', icon: 'companies', routes: [['companies', 'Companies']], description: 'Customers and their billing details in one place.' },
  { id: 'catalog', label: 'Catalog', icon: 'catalog', routes: [['activities', 'Activities'], ['texts', 'Saved texts']], description: 'Reusable items, prices, and text for your documents.' },
  { id: 'design', label: 'Invoice design', icon: 'design', owner: true, routes: [['templates', 'Document templates'], ['fields', 'Custom fields'], ['rules', 'Texts and rules'], ['media', 'Media library']], description: 'Manage invoice layouts, variable fields, images, and fonts.' },
  { id: 'settings', label: 'Settings', icon: 'settings', routes: [['settings', 'Settings']], description: 'Your business, appearance, backups, and access.' }
];
export const settingsTabs = [
  ['general', 'General'], ['appearance', 'Appearance'], ['backups', 'Backups and encryption'],
  ['security', 'Security and access'], ['devices', 'Connections'], ['calculators', 'Calculator']
];
export const backupTabs = [['local', 'Backup and export'], ['cloud', 'Google Drive'], ['restore', 'Restore and reset']];
export const sectionFor = route => sections.find(s => s.routes.some(([id]) => id === route)) || sections[0];
export const routeLabel = route => sectionFor(route).routes.find(([id]) => id === route)?.[1] || 'Overview';
const paths = {
  overview: '<path d="M3 11 12 3l9 8v10h-6v-7H9v7H3z"/>',
  documents: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"/>',
  companies: '<path d="M3 21V7h11v14M14 11h7v10M1 21h22M6 10h2m3 0h1M6 14h2m3 0h1M6 18h2m9-3h1m-1 3h1"/>',
  catalog: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  design: '<path d="M4 3h12v18H4zM8 7h4M8 11h4M8 15h2M15 15l5-5 2 2-5 5-3 1z"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>'
};
export const navIcon = name => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.settings}</svg>`;

export function sidebarNavigation(route, owner) {
  const current = sectionFor(route).id;
  return sections.filter(s => owner || !s.owner).map(s => {
    const action = s.routes.length === 1 ? 'nav:' + s.routes[0][0] : 'section:' + s.id;
    return `<button type="button" data-action="${action}" data-section="${s.id}" class="sidebar-item${s.id === current ? ' active' : ''}" ${s.id === current ? 'aria-current="page"' : ''}>${navIcon(s.icon)}<span>${esc(s.label)}</span></button>`;
  }).join('');
}

export function tabs(items, active, action, label, secondary = false) {
  if (items.length < 2) return '';
  return `<nav class="section-tabs${secondary ? ' secondary-tabs' : ''}" aria-label="${esc(label)}" data-section-tabs>${items.map(([id, text]) => `<button type="button" data-action="${action}:${id}" class="section-tab${active === id ? ' active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${esc(text)}</button>`).join('')}</nav>`;
}

export const settingDestinations = [
  { tab: 'general', title: 'Business details', description: 'Supplier, bank account, invoice numbering, payment terms, and language.' },
  { tab: 'appearance', title: 'Appearance and readability', description: 'Theme, colors, text size, scale, and application logo.', owner: true },
  { tab: 'backups', title: 'Backup and export', description: 'Local backup folder, ZIP archives, and readable Excel downloads.' },
  { tab: 'backups', anchor: 'backupEncryptionPanel', title: 'Backup encryption', description: 'Turn encryption on or off for /share, downloaded ZIP files, and Google Drive.', owner: true, server: true },
  { tab: 'backups', backup: 'cloud', title: 'Google Drive', description: 'Automatic cloud backups, connection, schedule, and retention.', owner: true, server: true },
  { tab: 'backups', backup: 'restore', title: 'Restore and reset', description: 'Restore ZIP or Excel, recover from Google Drive, or delete application data.', owner: true },
  { tab: 'security', title: 'Security and access', description: 'Access PIN, recovery key, private storage protection, and user permissions.' },
  { tab: 'devices', title: 'Connections', description: 'Pair a phone or computer with Home Assistant for optional synchronization.', owner: true },
  { tab: 'calculators', title: 'Calculator', description: 'Scientific, 3D printing, custom formulas, and calculator order.' }
];
export const visibleDestinations = (owner, native) => settingDestinations.filter(d => (owner || !d.owner) && (!native || !d.server));
export function settingsSearchResults(query, owner, native) {
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = visibleDestinations(owner, native).filter(d => words.every(word => normalize([d.title, d.description, tr(d.title), tr(d.description)].join(' ')).includes(word)));
  return matches.map(d => `<button type="button" class="settings-result" data-action="settingJump:${settingDestinations.indexOf(d)}"><strong>${esc(tr(d.title))}</strong><span>${esc(tr(d.description))}</span><span class="result-arrow" aria-hidden="true">→</span></button>`).join('') || `<p class="empty" role="status">${esc(tr('No matching setting. Try backup, encryption, PIN, or appearance.'))}</p>`;
}
