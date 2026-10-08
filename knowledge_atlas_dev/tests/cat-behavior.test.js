import test from "node:test";
import assert from "node:assert/strict";
import {
  CatBehavior,
  catFreeIntervals,
  catLanding,
  catControlInterval,
  catReducedMotion,
} from "../src/cat-behavior.js";

const rails = [{ id: "panel", left: 100, right: 600, y: 260 }];

test("full motion remains enabled under a system reduction; system and still modes are explicit", () => {
  assert.equal(catReducedMotion(undefined, true), false);
  assert.equal(catReducedMotion("full", true), false);
  assert.equal(catReducedMotion("system", true), true);
  assert.equal(catReducedMotion("system", false), false);
  assert.equal(catReducedMotion("still", false), true);
});

test("nearby eyes follow the pointer within their sockets and mirror with the body", () => {
  const cat = create();
  cat.point({ x: 740, y: 310 }, 100);
  assert.ok(cat.gaze.x > 0 && cat.gaze.x <= 1.6);
  assert.ok(cat.gaze.y > 0 && cat.gaze.y <= 1.2);
  cat.scene.direction = -1;
  assert.ok(cat.gaze.x < 0);
  cat.point({ x: 0, y: 0 }, 200);
  assert.deepEqual(cat.gaze, { x: 0, y: 0 });
  cat.point({ x: 740, y: 310 }, 300);
  cat.enter("sleep", 300, 20000);
  assert.deepEqual(cat.gaze, { x: 0, y: 0 });
  cat.setReduced(true, 400);
  cat.point({ x: 740, y: 310 }, 500);
  assert.deepEqual(cat.gaze, { x: 0, y: 0 });
});

test("typing or dragging cancels hunting and releases a catch without interrupting an ordinary nap", () => {
  for (const phase of [100, 900, 1450]) {
    const cat = create();
    cat.point({ x: 650, y: 210 }, 100);
    advance(cat, 100, phase, 10);
    assert.ok(["hunt", "pounce", "cling"].includes(cat.scene.pose));
    cat.yieldPointer(phase);
    assert.equal(cat.pointer, null);
    assert.ok(!["hunt", "pounce", "cling"].includes(cat.scene.pose));
    cat.point({ x: cat.scene.x + 47, y: cat.scene.y - 20 }, phase + 100);
    assert.notEqual(cat.scene.pose, "hunt");
    advance(cat, phase, phase + 3500);
    assert.equal(cat.scene.y, 260);
  }
  const sleeping = create();
  sleeping.enter("sleep", 0, 20000);
  sleeping.yieldPointer(1000);
  assert.equal(sleeping.scene.pose, "sleep");
  assert.equal(sleeping.deadline, 20000);
});

test("a newly split edge preserves the occupied interval instead of teleporting by array index", () => {
  const cat = create();
  cat.setRails([{ ...rails[0], surface: "editor", anchorX: 100 }], 1);
  cat.enter("sleep", 1, 20000);
  cat.setRails(
    [
      {
        id: "panel",
        surface: "editor",
        anchorX: 100,
        left: 100,
        right: 200,
        y: 260,
      },
      {
        id: "panel:1",
        surface: "editor",
        anchorX: 100,
        left: 400,
        right: 600,
        y: 260,
      },
    ],
    100,
  );
  assert.equal(cat.scene.x, 600);
  assert.equal(cat.railId, "panel:1");
  assert.equal(cat.scene.pose, "sleep");
  assert.equal(cat.deadline, 20001);
});

test("a shrinking panel makes the cat walk to free space without a one-frame snap", () => {
  const cat = create();
  const narrow = [{ ...rails[0], right: 450 }];
  cat.setRails(narrow, 100);
  assert.equal(cat.scene.x, 600);
  assert.equal(cat.scene.pose, "rise");
  let previous = cat.scene.x;
  for (let time = 116; time <= 3100; time += 16) {
    cat.setRails(narrow, time);
    cat.tick(time);
    assert.ok(Math.abs(cat.scene.x - previous) < 5);
    previous = cat.scene.x;
  }
  assert.equal(cat.scene.x, 450);
  assert.equal(cat.scene.pose, "sit");
});

test("continuous scrolling carries a sleeping cat on the same edge without restarting its pose", () => {
  const cat = create();
  cat.enter("sleep", 0, 20000);
  for (let i = 1; i <= 100; i++) {
    cat.setRails(
      [{ ...rails[0], left: 100 + i, right: 600 + i, y: 260 - i }],
      i * 16,
    );
    cat.tick(i * 16);
    assert.equal(cat.scene.x, 600 + i);
    assert.equal(cat.scene.y, 260 - i);
    assert.equal(cat.scene.pose, "sleep");
    assert.equal(cat.deadline, 20000);
    assert.equal(cat.motion, undefined);
  }
});

