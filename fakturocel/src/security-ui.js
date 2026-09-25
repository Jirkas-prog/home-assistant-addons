import { nativeClient } from './client-sync.js';
import { $, esc, button, field, select, modal, on, setDirty, closeModal, validateForm, confirmDialog, toast, requestPassword } from './ui.js';
import { api, session, loadSecurity, downloadRecovery } from './api.js';
const warning = "With encryption turned off, stored data and backups can be accessed by other users with access to files or device storage.";
const network = () => !nativeClient && !isSecureContext ? "<p class=\"notice\">To protect the PIN and key during transfer, use Home Assistant via HTTPS.</p>" : '';
export const needsSecurity = s => s.blocked || !s.configured || s.locked || s.pinRequired || s.migrationPending || s.transitioning;
export const encryptionNotice = () => session.security && !session.security.encrypted ? `<div class="notice security-warning" role="status"><strong>Unencrypted storage</strong><p>${warning}</p></div>` : '';
export const securityCard = owner => `<section class="card ${session.security?.encrypted ? '' : 'danger-zone'}"><div class="section-head"><h2>Data security</h2>${owner ? button('securitySettings', "Set encryption", 'primary') : ''}</div><p>${session.security?.encrypted ? nativeClient ? "Local data and backups are encrypted. The application remembers the key; you don't enter it at startup." : "Data and backups are encrypted. The add-on remembers the key and loads it automatically after restart." : warning}</p>${session.security?.encrypted ? `<p class="muted">${nativeClient ? "Local storage and a remembered key protect Windows or Android. Additionally, the encryption option protects portable backups and Excel; the protection of the private copy by the operating system remains always on." : "The key is stored in the add-on's private folder. An administrator with access to the entire Home Assistant storage can retrieve both the data and the key."} Key ID: ${esc(session.security.keyId || '')}</p>${owner ? button('recoveryPdf', "Download PDF with recovery key") : ''}<p class="muted">You can also open new Excel exports with this key. PDF contains the secret key; store it separately from backups.</p>` : ''}<hr><div class="section-head"><h3>Access PIN</h3>${owner ? button('pinSettings', "Set PIN") : ''}</div><p>${session.security?.pinEnabled ? nativeClient ? "On. Required after app restart or after 12 hours." : "On. Each browser is unlocked separately. The session will expire in 12 hours or after the add-on is restarted." : nativeClient ? "Off. The application will open directly on this device." : "Off. The app is opened via login and Home Assistant permissions."}</p><p class="muted">PIN protects the entrance to the application. The encryption key remains stored independently of the PIN.</p>${session.security?.pinEnabled ? button('securityLock', "Lock this device") : ''}</section>`;
function setupForm(encrypted = false, change = false) {
  return `<form id="securityForm" novalidate>${select("Encryption of stored data and backups", 'enabled', [['true', "On — recommended"], ['false', "Off"]], change ? String(encrypted) : 'true')}<p>The key is created and saved automatically. You will not enter it when opening the application or exporting. In Settings, download PDF with the backup recovery key.</p>${change && encrypted ? "<label class=\"check-label\" id=\"rotateKeyField\"><input type=\"checkbox\" name=\"rotateKey\"> Create a new encryption key</label>" : ''}<div id="optionalPasswordFields"><details><summary>Custom password for backup recovery (optional)</summary><p>In addition to the key from PDF, this password can also open backups and templates. The application does not require it at startup. Excel opens with the key from PDF.</p>${field("Recovery password (at least 12 characters)", 'password', '', 'password', 'minlength="12" maxlength="255" autocomplete="new-password"')}${field("Repeat password", 'repeatPassword', '', 'password', 'minlength="12" maxlength="255" autocomplete="new-password"')}</details></div><div id="disableEncryptionWarning" class="notice" hidden><strong>File protection will be turned off</strong><p>${warning}</p><label class="check-label"><input type="checkbox" name="disableConfirmed" required> I understand that data and new backups will not be protected by encryption.</label>${encrypted ? "<p>Before turning it off, download the current PDF with the key. Older encrypted files will still need it.</p>" : ''}</div>${network()}<div class="form-actions">${button('securitySave', change ? "Save security" : "Set security and continue", 'primary')}</div></form>`;
}
function bindForm() {
  const update = () => {
    const enabled = $('[name="enabled"]').value === 'true',
      rotate = $('[name="rotateKey"]'),
      newKey = enabled && (!rotate || rotate.checked);
    if (rotate) {
      $('#rotateKeyField').hidden = !enabled;
      rotate.disabled = !enabled;
    }
    $('#optionalPasswordFields').hidden = !newKey;
    for (const input of $('#optionalPasswordFields').querySelectorAll('input')) input.disabled = !newKey;
    $('#disableEncryptionWarning').hidden = enabled;
    $('[name="disableConfirmed"]').disabled = enabled;
  };
  $('[name="enabled"]').onchange = update;
  if ($('[name="rotateKey"]')) $('[name="rotateKey"]').onchange = update;
  update();
}
function securityValues() {
  validateForm('#securityForm');
  const v = Object.fromEntries(new FormData($('#securityForm'))),
    enabled = v.enabled === 'true';
  if (v.password !== v.repeatPassword) throw Error("The passwords entered do not match.");
  return {
    enabled,
    password: v.password || undefined,
    rotate: enabled && v.rotateKey === 'on',
    confirm: !enabled && v.disableConfirmed ? "DISABLE ENCRYPTION" : ''
  };
}
function clearPasswords() {
  document.querySelectorAll('input[type=password]').forEach(x => x.value = '');
}
export function showSecurityGate(security, onReady) {
  if (security.blocked) {
    $('#app').innerHTML = "<main class=\"security-gate\"><h1>The add-on needs to be restarted</h1><p>The last write could not be completed reliably. Restart Fakturocel in Home Assistant settings. The original files are not automatically replaced with empty data.</p></main>";
    return;
  }
  if (security.locked) {
    $('#app').innerHTML = `<main class="security-gate"><img src="app-logo.svg" alt="Fakturocel"><h1>One-time key retrieval</h1><p>There is no key saved for this installation yet. Enter the original encryption password or recovery key from PDF. The plugin will remember the key and won't ask for it next time.</p><form id="unlockForm" novalidate>${field("Original password or recovery key", 'unlockPassword', '', 'password', 'required autocomplete="off" maxlength="255"')}${network()}${button('securityUnlock', "Load and remember the key", 'primary')}</form></main>`;
    on('securityUnlock', async () => {
      validateForm('#unlockForm');
      await api('security/unlock', {
        password: $('[name="unlockPassword"]').value
      });
      clearPasswords();
      await onReady();
    });
    return;
  }
  if (security.pinRequired) {
    $('#app').innerHTML = `<main class="security-gate"><img src="app-logo.svg" alt="Fakturocel"><h1>The application is locked</h1><p>Unlock this device with an access PIN.</p><form id="pinUnlockForm" novalidate>${field("Access PIN", 'loginPin', '', 'password', 'required inputmode="numeric" pattern="[0-9]{6,12}" minlength="6" maxlength="12" autocomplete="off"')}${network()}${button('pinUnlock', 'Odemknout', 'primary')}</form>${security.encrypted ? button('pinForgot', "Forgotten PIN") : ''}</main>`;
    on('pinUnlock', async () => {
      validateForm('#pinUnlockForm');
      await api('security/pin-login', {
        pin: $('[name="loginPin"]').value
      });
      clearPasswords();
      await onReady();
    });
    on('pinForgot', async () => {
      const key = await requestPassword("The owner can turn off the forgotten PIN with the current recovery key from PDF.", "Restore access");
      if (key === null) return;
      await api('security/pin-recover', {
        key
      });
      await onReady();
      toast("PIN was turned off. You can set a new one in Settings.");
    });
    return;
  }
  if (security.migrationPending || security.transitioning) {
    $('#app').innerHTML = `<main class="security-gate"><h1>Completion of encryption</h1><p>Need to complete the conversion of older managed backups and delete the original unencrypted files.</p>${button('securityRetry', "Complete the transfer", 'primary')}</main>`;
    on('securityRetry', async () => {
      await api('security/retry', {});
      await onReady();
    });
    return;
  }
  $('#app').innerHTML = `<main class="security-gate"><img src="app-logo.svg" alt="Fakturocel"><h1>Security of Fakturocel</h1><p>${security.legacy ? "Previous data was found. When turned on, they will be converted to encrypted storage, including managed backups." : "Before you start saving data, set up data protection. Access PIN is disabled by default."}</p>${setupForm()}</main>`;
  bindForm();
  on('securitySave', async () => {
    const input = securityValues();
    if (!input.enabled && !(await confirmDialog(warning, {
      title: "Turn off encryption?",
      confirmText: "Continue without encryption",
      danger: true
    }))) return;
    try {
      await api('security/setup', input);
      clearPasswords();
      await onReady();
    } catch (e) {
      const r = await loadSecurity();
      if (r.security.configured) await onReady();
      throw e;
    }
  });
}
export function installSecurityActions(onReady) {
  on('recoveryPdf', async () => {
    await downloadRecovery();
    toast("PDF with recovery key has been sent for download.");
  });
  on('securitySettings', () => {
    modal("Storage and backup security", setupForm(!!session.security.encrypted, true), bindForm);
    on('securitySave', async () => {
      const input = securityValues();
      if (!input.enabled) {
        if (!(await confirmDialog(warning, {
          title: "Really turn off encryption?",
          confirmText: "Turn off encryption",
          danger: true
        }))) return;
        if (session.security.encrypted) await downloadRecovery();
      }
      if (input.rotate) {
        if (!(await confirmDialog("The new key will protect current data and future backups. Older files will need the legacy key. First, his PDF is downloaded.", {
          title: "Create a new key?",
          confirmText: "Download key and change"
        }))) return;
        await downloadRecovery();
      }
      await api('security/change', input);
      clearPasswords();
      setDirty(false);
      await closeModal();
      await onReady();
      if (input.rotate) await downloadRecovery();
      toast(input.enabled ? "Data and backup encryption is turned on." : "Encryption has been turned off.");
    });
  });
  on('securityLock', async () => {
    if (!(await confirmDialog("Lock the app on this device? This does not change the stored encryption key.", {
      title: 'Zamknout aplikaci',
      confirmText: 'Zamknout'
    }))) return;
    await api('security/lock', {});
    await onReady();
  });
  on('pinSettings', () => {
    const enabled = !!session.security.pinEnabled;
    modal("Access PIN", `<form id="pinForm" novalidate>${select("Require PIN to enter", 'pinEnabled', [['false', "Off"], ['true', "On"]], String(enabled))}${enabled ? field("Current PIN", 'currentPin', '', 'password', 'required inputmode="numeric" pattern="[0-9]{6,12}" maxlength="12" autocomplete="off"') : ''}<div id="newPinFields">${field("New PIN (6 to 12 digits)", 'pin', '', 'password', 'required inputmode="numeric" pattern="[0-9]{6,12}" minlength="6" maxlength="12" autocomplete="new-password"')}${field("Repeat new PIN", 'repeatPin', '', 'password', 'required inputmode="numeric" pattern="[0-9]{6,12}" minlength="6" maxlength="12" autocomplete="new-password"')}</div><p>${nativeClient ? "PIN protects app access on this device. It doesn't sync with Home Assistant." : "PIN is common to authorized users of this add-on. Changing it will log out other devices."} ${session.security.encrypted ? "A forgotten PIN can be turned off by the owner using a recovery key." : "Without encryption, PIN recovery with a key is not available; PIN keep safe."}</p>${network()}${button('pinSave', "Save PIN", 'primary')}</form>`, () => {
      const update = () => {
        const active = $('[name="pinEnabled"]').value === 'true';
        $('#newPinFields').hidden = !active;
        for (const i of $('#newPinFields').querySelectorAll('input')) i.disabled = !active;
      };
      $('[name="pinEnabled"]').onchange = update;
      update();
    });
    on('pinSave', async () => {
      validateForm('#pinForm');
      const v = Object.fromEntries(new FormData($('#pinForm'))),
        active = v.pinEnabled === 'true';
      if (active && v.pin !== v.repeatPin) throw Error("The entered PINs do not match.");
      await api('security/pin', {
        enabled: active,
        pin: v.pin,
        currentPin: v.currentPin
      });
      clearPasswords();
      setDirty(false);
      await closeModal();
      await onReady();
      toast(active ? "Access PIN is on." : "Access PIN is disabled.");
    });
  });
}
