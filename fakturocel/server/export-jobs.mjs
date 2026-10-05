import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { fail } from './store.mjs';
import { backupFormats } from './backup-formats.mjs';
import { encryptText } from './encryption.mjs';

export class ExportJobs {
  constructor(store) { this.store = store; this.jobs = new Map(); this.closed = false; }
  async start(format, actor) {
    if (!backupFormats.has(format) && format !== 'fakturocel') throw fail(400, 'Choose ZIP, Excel, or both backup formats.');
    this.store.role(actor, 'read');
    if (this.closed) throw fail(503, 'The add-on is shutting down.');
    if (this.jobs.size >= 2) throw fail(429, 'Two exports are already running. Cancel or finish one before starting another.');
    const id = randomUUID(), job = { id, owner: actor.id, generation: this.store.generation, percent: 0, stage: 'Preparing complete application snapshot…' };
    this.jobs.set(id, job);
    job.timer = setTimeout(() => this.remove(id), 360000);
    job.timer.unref();
    try {
      const snapshot = await this.store.serial(async () => {
        this.check(id, actor);
        const state = this.store.read().state, text = await this.store.backupText({ encrypt: false });
        if (Buffer.byteLength(text) > 300 * 1024 * 1024) throw fail(413, 'The backup file exceeds the supported size of 300 MB.');
        const encrypted = format !== 'excel' && this.store.backupEncryption().download;
        return { state, text, format, encrypted, protectedText: encrypted ? encryptText(text, this.store.context, 'backup') : text };
      });
      this.check(id, actor);
      const worker = job.worker = new Worker(new URL('./export-worker.mjs', import.meta.url), { workerData: snapshot });
      let initialized;
      job.initialized = new Promise(resolve => { initialized = resolve; });
      worker.on('message', message => {
        if (message.initialized) {
          initialized();
          if (this.jobs.has(id)) worker.postMessage({ start: true });
          return;
        }
        if (!this.jobs.has(id)) return;
        if (message.error) { job.error = message.error; job.status = message.status; }
        else if (message.file) { job.file = message.file; job.percent = 90; job.stage = 'File ready. Downloading…'; }
        else { job.percent = Math.max(job.percent, Math.min(89, Math.floor(message.percent * .9))); job.stage = message.stage; }
      });
      worker.on('error', () => { initialized(); job.error = 'File generation failed. Please try exporting again.'; job.status = 500; });
      worker.on('exit', code => {
        initialized();
        job.worker = null;
        if (this.jobs.has(id) && !job.file && !job.error) { job.error = 'File generation stopped before completion.'; job.status = 500; }
      });
      return { id };
    } catch (error) { this.remove(id); throw error; }
  }
  check(id, actor) {
    this.store.role(actor, 'read');
    const job = this.jobs.get(id);
    if (!job) throw fail(410, 'The export has expired or was cancelled. Start a new export.');
    if (job.owner !== actor.id) throw fail(403, 'This export belongs to another user.');
    if (job.generation !== this.store.generation) { this.remove(id); throw fail(409, 'The application data was reset. Start a new export.'); }
    return job;
  }
  status(id, actor) {
    const job = this.check(id, actor);
    return { percent: job.percent, stage: job.stage, ready: !!job.file, size: job.file?.bytes.length, error: job.error, status: job.status };
  }
  take(id, actor) {
    const job = this.check(id, actor);
    if (job.error) throw fail(job.status, job.error);
    if (!job.file) throw fail(409, 'The file is still being generated.');
    const file = job.file;
    this.remove(id);
    return file;
  }
  cancel(id, actor) { this.check(id, actor); return this.remove(id); }
  async remove(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    clearTimeout(job.timer);
    if (job.worker) {
      // Finish module loading before termination; cancelling during CJS parsing can crash Node on Windows.
      await job.initialized;
      await job.worker?.terminate();
    }
    job.file = null;
  }
  async clear() { await Promise.all([...this.jobs.keys()].map(id => this.remove(id))); }
  async close() { this.closed = true; await this.clear(); }
}