test("scrolling every frame does not starve walking or restart a jump to a moving edge", () => {
  const cat = create();
  cat.travel(rails[0], 500, 0);
  for (let i = 1; i <= 200; i++) {
    cat.setRails([{ ...rails[0], anchorX: 100, y: 260 - i / 2 }], i * 16);
    cat.tick(i * 16);
  }
  assert.equal(cat.scene.x, 500);
  assert.equal(cat.scene.y, 160);
  assert.equal(cat.scene.pose, "sit");
  const editor = { id: "editor", left: 300, right: 700, y: 480 };
  cat.setRails([editor], 3200, { priority: true });
  for (let i = 1; i <= 170; i++) {
    cat.setRails([{ ...editor, y: 480 - i }], 3200 + i * 16);
    cat.tick(3200 + i * 16);
  }
  assert.equal(cat.scene.y, 310);
  assert.equal(cat.scene.pose, "sit");
});

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
    assert.equal(
      cat.scene.y,
      728,
      "carrying beyond the panel drops to the viewport floor",
    );
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

const personalityRails = [
  {
    id: "frame",
    surface: "frame",
    kind: "frame",
    left: 100,
    right: 600,
    y: 100,
  },
  {
    id: "reader",
    surface: "reader",
    kind: "reader",
    left: 100,
    right: 600,
    y: 260,
  },
  { id: "tabs", surface: "tabs", kind: "tabs", left: 100, right: 600, y: 430 },
];
function character(personality, context = "workspace") {
  const cat = new CatBehavior(() => 0.5, personality);
  cat.setContext(context, context, 0);
  cat.setRails(personalityRails, 0, { width: 1000, height: 800 });
  return cat;
}

test("personalities choose different perches and exploration favors unvisited surfaces", () => {
  assert.equal(character("classic").railId, "frame");
  assert.equal(character("quiet").railId, "frame");
  const curious = character("curious");
  assert.equal(curious.railId, "reader");
  assert.equal(character("playful").railId, "tabs");
  curious.visited = ["reader", "frame"];
  assert.equal(curious.preferred(personalityRails, true).id, "tabs");
  assert.equal(character("unknown").personality, "classic");
});

test("context changes start a distinct routine once, without restarting on layout refresh", () => {
  const cat = character("curious", "attachments");
  cat.tick(1200);
  assert.equal(cat.scene.pose, "inspect");
  const remaining = [...cat.routine],
    deadline = cat.deadline;
  for (let time = 1300; time < 3000; time += 100) {
    assert.equal(cat.setContext("attachments", "attachments", time), false);
    cat.setRails(personalityRails, time);
    cat.tick(time);
  }
  assert.deepEqual(cat.routine, remaining);
  assert.equal(cat.deadline, deadline);
  cat.tick(deadline);
  assert.equal(cat.scene.pose, "paw");
  assert.equal(cat.setContext("journal", "journal-window", 5000), true);
  cat.enter("sit", 5000, 0);
  cat.tick(5000);
  assert.equal(cat.scene.pose, "watch");
  cat.tick(cat.deadline);
  assert.equal(cat.scene.pose, "groom");
  cat.tick(cat.deadline);
  assert.equal(cat.scene.pose, "sleep");
});

test("switching personality preserves an in-flight position and retargets continuously", () => {
  const cat = character("playful", "board");
  cat.tick(1200);
  advance(cat, 1200, 1600, 10);
  assert.ok(cat.motion);
  const before = { x: cat.scene.x, y: cat.scene.y };
  cat.setPersonality("quiet", 1600);
  cat.setRails(personalityRails, 1600);
  assert.deepEqual({ x: cat.scene.x, y: cat.scene.y }, before);
  advance(cat, 1600, 4500, 10);
  assert.equal(cat.railId, "frame");
  assert.equal(cat.scene.y, 100);
  assert.equal(cat.scene.visible, true);
});

