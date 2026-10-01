import { exportWorkbook } from './excel.js';
import { clientRecoveryKey } from './client-backup.js';
export async function localExcel(client) {
  return client.run(async () => {
    client.require();
    const bytes = await exportWorkbook(client.cache.snapshot.state, await client.backupText());
    if (client.cache.encrypted === false) return bytes;
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./excel-worker.js', import.meta.url), {
          type: 'module'
        }),
        finish = (error, data) => {
          clearTimeout(timer);
          worker.terminate();
          error ? reject(Error(error)) : resolve(data);
        },
        timer = setTimeout(() => finish("Encryption took too long. Try exporting again."), 180000);
      worker.onmessage = e => finish(e.data.error, e.data.bytes);
      worker.onerror = () => finish("Excel encryption failed. No unencrypted file saved.");
      worker.postMessage({
        bytes,
        password: clientRecoveryKey(client.cache.exportContext)
      }, [bytes.buffer]);
    });
  });
}
