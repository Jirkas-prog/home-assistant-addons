import { fail } from "./store.js";
import { validDate, cardState, nextReview, bomModel } from "../shared/tools.js";

function operationId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(value))
    fail("A stable operation ID is required.");
  return value;
}
function revision(node, value) {
  if (!node) fail("The record does not exist.", 404);
  if (node.revision !== value)
    fail("The tool changed. Reload its latest version before continuing.", 409);
}
export function registerTools(app, store, mutate) {
  app.get("/api/tools/:id/bom.csv", async (req, res) => {
    const { nodes } = await store.read(),
      node = nodes.find((n) => n.id === req.params.id);
    if (node?.tool?.kind !== "bom") fail("Invalid tool field: kind.", 404);
    const cell = (value) =>
      '"' +
      String(value)
        .replace(/^([\s]*[=+@\-\t\r])/, "'$1")
        .replaceAll('"', '""') +
      '"';
    const rows = [
      ["Material", "Missing units", "Specification"],
      ...bomModel(node, nodes)
        .filter((line) => line.shortage > 0)
        .map((line) => [line.label, line.shortage, line.note]),
    ];
    res
      .set(
        "Content-Disposition",
        `attachment; filename="${node.id}-shopping.csv"`,
      )
      .type("text/csv")
      .send("\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n"));
  });
  app.post("/api/tools/:id/runs", async (req, res) =>
    res.status(201).json(
      await mutate(async () => {
        const { nodes } = await store.read();
        const input = req.body,
          op = operationId(input.operationId),
          runId = "run-" + op;
        if (!validDate(input.date)) fail("Invalid tool field: date.");
        const existing = nodes.find((n) => n.id === runId);
        if (existing) {
          if (
            existing.tool?.kind !== "run" ||
            existing.tool.sourceId !== req.params.id ||
            existing.tool.date !== input.date
          )
            fail("This operation ID was already used for another action.", 409);
          return existing;
        }
        const source = nodes.find((n) => n.id === req.params.id);
        revision(source, input.revision);
        if (source.tool?.kind !== "procedure")
          fail("This record is not a procedure.");
        return store.save({
          schema: 2,
          id: runId,
          title: source.title + " · " + input.date,
          type: "knowledge",
          parent: source.parent,
          projectId: source.projectId || "",
          status: "active",
          summary: source.summary,
          color: source.color,
          tags: [...source.tags],
          related: [],
          resources: [],
          body: source.body,
          tool: {
            schema: 1,
            kind: "run",
            sourceId: source.id,
            sourceRevision: source.revision,
            date: input.date,
            steps: structuredClone(source.tool.steps),
            completed: [],
          },
        });
      }),
    ),
  );
  app.post("/api/tools/:id/steps", async (req, res) =>
    res.json(
      await mutate(async () => {
        const { nodes } = await store.read(),
          node = nodes.find((n) => n.id === req.params.id),
          input = req.body;
        revision(node, input.revision);
        if (
          node.tool?.kind !== "run" ||
          !node.tool.steps.some((s) => s.id === input.stepId) ||
          typeof input.completed !== "boolean"
        )
          fail("Invalid procedure step.");
        const completed = new Set(node.tool.completed);
        input.completed
          ? completed.add(input.stepId)
          : completed.delete(input.stepId);
        const tool = { ...node.tool, completed: [...completed] };
        return store.save(
          {
            ...node,
            tool,
            status: completed.size === tool.steps.length ? "done" : "active",
          },
          node.id,
          node.revision,
        );
      }),
    ),
  );
  app.post("/api/tools/:id/reviews", async (req, res) =>
    res.json(
      await mutate(async () => {
        const { nodes } = await store.read(),
          node = nodes.find((n) => n.id === req.params.id),
          input = req.body;
        if (!node || node.tool?.kind !== "cards")
          fail("This record is not a card deck.", 404);
        const op = operationId(input.operationId),
          existing = node.tool.reviews.find((r) => r.id === op);
        if (existing) {
          if (
            existing.cardId !== input.cardId ||
            existing.rating !== input.rating ||
            existing.date !== input.date
          )
            fail("This operation ID was already used for another action.", 409);
          return node;
        }
        revision(node, input.revision);
        if (
          !node.tool.cards.some((c) => c.id === input.cardId) ||
          !["again", "hard", "good", "easy"].includes(input.rating) ||
          !validDate(input.date)
        )
          fail("Invalid card review.");
        const previous = cardState(node, input.cardId, input.date);
        const review = {
          id: op,
          cardId: input.cardId,
          rating: input.rating,
          date: input.date,
          at: new Date().toISOString(),
          ...nextReview(previous.interval, input.rating, input.date),
        };
        return store.save(
          {
            ...node,
            tool: { ...node.tool, reviews: [...node.tool.reviews, review] },
          },
          node.id,
          node.revision,
        );
      }),
    ),
  );
}