test("quiet never hunts; active personalities have different capture timing", () => {
  for (const [name, hunt, hold] of [
    ["classic", 650, 3000],
    ["curious", 850, 2000],
    ["playful", 450, 2500],
  ]) {
    const cat = character(name);
    cat.enter("sit", 3000, 9000);
    cat.point({ x: cat.scene.x + 47, y: cat.scene.y - 30 }, 3000);
    assert.equal(cat.scene.pose, "hunt");
    cat.tick(3000 + hunt);
    assert.equal(cat.scene.pose, "pounce");
    cat.tick(3000 + hunt + 650);
    assert.equal(cat.scene.pose, "cling");
    assert.equal(cat.deadline, 3000 + hunt + 650 + hold);
  }
  const quiet = character("quiet");
  quiet.point({ x: quiet.scene.x + 47, y: quiet.scene.y - 30 }, 3000);
  assert.equal(quiet.scene.pose, "sit");
});

test("typing releases a playful catch and suppresses new games without waking a nap", () => {
  const cat = character("playful");
  cat.point({ x: cat.scene.x + 47, y: cat.scene.y - 30 }, 3000);
  cat.tick(3450);
  cat.tick(4100);
  assert.equal(cat.scene.pose, "cling");
  cat.yieldPointer(4200, { typing: true });
  assert.notEqual(cat.scene.pose, "cling");
  advance(cat, 4200, 7000, 10);
  assert.equal(cat.scene.y, 430);
  cat.point({ x: cat.scene.x + 47, y: cat.scene.y - 30 }, 7000);
  assert.notEqual(cat.scene.pose, "hunt");
  assert.equal(cat.workUntil, 10200);
  cat.enter("sleep", 8000, 20000);
  cat.yieldPointer(9000, { typing: true });
  assert.equal(cat.scene.pose, "sleep");
  assert.equal(cat.deadline, 28000);
});

test("backups stay calm beyond their initial routine and never chase the pointer", () => {
  for (const name of ["quiet", "curious", "playful"]) {
    const cat = character(name, "transfer");
    for (let time = 0; time < 240000; time += 100) {
      cat.point({ x: cat.scene.x + 47, y: cat.scene.y - 30 }, time);
      cat.tick(time);
      assert.ok(
        ["sit", "watch", "groom", "sleep", "wake"].includes(cat.scene.pose),
        cat.scene.pose,
      );
    }
  }
});

test("all personalities remain visible, bounded and rested during a long session", () => {
  for (const name of ["classic", "quiet", "curious", "playful"]) {
    const cat = character(name, "board"),
      poses = new Set();
    for (let time = 0; time < 600000; time += 50) {
      cat.tick(time);
      poses.add(cat.scene.pose);
      assert.ok(cat.scene.visible);
      assert.ok(
        Number.isFinite(cat.scene.x) && cat.scene.x >= 0 && cat.scene.x <= 906,
      );
      assert.ok(
        Number.isFinite(cat.scene.y) && cat.scene.y >= 0 && cat.scene.y <= 728,
      );
      assert.ok(cat.visited.length <= 4);
    }
    assert.ok(poses.has("sleep"), name);
    assert.ok(poses.has("wake"), name);
    if (name === "curious") assert.ok(poses.has("inspect"));
    if (name === "playful") assert.ok(poses.has("paw"));
  }
});

test("reduced motion overrides personality switches, window routines and typing", () => {
  const cat = character("playful");
  cat.setReduced(true, 0);
  for (const name of ["quiet", "curious", "classic", "playful"]) {
    cat.setPersonality(name, 1000);
    cat.setContext("attachments", name, 1000);
    cat.setRails(personalityRails, 1000);
    const point = { x: cat.scene.x, y: cat.scene.y };
    cat.yieldPointer(1200, { typing: true });
    for (let time = 1500; time < 60000; time += 1000) {
      cat.point({ x: cat.scene.x + 47, y: cat.scene.y - 30 }, time);
      cat.tick(time);
      assert.deepEqual({ x: cat.scene.x, y: cat.scene.y }, point);
      assert.equal(cat.scene.pose, "sit");
      assert.equal(cat.animated, false);
    }
  }
});

test("releasing chooses the first edge below the paws, ahead of higher and side edges", () => {
  const scene = { x: 300, y: 100 };
  const below = { id: "button", left: 280, right: 330, y: 220 };
  const edges = [
    { id: "above", left: 300, right: 500, y: 90 },
    { id: "side", left: 340, right: 380, y: 130 },
    { id: "lower", left: 280, right: 500, y: 350 },
    below,
  ];
  assert.equal(catLanding(scene, edges, 1000, 800).rail.id, "button");
  assert.equal(catLanding(scene, [edges[0]], 1000, 800).rail.id, "drop-floor");
  const narrow = {
    id: "icon",
    left: 295,
    right: 295,
    y: 180,
    supportLeft: 330,
    supportRight: 355,
  };
  assert.equal(catLanding(scene, [below, narrow], 1000, 800).rail.id, "icon");
  assert.equal(catLanding(scene, [narrow], 1000, 800).point.x, 295);
  assert.deepEqual(catControlInterval({ left: 5, right: 37 }, 390), [0, 0]);
  assert.deepEqual(
    catControlInterval({ left: 355, right: 389 }, 390),
    [296, 296],
  );
  assert.deepEqual(
    catControlInterval({ left: 100, right: 300 }, 390),
    [100, 206],
  );
});

