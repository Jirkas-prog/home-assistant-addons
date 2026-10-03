import test from "node:test";
import assert from "node:assert/strict";
import {
  computeLayout,
  layoutKey,
  mapGraph,
  MAP_LAYOUTS,
} from "../src/map-layout.js";
import { filterNodes } from "../src/atlas-model.js";
import { declutterLabels, labelEligible } from "../src/map-labels.js";
import { mapNodeGeometry, pickMapNode2D } from "../src/map-node-geometry.js";

const node = (id, parent = null, importance = 3) => ({
  id,
  parent,
  importance,
  type: "project",
  title: `Record ${id}`,
  summary: "",
  body: "",
  tags: [],
  resources: [],
  related: [],
  color: "#a7e87b",
});
function separated(positions, dimensions) {
  assert.equal(new Set(positions.map((p) => p.id)).size, positions.length);
  for (let i = 0; i < positions.length; i++) {
    const a = positions[i];
    assert.ok([a.x, a.y, a.z, a.r].every(Number.isFinite));
    for (let j = 0; j < i; j++) {
      const b = positions[j];
      const distance = Math.hypot(
        a.x - b.x,
        a.y - b.y,
        dimensions === 3 ? a.z - b.z : 0,
      );
      assert.ok(distance > a.r + b.r, `${a.id} overlaps ${b.id}`);
    }
  }
}

test("alternative layouts separate every bubble in wide, uneven and deeply nested atlases", () => {
  const wide = [
    node("root"),
    ...Array.from({ length: 1600 }, (_, i) =>
      node(`wide-${i}`, "root", (i % 5) + 1),
    ),
  ];
  const tree = [node("root")];
  for (let i = 0; i < 400; i++)
    tree.push(
      node(
        `n-${i}`,
        i < 9 ? "root" : `n-${Math.floor((i - 9) / 3)}`,
        (i % 5) + 1,
      ),
    );
  const deep = Array.from({ length: 300 }, (_, i) =>
    node(`d-${i}`, i ? `d-${i - 1}` : null),
  );
  for (const layout of MAP_LAYOUTS.filter((name) => name !== "classic"))
    for (const dimensions of [2, 3]) {
      for (const fixture of [wide, tree, deep]) {
        const positions = computeLayout(fixture, layout, dimensions);
        assert.equal(positions.length, fixture.length);
        separated(positions, dimensions);
        assert.ok(
          Math.max(...positions.map((p) => Math.hypot(p.x, p.y, p.z))) < 1e8,
          "No exponential growth on deep chains",
        );
        if (dimensions === 3 && fixture === wide)
          assert.ok(new Set(positions.map((p) => Math.round(p.z))).size > 5);
      }
    }
});

test("positions are deterministic and content edits or filters do not invalidate geometry", () => {
  const nodes = [node("root"), node("b", "root", 5), node("a", "root", 4)];
  for (const layout of MAP_LAYOUTS)
    for (const dimensions of [2, 3]) {
      const positions = computeLayout(nodes, layout, dimensions);
      const changed = nodes
        .map((n) => ({ ...n, body: "Updated notes", title: "Updated title" }))
        .reverse();
      assert.equal(
        layoutKey(nodes, layout, dimensions),
        layoutKey(changed, layout, dimensions),
      );
      assert.deepEqual(positions, computeLayout(changed, layout, dimensions));
      const graph = mapGraph(nodes, positions, { importance: [5] });
      assert.equal(graph.matchCount, 1);
      assert.equal(graph.nodes.length, 2);
      assert.equal(graph.nodes.find((n) => n.id === "root").context, true);
      assert.equal(
        graph.nodes.find((n) => n.id === "b").x,
        positions.find((n) => n.id === "b").x,
      );
    }
  const classic = computeLayout(nodes);
  assert.equal(classic[0].x, 0);
  assert.equal(Math.hypot(classic[1].x, classic[1].y), 145);
});

test("constellations use the full volume without inflating nested groups", () => {
  const nodes = [node("root")];
  for (let i = 0; i < 1200; i++)
    nodes.push(
      node(
        `n-${i}`,
        i < 9 ? "root" : `n-${Math.floor((i - 9) / 4)}`,
        (i % 5) + 1,
      ),
    );
  const positions = computeLayout(nodes, "constellations", 3);
  const ranges = ["x", "y", "z"].map(
    (axis) =>
      Math.max(...positions.map((p) => p[axis])) -
      Math.min(...positions.map((p) => p[axis])),
  );
  assert.ok(
    Math.min(...ranges) / Math.max(...ranges) > 0.5,
    "Use all three axes",
  );
  assert.ok(
    Math.max(...ranges) < 8000,
    "Do not inflate empty corners into nested spheres",
  );
  separated(positions, 3);
  const layered = computeLayout(nodes, "terraces", 3);
  const height =
    Math.max(...layered.map((p) => p.y)) - Math.min(...layered.map((p) => p.y));
  assert.ok(
    height > 2000,
    "Wide terraces spread vertically as well as horizontally",
  );
});

