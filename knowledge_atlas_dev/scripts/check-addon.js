import fs from "node:fs/promises";
import assert from "node:assert/strict";
import YAML from "yaml";
import { Store, parseMarkdown, validateNode } from "../server/store.js";
const identity = JSON.parse(await fs.readFile("release.json", "utf8"));
const dev = identity.channel === "dev";
assert.ok(["stable", "dev"].includes(identity.channel));
assert.equal(identity.name, dev ? "Knowledge Atlas Dev" : "Knowledge Atlas");
assert.equal(identity.slug, dev ? "knowledge_atlas_dev" : "knowledge_atlas_v5");
const config = YAML.parse(await fs.readFile("config.yaml", "utf8"));
const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
const lock = JSON.parse(await fs.readFile("package-lock.json", "utf8"));
assert.equal(config.slug, identity.slug);
assert.equal(config.name, identity.name);
assert.equal(config.panel_title, identity.name);
assert.equal(config.stage, dev ? "experimental" : "stable");
assert.match(pkg.version, dev ? /^\d+\.\d+\.\d+-dev\.\d+$/ : /^\d+\.\d+\.\d+$/);
assert.equal(config.version, pkg.version);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[""].version, pkg.version);
assert.deepEqual(config.arch, ["amd64", "aarch64"]);
assert.equal(config.ingress, true);
assert.equal(config.ingress_port, 8099);
assert.ok(
  config.map.some(
    (m) => m.type === "addon_config" && m.path === "/config" && !m.read_only,
  ),
);
assert.equal(
  config.image,
  undefined,
  "Supervisor builds this add-on from its Dockerfile.",
);
const docker = await fs.readFile("Dockerfile", "utf8");
assert.ok(docker.includes(`ARG BUILD_VERSION=${pkg.version}`));
assert.ok(docker.includes(`io.hass.name="${identity.name}"`));
assert.match(docker, /COPY package.json release.json \.\//);
assert.match(docker, /COPY seed \.\/seed/);
assert.match(docker, /COPY shared \.\/shared/);
assert.match(docker, /COPY public \.\/public/);
assert.match(docker, /CMD \["node", "server\/bootstrap.js"\]/);
for (const file of [
  "README.md",
  "DOCS.md",
  "CHANGELOG.md",
  "FORMAT.md",
  "icon.png",
  "logo.png",
  "public/app-logo.svg",
])
  assert.ok((await fs.stat(file)).size > 0, file);
for (const file of ["icon.png", "logo.png"]) {
  const bytes = await fs.readFile(file);
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.equal(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}
const snapshot = await new Store("./seed").read();
assert.deepEqual(snapshot.errors, []);
assert.equal(snapshot.nodes.length, 6);
for (const name of ["task", "item", "journal", "bom", "procedure", "cards", "view"])
  validateNode(
    parseMarkdown(await fs.readFile(`templates/${name}.md`, "utf8")),
  );
console.log(
  `Add-on ${pkg.version}: configuration, versions, Dockerfile, documents, graphics and seed library passed.`,
);