const dropButton = {
  id: "drop:button",
  surface: "button",
  anchorX: 300,
  left: 300,
  right: 390,
  y: 340,
};
function carried() {
  const cat = create();
  Object.assign(cat.scene, { x: 320, y: 80, pose: "cling" });
  cat.lastTick = 100;
  cat.findLanding = () =>
    catLanding(cat.scene, [dropButton, ...cat.rails], 1100, 800);
  return cat;
}

test("a carried cat falls with increasing speed, settles on the button and stays there", () => {
  const cat = carried();
  cat.rails = [];
  cat.returnToRail(5000);
  assert.equal(cat.scene.pose, "fall");
  assert.equal(cat.railId, "drop:button");
  const positions = [];
  for (let time = 5000; time <= 5250; time += 50) {
    cat.tick(time);
    positions.push(cat.scene.y);
  }
  assert.equal(positions[0], 80, "idle time before release is not fall time");
  assert.ok(positions[2] - positions[1] > positions[1] - positions[0]);
  advance(cat, 5250, 6800, 10);
  assert.equal(cat.scene.y, 340);
  assert.equal(cat.scene.x, 320);
  assert.equal(cat.scene.pose, "sit");
  cat.setRails([dropButton, ...rails], 7000);
  cat.point({ x: 367, y: 270 }, 8000);
  cat.tick(12000);
  assert.equal(cat.railId, "drop:button");
  assert.equal(cat.scene.pose, "sit");
});

test("a falling cat follows scrolling without restarting gravity or snapping its takeoff", () => {
  const cat = carried();
  cat.rails = [];
  cat.returnToRail(100);
  let previousY = cat.scene.y;
  for (let i = 1; i <= 25; i++) {
    const before = { x: cat.scene.x, y: cat.scene.y };
    cat.setRails(
      [
        {
          ...dropButton,
          y: 340 + i,
          left: 300 + i,
          right: 390 + i,
          anchorX: 300 + i,
        },
      ],
      100 + i * 16,
    );
    assert.deepEqual({ x: cat.scene.x, y: cat.scene.y }, before);
    cat.tick(100 + i * 16);
    assert.ok(cat.scene.y >= previousY);
    previousY = cat.scene.y;
  }
  advance(cat, 500, 1900, 10);
  assert.equal(cat.scene.y, 365);
  assert.equal(cat.scene.x, 345);
  assert.equal(cat.scene.pose, "sit");
});

test("a removed or raised landing target is replaced below, including an empty viewport", () => {
  for (const raised of [true, false]) {
    const cat = carried();
    cat.rails = [];
    cat.returnToRail(100);
    cat.tick(200);
    cat.findLanding = null;
    const before = { x: cat.scene.x, y: cat.scene.y };
    cat.setRails(raised ? [{ ...dropButton, y: 10 }] : [], 200);
    assert.deepEqual({ x: cat.scene.x, y: cat.scene.y }, before);
    assert.equal(cat.railId, "drop-floor");
    advance(cat, 200, 1900, 10);
    assert.equal(cat.scene.y, 728);
    assert.equal(cat.scene.visible, true);
  }
});

test("click and automatic timeout both release onto the surface underneath without DOM actions", () => {
  for (const timeout of [false, true]) {
    const cat = carried();
    cat.rails = [];
    cat.deadline = 150;
    cat.pointer = { x: 367, y: 70 };
    let calls = 0;
    cat.findLanding = () => {
      calls++;
      return catLanding(cat.scene, [dropButton], 1100, 800);
    };
    if (timeout) cat.tick(150);
    else cat.yieldPointer(150);
    assert.equal(cat.scene.pose, "fall");
    advance(cat, 150, 2500, 10);
    assert.equal(cat.railId, "drop:button");
    assert.equal(cat.scene.y, 340);
    assert.equal(
      calls,
      1,
      "landing geometry is requested once, not on every animation frame",
    );
  }
});
