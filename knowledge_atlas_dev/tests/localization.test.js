import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { initializeLibrary } from "../server/initialize.js";
import {
  translate,
  t,
  setLanguage,
  getLanguage,
  localizeMessage,
} from "../shared/i18n.js";
import { TASK_STATUS, PRIORITIES } from "../src/work-model.js";
import en from "../shared/locales/en.json" with { type: "json" };
import cs from "../shared/locales/cs.json" with { type: "json" };
import { checkLanguages } from "../scripts/check-languages.js";

test("all shipped source uses English outside the Czech catalog", async () => {
  const result = await checkLanguages();
  assert.ok(result.messages > 350);
});
test("both catalogs interpolate text without altering user values or workflow IDs", () => {
  const ids = Object.keys(TASK_STATUS),
    priorities = Object.keys(PRIORITIES);
  for (const language of ["en", "cs"]) {
    setLanguage(language);
    const catalog = language === "en" ? en : cs;
    for (const key of Object.keys(en))
      assert.equal(translate(language, key), catalog[key]);
    assert.equal(TASK_STATUS.draft, catalog.m226);
    assert.equal(PRIORITIES.high, catalog.m231);
    assert.deepEqual(Object.keys(TASK_STATUS), ids);
    assert.deepEqual(Object.keys(PRIORITIES), priorities);
    const value = 'someFunction("{1}", "$&")';
    assert.equal(
      t("m040", value),
      catalog.m040.replace("{0}", () => value),
    );
    assert.equal(localizeMessage(en.m296), catalog.m296);
    assert.equal(
      localizeMessage("Record “custom-id” references a missing project."),
      catalog.m348.replace("{0}", "custom-id"),
    );
  }
  setLanguage("unsupported");
  assert.equal(getLanguage(), "en");
  const unknownKey = "missing-key";
  assert.equal(t(unknownKey), unknownKey);
});
test("language defaults to English, persists through restart and never rewrites records", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-language-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await initializeLibrary(directory, path.resolve("seed"));
  const { app, settings } = await createApp({ directory, allowOpen: false });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/api/settings`;
  const put = (body) =>
    fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
      },
      body: JSON.stringify(body),
    });
  const before = await fs.readFile(path.join(directory, "welcome.md"));
  assert.equal((await settings.read()).language, "en");
  for (const language of ["cs", "en"]) {
    assert.equal(
      (await put({ ...(await settings.read()), language })).status,
      200,
    );
    const restarted = await createApp({ directory, allowOpen: false });
    assert.equal((await restarted.settings.read()).language, language);
    assert.deepEqual(
      await fs.readFile(path.join(directory, "welcome.md")),
      before,
    );
  }
  assert.equal(
    (await put({ ...(await settings.read()), language: "invalid" })).status,
    400,
  );
  assert.equal((await settings.read()).language, "en");
  const legacy = await settings.read();
  delete legacy.language;
  delete legacy.revision;
  await fs.writeFile(
    path.join(directory, "settings.json"),
    JSON.stringify(legacy),
  );
  assert.equal((await settings.read()).language, "en");
});
test("first start seeds an empty library and restarts preserve edits and existing libraries", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-seeding-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await initializeLibrary(directory, path.resolve("seed"));
  const file = path.join(directory, "welcome.md");
  await fs.writeFile(file, "user content");
  await initializeLibrary(directory, path.resolve("seed"));
  assert.equal(await fs.readFile(file, "utf8"), "user content");
  const existing = path.join(directory, "existing");
  await fs.mkdir(existing);
  await fs.writeFile(path.join(existing, "custom.md"), "custom content");
  await initializeLibrary(existing, path.resolve("seed"));
  assert.deepEqual(
    (await fs.readdir(existing)).filter((x) => x.endsWith(".md")),
    ["custom.md"],
  );
});
