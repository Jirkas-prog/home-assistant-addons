import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { createApp } from "../server/index.js";
import { Backups } from "../server/backups.js";
import { PackageImports } from "../server/packages.js";
import { TaskData, validateTaskData } from "../server/task-data.js";
import { MapPositions } from "../server/map-positions.js";
import { columnsFor, columnFor } from "../shared/boards.js";
import { backupPart } from "../shared/backup-selection.js";
import { serialize } from "../server/store.js";

const node = (id, extra = {}) => ({
  schema: 2,
  id,
  title: id,
  type: "task",
  parent: null,
  status: "draft",
  color: "#aa88cc",
  body: "Task description",
  summary: "",
  tags: [],
  related: [],
  resources: [],
  task: { start: "", due: "", checkpoints: [] },
  ...extra,
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-workspace-"));
  const directory = path.join(root, "library");
  const app = await createApp({ directory });
  const server = app.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    app.store.stopBackground();
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-workspace-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const request = async (url, method = "GET", body) => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api/${url}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Knowledge-Client": "atlas",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return { status: r.status, data: await r.json() };
  };
  return {
    ...app,
    directory,
    root,
    request,
    backups: new Backups(directory, app.settings),
  };
}

test("five columns retain legacy status meaning and explicit optional column identity", () => {
  assert.equal(columnsFor().length, 5);
  assert.equal(columnFor(node("sample")).id, "backlog");
  assert.equal(
    columnFor(node("sample", { task: { columnId: "nice-to-have" } })).id,
    "nice-to-have",
  );
  assert.equal(
    columnFor(
      node("sample", { status: "active", task: { columnId: "removed" } }),
    ).id,
    "in-progress",
  );
  assert.equal(
    backupPart(
      node("sample", { type: "knowledge", tool: { kind: "journal" } }),
    ),
    "journals",
  );
});

test("comments have revisions, recoverable deletion, durable activity and no startup payload growth", async (t) => {
  const f = await fixture(t);
  let r = await f.request("nodes", "POST", node("task-a"));
  assert.equal(r.status, 201);
  const comments = await f.request("tasks/task-a/comments");
  r = await f.request("tasks/task-a/comments", "POST", {
    revision: comments.data.revision,
    body: "A useful comment",
  });
  assert.equal(r.status, 200);
  const list = (await f.request("tasks/task-a/comments")).data;
  assert.equal(list.entries.length, 1);
  assert.equal(
    (
      await f.request("tasks/task-a/comments", "POST", {
        revision: list.revision,
        id: list.entries[0].id,
        body: "  ",
      })
    ).status,
    400,
  );
  r = await f.request("tasks/task-a/comments", "POST", {
    revision: comments.data.revision,
    body: "Stale edit",
  });
  assert.equal(r.status, 409);
  const history = (await f.request("undo")).data;
  assert.equal(
    (await f.request("undo/undo", "POST", { revision: history.revision }))
      .status,
    200,
  );
  assert.equal((await f.request("tasks/task-a/comments")).data.total, 0);
  const undone = (await f.request("undo")).data;
  await f.request("undo/redo", "POST", { revision: undone.revision });
  assert.equal((await f.request("tasks/task-a/comments")).data.total, 1);
  const feed = (await f.request("tasks/task-a/activity")).data;
  assert.ok(feed.entries.some((e) => e.source === "undo"));
  assert.ok(feed.entries.some((e) => e.source === "redo"));
  assert.throws(() =>
    validateTaskData(`activity/task-a/${feed.entries[0].id}.json`, {
      ...feed.entries[0],
      id: "mismatched-event",
    }),
  );
  const latest = (await f.request("tasks/task-a/comments")).data;
  await f.request("tasks/task-a/comments", "POST", {
    id: latest.entries[0].id,
    revision: latest.revision,
    deleted: true,
  });
  const deleted = (await f.request("tasks/task-a/comments")).data;
  assert.equal(deleted.entries[0].deleted, true);
  assert.equal((await f.request("task-counts")).data["task-a"], 0);
  await f.request("tasks/task-a/comments", "POST", {
    id: deleted.entries[0].id,
    revision: deleted.revision,
    deleted: false,
  });
  await f.store.read();
  const workspace = await f.request("workspace?content=tasks&refresh=1");
  assert.ok(!JSON.stringify(workspace.data).includes("A useful comment"));
  const persisted = await new TaskData(f.directory).activity("task-a");
  assert.ok(persisted.entries.length >= 6);
});

