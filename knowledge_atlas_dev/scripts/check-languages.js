import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import en from "../shared/locales/en.json" with { type: "json" };
import cs from "../shared/locales/cs.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set(["node_modules", "dist", "data", ".git", "releases"]);
const czech =
  /[\u00e1\u010d\u010f\u00e9\u011b\u00ed\u0148\u00f3\u0159\u0161\u0165\u00fa\u016f\u00fd\u017e\u00c1\u010c\u010e\u00c9\u011a\u00cd\u0147\u00d3\u0158\u0160\u0164\u00da\u016e\u00dd\u017d]/;
// Complement the character scan with common accent-free Czech interface words.
const czechWords =
  /\b(?:Zaznam|Znalost|Dovednost|Ulozit|Zrusit|Smazat|Soubory|Nastaveni|Poznamky|Rozbalit|Sbalit|Hotovo|Upravit|Zobrazit|Vyberte|Dnes)\b/i;
const placeholders = (s) =>
  [...s.matchAll(/\{\d+\}/g)]
    .map((m) => m[0])
    .sort()
    .join(",");
function walk(value, visit) {
  if (!value || typeof value !== "object") return;
  visit(value);
  for (const item of Object.values(value)) {
    if (Array.isArray(item)) item.forEach((x) => walk(x, visit));
    else if (item && typeof item === "object") walk(item, visit);
  }
}
export async function checkLanguages() {
  const errors = [],
    files = [];
  async function scan(folder) {
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      if (ignored.has(item.name)) continue;
      const absolute = path.join(folder, item.name),
        file = path.relative(root, absolute).replaceAll("\\", "/");
      if (item.isDirectory()) {
        await scan(absolute);
        continue;
      }
      if (file === "shared/locales/cs.json" || /\.(png|jpg|woff2?)$/.test(file))
        continue;
      const source = await fs.readFile(absolute, "utf8");
      files.push(file);
      if (
        czech.test(source) ||
        (file !== "scripts/check-languages.js" && czechWords.test(source))
      )
        errors.push(`${file}: unexpected Czech text`);
      if (/\.(jsx?|mjs)$/.test(file)) {
        const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
        walk(ast, (node) => {
          if (
            node.type === "CallExpression" &&
            node.callee?.name === "t" &&
            node.arguments[0]?.type === "StringLiteral" &&
            !Object.hasOwn(en, node.arguments[0].value)
          )
            errors.push(
              `${file}: missing translation ${node.arguments[0].value}`,
            );
          if (node.type === "Identifier" && czech.test(node.name))
            errors.push(`${file}: localized code identifier`);
          if (
            ["StringLiteral", "JSXText"].includes(node.type) &&
            file !== "scripts/check-languages.js" &&
            czech.test(node.value)
          )
            errors.push(`${file}: escaped Czech text outside locale`);
        });
      }
    }
  }
  if (
    JSON.stringify(Object.keys(en).sort()) !==
    JSON.stringify(Object.keys(cs).sort())
  )
    errors.push("Translation keys do not match.");
  for (const key of Object.keys(en)) {
    if (
      typeof en[key] !== "string" ||
      typeof cs[key] !== "string" ||
      placeholders(en[key]) !== placeholders(cs[key])
    )
      errors.push(`Invalid placeholders: ${key}`);
  }
  await scan(root);
  if (errors.length) throw new Error(errors.join("\n"));
  return { files: files.length, messages: Object.keys(en).length };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log("Language audit passed:", await checkLanguages());
}
