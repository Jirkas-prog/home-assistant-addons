import { locationDescendants, locationLabel } from "./locations.js";

export function itemQuantity(node, location = "", locations = []) {
  if (!node.stock) return node.quantity || 1;
  const allowed = location ? locationDescendants(locations, location) : null;
  return node.stock.placements.reduce(
    (sum, p) => sum + (!allowed || allowed.has(p.locationId) ? p.quantity : 0),
    0,
  );
}
export function itemPlaces(node, locations, location = "") {
  const allowed = location ? locationDescendants(locations, location) : null;
  if (!node.stock)
    return node.resources
      .filter((r) => !allowed || allowed.has(r.locationId))
      .map(
        (r) =>
          `${locationLabel(locations, r.locationId || "pc")} · ${r.path || r.url}`,
      )
      .join(" | ");
  return node.stock.placements
    .filter((p) => p.quantity > 0 && (!allowed || allowed.has(p.locationId)))
    .map(
      (p) =>
        `${locationLabel(locations, p.locationId)} · ${p.detail || ""} (${p.quantity})`,
    )
    .join(" | ");
}
export function validateStock(stock, fail) {
  const id = /^[a-z0-9][a-z0-9_-]{0,119}$/;
  if (
    !stock ||
    !["stock", "unique"].includes(stock.mode) ||
    !Array.isArray(stock.placements) ||
    stock.placements.length > 1000
  )
    fail("Invalid inventory placements.");
  const ids = new Set();
  let total = 0;
  for (const p of stock.placements) {
    if (
      !p ||
      !id.test(p.id || "") ||
      ids.has(p.id) ||
      !id.test(p.locationId || "") ||
      typeof p.detail !== "string" ||
      p.detail.length > 1000 ||
      !Number.isSafeInteger(p.quantity) ||
      p.quantity < 0 ||
      p.quantity > 1_000_000_000
    )
      fail(
        "Placements need unique IDs, a location, description and nonnegative integer quantity.",
      );
    ids.add(p.id);
    total += p.quantity;
  }
  if (!Number.isSafeInteger(total) || total > 1_000_000_000)
    fail("The total inventory quantity is too large.");
  if (stock.mode === "unique" && total > 1)
    fail("A unique item can have at most one available unit.");
  const loanIds = new Set();
  if (stock.loans != null && !Array.isArray(stock.loans))
    fail("Invalid loan history.");
  for (const loan of stock.loans || []) {
    if (
      !id.test(loan?.id || "") ||
      loanIds.has(loan.id) ||
      typeof loan.borrower !== "string" ||
      loan.borrower.length > 120 ||
      !Number.isSafeInteger(loan.quantity) ||
      loan.quantity < 0 ||
      loan.quantity > 1_000_000_000
    )
      fail("Invalid loan history.");
    loanIds.add(loan.id);
    total += loan.quantity;
  }
  if (
    !Number.isSafeInteger(total) ||
    total > 1_000_000_000 ||
    (stock.mode === "unique" && total > 1)
  )
    fail("Available and loaned quantities exceed the inventory limit.");
  if (
    stock.movements != null &&
    (!Array.isArray(stock.movements) ||
      stock.movements.some(
        (m) =>
          !id.test(m?.id || "") ||
          typeof m.at !== "string" ||
          !m.request ||
          !["transfer", "loan", "return"].includes(m.request.kind),
      ))
  )
    fail("Invalid movement history.");
}