test("terraces center parents over separate branches and keep depth on one level", () => {
  const nodes = [
    node("root"),
    node("a", "root"),
    node("b", "root"),
    node("a1", "a"),
    node("a2", "a"),
    node("b1", "b"),
    node("b2", "b"),
  ];
  for (const dimensions of [2, 3]) {
    const points = computeLayout(nodes, "terraces", dimensions);
    const find = (id) => points.find((p) => p.id === id);
    separated(points, dimensions);
    assert.equal(find("a").y, find("b").y);
    assert.equal(Math.abs(find("a").y - find("root").y), 200);
    for (const axis of dimensions === 3 ? ["x", "z"] : ["x"])
      assert.equal(find("a")[axis], (find("a1")[axis] + find("a2")[axis]) / 2);
  }
});

test("new experiments handle empty atlases, forests, missing parents and cycles", () => {
  const nodes = [
    node("root"),
    node("child", "root"),
    node("orphan", "missing"),
    node("cycle-a", "cycle-b"),
    node("cycle-b", "cycle-a"),
    node("self", "self"),
  ];
  for (const layout of ["constellations", "terraces"])
    for (const dimensions of [2, 3]) {
      assert.deepEqual(computeLayout([], layout, dimensions), []);
      const points = computeLayout(nodes, layout, dimensions);
      assert.equal(points.length, nodes.length);
      separated(points, dimensions);
      if (dimensions === 2) assert.ok(points.every((p) => p.z === 0));
      const deep = Array.from({ length: 12000 }, (_, i) =>
        node(`d-${i}`, i ? `d-${i - 1}` : null),
      );
      const chain = computeLayout(deep, layout, dimensions);
      assert.equal(chain.length, deep.length);
      assert.ok(
        chain.every((p) =>
          [p.x, p.y, p.z].every((v) => Number.isFinite(v) && Math.abs(v) < 1e8),
        ),
      );
    }
});

test("importance, topic, text and experience filters combine and retain related task links", () => {
  const nodes = [
    node("root"),
    node("task", "root", 5),
    node("journal", "root", 4),
    node("other", null, 5),
  ];
  nodes[1].type = "task";
  nodes[2].type = "knowledge";
  nodes[2].tool = {
    kind: "journal",
    experience: true,
    date: "2026-10-02",
    minutes: 0,
    next: "",
  };
  nodes[2].related = ["task"];
  assert.deepEqual(
    filterNodes(nodes, { scope: "root", importance: [4, 5] }).map((n) => n.id),
    ["task", "journal"],
  );
  assert.deepEqual(
    filterNodes(nodes, {
      scope: "root",
      importance: [4, 5],
      type: "experience",
      query: "journal",
    }).map((n) => n.id),
    ["journal"],
  );
  assert.equal(filterNodes(nodes, { type: "task", importance: [4] }).length, 0);
  const graph = mapGraph(nodes, computeLayout(nodes, "clusters"), {
    importance: [4, 5],
  });
  assert.ok(
    graph.links.some(
      (l) =>
        l.kind === "related" && l.source === "journal" && l.target === "task",
    ),
  );
});

test("semantic labels keep screen size, avoid overlaps and hidden labels cannot intercept clicks", () => {
  const n = { ...node("a"), depth: 3, x: 0, y: 0, r: 12, extent: 80 };
  assert.equal(labelEligible(n, 0.02, "", ""), false);
  assert.equal(labelEligible(n, 1, "", ""), true);
  assert.equal(labelEligible(n, 12, "", ""), false);
  const candidates = [
    { node: n, box: [10, 10, 90, 20] },
    { node: { ...n, id: "b", importance: 5 }, box: [15, 10, 100, 20] },
    { node: { ...n, id: "c" }, box: [150, 10, 90, 20] },
  ];
  assert.deepEqual(
    [...declutterLabels(candidates, 400, 300, "a", "")],
    ["a", "c"],
  );
  const ctx = {
    save() {},
    restore() {},
    measureText(text) {
      return {
        width: text.length * parseFloat(this.font.match(/[\d.]+px/)[0]) * 0.6,
      };
    },
  };
  for (const scale of [0.1, 1, 10]) {
    const geometry = mapNodeGeometry(n, ctx, scale, "", "", new Set([n.id]));
    assert.equal(
      parseFloat(geometry.label.font.match(/[\d.]+px/)[0]) * scale,
      13,
    );
    assert.equal(
      pickMapNode2D([n], ctx, scale, { x: n.x, y: n.y }, "", "", new Set())?.id,
      "a",
    );
    assert.equal(mapNodeGeometry(n, ctx, scale, "", "", new Set()).label, null);
  }
});
