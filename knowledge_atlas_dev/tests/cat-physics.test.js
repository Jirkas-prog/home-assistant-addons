import test from "node:test";
import assert from "node:assert/strict";
import { PetDrag, stepPetPhysics } from "../src/cat-physics.js";
import { CatBehavior } from "../src/cat-behavior.js";

const viewport = { width: 800, height: 600 };
const edges = [
  { id: "header", left: 20, right: 650, y: 100 },
  {
    id: "drop:button",
    left: 300,
    right: 300,
    y: 300,
    supportLeft: 327,
    supportRight: 367,
  },
];
function catFixture() {
  const cat = new CatBehavior(() => 0.4, "quiet");
  cat.setRails(edges, 0, viewport);
  return cat;
}
function settle(body, rails = [], options = viewport, step = 16) {
  let rail;
  for (let i = 0; i < 2000 && !rail; i++)
    rail = stepPetPhysics(body, step, rails, options);
  assert.ok(rail, "the throw comes to rest");
  return rail;
}

test("grabs preserve their offset, tolerate click jitter and use recent velocity only", () => {
  const drag = new PetDrag({ x: 50, y: 20 }, { x: 20, y: 5 }, 0);
  assert.deepEqual(drag.move({ x: 52, y: 21 }, 10), { x: 22, y: 6 });
  assert.equal(drag.dragged, false);
  drag.move({ x: 100, y: 30 }, 50);
  assert.equal(drag.dragged, true);
  assert.ok(drag.velocity(55).vx > 0.8);
  assert.deepEqual(drag.velocity(180), { vx: 0, vy: 0 });
  drag.move({ x: 5000, y: 4000 }, 190);
  drag.move({ x: 10000, y: 10000 }, 210);
  assert.ok(Math.hypot(...Object.values(drag.velocity(210))) <= 2.800001);
});

test("stationary release after a fast carry drops instead of throwing", () => {
  const drag = new PetDrag({ x: 0, y: 0 }, { x: 0, y: 0 }, 0);
  drag.move({ x: 200, y: 100 }, 30);
  drag.move({ x: 200, y: 100 }, 150);
  assert.deepEqual(drag.velocity(150), { vx: 0, vy: 0 });
});

test("gravity finds a narrow button below the paws without landing on an edge above", () => {
  const body = { x: 300, y: 140, vx: 0, vy: 0 };
  const rail = settle(body, edges);
  assert.equal(rail.id, "drop:button");
  assert.equal(body.x, 300);
  assert.equal(body.y, 300);
});

test("swept collisions catch a fast descent and yarn bounces then rolls to rest", () => {
  const body = { x: 347, y: 340, vx: 0.01, vy: 2.5, rotation: 0 };
  stepPetPhysics(body, 8, edges, { ...viewport, yarn: true });
  assert.ok(body.vy < 0, "ball bounced on the narrow edge it crossed");
  const rail = settle(body, [edges[1]], { ...viewport, yarn: true });
  assert.equal(rail.id, "drop:button");
  assert.equal(body.y, 357);
  assert.ok(body.rotation > 0);
});

test("fast throws reflect off walls and ceiling, stay bounded and eventually settle", () => {
  for (const yarn of [false, true]) {
    const body = { x: 690, y: 14, vx: 2.5, vy: -2.5, rotation: 0 };
    for (let i = 0; i < 100; i++) {
      stepPetPhysics(body, 16, [], { ...viewport, yarn });
      assert.ok(body.x >= 0 && body.x <= viewport.width - (yarn ? 12 : 94));
      assert.ok(body.y >= 0 && body.y <= viewport.height - (yarn ? 15 : 72));
    }
    assert.equal(settle(body, [], { ...viewport, yarn }).id, "drop-floor");
  }
});

test("frame rates and a paused clock do not change the resting surface", () => {
  for (const step of [8, 16, 33]) {
    const body = { x: 300, y: 160, vx: 0, vy: 0 };
    const before = { ...body };
    stepPetPhysics(body, 0, edges, viewport);
    assert.deepEqual(body, before);
    assert.equal(settle(body, edges, viewport, step).id, "drop:button");
  }
});

test("a removed support and resized viewport cannot strand a throw", () => {
  const body = { x: 680, y: 500, vx: 1, vy: 1 };
  const small = { width: 360, height: 300 };
  assert.equal(settle(body, [], small).id, "drop-floor");
  assert.equal(body.y, 228);
  assert.ok(body.x <= 266);
});

