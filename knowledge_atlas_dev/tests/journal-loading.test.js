import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { serialize } from "../server/store.js";

test("journal navigation is lightweight, searchable and cannot overwrite complete entries", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "atlas-journal-loading-"),
  );
  const directory = path.join(root, "library");
  await fs.mkdir(directory);
  t.after(async () => {
    assert.ok(
      path
        .resolve(root)
        .startsWith(path.join(os.tmpdir(), "atlas-journal-loading-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const record = (id, extra = {}) => ({
    schema: 2,
    id,
    title: `Example ${id}`,
    type: "knowledge",
    parent: null,
    status: "active",
    importance: 3,
    color: "#be91df",
    tags: [],
    related: [],
    resources: [],
    summary: "Example summary",
    body: "Detailed reference material. ".repeat(8000),
    ...extra,
  });
  for (let i = 0; i < 30; i++)
    await fs.writeFile(
      path.join(directory, `note-${i}.md`),
      serialize(record(`note-${i}`)),
    );
  await fs.writeFile(
    path.join(directory, "project.md"),
    serialize(record("project", { type: "project" })),
  );
  await fs.writeFile(
    path.join(directory, "task.md"),
    serialize(record("task", { type: "task", task: { start: "", due: "" } })),
  );
  const entry = record("journal", {
    projectId: "project",
    related: ["task"],
    tags: ["Workshop"],
    body: "The copper prototype passed the endurance review.",
    tool: {
      schema: 1,
      kind: "journal",
      date: "2026-10-01",
      endDate: "2026-10-07",
      period: "week",
      startTime: "09:00",
      endTime: "16:00",
      minutes: 60,
      next: "Repeat the review",
      experience: true,
      places: [{ id: "lab", label: "Laboratory", latitude: 50, longitude: 15 }],
    },
    resources: [
      {
        id: "photo",
        locationId: "addon",
        path: "example-photo.png",
        label: "Microscope photograph",
      },
    ],
  });
  await fs.writeFile(path.join(directory, "journal.md"), serialize(entry));
  const { app, store, settings } = await createApp({ directory });
  const config = await settings.read();
  await fs.mkdir(config.documentRoot, { recursive: true });
  const attachment = path.join(config.documentRoot, "example-photo.png");
  await fs.writeFile(attachment, "Example attachment bytes");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        store.stopBackground();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  let attachmentReads = 0,
    mapReads = 0;
  const readFile = fs.readFile.bind(fs);
  t.mock.method(fs, "readFile", async (file, ...args) => {
    if (String(file) === attachment) attachmentReads++;
    if (path.basename(String(file)) === "map-positions.json") mapReads++;
    return readFile(file, ...args);
  });
  const response = await fetch(base + "workspace?content=journal&refresh=1");
  assert.equal(response.status, 200);
  const light = await response.json();
  assert.equal(light.content, "journal");
  assert.equal(light.nodes.length, 33);
  assert.ok(
    light.nodes.every((n) => n.partial && !n.body && !n.resources.length),
  );
  const summary = light.nodes.find((n) => n.id === "journal");
  assert.equal(summary.resourceCount, 1);
  assert.equal(summary.tool.date, entry.tool.date);
  assert.equal(summary.tool.endDate, entry.tool.endDate);
  assert.equal(summary.tool.startTime, entry.tool.startTime);
  assert.equal(summary.tool.endTime, entry.tool.endTime);
  assert.equal(summary.tool.experience, true);
  assert.deepEqual(summary.related, ["task"]);
  assert.deepEqual(summary.tags, ["Workshop"]);
  assert.deepEqual(summary.tool.places, entry.tool.places);
  assert.equal(summary.projectId, "project");
  assert.equal(light.mapPositions, undefined);
  assert.equal(
    (
      await fetch(base + "workspace?content=journal", {
        headers: { "If-None-Match": response.headers.get("ETag") },
      })
    ).status,
    304,
  );
  const completeResponse = await fetch(base + "workspace?content=records", {
    headers: { "If-None-Match": response.headers.get("ETag") },
  });
  assert.equal(completeResponse.status, 200);
  const complete = await completeResponse.json();
  assert.ok(
    JSON.stringify(light).length < JSON.stringify(complete).length / 100,
  );
  for (const query of ["copper", "Microscope", "Laboratory", "Workshop"]) {
    const matches = await (
      await fetch(base + "journal/search?q=" + query)
    ).json();
    assert.deepEqual(
      matches.ids,
      ["journal"],
      `Search includes unloaded entry content: ${query}`,
    );
  }
  assert.deepEqual(
    (await (await fetch(base + "journal/search?q=reference")).json()).ids,
    [],
    "Journal search excludes ordinary knowledge records",
  );
  const full = await (await fetch(base + "nodes/journal")).json();
  assert.equal(full.body, entry.body);
  assert.deepEqual(full.resources, entry.resources);
  assert.equal(full.tool.next, entry.tool.next);
  assert.equal(full.partial, undefined);
  const isolated = await store.readNode("journal");
  isolated.title = "Unsaved change";
  isolated.resources[0].label = "Unsaved attachment change";
  assert.equal((await store.readNode("journal")).title, entry.title);
  assert.equal(
    (await store.readNode("journal")).resources[0].label,
    entry.resources[0].label,
  );
  assert.equal(await store.readNode("absent"), undefined);
  const headers = {
    "Content-Type": "application/json",
    "X-Knowledge-Client": "atlas",
  };
  const rejected = await fetch(base + "nodes/journal", {
    method: "PUT",
    headers,
    body: JSON.stringify({ ...summary, schema: 2 }),
  });
  assert.equal(rejected.status, 400);
  const saved = await fetch(base + "nodes/journal", {
    method: "PUT",
    headers,
    body: JSON.stringify({ ...full, importance: 5 }),
  });
  assert.equal(saved.status, 200);
  const changed = await saved.json();
  assert.equal(changed.body, entry.body);
  assert.deepEqual(changed.resources, entry.resources);
  await fs.writeFile(
    path.join(directory, "journal.md"),
    serialize({ ...changed, body: "Manual laboratory discovery" }),
  );
  const fresh = await (
    await fetch(base + "workspace?content=journal&refresh=1")
  ).json();
  assert.notEqual(fresh.revision, light.revision);
  assert.deepEqual(
    (await (await fetch(base + "journal/search?q=discovery")).json()).ids,
    ["journal"],
  );
  assert.deepEqual(
    (await (await fetch(base + "journal/search?q=copper")).json()).ids,
    [],
  );
  assert.equal(
    attachmentReads,
    0,
    "Listing, searching and editing do not read attachment contents",
  );
  assert.equal(
    mapReads,
    0,
    "Journal navigation never reads saved map positions",
  );
  // Metadata requests inspect sizes without reading even a text attachment.
  const edited = await (await fetch(base + "nodes/journal")).json();
  edited.resources.push({
    id: "text",
    locationId: "addon",
    path: "notes.txt",
    label: "Notes",
  });
  const textFile = path.join(config.documentRoot, "notes.txt");
  await fs.writeFile(textFile, "Example text");
  assert.equal(
    (
      await fetch(base + "nodes/journal", {
        method: "PUT",
        headers,
        body: JSON.stringify(edited),
      })
    ).status,
    200,
  );
  let textReads = 0;
  t.mock.method(fs, "readFile", async (file, ...args) => {
    if (String(file) === textFile) textReads++;
    return readFile(file, ...args);
  });
  const info = await (
    await fetch(base + "nodes/journal/resources/text?metadata=1")
  ).json();
  assert.equal(info.size, 12);
  assert.equal(info.kind, "text");
  assert.equal(info.body, undefined);
  assert.equal(textReads, 0);
  assert.equal(
    (await fetch(base + "nodes/journal/resources/text/file?preview=1")).status,
    200,
  );
  await fs.writeFile(textFile, Buffer.alloc(10_000_001, 65));
  const oversized = await fetch(
    base + "nodes/journal/resources/text/file?preview=1",
  );
  assert.equal(oversized.status, 413);
  const original = await fetch(
    base + "nodes/journal/resources/text/file?download=1",
  );
  assert.equal(original.status, 200);
  assert.equal((await original.arrayBuffer()).byteLength, 10_000_001);
  assert.equal(
    textReads,
    0,
    "Metadata and original streaming do not load text into the editor",
  );
});
