import { unpackBackup, packBackup, clone, collections, validateDoc } from '../src/model.js';
import { validateTemplate } from '../src/renderer.js';
import { same } from '../src/data-merge.js';
import { fail, hash } from './store.mjs';
export async function exchange(store, input, actor) {
  return store.serial(async () => {
    store.role(actor, 'owner');
    const devices = store.meta('devices', {}),
      device = devices[actor.deviceId];
    if (device?.syncProtocol !== 2) throw fail(403, "Create a new pairing file in Home Assistant for full data transfer.");
    if (!/^[a-f0-9-]{36}$/.test(input.requestId || '') || typeof input.text !== 'string') throw fail(400, "Invalid transfer.");
    const digest = hash(input.text);
    if (device.exchange?.requestId === input.requestId) {
      if (device.exchange.digest !== digest) throw fail(409, "The confirmation belongs to another transmission.");
      return;
    }
    if (input.revision !== store.revision) throw fail(409, "The data in the Home Assistant has changed in the meantime. Prepare a new transmission report.");
    const incoming = await unpackBackup(input.text),
      current = store.read(),
      state = incoming.data;
    for (const t of state.templates) validateTemplate(t, state);
    // An issued document is an archive, even when the write comes from an owner's device.
    for (const old of current.state.documents.filter(d => d.status !== 'draft')) {
      const next = state.documents.find(d => d.id === old.id);
      if (!next) throw fail(400, "The transfer must not remove the issued document " + old.number + ". Use document cancellation with reason.");
      const a = clone(old),
        b = clone(next),
        allowed = ['status', 'cancelReason', 'pdfHash', 'archiveVariants'];
      if (old.imported) allowed.push('number', 'date', 'due', 'notes', 'importedTotal');
      for (const key of allowed) {
        delete a[key];
        delete b[key];
      }
      if (!same(a, b) || old.status === 'cancelled' && next.status !== 'cancelled' || next.status === 'draft') throw fail(400, "The transfer changes the closed document " + old.number + ". The original data remains preserved.");
      if (next.status === 'cancelled' && !next.cancelReason?.trim()) throw fail(400, "A canceled document needs a reason.");
      if (old.pdfHash && next.pdfHash !== old.pdfHash && !next.archiveVariants?.some(v => v.hash === old.pdfHash)) throw fail(400, "The original PDF document is missing from the transfer " + old.number + '.');
    }
    for (const d of state.documents) if (d.status === 'issued' && !d.imported) {
      validateDoc(d, state, true);
      if (!d.pdfHash || !d.templateSnapshot) throw fail(400, "The issued document is missing PDF or a template image.");
    }
    state.usedNumbers = [...new Set([...current.state.usedNumbers, ...state.usedNumbers])];
    state.audit = [...new Map([...state.audit, ...current.state.audit].map(a => [a.id, a])).values()];
    await packBackup(state, incoming.blobs);
    const before = await store.backup('Before-transfer');
    if (!before.backup) throw fail(400, "Failed to save backup in HA before transfer. " + before.error);
    store.role(actor, 'owner');
    store.transaction(() => {
      store.db.exec('DELETE FROM blobs');
      store.writeAll(state, incoming.blobs);
      for (const k of [...collections, 'audit']) for (const value of state[k]) store.db.prepare('UPDATE records SET rev=? WHERE collection=? AND id=?').run((current.revisions[k + ':' + value.id] || 0) + 1, k, value.id);
      store.event(actor, 'sync', 'all', 'all', null, null, "Confirmed transfer from standalone application");
      device.exchange = {
        requestId: input.requestId,
        digest
      };
      devices[actor.deviceId] = device;
      store.setMeta('devices', devices);
    });
    await store.backup();
  });
}
