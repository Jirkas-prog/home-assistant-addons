import { $, button, select, esc, modal, on, values, toast, confirmDialog, requestPassword, closeModal, setDirty } from './ui.js';
import { api, base, downloadBytes, pickFile, session } from './api.js';
import { bytesBase64 } from './model.js';
import { locale, tr } from './i18n.js';

export const formatOptions = [['zip', 'Complete ZIP archive'], ['excel', 'Excel with complete application data'], ['both', 'ZIP and Excel']];
export const backupEncryptionCard = () => `<section class="card"><div class="section-head"><h2>Encryption by location</h2>${button('backupEncryption', 'Set encryption by location', 'primary')}</div><p>Choose encryption separately for local share backups, downloaded files, and Google Drive. Working-data security is managed under Data security.</p></section>`;
let applyRestore;
export function installBackupUi(apply) { applyRestore = apply; }

export async function openBackupExport() {
  const prefs = await api('backup/preferences');
  modal('Download application backup', `<p>All formats contain a complete, verified application snapshot including archived PDFs, templates, and attachments. Excel summary tables are for review; restoration uses the complete Application backup sheet.</p><p class="${prefs.encrypted ? 'muted' : 'notice'}">${prefs.encrypted ? 'This download will be encrypted.' : 'This download will be unencrypted. Anyone with access to the file can read its data.'}</p><form id="backupExportForm">${select('Backup format', 'format', [...formatOptions, ['fakturocel', 'Portable Fakturocel file']], prefs.format)}<div class="form-actions">${button('backupExportSave', 'Download selected backup', 'primary')}</div></form><p>ZIP and Excel downloads are packaged together in one ZIP file. Keep your recovery-key PDF separately.</p>`);
}
on('backupExportSave', async () => {
  const { format } = values('#backupExportForm');
  if (session.actor?.role === 'owner') await api('backup/preferences', { format });
  const res = await fetch(new URL('api/backup/export?format=' + encodeURIComponent(format), base), { cache: 'no-store', signal: AbortSignal.timeout(360000) });
  if (!res.ok) { const error = await res.json(); throw Error(error.error || 'The backup could not be exported.'); }
  await downloadBytes(new Uint8Array(await res.arrayBuffer()), 'Fakturocel-' + new Date().toISOString().slice(0,10) + (format === 'excel' ? '.xlsx' : format === 'fakturocel' ? '.fakturocel' : '.zip'), res.headers.get('Content-Type'));
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
  modal('Encryption by location', `<p>${policy.working ? 'Working data and Google credentials remain encrypted in the private add-on vault.' : 'Working-data encryption is off. Enable it under Data security before enabling encrypted backups or connecting Google.'}</p><form id="backupEncryptionForm">${select('Local backups in /share', 'local', options, String(policy.local))}${select('Downloaded backups, Excel, and templates', 'download', options, String(policy.download))}${select('Google Drive backup files', 'cloud', options, String(policy.cloud))}<div class="form-actions">${button('backupEncryptionSave', 'Save encryption locations', 'primary')}</div></form><p>Unencrypted files can be read by anyone who can access that storage. Turning encryption on for local backups also converts existing managed plaintext backups. Existing downloaded and Google Drive files keep their original protection.</p><p>Customer invoice PDFs remain readable so recipients can open them. Their archived copies follow working-data encryption.</p>`);
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
