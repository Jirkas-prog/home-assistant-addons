import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  taskCalendarEntry,
  journalFromTask,
  projectForTask,
} from "../shared/task-workflow.js";
import { calendarSegments } from "../shared/journal-calendar.js";
import { validateNode, validateGraph } from "../shared/schema.js";
import { Settings } from "../server/settings.js";
import { projectFor } from "../src/work-model.js";

const task = (id, start = "", due = "") => ({
  schema: 2,
  id,
  title: "Inspect the prototype",
  type: "task",
  status: "active",
  parent: "example-project",
  projectId: "",
  importance: 5,
  color: "#aacc88",
  summary: "",
  body: "",
  tags: ["workshop"],
  resources: [],
  related: [],
  task: { start, due, priority: "high", assignee: "", checkpoints: [] },
});
test("task calendar places single-ended dates, spans weeks, and leaves undated tasks outside the grid", () => {
  const originals = [
    task("range", "2026-10-02", "2026-10-13"),
    task("due", "", "2026-10-06"),
    task("start", "2026-10-10"),
    task("undated"),
  ];
  const before = structuredClone(originals);
  const entries = originals.map(taskCalendarEntry).filter(Boolean);
  const segments = calendarSegments(entries, "2026-10-05", "2026-10-11");
  assert.equal(segments.length, 3);
  assert.deepEqual(
    segments.map((s) => [s.entry.id, s.span, s.before, s.after]),
    [
      ["range", 7, true, true],
      ["due", 1, false, false],
      ["start", 1, false, false],
    ],
  );
  assert.deepEqual(originals, before);
  assert.equal(taskCalendarEntry(originals[3]), null);
});
test("a new project and linked task journal form a valid graph without copying attachments or completing the task", () => {
  const project = projectForTask(" Example project ", {
    id: "example-project",
    parent: null,
    color: "#aacc88",
  });
  const source = task("example-task");
  source.resources.push({
    id: "example-file",
    label: "Large file",
    path: "large.zip",
    locationId: "addon",
  });
  const before = structuredClone(source);
  const entry = journalFromTask(source, {
    id: "example-entry",
    date: "2026-10-08",
    projectId: projectFor(source, [project])?.id,
  });
  for (const n of [project, source, entry]) validateNode(n);
  validateGraph([project, source, entry]);
  assert.equal(project.title, "Example project");
  assert.equal(entry.projectId, project.id);
  assert.equal(entry.parent, project.id);
  assert.deepEqual(entry.related, [source.id]);
  assert.equal(entry.importance, 5);
  assert.equal(entry.tool.date, "2026-10-08");
  assert.equal(entry.resources.length, 0);
  entry.tags.push("reflection");
  assert.deepEqual(source, before);
});
test("default task views migrate old settings, persist across restart, and reject invalid values and stale writes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-task-view-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const settings = new Settings(root, false);
  await settings.init();
  const raw = JSON.parse(await fs.readFile(settings.file, "utf8"));
  delete raw.taskDefaultView;
  delete raw.taskCalendarView;
  await fs.writeFile(settings.file, JSON.stringify(raw));
  const old = await settings.read();
  assert.equal(old.taskDefaultView, "timeline");
  assert.equal(old.taskCalendarView, "month");
  await settings.save(
    { ...old, taskDefaultView: "calendar", taskCalendarView: "week" },
    [],
  );
  const restarted = await new Settings(root, false).read();
  assert.equal(restarted.taskDefaultView, "calendar");
  assert.equal(restarted.taskCalendarView, "week");
  assert.deepEqual(restarted.locations, old.locations);
  await assert.rejects(
    settings.save({ ...old, taskDefaultView: "board" }, []),
    /settings have changed/,
  );
  for (const invalid of [
    { taskDefaultView: "unknown" },
    { taskCalendarView: "unknown" },
  ])
    assert.throws(
      () => settings.validate({ ...restarted, ...invalid }),
      /Invalid default task view/,
    );
});
