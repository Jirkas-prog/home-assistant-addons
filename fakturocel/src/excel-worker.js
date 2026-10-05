import { exportWorkbook } from './excel.js';
import { packBackup } from './model.js';
self.onmessage = async e => {
  try {
    const bytes = await exportWorkbook(e.data.state, await packBackup(e.data.state, e.data.blobs),
      (percent, stage) => self.postMessage({ percent, stage }));
    self.postMessage({
      bytes
    }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({
      error: error.message || 'File generation failed. Please try exporting again.'
    });
  }
};
