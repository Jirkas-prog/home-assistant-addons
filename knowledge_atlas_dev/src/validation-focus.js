import { useEffect, useState } from "react";
import { validationTab, validationField } from "../shared/editor-validation.js";
import { t, localizeMessage } from "../shared/i18n.js";

export function validationMessage(error) {
  const key = {
    "tool.date": "validation.journalStart",
    "tool.endDate": "validation.journalEnd",
    "tool.time": "validation.journalTime",
    "tool.timeRange": "validation.journalTimeRange",
    "tool.minutes": "validation.journalMinutes",
    "tool.placeLabel": "validation.placeLabel",
    "tool.coordinates": "validation.coordinates",
  }[error.field];
  return key ? t(key) : localizeMessage(error.message);
}

export function useValidationFocus(kind, selectTab) {
  const [issue, setIssue] = useState(null);
  useEffect(() => {
    if (!issue) return;
    const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
    const fields = [...(dialog?.querySelectorAll("[data-field]") || [])];
    const group =
      fields.find((el) => el.dataset.field === issue.field) ||
      fields.find((el) => issue.field.startsWith(el.dataset.field + "."));
    const target = group?.matches("input,textarea,select,button")
      ? group
      : group?.querySelector(
          "input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)",
        );
    (target || dialog?.querySelector('[role="alert"]'))?.focus();
  }, [issue]);
  return (error) => {
    if (!error.field) return;
    selectTab(validationTab(kind, error.field));
    setIssue({ field: validationField(error.field) });
  };
}
