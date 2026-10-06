import test from "node:test";
import assert from "node:assert/strict";
import { loadJournalPreviews } from "../src/journal-previews.js";
import { JOURNAL_PREVIEW_LIMIT as LIMIT } from "../shared/preview-limits.js";

const metadata = (size, extra = {}) =>
  Response.json({ size, kind: "image", mime: "image/png", ...extra });
const resources = (ids) => ids.map((id) => ({ id }));
test("automatic journal downloads are sequential and respect the inclusive 10 MB limit", async () => {
  const requests = [],
    updates = [];
  let pending = 0,
    maximum = 0;
  await loadJournalPreviews(
    "entry",
    resources(["small", "limit", "large", "unknown", "web"]),
    {
      signal: new AbortController().signal,
      onUpdate: (id, item) => updates.push({ id, ...item }),
      fetchImpl: async (url) => {
        requests.push(url);
        pending++;
        maximum = Math.max(maximum, pending);
        await new Promise((resolve) => setTimeout(resolve, 2));
        pending--;
        if (url.endsWith("metadata=1")) {
          if (url.includes("/limit?")) return metadata(LIMIT);
          if (url.includes("/large?")) return metadata(LIMIT + 1);
          if (url.includes("/unknown?")) return metadata(undefined);
          if (url.includes("/web?"))
            return metadata(1, { url: "https://example.com/image.png" });
          return metadata(3);
        }
        return new Response(
          new Uint8Array(url.includes("/limit/") ? LIMIT : 3),
        );
      },
    },
  );
  assert.equal(maximum, 1);
  assert.deepEqual(
    requests.map((s) => s.split("/resources/")[1]),
    [
      "small?metadata=1",
      "small/file?preview=1",
      "limit?metadata=1",
      "limit/file?preview=1",
      "large?metadata=1",
      "unknown?metadata=1",
      "web?metadata=1",
    ],
  );
  assert.equal(
    updates.find((s) => s.id === "limit" && s.status === "ready").blob.size,
    LIMIT,
  );
  assert.equal(updates.filter((s) => s.status === "manual").length, 3);
});
test("closing an entry aborts its active download and never starts its next attachment", async () => {
  const abort = new AbortController(),
    requests = [],
    updates = [];
  await loadJournalPreviews("entry", resources(["first", "next"]), {
    signal: abort.signal,
    onUpdate: (id, item) => updates.push(item.status),
    fetchImpl: async (url, { signal }) => {
      requests.push(url);
      if (url.endsWith("metadata=1")) return metadata(3);
      return new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        abort.abort();
      });
    },
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(updates, ["loading"]);
});
test("oversized streamed responses are cancelled even when advertised size is small", async () => {
  let cancelled = false;
  const statuses = [];
  await loadJournalPreviews("entry", resources(["growing"]), {
    signal: new AbortController().signal,
    onUpdate: (_, item) => statuses.push(item.status),
    fetchImpl: async (url) =>
      url.endsWith("metadata=1")
        ? metadata(1)
        : new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(LIMIT + 1));
              },
              cancel() {
                cancelled = true;
              },
            }),
          ),
  });
  assert.ok(cancelled);
  assert.deepEqual(statuses, ["loading", "manual"]);
});
test("one inaccessible file does not block later previews and server size refusals stay manual", async () => {
  const states = [];
  await loadJournalPreviews("entry", resources(["broken", "grown", "last"]), {
    signal: new AbortController().signal,
    onUpdate: (id, item) => states.push([id, item.status]),
    fetchImpl: async (url) => {
      if (url.includes("/broken?"))
        return new Response("Missing", { status: 404 });
      if (url.endsWith("metadata=1")) return metadata(1);
      return url.includes("/grown/")
        ? new Response("Too large", { status: 413 })
        : new Response("x");
    },
  });
  assert.deepEqual(states, [
    ["broken", "loading"],
    ["broken", "failed"],
    ["grown", "loading"],
    ["grown", "manual"],
    ["last", "loading"],
    ["last", "ready"],
  ]);
});
