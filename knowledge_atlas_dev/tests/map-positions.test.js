import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MapPositions } from "../server/map-positions.js";
import { createApp } from "../server/index.js";
import { Store } from "../server/store.js";
import { Settings } from "../server/settings.js";
import { Backups } from "../server/backups.js";
import { computeLayout, MAP_LAYOUTS, mapGraph } from "../src/map-layout.js";
import {
  applyMapPositions,
  createBranchDrag,
  positionSnapshot,
} from "../src/map-positions.js";
import { translate, localizeMessage, setLanguage } from "../shared/i18n.js";

const node = (id, parent = null) => ({
  schema: 2,
  id,
  parent,
  title: id,
  type: "project",
  status: "active",
  importance: 3,
  color: "#a7e87b",
  summary: "Example",
  tags: [],
  related: [],
  resources: [],
  body: "Notes",
});
const tree = [
  node("root"),
  node("branch", "root"),
  node("child", "branch"),
  node("leaf", "child"),
  node("sibling", "root"),
];
const byId = (positions, id) => positions.find((p) => p.id === id);
const coords = (p) => [p.x, p.y, p.z];
async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "atlas-map-positions-"),
  );
  t.after(async () => {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "atlas-map-positions-")),
    );
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("dragging each branch moves only its full subtree, including filtered descendants, in every mode", () => {
  for (const layout of MAP_LAYOUTS)
    for (const dimensions of [2, 3]) {
      const original = computeLayout(tree, layout, dimensions),
        saved = positionSnapshot(original);
      const visible = mapGraph(tree, original, { query: "branch" }).nodes;
      const dragged = byId(visible, "branch"),
        initial = { ...dragged };
      const drag = createBranchDrag(tree, original, "branch");
      dragged.x += 80;
      dragged.y -= 50;
      dragged.z += dimensions === 3 ? 25 : 0;
      let moved = drag(dragged, visible);
      for (const id of ["branch", "child", "leaf"])
        assert.deepEqual(
          coords(byId(moved, id)),
          coords(byId(original, id)).map(
            (v, i) => v + [80, -50, dimensions === 3 ? 25 : 0][i],
          ),
        );
      for (const id of ["root", "sibling"])
        assert.deepEqual(coords(byId(moved, id)), coords(byId(original, id)));
      dragged.x += 30;
      moved = drag(dragged, visible);
      assert.equal(byId(moved, "child").x, byId(original, "child").x + 110);
      assert.equal(dragged.fx, initial.x + 110);
      assert.deepEqual(
        positionSnapshot(original),
        saved,
        "computed cache is immutable",
      );
      const smaller = createBranchDrag(tree, moved, "child");
      const result = smaller({
        ...byId(moved, "child"),
        y: byId(moved, "child").y + 12,
      });
      for (const id of ["root", "branch", "sibling"])
        assert.deepEqual(byId(result, id), byId(moved, id));
      assert.equal(byId(result, "leaf").y, byId(moved, "leaf").y + 12);
    }
});

test("rebuilt geometry preserves saved positions and anchors new descendants to moved parents", () => {
  for (const dimensions of [2, 3]) {
    const base = computeLayout(tree, "nebula", dimensions);
    const saved = positionSnapshot(base).map((p) => ({
      ...p,
      x: p.x + 2000,
      y: p.y - 1300,
    }));
    const imported = [
      ...tree,
      node("new-child", "branch"),
      node("new-leaf", "new-child"),
    ];
    const rebuilt = computeLayout(imported, "nebula", dimensions);
    const placed = applyMapPositions(imported, rebuilt, saved);
    for (const p of saved)
      assert.deepEqual(coords(byId(placed, p.id)), coords(p));
    for (const [id, parent] of [
      ["new-child", "branch"],
      ["new-leaf", "new-child"],
    ])
      assert.deepEqual(
        coords(byId(placed, id)),
        coords(byId(placed, parent)).map(
          (v, i) =>
            v + coords(byId(rebuilt, id))[i] - coords(byId(rebuilt, parent))[i],
        ),
      );
    assert.deepEqual(
      applyMapPositions(imported, rebuilt),
      rebuilt,
      "reset restores computed positions exactly",
    );
  }
});

test("deep and malformed hierarchies do not recurse or hang during placement and dragging", () => {
  const deep = Array.from({ length: 12000 }, (_, i) => ({
    id: `n-${i}`,
    parent: i ? `n-${i - 1}` : null,
  }));
  const positions = deep.map((n, i) => ({ id: n.id, x: i, y: 0, z: 0 }));
  const shifted = applyMapPositions(deep, positions.toReversed(), [
    { id: "n-0", x: 100, y: 0, z: 0 },
  ]);
  assert.equal(byId(shifted, "n-11999").x, 12099);
  const cycle = [
    { id: "a", parent: "b" },
    { id: "b", parent: "a" },
  ];
  const points = [
    { id: "a", x: 0, y: 0, z: 0 },
    { id: "b", x: 5, y: 0, z: 0 },
  ];
  assert.equal(applyMapPositions(cycle, points).length, 2);
  assert.equal(
    createBranchDrag(cycle, points, "a")({ id: "a", x: 10, y: 20, z: 30 })[1].x,
    15,
  );
});

