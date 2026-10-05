import { withProgress } from './ui.js';
export async function localExcel(client) {
  return client.run(async () => {
    client.require();
    return withProgress('Generating unencrypted Excel', ({ signal, update }) => new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./excel-worker.js', import.meta.url), {
          type: 'module'
        }),
        finish = (error, data) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          worker.terminate();
          error ? reject(error instanceof Error ? error : Error(error)) : resolve(data);
        },
        abort = () => finish(new DOMException('Export cancelled.', 'AbortError')),
        timer = setTimeout(() => finish('File generation took too long. Please try exporting again.'), 180000);
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = e => e.data.percent === undefined ? finish(e.data.error, e.data.bytes) : update(e.data.percent, e.data.stage);
      worker.onerror = () => finish('File generation failed. Please try exporting again.');
      worker.postMessage({
        state: client.cache.snapshot.state,
        blobs: client.cache.snapshot.blobs
      });
    }));
  });
}
