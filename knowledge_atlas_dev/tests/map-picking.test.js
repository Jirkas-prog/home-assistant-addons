import test from "node:test";
import assert from "node:assert/strict";
import {
  mapNodeRadius,
  mapNodeGeometry,
  paintMapNodePointer,
  pickMapNode2D,
} from "../src/map-node-geometry.js";

test("project importance changes map radius while legacy projects and other types keep their size", () => {
  for (const depth of [0, 1, 5, 100]) {
    const base = 32 / (1 + depth * 0.65);
    const radius = (importance) =>
      mapNodeRadius({ type: "project", importance }, depth);
    assert.equal(radius(undefined), base);
    assert.equal(radius(null), base);
    assert.equal(radius(3), base);
    assert.equal(radius("normal"), base);
    assert.equal(radius("low"), radius(1));
    assert.equal(radius("high"), radius(5));
    for (const rating of [1, 2, 3, 4])
      assert.ok(radius(rating) < radius(rating + 1));
    assert.equal(
      mapNodeRadius({ type: "item", importance: 5 }, depth),
      radius(5),
    );
    assert.ok(Number.isFinite(radius("invalid")));
    for (const type of ["category", "knowledge", "skill", "code", "task"]) {
      assert.equal(mapNodeRadius({ type, importance: "high" }, depth), base);
    }
  }
});

test("resized project bubbles remain clickable at their visible edges", () => {
  const ctx = pickingCanvas();
  for (const importance of [1, 2, 3, 4, 5]) {
    const node = {
      id: "project",
      type: "project",
      title: "Project",
      importance,
      depth: 2,
      x: 0,
      y: 0,
    };
    node.r = mapNodeRadius(node, node.depth);
    assert.equal(
      pickMapNode2D([node], ctx, 1, { x: node.r * 0.99, y: 0 }, "other", null)
        ?.id,
      node.id,
    );
  }
});

function pickingCanvas() {
  const shapes = [];
  return {
    font: "12px sans-serif",
    save() {},
    restore() {},
    beginPath() {},
    measureText(text) {
      return {
        width: text.length * Number(this.font.match(/([\d.]+)px/)[1]) * 0.6,
      };
    },
    arc(x, y, radius) {
      shapes.push({
        color: this.fillStyle,
        contains: (px, py) => Math.hypot(px - x, py - y) <= radius,
      });
    },
    fill() {},
    fillRect(x, y, width, height) {
      shapes.push({
        color: this.fillStyle,
        contains: (px, py) =>
          px >= x && px <= x + width && py >= y && py <= y + height,
      });
    },
    pick(x, y) {
      return shapes.findLast((shape) => shape.contains(x, y))?.color;
    },
  };
}

const nodes = [
  { id: "root", title: "Atlas", depth: 0, x: 0, y: 0, r: 32 },
  { id: "left", title: "Study notes", depth: 1, x: -145, y: 0, r: 19 },
  { id: "right", title: "Projects", depth: 1, x: 145, y: 0, r: 19 },
  { id: "project", title: "Example project", depth: 2, x: 290, y: 0, r: 14 },
  { id: "task", title: "Project task", depth: 3, x: 435, y: 0, r: 10 },
];

test("overlapping click padding and labels never block another visible 2D bubble", () => {
  const ctx = pickingCanvas();
  const crowded = [
    { id: "small", title: "Small record", depth: 6, x: 0, y: 0, r: 1 },
    { id: "nearby", title: "Nearby record", depth: 7, x: 4, y: 0, r: 1 },
  ];
  // Both enlarged targets overlap. Each visible center must still select itself.
  for (const node of crowded) {
    assert.equal(
      pickMapNode2D(crowded, ctx, 0.5, node, "nearby", null).id,
      node.id,
    );
  }
  assert.equal(
    pickMapNode2D(crowded, ctx, 0.5, { x: 4, y: -8 }, "nearby", null).id,
    "nearby",
  );
  const label = mapNodeGeometry(crowded[1], ctx, 1, "nearby", null).label;
  const [x, y, width, height] = label.box;
  const point = { x: x + width / 2, y: y + height / 2 };
  assert.equal(
    pickMapNode2D(crowded, ctx, 1, point, "nearby", null).id,
    "nearby",
  );
  crowded[0] = { ...crowded[0], ...point };
  assert.equal(
    pickMapNode2D(crowded, ctx, 1, point, "nearby", null).id,
    "small",
  );
  assert.equal(
    pickMapNode2D(crowded, ctx, 1, { x: 500, y: 500 }, "nearby", null),
    null,
  );
});

test("every displayed bubble remains selectable from root, another branch and a deeply selected record", () => {
  for (const selected of ["root", "left", "task", "outside-current-map"]) {
    for (const scale of [0.5, 1, 4]) {
      const ctx = pickingCanvas();
      for (const node of nodes)
        paintMapNodePointer(node, node.id, ctx, scale, selected, null);
      for (const node of nodes) assert.equal(ctx.pick(node.x, node.y), node.id);
    }
  }
});

test("visible labels on either side and below a node open the same record as its bubble", () => {
  for (const node of nodes) {
    for (const scale of [0.4, 1, 4]) {
      const ctx = pickingCanvas();
      // Active labels remain visible even when zoomed out.
      const { label } = mapNodeGeometry(node, ctx, scale, node.id, null);
      paintMapNodePointer(node, node.id, ctx, scale, node.id, null);
      const [x, y, width, height] = label.box;
      assert.equal(ctx.pick(x + width / 2, y + height / 2), node.id);
      assert.equal(ctx.pick(x + 1 / scale, y + 1 / scale), node.id);
      assert.equal(
        ctx.pick(x + width - 1 / scale, y + height - 1 / scale),
        node.id,
      );
    }
  }
});

test("tiny deep bubbles keep a 24-pixel target after zoom changes without invisible label targets", () => {
  const node = {
    id: "deep",
    title: "Deep record",
    depth: 100,
    x: 0,
    y: 0,
    r: 0.5,
  };
  for (const scale of [0.08, 0.25, 0.75, 8]) {
    const ctx = pickingCanvas();
    paintMapNodePointer(node, node.id, ctx, scale, "another-record", null);
    assert.equal(ctx.pick(-11 / scale, 0), node.id);
    assert.equal(ctx.pick(-13 / scale, 0), undefined);
    if (scale <= 0.85) {
      assert.equal(
        mapNodeGeometry(node, ctx, scale, "another-record", null).label,
        null,
      );
    }
  }
});
