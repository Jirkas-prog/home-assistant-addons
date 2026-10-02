import React, { useEffect, useState } from "react";
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
      <span className="record-position" title={t("list.position")}>
        #{node.position || "—"}
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

export function RecordOrder({ node, count, revision, onSaved }) {
  const [position, setPosition] = useState(node.position),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setPosition(node.position);
    setError("");
  }, [node.id, node.position]);
  return (
    <form
      className="record-order"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || Number(position) === node.position) return;
        setBusy(true);
        setError("");
        try {
          await api(`nodes/${node.id}/position`, {
            method: "PUT",
            body: JSON.stringify({ position: Number(position), revision }),
          });
          await onSaved();
        } catch (failure) {
          if (failure.status === 409) await onSaved();
          setError(localizeMessage(failure.message));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {t("list.position")}
        <input
          type="number"
          min="1"
          max={count}
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
      <p className="field-help">{t("list.positionHelp", count)}</p>
      {error && (
        <p className="importance-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
