import { t, locale } from "../shared/i18n.js";
import React, { useState, useMemo } from "react";
import {
  Plus,
  Box,
  Download,
  ClipboardList,
  CalendarRange,
  ArrowUpRight,
} from "lucide-react";
import { resourceLocation, filterNodes } from "./atlas-model.js";
import { itemQuantity, itemPlaces } from "../shared/inventory.js";
import { locationLabel } from "../shared/locations.js";
import { importancePriority } from "../shared/importance.js";
import { Timeline } from "./timeline.jsx";
import { checkpoints, taskUrgencies } from "../shared/checkpoints.js";
import { useToday } from "./use-today.js";
import { TASK_STATUS, PRIORITIES, projectFor } from "./work-model.js";
export function Inventory({
  importance = [],
  nodes,
  settings,
  query,
  scope,
  onSelect,
  onNew,
}) {
  const [place, setPlace] = useState("");
  const items = filterNodes(nodes, {
    query,
    scope,
    type: "item",
    importance,
    location: place,
    locations: settings.locations,
  });
  const places = (n) => itemPlaces(n, settings.locations, place);
  const count = items.reduce(
    (sum, n) => sum + itemQuantity(n, place, settings.locations),
    0,
  );
  return (
    <section className="collection-view">
      <div className="collection-toolbar">
        <label>
          {t("m232")}
          <select
            aria-label={t("m233")}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          >
            <option value="">{t("m234")}</option>
            {settings.locations?.map((l) => (
              <option key={l.id} value={l.id}>
                {locationLabel(settings.locations, l.id)}
              </option>
            ))}
          </select>
        </label>
        <span>
          {items.length}
          {" " + t("m235") + " "}
          {count}
          {" " + t("m162")}
        </span>
        <a
          className="secondary-button"
          href={`./api/inventory.csv?${new URLSearchParams({
            scope,
            query,
            location: place,
            importance: importance.join(","),
          })}`}
        >
          <Download size={15} />
          {t("m236")}
        </a>
        <button className="primary-button" onClick={onNew}>
          <Plus size={15} />
          {t("m237")}
        </button>
      </div>
      {items.length ? (
        <div className="inventory-table">
          <table>
            <thead>
              <tr>
                <th>{t("m078")}</th>
                <th>{t("m238")}</th>
                <th>{t("m239")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((n) => (
                <tr key={n.id}>
                  <td>
                    <button onClick={() => onSelect(n)}>
                      <Box size={16} />
                      <span>
                        {n.title}
                        <small>{n.summary}</small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  </td>
                  <td>{itemQuantity(n, place, settings.locations)}</td>
                  <td>{places(n) || t("m240")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <Box />
          <h3>{place || query ? t("m241") : t("m242")}</h3>
          <p>{t("m243")}</p>
          <button className="secondary-button" onClick={onNew}>
            {t("m244")}
          </button>
        </div>
      )}
    </section>
  );
}
export function Tasks({
  importance = [],
  nodes,
  settings,
  query,
  scope,
  onEdit,
  onNew,
  onMove,
  onSelect,
  onRefresh,
}) {
  const [project, setProject] = useState(""),
    [mode, setMode] = useState("board"),
    [status, setStatus] = useState("all"),
    [timelineStatuses, setTimelineStatuses] = useState([
      "draft",
      "active",
      "learning",
      "done",
    ]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [dragging, setDragging] = useState(null);
  const tasks = useMemo(
    () =>
      filterNodes(nodes, {
        query,
        scope,
        type: "task",
        importance,
        locations: settings.locations,
      }).filter(
        (n) =>
          (!project || projectFor(n, nodes)?.id === project) &&
          (mode === "timeline" || status === "all" || n.status === status),
      ),
    [nodes, query, scope, project, status, mode, settings, importance],
  );
  const today = useToday();
  const allTasks = useMemo(
    () => nodes.filter((n) => n.type === "task"),
    [nodes],
  );
  const urgencyById = useMemo(
    () => taskUrgencies(allTasks, today),
    [allTasks, today],
  );
  async function move(n, status) {
    if (n.status === status) return;
    setBusy(n.id);
    setError("");
    try {
      await onMove(n, status);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
      setDragging(null);
    }
  }
  const card = (n) => (
    <article
      className={`task-card ${urgencyById.get(n.id).overdue ? "overdue" : ""}`}
      key={n.id}
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", n.id);
        setDragging(n.id);
      }}
      onDragEnd={() => setDragging(null)}
    >
      <button className="task-title" onClick={() => onEdit(n)}>
        {n.title}
      </button>
      <p>{n.summary}</p>
      <div className="task-meta">
        <span className={`priority ${importancePriority(n)}`}>
          {PRIORITIES[importancePriority(n)]}
        </span>
        {n.task?.due && (
          <span>
            {t("m245") + " "}
            {new Date(n.task.due + "T12:00:00").toLocaleDateString(locale())}
            {n.status !== "done" && n.task.due < today ? t("m246") : ""}
          </span>
        )}
      </div>
      {checkpoints(n).length > 0 && (
        <p className="task-checkpoint-progress">
          {t("checkpoint.title")} ·{" "}
          {t(
            "checkpoint.progress",
            checkpoints(n).filter((p) => p.done).length,
            checkpoints(n).length,
          )}
          {urgencyById.get(n.id).overdueCheckpoints > 0 && (
            <strong>
              {t(
                "checkpoint.overdueCount",
                urgencyById.get(n.id).overdueCheckpoints,
              )}
            </strong>
          )}
        </p>
      )}
      <small>
        {projectFor(n, nodes)?.title || t("m404")}
        {n.task?.assignee && ` · ${n.task.assignee}`}
      </small>
      <div className="task-bottom">
        <select
          disabled={busy === n.id}
          aria-label={t("m247", n.title)}
          value={n.status}
          onChange={(e) => move(n, e.target.value)}
        >
          {Object.entries(TASK_STATUS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          aria-label={t("m248", n.title)}
          onClick={() => onSelect(n)}
        >
          <ArrowUpRight size={16} />
        </button>
      </div>
    </article>
  );
  return (
    <section className="collection-view tasks-view">
      <div className="collection-toolbar">
        <select
          aria-label={t("m249")}
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="">{t("m250")}</option>
          {nodes
            .filter((n) => n.type === "project")
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
        </select>
        {mode === "board" && (
          <select
            aria-label={t("m251")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">{t("m252")}</option>
            {Object.entries(TASK_STATUS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        )}
        <div className="segmented">
          <button
            className={mode === "board" ? "active" : ""}
            onClick={() => setMode("board")}
          >
            <ClipboardList size={15} />
            {t("m253")}
          </button>
          <button
            className={mode === "timeline" ? "active" : ""}
            onClick={() => setMode("timeline")}
          >
            <CalendarRange size={15} />
            {t("m254")}
          </button>
        </div>
        <button className="primary-button" onClick={() => onNew(project)}>
          <Plus size={15} />
          {t("m255")}
        </button>
      </div>
      <div className="collection-summary">
        {tasks.length}
        {" " + t("m256") + " "}
        {tasks.filter((n) => n.status === "done").length}
        {" " + t("m257") + " "}
        {tasks.filter((n) => urgencyById.get(n.id).overdue).length}
        {" " + t("m258")}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {mode === "board" ? (
        <div className="kanban">
          {Object.entries(TASK_STATUS).map(([id, label]) => (
            <section
              className={`kanban-column ${dragging ? "drop-ready" : ""}`}
              key={id}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const n = nodes.find(
                  (n) =>
                    n.id === e.dataTransfer.getData("text/plain") &&
                    n.type === "task",
                );
                if (n && !busy) move(n, id);
              }}
            >
              <header>
                <span className={`column-dot ${id}`} />
                <h3>{label}</h3>
                <span>{tasks.filter((n) => n.status === id).length}</span>
                <button
                  className="icon-button"
                  aria-label={t("m259", label)}
                  onClick={() => onNew(project, id)}
                >
                  <Plus size={16} />
                </button>
              </header>
              {tasks.filter((n) => n.status === id).map(card)}
              <p className="drop-hint">{dragging ? t("m260") : t("m261")}</p>
            </section>
          ))}
        </div>
      ) : (
        <Timeline
          tasks={tasks}
          allTasks={allTasks}
          statuses={timelineStatuses}
          setStatuses={setTimelineStatuses}
          onEdit={onEdit}
          onRefresh={onRefresh}
          onError={setError}
        />
      )}
    </section>
  );
}
