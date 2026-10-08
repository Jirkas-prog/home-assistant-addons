import test from "node:test";
import assert from "node:assert/strict";
import { CatBehavior } from "../src/cat-behavior.js";
import { yarnNextHop } from "../src/cat-yarn.js";

const edges = [
  { id: "frame", left: 60, right: 160, y: 100, anchorX: 60 },
  { id: "field", left: 280, right: 380, y: 240, anchorX: 280 },
  { id: "button", left: 480, right: 650, y: 360, anchorX: 480 },
];
function create(random = 0.6, personality = "quiet") {
  const cat = new CatBehavior(() => random, personality);
  cat.setRails(
    edges.map((r) => ({ ...r })),
    0,
  );
  return cat;
}
function advance(cat, from, until) {
  for (let now = from; now <= until; now += 20) cat.tick(now);
}

test("the yarn route uses intermediate edges instead of a single giant leap", () => {
  const goal = { rail: edges[2], x: 500, y: 360 };
  const first = yarnNextHop({ x: 160, y: 100 }, edges, goal);
  assert.equal(first.rail.id, "field");
  const second = yarnNextHop(first, edges, goal);
  assert.equal(second.rail.id, "button");
  assert.equal(yarnNextHop(first, [], goal), goal);
});

test("quiet cats independently play a whole game with paws, repeated bats and both endings", () => {
  for (const random of [0, 0.6]) {
    const cat = create(random);
    assert.equal(cat.profile.cursor, false);
    assert.equal(cat.yarn.spawn({ x: 570, y: 200 }, 0), true);
    const phases = new Set(),
      perches = new Set();
    let pawRounds = 0,
      last;
    for (let now = 0; now <= 45000; now += 20) {
      cat.tick(now);
      const ball = cat.yarn.ball;
      if (!ball) break;
      phases.add(ball.phase);
      if (ball.phase === "paw" && last !== "paw") pawRounds++;
      if (cat.scene.pose === "land") perches.add(cat.railId);
      if (ball.phase === "paw")
        assert.ok(Math.abs(cat.scene.y + 57 - ball.y) < 1);
      assert.ok(Number.isFinite(ball.x) && Number.isFinite(ball.y));
      last = ball.phase;
    }
    for (const phase of [
      "fall",
      "chase",
      "paw",
      "toss",
      random ? "bury" : "hide",
    ])
      assert.ok(phases.has(phase), phase);
    assert.ok(pawRounds >= 3);
    assert.ok(perches.has("field") && perches.has("button"));
    assert.equal(cat.yarn.ball, null);
    assert.equal(cat.personality, "quiet");
    assert.equal(cat.scene.pose, "sit");
  }
});

test("one replaceable toy respects its own switch and the motion setting", () => {
  const cat = create();
  cat.yarn.setEnabled(false, 0);
  assert.equal(cat.yarn.spawn({ x: 300, y: 50 }, 0), false);
  cat.setPersonality("playful", 1);
  assert.equal(cat.yarn.enabled, false);
  cat.yarn.setEnabled(true, 2);
  cat.yarn.spawn({ x: 300, y: 50 }, 2);
  const first = cat.yarn.ball;
  cat.yarn.spawn({ x: 570, y: 200 }, 3);
  assert.notEqual(cat.yarn.ball, first);
  assert.equal(cat.yarn.ball.x, 570);
  cat.yarn.setEnabled(false, 4);
  assert.equal(cat.yarn.ball, null);
  cat.yarn.setEnabled(true, 5);
  cat.setReduced(true, 5);
  assert.equal(cat.yarn.spawn({ x: 300, y: 50 }, 6), false);
  assert.equal(cat.animated, false);
});

test("resting yarn tracks scrolling, a removed support falls again, and the paused clock stays still", () => {
  const cat = create();
  cat.yarn.spawn({ x: 570, y: 200 }, 0);
  advance(cat, 0, 3300);
  assert.equal(cat.yarn.ball.phase, "paw");
  const before = { ...cat.yarn.ball };
  cat.setRails(
    edges.map((r) => ({
      ...r,
      left: r.left + 20,
      right: r.right + 20,
      anchorX: r.anchorX + 20,
      y: r.y - 30,
    })),
    3300,
  );
  assert.equal(cat.yarn.ball.x, before.x + 20);
  assert.equal(cat.yarn.ball.y, before.y - 30);
  assert.equal(cat.yarn.ball.phase, "paw");
  const paused = { ...cat.yarn.ball };
  for (let i = 0; i < 20; i++) cat.tick(3300);
  assert.deepEqual(cat.yarn.ball, paused);
  cat.setRails([], 3320);
  assert.equal(cat.yarn.ball.phase, "fall");
  assert.equal(cat.yarn.destination.rail.id, "drop-floor");
  advance(cat, 3320, 15000);
  assert.ok(Number.isFinite(cat.scene.y));
});

test("typing and changing views stop the game; active toys never catch the pointer", () => {
  for (const action of ["typing", "context", "motion"]) {
    const cat = create(0.6, "classic");
    cat.yarn.spawn({ x: 570, y: 200 }, 0);
    advance(cat, 0, 3300);
    cat.point({ x: cat.scene.x + 47, y: cat.scene.y - 20 }, 3310);
    assert.equal(cat.scene.pose, "paw");
    if (action === "typing") cat.yieldPointer(3320, { typing: true });
    if (action === "context")
      assert.equal(cat.setContext("journal", "new", 3320), true);
    if (action === "motion") cat.setReduced(true, 3320);
    assert.equal(cat.yarn.ball, null);
  }
});

test("resizing during a drop keeps yarn inside the new viewport", () => {
  const cat = create();
  cat.yarn.spawn({ x: 850, y: 600 }, 0);
  cat.setRails([], 20, { width: 390, height: 450 });
  advance(cat, 20, 2000);
  assert.ok(cat.yarn.ball.x >= 12 && cat.yarn.ball.x <= 378);
  assert.ok(cat.yarn.ball.y <= 435);
  assert.ok(cat.scene.x <= 296 && cat.scene.y <= 378);
});
