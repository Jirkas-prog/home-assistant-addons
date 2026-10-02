import { t } from "../shared/i18n.js";
import { transferExpired } from "../shared/transfer-policy.js";

// Download chunks are written to a file or browser storage, never one giant
// ArrayBuffer. The browser-storage fallback keeps only Blob references at finish.
const requestResult = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

// getRandomValues also works on local HTTP installations without randomUUID.
const uniqueId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

async function indexedSink() {
  if (indexedDB.databases) {
    for (const database of await indexedDB.databases()) {
      const match = /^atlas-backup-(\d+)-[0-9a-f-]+$/.exec(database.name || "");
      if (match && transferExpired(Number(match[1])))
        await requestResult(indexedDB.deleteDatabase(database.name));
    }
  }
  const name = `atlas-backup-${Date.now()}-${uniqueId()}`;
  const opening = indexedDB.open(name, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore("chunks");
  const db = await requestResult(opening);
  let index = 0;
  const discard = async () => {
    db.close();
    await requestResult(indexedDB.deleteDatabase(name));
  };
  return {
    async write(chunk) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("chunks", "readwrite");
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () =>
          reject(
            tx.error ||
              new Error(
                "Browser storage is unavailable. Check free space and storage permissions.",
              ),
          );
        tx.objectStore("chunks").put(new Blob([chunk]), index++);
      });
    },
    async finish() {
      const blobs = [];
      await new Promise((resolve, reject) => {
        const cursor = db
          .transaction("chunks")
          .objectStore("chunks")
          .openCursor();
        cursor.onerror = () => reject(cursor.error);
        cursor.onsuccess = () => {
          if (!cursor.result) return resolve();
          blobs.push(cursor.result.value);
          cursor.result.continue();
        };
      });
      return new Blob(blobs, { type: "application/zip" });
    },
    discard,
  };
}

export async function createDownloadSink(filename) {
  // Picker activation must come directly from the user's Download click.
  if (globalThis.showSaveFilePicker && window.self === window.top) {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: t("data.backup"),
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      let closed = false;
      return {
        write: (chunk) => writable.write(chunk),
        async finish() {
          await writable.close();
          closed = true;
          return null;
        },
        async discard() {
          if (!closed) await writable.abort();
        },
      };
    } catch (error) {
      if (error.name === "AbortError") throw error;
      if (!["SecurityError", "NotAllowedError"].includes(error.name))
        throw error;
    }
  }
  if (navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle("atlas-backup-transfers", {
      create: true,
    });
    // Only expired temporary files in this application's dedicated directory.
    for await (const [name, entry] of folder.entries()) {
      if (entry.kind !== "file" || !/^\d+-[0-9a-f-]+\.zip$/.test(name))
        continue;
      if (transferExpired(Number(name.split("-")[0])))
        await folder.removeEntry(name).catch(() => {});
    }
    const name = `${Date.now()}-${uniqueId()}.zip`;
    const file = await folder.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    let closed = false;
    return {
      write: (chunk) => writable.write(chunk),
      async finish() {
        await writable.close();
        closed = true;
        return file.getFile();
      },
      async discard() {
        if (!closed) await writable.abort().catch(() => {});
        await folder.removeEntry(name);
      },
    };
  }
  return indexedSink();
}
