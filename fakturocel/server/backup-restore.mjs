import { randomUUID } from 'node:crypto';
import { unpackBackup } from '../src/model.js';
import { readBackupFile } from './backup-formats.mjs';
import { fail } from './store.mjs';

export class BackupRestore {
  constructor(store) { this.store = store; this.tickets = new Map(); }
  async preview(bytes, name, password, actor) {
    return this.store.serial(async () => {
      this.store.role(actor, 'owner');
      const text = await readBackupFile(this.store, bytes, name, password);
      const incoming = await unpackBackup(text);
      this.store.role(actor, 'owner');
      for (const [id, t] of this.tickets) if (t.expiresAt <= Date.now() || t.actorId === actor.id) this.tickets.delete(id);
      if (this.tickets.size >= 4) this.tickets.delete(this.tickets.keys().next().value);
      const ticket = randomUUID();
      this.tickets.set(ticket, { text, actorId: actor.id, generation: this.store.generation, revision: this.store.revision, expiresAt: Date.now() + 15 * 60000 });
      return { ticket, revision: this.store.revision, documents: incoming.data.documents.length, companies: incoming.data.companies.length,
        templates: incoming.data.templates.length, attachments: Object.keys(incoming.blobs || {}).length, name };
    });
  }
  async restore(input, actor) {
    this.store.role(actor, 'owner');
    const t = this.tickets.get(input.ticket);
    if (!t || t.actorId !== actor.id || t.expiresAt <= Date.now() || t.generation !== this.store.generation)
      throw fail(400, 'The restore preview expired. Select the backup again.');
    if (input.revision !== t.revision) throw fail(409, 'Data changed after the restore preview. Select the backup again.');
    const result = await this.store.restore(t.text, t.revision, actor);
    this.tickets.delete(input.ticket);
    return result;
  }
  clear() { this.tickets.clear(); }
}
