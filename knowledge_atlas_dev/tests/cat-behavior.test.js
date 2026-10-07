import test from "node:test";
import assert from "node:assert/strict";
import { CatBehavior, catFreeIntervals } from "../src/cat-behavior.js";

const rails = [{ id: "panel", left: 100, right: 600, y: 260 }];

test("compact fallback perches keep the complete cat clear of save controls and status text", () => {
  const controls = [
    { left: 219, right: 337, top: 787, bottom: 824, width: 118 },
    { left: 26, right: 65, top: 794, bottom: 810, width: 39 },
  ];
  assert.deepEqual(catFreeIntervals(8, 288, 768, controls), [[71, 119]]);
  assert.deepEqual(catFreeIntervals(20, 10, 768, controls), []);
});
function create() {
  const cat = new CatBehavior(() => 0.5);
  cat.setRails(rails, 0, { width: 1100, height: 800 });
  return cat;
}
function advance(cat, from, to, step = 16) {
  for (let t = from; t < to; t += step) cat.tick(t);
  cat.tick(to);
}

test("the cat sits, walks a short distance, grooms, sleeps and wakes without disappearing", () => {
  const cat = create();
  const poses = new Set();
  let before = { ...cat.scene };
  for (let time = 0; time < 120000; time += 16) {
    cat.tick(time);
    poses.add(cat.scene.pose);
    assert.equal(cat.scene.visible, true);
    assert.ok(Math.hypot(cat.scene.x - before.x, cat.scene.y - before.y) < 6);
    before = { ...cat.scene };
  }
  for (const pose of [
    "sit",
    "rise",
    "walk",
    "groom",
    "sleep",
    "wake",
    "land",
    "peek",
  ])
    assert.ok(poses.has(pose), pose);
  const resting = create();
  resting.tick(4999);
  assert.equal(resting.scene.pose, "sit");
  resting.tick(5000);
  assert.equal(resting.scene.pose, "rise");
  assert.ok(Math.abs(resting.queued.target.x - resting.scene.x) >= 75);
  assert.ok(Math.abs(resting.queued.target.x - resting.scene.x) <= 130);
});

test("opening a dialog interrupts a walk continuously and reaches its edge within three seconds", () => {
  const cat = create();
  advance(cat, 0, 5900);
  const position = { ...cat.scene };
  cat.setRails([{ id: "editor", left: 300, right: 700, y: 150 }], 5900, {
    priority: true,
  });
  assert.equal(cat.scene.x, position.x);
  assert.equal(cat.scene.y, position.y);
  advance(cat, 5900, 8800);
  assert.equal(cat.scene.y, 150);
  assert.equal(cat.railId, "editor");
  assert.ok(cat.scene.visible);
});

test("scroll and resize retarget the current frame instead of resetting or hiding the cat", () => {
  const cat = create();
  cat.travel({ id: "next", left: 20, right: 900, y: 500 }, 900, 0);
  advance(cat, 0, 700);
  const before = { ...cat.scene };
  const moved = [{ id: "next", left: 50, right: 220, y: 180 }];
  cat.setRails(moved, 700, { width: 400, height: 600 });
  assert.deepEqual(
    { x: cat.scene.x, y: cat.scene.y },
    { x: before.x, y: before.y },
  );
  advance(cat, 700, 3000);
  assert.equal(cat.scene.y, 180);
  assert.ok(cat.scene.x <= 220);
  assert.ok(cat.scene.visible);
  cat.setRails(moved, 3001);
  assert.notEqual(cat.scene.pose, "hide");
});

