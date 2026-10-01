import test from "node:test";
import assert from "node:assert/strict";
import { dayNumber } from "../src/work-model.js";
import {
  taskInterval,
  packTimeline,
  fitTimeline,
  zoomTimeline,
  zoomFromWheel,
  zoomFromPinch,
  timelineTicks,
  MIN_DAYS,
  MAX_DAYS,
  TIME_PRESETS,
} from "../src/timeline-model.js";
const day = dayNumber("2026-10-01");
const task = (id, start = "", due = "", status = "active") => ({
  id,
  status,
  task: { start, due },
});
test("wheel units and two-finger zoom preserve anchored time during scaling and panning", () => {
  const view = { start: day, days: 30 },
    rect = { left: 100, width: 800 };
  const wheel = zoomFromWheel(
    view,
    { deltaY: -16, deltaMode: 0, clientX: 300 },
    rect,
  );
  const lines = zoomFromWheel(
    view,
    { deltaY: -1, deltaMode: 1, clientX: 300 },
    rect,
  );
  assert.deepEqual(wheel, lines);
  assert.ok(wheel.days < 30);
  assert.ok(Math.abs(wheel.start + wheel.days * 0.25 - (day + 7.5)) < 1e-9);
  const pinch = zoomFromPinch(
    view,
    { distance: 100, middle: 300 },
    { distance: 200, middle: 400 },
    rect,
  );
  assert.equal(pinch.days, 15);
  assert.ok(Math.abs(pinch.start + pinch.days * 0.375 - (day + 7.5)) < 1e-9);
  const smaller = zoomFromPinch(
    view,
    { distance: 200, middle: 300 },
    { distance: 100, middle: 300 },
    rect,
  );
  assert.equal(smaller.days, 60);
});
test("missing dates are open endpoints and same-day tasks occupy a full day", () => {
  assert.deepEqual(taskInterval(task("always")), {
    node: task("always"),
    start: -Infinity,
    end: Infinity,
  });
  assert.equal(taskInterval(task("past", "", "2026-10-01")).end, day + 1);
  assert.equal(taskInterval(task("past", "", "2026-10-01")).start, -Infinity);
  assert.equal(taskInterval(task("future", "2026-10-01")).end, Infinity);
  const one = taskInterval(task("one", "2026-10-01", "2026-10-01"));
  assert.equal(one.end - one.start, 1);
  for (const start of [day - 5000, day, day + 5000]) {
    const model = packTimeline([task("always")], { start, days: 30 });
    assert.equal(model.items[0].left, start);
    assert.equal(model.items[0].right, start + 30);
  }
});
test("adjacent tasks share one row; overlapping inclusive dates require separate rows", () => {
  const tasks = [
    task("third", "2026-10-03", "2026-10-03"),
    task("first", "2026-10-01", "2026-10-01"),
    task("second", "2026-10-02", "2026-10-02"),
  ];
  const view = { start: day, days: 7 };
  assert.equal(packTimeline(tasks, view).lanes, 1);
  const packed = packTimeline(
    [...tasks, task("overlap", "2026-10-01", "2026-10-02"), task("always")],
    view,
  );
  assert.equal(packed.lanes, 3);
  assert.equal(new Set(packed.items.map((x) => x.node.id)).size, 5);
  for (const a of packed.items)
    for (const b of packed.items)
      if (a !== b && a.lane === b.lane)
        assert.ok(a.end <= b.start || b.end <= a.start);
  assert.deepEqual(
    packTimeline([...tasks].reverse(), view),
    packTimeline(tasks, view),
  );
});
test("packing uses the minimum row count over varied intervals and ignores off-screen tasks", () => {
  let seed = 12;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const date = (value) => new Date(value * 86400000).toISOString().slice(0, 10);
  for (let sample = 0; sample < 80; sample++) {
    const tasks = Array.from({ length: 60 }, (_, i) => {
      const start = day + Math.floor(random() * 60) - 20;
      return task(
        `task-${i}`,
        date(start),
        date(start + Math.floor(random() * 8)),
      );
    });
    const packed = packTimeline(tasks, { start: day, days: 30 });
    const events = packed.items
      .flatMap((x) => [
        [x.left, 1],
        [x.right, -1],
      ])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let running = 0,
      max = 0;
    for (const [, change] of events) {
      running += change;
      max = Math.max(max, running);
    }
    assert.equal(packed.lanes, max);
    for (const a of packed.items)
      for (const b of packed.items)
        if (a !== b && a.lane === b.lane)
          assert.ok(a.right <= b.left || b.right <= a.left);
  }
  assert.equal(
    packTimeline([task("old", "2025-01-01", "2025-01-02")], {
      start: day,
      days: 7,
    }).lanes,
    0,
  );
});
test("smooth zoom preserves the time under the cursor and does not snap to presets", () => {
  const view = { start: day, days: 30, preset: "30" };
  for (const anchor of [0, 0.1, 0.5, 0.9, 1]) {
    const next = zoomTimeline(view, 0.873, anchor);
    assert.ok(
      Math.abs(
        next.start + next.days * anchor - (view.start + view.days * anchor),
      ) < 1e-9,
    );
    assert.equal(next.preset, "custom");
    assert.ok(!TIME_PRESETS.includes(next.days));
  }
  assert.equal(zoomTimeline(view, 1e-20).days, MIN_DAYS);
  assert.equal(zoomTimeline(view, 1e20).days, MAX_DAYS);
  const restore = zoomTimeline(zoomTimeline(view, 0.8, 0.3), 1 / 0.8, 0.3);
  assert.ok(Math.abs(restore.start - view.start) < 1e-9);
  assert.equal(restore.days, view.days);
});
test("eternity fits finite dates with open-ended tasks and ticks stay bounded at every scale", () => {
  const tasks = [
    task("always"),
    task("old", "2000-01-01", "2001-01-01"),
    task("future", "2030-01-01"),
  ];
  const view = fitTimeline(tasks, day);
  assert.ok(view.start < dayNumber("2000-01-01"));
  assert.ok(view.start + view.days > dayNumber("2030-01-01"));
  assert.equal(view.preset, "all");
  assert.equal(packTimeline(tasks, view).items.length, 3);
  assert.equal(fitTimeline([task("always")], day).days, 30);
  for (const days of [...TIME_PRESETS, MIN_DAYS, MAX_DAYS, 4.375]) {
    const { ticks } = timelineTicks({ start: day, days }, 1200);
    assert.ok(ticks.length <= 12);
    assert.ok(
      ticks.every(
        (tick) => Number.isFinite(tick) && tick >= day && tick < day + days,
      ),
    );
  }
});
