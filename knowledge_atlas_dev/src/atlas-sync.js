import { t } from "../shared/i18n.js";
// A periodic conditional GET also detects edits made by another tab or a file
// editor, including on mounts where filesystem watcher events are unreliable.
export function createAtlasSync({
  url = "./api/atlas",
  onSnapshot,
  onHealthy = () => {},
  onError = () => {},
  onIndex = () => {},
  intervalMs = 3000,
  timeoutMs = 60_000,
  isVisible = () => true,
  fetchImpl = fetch,
}) {
  let running = false,
    timer,
    controller,
    etag = "",
    indexing = false,
    queue = Promise.resolve();
  const schedule = () => {
    clearTimeout(timer);
    if (running)
      timer = setTimeout(
        () => {
          if (isVisible()) refresh();
          else schedule();
        },
        indexing ? Math.min(intervalMs, 500) : intervalMs,
      );
  };
  function refresh({ fresh = false } = {}) {
    clearTimeout(timer);
    // Serialize background and post-save reads so older responses cannot replace
    // newer data. An explicit post-save refresh always makes its own request.
    queue = queue.then(async () => {
      if (!running) return;
      controller = new AbortController();
      const timeout = setTimeout(
        () =>
          controller.abort(
            new DOMException("The library request timed out.", "TimeoutError"),
          ),
        timeoutMs,
      );
      try {
        const response = await fetchImpl(
          fresh ? `${url}${url.includes("?") ? "&" : "?"}refresh=1` : url,
          {
            headers: etag
              ? {
                  "If-None-Match": etag,
                }
              : {},
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!running) return;
        const index = response.headers.get("X-Atlas-Index");
        if (index) {
          const progress = JSON.parse(index);
          indexing = ["building", "waiting"].includes(progress.phase);
          onIndex(progress);
        }
        if (response.status === 202) return;
        if (response.status !== 304) {
          if (!response.ok) throw new Error(t("m000"));
          const snapshot = await response.json();
          if (!running) return;
          const nextEtag = response.headers.get("etag") || snapshot.revision;
          if (!nextEtag || nextEtag !== etag) onSnapshot(snapshot);
          etag = nextEtag;
        }
        onHealthy();
      } catch (error) {
        if (running)
          onError(controller.signal.aborted ? controller.signal.reason : error);
      } finally {
        clearTimeout(timeout);
        schedule();
      }
    });
    return queue;
  }
  return {
    start() {
      if (!running) {
        running = true;
        return refresh();
      }
      return queue;
    },
    refresh,
    stop() {
      running = false;
      clearTimeout(timer);
      controller?.abort();
    },
  };
}
