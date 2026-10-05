import { $, button, field, select, esc, modal, on, values, validateForm, confirmDialog, toast, setDirty, showError } from './ui.js';
import { api } from './api.js';
import { locale, tr } from './i18n.js';
import { formatOptions, openCloudRestore } from './backup-ui.js';

export const googleDriveCard = () => `<section class="card"><div class="section-head"><h2>Google Drive backups</h2>${button('googleDrive', 'Set up Google Drive', 'primary')}</div><p>Automatically upload full backups, even when the browser is closed. Choose the interval, format, retention, and encryption by location.</p></section>`;
let timer, polling = false, version = 0;
const stopPolling = () => { clearTimeout(timer); timer = null; };
const date = value => value ? esc(new Date(value).toLocaleString(locale())) : esc(tr('Never'));

function draw(info) {
  stopPolling();
  version++;
  const auth = info.authorization;
  modal('Google Drive backups', `<p class="${info.encryptBackups ? 'muted' : 'notice'}">${info.encryptBackups ? 'Cloud backups use the encrypted .fakturocel format. Keep your recovery-key PDF separately.' : 'New Google Drive backups are unencrypted. Anyone with access to those files can read them.'}</p><div class="form-actions">${button('backupEncryption', 'Set encryption by location')}</div>
    <p><strong>${info.connected ? 'Google account connected.' : 'No Google account connected.'}</strong></p>
    ${info.folderId ? `<p><a href="https://drive.google.com/drive/folders/${esc(info.folderId)}" target="_blank" rel="noopener noreferrer">Open backup folder in Google Drive</a></p>` : ''}
    <dl><dt>Last successful backup</dt><dd>${date(info.lastSuccess)}</dd><dt>Last attempt</dt><dd>${date(info.lastAttempt)}</dd>${info.nextAttempt ? `<dt>Next retry</dt><dd>${date(info.nextAttempt)}</dd>` : ''}</dl>
    ${info.lastError ? `<p class="field-error" role="status">${esc(tr(info.lastError))}</p>` : ''}
    ${info.busy ? '<p role="status">A cloud backup is in progress.</p>' : ''}
    <form id="googleDriveSettings"><div class="grid">${select('Automatic backups', 'enabled', [['false', 'Off'], ['true', 'On']], String(info.enabled))}${select('Backup format', 'format', formatOptions, info.format)}${field('Backup interval (hours)', 'intervalHours', info.intervalHours, 'number', 'required min="1" max="720" step="1"')}${field('Number of backup sets to keep', 'keepCount', info.keepCount, 'number', 'required min="2" max="100" step="1"')}</div><div class="form-actions">${button('googleDriveSave', 'Save backup settings', 'primary')}${info.connected ? button('googleDriveBackup', 'Back up to Google Drive now') + button('googleDriveRestore', 'Restore from Google Drive') + button('googleDriveDisconnect', 'Disconnect Google Drive', 'danger') : ''}${button('googleDriveRefresh', 'Refresh status')}</div></form>
    ${auth ? `<section class="card"><h3>Authorize Google Drive</h3><p>Open the Google authorization page and enter this code. Keep this window open until the connection is confirmed.</p><p><a href="${esc(auth.verificationUrl)}" target="_blank" rel="noopener noreferrer" data-no-translate>${esc(auth.verificationUrl)}</a></p><p><code data-no-translate style="font-size:1.4em;overflow-wrap:anywhere">${esc(auth.userCode)}</code></p><p>Code expires: <span data-no-translate>${date(auth.expiresAt)}</span></p><p role="status" id="googleDriveWaiting">Waiting for Google authorization…</p></section>` : ''}
    <details><summary>Google connection setup</summary><p>Use your own Google Cloud project. Client credentials are kept in the encrypted add-on storage and are excluded from portable backups.</p><ol><li>Enable the Google Drive API in your Google Cloud project.</li><li>Configure Google Auth Platform branding and audience. Add your account as a test user when the project is in Testing mode.</li><li>Create an OAuth client with the TVs and Limited Input devices type.</li><li>Copy the client ID and client secret below, then authorize the connection on Google's page.</li></ol><p>Google Testing mode can expire authorization after seven days. For unattended backups, use an appropriate production publishing status in your Google project.</p><p><a href="https://developers.google.com/identity/protocols/oauth2/limited-input-device" target="_blank" rel="noopener noreferrer">Google authorization documentation</a></p></details>
    ${!auth ? `<form id="googleDriveConnect"><div class="grid">${field('Google client ID', 'clientId', '', 'text', 'required maxlength="280" autocomplete="off" spellcheck="false"')}${field('Google client secret', 'clientSecret', '', 'password', 'required maxlength="500" autocomplete="new-password"')}</div><div class="form-actions">${button('googleDriveConnect', info.connected ? 'Connect another Google account' : 'Connect Google account', 'primary')}</div></form>` : ''}
    <p class="muted">Cloud copies are managed separately from local backups. Disconnecting or clearing add-on data keeps existing Google Drive copies; remove those copies in Google Drive when needed. Restore a downloaded cloud .fakturocel file using Restore data from backup.</p>`, () => {
      if (auth) $('#googleDriveSettings').querySelectorAll('input,select,button').forEach(el => { el.disabled = true; });
    }, stopPolling, 'googleDrive');
  setDirty(false);
  if (auth) timer = setTimeout(checkAuthorization, 5000);
}

async function checkAuthorization() {
  if (polling || $('#modal').dataset.modalKey !== 'googleDrive') return;
  polling = true;
  const started = version;
  try {
    const info = await api('google-drive/poll', {});
    if ($('#modal').dataset.modalKey !== 'googleDrive' || version !== started) return;
    if (!info.authorization) { draw(info); toast('Google Drive is connected. Enable automatic backups or create a backup now.'); }
    else timer = setTimeout(checkAuthorization, 5000);
  } catch (e) {
    stopPolling();
    if ($('#modal').dataset.modalKey === 'googleDrive' && version === started) await showError(e);
  } finally { polling = false; }
}
on('googleDrive', async () => draw(await api('google-drive')));
on('googleDriveRefresh', async () => draw(await api('google-drive')));
on('googleDriveSave', async () => {
  const v = values('#googleDriveSettings');
  draw(await api('google-drive/configure', { enabled: v.enabled === 'true', intervalHours: Number(v.intervalHours), keepCount: Number(v.keepCount), format: v.format }));
  toast('Google Drive backup settings saved.');
});
on('googleDriveConnect', async () => {
  validateForm('#googleDriveConnect');
  draw(await api('google-drive/connect', values('#googleDriveConnect')));
});
on('googleDriveBackup', async () => {
  draw(await api('google-drive/backup', {}));
  toast('The backup was uploaded and verified in Google Drive.');
});
on('googleDriveRestore', openCloudRestore);
on('googleDriveDisconnect', async () => {
  if (await confirmDialog('Disconnect Google Drive and stop automatic cloud backups? Existing cloud copies will remain in Google Drive.')) {
    draw(await api('google-drive/disconnect', {}));
    toast('Google Drive disconnected.');
  }
});
