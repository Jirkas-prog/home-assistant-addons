import fs from "node:fs/promises";
import yauzl from "yauzl";
import { fail } from "./store.js";

const LIMIT = 2_000_000;
export async function readAsText(resource) {
  if (!resource.file || ["folder", "place"].includes(resource.kind))
    fail("This link is not an accessible file.", 404);
  const handle = await fs.open(resource.file, "r");
  let bytes;
  try {
    const buffer = Buffer.alloc(Math.min(resource.size, LIMIT));
    const result = await handle.read(buffer, 0, buffer.length, 0);
    bytes = buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  const decoded = new TextDecoder(encoding).decode(bytes);
  const binary = /[\u0000-\u0008\u000e-\u001f\ufffd]/.test(decoded);
  return {
    body: decoded.replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
      "\uFFFD",
    ),
    encoding,
    binary,
    truncated: resource.size > bytes.length,
    editable: false,
    kind: "text",
    format: "plain",
  };
}
const unescapeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, entity) => {
    if (entity[0] === "#") {
      const n =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\uFFFD";
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity] || all;
  });
// Extract inert text only. No macros, external relationships, HTML or XML entities are executed.
export async function readOffice(resource) {
  const entries = await new Promise((resolve, reject) => {
    yauzl.open(resource.file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const result = [];
      let total = 0,
        count = 0,
        settled = false;
      const stop = (e) => {
        if (!settled) {
          settled = true;
          zip.close();
          reject(e);
        }
      };
      zip.on("error", stop);
      zip.on("end", () => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      });
      zip.on("entry", (entry) => {
        if (++count > 10000)
          return stop(
            new Error("The document contains too many archive entries."),
          );
        if (
          !/^(word\/document\.xml|content\.xml|ppt\/slides\/slide\d+\.xml)$/.test(
            entry.fileName,
          )
        )
          return zip.readEntry();
        if (
          entry.uncompressedSize > LIMIT ||
          total + entry.uncompressedSize > LIMIT
        )
          return stop(
            new Error("The document text exceeds the 2 MB preview limit."),
          );
        zip.openReadStream(entry, (e, stream) => {
          if (e) return stop(e);
          const chunks = [];
          stream.on("error", stop);
          stream.on("data", (chunk) => {
            total += chunk.length;
            if (total > LIMIT) {
              stream.destroy();
              stop(
                new Error("The document text exceeds the 2 MB preview limit."),
              );
            } else chunks.push(chunk);
          });
          stream.on("end", () => {
            if (!settled) {
              result.push({
                name: entry.fileName,
                xml: Buffer.concat(chunks).toString("utf8"),
              });
              zip.readEntry();
            }
          });
        });
      });
      zip.readEntry();
    });
  });
  if (!entries.length)
    fail(
      "No readable document text was found. Download the original or open it as text.",
    );
  const body = entries
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
    .map(({ xml }) => {
      if (/<!DOCTYPE|<!ENTITY/i.test(xml))
        fail("Document entity declarations are not supported.");
      return unescapeXml(
        xml
          .replace(/<(?:w:tab|text:tab)\b[^>]*\/>/g, "\t")
          .replace(/<\/(?:w:p|text:p|text:h|a:p|table:table-row)>/g, "\n")
          .replace(/<[^>]*>/g, ""),
      ).trim();
    })
    .join("\n\n");
  return { body, kind: "text", format: "plain", editable: false, office: true };
}
