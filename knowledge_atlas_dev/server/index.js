import { compressedAssets } from "./assets.js";
import { release } from "../shared/release.js";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { Backups, recoverRestore } from "./backups.js";
import { registerBackupTransfers } from "./backup-transfers.js";
import { PackageImports, recoverPackage } from "./packages.js";
import { Maintenance } from "./maintenance.js";
import { Store, fail, serialize, parseMarkdown } from "./store.js";
import { Settings, locationId, digest } from "./settings.js";
import { resolveResource, readText, writeText, safePath } from "./documents.js";
import { filterNodes, resourceLocation } from "../src/atlas-model.js";
import { itemQuantity, itemPlaces } from "../shared/inventory.js";
import { moveStock } from "./inventory.js";
import { registerTools } from "./tools.js";
import { photoMetadata } from "./photo-metadata.js";
import { readAsText, readOffice } from "./document-preview.js";
import { MapPositions, validateMapPositions } from "./map-positions.js";
import { validateOrder } from "./record-order.js";
import { UndoHistory } from "./undo.js";
import { validateNode, graphIssues } from "../shared/schema.js";
import { TaskData, validateTaskData } from "./task-data.js";
import { columnsFor, columnFor, validateBoard } from "../shared/boards.js";
import { projectIdFor } from "../shared/tools.js";
import { workspaceNode } from "../shared/workspace.js";
import { JOURNAL_PREVIEW_LIMIT } from "../shared/preview-limits.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compress = promisify(gzip);
export async function createApp({
  directory = process.env.DATA_DIR || path.join(root, "data"),
  ingress = process.env.HA_INGRESS === "1",
  allowOpen = process.platform === "win32" && !ingress,
} = {}) {
  await recoverRestore(directory);
  await recoverPackage(directory);
  const store = new Store(directory, { persistentIndex: true });
  await store.init();
  const settings = new Settings(directory, ingress);
  const mapPositions = new MapPositions(directory);
  await settings.init();
  const backups = new Backups(directory, settings);
  const maintenance = new Maintenance(store, settings, backups);
  const taskData = new TaskData(directory);
  const undo = new UndoHistory(directory, {
    audit: (changes, event) => taskData.audit(changes, event),
    document: (target) =>
      documentFor({ params: { id: target.id, index: target.resourceId } }),
    validate: async (changes) => {
      const snapshot = await new Store(directory).read();
      let nodes = [...snapshot.nodes],
        config = await settings.read();
      for (const change of changes) {
        const target = change.target;
        if (target.kind === "comments" && change.after !== null)
          validateTaskData(
            `comments/${target.id}.json`,
            JSON.parse(change.after),
          );
        if (
          target.kind === "metadata" &&
          target.name === "settings.json" &&
          change.after === null
        )
          fail("The undo history contains invalid settings.", 409);
        if (target.kind === "record") {
          nodes = nodes.filter((node) => node.id !== target.id);
          if (change.after !== null) {
            const node = validateNode(parseMarkdown(change.after));
            if (node.id !== target.id)
              fail("The undo history contains an invalid record.", 409);
            nodes.push(node);
          }
        } else if (target.kind === "metadata" && change.after !== null) {
          const value = JSON.parse(change.after);
          if (target.name === "settings.json")
            config = settings.validate(value);
          if (target.name === "map-positions.json") validateMapPositions(value);
          if (target.name === "list-order.json") validateOrder(value);
        }
      }
      const previous = new Set(
        graphIssues(snapshot.nodes).map((issue) => issue.key),
      );
      if (graphIssues(nodes).some((issue) => !previous.has(issue.key)))
        fail(
          "This undo step would break record links. Resolve the newer references first.",
          409,
        );
      for (const node of nodes) {
        for (const resource of node.resources || [])
          if (
            !config.locations.some(
              (location) => location.id === locationId(resource),
            )
          )
            fail(
              "This undo step would remove a location that is still in use.",
              409,
            );
        for (const placement of node.stock?.placements || [])
          if (
            !config.locations.some(
              (location) =>
                location.id === placement.locationId &&
                location.kind === "physical",
            )
          )
            fail(
              "This undo step would remove a location that is still in use.",
              409,
            );
      }
    },
  });
  // Recovery conflicts block writes through the mutation queue, while the
  // existing library remains readable and the interface explains the conflict.
  await undo.recover().catch(() => {});
  const observe = (object, method, before) => {
    const original = object[method].bind(object);
    object[method] = async (...args) => {
      if (undo.context.getStore()) await before(args);
      const result = await original(...args);
      await undo.confirmWrites();
      return result;
    };
  };
  observe(store, "save", async (args) => {
    const [input, existingId] = args;
    if (!input || typeof input !== "object") return;
    await store.read();
    const id = existingId || input.id || randomUUID();
    if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(id)) return;
    if (!existingId) args[0] = { ...input, id };
    const label = {
      kind: existingId ? "record" : "create",
      title: input.title,
      recordId: id,
    };
    await undo.watch({ kind: "record", id }, label);
    if (!existingId)
      await undo.watch({ kind: "metadata", name: "list-order.json" }, label);
  });
  observe(store, "archive", async ([id]) => {
    await store.read();
    await undo.watch(
      { kind: "record", id },
      {
        kind: "archive",
        title: store.snapshot?.nodes.find((n) => n.id === id)?.title,
      },
    );
    await undo.watch(
      { kind: "metadata", name: "list-order.json" },
      { kind: "archive" },
    );
  });
  observe(store, "move", async ([id]) =>
    undo.watch(
      { kind: "metadata", name: "list-order.json" },
      {
        kind: "order",
        recordId: id,
        title: store.snapshot?.nodes.find((n) => n.id === id)?.title,
      },
    ),
  );
  observe(settings, "save", async () => {
    if ((await settings.read()).languageSelectionCompleted !== false)
      await undo.watch(
        { kind: "metadata", name: "settings.json" },
        { kind: "settings" },
      );
  });
  observe(mapPositions, "save", async () =>
    undo.watch(
      { kind: "metadata", name: "map-positions.json" },
      { kind: "map" },
    ),
  );
  let packageImports;
  const checkPackageRecovery = () => {
    if (packageImports?.recoveryRequired)
      fail(
        "Package recovery found an externally changed file. Keep the operations directory for manual recovery.",
        503,
      );
  };
  let queue = Promise.resolve();
  let mutationActive = false;
  const mutate = (fn, { history = true } = {}) => {
    const result = queue.then(async () => {
      checkPackageRecovery();
      mutationActive = true;
      const resumeIndex = store.background;
      store.stopBackground();
      try {
        await store.reading?.catch(() => {});
        await taskData.observing;
        return await (history
          ? undo.record(async () => {
              const result = await fn();
              // Commit automatic order reconciliation as part of the same user step.
              await store.read();
              return result;
            })
          : fn());
      } finally {
        mutationActive = false;
        if (resumeIndex) store.startBackground();
      }
    });
    queue = result.catch(() => {});
    return result;
  };
  const checkLocations = async (node) => {
    const config = await settings.read();
    for (const r of node.resources || [])
      if (!config.locations.some((l) => l.id === locationId(r)))
        fail(
          "The selected location does not exist. Refresh the location list.",
        );
    for (const p of node.stock?.placements || [])
      if (
        !config.locations.some(
          (l) => l.id === p.locationId && l.kind === "physical",
        )
      )
        fail("Inventory placements require an existing physical place.");
    return node;
  };
  const { version } = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const ip = req.socket.remoteAddress?.replace(/^::ffff:/, "");
    if (ingress && ip !== "172.30.32.2")
      return res.status(403).json({
        error: "Access is only allowed through Home Assistant Ingress.",
      });
    if (!ingress && !["127.0.0.1", "localhost", "[::1]"].includes(req.hostname))
      return res.status(403).json({
        error: "Host is not allowed.",
      });
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.get("X-Knowledge-Client") !== "atlas"
    )
      return res.status(403).json({
        error: "The protection header is missing.",
      });
    if (
      !ingress &&
      req.get("Origin") &&
      ![
        "http://127.0.0.1:8099",
        "http://localhost:8099",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        `http://${req.get("host")}`,
      ].includes(req.get("Origin"))
    )
      return res.status(403).json({
        error: "Request origin is not allowed.",
      });
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use("/api/map-positions", express.json({ limit: "16mb" }));
  app.use(
    express.json({
      limit: "2mb",
    }),
  );
  app.use(async (req, res, next) => {
    if (
      !/^\/api\/packages\/[^/]+\/status$/.test(req.path) &&
      !["/api/atlas", "/api/workspace"].includes(req.path)
    ) {
      if (req.method === "GET") await packageImports?.wait();
      checkPackageRecovery();
    }
    next();
  });
  app.get("/api/health", (req, res) =>
    res.json({
      ok: true,
      app: "knowledge-atlas",
    }),
  );
  registerTools(app, store, mutate);
  const transfers = await registerBackupTransfers(app, backups, (fn) =>
    mutate(fn, { history: false }),
  );
  packageImports = new PackageImports(
    backups,
    (fn) =>
      mutate(
        async () => {
          const result = await fn();
          await undo.clear();
          return result;
        },
        { history: false },
      ),
    transfers,
  );
  app.post("/api/packages/:id/import", async (req, res) =>
    res.status(202).json(await packageImports.start(req.params.id, req.body)),
  );
  app.get("/api/packages/:id/status", async (req, res) =>
    res
      .set("Cache-Control", "no-store")
      .json(await packageImports.status(req.params.id)),
  );
  const atlasResponses = new Map();
  const backgroundServers = new WeakSet();
  app.get(["/api/nodes", "/api/atlas", "/api/workspace"], async (req, res) => {
    const content =
      req.path === "/api/workspace"
        ? ["records", "journal", "overview", "tools"].includes(req.query.content)
          ? req.query.content
          : "tasks"
        : "map";
    const indexed = req.path !== "/api/nodes";
    const responseProfile = indexed ? content : "legacy";
    if (indexed) {
      const server = req.socket.server;
      if (server && !backgroundServers.has(server)) {
        backgroundServers.add(server);
        server.once("close", () => store.stopBackground());
      }
      if (!mutationActive) store.startBackground();
      if (req.query.refresh === "1" && !mutationActive) await store.read();
      const progress = {
        ...store.progress,
        ageMs: store.progress.finishedAt
          ? Date.now() - store.progress.finishedAt
          : 0,
        elapsedMs: store.progress.startedAt
          ? (store.progress.finishedAt || Date.now()) - store.progress.startedAt
          : 0,
      };
      res.set("X-Atlas-Index", JSON.stringify(progress));
      if (!store.snapshot)
        return res
          .status(store.progress.phase === "error" ? 503 : 202)
          .set("Cache-Control", "no-store")
          .json({ index: store.progress });
    }
    const snapshot = indexed
      ? { ...store.snapshot, errors: [...store.snapshot.errors] }
      : await store.read();
    if (!mutationActive) await taskData.observe(snapshot.nodes);
    let config;
    try {
      config = await settings.read();
    } catch (error) {
      snapshot.errors.push({ file: "settings.json", message: error.message });
      config = {
        ...settings.defaults,
        invalid: true,
        revision: digest(await fs.readFile(settings.file)),
      };
    }
    let savedMap;
    if (content === "map")
      try {
        savedMap = await mapPositions.read();
      } catch (error) {
        snapshot.errors.push({
          file: "map-positions.json",
          message: error.message,
        });
        savedMap = {
          views: {},
          revision: digest(error.message),
          invalid: true,
        };
      }
    let undoState;
    try {
      undoState = await undo.status();
    } catch (error) {
      undoState = { undo: 0, redo: 0, error: error.message };
    }
    const etag = `W/"${responseProfile}-${version}-${snapshot.revision}-${config.revision}-${savedMap?.revision || ""}-${undoState.revision || "invalid"}"`;
    res
      .set("Cache-Control", "private, no-cache")
      .set("ETag", etag)
      .vary("Accept-Encoding");
    if (req.get("If-None-Match") === etag) return res.status(304).end();
    if (atlasResponses.get(responseProfile)?.etag !== etag) {
      for (const n of snapshot.nodes)
        for (const r of [...n.resources, ...(n.stock?.placements || [])])
          if (!config.locations.some((l) => l.id === locationId(r)))
            snapshot.errors.push({
              file: n.file,
              message: `Missing location: ${locationId(r)}`,
            });
      for (const n of snapshot.nodes)
        for (const p of n.stock?.placements || [])
          if (
            config.locations.find((l) => l.id === p.locationId)?.kind !==
            "physical"
          )
            snapshot.errors.push({
              file: n.file,
              message:
                "Inventory placements require an existing physical place.",
            });
      const body = JSON.stringify({
        ...snapshot,
        // Navigation needs identities and titles, but no knowledge bodies,
        // attachments, cross-links or map coordinates on the task landing page.
        nodes: snapshot.nodes.map((node) =>
          workspaceNode(node, indexed ? content : "records"),
        ),
        content,
        settings: config,
        ...(savedMap ? { mapPositions: savedMap } : {}),
        undo: undoState,
        environment: {
          ingress,
          canOpenFolders: allowOpen,
          dataDirectory: directory,
          name: release.name,
          channel: release.channel,
          version,
        },
      });
      const response = { etag, body, compressed: compress(body) };
      // Attach a handler immediately; concurrent requests can share this encoding.
      response.compressed.catch(() => {});
      atlasResponses.set(responseProfile, response);
    }
    const response = atlasResponses.get(responseProfile);
    res.type("json");
    if (req.acceptsEncodings("gzip"))
      res.set("Content-Encoding", "gzip").send(await response.compressed);
    else res.send(response.body);
  });
  app.get("/api/settings", async (req, res) => res.json(await settings.read()));
  app.get("/api/undo", async (req, res) =>
    res.set("Cache-Control", "no-store").json(await undo.status()),
  );
  app.post("/api/undo/:direction", async (req, res) => {
    const state = await mutate(
      async () => {
        const result = await undo.travel(
          req.params.direction,
          req.body.revision,
        );
        await store.read();
        return result;
      },
      { history: false },
    );
    res.json(state);
  });
  app.get("/api/map-positions", async (req, res) =>
    res.set("Cache-Control", "no-store").json(await mapPositions.read()),
  );
  app.put("/api/map-positions/:slot", async (req, res) =>
    res.json(
      await mutate(() =>
        mapPositions.save(
          req.params.slot,
          req.body.positions,
          req.body.revision,
        ),
      ),
    ),
  );
  app.post("/api/settings/language", async (req, res) =>
    res.json(
      await mutate(async () => {
        if (!["en", "cs"].includes(req.body.language))
          fail("Unsupported interface language. Choose English or Czech.");
        const current = await settings.read();
        // Only language and setup state change; unrelated settings stay current.
        // Invalid records cannot prevent choosing a language to repair them in.
        return settings.save(
          {
            ...current,
            revision: req.body.revision,
            language: req.body.language,
            languageSelectionCompleted: true,
          },
          [],
        );
      }),
    ),
  );
  app.post("/api/locations/:id/replace", async (req, res) =>
    res.json(
      await mutate(() =>
        maintenance.replaceLocation(
          req.params.id,
          req.body.target,
          req.body.revision,
        ),
      ),
    ),
  );
  app.put("/api/settings", async (req, res) =>
    res.json(
      await mutate(async () => {
        const snapshot = await store.read();
        if (snapshot.errors.length)
          fail("Repair the invalid Markdown files first.", 409);
        return settings.save(req.body, snapshot.nodes);
      }),
    ),
  );
  app.post("/api/nodes", async (req, res) =>
    res
      .status(201)
      .json(
        await mutate(async () => store.save(await checkLocations(req.body))),
      ),
  );
  app.put("/api/nodes/:id", async (req, res) =>
    res.json(
      await mutate(async () =>
        store.save(
          await checkLocations(req.body),
          req.params.id,
          req.body.revision,
        ),
      ),
    ),
  );
  app.delete("/api/nodes/:id", async (req, res) => {
    await mutate(() => store.archive(req.params.id, req.body.revision));
    res.json({
      ok: true,
    });
  });
  app.put("/api/nodes/:id/position", async (req, res) => {
    const snapshot = await mutate(() =>
      store.move(
        req.params.id,
        req.body.position,
        req.body.revision,
        req.body.positionFixed,
      ),
    );
    res.json({
      position: snapshot.nodes.find((node) => node.id === req.params.id)
        .position,
      positionFixed: snapshot.nodes.find((node) => node.id === req.params.id)
        .positionFixed,
      orderRevision: snapshot.orderRevision,
    });
  });
  app.post("/api/import", async (req, res) => {
    if (typeof req.body.markdown !== "string") fail("Choose a Markdown file.");
    const node = parseMarkdown(req.body.markdown);
    res
      .status(201)
      .json(await mutate(async () => store.save(await checkLocations(node))));
  });
  app.post("/api/nodes/:id/movements", async (req, res) =>
    res.json(await mutate(() => moveStock(store, req.params.id, req.body))),
  );
  async function getNode(id) {
    const n = await store.readNode(id);
    if (!n) fail("The record does not exist.", 404);
    return n;
  }
  app.get("/api/nodes/:id", async (req, res) =>
    res.json(await getNode(req.params.id)),
  );
  app.get(["/api/journal/search", "/api/search"], async (req, res) => {
    const query = String(req.query.q || "").slice(0, 2000);
    const snapshot = store.snapshot || (await store.read());
    const config = await settings.read();
    const matches = filterNodes(
      req.path === "/api/journal/search"
        ? snapshot.nodes.filter((n) => n.tool?.kind === "journal")
        : snapshot.nodes,
      {
        query,
        locations: config.locations,
      },
    );
    res.set("Cache-Control", "no-store").json({
      revision: snapshot.revision,
      ids: matches.map((n) => n.id),
    });
  });
  app.get("/api/tasks/:id/comments", async (req, res) => {
    await getNode(req.params.id);
    const data = await taskData.comments(req.params.id);
    const page = Math.max(0, Math.floor(Number(req.query.page) || 0));
    const entries = data.entries.toReversed();
    res.set("Cache-Control", "no-store").json({
      revision: data.revision,
      entries: entries.slice(page * 50, (page + 1) * 50),
      total: entries.length,
      next: entries.length > (page + 1) * 50 ? page + 1 : null,
    });
  });
  app.post("/api/tasks/:id/comments", async (req, res) => {
    await mutate(async () => {
      const node = await getNode(req.params.id);
      if (node.type !== "task") fail("Comments belong to tasks.");
      await undo.watch(
        { kind: "comments", id: node.id },
        { kind: "record", title: node.title },
      );
      await taskData.comment(node.id, req.body);
      await undo.confirmWrites();
    });
    res.json({ ok: true });
  });
  app.get("/api/tasks/:id/activity", async (req, res) => {
    await getNode(req.params.id);
    res
      .set("Cache-Control", "no-store")
      .json(
        await taskData.activity(req.params.id, String(req.query.before || "")),
      );
  });
  app.get("/api/task-counts", async (req, res) => {
    const tasks = (await store.read()).nodes.filter((n) => n.type === "task");
    const counts = {};
    for (const n of tasks)
      counts[n.id] = (await taskData.comments(n.id)).entries.filter(
        (c) => !c.deleted,
      ).length;
    res.set("Cache-Control", "no-store").json(counts);
  });
  app.put("/api/tasks/:id/move", async (req, res) => {
    const node = await mutate(async () => {
      const n = await getNode(req.params.id);
      if (n.type !== "task") fail("Choose a task.");
      const snapshot = await store.read();
      const owner = projectIdFor(n, snapshot.nodes);
      const project = owner ? await getNode(owner) : null;
      const columns = req.body.aggregate
        ? columnsFor(null)
        : columnsFor(project);
      const column = columns.find((c) => c.id === req.body.columnId);
      if (!column) fail("The selected column does not exist.", 409);
      if (
        column.status === "done" &&
        n.status !== "done" &&
        n.task?.checkpoints?.some((c) => !c.done) &&
        !req.body.confirmIncomplete
      )
        fail(
          "This task still has incomplete checkpoints. Confirm completion explicitly.",
          409,
        );
      let before, targetPosition;
      if (req.body.beforeId) {
        before = snapshot.nodes.find(
          (x) => x.id === req.body.beforeId && x.type === "task",
        );
        if (!before) fail("The destination task no longer exists.", 409);
        if (snapshot.orderRevision !== req.body.orderRevision)
          fail("The list order has changed. Refresh and try again.", 409);
        if (n.positionFixed)
          fail("Unfix this task before changing its list position.", 409);
        targetPosition =
          before.position - (n.position < before.position ? 1 : 0);
        const reserved = new Set(
          snapshot.nodes.filter((x) => x.positionFixed).map((x) => x.position),
        );
        while (reserved.has(targetPosition)) targetPosition--;
        if (targetPosition < 1)
          fail("Choose an insertion position that is not fixed.", 409);
      }
      const actualColumn =
        req.body.aggregate && project?.board
          ? columnsFor(project).find(
              (c) => c.id === column.id && c.status === column.status,
            ) || columnsFor(project).find((c) => c.status === column.status)
          : column;
      const saved = await store.save(
        {
          ...n,
          revision: req.body.revision,
          status: column.status,
          task: { ...n.task, columnId: actualColumn.id },
        },
        n.id,
        req.body.revision,
      );
      if (before)
        await store.move(n.id, targetPosition, req.body.orderRevision);
      return saved;
    });
    res.json(node);
  });
  app.put("/api/projects/:id/board", async (req, res) => {
    res.json(
      await mutate(async () => {
        const n = await getNode(req.params.id);
        if (n.type !== "project") fail("Choose a project board.");
        validateBoard(req.body.board, fail);
        const nodes = (await store.read()).nodes;
        const columns = req.body.board.columns;
        const affected = nodes.filter(
          (x) =>
            x.type === "task" &&
            projectIdFor(x, nodes) === n.id &&
            !columns.some(
              (c) =>
                c.id === columnFor(x, columnsFor(n))?.id &&
                c.status === x.status,
            ),
        );
        for (const task of affected) {
          const destination = columns.find(
            (c) =>
              c.id ===
              req.body.destinations?.[columnFor(task, columnsFor(n))?.id],
          );
          if (!destination)
            fail(
              "Choose a destination for tasks in removed or changed columns.",
            );
        }
        const saved = await store.save(
          { ...n, board: req.body.board, revision: req.body.revision },
          n.id,
          req.body.revision,
        );
        for (const task of affected) {
          const destination = columns.find(
            (c) =>
              c.id ===
              req.body.destinations[columnFor(task, columnsFor(n))?.id],
          );
          await store.save(
            {
              ...task,
              status: destination.status,
              task: { ...task.task, columnId: destination.id },
            },
            task.id,
            task.revision,
          );
        }
        return saved;
      }),
    );
  });
  app.get("/api/nodes/:id/markdown", async (req, res) => {
    const n = await getNode(req.params.id);
    res
      .set("Content-Disposition", `attachment; filename="${n.id}.md"`)
      .type("text/markdown")
      .send(serialize(n));
  });
  app.get("/api/export", async (req, res) => {
    res
      .set(
        "Content-Disposition",
        `attachment; filename="knowledge-atlas-backup-${new Date().toISOString().replaceAll(":", "-")}.zip"`,
      )
      .type("application/zip");
    await mutate(
      () => backups.export(res, { history: req.query.history !== "0" }),
      { history: false },
    );
  });
  app.get("/api/backups/summary", async (req, res) =>
    res.json(await backups.summary()),
  );
  app.post("/api/backups/preview", async (req, res) => {
    if (!req.is("application/zip"))
      fail("Choose a Knowledge Atlas ZIP backup.");
    res
      .status(201)
      .json(await mutate(() => backups.prepare(req), { history: false }));
  });
  app.post("/api/backups/:id/restore", async (req, res) => {
    res.json(
      await mutate(() => backups.restore(req.params.id, req.body.revision), {
        history: false,
      }),
    );
  });
  app.delete("/api/backups/:id", async (req, res) =>
    res.json(
      await mutate(() => backups.discard(req.params.id), { history: false }),
    ),
  );
  app.get("/api/maintenance", async (req, res) =>
    res.json({ version, ...(await maintenance.diagnostics()) }),
  );
  app.get("/api/migrations", async (req, res) =>
    res.json(await maintenance.migrationPreview()),
  );
  app.post("/api/migrations", async (req, res) =>
    res.json(await mutate(() => maintenance.migrate(req.body.revision))),
  );
  app.get("/api/repair/:file", async (req, res) =>
    res.json(await maintenance.raw(req.params.file)),
  );
  app.put("/api/repair/:file", async (req, res) =>
    res.json(
      await mutate(() =>
        maintenance.repair(req.params.file, req.body.body, req.body.revision),
      ),
    ),
  );
  app.get("/api/inventory.csv", async (req, res) => {
    const { nodes } = await store.read(),
      config = await settings.read();
    const text = (value) => (typeof value === "string" ? value : "");
    const items = filterNodes(nodes, {
      type: "item",
      query: text(req.query.query),
      scope: text(req.query.scope),
      location: text(req.query.location),
      importance: text(req.query.importance)
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5),
      locations: config.locations,
    });
    const cell = (value) => {
      let v = String(value);
      if (/^\s*[=+@\-\t\r]/.test(v)) v = "'" + v;
      return '"' + v.replaceAll('"', '""') + '"';
    };
    const rows = [
      ["Item", "Quantity", "Location", "Description"],
      ...items.map((n) => [
        n.title,
        itemQuantity(n, text(req.query.location), config.locations),
        itemPlaces(n, config.locations, text(req.query.location)),
        n.summary,
      ]),
    ];
    res
      .set("Content-Disposition", 'attachment; filename="inventory.csv"')
      .type("text/csv")
      .send("\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n"));
  });
  app.get("/api/nodes/:id/resources/:index", async (req, res) => {
    const resolved = await documentFor(req);
    const { file, ...metadata } = resolved;
    res.set("Cache-Control", "no-store").json({
      ...metadata,
      ...(req.query.metadata === "1"
        ? {}
        : resolved.kind === "text" && resolved.file
          ? await readText(resolved)
          : resolved.kind === "office" && resolved.file
            ? await readOffice(resolved)
            : {}),
    });
  });
  app.get("/api/nodes/:id/resources/:index/as-text", async (req, res) => {
    const resolved = await documentFor(req);
    res.set("Cache-Control", "no-store").json(await readAsText(resolved));
  });
  async function documentFor(req) {
    const n = await getNode(req.params.id);
    const r = /^\d+$/.test(req.params.index)
      ? n.resources[Number(req.params.index)]
      : n.resources.find((r) => r.id === req.params.index);
    if (!r) fail("The attachment does not exist.", 404);
    const config = await settings.read();
    const resolved = await resolveResource(r, config, ingress);
    const stat = resolved.file ? await fs.stat(resolved.file) : null;
    return {
      ...resolved,
      resourceId: r.id,
      targetRevision: digest(
        JSON.stringify([
          n.id,
          r.id,
          config.revision,
          resolved.file || resolved.url,
          stat?.dev,
          stat?.ino,
        ]),
      ),
    };
  }
  app.get("/api/nodes/:id/resources/:index/file", async (req, res) => {
    const doc = await documentFor(req);
    if (!doc.file || ["folder", "place"].includes(doc.kind))
      fail("This link is not an accessible file.", 404);
    if (req.query.preview === "1" && doc.size > JOURNAL_PREVIEW_LIMIT)
      fail("Automatic previews support files up to 10 MB.", 413);
    res.set("Cache-Control", "private, no-cache");
    if (doc.mime && req.query.download !== "1")
      res
        .set("X-Content-Type-Options", "nosniff")
        .type(doc.mime)
        // The validated storage root may be the internal .restored-documents folder.
        .sendFile(doc.file, { dotfiles: "allow" });
    else res.download(doc.file, { dotfiles: "allow" });
  });
  app.put("/api/nodes/:id/resources/:index/text", async (req, res) =>
    res.json(
      await mutate(async () => {
        const resolved = await documentFor(req);
        if (!resolved.editable)
          fail("This location does not allow file editing.", 403);
        if (resolved.targetRevision !== req.body.targetRevision)
          fail(
            "The attachment target changed. Reopen it before saving; your draft is preserved.",
            409,
          );
        await undo.watch(
          {
            kind: "document",
            id: req.params.id,
            resourceId: resolved.resourceId,
          },
          { kind: "document", title: resolved.title },
          resolved.file,
        );
        const result = await writeText(
          resolved,
          req.body.body,
          req.body.revision,
        );
        return {
          ...result,
          targetRevision: (await documentFor(req)).targetRevision,
        };
      }),
    ),
  );
  app.post(
    "/api/documents",
    express.raw({
      type: "application/octet-stream",
      limit: "50mb",
    }),
    async (req, res) => {
      const result = await mutate(async () => {
        const config = await settings.read(),
          location = config.locations.find((l) => l.kind === "addon");
        if (!location?.writable)
          fail("The Add-on location must allow writes.", 403);
        if (!Buffer.isBuffer(req.body)) fail("File content is missing.");
        const file = await safePath(config.documentRoot, req.query.path, {
          create: true,
        });
        try {
          await fs.writeFile(file, req.body, {
            flag: "wx",
          });
        } catch (e) {
          if (e.code === "EEXIST")
            fail("The file already exists. Choose a different name.", 409);
          throw e;
        }
        return {
          id: randomUUID(),
          label: path.basename(file),
          locationId: location.id,
          path: path.relative(config.documentRoot, file).replaceAll("\\", "/"),
          ...(/\.(jpe?g|png|webp|heic|tiff?)$/i.test(file)
            ? { photo: await photoMetadata(req.body) }
            : {}),
        };
      });
      res.status(201).json(result);
    },
  );
  app.post("/api/nodes/:id/resources/:index/open", async (req, res) => {
    if (!allowOpen)
      fail("Opening folders is only available on a local Windows server.", 400);
    const n = await getNode(req.params.id),
      r = /^\d+$/.test(req.params.index)
        ? n.resources[Number(req.params.index)]
        : n.resources.find((r) => r.id === req.params.index);
    const config = await settings.read();
    if (
      config.locations.find((l) => l.id === locationId(r || {}))?.kind !==
        "device" ||
      locationId(r || {}) !== "pc"
    )
      fail("File Explorer only opens the PC location.");
    if (!r?.path || !path.isAbsolute(r.path) || r.path.includes("\0"))
      fail("Invalid path.");
    const folder = await fs.realpath(r.path).catch(() => null);
    if (!folder || !(await fs.stat(folder)).isDirectory())
      fail("The folder is not available on this device.", 404);
    await new Promise((resolve, reject) => {
      const child = spawn("explorer.exe", [folder], {
        shell: false,
        windowsHide: true,
        detached: true,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
    res.json({
      ok: true,
    });
  });
  app.use("/api", (req, res) =>
    res.status(404).json({
      error: "Unknown operation.",
    }),
  );
  app.use("/assets", compressedAssets(path.join(root, "dist", "assets")));
  app.use(
    express.static(path.join(root, "dist"), {
      index: false,
    }),
  );
  app.get("/", (req, res) =>
    res.sendFile(path.join(root, "dist", "index.html")),
  );
  app.use((err, req, res, next) => {
    console.error(err.message);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({
      error: err.status
        ? err.message
        : "The operation could not be completed. See the server log for details.",
    });
  });
  return {
    app,
    store,
    settings,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { app, store } = await createApp();
  const port = Number(process.env.PORT || 8099),
    host = process.env.HOST || "127.0.0.1";
  const server = app.listen(port, host, () =>
    console.log(`Knowledge Atlas: http://${host}:${port}`),
  );
  store.startBackground();
  server.once("close", () => store.stopBackground());
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
