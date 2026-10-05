import { button, esc, select } from './ui.js';
import { session } from './api.js';
import { languages, tr } from './i18n.js';
import { appearanceValue } from './appearance-model.js';
import { deviceCard } from './device-ui.js';
import { googleDriveCard } from './google-drive-ui.js';
import { clientCard } from './client-ui.js';
import { securityCard } from './security-ui.js';
import { backupEncryptionPanel } from './backup-ui.js';
import { backupTabs, tabs } from './navigation.js';

const intro = (title, text, action = '') => `<div class="settings-heading"><div><h2>${title}</h2><p>${text}</p></div>${action}</div>`;
const details = rows => `<dl class="settings-details">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd data-no-translate>${esc(value === '' || value == null ? '—' : value)}</dd></div>`).join('')}</dl>`;

export function settingsPage(state, { tab, backupTab, owner, native }) {
  if (tab === 'general') return `${intro('General settings', 'Start with your business details and the defaults used for new documents.')}
    <div class="settings-grid"><section class="card"><div class="section-head"><h3>Business details</h3>${owner ? button('editSettings', 'Edit business details') : ''}</div>
      ${details([['Supplier', state.supplier.name || tr('Not configured')], ['ID number', state.supplier.ico], ['E-mail', state.supplier.email]])}
      <p class="muted">Address, bank details, and legal footer used on your invoices.</p></section>
    <section class="card"><div class="section-head"><h3>Invoice defaults</h3>${owner ? button('editSettings:defaults', 'Edit invoice defaults') : ''}</div>
      ${details([['Currency', state.settings.currency], ['Payment term (days)', state.settings.dueDays], ['Invoice prefix', state.settings.invoicePrefix]])}
      <p class="muted">Numbering, payment methods, units, filenames, and default texts.</p></section></div>
    <section class="card settings-language"><div><h3>Language</h3><p class="muted">The selected interface language is stored with the application data.</p></div>${owner ? select('Interface language', 'appLanguage', languages, state.settings.language || 'en') : `<strong>${state.settings.language === 'cs' ? languages[1][1] : 'English'}</strong>`}</section>
    <div class="settings-shortcuts"><span>Frequently used</span>${button('settingsTab:backups', 'Backups and encryption →')}${owner ? button('settingsTab:appearance', 'Appearance and readability →') : ''}${button('settingsTab:security', 'Access PIN and recovery key →')}</div>`;

  if (tab === 'appearance') {
    const a = appearanceValue(state.settings.appearance);
    return `${intro('Appearance and readability', 'Adjust the workspace to your screen and eyesight.', owner ? button('appearance', 'Set appearance', 'primary') : '')}
      <section class="card"><div class="settings-grid"><div><h3>Current appearance</h3>${details([['Environment theme', tr({ light: 'Light', dark: 'Dark', system: 'By device', custom: 'Custom colors' }[a.theme])], ['Interface scale', a.scale + ' %'], ['Main text (px)', a.fontSize], ['Additional texts (px)', a.smallTextSize]])}</div>
      <div class="workspace-preview"><div class="preview-sidebar"></div><div><strong>${esc(a.brandName)}</strong><span class="preview-line"></span><span class="preview-line short"></span><div class="status-badges"><span class="badge paid">Paid</span><span class="badge overdue">Overdue</span></div></div></div></div>
      <p class="muted">Change the theme, colors, spacing, fonts, and logo. A readability check helps keep custom colors accessible.</p></section>`;
  }

  if (tab === 'backups') {
    const choices = backupTabs.filter(([id]) => id === 'local' || owner && (!native || id !== 'cloud'));
    const navigation = tabs(choices, backupTab, 'backupTab', 'Backup sections', true);
    if (backupTab === 'cloud' && owner && !native) return navigation + intro('Google Drive backups', 'Schedule automatic cloud copies and manage the Google account.') + googleDriveCard() + `<p class="settings-note">${button('settingsTab:backups', 'Change backup encryption →', 'text-button')}</p>`;
    if (backupTab === 'restore' && owner) return navigation + intro('Restore and reset', 'Recover a complete application snapshot, or remove data after a verified backup.') +
      `<section class="card"><h3>Restore your data</h3><p>ZIP, Excel, and portable Fakturocel files restore documents, templates, images, and history. You will review the contents before replacing current data.</p><div class="form-actions">${button('restore', 'Restore from a local file', 'primary')}${!native ? button('restoreCloud', 'Restore from Google Drive') : ''}</div></section>
      <section class="card danger-zone"><h3>${native ? "Clear this device's data" : 'Clear add-on data'}</h3><p>A downloaded and verified backup is required before deletion. This removes application data and managed local backups.</p><p class="muted">Google Drive copies, Home Assistant backups, and files you downloaded are managed separately.</p>${button(native ? 'clientClear' : 'wipe', 'Prepare backup and deletion', 'danger')}</section>`;
    return navigation + intro('Backups and encryption', 'Choose where your backups go and whether each destination is encrypted.') +
      `<div class="settings-grid backup-settings-grid"><div><section class="card"><h3>Local backups</h3><p class="muted">A backup is created after every saved change.</p><div class="folder"><span data-no-translate>${esc(session.backupFolder)}</span>${owner ? button('backupFolder', 'Change folder') : ''}</div>
      ${details([['Number of backups kept (0 = all)', state.settings.retention]])}<div class="form-actions">${button('backup', native ? 'Backup to folder' : 'Backup to server', 'primary')}${owner ? button('retentionSettings', 'Change retention') : ''}</div></section>
      <section class="card"><h3>Download a copy</h3><p>Save a complete ZIP or a readable Excel file to this device.</p><div class="form-actions">${button('downloadBackup', 'Download backup to this device', 'primary')}${button('excel', 'Download Excel')}</div><p class="muted">Downloaded Excel and exported templates are always unencrypted.</p></section></div>
      ${owner && !native ? backupEncryptionPanel() : `<section class="card"><h3>Recovery</h3><p>Keep a backup on another device so you can recover your data.</p>${owner ? button('backupTab:restore', 'Restore your data') : ''}</section>`}</div>`;
  }

  if (tab === 'security') return intro('Security and access', 'Control who can open the application and keep your recovery key safe.') + securityCard(owner) +
    (owner && !native ? `<section class="card"><div class="section-head"><h3>Access via Home Assistant</h3>${button('roles', 'Manage access')}</div><p class="muted">Choose which Home Assistant users can view, edit, or administer Fakturocel.</p></section>` : '');
  if (tab === 'devices') return intro('Connections', 'Connect your devices when you want to exchange data.') + (native ? clientCard() : owner ? deviceCard() : '');
  if (tab === 'calculators') return intro('Calculator', 'Keep calculations close at hand while working on an invoice.', owner ? button('calculatorSettings', 'Set calculators', 'primary') : '') +
    `<section class="card"><h3>Your calculation tools</h3><p>Standard, scientific, 3D-printing, and custom calculations with configurable fields, formulas, results, and list order.</p><p class="muted">Use the icon at the bottom left or Alt+C to open the panel above any screen. Hiding it preserves its memory in this tab.</p>${button('calculatorOpen', 'Open the calculator')}</section>`;
  return '';
}
