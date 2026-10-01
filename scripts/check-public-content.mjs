import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 ** 2 });
const violations = [];
for (const field of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
  const value = git("var", field).trim();
  if (!/^Jirkas-prog <[^@\s]+@users\.noreply\.github\.com> /.test(value))
    violations.push(`${field}: use the owner's public GitHub handle and noreply address.`);
}
const files = git("ls-files", "--stage", "-z").split("\0").filter(Boolean).map(entry => {
  const [, oid, stage, file] = entry.match(/^\d+ ([0-9a-f]+) (\d+)\t([\s\S]+)$/);
  if (stage !== "0") throw new Error("Resolve index conflicts before checking public content.");
  return { oid, file };
});
const batch = spawnSync("git", ["cat-file", "--batch"], {
  cwd: root,
  input: files.map(entry => entry.oid).join("\n") + "\n",
  maxBuffer: 64 * 1024 ** 2,
});
if (batch.status !== 0) throw new Error("Cannot read indexed Git objects.");
let offset = 0;
const patterns = [
  ["workstation user path", /[A-Z]:[\\/](?:Users|Documents and Settings)[\\/][^\s"'`<>]+/i],
  ["personal email", /\b[A-Z0-9._%+-]+@(?:gmail|seznam|centrum|outlook|hotmail|icloud|protonmail|yahoo)\.(?:com|cz)\b/i],
  ["private key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["service credential", /\b(?:gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{30,}|sk-(?:proj-)?[a-zA-Z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/],
];
for (const { file } of files) {
  const end = batch.stdout.indexOf(10, offset);
  const size = Number(batch.stdout.subarray(offset, end).toString().split(" ")[2]);
  if (!Number.isSafeInteger(size)) throw new Error("Missing indexed Git object.");
  const content = batch.stdout.subarray(end + 1, end + 1 + size);
  offset = end + 1 + size + 1;
  if (/(?:^|\/)(?:node_modules|\.data|\.history|\.trash|\.[^/]*-operations)(?:\/|$)|\.(?:sqlite(?:-wal|-shm)?|db|zip|fakturocel|log|pem|key)$/i.test(file))
    violations.push(`${file}: private or runtime artifact path`);
  if (/\.(?:png|jpg|ttf|woff2?)$/i.test(file)) continue;
  const text = content.toString("utf8");
  for (const [kind, pattern] of patterns)
    if (pattern.test(text)) violations.push(`${file}: potential ${kind}`);
  if (/\.md$/i.test(file) && /[A-Z]:[\\/]\d{2}_[^\s]+|\b192\.168\.\d{1,3}\.\d{1,3}\b/.test(text))
    violations.push(`${file}: non-generic documentation path or network address`);
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else console.log(`Public-content check passed for ${files.length} indexed files and the configured commit identity. History and public GitHub surfaces require a separate audit.`);
