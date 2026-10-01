import { fail } from "../shared/schema.js";
import { validateStock } from "../shared/inventory.js";

export async function moveStock(store, id, input) {
  const node = (await store.read()).nodes.find((n) => n.id === id);
  if (!node || node.type !== "item" || !node.stock)
    fail("Set the item's storage distribution before recording a movement.");
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(input.operationId || ""))
    fail("A stock movement needs a stable operation ID.");
  const previous = node.stock.movements?.find(
    (m) => m.id === input.operationId,
  );
  const request = {
    kind: input.kind,
    from: input.from || "",
    to: input.to || "",
    quantity: input.quantity,
    borrower: input.borrower || "",
    loanId: input.loanId || "",
    note: input.note || "",
  };
  if (previous) {
    if (JSON.stringify(previous.request) !== JSON.stringify(request))
      fail("This operation ID was already used for a different movement.", 409);
    return node;
  }
  if (input.revision !== node.revision) fail("The record has changed.", 409);
  if (
    !["transfer", "loan", "return"].includes(request.kind) ||
    !Number.isSafeInteger(request.quantity) ||
    request.quantity < 1 ||
    typeof request.note !== "string" ||
    request.note.length > 2000
  )
    fail("Invalid stock movement.");
  const stock = structuredClone(node.stock);
  stock.loans ||= [];
  stock.movements ||= [];
  const from = stock.placements.find((p) => p.id === request.from),
    to = stock.placements.find((p) => p.id === request.to);
  const source = from
    ? { locationId: from.locationId, detail: from.detail }
    : null;
  const destination = to
    ? { locationId: to.locationId, detail: to.detail }
    : null;
  if (request.kind !== "return") {
    if (!from || from.quantity < request.quantity)
      fail("There are not enough units at the source placement.", 409);
    from.quantity -= request.quantity;
  }
  if (request.kind === "transfer") {
    if (!to || to.id === from.id)
      fail("Choose different source and destination placements.");
    to.quantity += request.quantity;
  } else if (request.kind === "loan") {
    if (
      typeof request.borrower !== "string" ||
      !request.borrower.trim() ||
      request.borrower.length > 120
    )
      fail("Enter a borrower name or description.");
    stock.loans.push({
      id: input.operationId,
      borrower: request.borrower,
      quantity: request.quantity,
      from: request.from,
      created: new Date().toISOString(),
    });
  } else {
    const loan = stock.loans.find((l) => l.id === request.loanId);
    if (!loan || loan.quantity < request.quantity || !to)
      fail("Choose an outstanding loan and an available return placement.");
    loan.quantity -= request.quantity;
    to.quantity += request.quantity;
  }
  stock.movements.push({
    id: input.operationId,
    at: new Date().toISOString(),
    request,
    source,
    destination,
  });
  validateStock(stock, fail);
  return store.save({ ...node, stock }, node.id, node.revision);
}
