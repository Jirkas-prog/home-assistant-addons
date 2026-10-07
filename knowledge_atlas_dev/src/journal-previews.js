import { JOURNAL_PREVIEW_LIMIT } from "../shared/preview-limits.js";
import { TransferMeter } from "./transfer-progress.js";

// One original at a time; the caller owns the lifetime of the open entry.
export async function loadJournalPreviews(
  nodeId,
  resources,
  { signal, onUpdate, fetchImpl = fetch, idleMs = 60_000 },
) {
  for (const resource of resources) {
    if (signal.aborted) return;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    let timeout;
    const heartbeat = () => {
      clearTimeout(timeout);
      timeout = setTimeout(cancel, idleMs);
    };
    heartbeat();
    let metadata;
    const update = (value) => {
      if (!signal.aborted) onUpdate(resource.id, { metadata, ...value });
    };
    try {
      update({ status: "loading" });
      const base = `./api/nodes/${encodeURIComponent(nodeId)}/resources/${encodeURIComponent(resource.id)}`;
      const response = await fetchImpl(base + "?metadata=1", {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Attachment metadata is unavailable.");
      metadata = await response.json();
      heartbeat();
      if (
        !Number.isSafeInteger(metadata.size) ||
        metadata.size < 0 ||
        metadata.size > JOURNAL_PREVIEW_LIMIT ||
        metadata.url ||
        ["place", "folder"].includes(metadata.kind)
      ) {
        update({ status: "manual" });
        continue;
      }
      const file = await fetchImpl(base + "/file?preview=1", {
        signal: controller.signal,
      });
      heartbeat();
      if (file.status === 413) {
        update({ status: "manual" });
        continue;
      }
      if (!file.ok) throw new Error("The attachment could not be downloaded.");
      if (Number(file.headers.get("Content-Length")) > JOURNAL_PREVIEW_LIMIT) {
        await file.body?.cancel();
        update({ status: "manual" });
        continue;
      }
      const reader = file.body.getReader(),
        chunks = [],
        meter = new TransferMeter();
      const cancelReader = () => {
        reader.cancel().catch(() => {});
      };
      controller.signal.addEventListener("abort", cancelReader, { once: true });
      let total = 0,
        reported = -Infinity;
      const progress = (force = false) => {
        const now = performance.now();
        if (force || now - reported >= 150) {
          reported = now;
          update({
            status: "loading",
            loaded: total,
            total: metadata.size,
            ...meter.update(total, metadata.size),
          });
        }
      };
      progress(true);
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          heartbeat();
          total += value.byteLength;
          if (total > JOURNAL_PREVIEW_LIMIT) break;
          chunks.push(value);
          progress();
        }
      } finally {
        controller.signal.removeEventListener("abort", cancelReader);
        await reader.cancel();
        reader.releaseLock();
      }
      controller.signal.throwIfAborted();
      if (total <= JOURNAL_PREVIEW_LIMIT && total !== metadata.size)
        throw new Error(
          "The attachment changed or the transfer is incomplete.",
        );
      update(
        total > JOURNAL_PREVIEW_LIMIT
          ? { status: "manual" }
          : {
              status: "ready",
              blob: new Blob(chunks, {
                type:
                  metadata.mime ||
                  file.headers.get("Content-Type") ||
                  "application/octet-stream",
              }),
            },
      );
    } catch {
      update({ status: "failed" });
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
    }
  }
}
