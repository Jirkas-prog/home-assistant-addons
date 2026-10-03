export function undoShortcut(event) {
  if (
    event.defaultPrevented ||
    event.altKey ||
    !(event.ctrlKey || event.metaKey)
  )
    return null;
  if (
    event.target?.closest?.(
      'textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="button"]),[contenteditable]:not([contenteditable="false"])',
    )
  )
    return null;
  const key = event.key?.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}
