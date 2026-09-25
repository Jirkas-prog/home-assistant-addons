import { nativeClient, client, bridge } from './client-sync.js';
import { $, button, esc, on, modal, select, confirmDialog, showError, toast, setDirty, closeModal } from './ui.js';
import { downloadBytes, downloadRecovery, pickFile } from './api.js';
import { fieldDiff } from './sync-details.js';
export const clientCard = () => {
  const s = client.status();
  return `<section class="card"><h2>Home Assistant · optional connection</h2><p>The application works independently. It stores all invoices, PDFs, payments, templates, and settings on this device.</p><p>${s.paired ? "The connection is set. Last synchronization: " + esc(s.lastSync ? new Date(s.lastSync).toLocaleString() : "none yet") : "Home Assistant is not connected."}</p>${s.problem ? `<p class="notice">${esc(s.problem)}</p>` : ''}<div class="form-actions">${button('clientPair', s.paired ? "Change connection" : "Connect to Home Assistant", 'primary')}${s.paired ? button('clientPull', "Download data from HA") + button('clientPush', "Send and merge data with HA") + (s.undo ? button('clientUndoSync', "Return data to before the last merge") : '') + button('clientDisconnect', 'Disconnect HA') + button('clientAutoPull', client.cache.remote.autoPull === false ? "Enable automatic loading" : "Disable automatic loading") : ''}</div>${s.undo ? `<p class="muted">Restore point before the last ${s.undo.direction === 'pull' ? "download" : "upload"}: ${esc(new Date(s.undo.createdAt).toLocaleString())}. Rollback first backs up the current state.</p>` : ''}<p class="muted">A manual synchronization first shows a summary. After the first confirmed transfer, new data from HA loads automatically unless there are unsent local changes or an open form. Resolve different edits of the same record before confirmation. Disconnecting HA keeps local data and every standalone feature. PINs, keys, connections, and backup folders are never transferred between devices.</p></section>`;
};
export const clientBanner = () => `<div class="backup-strip ${client.cache?.lastBackup?.backup === false ? 'pending' : ''}"><span>${client.cache?.lastBackup?.backup === false ? "Data saved · backup failed: " + esc(client.cache.lastBackup.error) : "Standalone application · data is stored on this device"}</span>${button('nav:settings', "Settings and backups →", 'text-button')}</div>`;
export async function backupText() {
  return client.run(() => client.backupText());
}
async function backupForDestruction() {
  const revision = client.cache.viewRevision,
    text = await backupText();
  if (!(await downloadBytes(new TextEncoder().encode(text), "Fakturocel-before-deletion.fakturocel"))) throw Error("The backup was not saved. The data was preserved.");
  if (client.cache.encrypted !== false) await downloadRecovery();
  return new Promise(resolve => {
    modal("Verify saved backup", `<p>Select the just saved .fakturocel file. It will be possible to continue only after verification.</p>${button('clientVerify', "Select a saved backup", 'primary')}`, undefined, () => resolve(null));
    on('clientVerify', async () => {
      const file = await pickFile(".fakturocel");
      if (!file) return;
      if ((await file.text()) !== text) throw Error("Select the backup file you just created.");
      resolve({
        revision
      });
    });
  });
}
const label = {
  companies: "Companies",
  activities: "Activities",
  documents: "Documents",
  texts: 'Texty',
  worklogs: "Statements",
  templates: "Templates",
  fields: "Custom field",
  media: "Media",
  rules: 'Pravidla',
  payments: "Payments",
  checks: 'Kontroly',
  views: 'Pohledy'
};
function counts(s) {
  return Object.entries(label).map(([k, l]) => `<tr><td>${l}</td><td>${s[k].length}</td></tr>`).join('');
}
export function installClientActions(reload) {
  if (!nativeClient) return;
  client.canAutoApply = () => !$('#modal').innerHTML;
  on('clientPair', async () => {
    const text = await bridge.call('import');
    if (!text) return;
    if (client.cache.remote && !(await confirmDialog("Change connection? Local data will be preserved. On the next transfer, it will be compared with the new server.", {
      confirmText: "Change connection"
    }))) return;
    await client.connect(text);
    await reload();
    toast("HA is connected. Data transfer using the buttons in the settings.");
  });
  on('clientDisconnect', async () => {
    if (!(await confirmDialog("Disconnect Home Assistant and keep all local data?", {
      confirmText: 'Disconnect HA'
    }))) return;
    await client.disconnect();
    await reload();
    toast("HA disconnected. The application continues to function independently.");
  });
  const preview = async (direction, choices = {}) => {
    const p = await client.previewSync(direction, choices);
    modal(direction === 'pull' ? "Download data from Home Assistant" : 'Odeslat data do Home Assistantu', `<p>${direction === 'pull' ? "Data from HA is merged with local data. The content of the server is not changed by this step." : "The resulting merged data is stored in both Home Assistant and this device."} A backup is automatically created before the transfer and the application preserves the point of return before the merge.</p>${p.conflicts.length ? `<div class="notice">${p.conflicts.length} records have changed on both sides. The differences are broken down by individual data. For each record, select the version you want to keep.</div>${p.conflicts.map((c, i) => {
      const rows = fieldDiff(c.local, c.remote);
      return `<section class="card"><strong>${esc(c.label)}</strong><div class="table-wrap"><table class="diff-table"><thead><tr><th>Detail</th><th>This device</th><th>Home Assistant</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.label || "Full record")}</td><td><code>${esc(row.local)}</code></td><td><code>${esc(row.remote)}</code></td></tr>`).join('')}</tbody></table></div><details><summary>View full technical data</summary><div class="form-grid"><pre>${esc(JSON.stringify(c.local, null, 2))}</pre><pre>${esc(JSON.stringify(c.remote, null, 2))}</pre></div></details>${select("Keep a version of the record", 'conflict_' + i, [['', 'Vyber…'], ['local', "This device"], ['remote', 'Home Assistant']], '')}</section>`;
    }).join('')}${button('clientResolve', "Review selected resolution", 'primary')}` : `<h3>Resulting data</h3><table><tbody>${counts(p.state)}</tbody></table><p>${p.changes.length} changes to the current HA data.</p><details><summary>List of changes in HA</summary><ul>${p.changes.map(c => `<li>${esc(c.label)} · ${c.action === 'delete' ? "delete" : c.action === 'add' ? "add" : 'update'}</li>`).join('') || "<li>No changes</li>"}</ul></details>${button('clientApply', direction === 'pull' ? "Confirm download and merge" : "Confirm transfer to HA", 'primary')}`}`);
    on('clientResolve', async () => {
      const next = {
        ...choices
      };
      for (let i = 0; i < p.conflicts.length; i++) {
        const v = $('[name="conflict_' + i + '"]').value;
        if (!v) throw Error("Choose a solution for each conflict.");
        next[p.conflicts[i].key] = v;
      }
      setDirty(false);
      await preview(direction, next);
    });
    on('clientApply', async () => {
      await client.applySync(p.token);
      setDirty(false);
      await closeModal();
      await reload();
      toast("Data transfer is complete.");
    });
  };
  on('clientAutoPull', async () => {
    await client.run(() => client.persist({
      ...client.cache,
      remote: {
        ...client.cache.remote,
        autoPull: client.cache.remote.autoPull === false
      }
    }));
    await reload();
  });
  on('clientPull', () => preview('pull'));
  on('clientPush', () => preview('push'));
  on('clientSync', () => preview('push'));
  on('clientUndoSync', async () => {
    if (!(await confirmDialog("Roll back local data to the state before the last merge? The current state is backed up first. The data in Home Assistant is not changed by this step; you can subsequently resend any returned changes.", {
      title: "Back before the merger",
      confirmText: "Backup and restore"
    }))) return;
    await client.undoLastSync();
    await reload();
    toast("Local data was returned before the last merge.");
  });
  on('clientBackup', async () => {
    if (!(await downloadBytes(new TextEncoder().encode(await backupText()), "Fakturocel-" + new Date().toISOString().slice(0, 10) + ".fakturocel"))) throw Error("The backup was not saved.");
  });
  on('clientKey', () => downloadRecovery());
  on('clientClear', () => {
    void backupForDestruction().then(async verified => {
      if (!verified) return;
      if (!(await confirmDialog("The backup is saved and verified. Delete local data, managed automatic backups and connections to HA? Manually exported files and data will remain on the server.", {
        danger: true,
        confirmText: "Delete local data"
      }))) return;
      await client.clear(verified.revision);
      location.reload();
    }).catch(showError);
  });
}