test("manual cat carry overrides roaming, scrolling and pointer hunting until release", () => {
  const cat = catFixture();
  cat.grab(100);
  cat.dragTo({ x: 300, y: 180 });
  cat.setRails(
    edges.map((r) => ({ ...r, y: r.y - 20 })),
    150,
    viewport,
  );
  cat.point({ x: 350, y: 120 }, 150);
  cat.tick(200);
  assert.equal(cat.scene.pose, "held");
  assert.equal(cat.scene.y, 180);
  cat.release({ vx: 0, vy: 0 }, 200);
  for (let now = 216; now < 3200; now += 16) cat.tick(now);
  assert.equal(cat.scene.y, 280);
  assert.equal(cat.railId, "drop:button");
  assert.equal(cat.scene.pose, "sit");
  assert.ok(cat.placedUntil > 3200);
});

test("clicking the cat sends her away and suppresses an immediate return to yarn", () => {
  const cat = catFixture();
  cat.yarn.spawn({ x: 650, y: 200 }, 0);
  const origin = { ...cat.scene };
  cat.grab(100);
  cat.shoo(150);
  for (let now = 166; now < 4000; now += 16) cat.tick(now);
  assert.ok(Math.hypot(cat.scene.x - origin.x, cat.scene.y - origin.y) >= 160);
  assert.equal(cat.scene.pose, "sit");
  assert.ok(cat.yarn.pauseUntil > 4000);
});

test("a carried or thrown cat survives removal of her toy", () => {
  const cat = catFixture();
  cat.yarn.spawn({ x: 450, y: 170 }, 0);
  cat.grab(100);
  cat.yarn.stop(110);
  assert.equal(cat.scene.pose, "held");
  cat.release({ vx: -1, vy: -0.4 }, 150);
  cat.tick(166);
  assert.ok(cat.flight);
  assert.ok(cat.scene.x < 650);
});

test("grabbing yarn freezes it even past its expiry; throwing resumes the chase", () => {
  const cat = catFixture();
  cat.yarn.spawn({ x: 400, y: 200 }, 0);
  cat.yarn.grab(100);
  cat.yarn.dragTo({ x: 347, y: 200 });
  cat.yarn.sync([], 120);
  cat.tick(90000);
  assert.equal(cat.yarn.ball.phase, "held");
  assert.equal(cat.yarn.ball.x, 347);
  cat.yarn.release({ vx: 0, vy: 0 }, 90000);
  for (let now = 90016; now < 91600; now += 16) cat.tick(now);
  assert.equal(cat.yarn.destination.rail.id, "drop:button");
  assert.ok(["chase", "paw"].includes(cat.yarn.ball.phase));
});

test("still mode permits explicit carrying and moving aside without inertia", () => {
  const cat = catFixture();
  cat.setReduced(true, 0);
  cat.grab(10);
  cat.dragTo({ x: 300, y: 170 });
  cat.release({ vx: 2, vy: -2 }, 30);
  assert.equal(cat.flight, null);
  assert.equal(cat.scene.y, 300);
  const origin = { ...cat.scene };
  cat.shoo(100);
  assert.ok(Math.hypot(cat.scene.x - origin.x, cat.scene.y - origin.y) >= 160);
  assert.equal(cat.animated, false);
});

test("a single narrow perch still lets the cat get out of the way", () => {
  const cat = catFixture();
  cat.setReduced(true, 0);
  cat.setRails([edges[1]], 10);
  Object.assign(cat.scene, { x: 300, y: 300 });
  cat.shoo(20);
  assert.ok(Math.hypot(cat.scene.x - 300, cat.scene.y - 300) > 100);
  assert.equal(cat.railId, "drop-floor");
});

test("manually placed yarn near a floor edge does not snap sideways on layout refresh", () => {
  const cat = catFixture();
  cat.yarn.spawn({ x: 20, y: 400 }, 0);
  cat.yarn.grab(0);
  cat.yarn.release({ vx: 0, vy: 0 }, 0);
  cat.yarn.pauseUntil = Infinity;
  for (let now = 16; now < 3500; now += 16) cat.yarn.tick(now);
  assert.equal(cat.yarn.ball.phase, "chase");
  assert.equal(cat.yarn.ball.x, 20);
  cat.yarn.sync(cat.rails, 3500);
  assert.equal(cat.yarn.ball.x, 20);
});
