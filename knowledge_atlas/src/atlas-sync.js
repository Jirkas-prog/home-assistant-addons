import { t, locale } from "../shared/i18n.js";
// A periodic conditional GET also detects edits made by another tab or a file
// editor, including on mounts where filesystem watcher events are unreliable.
export function createAtlasSync({
  url = "./api/nodes",
  onSnapshot,
  onHealthy = () => {},
  onError = () => {},
  intervalMs = 3000,
  isVisible = () => true,
  fetchImpl = fetch,
}) {
  let running = false,
    timer,
    controller,
    etag = "",
    queue = Promise.resolve();
  const schedule = () => {
    clearTimeout(timer);
    if (running)
      timer = setTimeout(() => {
        if (isVisible()) refresh();
        else schedule();
      }, intervalMs);
  };
  function refresh() {
    clearTimeout(timer);
    // Serialize background and post-save reads so older responses cannot replace
    // newer data. An explicit post-save refresh always makes its own request.
    queue = queue.then(async () => {
      if (!running) return;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetchImpl(url, {
          headers: etag
            ? {
                "If-None-Match": etag,
              }
            : {},
          cache: "no-store",
          signal: controller.signal,
        });
        if (!running) return;
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
        if (running) onError(error);
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
