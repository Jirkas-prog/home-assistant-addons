import React, { useEffect, useMemo, useRef, useState } from "react";
import { Flag, Plus, Trash2, X, Pencil } from "lucide-react";
import { t, locale, localizeMessage } from "../shared/i18n.js";
import {
  checkpoints,
  withCheckpointDone,
  taskUrgencies,
  urgencyStyle,
} from "../shared/checkpoints.js";
import { api, useDialogKeys } from "./client.js";
import { useToday } from "./use-today.js";
import { localDate } from "./work-model.js";
import "./checkpoints.css";

const dateLabel = (date) =>
  new Date(date + "T00:00:00Z").toLocaleDateString(locale(), {
    timeZone: "UTC",
  });
export function urgencyDescription(urgency) {
  const parts = [];
  if (urgency.overdueCheckpoints)
    parts.push(t("checkpoint.overdueCount", urgency.overdueCheckpoints));
  if (urgency.overdueTask) parts.push(t("checkpoint.taskOverdue"));
  if (!urgency.overdue && urgency.next)
    parts.push(
      t(
        urgency.next.checkpointId
          ? "checkpoint.nextCheckpoint"
          : "checkpoint.nextDue",
        dateLabel(urgency.next.due),
      ),
    );
  if (urgency.nearbyCount)
    parts.push(t("checkpoint.nearby", urgency.nearbyCount));
  if (!parts.length)
    parts.push(
      t(urgency.completed ? "checkpoint.allDone" : "checkpoint.noDeadline"),
    );
  return parts.join(" · ");
}
export function UrgencySummary({ urgency }) {
  return (
    <div className="urgency-summary" style={urgencyStyle(urgency)}>
      <strong>
        {t(`checkpoint.${urgency.completed ? "completed" : urgency.level}`)}
      </strong>
      <span>{urgencyDescription(urgency)}</span>
    </div>
  );
}
export function CheckpointEditor({ node, onChange }) {
  const points = checkpoints(node);
  const update = (id, patch) =>
    onChange(
      points.map((point) => (point.id === id ? { ...point, ...patch } : point)),
    );
  return (
    <section className="checkpoint-editor" aria-label={t("checkpoint.title")}>
      <div className="checkpoint-heading">
        <h3>
          <Flag size={16} />
          {t("checkpoint.title")}
        </h3>
        <button
          type="button"
          className="secondary-button"
          disabled={points.length >= 200}
          onClick={() =>
            onChange([
              ...points,
              {
                id: crypto.randomUUID(),
                due: node.task?.due || node.task?.start || localDate(),
                description: "",
                done: false,
              },
            ])
          }
        >
          <Plus size={15} />
          {t("checkpoint.add")}
        </button>
      </div>
      <p className="checkpoint-help">{t("checkpoint.help")}</p>
      {points.map((point, index) => (
        <fieldset className="checkpoint-fields" key={point.id}>
          <legend>{t("checkpoint.number", index + 1)}</legend>
          <div className="checkpoint-field-row">
            <label>
              {t("checkpoint.date")}
              <input
                type="date"
                required
                value={point.due}
                min={node.task?.start || undefined}
                max={node.task?.due || undefined}
                onChange={(e) => update(point.id, { due: e.target.value })}
              />
            </label>
            <label className="checkpoint-done">
              <input
                type="checkbox"
                checked={point.done}
                onChange={(e) =>
                  onChange(
                    checkpoints(
                      withCheckpointDone(node, point.id, e.target.checked),
                    ),
                  )
                }
              />
              {t("checkpoint.done")}
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label={t("checkpoint.remove", index + 1)}
              onClick={() => onChange(points.filter((p) => p.id !== point.id))}
            >
              <Trash2 size={17} />
            </button>
          </div>
          <label>
            {t("checkpoint.description")}
            <textarea
              rows={2}
              required
              maxLength={2000}
              placeholder={t("checkpoint.descriptionHint")}
              value={point.description}
              onChange={(e) =>
                update(point.id, { description: e.target.value })
              }
            />
          </label>
        </fieldset>
      ))}
    </section>
  );
}
export function TaskCheckpoints({ node, allTasks, onSaved, onError }) {
  const today = useToday();
  const urgency = useMemo(
    () => taskUrgencies(allTasks, today).get(node.id),
    [allTasks, today, node.id],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false);
  const checkboxFocus = useRef(null);
  useEffect(() => {
    if (busy) return;
    const checkbox = checkboxFocus.current;
    if (checkbox?.isConnected && document.activeElement === document.body)
      checkbox.focus({ preventScroll: true });
    checkboxFocus.current = null;
  }, [busy]);
  const points = checkpoints(node);
  async function toggle(id, done, checkbox) {
    if (saving.current) return;
    saving.current = true;
    checkboxFocus.current = checkbox;
    setBusy(true);
    setError("");
    onError?.("");
    try {
      await api(`nodes/${node.id}`, {
        method: "PUT",
        body: JSON.stringify(withCheckpointDone(node, id, done)),
      });
      await onSaved();
    } catch (e) {
      const message = localizeMessage(e.message);
      setError(message);
      onError?.(message);
      if (e.status === 409) await onSaved();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="task-checkpoints" aria-label={t("checkpoint.title")}>
      {urgency && <UrgencySummary urgency={urgency} />}
      <div className="checkpoint-heading">
        <h3>
          <Flag size={16} />
          {t("checkpoint.title")}
        </h3>
        <span>
          {t(
            "checkpoint.progress",
            points.filter((p) => p.done).length,
            points.length,
          )}
        </span>
      </div>
      {!points.length && (
        <p className="checkpoint-help">{t("checkpoint.empty")}</p>
      )}
      {[...points]
        .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
        .map((point) => (
          <label
            key={point.id}
            className={`checkpoint-entry ${!point.done && point.due < today ? "overdue" : ""}`}
          >
            <input
              type="checkbox"
              checked={point.done}
              disabled={busy}
              onChange={(e) =>
                toggle(point.id, e.target.checked, e.currentTarget)
              }
              aria-label={t("checkpoint.toggle", point.description)}
            />
            <span>
              <strong>
                {dateLabel(point.due)}
                {!point.done && point.due < today && (
                  <em>{t("checkpoint.overdue")}</em>
                )}
                {point.done && <em>{t("checkpoint.done")}</em>}
              </strong>
              <span className="checkpoint-description">
                {point.description}
              </span>
              {point.done && point.completedAt && (
                <small>
                  {t(
                    "checkpoint.completedAt",
                    new Date(point.completedAt).toLocaleString(locale()),
                  )}
                </small>
              )}
            </span>
          </label>
        ))}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
    </section>
  );
}
export function CheckpointDialog({ node, allTasks, onSaved, onClose, onEdit }) {
  useDialogKeys(React, onClose);
  const closeButton = useRef(null);
  useEffect(() => {
    closeButton.current?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop upper-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal checkpoint-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("checkpoint.forTask", node.title)}
      >
        <header>
          <div>
            <span className="eyebrow">{t("checkpoint.title")}</span>
            <h2>{node.title}</h2>
          </div>
          <button
            ref={closeButton}
            className="icon-button"
            aria-label={t("checkpoint.close")}
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="checkpoint-dialog-body">
          <TaskCheckpoints
            key={node.id}
            node={node}
            allTasks={allTasks}
            onSaved={onSaved}
          />
        </div>
        <footer>
          <button
            className="secondary-button"
            onClick={() => {
              onClose();
              onEdit(node);
            }}
          >
            <Pencil size={15} />
            {t("checkpoint.manage")}
          </button>
        </footer>
      </section>
    </div>
  );
}
