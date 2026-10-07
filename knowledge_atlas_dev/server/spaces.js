import express from "express";
import { fileURLToPath } from "node:url";
import { compressedAssets } from "./assets.js";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "./index.js";
import { accessGuard } from "./access.js";
import { initializeLibrary } from "./initialize.js";
import { recoverRestore } from "./backups.js";
import { Settings } from "./settings.js";
import { fail } from "../shared/schema.js";

const ID = /^(general|[a-f0-9-]{36})$/;
const nameOf = (value) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80)
    fail("Enter a space name (up to 80 characters).");
  return value.trim();
};

// The registry and additional libraries are siblings of the original library.
// Restoring or exporting any one library cannot include the other spaces.
export async function createSpacesApp({
  directory,
  ingress = process.env.HA_INGRESS === "1",
  ...options
}) {
  directory = path.resolve(directory);
  const root = path.join(
    path.dirname(directory),
    `.${path.basename(directory)}-spaces`,
  );
  await fs.mkdir(root, { recursive: true });
  if ((await fs.lstat(root)).isSymbolicLink())
    fail("The spaces directory must not be a symlink.", 403);
  const file = path.join(root, "spaces.json");
  let registry;
  try {
    registry = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    registry = {
      schema: 1,
      defaultId: "general",
      spaces: [{ id: "general", name: "General" }],
    };
    await fs.writeFile(file, JSON.stringify(registry, null, 2) + "\n", {
      flag: "wx",
      flush: true,
    });
  }
  if (
    registry.schema !== 1 ||
    !Array.isArray(registry.spaces) ||
    !registry.spaces.some((s) => s.id === "general") ||
    !registry.spaces.some((s) => s.id === registry.defaultId) ||
    new Set(registry.spaces.map((s) => s.id)).size !== registry.spaces.length ||
    registry.spaces.some(
      (s) => !ID.test(s.id) || typeof s.name !== "string" || !s.name.trim(),
    )
  )
    fail(
      "The atlas space registry is invalid. Repair spaces.json before continuing.",
      500,
    );

  const instances = new Map();
  let queue = Promise.resolve();
  const change = (operation) => {
    const result = queue.then(async () => {
      const next = structuredClone(registry);
      await operation(next);
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(next, null, 2) + "\n", {
          flag: "wx",
          flush: true,
        });
        await fs.rename(temporary, file);
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
      registry = next;
    });
    queue = result.catch(() => {});
    return result;
  };
  const spaceDirectory = (id) =>
    id === "general" ? directory : path.join(root, id, "library");
  const requireSpace = (id) => {
    if (!ID.test(id || "") || !registry.spaces.some((space) => space.id === id))
      fail("Atlas space not found.", 404);
  };
  const snapshot = (currentId) => ({ ...structuredClone(registry), currentId });
  const register = (currentId) => (app) => {
    app.get("/api/spaces", (req, res) =>
      res.set("Cache-Control", "no-store").json(snapshot(currentId)),
    );
    app.post("/api/spaces", async (req, res) => {
      const name = nameOf(req.body?.name),
        id = randomUUID();
      if (
        req.body?.language != null &&
        !["en", "cs"].includes(req.body.language)
      )
        fail("Unsupported interface language. Choose English or Czech.");
      await change(async (next) => {
        if (
          next.spaces.some((s) => s.name.toLowerCase() === name.toLowerCase())
        )
          fail("An atlas space with this name already exists.", 409);
        const target = spaceDirectory(id);
        await initializeLibrary(target);
        const settings = new Settings(
          target,
          ingress,
          path.join(target, "documents"),
        );
        await settings.init();
        await settings.save(
          {
            ...(await settings.read()),
            language: req.body?.language || "en",
            languageSelectionCompleted: true,
          },
          [],
        );
        next.spaces.push({ id, name });
      });
      res.status(201).json({ ...snapshot(currentId), createdId: id });
    });
    app.patch("/api/spaces/:id", async (req, res) => {
      const { id } = req.params;
      requireSpace(id);
      const name =
        req.body?.name === undefined ? undefined : nameOf(req.body.name);
      if (req.body?.makeDefault !== undefined && req.body.makeDefault !== true)
        fail("Invalid default space preference.");
      await change(async (next) => {
        if (name !== undefined) {
          if (
            next.spaces.some(
              (s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase(),
            )
          )
            fail("An atlas space with this name already exists.", 409);
          next.spaces.find((s) => s.id === id).name = name;
        }
        if (req.body?.makeDefault === true) next.defaultId = id;
      });
      res.json(snapshot(currentId));
    });
  };
  const openSpace = async (id) => {
    requireSpace(id);
    if (!instances.has(id)) {
      const pending = (async () => {
        const target = spaceDirectory(id);
        await recoverRestore(target);
        await initializeLibrary(target);
        return createApp({
          ...options,
          directory: target,
          ingress,
          ...(id === "general"
            ? {}
            : { documentRoot: path.join(target, "documents") }),
          registerSpaceRoutes: register(id),
          sharedAssets: true,
        });
      })();
      instances.set(id, pending);
      pending.catch(() => instances.delete(id));
    }
    return instances.get(id);
  };
  const app = express();
  app.disable("x-powered-by");
  app.use(accessGuard(ingress));
  app.use(
    "/assets",
    compressedAssets(
      fileURLToPath(new URL("../dist/assets/", import.meta.url)),
    ),
  );
  app.use(
    "/assets",
    express.static(fileURLToPath(new URL("../dist/assets/", import.meta.url)), {
      maxAge: "1y",
      immutable: true,
    }),
  );
  app.get("/", (req, res) => {
    // Relative redirects preserve Home Assistant's Ingress prefix and query.
    res
      .set("Cache-Control", "no-store")
      .redirect(302, `./spaces/${registry.defaultId}/${req.url.slice(1)}`);
  });
  app.use("/spaces/:spaceId", async (req, res, next) => {
    requireSpace(req.params.spaceId);
    if (!req.originalUrl.split("?")[0].endsWith("/") && req.path === "/")
      return res.redirect(
        308,
        `./${req.params.spaceId}/${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`,
      );
    const { app: child } = await openSpace(req.params.spaceId);
    child(req, res, next);
  });
  // Existing API integrations remain pinned to the original library.
  app.use(async (req, res, next) =>
    (await openSpace("general")).app(req, res, next),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (!error.status) console.error(error.message);
    res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : "The atlas space could not be opened. See the server log for details.",
    });
  });
  return {
    app,
    openSpace,
    stop: async () => {
      for (const instance of instances.values())
        (await instance.catch(() => null))?.store.stopBackground();
    },
  };
}
