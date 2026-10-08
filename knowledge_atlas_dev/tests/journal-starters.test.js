import test from "node:test";
import assert from "node:assert/strict";
import { startJournal, JOURNAL_STARTERS } from "../shared/journal-starters.js";
import { journalFromTask } from "../shared/task-workflow.js";
import { validateNode } from "../shared/schema.js";
import { translate } from "../shared/i18n.js";

const entry = () =>
  journalFromTask(
    {
      id: "example-task",
      title: "",
      parent: null,
      tags: ["workshop"],
      color: "#aacc88",
      importance: 4,
    },
    { id: "example-entry", date: "2026-12-29" },
  );

test("journal starters create editable localized records, cross years, and preserve task links without fetching files", () => {
  for (const language of ["en", "cs"]) {
    for (const kind of JOURNAL_STARTERS) {
      const original = entry();
      const before = structuredClone(original);
      const result = startJournal(original, kind, (...args) =>
        translate(language, ...args),
      );
      validateNode(result);
      assert.deepEqual(original, before);
      assert.equal(
        result.title,
        translate(language, `journal.starter.${kind}`),
      );
      assert.match(result.body, /^## /);
      assert.equal(result.tool.date, "2026-12-29");
      assert.equal(
        result.tool.endDate,
        kind === "week" ? "2027-01-04" : "2026-12-29",
      );
      assert.deepEqual(result.related, ["example-task"]);
      assert.deepEqual(result.resources, []);
      assert.equal(result.importance, 4);
      assert.deepEqual(result.tags, ["workshop"]);
    }
  }
});

test("starters never replace writing or saved entries and retain chosen titles, appointments and date ranges", () => {
  const t = (...args) => translate("en", ...args);
  for (const patch of [{ body: "My own writing" }, { revision: "saved" }]) {
    const original = { ...entry(), ...patch };
    assert.equal(startJournal(original, "week", t), original);
  }
  const unknown = entry();
  assert.equal(startJournal(unknown, "unknown", t), unknown);
  for (const patch of [
    { startTime: "09:00", endTime: "10:00" },
    { endDate: "2027-01-15", period: "custom" },
  ]) {
    const original = entry();
    original.title = "Existing title";
    Object.assign(original.tool, patch);
    const result = startJournal(original, "week", t);
    assert.deepEqual(result.tool, original.tool);
    assert.equal(result.title, original.title);
    assert.equal(startJournal(result, "meeting", t), result);
  }
});
