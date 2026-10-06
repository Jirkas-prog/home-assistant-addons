import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarRange,
  calendarMove,
  calendarSegments,
  calendarEntryRange,
  timedSegments,
  dayDistance,
} from "../shared/journal-calendar.js";
import { validateTool } from "../shared/tools.js";

const entry = (id, date, endDate = date, startTime = "", endTime = "") => ({
  id,
  tool: {
    schema: 1,
    kind: "journal",
    date,
    endDate,
    startTime,
    endTime,
    minutes: 0,
    next: "",
  },
});
test("calendar navigation keeps Monday weeks and handles leap months, years and DST dates", () => {
  assert.deepEqual(calendarRange("2026-10-06", "week"), {
    start: "2026-10-05",
    end: "2026-10-11",
  });
  assert.deepEqual(calendarRange("2026-10-06", "month"), {
    start: "2026-09-28",
    end: "2026-11-01",
  });
  assert.deepEqual(calendarRange("2024-02-29", "day"), {
    start: "2024-02-29",
    end: "2024-02-29",
  });
  assert.equal(calendarMove("2024-01-31", "month", 1), "2024-02-29");
  assert.equal(calendarMove("2024-02-29", "year", 1), "2025-02-28");
  assert.equal(calendarMove("2026-01-31", "month", -1), "2025-12-31");
  assert.equal(calendarMove("2026-10-25", "day", 1), "2026-10-26");
  assert.equal(calendarMove("2026-03-29", "week", 1), "2026-04-05");
  assert.equal(dayDistance("2026-10-24", "2026-10-26"), 2);
});
test("calendar bars clip spanning entries, exclude offscreen records and pack inclusive dates without overlap", () => {
  const entries = [
    entry("spanning", "2026-09-29", "2026-10-15"),
    entry("a", "2026-10-05", "2026-10-07"),
    entry("b", "2026-10-08"),
    entry("c", "2026-10-07"),
    entry("old", "2026-09-01"),
  ];
  const bars = calendarSegments(entries, "2026-10-05", "2026-10-11");
  const spanning = bars.find((s) => s.entry.id === "spanning");
  assert.equal(spanning.span, 7);
  assert.equal(spanning.column, 0);
  assert.ok(spanning.before && spanning.after);
  assert.equal(bars.length, 4);
  assert.equal(Math.max(...bars.map((s) => s.lane)) + 1, 3);
  for (const a of bars)
    for (const b of bars)
      if (a !== b && a.lane === b.lane)
        assert.ok(a.end < b.start || b.end < a.start);
  assert.equal(
    bars.find((s) => s.entry.id === "a").lane,
    bars.find((s) => s.entry.id === "b").lane,
  );
});
test("timed entries share free columns, split across days and do not occupy the midnight endpoint", () => {
  const entries = [
    entry("a", "2026-10-06", undefined, "09:00", "11:00"),
    entry("b", "2026-10-06", undefined, "10:00", "12:00"),
    entry("c", "2026-10-06", undefined, "11:00", "11:30"),
    entry("d", "2026-10-06", undefined, "12:00", "13:00"),
  ];
  const segments = timedSegments(entries, "2026-10-06");
  assert.deepEqual(
    segments.map((s) => [s.entry.id, s.lane, s.columns]),
    [
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
      ["d", 0, 1],
    ],
  );
  const overnight = entry(
    "night",
    "2026-10-05",
    "2026-10-07",
    "23:00",
    "00:00",
  );
  assert.deepEqual(calendarEntryRange(overnight), {
    start: "2026-10-05",
    end: "2026-10-06",
  });
  assert.deepEqual(
    timedSegments([overnight], "2026-10-05").map((s) => [s.start, s.end]),
    [[1380, 1440]],
  );
  assert.deepEqual(
    timedSegments([overnight], "2026-10-06").map((s) => [s.start, s.end]),
    [[0, 1440]],
  );
  assert.equal(timedSegments([overnight], "2026-10-07").length, 0);
});
test("journal clock fields are optional, validated as a pair and survive ordinary validation", () => {
  const check = (tool) =>
    validateTool(tool, (message) => {
      throw new Error(message);
    });
  const old = entry("old", "2026-10-06").tool;
  delete old.startTime;
  delete old.endTime;
  assert.doesNotThrow(() => check(old));
  for (const times of [
    { startTime: "09:00" },
    { startTime: "25:00", endTime: "26:00" },
    { startTime: "09:00", endTime: "09:00" },
    { startTime: "10:00", endTime: "09:00" },
  ])
    assert.throws(() => check({ ...old, ...times }), /time/);
  assert.equal(
    check({
      ...old,
      startTime: "23:00",
      endTime: "01:00",
      endDate: "2026-10-07",
    }).endTime,
    "01:00",
  );
});
