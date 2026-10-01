import { dayNumber, localDate } from "./work-model.js";
export const TIME_PRESETS = [1, 3, 7, 30, 90, 180, 360];
export const MIN_DAYS = 1 / 24;
export const MAX_DAYS = 3_652_500;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function taskInterval(node) {
  // Due dates include the full calendar day. Missing endpoints are unbounded.
  const start = node.task?.start ? dayNumber(node.task.start) : -Infinity;
  const end = node.task?.due ? dayNumber(node.task.due) + 1 : Infinity;
  return { node, start, end };
}
export function fitTimeline(tasks, today = dayNumber(localDate())) {
  const dates = tasks.flatMap((task) => {
    const { start, end } = taskInterval(task);
    return [start, end].filter(Number.isFinite);
  });
  const min = Math.min(today, ...dates),
    max = Math.max(today + 1, ...dates);
  const margin = Math.max(1, (max - min) * 0.05);
  const days = Math.max(30, max - min + margin * 2);
  return { start: (min + max - days) / 2, days, preset: "all" };
}
export function zoomTimeline(view, factor, anchor = 0.5) {
  const days = clamp(view.days * factor, MIN_DAYS, MAX_DAYS);
  const fraction = clamp(anchor, 0, 1);
  return {
    start: view.start + (view.days - days) * fraction,
    days,
    preset: "custom",
  };
}
export function zoomFromWheel(view, event, rect) {
  const unit =
    event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.width : 1;
  const factor = Math.exp(
    Math.max(-2, Math.min(2, event.deltaY * unit * 0.003)),
  );
  return zoomTimeline(view, factor, (event.clientX - rect.left) / rect.width);
}
export function zoomFromPinch(view, initial, current, rect) {
  const next = zoomTimeline(
    view,
    initial.distance / Math.max(1, current.distance),
    (initial.middle - rect.left) / rect.width,
  );
  return {
    ...next,
    start:
      next.start - ((current.middle - initial.middle) / rect.width) * next.days,
  };
}
export function timelineTicks(view, width) {
  const target = view.days / Math.max(2, width / 115);
  const steps = [
    1 / 24,
    1 / 12,
    1 / 8,
    1 / 4,
    1 / 2,
    1,
    2,
    7,
    14,
    30,
    90,
    180,
    365,
    3650,
    36500,
    365000,
    MAX_DAYS,
  ];
  const step = steps.find((n) => n >= target) || MAX_DAYS;
  const ticks = [];
  for (
    let day = Math.ceil(view.start / step) * step;
    day < view.start + view.days;
    day += step
  )
    ticks.push(day);
  return { ticks, hours: step < 1 };
}

// Interval partitioning: reuse the earliest-finishing lane. The heap ensures
// O(n log n) work and the lane count equals the maximum simultaneous overlap.
export function packTimeline(tasks, view) {
  const end = view.start + view.days;
  const intervals = tasks
    .map(taskInterval)
    .filter((n) => n.start < end && n.end > view.start)
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        a.node.id.localeCompare(b.node.id),
    );
  const heap = [],
    items = [];
  let lanes = 0;
  const before = (a, b) =>
    a.end < b.end || (a.end === b.end && a.lane < b.lane);
  const push = (value) => {
    heap.push(value);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = () => {
    const first = heap[0],
      last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        let next = i,
          l = i * 2 + 1,
          r = l + 1;
        if (l < heap.length && before(heap[l], heap[next])) next = l;
        if (r < heap.length && before(heap[r], heap[next])) next = r;
        if (next === i) break;
        [heap[i], heap[next]] = [heap[next], heap[i]];
        i = next;
      }
    }
    return first;
  };
  for (const interval of intervals) {
    const lane =
      heap.length && heap[0].end <= interval.start ? pop().lane : lanes++;
    push({ lane, end: interval.end });
    items.push({
      ...interval,
      lane,
      left: Math.max(interval.start, view.start),
      right: Math.min(interval.end, end),
    });
  }
  return { items, lanes };
}
