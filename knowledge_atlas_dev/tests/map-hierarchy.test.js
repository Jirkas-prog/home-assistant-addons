import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { MapPositions } from "../server/map-positions.js";
import { Store } from "../server/store.js";
import { parentChangeIssue, mapLinkId } from "../shared/map-hierarchy.js";
import { computeLayout, MAP_LAYOUTS } from "../src/map-layout.js";
import {
  applyMapPositions,
  positionSnapshot,
  createBranchDrag,
} from "../src/map-positions.js";

const record = (id, parent = null, importance = 3) => ({
  schema: 2,
  id,
  parent,
  importance,
  type: "project",
  title: `Example ${id}`,
  status: "active",
  color: "#a7e87b",
  summary: "Example",
  body: "Keep the complete notes",
  tags: [],
  related: [],
  resources: [],
});
const forest = () => [
  record("alpha", null, 1),
  record("beta", "alpha", 5),
  record("child", "beta", 5),
  record("island"),
];

test("parent changes preserve a forest and reject self-links, cycles and missing records", () => {
  const nodes = forest();
  assert.equal(parentChangeIssue(nodes, "beta", "island"), null);
  assert.equal(parentChangeIssue(nodes, "beta", null), null);
  assert.equal(parentChangeIssue(nodes, "beta", "beta"), "self");
  assert.equal(parentChangeIssue(nodes, "alpha", "child"), "cycle");
  assert.equal(parentChangeIssue(nodes, "beta", "alpha"), "unchanged");
  assert.equal(parentChangeIssue(nodes, "island", null), "unchanged");
  assert.equal(parentChangeIssue(nodes, "beta", "missing"), "missing");
  assert.equal(parentChangeIssue(nodes, "missing", null), "missing");
  assert.equal(parentChangeIssue(nodes, "beta", undefined), "missing");
  assert.equal(mapLinkId("beta"), "beta");
  assert.equal(mapLinkId({ id: "beta", x: 30 }), "beta");
});

test("all layouts size parents above children and retain positions through reparenting, detaching and rebuilds", () => {
  for (const layout of MAP_LAYOUTS)
    for (const dimensions of [2, 3]) {
      const nodes = forest(),
        computed = computeLayout(nodes, layout, dimensions);
      const byId = new Map(computed.map((p) => [p.id, p]));
      assert.ok(byId.get("alpha").r > byId.get("beta").r, layout);
      assert.ok(byId.get("beta").r > byId.get("child").r, layout);
      const snapshot = positionSnapshot(computed);
      const reparented = nodes.map((n) =>
        n.id === "beta" ? { ...n, parent: "island" } : n,
      );
      const rebuilt = applyMapPositions(
        reparented,
        computeLayout(reparented, layout, dimensions),
        snapshot,
      );
      assert.deepEqual(
        positionSnapshot(rebuilt).sort((a, b) => a.id.localeCompare(b.id)),
        [...snapshot].sort((a, b) => a.id.localeCompare(b.id)),
      );
      const drag = createBranchDrag(reparented, rebuilt, "island");
      const origin = rebuilt.find((p) => p.id === "island");
      const moved = drag({ ...origin, x: origin.x + 100, y: origin.y + 80 });
      for (const p of moved) {
        const before = snapshot.find((b) => b.id === p.id);
        assert.ok(
          Math.abs(p.x - before.x - (p.id === "alpha" ? 0 : 100)) < 1e-9,
        );
        assert.ok(
          Math.abs(p.y - before.y - (p.id === "alpha" ? 0 : 80)) < 1e-9,
        );
      }
      const detached = reparented.map((n) =>
        n.id === "beta" ? { ...n, parent: null } : n,
      );
      const result = applyMapPositions(
        detached,
        computeLayout(detached, layout, dimensions),
        moved,
      );
      for (const p of result)
        assert.deepEqual(
          positionSnapshot([p])[0],
          moved.find((m) => m.id === p.id),
        );
    }
});

