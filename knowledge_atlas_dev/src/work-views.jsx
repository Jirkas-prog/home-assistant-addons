import { t } from "../shared/i18n.js";
import React, { useState, useMemo, lazy, Suspense } from "react";
import {
  Plus,
  Box,
  Download,
  ClipboardList,
  CalendarRange,
  ArrowUpRight,
} from "lucide-react";
import { filterNodes } from "./atlas-model.js";
import { itemQuantity, itemPlaces } from "../shared/inventory.js";
import { locationLabel } from "../shared/locations.js";
import { Timeline } from "./timeline.jsx";
import { RecordStamp } from "./record-list.jsx";
import { taskUrgencies } from "../shared/checkpoints.js";
import { useToday } from "./use-today.js";
import { TASK_STATUS, projectFor } from "./work-model.js";
const TaskBoard = lazy(() => import("./task-board.jsx"));
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
                        <RecordStamp node={n} importance />
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
  orderRevision,
  importance = [],
  nodes,
  settings,
  query,
  scope,
  onEdit,
  onNew,
  onRefresh,
}) {
  const [project, setProject] = useState(""),
    [mode, setMode] = useState("timeline"),
    [status, setStatus] = useState("all"),
    [timelineStatuses, setTimelineStatuses] = useState([
      "draft",
      "active",
      "learning",
      "done",
    ]),
    [error, setError] = useState("");
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
        <Suspense fallback={<p role="status">{t("m148")}</p>}>
          <TaskBoard
            tasks={tasks}
            nodes={nodes}
            projectId={project}
            orderRevision={orderRevision}
            urgencyById={urgencyById}
            onEdit={onEdit}
            onNew={onNew}
            onRefresh={onRefresh}
          />
        </Suspense>
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
