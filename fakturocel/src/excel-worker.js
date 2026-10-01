import { Buffer } from 'buffer';
import agile from 'officecrypto-tool/src/crypto/ecma376_agile.js';
self.onmessage = e => {
  try {
    const bytes = new Uint8Array(agile.encrypt(Buffer.from(e.data.bytes), e.data.password));
    self.postMessage({
      bytes
    }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({
      error: error.message || "Excel encryption failed."
    });
  }
};
