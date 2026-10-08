import test from "node:test";
import assert from "node:assert/strict";
import {
  combinedCalendarEntries,
  CALENDAR_COLORS,
} from "../shared/combined-calendar.js";
import { calendarSegments, timedSegments } from "../shared/journal-calendar.js";
import { workspaceNode } from "../shared/workspace.js";
import { taskUrgencies } from "../shared/checkpoints.js";

const journal = {
  id: "journal",
  type: "knowledge",
  title: "Workshop review",
  color: "#ffffff",
  body: "Original notes",
  resources: [{ id: "image", path: "photo.jpg" }],
  related: ["task"],
  tags: [],
  tool: {
    kind: "journal",
    date: "2026-10-08",
    endDate: "2026-10-09",
    startTime: "23:00",
    endTime: "00:00",
  },
};
const task = {
  id: "task",
  type: "task",
  title: "Inspect prototype",
  color: "#ffffff",
  body: "Original instructions",
  related: [],
  resources: [],
  task: {
    start: "2026-10-08",
    due: "2026-10-10",
    checkpoints: [
      {
        id: "verify",
        due: "2026-10-09",
        done: false,
        description: "Verify output",
      },
    ],
  },
};
const undated = { ...task, id: "undated", task: { start: "", due: "" } };

test("combined calendar distinguishes sources without changing original records", () => {
  const nodes = [task, journal, undated, { id: "note", type: "knowledge" }];
  const before = structuredClone(nodes);
  const entries = combinedCalendarEntries(nodes);
  assert.deepEqual(
    entries.map((n) => n.id),
    ["task", "journal"],
  );
  assert.equal(entries[0].calendarKind, "task");
  assert.equal(entries[0].color, CALENDAR_COLORS.task);
  assert.equal(entries[1].calendarKind, "journal");
  assert.equal(entries[1].color, CALENDAR_COLORS.journal);
  assert.notEqual(entries[0].color, entries[1].color);
  assert.deepEqual(nodes, before);
  assert.equal(task.tool, undefined);
  assert.deepEqual(
    combinedCalendarEntries(nodes, { tasks: false }).map((n) => n.id),
    ["journal"],
  );
  assert.deepEqual(
    combinedCalendarEntries(nodes, { journals: false }).map((n) => n.id),
    ["task"],
  );
  assert.deepEqual(
    combinedCalendarEntries(nodes, { tasks: false, journals: false }),
    [],
  );
});

test("mixed date ranges pack together while midnight journal endings and timed entries stay correct", () => {
  const entries = combinedCalendarEntries([task, journal]);
  const segments = calendarSegments(entries, "2026-10-08", "2026-10-10");
  assert.equal(segments.find((s) => s.entry.id === "task").span, 3);
  assert.equal(segments.find((s) => s.entry.id === "journal").span, 1);
  assert.equal(new Set(segments.map((s) => s.lane)).size, 2);
  assert.deepEqual(
    calendarSegments(entries, "2026-10-09", "2026-10-09").map(
      (s) => s.entry.id,
    ),
    ["task"],
  );
  const timed = timedSegments(entries, "2026-10-08");
  assert.equal(timed.length, 1);
  assert.equal(timed[0].entry.id, "journal");
  assert.equal(timed[0].end, 1440);
  assert.equal(timedSegments(entries, "2026-10-09").length, 0);
});

test("lightweight calendar summaries retain dates but exclude bodies, attachments and checkpoint descriptions", () => {
  const summaries = [task, journal, undated].map((n) =>
    workspaceNode(n, "calendar"),
  );
  assert.ok(
    summaries.every((n) => n.partial && !n.body && !n.resources.length),
  );
  assert.deepEqual(summaries[0].task, {
    start: task.task.start,
    due: task.task.due,
    checkpoints: [{ id: "verify", due: "2026-10-09", done: false }],
  });
  assert.equal(summaries[1].resourceCount, 1);
  assert.deepEqual(
    combinedCalendarEntries(summaries).map((n) => [
      n.id,
      n.tool.date,
      n.tool.endDate,
    ]),
    [
      ["task", "2026-10-08", "2026-10-10"],
      ["journal", "2026-10-08", "2026-10-09"],
    ],
  );
  for (const schedule of [{ due: "2026-10-08" }, { start: "2026-10-08" }]) {
    const [entry] = combinedCalendarEntries([
      workspaceNode({ ...task, task: schedule }, "calendar"),
    ]);
    assert.equal(entry.tool.date, "2026-10-08");
    assert.equal(entry.tool.endDate, "2026-10-08");
  }
});

test("opening a task from calendar summaries preserves urgency from neighboring checkpoints", () => {
  const neighbor = {
    ...task,
    id: "neighbor",
    importance: 5,
    task: {
      start: "2026-10-01",
      due: "2026-12-01",
      checkpoints: [
        {
          id: "review",
          due: "2026-10-09",
          done: false,
          description: "Detailed review instructions",
        },
      ],
    },
  };
  const full = taskUrgencies([task, neighbor], "2026-10-08").get(task.id);
  const light = taskUrgencies(
    [task, workspaceNode(neighbor, "calendar")],
    "2026-10-08",
  ).get(task.id);
  assert.equal(full.nearbyCount, 1);
  assert.deepEqual(light, full);
});
