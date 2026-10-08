import { Select } from "./select.jsx";
import React, { useEffect, useState } from "react";
import {
  Plus,
  Paperclip,
  MessageSquare,
  Flag,
  Clock,
  Settings2,
  ArrowUp,
  ArrowDown,
  Trash2,
  X,
} from "lucide-react";
import { t, locale } from "../shared/i18n.js";
import { api, useDialogKeys } from "./client.js";
import { columnsFor, columnFor } from "../shared/boards.js";
import { projectFor, TASK_STATUS } from "./work-model.js";
import { RecordImportance } from "./importance.jsx";
import { checkpoints } from "../shared/checkpoints.js";
import "./task-workspace.css";

function BoardSettings({ project, nodes, onClose, onSaved }) {
  const [columns, setColumns] = useState(() =>
      columnsFor(project).map((c) => ({ ...c, name: c.name || t(c.key) })),
    ),
    [destinations, setDestinations] = useState({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useDialogKeys(React, onClose);
  const affected = columnsFor(project).filter(
    (c) =>
      !columns.some((x) => x.id === c.id && x.status === c.status) &&
      nodes.some(
        (n) =>
          n.type === "task" &&
          projectFor(n, nodes)?.id === project.id &&
          columnFor(n, columnsFor(project))?.id === c.id,
      ),
  );
  const reorder = (index, step) =>
    setColumns((old) => {
      const copy = [...old];
      [copy[index], copy[index + step]] = [copy[index + step], copy[index]];
      return copy;
    });
  return (
    <div className="modal-backdrop">
      <section
        className="modal board-settings"
        role="dialog"
        aria-modal="true"
        aria-label={t("board.settings")}
      >
        <header>
          <h2>{t("board.settings")}</h2>
          <button
            autoFocus
            className="icon-button"
            onClick={onClose}
            aria-label={t("m188")}
          >
            <X />
          </button>
        </header>
        <div className="editor-body">
          {columns.map((c, i) => (
            <div className="board-column-editor" key={c.id}>
              <label>
                {t("board.column")}
                <input
                  maxLength={80}
                  value={c.name}
                  onChange={(e) =>
                    setColumns(
                      columns.map((x) =>
                        x.id === c.id ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                {t("m192")}
                <Select
                  value={c.status}
                  onChange={(e) =>
                    setColumns(
                      columns.map((x) =>
                        x.id === c.id ? { ...x, status: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {Object.entries(TASK_STATUS).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              </label>
              <button
                className="icon-button"
                disabled={!i}
                aria-label={t("board.left")}
                onClick={() => reorder(i, -1)}
              >
                <ArrowUp size={16} />
              </button>
              <button
                className="icon-button"
                disabled={i === columns.length - 1}
                aria-label={t("board.right")}
                onClick={() => reorder(i, 1)}
              >
                <ArrowDown size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={t("board.remove")}
                onClick={() => setColumns(columns.filter((x) => x.id !== c.id))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            className="secondary-button"
            disabled={columns.length >= 30}
            onClick={() =>
              setColumns([
                ...columns,
                {
                  id: crypto.randomUUID(),
                  name: t("board.newColumn"),
                  status: "draft",
                },
              ])
            }
          >
            <Plus size={16} />
            {t("board.addColumn")}
          </button>
          {affected.map((c) => (
            <label key={c.id}>
              {t("board.destination", c.name || t(c.key))}
              <Select
                value={destinations[c.id] || ""}
                onChange={(e) =>
                  setDestinations({ ...destinations, [c.id]: e.target.value })
                }
              >
                <option value="">—</option>
                {columns.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </label>
          ))}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button
            className="primary-button"
            disabled={busy || affected.some((c) => !destinations[c.id])}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(`projects/${project.id}/board`, {
                  method: "PUT",
                  body: JSON.stringify({
                    revision: project.revision,
                    board: {
                      schema: 1,
                      columns: columns.map(({ id, name, status }) => ({
                        id,
                        name,
                        status,
                      })),
                    },
                    destinations,
                  }),
                });
                await onSaved();
                onClose();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("task.save")}
          </button>
        </footer>
      </section>
    </div>
  );
}
export default function TaskBoard({
  tasks,
  nodes,
  projectId,
  orderRevision,
  urgencyById,
  onEdit,
  onNew,
  onRefresh,
}) {
  const [project, setProject] = useState(null),
    [counts, setCounts] = useState({}),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [dragging, setDragging] = useState(""),
    [settings, setSettings] = useState(false),
    [completion, setCompletion] = useState(null);
  useEffect(() => {
    let live = true;
    setProject(null);
    if (projectId)
      api(`nodes/${projectId}`)
        .then((n) => {
          if (live) setProject(n);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [projectId, nodes]);
  useEffect(() => {
    let live = true;
    api("task-counts")
      .then((c) => {
        if (live) setCounts(c);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [nodes]);
  const columns = columnsFor(project);
  async function move(
    node,
    columnId,
    beforeId = null,
    confirmIncomplete = false,
  ) {
    const target = columns.find((c) => c.id === columnId);
    if (
      target?.status === "done" &&
      node.status !== "done" &&
      checkpoints(node).some((p) => !p.done) &&
      !confirmIncomplete
    ) {
      setCompletion({ node, columnId, beforeId });
      return;
    }
    setBusy(node.id);
    setError("");
    try {
      await api(`tasks/${node.id}/move`, {
        method: "PUT",
        body: JSON.stringify({
          revision: node.revision,
          columnId,
          beforeId,
          orderRevision,
          aggregate: !projectId,
          confirmIncomplete,
        }),
      });
      await onRefresh();
    } catch (e) {
      setError(e.message);
      await onRefresh();
    } finally {
      setBusy("");
      setDragging("");
      setCompletion(null);
    }
  }
  const drop = (e, columnId, beforeId = null) => {
    e.preventDefault();
    e.stopPropagation();
    const node = tasks.find(
      (n) => n.id === e.dataTransfer.getData("text/plain"),
    );
    if (node && !busy && node.id !== beforeId) move(node, columnId, beforeId);
  };
  return (
    <div className="deck-workspace">
      <div className="board-actions">
        <p>{t("board.orderHelp")}</p>
        {projectId && (
          <button
            className="secondary-button"
            disabled={!project}
            onClick={() => setSettings(true)}
          >
            <Settings2 size={16} />
            {t("board.settings")}
          </button>
        )}
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {completion && (
        <div className="conflict-panel" role="alert">
          <p>{t("task.incomplete")}</p>
          <button
            className="secondary-button"
            onClick={() => setCompletion(null)}
          >
            {t("conflict.cancel")}
          </button>
          <button
            className="primary-button"
            onClick={() =>
              move(
                completion.node,
                completion.columnId,
                completion.beforeId,
                true,
              )
            }
          >
            {t("task.confirmIncomplete")}
          </button>
        </div>
      )}
      <div className="deck-board">
        {columns.map((column) => {
          const cards = tasks.filter(
            (n) => columnFor(n, columns)?.id === column.id,
          );
          return (
            <section
              className={`deck-column ${dragging ? "drop-ready" : ""}`}
              key={column.id}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => drop(e, column.id)}
            >
              <header>
                <span className={`column-dot ${column.status}`} />
                <h3>{column.name || t(column.key)}</h3>
                <span>{cards.length}</span>
                <button
                  className="icon-button"
                  aria-label={t("m259", column.name || t(column.key))}
                  onClick={() => onNew(projectId, column.status, column.id)}
                >
                  <Plus size={18} />
                </button>
              </header>
              <div className="deck-cards">
                {cards.map((n) => (
                  <article
                    className={`deck-card ${urgencyById.get(n.id)?.overdue ? "overdue" : ""}`}
                    key={n.id}
                    draggable={!busy}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", n.id);
                      setDragging(n.id);
                    }}
                    onDragEnd={() => setDragging("")}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => drop(e, column.id, n.id)}
                  >
                    <button className="deck-title" onClick={() => onEdit(n)}>
                      {n.title}
                    </button>
                    <div className="deck-tags">
                      {n.tags.map((tag) => (
                        <span key={tag} style={{ "--tag-color": n.color }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <RecordImportance node={n} compact onSaved={onRefresh} />
                    <div className="deck-due">
                      <Clock size={14} />
                      {n.task?.due ? (
                        <time
                          dateTime={n.task.due}
                          title={new Date(
                            n.task.due + "T12:00:00",
                          ).toLocaleDateString(locale())}
                        >
                          {new Date(
                            n.task.due + "T12:00:00",
                          ).toLocaleDateString(locale())}
                        </time>
                      ) : (
                        <span>{t("task.noDue")}</span>
                      )}
                      <small>
                        #{n.position}
                        {n.positionFixed ? " · " + t("list.fixed") : ""}
                      </small>
                    </div>
                    <div className="deck-badges">
                      <button
                        aria-label={t("task.attachments")}
                        onClick={() => onEdit(n, "attachments")}
                      >
                        <Paperclip size={15} />
                        {n.resources.length}
                      </button>
                      <button
                        aria-label={t("task.comments")}
                        onClick={() => onEdit(n, "comments")}
                      >
                        <MessageSquare size={15} />
                        {counts[n.id] || 0}
                      </button>
                      <button
                        aria-label={t("task.checkpoints")}
                        onClick={() => onEdit(n, "checkpoints")}
                      >
                        <Flag size={15} />
                        {checkpoints(n).filter((p) => p.done).length}/
                        {checkpoints(n).length}
                      </button>
                    </div>
                    <details className="deck-move">
                      <summary>{t("board.move")}</summary>
                      <label>
                        {t("board.column")}
                        <Select
                          value={column.id}
                          disabled={!!busy}
                          onChange={(e) => move(n, e.target.value)}
                        >
                          {columns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name || t(c.key)}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label>
                        {t("board.insertBefore")}
                        <Select
                          value=""
                          disabled={!!busy || n.positionFixed}
                          onChange={(e) => {
                            const before = tasks.find(
                              (x) => x.id === e.target.value,
                            );
                            if (before)
                              move(n, columnFor(before, columns).id, before.id);
                          }}
                        >
                          <option value="">—</option>
                          {tasks
                            .filter((x) => x.id !== n.id)
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.title}
                              </option>
                            ))}
                        </Select>
                      </label>
                    </details>
                  </article>
                ))}
                {!cards.length && (
                  <p className="task-empty">{t("board.empty")}</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {settings && project && (
        <BoardSettings
          project={project}
          nodes={nodes}
          onClose={() => setSettings(false)}
          onSaved={onRefresh}
        />
      )}
    </div>
  );
}