test("board moves preserve checkpoint IDs and reject stale or implicit incomplete completion", async (t) => {
  const f = await fixture(t);
  const created = (
    await f.request(
      "nodes",
      "POST",
      node("task-a", {
        task: {
          checkpoints: [
            {
              id: "checkpoint-a",
              due: "2026-12-01",
              description: "Verify output",
              done: false,
            },
          ],
        },
      }),
    )
  ).data;
  assert.equal(
    (
      await f.request("tasks/task-a/move", "PUT", {
        revision: created.revision,
        columnId: "done",
        aggregate: true,
      })
    ).status,
    409,
  );
  const moved = await f.request("tasks/task-a/move", "PUT", {
    revision: created.revision,
    columnId: "in-progress",
    aggregate: true,
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.task.checkpoints[0].id, "checkpoint-a");
  assert.equal(
    (
      await f.request("tasks/task-a/move", "PUT", {
        revision: created.revision,
        columnId: "stuck",
        aggregate: true,
      })
    ).status,
    409,
  );
  const done = await f.request("tasks/task-a/move", "PUT", {
    revision: moved.data.revision,
    columnId: "done",
    aggregate: true,
    confirmIncomplete: true,
  });
  assert.equal(done.status, 200);
  assert.equal(done.data.task.checkpoints[0].done, false);
});

test("selected sections merge attachments, comments and activity without replacing unrelated data", async (t) => {
  const f = await fixture(t);
  await f.request(
    "nodes",
    "POST",
    node("project-a", {
      type: "project",
      task: undefined,
      body: "Private project body outside selection",
    }),
  );
  const config = await f.settings.read();
  await fs.mkdir(config.documentRoot, { recursive: true });
  await fs.writeFile(
    path.join(config.documentRoot, "task.txt"),
    "Task attachment",
  );
  await fs.writeFile(
    path.join(config.documentRoot, "unrelated.txt"),
    "Never selected",
  );
  await f.request(
    "nodes",
    "POST",
    node("task-a", {
      parent: "project-a",
      projectId: "project-a",
      resources: [
        {
          id: "attachment-a",
          label: "Task document",
          locationId: "addon",
          path: "task.txt",
        },
      ],
    }),
  );
  await f.request(
    "nodes",
    "POST",
    node("journal-a", {
      type: "knowledge",
      task: undefined,
      body: "Unrelated journal",
      tool: {
        schema: 1,
        kind: "journal",
        date: "2026-10-06",
        period: "day",
        minutes: 0,
        next: "",
        places: [],
      },
    }),
  );
  assert.ok((await f.store.read()).nodes.some((n) => n.id === "journal-a"));
  const comments = (await f.request("tasks/task-a/comments")).data;
  await f.request("tasks/task-a/comments", "POST", {
    revision: comments.revision,
    body: "Export this comment",
  });
  const archive = path.join(f.root, "selected.zip");
  await f.backups.export(createWriteStream(archive), { selection: ["tasks"] });
  const targetDir = path.join(f.root, "target"),
    target = await createApp({ directory: targetDir });
  t.after(() => target.store.stopBackground());
  await target.store.save(
    node("keep", {
      type: "knowledge",
      body: "Keep this record",
      task: undefined,
    }),
  );
  const backups = new Backups(targetDir, target.settings);
  const preview = await backups.prepare(createReadStream(archive));
  assert.equal(preview.kind, "merge");
  assert.equal(preview.contexts, 1);
  assert.deepEqual(preview.sections, ["tasks"]);
  const imports = new PackageImports(backups, (fn) => fn(), {
    sessions: new Map(),
  });
  await imports.start(preview.id, { revision: preview.revision });
  await imports.wait();
  assert.equal((await imports.status(preview.id)).phase, "complete");
  const snapshot = await target.store.read();
  assert.equal(snapshot.nodes.length, 3);
  assert.equal(snapshot.nodes.find((n) => n.id === "project-a").body, "");
  assert.equal(
    snapshot.nodes.find((n) => n.id === "keep").body,
    "Keep this record",
  );
  assert.ok(!snapshot.nodes.some((n) => n.id === "journal-a"));
  const task = snapshot.nodes.find((n) => n.id === "task-a");
  const currentConfig = await target.settings.read();
  assert.equal(
    await fs.readFile(
      path.join(currentConfig.documentRoot, task.resources[0].path),
      "utf8",
    ),
    "Task attachment",
  );
  assert.equal(
    (await new TaskData(targetDir).comments("task-a")).entries[0].body,
    "Export this comment",
  );
  assert.ok(
    (await new TaskData(targetDir).activity("task-a")).entries.length >= 2,
  );
  const again = await backups.prepare(createReadStream(archive), {
    purpose: "merge",
  });
  assert.ok(again.records.every((r) => r.status === "identical"));
  await imports.start(again.id, { revision: again.revision });
  await imports.wait();
  assert.equal((await target.store.read()).nodes.length, 3);
  assert.equal(
    (await new TaskData(targetDir).comments("task-a")).entries.length,
    1,
  );
});

test("map selection preserves coordinates and excludes tasks and journals", async (t) => {
  const f = await fixture(t);
  await f.store.save(node("project-a", { type: "project", task: undefined }));
  await f.store.save(node("task-a"));
  const positions = new MapPositions(f.directory);
  await positions.save(
    "nebula:2",
    [{ id: "project-a", x: 40, y: 20, z: 0 }],
    (await positions.read()).revision,
  );
  const archive = path.join(f.root, "map.zip");
  await f.backups.export(createWriteStream(archive), { selection: ["map"] });
  await positions.save(
    "nebula:2",
    [{ id: "project-a", x: 400, y: 200, z: 0 }],
    (await positions.read()).revision,
  );
  const preview = await f.backups.prepare(createReadStream(archive), {
    purpose: "merge",
  });
  assert.deepEqual(
    preview.records.map((r) => r.id),
    ["project-a"],
  );
  const imports = new PackageImports(f.backups, (fn) => fn(), {
    sessions: new Map(),
  });
  await imports.start(preview.id, { revision: preview.revision });
  await imports.wait();
  assert.equal((await imports.status(preview.id)).phase, "complete");
  assert.equal((await positions.read()).views["nebula:2"][0].x, 400);
  const targetDir = path.join(f.root, "map-target"),
    target = await createApp({ directory: targetDir });
  t.after(() => target.store.stopBackground());
  const backups = new Backups(targetDir, target.settings),
    targetPreview = await backups.prepare(createReadStream(archive)),
    targetImports = new PackageImports(backups, (fn) => fn(), {
      sessions: new Map(),
    });
  await targetImports.start(targetPreview.id, {
    revision: targetPreview.revision,
  });
  await targetImports.wait();
  assert.equal(
    (await targetImports.status(targetPreview.id)).phase,
    "complete",
  );
  assert.deepEqual(
    (await new MapPositions(targetDir).read()).views["nebula:2"],
    [{ id: "project-a", x: 40, y: 20, z: 0 }],
  );
});

test("column configuration migrates affected tasks in one undo step and rejects missing destinations", async (t) => {
  const f = await fixture(t);
  const project = (
    await f.request(
      "nodes",
      "POST",
      node("project-a", { type: "project", task: undefined }),
    )
  ).data;
  const task = (
    await f.request("nodes", "POST", node("task-a", { parent: project.id }))
  ).data;
  const columns = columnsFor()
    .map((c) => ({ id: c.id, name: c.id, status: c.status }))
    .filter((c) => c.id !== "backlog");
  const input = { revision: project.revision, board: { schema: 1, columns } };
  assert.equal(
    (await f.request("projects/project-a/board", "PUT", input)).status,
    400,
  );
  const before = (await f.request("undo")).data.undo;
  assert.equal(
    (
      await f.request("projects/project-a/board", "PUT", {
        ...input,
        destinations: { backlog: "nice-to-have" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request("nodes/task-a")).data.task.columnId,
    "nice-to-have",
  );
  const status = (await f.request("undo")).data;
  assert.equal(status.undo, before + 1);
  await f.request("undo/undo", "POST", { revision: status.revision });
  assert.equal((await f.request("nodes/task-a")).data.task.columnId, undefined);
  assert.equal((await f.request("nodes/project-a")).data.board, undefined);
  assert.equal((await f.request("nodes/task-a")).data.revision, task.revision);
});

test("a failed board reorder rolls back its status edit without losing a fixed position", async (t) => {
  const f = await fixture(t);
  await f.request("nodes", "POST", node("task-a"));
  await f.request("nodes", "POST", node("task-b"));
  const a = (await f.request("nodes/task-a")).data;
  const snapshot = await f.store.read();
  const rename = fs.rename;
  let failOnce = true;
  t.mock.method(fs, "rename", async (source, target) => {
    if (failOnce && target === path.join(f.directory, "list-order.json")) {
      failOnce = false;
      throw new Error("Injected board order failure");
    }
    return rename(source, target);
  });
  const result = await f.request("tasks/task-a/move", "PUT", {
    revision: a.revision,
    columnId: "in-progress",
    aggregate: true,
    beforeId: "task-b",
    orderRevision: snapshot.orderRevision,
  });
  assert.equal(result.status, 500);
  assert.equal((await f.request("nodes/task-a")).data.status, "draft");
  assert.equal((await f.request("nodes/task-a")).data.revision, a.revision);
});

test("combined task and journal backup restores both and keeps a changed project body", async (t) => {
  const f = await fixture(t);
  await f.store.save(
    node("project-a", {
      type: "project",
      task: undefined,
      body: "Current project body",
    }),
  );
  await f.store.save(node("task-a", { parent: "project-a" }));
  await f.store.save(
    node("journal-a", {
      parent: "project-a",
      type: "knowledge",
      task: undefined,
      related: ["task-a"],
      tool: {
        schema: 1,
        kind: "journal",
        date: "2026-10-06",
        minutes: 30,
        next: "",
        experience: true,
      },
    }),
  );
  const archive = path.join(f.root, "combined.zip");
  await f.backups.export(createWriteStream(archive), {
    selection: ["tasks", "journals"],
  });
  const plan = await f.backups.prepare(createReadStream(archive));
  assert.deepEqual(plan.sections, ["tasks", "journals"]);
  assert.equal(
    plan.records.find((r) => r.id === "project-a").status,
    "identical",
  );
  const imports = new PackageImports(f.backups, (fn) => fn(), {
    sessions: new Map(),
  });
  await imports.start(plan.id, { revision: plan.revision });
  await imports.wait();
  assert.equal((await imports.status(plan.id)).phase, "complete");
  assert.equal(
    (await f.store.read()).nodes.find((n) => n.id === "project-a").body,
    "Current project body",
  );
});

test("full backup validates and restores comments and durable activity", async (t) => {
  const f = await fixture(t);
  await f.request("nodes", "POST", node("task-a"));
  const comments = (await f.request("tasks/task-a/comments")).data;
  await f.request("tasks/task-a/comments", "POST", {
    revision: comments.revision,
    body: "Full backup comment",
  });
  const archive = path.join(f.root, "full.zip");
  await f.backups.export(createWriteStream(archive));
  const plan = await f.backups.prepare(createReadStream(archive));
  await f.backups.restore(plan.id, plan.revision);
  assert.equal(
    (await new TaskData(f.directory).comments("task-a")).entries[0].body,
    "Full backup comment",
  );
  assert.ok(
    (await new TaskData(f.directory).activity("task-a")).entries.length >= 2,
  );
});

test("committed activity outbox recovers an interrupted event write exactly once", async (t) => {
  const f = await fixture(t),
    rename = fs.rename;
  let failed = false;
  t.mock.method(fs, "rename", async (source, target) => {
    if (!failed && target.includes(`${path.sep}activity${path.sep}`)) {
      failed = true;
      throw new Error("Injected activity write failure");
    }
    return rename(source, target);
  });
  const created = await f.request("nodes", "POST", node("task-a"));
  assert.equal(created.status, 201);
  assert.equal(failed, true);
  const data = new TaskData(f.directory);
  assert.equal((await data.activity("task-a")).entries.length, 1);
  assert.equal((await f.request("undo")).data.undo, 1);
  assert.equal((await data.activity("task-a")).entries.length, 1);
});

test("manual Markdown edits produce detected activity without growing task landing data", async (t) => {
  const f = await fixture(t);
  await f.request("nodes", "POST", node("task-a"));
  await f.request("workspace?content=tasks&refresh=1");
  const current = (await f.request("nodes/task-a")).data;
  await fs.writeFile(
    path.join(f.directory, "task-a.md"),
    serialize({ ...current, body: "Manually updated notes" }),
  );
  const result = await f.request("workspace?content=tasks&refresh=1");
  assert.equal(result.data.nodes[0].body, "Manually updated notes");
  const events = (await f.request("tasks/task-a/activity")).data.entries;
  assert.equal(events.filter((e) => e.source === "detected").length, 1);
  await f.request("workspace?content=tasks&refresh=1");
  assert.equal(
    (await f.request("tasks/task-a/activity")).data.entries.length,
    events.length,
  );
});

test("a failed selected merge rolls back records and newly installed discussion files", async (t) => {
  const f = await fixture(t);
  await f.request("nodes", "POST", node("task-a"));
  const comments = (await f.request("tasks/task-a/comments")).data;
  await f.request("tasks/task-a/comments", "POST", {
    revision: comments.revision,
    body: "Exported comment",
  });
  const archive = path.join(f.root, "failure.zip");
  await f.backups.export(createWriteStream(archive), { selection: ["tasks"] });
  const targetDir = path.join(f.root, "destination"),
    target = await createApp({ directory: targetDir });
  t.after(() => target.store.stopBackground());
  await target.store.save(node("keep", { type: "knowledge", task: undefined }));
  const backups = new Backups(targetDir, target.settings);
  const plan = await backups.prepare(createReadStream(archive));
  const link = fs.link;
  let failed = false;
  t.mock.method(fs, "link", async (source, destination) => {
    if (!failed && destination.includes(`${path.sep}activity${path.sep}`)) {
      failed = true;
      throw new Error("Injected discussion import failure");
    }
    return link(source, destination);
  });
  const imports = new PackageImports(backups, (fn) => fn(), {
    sessions: new Map(),
  });
  await imports.start(plan.id, { revision: plan.revision });
  await imports.wait();
  assert.equal((await imports.status(plan.id)).phase, "error");
  assert.equal(failed, true);
  assert.deepEqual(
    (await target.store.read()).nodes.map((n) => n.id),
    ["keep"],
  );
  assert.equal(
    (await new TaskData(targetDir).comments("task-a")).entries.length,
    0,
  );
});
