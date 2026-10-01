// Journal dates are local calendar dates, never inferred from file modification times.
const DAY = 86400000;
export function journalRange(tool) {
  return { start: tool.date, end: tool.endDate || tool.date };
}
export function periodEnd(start, period) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "")) return start;
  const date = new Date(start + "T12:00:00Z");
  if (Number.isNaN(date.getTime())) return start;
  if (period === "week") date.setUTCDate(date.getUTCDate() + 6);
  if (period === "month") date.setUTCMonth(date.getUTCMonth() + 1, 0);
  if (date.getUTCFullYear() > 9999) return start;
  return date.toISOString().slice(0, 10);
}
export function journalDays(tool) {
  const { start, end } = journalRange(tool);
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1;
}
export function journalEntries(nodes, { from = "", to = "" } = {}) {
  return nodes
    .filter((n) => {
      if (n.tool?.kind !== "journal") return false;
      const { start, end } = journalRange(n.tool);
      return (!from || end >= from) && (!to || start <= to);
    })
    .sort(
      (a, b) =>
        b.tool.date.localeCompare(a.tool.date) ||
        journalRange(b.tool).end.localeCompare(journalRange(a.tool).end) ||
        a.id.localeCompare(b.id),
    );
}
export function photoSuggestions(resources) {
  const dates = resources
    .map((r) => r.photo?.takenAt?.slice(0, 10))
    .filter(
      (date) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date || "") &&
        !Number.isNaN(Date.parse(date)) &&
        new Date(date).toISOString().slice(0, 10) === date,
    )
    .sort();
  const places = [];
  for (const r of resources) {
    const p = r.photo;
    if (
      Number.isFinite(p?.latitude) &&
      Number.isFinite(p?.longitude) &&
      Math.abs(p.latitude) <= 90 &&
      Math.abs(p.longitude) <= 180 &&
      !places.some(
        (x) =>
          Math.abs(x.latitude - p.latitude) < 0.00001 &&
          Math.abs(x.longitude - p.longitude) < 0.00001,
      )
    )
      places.push({
        id: r.id,
        label: r.label,
        latitude: p.latitude,
        longitude: p.longitude,
      });
  }
  return { start: dates[0], end: dates.at(-1), places: places.slice(0, 100) };
}
