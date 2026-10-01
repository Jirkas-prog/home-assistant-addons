// Shared invoice and catalogue rules for HA, Windows and Android. Persistence is supplied by each host.
import { validateState, validateDoc, packBackup, collections, clone, now, uid, checksFor, bytesBase64, validDate } from './model.js';
import { validateTemplate, renderDocument } from './renderer.js';
import { hashBytes } from './crypto.js';
export const fail = (status, message) => Object.assign(Error(message), {
  status
});
export async function prepareCommit(current, input, actor, {
  blob,
  blobs,
  loadAsset,
  role = () => {}
}) {
  const s = clone(current.state);
  if (!Array.isArray(input.ops) || !input.ops.length || input.ops.length > 100) throw fail(400, "Invalid change.");
  const ops = clone(input.ops),
    pending = [];
  const keys = ops.map(o => o.collection + ':' + (o.collection === 'config' ? 'config' : o.id));
  if (new Set(keys).size !== keys.length) throw fail(400, "A single request may change each record only once.");
  for (const op of ops) {
    if (op.collection === 'config') {
      role(actor, 'owner');
      if (op.rev !== current.configRevision) throw fail(409, "In the meantime, another user has changed the settings.");
      s.supplier = op.value.supplier;
      s.settings = op.value.settings;
      continue;
    }
    if (!collections.includes(op.collection) || !op.id) throw fail(400, "Invalid collection.");
    if (['templates', 'fields', 'rules', 'media'].includes(op.collection)) role(actor, 'owner');
    const old = s[op.collection].find(v => v.id === op.id),
      rev = current.revisions[op.collection + ':' + op.id] || 0;
    if (+op.rev !== rev) throw fail(409, "The record has since changed. The detailed data remains open; load the current data.");
    if (op.collection === 'documents' && old?.status !== 'draft' && old && !input.special) throw fail(400, "Edit the issued document through repair or payment.");
    if (op.collection === 'templates' && old?.status === 'active') {
      const candidate = clone(op.value || {});
      candidate.status = old.status;
      if (op.value?.status !== 'archived' || JSON.stringify(candidate) !== JSON.stringify(old)) throw fail(400, "Edit the active template as a new version.");
      if (s.settings.templateId === old.id) throw fail(400, "First, choose a different default template.");
    }
    if (op.delete) {
      if (op.collection === 'companies' && s.documents.some(d => d.customer?.id === op.id) || op.collection === 'templates' && s.documents.some(d => d.templateId === op.id) || op.collection === 'fields' && s.templates.some(t => JSON.stringify(t.nodes).includes('custom.' + op.id)) || op.collection === 'media' && (s.settings.appearance?.logoId === op.id || s.templates.some(t => JSON.stringify(t.nodes).includes(op.id)))) throw fail(400, "The record is in use. Archive it instead of deleting it.");
      s[op.collection] = s[op.collection].filter(v => v.id !== op.id);
      continue;
    }
    const v = op.value;
    if (!v || v.id !== op.id) throw fail(400, "Does not match ID record.");
    if (op.collection === 'documents') {
      if (input.special) throw fail(400, "Invalid repair method.");
      if (v.status === 'cancelled') throw fail(400, "Cancel the document via a separate operation with a reason.");
      delete v.pdfHash;
      delete v.templateSnapshot;
      delete v.issuedAt;
      const issue = v.status === 'issued' && (!old || old.status === 'draft');
      validateDoc(v, s, issue);
      const key = v.type + ':' + v.number;
      if (s.usedNumbers.includes(key) && (!old || old.number !== v.number)) throw fail(400, "The document number has already been used.");
      if (!s.usedNumbers.includes(key)) s.usedNumbers.push(key);
      if (issue) {
        const t = s.templates.find(t => t.id === v.templateId && t.status === 'active');
        if (!t) throw fail(400, "Select the active template.");
        const blocking = checksFor({
          ...s,
          documents: [v]
        }).filter(x => x.severity === 'error' && x.code !== 'missing-pdf' && x.documentId === v.id && !['resolved', 'exception'].includes(x.status));
        if (blocking.length) throw fail(400, blocking.map(x => x.title).join('; '));
        v.templateSnapshot = clone(t);
        v.issuedAt = now();
        const result = await renderDocument(v, s, t, async name => /^[a-f\d]{64}$/.test(name) ? blob(name).data : loadAsset(name));
        const h = await hashBytes(result.bytes);
        pending.push({
          h,
          bytes: result.bytes,
          mime: 'application/pdf',
          name: v.number + '.pdf'
        });
        v.pdfHash = h;
      }
    }
    if (op.collection === 'templates') validateTemplate(v, s);
    if (op.collection === 'payments') {
      if (old && (v.documentId !== old.documentId || v.amount !== old.amount || v.date !== old.date || old.voided && !v.voided || !v.voidReason?.trim())) throw fail(400, "Payment can only be canceled with the stated reason; write the corrected payment as a new one.");
      if (!s.documents.some(d => d.id === v.documentId && d.status === 'issued' && d.type === 'invoice') || !Number.isFinite(+v.amount) || +v.amount <= 0 || v.date && !validDate(v.date)) throw fail(400, "Invalid payment.");
    }
    if (op.collection === 'fields') {
      if (!v.name?.trim() || !['document', 'company', 'supplier', 'item'].includes(v.scope) || !['text', 'long', 'number', 'money', 'date', 'boolean', 'choice'].includes(v.type)) throw fail(400, "Invalid field definition.");
      if (old && (v.scope !== old.scope || v.type !== old.type) && s.documents.some(d => d.custom?.[old.id] !== undefined || d.customer?.custom?.[old.id] !== undefined || d.supplier?.custom?.[old.id] !== undefined || d.items.some(i => i.custom?.[old.id] !== undefined))) throw fail(400, "Do not change the type or location of the used field. Create a new field.");
    }
    if (op.collection === 'activities' && (!v.name?.trim() || !Number.isFinite(+v.price) || +v.price < 0)) throw fail(400, "The activity needs a name and a non-negative price.");
    if (op.collection === 'worklogs' && (!validDate(v.date) || !Number.isFinite(+v.hours) || +v.hours <= 0 || !v.description?.trim())) throw fail(400, "The report needs a date, a positive number of hours and a description.");
    if (op.collection === 'media') {
      if (old && v.hash !== old.hash) throw fail(400, "Upload the new image as new media to keep the old templates.");
      const b = blob(v.hash);
      if (b.mime !== v.mime) throw fail(400, "The media type does not match.");
    }
    if (op.collection === 'checks' && v.code === 'missing-pdf' && ['resolved', 'exception'].includes(v.status) && !s.documents.find(d => d.id === v.documentId)?.pdfHash) throw fail(400, "First connect a valid PDF.");
    if (op.collection === 'checks' && ['resolved', 'exception'].includes(v.status) && !v.reason?.trim()) throw fail(400, "Complete the justification of the control.");
    const at = s[op.collection].findIndex(x => x.id === op.id);
    if (at < 0) s[op.collection].push(v);else s[op.collection][at] = v;
  }
  validateState(s);
  const preview = clone(s);
  for (const op of ops) preview.audit.push({
    id: uid(),
    at: now(),
    actor: actor.name,
    actorId: actor.id,
    action: op.collection === 'config' ? 'settings' : op.delete ? 'delete' : 'save',
    collection: op.collection,
    recordId: op.id || 'config',
    before: op.collection === 'config' ? {
      supplier: current.state.supplier,
      settings: current.state.settings
    } : current.state[op.collection].find(x => x.id === op.id) || null,
    after: op.delete ? null : op.value,
    reason: input.reason || ''
  });
  await packBackup(preview, {
    ...blobs,
    ...Object.fromEntries(pending.map(b => [b.h, {
      base64: bytesBase64(b.bytes),
      mime: b.mime,
      name: b.name
    }]))
  });
  return {
    state: s,
    ops,
    pending,
    audit: preview.audit
  };
}
