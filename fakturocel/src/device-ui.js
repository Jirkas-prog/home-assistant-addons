import { $, button, field, esc, modal, on, values, validateForm, confirmDialog, toast } from './ui.js';
import { api, downloadBytes } from './api.js';
export const deviceCard = () => `<section class="card"><div class="section-head"><h2>Phone and computer</h2>${button('devices', "Paired devices", 'primary')}</div><p>HTTPS 8443 encrypted port, separate access for each device and optional data transfer. Both the phone and computer work independently without a server.</p></section>`;
on('devices', async () => {
  const info = await api('devices');
  modal("Phone and computer", `<p>${info.enabled ? "Secure port is enabled." : "The port is disabled. Turn on remote_enabled in addon settings and restart it."}</p><p class="muted">The pairing file is the secret access key. Transfer it directly to your device. Pair each device separately. The new pairing authorizes the application to read and confirm the merge of all work data including settings and templates; valid only as long as this HA account has the owner role. Removing access will stop syncing; offline files already saved on the device will remain.</p><form id="pairForm">${field("Device name", 'name', '', 'text', 'required maxlength="80"')}${field("HTTPS add-on address (including port)", 'url', 'https://homeassistant.local:8443', 'url', 'required')}<div class="form-actions">${button('pairDevice', "Create a pairing file", 'primary')}</div></form><h3>Paired devices</h3>${info.devices.map(d => `<div class="role-row"><span>${esc(d.name)}<small>${esc(d.createdAt)}</small></span>${button('revokeDevice:' + d.id, "Remove access", 'danger')}</div>`).join('') || "<p>No devices yet.</p>"}<details><summary>Certificate imprint SHA-256</summary><code style="overflow-wrap:anywhere">${esc(info.fingerprint || '—')}</code></details>`);
});
on('pairDevice', async () => {
  validateForm('#pairForm');
  const pair = await api('devices/pair', values('#pairForm'));
  await downloadBytes(new TextEncoder().encode(JSON.stringify(pair, null, 2)), "Fakturocel-pairing.json", 'application/json');
  toast("The pairing file has been created. In the app, select Connect to Home Assistant.");
});
on('revokeDevice', async id => {
  if (await confirmDialog("Remove device access to sync? An offline copy will remain on your device.")) {
    await api('devices/revoke', {
      id
    });
    $('#modal').querySelector('[data-action="revokeDevice:' + id + '"]').closest('.role-row').remove();
  }
});
