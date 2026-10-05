import { $, button, select, esc, modal, on, values, toast, confirmDialog, requestPassword, closeModal, setDirty, job } from './ui.js';
import { api, downloadBytes, pickFile, session } from './api.js';
import { generateDownload } from './export-ui.js';
import { bytesBase64 } from './model.js';
import { locale, tr } from './i18n.js';

export const formatOptions = [['zip', 'Complete ZIP archive'], ['excel', 'Excel with complete application data'], ['both', 'ZIP and Excel']];
export const backupEncryptionPanel = () => `<section class="card encryption-panel" id="backupEncryptionPanel" tabindex="-1" aria-busy="true"><h3>Backup encryption</h3><p role="status">Loading encryption settings…</p></section>`;
const destinations = [
  ['local', 'Local backups in /share', 'Protect copies stored on your shared Home Assistant drive.'],
  ['download', 'Downloaded ZIP and portable backups', 'Protect ZIP and Fakturocel files downloaded to this device.'],
  ['cloud', 'Google Drive backup files', 'Protect backups uploaded to your Google account.']
];
export async function mountBackupEncryption() {
  const panel = $('#backupEncryptionPanel');
  if (!panel) return;
  let policy;
  const draw = () => {
    if (!panel.isConnected) return;
    panel.setAttribute('aria-busy', 'false');
    panel.innerHTML = `<h3>Backup encryption</h3><p class="muted">Optional for each destination. Off by default. Changes are saved immediately.</p>${destinations.map(([key, label, hint]) => `<div class="encryption-row"><div><strong id="encryption-label-${key}">${label}</strong><p>${hint}</p></div><button type="button" class="encryption-switch" data-encryption="${key}" role="switch" aria-checked="${policy[key]}" aria-labelledby="encryption-label-${key}" ${!policy.working ? 'disabled' : ''}><span class="switch-track" aria-hidden="true"></span><span>${policy[key] ? 'On' : 'Off'}</span></button></div>`).join('')}
      <p class="settings-note">Downloaded Excel and exported templates are always unencrypted.</p>${!policy.working ? `<div class="notice"><p>Enable private storage protection to create a remembered key before encrypting backups.</p>${button('securitySettings', 'Set up the encryption key')}</div>` : button('recoveryPdf', 'Download PDF with recovery key', 'text-button')}`;
    for (const control of panel.querySelectorAll('[data-encryption]')) control.onclick = () => void job(async () => {
      const key = control.dataset.encryption, input = Object.fromEntries(destinations.map(([id]) => [id, policy[id]]));
      input[key] = !policy[key];
      if (!input[key]) {
        if (!(await confirmDialog('Files in the selected destinations will be unencrypted and can be read by other users with access to that storage. Continue?', { danger: true }))) return;
        input.confirm = 'ALLOW UNENCRYPTED BACKUPS';
      }
      const focused = control.dataset.encryption;
      panel.querySelectorAll('button').forEach(el => { el.disabled = true; });
      panel.setAttribute('aria-busy', 'true');
      try {
        policy = await api('backup/encryption', input);
        toast('Encryption settings saved for each backup destination.');
      } finally {
        draw();
        panel.querySelector(`[data-encryption="${focused}"]`)?.focus({ preventScroll: true });
      }
    }, 'Saving encryption settings…');
  };
  try { policy = await api('backup/encryption'); draw(); }
  catch (e) {
    if (!panel.isConnected) return;
    panel.setAttribute('aria-busy', 'false');
    panel.innerHTML = `<h3>Backup encryption</h3><p class="field-error" role="alert">${esc(tr(e.message))}</p>${button('retryEncryptionPanel', 'Try again')}`;
  }
}
on('retryEncryptionPanel', mountBackupEncryption);
let applyRestore;
export function installBackupUi(apply) { applyRestore = apply; }

export async function openBackupExport() {
  const prefs = await api('backup/preferences');
  modal('Download application backup', `<p>All formats contain a complete, verified application snapshot including archived PDFs, templates, and attachments. Excel summary tables are for review; restoration uses the complete Application backup sheet.</p><p>${prefs.encrypted ? 'ZIP and portable downloads are encrypted using your saved setting. Keep the recovery-key PDF separately.' : 'ZIP and portable downloads are unencrypted. Encryption is optional in Settings.'}</p><p>Downloaded Excel is always unencrypted, including its complete backup sheet. Templates are also unencrypted.</p><form id="backupExportForm">${select('Backup format', 'format', [...formatOptions, ['fakturocel', 'Portable Fakturocel file']], prefs.format)}<div class="form-actions">${button('backupExportSave', 'Download selected backup', 'primary')}</div></form><p>ZIP and Excel downloads are packaged together in one ZIP file.</p>`);
}
on('backupExportSave', async () => {
  const { format } = values('#backupExportForm');
  if (session.actor?.role === 'owner') await api('backup/preferences', { format });
  setDirty(false);
  const file = await generateDownload(format);
  if (!file) return;
  await downloadBytes(file.bytes, 'Fakturocel-' + new Date().toISOString().slice(0,10) + (format === 'excel' ? '.xlsx' : format === 'fakturocel' ? '.fakturocel' : '.zip'), file.mime);
  setDirty(false);
  await closeModal();
  toast('Backup sent for download.');
});

