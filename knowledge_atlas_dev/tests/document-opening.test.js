import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import * as THREE from "three";
import { createApp } from "../server/index.js";
import { parseMarkdown, serialize, validateNode } from "../server/store.js";
import { documentType } from "../shared/document-types.js";
import { createMapActivation } from "../src/map-activation.js";
import { preserveMapCamera } from "../src/map-camera.js";
import { readRemoteText } from "../src/remote-text.js";

const record = {
  schema: 2,
  id: "manual",
  title: "Manual",
  type: "project",
  status: "active",
  parent: null,
  summary: "",
  body: "# Project notes",
  color: "#a7e87b",
  tags: [],
  related: [],
  resources: [
    { id: "readme", label: "Readme", locationId: "addon", path: "guide.md" },
  ],
  previewResourceId: "readme",
};
test("double-click references round-trip through Markdown, survive reordering and reject dangling IDs", () => {
  const parsed = validateNode(parseMarkdown(serialize(record)));
  assert.equal(parsed.previewResourceId, "readme");
  assert.equal(
    validateNode({
      ...parsed,
      resources: [
        { id: "other", label: "Other", path: "other.txt" },
        ...parsed.resources,
      ],
    }).previewResourceId,
    "readme",
  );
  assert.throws(
    () => validateNode({ ...parsed, resources: [] }),
    /existing attachment ID/,
  );
  assert.throws(
    () => validateNode({ ...parsed, previewResourceId: 1 }),
    /existing attachment ID/,
  );
  for (const previewResourceId of [undefined, null, ""])
    assert.doesNotThrow(() => validateNode({ ...parsed, previewResourceId }));
});
test("double-click opens once without single-click selection; other bubbles, background and cleanup cannot open stale targets", () => {
  const timers = new Map(),
    selections = [],
    opens = [];
  let id = 0;
  const activation = createMapActivation({
    select: (n) => selections.push(n.id),
    open: (n) => opens.push(n.id),
    setTimer: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimer: (i) => timers.delete(i),
  });
  const click = (id, x = 20) =>
    activation.click(id ? { id } : null, { clientX: x, clientY: 20 });
  const flush = () => {
    for (const [id, fn] of timers) {
      timers.delete(id);
      fn();
    }
  };
  click("a");
  click("a");
  flush();
  assert.deepEqual(opens, ["a"]);
  assert.deepEqual(selections, []);
  click("a");
  click("b");
  flush();
  assert.deepEqual(selections, ["b"]);
  assert.deepEqual(opens, ["a"]);
  click("a");
  click(null);
  flush();
  click("a");
  activation.cancel();
  flush();
  assert.deepEqual(selections, ["b"]);
  click("a");
  click("a", 80);
  flush();
  assert.deepEqual(opens, ["a"]);
  assert.deepEqual(selections, ["b", "a"]);
});
test("document closure restores 2D pan/zoom and 3D camera orientation/target without refitting", () => {
  let scale = 2.5,
    center = { x: -75, y: 122 };
  const graph = {
    zoom: (k) => (k === undefined ? scale : (scale = k)),
    centerAt: (x, y) => (x === undefined ? center : (center = { x, y })),
  };
  const restore2D = preserveMapCamera(graph, "2d");
  graph.zoom(1);
  graph.centerAt(0, 0);
  restore2D();
  assert.equal(scale, 2.5);
  assert.deepEqual(center, { x: -75, y: 122 });
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(6, 7, 8);
  camera.up.set(1, 0, 0);
  camera.lookAt(1, 2, 3);
  const quaternion = camera.quaternion.clone();
  const controls = {
    target: new THREE.Vector3(1, 2, 3),
    enabled: true,
    staticMoving: false,
  };
  const restore3D = preserveMapCamera(
    { camera: () => camera, controls: () => controls },
    "3d",
  );
  assert.equal(controls.enabled, false);
  camera.position.set(0, 0, 99);
  camera.up.set(0, 1, 0);
  camera.quaternion.identity();
  controls.target.set(0, 0, 0);
  restore3D();
  assert.deepEqual(camera.position.toArray(), [6, 7, 8]);
  assert.deepEqual(camera.up.toArray(), [1, 0, 0]);
  assert.ok(camera.quaternion.equals(quaternion));
  assert.deepEqual(controls.target.toArray(), [1, 2, 3]);
  assert.equal(controls.enabled, true);
  assert.equal(controls.staticMoving, false);
});
test("viewer types distinguish Markdown, text and inert media; executable files are never served inline", () => {
  for (const name of ["readme.MD", "notes.markdown"])
    assert.equal(documentType(name).format, "markdown");
  assert.equal(
    documentType("https://example.com/guide.md?v=1#intro", true).format,
    "markdown",
  );
  for (const extension of ["html", "svg", "js", "txt", "json", "csv"]) {
    const type = documentType(`sample.${extension}`);
    assert.equal(type.kind, "text");
    assert.equal(type.mime, undefined);
  }
  for (const [extension, kind] of [
    ["pdf", "pdf"],
    ["png", "image"],
    ["webp", "image"],
    ["mp3", "audio"],
    ["mp4", "video"],
  ])
    assert.equal(documentType(`file.${extension}`).kind, kind);
  assert.equal(
    documentType("https://example.com?file=guide.pdf", true).kind,
    "web",
  );
  assert.equal(documentType("archive.zip").kind, "download");
});
test("attachment API previews Markdown, serves media inline with ranges and preserves selections across restart", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-doc-open-"));
  const { app, store, settings } = await createApp({
    directory,
    allowOpen: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    assert.ok(directory.startsWith(path.join(os.tmpdir(), "atlas-doc-open-")));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const config = await settings.read();
  await fs.mkdir(config.documentRoot, { recursive: true });
  for (const name of [
    "guide.md",
    "picture.png",
    "movie.mp4",
    "unsafe.html",
    "unknown.zip",
  ])
    await fs.writeFile(
      path.join(config.documentRoot, name),
      name === "guide.md" ? "# Guide\n\n**Read me**" : "0123456789",
    );
  let saved = await store.save({
    ...record,
    resources: [
      ...record.resources,
      ...["picture.png", "movie.mp4", "unsafe.html", "unknown.zip"].map(
        (name, i) => ({
          id: `file-${i}`,
          label: name,
          locationId: "addon",
          path: name,
        }),
      ),
      {
        id: "remote",
        label: "Remote guide",
        locationId: "internet",
        url: "https://example.com/guide.md",
      },
    ],
  });
  const base = `http://127.0.0.1:${server.address().port}/api/nodes/manual/resources/`;
  const md = await (await fetch(base + "readme")).json();
  assert.equal(md.kind, "text");
  assert.equal(md.format, "markdown");
  assert.equal(md.body, "# Guide\n\n**Read me**");
  const png = await fetch(base + "file-0/file", {
    headers: { Range: "bytes=0-3" },
  });
  assert.equal(png.status, 206);
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.equal(png.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await png.text(), "0123");
  assert.equal(
    (await fetch(base + "file-1/file")).headers.get("content-type"),
    "video/mp4",
  );
  for (const id of ["file-2", "file-3"])
    assert.match(
      (await fetch(base + id + "/file")).headers.get("content-disposition"),
      /attachment/,
    );
  assert.match(
    (await fetch(base + "file-0/file?download=1")).headers.get(
      "content-disposition",
    ),
    /attachment/,
  );
  const remote = await (await fetch(base + "remote")).json();
  assert.equal(remote.kind, "text");
  assert.equal(remote.editable, false);
  assert.equal(remote.body, undefined);
  saved = await store.save(
    { ...saved, resources: [...saved.resources].reverse() },
    saved.id,
    saved.revision,
  );
  assert.equal(saved.previewResourceId, "readme");
  const restarted = await createApp({ directory, allowOpen: false });
  assert.equal(
    (await restarted.store.read()).nodes[0].previewResourceId,
    "readme",
  );
  assert.equal((await restarted.settings.read()).language, config.language);
  // External manual edits are indexed with the new default immediately.
  await fs.writeFile(
    path.join(directory, "manual.md"),
    serialize({ ...saved, previewResourceId: "file-0" }),
  );
  assert.equal((await store.read()).nodes[0].previewResourceId, "file-0");
});
test("remote text omits credentials and rejects oversized or non-UTF-8 documents", async (t) => {
  const signal = new AbortController().signal;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.signal, signal);
    return new Response(
      url.endsWith("large")
        ? new Uint8Array(2_000_001)
        : url.endsWith("binary")
          ? new Uint8Array([0xff, 0])
          : "# Remote notes",
    );
  });
  assert.equal(
    await readRemoteText("https://example.com/notes", signal),
    "# Remote notes",
  );
  await assert.rejects(
    readRemoteText("https://example.com/large", signal),
    /2 MB/,
  );
  await assert.rejects(
    readRemoteText("https://example.com/binary", signal),
    /UTF-8/,
  );
});
