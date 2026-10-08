import React, { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { History, Undo2, Redo2, RefreshCw, AlertTriangle } from "lucide-react";
import {
  api,
  mutationCount,
  subscribeMutations,
  useDialogKeys,
} from "./client.js";
import { t, locale, localizeMessage } from "../shared/i18n.js";
import "./undo.css";

const describe = (entry) =>
  t(`undo.action.${entry.kind}`) + (entry.title ? `: ${entry.title}` : "");
const dateLabel = (entry) =>
  entry.at
    ? new Date(entry.at).toLocaleString(locale())
    : t("undo.unknownDate");
function fieldLabel(field) {
  for (const key of [`undo.field.${field}`, `task.field.${field}`])
    if (t(key) !== key) return t(key);
  return t("undo.field.other");
}

function Confirmation({ entry, disabled, onCancel, onConfirm }) {
  useDialogKeys(React, onCancel);
  return createPortal(
    <div className="modal-backdrop history-confirm-backdrop">
      <section
        className="modal history-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-confirm-title"
        aria-describedby="history-confirm-description"
      >
        <header>
          <h2 id="history-confirm-title">
            <AlertTriangle size={21} /> {t(`undo.confirm.${entry.direction}`)}
          </h2>
        </header>
        <div className="editor-body">
          <p>
            <strong>{describe(entry)}</strong>
          </p>
          {!!entry.fields?.length && (
            <p>{[...new Set(entry.fields.map(fieldLabel))].join(" · ")}</p>
          )}
          <p className="field-help">{dateLabel(entry)}</p>
          <p id="history-confirm-description">
            {t(`undo.confirmHelp.${entry.direction}`, entry.steps)}
          </p>
          <p className="field-help">{t("undo.reversible")}</p>
        </div>
        <footer>
          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
            autoFocus
          >
            {t("m047")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={disabled}
            onClick={onConfirm}
          >
            {t(`undo.confirmButton.${entry.direction}`, entry.steps)}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function HistoryList({ disabled, onChanged, onBusy }) {
  const [data, setData] = useState(null),
    [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selection, setSelection] = useState(null),
    [message, setMessage] = useState("");
  const pending = useSyncExternalStore(subscribeMutations, mutationCount);
  useEffect(() => {
    if (pending) return;
    const controller = new AbortController();
    setLoading(true);
    api(`undo/history?offset=${offset}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [offset, refresh, pending]);
  const blocked =
    disabled || busy || !!pending || loading || !!data?.error || !!error;
  async function restore() {
    if (blocked || !selection) return;
    const chosen = selection;
    setSelection(null);
    setBusy(true);
    onBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`undo/${chosen.direction}`, {
        method: "POST",
        body: JSON.stringify({ revision: chosen.revision, entryId: chosen.id }),
      });
      await onChanged();
      setMessage(t(`undo.completed.${chosen.direction}`, chosen.steps));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      onBusy(false);
      setRefresh((n) => n + 1);
    }
  }
  return (
    <div className="history-panel" aria-busy={busy || loading}>
      <div className="history-toolbar">
        <span>{t("undo.counts", data?.undo || 0, data?.redo || 0)}</span>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !!pending || loading}
          onClick={() => {
            setError("");
            setRefresh((n) => n + 1);
          }}
        >
          <RefreshCw size={15} />
          {t("undo.refresh")}
        </button>
      </div>
      <p className="field-help">{t("undo.help", data?.limit || 1000)}</p>
      {(error || data?.error) && (
        <p className="error-banner" role="alert">
          {localizeMessage(error || data.error)}
        </p>
      )}
      {message && (
        <p className="history-success" role="status">
          {message}
        </p>
      )}
      {loading && <p role="status">{t("undo.loading")}</p>}
      {data && !data.entries.length && !loading && <p>{t("undo.empty")}</p>}
      <ol className="history-list" aria-label={t("undo.history")}>
        {data?.entries.map((entry) => {
          const Icon = entry.applied ? Undo2 : Redo2;
          return (
            <li
              key={entry.id}
              className={entry.applied ? "" : "history-undone"}
            >
              <div className="history-entry-details">
                <strong>{describe(entry)}</strong>
                {!!entry.fields?.length && (
                  <span>
                    {[...new Set(entry.fields.map(fieldLabel))].join(" · ")}
                  </span>
                )}
                <small>
                  <time dateTime={entry.at}>{dateLabel(entry)}</time> ·{" "}
                  {t(entry.applied ? "undo.applied" : "undo.undone")}
                </small>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={blocked}
                aria-label={t(
                  `undo.row.${entry.direction}`,
                  describe(entry),
                  entry.steps,
                )}
                onClick={() =>
                  setSelection({ ...entry, revision: data.revision })
                }
              >
                <Icon size={16} />
                {t(`undo.to.${entry.direction}`, entry.steps)}
              </button>
            </li>
          );
        })}
      </ol>
      {data && (
        <div className="history-pagination">
          <button
            type="button"
            className="secondary-button"
            disabled={blocked || data.previous === null}
            onClick={() => setOffset(data.previous)}
          >
            {t("undo.newer")}
          </button>
          <span>
            {t(
              "undo.page",
              data.total ? data.offset + 1 : 0,
              data.offset + data.entries.length,
              data.total,
            )}
          </span>
          <button
            type="button"
            className="secondary-button"
            disabled={blocked || data.next === null}
            onClick={() => setOffset(data.next)}
          >
            {t("undo.older")}
          </button>
        </div>
      )}
      {selection && (
        <Confirmation
          entry={selection}
          disabled={blocked}
          onCancel={() => setSelection(null)}
          onConfirm={restore}
        />
      )}
    </div>
  );
}

export function UndoHistory({ disabled, onChanged, onBusy }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="history-settings"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <History size={18} />
        {t("undo.section")}
      </summary>
      {open && (
        <HistoryList
          disabled={disabled}
          onChanged={onChanged}
          onBusy={onBusy}
        />
      )}
    </details>
  );
}
