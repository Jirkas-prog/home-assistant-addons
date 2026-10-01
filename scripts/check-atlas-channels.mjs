import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const channels = [
  { directory: "knowledge_atlas", channel: "stable", name: "Knowledge Atlas", slug: "knowledge_atlas_v5", stage: "stable" },
  { directory: "knowledge_atlas_dev", channel: "dev", name: "Knowledge Atlas Dev", slug: "knowledge_atlas_dev", stage: "experimental" },
];
const entries = await fs.readdir(root, { withFileTypes: true });
assert.deepEqual(
  entries.filter(entry => entry.isDirectory() && entry.name.startsWith("knowledge_atlas")).map(entry => entry.name).sort(),
  channels.map(channel => channel.directory).sort(),
  "Only the two permanent Knowledge Atlas channel directories may be published.",
);
const read = (folder, file) => fs.readFile(path.join(root, folder, file), "utf8");
const scalar = (text, key) => text.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, "m"))?.[1].replace(/^"|"$/g, "");
for (const expected of channels) {
  const config = await read(expected.directory, "config.yaml");
  const identity = JSON.parse(await read(expected.directory, "release.json"));
  const pkg = JSON.parse(await read(expected.directory, "package.json"));
  const lock = JSON.parse(await read(expected.directory, "package-lock.json"));
  const docker = await read(expected.directory, "Dockerfile");
  assert.deepEqual(identity, { channel: expected.channel, name: expected.name, slug: expected.slug });
  for (const key of ["name", "slug", "stage"]) assert.equal(scalar(config, key), expected[key]);
  assert.equal(scalar(config, "panel_title"), expected.name);
  assert.equal(scalar(config, "version"), pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.match(pkg.version, expected.channel === "stable" ? /^\d+\.\d+\.\d+$/ : /^\d+\.\d+\.\d+-dev\.\d+$/);
  assert.ok(docker.includes(`ARG BUILD_VERSION=${pkg.version}`));
  assert.ok(docker.includes(`io.hass.name="${expected.name}"`));
  assert.equal(scalar(config, "url"), `https://github.com/Jirkas-prog/home-assistant-addons/tree/main/${expected.directory}`);
  assert.match(config, /type: addon_config\s+read_only: false\s+path: \/config/);
  assert.match(config, /DATA_DIR: \/config\/knowledge/);
  assert.match(config, /DOCUMENT_ROOT: \/config\/documents/);
  assert.match(await read(expected.directory, "server/bootstrap.js"), /await initializeLibrary\(directory\);/);
  assert.doesNotMatch(await read(expected.directory, "src/language-setup.jsx"), /<small>V\d+<\/small>/);
  assert.ok((await read(expected.directory, "CHANGELOG.md")).includes(`## ${pkg.version}`));
  console.log(`${expected.name}: ${pkg.version}; permanent identity and isolated storage configuration verified.`);
}
