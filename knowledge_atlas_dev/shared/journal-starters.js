import { periodEnd } from "./journal.js";

export const JOURNAL_STARTERS = ["day", "week", "meeting"];

// Starters are ordinary editable Markdown. Never replace existing writing.
export function startJournal(form, kind, translate) {
  if (
    form.revision ||
    form.tool?.kind !== "journal" ||
    form.body.trim() ||
    !JOURNAL_STARTERS.includes(kind)
  )
    return form;
  const tool = { ...form.tool };
  // Keep a deliberately chosen range or appointment time.
  if (
    kind === "week" &&
    (!tool.endDate || tool.endDate === tool.date) &&
    !tool.startTime &&
    !tool.endTime
  ) {
    tool.period = "week";
    tool.endDate = periodEnd(tool.date, "week");
  }
  return {
    ...form,
    title: form.title.trim()
      ? form.title
      : translate(`journal.starter.${kind}`),
    body: translate(`journal.starter.${kind}Body`),
    tool,
  };
}
