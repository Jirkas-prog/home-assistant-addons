import { parentPort, workerData } from 'node:worker_threads';
import { backupDownload } from './backup-formats.mjs';

// Compression and worksheet creation run off the HTTP thread and can be terminated.
const { state, text, format, encrypted, protectedText } = workerData;
parentPort.postMessage({ initialized: true });
await new Promise(resolve => parentPort.once('message', resolve));
const snapshot = {
  read: () => ({ state }),
  backupEncryption: () => ({ download: encrypted }),
  backupText: async ({ encrypt = encrypted } = {}) => encrypt ? protectedText : text
};
try {
  const file = await backupDownload(snapshot, format, (percent, stage) => parentPort.postMessage({ percent, stage }));
  const bytes = Uint8Array.from(file.bytes);
  parentPort.postMessage({ file: { ...file, bytes } }, [bytes.buffer]);
} catch (error) {
  parentPort.postMessage({ error: error.message, status: error.status || 400 });
}