test("a reachable cursor is caught for three seconds, followed, then released with a cooldown", () => {
  for (const dx of [-40, 40]) {
    const cat = create();
    const pointer = { x: cat.scene.x + 47 + dx, y: cat.scene.y - 50 };
    cat.point(pointer, 100);
    assert.equal(cat.scene.pose, "hunt");
    advance(cat, 100, 1450, 10);
    assert.equal(cat.scene.pose, "cling");
    const caughtAt = cat.deadline - 3000;
    const before = cat.scene.x;
    cat.point({ x: pointer.x + 80, y: pointer.y - 20 }, 1500);
    advance(cat, 1500, 2000, 10);
    assert.ok(cat.scene.x > before + 65);
    cat.tick(caughtAt + 2999);
    assert.equal(cat.scene.pose, "cling");
    cat.tick(caughtAt + 3000);
    assert.notEqual(cat.scene.pose, "cling");
    advance(cat, caughtAt + 3000, 7500);
    assert.equal(cat.scene.y, rails[0].y);
    cat.point({ x: cat.scene.x + 47, y: cat.scene.y - 20 }, 7501);
    assert.notEqual(cat.scene.pose, "hunt");
  }
});

test("the cursor can escape before takeoff or in midair; leaving the page releases the cat", () => {
  const cat = create();
  cat.point({ x: 650, y: 210 }, 100);
  cat.point({ x: 20, y: 20 }, 200);
  cat.tick(751);
  assert.equal(cat.scene.pose, "sit");
  cat.cooldown = 0;
  cat.point({ x: 650, y: 210 }, 800);
  cat.tick(1450);
  assert.equal(cat.scene.pose, "pounce");
  cat.point({ x: 20, y: 20 }, 1500);
  advance(cat, 1500, 2200);
  assert.notEqual(cat.scene.pose, "cling");
  const second = create();
  second.point({ x: 650, y: 210 }, 100);
  advance(second, 100, 1450, 10);
  assert.equal(second.scene.pose, "cling");
  second.point(null, 1451);
  second.tick(1451);
  assert.notEqual(second.scene.pose, "cling");
});

test("reduced motion stays still and does not hunt, even when panels change", () => {
  const cat = create();
  cat.setReduced(true, 100);
  cat.point({ x: 650, y: 210 }, 200);
  const before = { ...cat.scene };
  advance(cat, 200, 20000);
  assert.deepEqual(cat.scene, before);
  cat.setRails([{ id: "editor", left: 400, right: 700, y: 200 }], 21000, {
    priority: true,
  });
  assert.equal(cat.scene.y, 200);
  assert.equal(cat.animated, false);
  cat.setReduced(false, 22000);
  assert.equal(cat.scene.pose, "sit");
});

test("a stationary nearby cursor is noticed after walking, without needing another mouse event", () => {
  const cat = create();
  cat.travel(rails[0], 500, 0);
  cat.point({ x: 550, y: 210 }, 100);
  advance(cat, 0, 2800);
  assert.ok(["hunt", "pounce", "cling"].includes(cat.scene.pose));
});

test("exploring uses other panel edges, and no empty-layout refresh erases the current position", () => {
  const cat = create();
  const second = { id: "second", left: 150, right: 500, y: 480 };
  cat.setRails([...rails, second], 0);
  cat.step = 2;
  cat.tick(5000);
  assert.equal(cat.scene.pose, "crouch");
  assert.equal(cat.railId, "second");
  advance(cat, 5000, 8000);
  assert.equal(cat.scene.y, 480);
  const position = { ...cat.scene };
  cat.setRails([], 8001);
  assert.deepEqual(cat.scene, position);
  assert.equal(cat.scene.visible, true);
});

test("normal layout refreshes preserve a long nap and changing windows cannot retain a removed perch", () => {
  const cat = create();
  cat.enter("sleep", 0, 20000);
  for (let time = 0; time < 19000; time += 500) {
    cat.setRails(rails, time);
    cat.tick(time);
    assert.equal(cat.scene.pose, "sleep");
  }
  cat.setRails([{ id: "dialog", left: 200, right: 400, y: 100 }], 19000, {
    priority: true,
  });
  advance(cat, 19000, 21900);
  assert.equal(cat.scene.y, 100);
  cat.setRails(rails, 22000, { priority: true });
  advance(cat, 22000, 24900);
  assert.equal(cat.scene.y, 260);
});
