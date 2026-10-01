import React, { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import {
  IMPORTANCE_LEVELS,
  recordImportance,
  withImportance,
} from "../shared/importance.js";
import { localizeMessage, t } from "../shared/i18n.js";
import { api } from "./client.js";
import "./importance.css";

export function ImportanceStars({
  value,
  onChange,
  disabled = false,
  label = t("importance.label"),
}) {
  const buttons = useRef([]);
  return (
    <div
      className="importance-rating"
      role="radiogroup"
      aria-label={label}
      aria-busy={disabled}
    >
      {IMPORTANCE_LEVELS.map((rating) => (
        <button
          key={rating}
          ref={(element) => {
            buttons.current[rating - 1] = element;
          }}
          type="button"
          role="radio"
          aria-checked={value === rating}
          aria-label={t("importance.value", rating)}
          title={t("importance.value", rating)}
          tabIndex={value === rating ? 0 : -1}
          className={rating <= value ? "filled" : ""}
          disabled={disabled}
          onClick={() => {
            if (rating !== value) onChange(rating);
          }}
          onKeyDown={(event) => {
            let next;
            if (["ArrowRight", "ArrowUp"].includes(event.key))
              next = Math.min(5, rating + 1);
            else if (["ArrowLeft", "ArrowDown"].includes(event.key))
              next = Math.max(1, rating - 1);
            else if (event.key === "Home") next = 1;
            else if (event.key === "End") next = 5;
            else return;
            event.preventDefault();
            buttons.current[next - 1]?.focus();
            if (next !== value) onChange(next);
          }}
        >
          <Star size={19} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export function RecordImportance({ node, onSaved, compact = false, onError }) {
  const [value, setValue] = useState(() => recordImportance(node));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  useEffect(() => {
    setValue(recordImportance(node));
  }, [node.importance, node.task?.priority]);

  const save = async (importance) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    onError?.("");
    setValue(importance);
    try {
      await api(`nodes/${node.id}`, {
        method: "PUT",
        body: JSON.stringify(withImportance(node, importance)),
      });
      await onSaved();
    } catch (failure) {
      setValue(recordImportance(node));
      const message = localizeMessage(failure.message);
      if (onError) onError(message);
      else setError(message);
      if (failure.status === 409) await onSaved();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <div className={compact ? "importance-inline" : "importance-header"}>
      {!compact && <span>{t("importance.label")}</span>}
      <ImportanceStars
        value={value}
        onChange={save}
        disabled={busy}
        label={t("importance.forRecord", node.title)}
      />
      {error && (
        <p className="importance-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