test("atomic positions survive restart, separate modes, retries and reset without touching records", async (t) => {
  const directory = await fixture(t),
    file = new MapPositions(directory);
  const before = await file.read(),
    positions = positionSnapshot(computeLayout(tree, "nebula", 3));
  const first = await file.save("nebula:3", positions, before.revision);
  const second = await file.save("nebula:2", positions, first.revision);
  assert.deepEqual(await new MapPositions(directory).read(), second);
  assert.deepEqual(
    await file.save("nebula:2", positions, before.revision),
    second,
    "lost response retry is idempotent",
  );
  await assert.rejects(
    file.save("nebula:3", [], before.revision),
    (e) => e.status === 409,
  );
  const reset = await file.save("nebula:3", null, second.revision);
  assert.equal(reset.views["nebula:3"], undefined);
  assert.deepEqual(reset.views["nebula:2"], first.views["nebula:3"]);
  const rename = fs.rename.bind(fs),
    raw = await fs.readFile(file.file, "utf8");
  const mock = t.mock.method(fs, "rename", async (from, to) => {
    if (to === file.file) throw new Error("Disk full");
    return rename(from, to);
  });
  await assert.rejects(file.save("grid:2", [], reset.revision), /Disk full/);
  mock.mock.restore();
  assert.equal(await fs.readFile(file.file, "utf8"), raw);
  assert.equal(
    (await fs.readdir(directory)).filter((n) => n.endsWith(".tmp")).length,
    0,
  );
});

test("invalid metadata and coordinates are rejected without overwriting saved positions", async (t) => {
  const file = new MapPositions(await fixture(t)),
    current = await file.read();
  for (const positions of [
    undefined,
    {},
    [{ id: "../file", x: 0, y: 0, z: 0 }],
    [{ id: "a", x: NaN, y: 0, z: 0 }],
    [{ id: "a", x: 1e13, y: 0, z: 0 }],
    [
      { id: "a", x: 0, y: 0, z: 0 },
      { id: "a", x: 1, y: 1, z: 1 },
    ],
  ])
    await assert.rejects(
      file.save("classic:2", positions, current.revision),
      /Invalid map positions/,
    );
  await assert.rejects(
    file.save("../file", [], current.revision),
    /Unknown map layout/,
  );
  for (const raw of [
    "{broken",
    '{"schema":1,"views":{"unknown:3":[]}}',
    "null",
  ]) {
    await fs.writeFile(file.file, raw);
    await assert.rejects(file.read(), /Invalid map positions/);
    await assert.rejects(file.save("classic:2", [], current.revision));
    assert.equal(await fs.readFile(file.file, "utf8"), raw);
  }
});

test("full backup restores custom positions alongside records and rejects corrupted geometry", async (t) => {
  const directory = await fixture(t),
    library = path.join(directory, "library"),
    store = new Store(library);
  await store.init();
  const settings = new Settings(library, false);
  await settings.init();
  await store.save(node("root"));
  const file = new MapPositions(library),
    initial = await file.read();
  const saved = await file.save(
    "classic:2",
    [{ id: "root", x: 150, y: -50, z: 0 }],
    initial.revision,
  );
  const backups = new Backups(library, settings),
    zip = path.join(directory, "portable.zip");
  await backups.export(createWriteStream(zip));
  await file.save("classic:2", null, saved.revision);
  const preview = await backups.prepare(createReadStream(zip));
  await backups.restore(preview.id, preview.revision);
  assert.deepEqual(await file.read(), saved);
  await fs.writeFile(
    file.file,
    '{"schema":1,"views":{"classic:2":[{"id":"root","x":"bad"}]}}',
  );
  const bad = path.join(directory, "bad.zip");
  await backups.export(createWriteStream(bad));
  await assert.rejects(
    backups.prepare(createReadStream(bad)),
    /Invalid map positions/,
  );
});

test("API protects writes, publishes positions in the indexed snapshot and invalidates ETags", async (t) => {
  const directory = await fixture(t),
    { app, store } = await createApp({ directory });
  await store.save(node("root"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const first = await fetch(base + "nodes"),
    snapshot = await first.json();
  const body = JSON.stringify({
    positions: [{ id: "root", x: 7, y: 8, z: 9 }],
    revision: snapshot.mapPositions.revision,
  });
  assert.equal(
    (
      await fetch(base + "map-positions/classic:3", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      })
    ).status,
    403,
  );
  const saved = await fetch(base + "map-positions/classic:3", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Knowledge-Client": "atlas",
    },
    body,
  });
  assert.equal(saved.status, 200);
  const changed = await fetch(base + "atlas", {
    headers: { "If-None-Match": first.headers.get("etag") },
  });
  assert.equal(changed.status, 200);
  assert.deepEqual((await changed.json()).mapPositions, await saved.json());
  assert.equal(
    (
      await fetch(base + "atlas", {
        headers: { "If-None-Match": changed.headers.get("etag") },
      })
    ).status,
    304,
  );
  await fs.writeFile(path.join(directory, "map-positions.json"), "{broken");
  const invalid = await (await fetch(base + "atlas")).json();
  assert.equal(invalid.nodes.length, 1);
  assert.equal(invalid.mapPositions.invalid, true);
  assert.ok(invalid.errors.some((e) => e.file === "map-positions.json"));
});

test("English and Czech map labels never change stored coordinate keys or record IDs", () => {
  const saved = [{ id: "note", x: 7, y: 8, z: 9 }],
    raw = JSON.stringify(saved);
  for (const code of ["en", "cs"]) {
    setLanguage(code);
    for (const key of [
      "map.reset",
      "map.dragHelp",
      "map.saving",
      "map.saveFailed",
      "map.retrySave",
    ])
      assert.notEqual(translate(code, key), key);
    assert.equal(
      localizeMessage(
        "Invalid map positions. Restore or repair map-positions.json.",
      ),
      translate(code, "map.invalidPositions"),
    );
    assert.equal(JSON.stringify(saved), raw);
  }
  setLanguage("en");
});
