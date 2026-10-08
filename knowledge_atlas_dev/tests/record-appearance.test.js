import test from "node:test";
import assert from "node:assert/strict";
import {
  randomRecordColor,
  recordMapSize,
} from "../shared/record-appearance.js";
import { validateNode } from "../shared/schema.js";
import { workspaceNode } from "../shared/workspace.js";
import { serialize, parseMarkdown } from "../server/store.js";
import { computeLayout, layoutKey, MAP_LAYOUTS } from "../src/map-layout.js";
import { applyMapPositions, positionSnapshot } from "../src/map-positions.js";
import { journalFromTask, projectForTask } from "../shared/task-workflow.js";

const node = (id, parent = null) => ({
  schema: 2,
  id,
  parent,
  title: id,
  type: "project",
  status: "active",
  importance: 3,
  color: "#a7e87b",
  summary: "",
  body: "",
  tags: [],
  related: [],
  resources: [],
});

test("new colors cover the spectrum and remain ordinary portable hex values", () => {
  const colors = Array.from({ length: 24 }, (_, i) =>
    randomRecordColor(() => i / 24),
  );
  assert.equal(new Set(colors).size, 24);
  for (const color of colors) {
    assert.match(color, /^#[0-9a-f]{6}$/);
    validateNode({ ...node("example"), color });
  }
  const project = projectForTask("Project", { id: "project" });
  const journal = journalFromTask(node("task"), {
    id: "journal",
    date: "2026-10-08",
  });
  validateNode(project);
  validateNode(journal);
  assert.match(project.color, /^#[0-9a-f]{6}$/);
  assert.match(journal.color, /^#[0-9a-f]{6}$/);
});

test("appearance round-trips through Markdown and lightweight workspace projections without migrating old records", () => {
  const old = node("old");
  assert.equal(recordMapSize(old), 1);
  validateNode(old);
  assert.equal(Object.hasOwn(old, "mapSize"), false);
  for (const mapSize of [0.5, 1, 1.25, 3]) {
    const record = { ...node("custom"), color: "#7799ee", mapSize };
    validateNode(record);
    const read = parseMarkdown(serialize(record));
    assert.equal(read.mapSize, mapSize);
    assert.equal(read.color, record.color);
    for (const content of [
      "map",
      "overview",
      "tasks",
      "journal",
      "calendar",
      "records",
    ]) {
      const summary = workspaceNode(read, content);
      assert.equal(summary.mapSize, mapSize);
      assert.equal(summary.color, record.color);
    }
  }
  for (const mapSize of [0, -1, 0.49, 3.01, NaN, Infinity, "2", {}])
    assert.throws(
      () => validateNode({ ...old, mapSize }),
      (e) => e.field === "mapSize",
    );
});

test("size changes only the chosen bubble in every layout and dimension, retaining saved centers after rebuild", () => {
  const nodes = [
    node("root"),
    node("child", "root"),
    node("leaf", "child"),
    node("island"),
  ];
  for (const layout of MAP_LAYOUTS)
    for (const dimensions of [2, 3]) {
      const original = computeLayout(nodes, layout, dimensions);
      const changed = nodes.map((n) =>
        n.id === "child" ? { ...n, mapSize: 2.5 } : n,
      );
      const geometry = computeLayout(changed, layout, dimensions);
      for (const p of original)
        assert.equal(
          geometry.find((v) => v.id === p.id).r,
          p.r * (p.id === "child" ? 2.5 : 1),
        );
      assert.notEqual(
        layoutKey(nodes, layout, dimensions),
        layoutKey(changed, layout, dimensions),
      );
      assert.equal(
        layoutKey(nodes, layout, dimensions),
        layoutKey(
          nodes.map((n) => ({ ...n, color: "#7799ee", mapSize: 1 })),
          layout,
          dimensions,
        ),
      );
      const saved = positionSnapshot(original).map((p) => ({
        ...p,
        x: p.x + 123,
      }));
      assert.deepEqual(
        positionSnapshot(applyMapPositions(changed, geometry, saved)),
        saved,
      );
    }
});

test("packed layouts reserve space for large custom bubbles", () => {
  const nodes = Array.from({ length: 25 }, (_, i) => ({
    ...node(`n-${i}`, i > 3 ? `n-${Math.floor((i - 4) / 3)}` : null),
    importance: 5,
    mapSize: 3,
  }));
  for (const layout of MAP_LAYOUTS.filter((id) => id !== "classic"))
    for (const dimensions of [2, 3]) {
      const positions = computeLayout(nodes, layout, dimensions);
      for (let i = 0; i < positions.length; i++)
        for (let j = 0; j < i; j++) {
          const a = positions[i],
            b = positions[j];
          assert.ok(
            Math.hypot(a.x - b.x, a.y - b.y, dimensions === 3 ? a.z - b.z : 0) >
              a.r + b.r,
            `${layout}: ${a.id} overlaps ${b.id}`,
          );
        }
    }
});