async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "atlas-hierarchy-"),
  );
  const { app, store } = await createApp({ directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    store.stopBackground();
    await new Promise((resolve) => server.close(resolve));
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "atlas-hierarchy-")),
    );
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (const node of forest()) await store.save(node);
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const request = async (url, method = "GET", body, expected = 200) => {
    const response = await fetch(base + url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  };
  const positions = forest().map((n, i) => ({
    id: n.id,
    x: i * 200,
    y: i ? i * -120 : 0,
    z: 0,
  }));
  const change = async (id, parent, extra = {}, expected = 200) =>
    request(
      `nodes/${id}/parent`,
      "PUT",
      {
        parent,
        revision: (await request(`nodes/${id}`)).revision,
        slot: "classic:2",
        positions,
        mapRevision: (await request("map-positions")).revision,
        ...extra,
      },
      expected,
    );
  const travel = async (direction) =>
    request(`undo/${direction}`, "POST", {
      revision: (await request("undo")).revision,
    });
  return { directory, request, change, travel, positions, store };
}

test("reparenting keeps complete record content and saves arrangement as one persistent undo step", async (t) => {
  const { directory, request, change, travel, positions, store } =
    await fixture(t);
  const original = await request("nodes/beta");
  const result = await change("beta", "island");
  assert.equal(result.node.partial, true);
  assert.equal(result.node.parent, "island");
  const modified = await request("nodes/beta");
  for (const key of [
    "body",
    "resources",
    "related",
    "importance",
    "position",
    "positionFixed",
    "tags",
    "title",
  ])
    assert.deepEqual(modified[key], original[key], key);
  assert.equal((await request("nodes/child")).parent, "beta");
  assert.equal((await request("undo")).undo, 1);
  const sorted = [...positions].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(
    (await new MapPositions(directory).read()).views["classic:2"],
    sorted,
  );
  const reopened = new Store(directory);
  assert.equal(
    (await reopened.read()).nodes.find((n) => n.id === "beta").parent,
    "island",
  );
  reopened.stopBackground();
  await travel("undo");
  assert.equal((await request("nodes/beta")).parent, "alpha");
  assert.deepEqual((await request("map-positions")).views, {});
  await travel("redo");
  assert.equal((await request("nodes/beta")).parent, "island");
  assert.deepEqual((await request("map-positions")).views["classic:2"], sorted);
  // Insert an existing record between a parent and its current subtree.
  await change("alpha", "island");
  await change("beta", "alpha");
  assert.equal((await request("nodes/child")).parent, "beta");
  await change("alpha", null);
  assert.equal((await request("nodes/alpha")).parent, null);
  assert.equal((await request("nodes/beta")).parent, "alpha");
  assert.deepEqual((await request("map-positions")).views["classic:2"], sorted);
  // Reset arrangement keeps the edited topology and record content.
  await request("map-positions/classic:2", "PUT", {
    positions: null,
    revision: (await request("map-positions")).revision,
  });
  assert.equal((await request("nodes/beta")).parent, "alpha");
  assert.equal((await store.read()).nodes.length, 4);
});

test("invalid hierarchy edits and coordinate conflicts do not partially save or add history", async (t) => {
  const { request, change, positions } = await fixture(t);
  await change("alpha", "child", {}, 400);
  await change("beta", "beta", {}, 400);
  await change("beta", "missing", {}, 409);
  await change("beta", "island", { revision: "old" }, 409);
  await change("beta", "island", { positions: [] }, 409);
  await change(
    "beta",
    "island",
    { positions: [...positions, { id: "missing", x: 0, y: 0, z: 0 }] },
    409,
  );
  await change("beta", "island", { slot: "unknown:2" }, 400);
  await change("beta", "island", { mapRevision: "old" }, 409);
  assert.equal(
    (await request("nodes/beta")).parent,
    "alpha",
    "rolled back after the coordinate write failed",
  );
  assert.deepEqual((await request("map-positions")).views, {});
  assert.equal((await request("undo")).undo, 0);
  await change("beta", "island");
  await change("beta", "island");
  assert.equal(
    (await request("undo")).undo,
    1,
    "repeating the same placement is idempotent",
  );
});
