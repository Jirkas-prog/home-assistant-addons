import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Settings } from "../server/settings.js";
import { APPEARANCES, appearanceId } from "../shared/appearance.js";
import {
  readAppearance,
  rememberAppearance,
  applyAppearance,
} from "../src/appearance.js";

test("browser hints stay isolated by space and denied storage cannot break appearance", (t) => {
  const originals = ["location", "localStorage", "document"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const entries = new Map(),
    properties = new Map();
  const root = {
    dataset: {},
    style: { setProperty: (name, value) => properties.set(name, value) },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: root, querySelector: () => null },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { pathname: "/ingress/atlas/spaces/general/" },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => entries.get(key),
      setItem: (key, value) => entries.set(key, value),
    },
  });
  rememberAppearance("paper");
  applyAppearance("graphite"); // Unsaved preview does not replace the saved hint.
  assert.equal(readAppearance(), "paper");
  assert.equal(root.dataset.appearance, "graphite");
  assert.equal(root.style.colorScheme, "dark");
  location.pathname = "/ingress/atlas/spaces/work/";
  assert.equal(readAppearance(), "sage");
  rememberAppearance("tide");
  location.pathname = "/ingress/atlas/spaces/general/";
  applyAppearance(readAppearance());
  assert.equal(root.dataset.scheme, "light");
  assert.equal(properties.get("--canvas"), APPEARANCES.paper.canvas);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => {
      throw new Error("Storage unavailable");
    },
  });
  assert.equal(readAppearance(), "sage");
  assert.doesNotThrow(() => rememberAppearance("paper"));
  assert.doesNotThrow(() => applyAppearance("paper"));
});

test("appearance migrates old settings without changing other preferences and persists across restart", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-appearance-"));
  t.after(async () => {
    assert.ok(
      path
        .resolve(root)
        .startsWith(path.join(os.tmpdir(), "atlas-appearance-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const settings = new Settings(root, false);
  await settings.init();
  const raw = JSON.parse(await fs.readFile(settings.file, "utf8"));
  delete raw.appearance;
  raw.catEnabled = false;
  raw.taskDefaultView = "calendar";
  await fs.writeFile(settings.file, JSON.stringify(raw));
  const old = await settings.read();
  assert.equal(old.appearance, "sage");
  for (const appearance of Object.keys(APPEARANCES)) {
    await settings.save({ ...(await settings.read()), appearance }, []);
    const restarted = await new Settings(root, false).read();
    assert.equal(restarted.appearance, appearance);
    assert.equal(restarted.catEnabled, false);
    assert.equal(restarted.taskDefaultView, "calendar");
    assert.deepEqual(restarted.locations, old.locations);
  }
  await assert.rejects(
    settings.save({ ...old, appearance: "paper" }, []),
    /settings have changed/,
  );
  for (const invalid of ["unknown", "__proto__", "constructor", 3, {}, []]) {
    assert.throws(
      () => settings.validate({ ...old, appearance: invalid }),
      /Invalid appearance preference/,
    );
    assert.equal(appearanceId(invalid), "sage");
  }
});

function luminance(hex) {
  const c = hex
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
test("new palettes provide readable text and primary actions on their main surfaces", () => {
  for (const [id, p] of Object.entries(APPEARANCES)) {
    if (id === "classic") continue; // Preserve the requested original palette.
    const pairs = [
      ...[p.canvas, p.surface, p.raised, p.field, p.sidebar].flatMap((bg) =>
        [p.text, p.secondary, p.muted].map((fg) => [fg, bg]),
      ),
      [p.onAccent, p.accent],
      [p.accent, p.surface],
    ];
    for (const [fg, bg] of pairs) {
      const a = luminance(fg),
        b = luminance(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(
        ratio >= 4.5,
        `${id}: ${fg} on ${bg} has ${ratio.toFixed(2)} contrast`,
      );
    }
  }
});