async function restorePreview(route, data) {
  let preview;
  try { preview = await api(route, data); }
  catch (e) {
    if (e.status !== 422) throw e;
    const password = await requestPassword('Enter the recovery key from PDF or the original password of this backup.');
    if (password === null) return;
    preview = await api(route, { ...data, password });
  }
  const message = `${tr('Restore')} ${preview.documents} ${tr('documents')}, ${preview.companies} ${tr('companies')}, ${preview.templates} ${tr('templates')} ${tr('and')} ${preview.attachments} ${tr('attachments')}? ${tr('Current data is first backed up and then replaced.')}`;
  if (!(await confirmDialog(message, { title: tr('Restore backup') }))) return;
  applyRestore(await api('restore/file/finish', { ticket: preview.ticket, revision: preview.revision }));
  setDirty(false);
  await closeModal();
  toast('Backup has been restored.');
}
export async function restoreLocalBackup() {
  const file = await pickFile('.zip,.xlsx,.fakturocel');
  if (!file) return;
  if (file.size > 300 * 1024 * 1024) throw Error('The backup file exceeds the supported size of 300 MB.');
  return restorePreview('restore/file/preview', { name: file.name, base64: bytesBase64(new Uint8Array(await file.arrayBuffer())) });
}
export async function openCloudRestore() {
  const info = await api('google-drive/folders');
  modal('Restore from Google Drive', `<p>Select a backup to validate and preview before replacing current data. ZIP and Excel restore the same complete snapshot. A local backup of current data is mandatory and is created before restoration.</p><p>Choose an older Fakturocel folder to recover data after reinstalling. This does not change the destination for new backups.</p>${select('Google Drive backup folder', 'cloudRestoreFolder', info.folders.map(f => [f.id, f.name]), info.currentFolderId)}<div class="form-actions">${button('cloudRestoreList', 'Load backups', 'primary')}</div><div id="cloudRestoreList" class="picker-results"></div>`);
  await loadCloudList();
}
async function loadCloudList() {
  const folderId = $('[name="cloudRestoreFolder"]').value;
  const result = await api('google-drive/files?folder=' + encodeURIComponent(folderId));
  if ($('#modal').dataset.modalTitle !== 'Restore from Google Drive') return;
  $('#cloudRestoreList').innerHTML = result.files.map(f => `<div class="role-row"><span data-no-translate><strong>${esc(f.name)}</strong><small>${esc(new Date(f.createdAt).toLocaleString(locale()))} · ${(Number(f.size || 0) / 1024 / 1024).toFixed(2)} MB</small></span>${button('cloudRestore:' + f.id, 'Preview and restore')}</div>`).join('') || '<p>No cloud backups yet.</p>';
  $('#cloudRestoreList').dataset.folderId = folderId;
}
on('cloudRestoreList', loadCloudList);
on('cloudRestore', id => restorePreview('restore/cloud/preview', { id, folderId: $('#cloudRestoreList').dataset.folderId }));

on('backupEncryption', async () => {
  const policy = await api('backup/encryption');
  const options = [['true', 'On'], ['false', 'Off']];
  modal('Encryption by location', `<p>Each destination can use encryption independently. All three default to Off on new installations. Saved choices are preserved.</p><form id="backupEncryptionForm">${select('Local backups in /share', 'local', options, String(policy.local))}${select('Downloaded ZIP and portable backups', 'download', options, String(policy.download))}${select('Google Drive backup files', 'cloud', options, String(policy.cloud))}<div class="form-actions">${button('backupEncryptionSave', 'Save encryption locations', 'primary')}</div></form><p>Downloaded Excel is always unencrypted, including its complete backup sheet. Templates are also unencrypted.</p><p>Turning encryption on also protects existing managed backups in the local share folder. Older encrypted exports can still be restored with their original key.</p>`);
  on('backupEncryptionSave', async () => {
    const form = values('#backupEncryptionForm');
    const data = Object.fromEntries(['local', 'download', 'cloud'].map(k => [k, form[k] === 'true']));
    if (['local', 'download', 'cloud'].some(k => policy[k] && !data[k])) {
      if (!(await confirmDialog('Files in the selected destinations will be unencrypted and can be read by other users with access to that storage. Continue?', { danger: true }))) return;
      data.confirm = 'ALLOW UNENCRYPTED BACKUPS';
    }
    await api('backup/encryption', data);
    setDirty(false);
    await closeModal();
    toast('Encryption settings saved for each backup destination.');
  });
});
