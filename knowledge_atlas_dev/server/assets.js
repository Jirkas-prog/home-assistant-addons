import fs from "node:fs/promises";
import path from "node:path";

// Vite hashes these filenames; compression runs once at build time.
export function compressedAssets(directory) {
  return async (req, res, next) => {
    if (
      !["GET", "HEAD"].includes(req.method) ||
      !/^\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(req.path)
    )
      return next();
    res.vary("Accept-Encoding");
    if (!req.acceptsEncodings("gzip")) return next();
    const file = path.join(directory, `${req.path.slice(1)}.gz`);
    try {
      await fs.access(file);
    } catch {
      return next();
    }
    res.type(path.extname(req.path)).set("Content-Encoding", "gzip");
    res.sendFile(file, { maxAge: "1y", immutable: true }, (error) => {
      if (error) next(error);
    });
  };
}
