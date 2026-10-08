import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createSpacesApp } from "../server/spaces.js";
import { Backups } from "../server/backups.js";

const note = (title = "Example note") => ({
  schema: 2,
  id: "same-id",
  title,
  type: "knowledge",
  parent: null,
  status: "active",
  importance: 3,
  color: "#a7e87b",
  tags: [],
  related: [],
  resources: [],
  summary: "",
  body: "Example contents",
});
async function fixture(t, prefix = "") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-spaces-"));
  const directory = path.join(root, "library");
  const host = await createSpacesApp({ directory, ingress: false });
  const app = express();
  app.use(prefix || "/", host.app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  const request = async (space, operation, body, method = "POST") => {
    const response = await fetch(
      `${base}${space ? `/spaces/${space}` : ""}/api/${operation}`,
      body === undefined
        ? {}
        : {
            method,
            headers: {
              "Content-Type": "application/json",
              "X-Knowledge-Client": "atlas",
            },
            body: JSON.stringify(body),
          },
    );
    const value = await response.json();
    assert.equal(response.status < 400, true, value.error);
    return value;
  };
  t.after(async () => {
    await host.stop();
    await new Promise((resolve) => server.close(resolve));
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-spaces-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, directory, host, base, request };
}

test("spaces isolate identical record IDs, settings, documents, undo and uploads, preserving the original library", async (t) => {
  const f = await fixture(t);
  await f.request("general", "nodes", note("Original atlas"));
  const general = await f.request("general", "settings");
  const { createdId: work } = await f.request("general", "spaces", {
    name: "Work",
    language: "en",
  });
  const upload = await f.request("general", "backup-transfers", {
    direction: "upload",
    size: 1024,
  });
  assert.equal(
    (await f.request("general", "backup-transfers")).uploads[0].id,
    upload.id,
  );
  assert.equal(
    (await fetch(`${f.base}/spaces/${work}/api/backup-transfers/${upload.id}`))
      .status,
    404,
  );
  const fresh = await f.request(work, "nodes");
  assert.deepEqual(fresh.nodes, []);
  assert.equal((await f.request(work, "undo")).undo, 0);
  assert.deepEqual((await f.request(work, "backup-transfers")).uploads, []);
  const personal = (await f.request(work, "spaces", { name: "Personal" }))
    .createdId;
  const [workSettings, personalSettings] = await Promise.all([
    f.request(work, "settings"),
    f.request(personal, "settings"),
  ]);
  assert.notEqual(general.libraryId, workSettings.libraryId);
  assert.notEqual(workSettings.libraryId, personalSettings.libraryId);
  assert.equal(workSettings.languageSelectionCompleted, true);
  assert.equal(
    workSettings.documentRoot,
    path.join(f.root, ".library-spaces", work, "library", "documents"),
  );
  assert.notEqual(general.documentRoot, workSettings.documentRoot);
  assert.notEqual(personalSettings.documentRoot, workSettings.documentRoot);
  await f.request(
    work,
    "settings",
    { ...workSettings, catEnabled: false, language: "cs" },
    "PUT",
  );
  await Promise.all([
    f.request(work, "nodes", note("Work note")),
    f.request(personal, "nodes", note("Personal note")),
  ]);
  assert.equal(
    (await f.request("general", "nodes/same-id")).title,
    "Original atlas",
  );
  assert.equal((await f.request(work, "nodes/same-id")).title, "Work note");
  assert.equal(
    (await f.request(personal, "nodes/same-id")).title,
    "Personal note",
  );
  assert.equal(
    (await f.request("", "nodes/same-id")).title,
    "Original atlas",
    "legacy APIs never follow the default space",
  );
  assert.equal((await f.request("general", "settings")).language, "en");
  assert.equal((await f.request(work, "settings")).catEnabled, false);
  assert.equal((await f.request("general", "settings")).catEnabled, true);
  assert.ok(
    (await fs.readFile(path.join(f.directory, "same-id.md"), "utf8")).includes(
      "Original atlas",
    ),
  );
  const a = await f.host.openSpace("general"),
    b = await f.host.openSpace(work);
  await fs.mkdir(general.documentRoot, { recursive: true });
  await fs.mkdir(workSettings.documentRoot, { recursive: true });
  await fs.writeFile(
    path.join(general.documentRoot, "example.txt"),
    "Original attachment",
  );
  await fs.writeFile(
    path.join(workSettings.documentRoot, "example.txt"),
    "Work attachment",
  );
  const source = new Backups(a.store.directory, a.settings),
    target = new Backups(b.store.directory, b.settings);
  const zip = path.join(f.root, "example.zip");
  await source.export(createWriteStream(zip));
  const preview = await target.prepare(createReadStream(zip));
  assert.equal(
    preview.records,
    1,
    "backups contain exactly the selected atlas",
  );
  await target.restore(preview.id, preview.revision);
  assert.equal(
    (await f.request(work, "nodes/same-id")).title,
    "Original atlas",
  );
  assert.equal(
    (await f.request(personal, "nodes/same-id")).title,
    "Personal note",
  );
  assert.equal((await f.request("general", "spaces")).spaces.length, 3);
  assert.equal(
    await fs.readFile(path.join(general.documentRoot, "example.txt"), "utf8"),
    "Original attachment",
  );
  const restored = await f.request(work, "settings");
  assert.notEqual(restored.documentRoot, general.documentRoot);
  assert.equal(
    await fs.readFile(path.join(restored.documentRoot, "example.txt"), "utf8"),
    "Original attachment",
  );
});

test("default selection survives restart, concurrent creation and Ingress-style prefixes; direct links remain pinned", async (t) => {
  const f = await fixture(t, "/ingress/example");
  const created = await Promise.all([
    f.request("general", "spaces", { name: "Work" }),
    f.request("general", "spaces", { name: "Personal" }),
  ]);
  const id = created[0].createdId;
  await f.request(
    "general",
    `spaces/${id}`,
    { name: "Studio", makeDefault: true },
    "PATCH",
  );
  const response = await fetch(`${f.base}/?view=journal`, {
    redirect: "manual",
  });
  assert.equal(
    response.headers.get("location"),
    `./spaces/${id}/?view=journal`,
  );
  assert.equal(
    new URL(response.headers.get("location"), `${f.base}/`).pathname,
    `/ingress/example/spaces/${id}/`,
  );
  assert.equal((await f.request("general", "spaces")).currentId, "general");
  assert.equal((await f.request(id, "spaces")).spaces.length, 3);
  const slash = await fetch(`${f.base}/spaces/${id}?view=tasks`, {
    redirect: "manual",
  });
  assert.equal(
    new URL(slash.headers.get("location"), `${f.base}/spaces/${id}`).pathname,
    `/ingress/example/spaces/${id}/`,
  );
  await f.host.stop();
  const restarted = await createSpacesApp({
    directory: f.directory,
    ingress: false,
  });
  t.after(() => restarted.stop());
  const second = restarted.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => second.once("listening", resolve));
  try {
    const result = await fetch(`http://127.0.0.1:${second.address().port}/`, {
      redirect: "manual",
    });
    assert.equal(result.headers.get("location"), `./spaces/${id}/`);
  } finally {
    await new Promise((resolve) => second.close(resolve));
  }
});

