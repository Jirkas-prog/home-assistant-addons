import { journalRange } from "./journal.js";
const DAY = 86400000;
const date = (value) => new Date(value + "T12:00:00Z");
const iso = (value) => value.toISOString().slice(0, 10);
export const dayOffset = (value, count) =>
  iso(new Date(date(value).getTime() + count * DAY));
export const dayDistance = (from, to) =>
  Math.round((date(to) - date(from)) / DAY);
export const weekStart = (value) =>
  dayOffset(value, -((date(value).getUTCDay() + 6) % 7));
export function calendarRange(value, mode) {
  if (mode === "day") return { start: value, end: value };
  if (mode === "week") {
    const start = weekStart(value);
    return { start, end: dayOffset(start, 6) };
  }
  const first = value.slice(0, 7) + "-01";
  const last = date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const start = weekStart(first),
    end = dayOffset(weekStart(iso(last)), 6);
  return { start, end };
}
export function calendarMove(value, mode, direction) {
  if (mode === "day" || mode === "week")
    return dayOffset(value, direction * (mode === "week" ? 7 : 1));
  const next = date(value),
    day = next.getUTCDate();
  next.setUTCDate(1);
  if (mode === "year") next.setUTCFullYear(next.getUTCFullYear() + direction);
  else next.setUTCMonth(next.getUTCMonth() + direction);
  const last = new Date(next);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  next.setUTCDate(Math.min(day, last.getUTCDate()));
  return iso(next);
}
export const timedEntry = (entry) =>
  !!(entry.tool.startTime && entry.tool.endTime);
export function calendarEntryRange(entry) {
  const range = journalRange(entry.tool);
  // A timed event ending at midnight does not occupy the following date.
  return timedEntry(entry) &&
    entry.tool.endTime === "00:00" &&
    range.end > range.start
    ? { ...range, end: dayOffset(range.end, -1) }
    : range;
}
export function calendarSegments(entries, start, end) {
  const segments = entries
    .map((entry) => {
      const range = calendarEntryRange(entry);
      return {
        entry,
        start: range.start < start ? start : range.start,
        end: range.end > end ? end : range.end,
        before: range.start < start,
        after: range.end > end,
      };
    })
    .filter((s) => s.start <= s.end && s.start <= end && s.end >= start)
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        b.end.localeCompare(a.end) ||
        a.entry.id.localeCompare(b.entry.id),
    );
  const lanes = [];
  for (const segment of segments) {
    let lane = lanes.findIndex((end) => end < segment.start);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = segment.end;
    segment.lane = lane;
    segment.column = dayDistance(start, segment.start);
    segment.span = dayDistance(segment.start, segment.end) + 1;
  }
  return segments;
}
const minutes = (value) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function timedSegments(entries, day) {
  const segments = entries
    .filter(timedEntry)
    .map((entry) => ({
      entry,
      start: entry.tool.date < day ? 0 : minutes(entry.tool.startTime),
      end:
        (entry.tool.endDate || entry.tool.date) > day
          ? 1440
          : minutes(entry.tool.endTime),
    }))
    .filter(
      (s) =>
        s.entry.tool.date <= day &&
        (s.entry.tool.endDate || s.entry.tool.date) >= day &&
        s.end > s.start,
    )
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        a.entry.id.localeCompare(b.entry.id),
    );
  let group = [],
    ends = [],
    boundary = -1;
  const finish = () => {
    for (const item of group) item.columns = ends.length;
    group = [];
    ends = [];
  };
  for (const segment of segments) {
    if (segment.start >= boundary) finish();
    let lane = ends.findIndex((end) => end <= segment.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = segment.end;
    segment.lane = lane;
    boundary = Math.max(segment.end, group.length ? boundary : -1);
    group.push(segment);
  }
  finish();
  return segments;
}
