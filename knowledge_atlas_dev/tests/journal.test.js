import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import {
  validateNode,
  validateGraph,
  Store,
  serialize,
} from "../server/store.js";
import { Settings } from "../server/settings.js";
import { createApp } from "../server/index.js";
import { filterNodes } from "../src/atlas-model.js";
import {
  journalEntries,
  journalRange,
  journalDays,
  periodEnd,
  photoSuggestions,
} from "../shared/journal.js";
import { translate } from "../shared/i18n.js";
import { photoMetadata } from "../server/photo-metadata.js";
const record = (id = "entry") => ({
  schema: 2,
  id,
  title: "Field visit",
  type: "knowledge",
  parent: null,
  status: "active",
  color: "#b0ef88",
  summary: "A documented visit",
  body: "Notes",
  tags: [],
  related: [],
  resources: [],
  tool: {
    schema: 1,
    kind: "journal",
    date: "2026-10-01",
    minutes: 0,
    next: "",
  },
});

test("journal preserves old daily entries and supports inclusive ranges without empty day records", () => {
  const old = record("old");
  validateNode(old);
  assert.deepEqual(journalRange(old.tool), {
    start: "2026-10-01",
    end: "2026-10-01",
  });
  const week = record("week");
  Object.assign(week.tool, {
    date: "2026-11-02",
    endDate: "2026-11-08",
    period: "week",
    minutes: 1800,
  });
  validateNode(week);
  const overlap = record("overlap");
  Object.assign(overlap.tool, { date: "2026-11-04", endDate: "2026-11-12" });
  assert.equal(journalDays(week.tool), 7);
  assert.deepEqual(
    journalEntries([old, week, overlap]).map((n) => n.id),
    ["overlap", "week", "old"],
  );
  assert.deepEqual(
    journalEntries([old, week, overlap], {
      from: "2026-11-08",
      to: "2026-11-08",
    }).map((n) => n.id),
    ["overlap", "week"],
  );
  assert.equal(periodEnd("2028-02-01", "month"), "2028-02-29");
  assert.equal(periodEnd("2026-12-29", "week"), "2027-01-04");
  for (const bad of ["2026-11-01", "2026-02-30"]) {
    week.tool.endDate = bad;
    assert.throws(() => validateNode(week), /endDate/);
  }
});

test("journal validates places and searches coordinates and saved labels in manual Markdown", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-journal-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const n = record();
  n.tool.endDate = "2026-10-08";
  n.tool.places = [
    { id: "site", label: "North workshop", latitude: 50.12, longitude: 14.43 },
  ];
  await fs.writeFile(path.join(root, "entry.md"), serialize(n));
  const snapshot = await new Store(root).read();
  assert.deepEqual(snapshot.errors, []);
  assert.equal(
    filterNodes(snapshot.nodes, { query: "North workshop" }).length,
    1,
  );
  assert.equal(filterNodes(snapshot.nodes, { query: "2026-10-08" }).length, 1);
  assert.equal(filterNodes(snapshot.nodes, { query: "50.12" }).length, 1);
  n.related = ["missing"];
  assert.throws(() => validateGraph([n]), /connection/);
  n.related = [];
  n.tool.places[0].latitude = 91;
  assert.throws(() => validateNode(n), /coordinates/);
  n.tool.places = [{ id: "site", label: "Named place" }];
  assert.doesNotThrow(() => validateNode(n));
});

test("photo suggestions retain calendar dates and do not invent GPS or modification-time dates", async () => {
  const suggestions = photoSuggestions([
    {
      id: "a",
      label: "First",
      photo: { takenAt: "2026-03-29T00:30:00", latitude: 0, longitude: 0 },
    },
    {
      id: "b",
      label: "Second",
      photo: { takenAt: "2026-04-01T23:59:59", latitude: 0, longitude: 0 },
    },
    { id: "c", label: "Unknown" },
  ]);
  assert.equal(suggestions.start, "2026-03-29");
  assert.equal(suggestions.end, "2026-04-01");
  assert.equal(suggestions.places.length, 1);
  assert.equal(await photoMetadata(Buffer.from("not an image")), null);
});