test("cat preferences migrate, validate, persist per space and round-trip in backups", async (t) => {
  const f = await fixture(t, "/api/hassio_ingress/example");
  await f.request("general", "settings");
  const file = path.join(f.directory, "settings.json");
  const legacy = JSON.parse(await fs.readFile(file, "utf8"));
  delete legacy.catMotion;
  delete legacy.catPersonality;
  legacy.languageSelectionCompleted = true;
  await fs.writeFile(file, JSON.stringify(legacy));
  let settings = await f.request("general", "settings");
  assert.equal(settings.catMotion, "full");
  assert.equal(settings.catPersonality, "classic");
  assert.equal(settings.languageSelectionCompleted, true);
  const { createdId } = await f.request("general", "spaces", {
    name: "Example",
  });
  for (const mode of ["system", "full", "still"]) {
    settings = await f.request(
      "general",
      "settings",
      { ...settings, catMotion: mode },
      "PUT",
    );
    assert.equal((await f.request("general", "settings")).catMotion, mode);
    assert.equal((await f.request(createdId, "settings")).catMotion, "full");
  }
  for (const personality of ["quiet", "classic", "curious", "playful"]) {
    settings = await f.request(
      "general",
      "settings",
      { ...settings, catPersonality: personality },
      "PUT",
    );
    assert.equal(
      (await f.request("general", "settings")).catPersonality,
      personality,
    );
    assert.equal(
      (await f.request(createdId, "settings")).catPersonality,
      "classic",
    );
  }
  for (const invalidPersonality of [
    "unknown",
    "constructor",
    "__proto__",
    ["classic"],
    3,
  ]) {
    const invalid = await fetch(`${f.base}/spaces/general/api/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
      },
      body: JSON.stringify({ ...settings, catPersonality: invalidPersonality }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(
      (await f.request("general", "settings")).catPersonality,
      "playful",
    );
  }
  const invalid = await fetch(`${f.base}/spaces/general/api/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Knowledge-Client": "atlas",
    },
    body: JSON.stringify({ ...settings, catMotion: "invalid" }),
  });
  assert.equal(invalid.status, 400);
  const a = await f.host.openSpace("general"),
    b = await f.host.openSpace(createdId);
  const zip = path.join(f.root, "motion.zip");
  await new Backups(a.store.directory, a.settings).export(
    createWriteStream(zip),
  );
  const backup = new Backups(b.store.directory, b.settings);
  const preview = await backup.prepare(createReadStream(zip));
  await backup.restore(preview.id, preview.revision);
  assert.equal((await b.settings.read()).catMotion, "still");
  assert.equal((await b.settings.read()).catPersonality, "playful");
  await f.host.stop();
  const restarted = await createSpacesApp({
    directory: f.directory,
    ingress: false,
  });
  t.after(() => restarted.stop());
  assert.equal(
    (await (await restarted.openSpace("general")).settings.read()).catMotion,
    "still",
  );
  assert.equal(
    (await (await restarted.openSpace(createdId)).settings.read()).catMotion,
    "still",
  );
  for (const space of ["general", createdId])
    assert.equal(
      (await (await restarted.openSpace(space)).settings.read()).catPersonality,
      "playful",
    );
});

test("unknown spaces never fall through to General and management retains request protection", async (t) => {
  const f = await fixture(t);
  for (const id of [
    "missing",
    "00000000-0000-0000-0000-000000000000",
    "..%2Fgeneral",
  ]) {
    const response = await fetch(`${f.base}/spaces/${id}/api/nodes`);
    assert.equal(response.status, 404);
  }
  const missingHeader = await fetch(`${f.base}/spaces/general/api/spaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Work" }),
  });
  assert.equal(missingHeader.status, 403);
  for (const [body, status] of [
    [{ name: "  " }, 400],
    [{ name: "General" }, 409],
    [{ name: "Work", language: "unknown" }, 400],
  ]) {
    const response = await fetch(`${f.base}/spaces/general/api/spaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, status);
  }
  assert.equal((await f.request("general", "spaces")).spaces.length, 1);
});
