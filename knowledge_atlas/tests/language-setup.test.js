import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "../server/index.js";
import { initializeLibrary } from "../server/initialize.js";
import { Settings } from "../server/settings.js";

async function directory(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "atlas-language-setup-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function service(t, root) {
  const instance = await createApp({ directory: root, allowOpen: false });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    ...instance,
    request: (route, method = "GET", body, protectedRequest = true) =>
      fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(protectedRequest ? { "X-Knowledge-Client": "atlas" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
  };
}

for (const language of ["en", "cs"]) {
  test(`fresh installation confirms ${language} once and preserves it across restart and update`, async (t) => {
    const root = await directory(t);
    await initializeLibrary(root, path.resolve("seed"));
    const first = await service(t, root);
    const initial = await first.settings.read();
    assert.equal(initial.language, "en");
    assert.equal(initial.languageSelectionCompleted, false);
    const recordBefore = await fs.readFile(path.join(root, "welcome.md"));
    await initializeLibrary(root, path.resolve("seed"));
    const restartedBeforeChoice = await service(t, root);
    assert.equal(
      (await restartedBeforeChoice.settings.read()).languageSelectionCompleted,
      false,
    );
    const response = await first.request("settings/language", "POST", {
      language,
      revision: initial.revision,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).languageSelectionCompleted, true);
    const restarted = await service(t, root);
    const saved = await restarted.settings.read();
    assert.equal(saved.language, language);
    assert.equal(saved.languageSelectionCompleted, true);
    const snapshot = await (await restarted.request("nodes")).json();
    assert.equal(snapshot.settings.languageSelectionCompleted, true);
    assert.equal(snapshot.settings.language, language);
    assert.deepEqual(
      await fs.readFile(path.join(root, "welcome.md")),
      recordBefore,
    );
    // The ordinary settings screen can change language later without reopening setup.
    const changed = await restarted.request("settings", "PUT", {
      ...saved,
      language: language === "en" ? "cs" : "en",
    });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).languageSelectionCompleted, true);
  });
}

test("upgrades preserve existing settings byte-for-byte and skip setup even without an old language field", async (t) => {
  for (const language of ["en", "cs", undefined]) {
    const root = await directory(t);
    const value = new Settings(root, false).defaults;
    delete value.languageSelectionCompleted;
    if (language) value.language = language;
    else delete value.language;
    const original = JSON.stringify(value);
    await fs.writeFile(path.join(root, "settings.json"), original);
    await initializeLibrary(root, path.resolve("seed"));
    const app = await service(t, root);
    const config = await app.settings.read();
    assert.equal(config.languageSelectionCompleted, true);
    assert.equal(config.language, language || "en");
    assert.equal(
      await fs.readFile(path.join(root, "settings.json"), "utf8"),
      original,
    );
  }
});

test("legacy empty installations and manually populated libraries do not trigger first-launch setup", async (t) => {
  for (const mode of ["old-marker", "manual-record"]) {
    const root = await directory(t);
    if (mode === "old-marker")
      await fs.writeFile(
        path.join(root, ".initialized"),
        "2026-09-30T09:00:00.000Z",
      );
    else
      await fs.copyFile(
        path.resolve("seed/atlas.md"),
        path.join(root, "atlas.md"),
      );
    await initializeLibrary(root, path.resolve("seed"));
    const app = await service(t, root);
    assert.equal((await app.settings.read()).languageSelectionCompleted, true);
    const records = (await fs.readdir(root)).filter((name) =>
      name.endsWith(".md"),
    );
    assert.deepEqual(records, mode === "old-marker" ? [] : ["atlas.md"]);
  }
});

test("failed, unauthorized and concurrent language saves cannot silently reset or finish setup", async (t) => {
  const root = await directory(t);
  await initializeLibrary(root, path.resolve("seed"));
  const app = await service(t, root);
  const initial = await app.settings.read();
  assert.equal(
    (
      await app.request("settings/language", "POST", {
        language: "invalid",
        revision: initial.revision,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await app.request(
        "settings/language",
        "POST",
        { language: "cs", revision: initial.revision },
        false,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await app.request("settings/language", "POST", {
        language: "cs",
        revision: "stale",
      })
    ).status,
    409,
  );
  assert.equal((await app.settings.read()).languageSelectionCompleted, false);
  const responses = await Promise.all(
    ["en", "cs"].map((language) =>
      app.request("settings/language", "POST", {
        language,
        revision: initial.revision,
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const winner = await responses.find((r) => r.status === 200).json();
  const saved = await app.settings.read();
  assert.equal(saved.language, winner.language);
  assert.equal(saved.languageSelectionCompleted, true);
  // Completion is monotonic even if a stale client explicitly tries to reopen it.
  assert.equal(
    (
      await app.request("settings", "PUT", {
        ...saved,
        languageSelectionCompleted: false,
      })
    ).status,
    200,
  );
  assert.equal((await app.settings.read()).languageSelectionCompleted, true);
  assert.equal(
    (
      await app.request("settings", "PUT", {
        ...(await app.settings.read()),
        languageSelectionCompleted: "false",
      })
    ).status,
    400,
  );
});

test("language choice preserves unrelated settings and stays available while repairing invalid Markdown", async (t) => {
  const root = await directory(t);
  await initializeLibrary(root, path.resolve("seed"));
  const app = await service(t, root);
  await fs.writeFile(path.join(root, "broken.md"), "Invalid record");
  const before = await app.settings.read();
  const result = await app.request("settings/language", "POST", {
    language: "cs",
    revision: before.revision,
    documentRoot: "ignored",
  });
  assert.equal(result.status, 200);
  const after = await result.json();
  assert.equal(after.documentRoot, before.documentRoot);
  assert.deepEqual(after.locations, before.locations);
  assert.equal(after.languageSelectionCompleted, true);
  assert.equal(
    await fs.readFile(path.join(root, "broken.md"), "utf8"),
    "Invalid record",
  );
});