test("synthetic EXIF retains camera date, offset and southern/western GPS hemispheres", async () => {
  const photo = await photoMetadata(
    await fs.readFile(new URL("./fixtures/journal-photo.jpg", import.meta.url)),
  );
  assert.deepEqual(photo, {
    takenAt: "2026-03-29T00:30:00",
    offset: "+01:00",
    latitude: -12.5,
    longitude: -45.25,
    camera: "Example Test camera",
    source: "exif",
  });
  const n = record();
  n.resources = [
    {
      id: "photo",
      label: "Equipment",
      locationId: "addon",
      path: "photo.jpg",
      photo,
    },
  ];
  assert.doesNotThrow(() => validateNode(n));
  n.resources[0].photo.takenAt = "2026-02-30T00:30:00";
  assert.throws(() => validateNode(n), /photo metadata/);
  assert.equal(photoSuggestions(n.resources).start, undefined);
});

test("journal attachments support offline Office, arbitrary text and inert binary previews", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-journal-http-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "library");
  const { app } = await createApp({ directory, allowOpen: false });
  const settings = new Settings(directory, false);
  const conf = await settings.read();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api/`,
    headers = {
      "X-Knowledge-Client": "atlas",
      "Content-Type": "application/octet-stream",
    };
  const files = {
    "notes.custom": Buffer.from("name,value\nalpha,42\n<script>inert</script>"),
    "binary.bin": Buffer.from([0, 1, 2, 255]),
    "wide.dat": Buffer.concat([
      Buffer.from([255, 254]),
      Buffer.from("Unicode text", "utf16le"),
    ]),
    "report.docx": Buffer.from(
      zipSync({
        "word/document.xml": strToU8(
          "<w:document><w:p><w:r><w:t>Field &amp; lab</w:t></w:r></w:p><w:p><w:r><w:t>Next paragraph</w:t></w:r></w:p></w:document>",
        ),
      }),
    ),
    "malicious.odt": Buffer.from(
      zipSync({
        "content.xml": strToU8(
          '<!DOCTYPE x [<!ENTITY sample "test">]><text:p>&sample;</text:p>',
        ),
      }),
    ),
  };
  const n = record();
  for (const [name, body] of Object.entries(files)) {
    const response = await fetch(base + "documents?path=" + name, {
      method: "POST",
      headers,
      body,
    });
    assert.equal(response.status, 201);
    n.resources.push(await response.json());
  }
  await new Store(directory).save(n);
  for (const r of n.resources) {
    const route = base + `nodes/entry/resources/${r.id}`;
    const text = await (await fetch(route + "/as-text")).json();
    assert.equal(text.kind, "text");
    assert.equal(text.editable, false);
    if (r.path === "notes.custom")
      assert.match(text.body, /<script>inert<\/script>/);
    if (r.path === "wide.dat") assert.equal(text.body, "Unicode text");
    if (r.path === "binary.bin") assert.equal(text.binary, true);
    if (r.path === "report.docx") {
      const doc = await (await fetch(route)).json();
      assert.equal(doc.office, true);
      assert.match(doc.body, /Field & lab\nNext paragraph/);
    }
    if (r.path === "malicious.odt")
      assert.equal((await fetch(route)).status, 400);
    const download = await fetch(route + "/file?download=1");
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), files[r.path]);
  }
  const large = n.resources[0];
  await fs.writeFile(
    path.join(conf.documentRoot, large.path),
    Buffer.alloc(2_000_100, 65),
  );
  const preview = await (
    await fetch(base + `nodes/entry/resources/${large.id}/as-text`)
  ).json();
  assert.equal(preview.truncated, true);
  assert.equal(preview.body.length, 2_000_000);
});

test("journal labels translate without modifying stored content or field names", () => {
  assert.equal(translate("en", "journal.openAsText"), "Open as text");
  assert.notEqual(
    translate("cs", "journal.openAsText"),
    translate("en", "journal.openAsText"),
  );
  const entry = record();
  const before = JSON.stringify(entry);
  translate("cs", "journal.useDates", entry.tool.date, entry.tool.date);
  assert.equal(JSON.stringify(entry), before);
});
