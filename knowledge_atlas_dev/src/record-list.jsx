import React, { useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { t, locale, localizeMessage } from "../shared/i18n.js";
import { LIST_SORTS, recordDate } from "../shared/record-list.js";
import { recordImportance } from "../shared/importance.js";
import { api } from "./client.js";
import "./record-list.css";

export function ListSort({ value, onChange }) {
  return (
    <label className="list-sort">
      <span>{t("list.sort")}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {LIST_SORTS.map((mode) => (
          <option key={mode} value={mode}>
            {t(`list.sort.${mode}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RecordStamp({ node, importance = false }) {
  const { date, source } = recordDate(node);
  return (
    <div className="record-stamp">
      <span
        className="record-position"
        title={t(node.positionFixed ? "list.fixed" : "list.position")}
      >
        #{node.position || "—"}
        {node.positionFixed && (
          <LockKeyhole size={12} role="img" aria-label={t("list.fixed")} />
        )}
      </span>
      <span className="record-date" title={t(`list.date.${source}`)}>
        {date ? (
          <>
            <span>{t(`list.date.${source}`)} </span>
            <time dateTime={date}>
              {new Date(date + "T12:00:00").toLocaleDateString(locale())}
            </time>
          </>
        ) : (
          t("list.date.unknown")
        )}
      </span>
      {importance && (
        <span
          className="record-stars"
          aria-label={t("importance.value", recordImportance(node))}
        >
          ★ {recordImportance(node)}/5
        </span>
      )}
    </div>
  );
}

export function RecordOrder({ node, count, limit = count, revision, onSaved }) {
  const [position, setPosition] = useState(node.position),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setPosition(node.position);
    setError("");
  }, [node.id, node.position, node.positionFixed]);
  async function save(positionFixed = !!node.positionFixed) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`nodes/${node.id}/position`, {
        method: "PUT",
        body: JSON.stringify({
          position: Number(position),
          positionFixed,
          revision,
        }),
      });
      await onSaved();
    } catch (failure) {
      if (failure.status === 409) await onSaved();
      setError(localizeMessage(failure.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="record-order"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || Number(position) === node.position) return;
        save();
      }}
    >
      <label>
        {t("list.position")}
        <input
          type="number"
          min="1"
          max={limit}
          step="1"
          required
          value={position ?? ""}
          disabled={busy}
          onChange={(event) => setPosition(event.target.value)}
        />
      </label>
      <button
        className="secondary-button"
        disabled={busy || Number(position) === node.position}
      >
        {t("list.move")}
      </button>
      <label className="record-order-fixed">
        <input
          type="checkbox"
          checked={!!node.positionFixed}
          disabled={
            busy ||
            !Number.isSafeInteger(Number(position)) ||
            Number(position) < 1 ||
            Number(position) > limit
          }
          onChange={(event) => save(event.target.checked)}
        />
        {t("list.fixed")}
      </label>
      <p className="field-help">{t("list.positionHelp", count)}</p>
      <p className="field-help">{t("list.fixedHelp")}</p>
      {error && (
        <p className="importance-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
