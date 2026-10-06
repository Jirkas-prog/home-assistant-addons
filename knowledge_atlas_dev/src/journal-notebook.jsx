import React, { useMemo, useState, useEffect } from "react";
import { Pencil, X, LoaderCircle } from "lucide-react";
import { t } from "../shared/i18n.js";
import { journalEntries } from "../shared/journal.js";
import { filterNodes } from "./atlas-model.js";
import { JournalEntry } from "./journal.jsx";
import { ToolEditor, newTool } from "./tool-editor.jsx";
import { RecordImportance } from "./importance.jsx";
import { api, useDialogKeys } from "./client.js";
import { JournalCalendar } from "./journal-calendar.jsx";
import { localDate } from "./work-model.js";

export function JournalNotebook({
  nodes,
  settings,
  query,
  scope,
  importance,
  homeId,
  onRefresh,
  onSelect,
  focusId,
  createRequested,
  onCreated,
}) {
  const [mode, setMode] = useState("month"),
    [date, setDate] = useState(localDate),
    [activeId, setActiveId] = useState(""),
    [editing, setEditing] = useState(null),
    [project, setProject] = useState(""),
    [experienceOnly, setExperienceOnly] = useState(false),
    [search, setSearch] = useState(null),
    [searchError, setSearchError] = useState(""),
    [loaded, setLoaded] = useState(null),
    [entryError, setEntryError] = useState(""),
    [retry, setRetry] = useState(0);
  const searchQuery = query.trim();
  useEffect(() => {
    setSearchError("");
    if (!searchQuery) {
      setSearch(null);
      return;
    }
    const abort = new AbortController();
    const timeout = setTimeout(
      () =>
        abort.abort(
          new DOMException("The search request timed out.", "TimeoutError"),
        ),
      60000,
    );
    const timer = setTimeout(() => {
      api(`journal/search?q=${encodeURIComponent(searchQuery)}`, {
        signal: abort.signal,
      })
        .then((result) => {
          if (!abort.signal.aborted)
            setSearch({ query: searchQuery, ids: new Set(result.ids) });
        })
        .catch((error) => {
          if (
            !abort.signal.aborted ||
            abort.signal.reason?.name === "TimeoutError"
          )
            setSearchError(
              abort.signal.reason?.name === "TimeoutError"
                ? t("sync.timeout")
                : error.message,
            );
        })
        .finally(() => clearTimeout(timeout));
    }, 200);
    return () => {
      clearTimeout(timer);
      clearTimeout(timeout);
      abort.abort();
    };
  }, [searchQuery, nodes, settings.revision, retry]);
  const searching =
    !!searchQuery && search?.query !== searchQuery && !searchError;
  const entries = useMemo(
    () =>
      journalEntries(
        filterNodes(nodes, {
          query: "",
          scope,
          importance,
          type: experienceOnly ? "experience" : "all",
          locations: settings.locations,
        }).filter(
          (n) =>
            (!project ||
              n.projectId === project ||
              n.related.includes(project)) &&
            (!searchQuery ||
              (search?.query === searchQuery && search.ids.has(n.id))),
        ),
      ),
    [
      nodes,
      searchQuery,
      search,
      scope,
      importance,
      settings,
      experienceOnly,
      project,
    ],
  );
  useEffect(() => {
    if (focusId) setActiveId(focusId);
  }, [focusId]);
  const summary = entries.find((n) => n.id === activeId);
  const active =
    loaded &&
    summary &&
    loaded.node.id === summary.id &&
    loaded.indexRevision === summary.revision
      ? loaded.node
      : summary;
  useEffect(() => {
    setEntryError("");
    if (!summary?.partial) return;
    const abort = new AbortController();
    const timeout = setTimeout(
      () =>
        abort.abort(
          new DOMException("The record request timed out.", "TimeoutError"),
        ),
      60000,
    );
    api(`nodes/${summary.id}`, { signal: abort.signal })
      .then((result) => {
        if (!abort.signal.aborted)
          setLoaded({ node: result, indexRevision: summary.revision });
      })
      .catch((error) => {
        if (
          !abort.signal.aborted ||
          abort.signal.reason?.name === "TimeoutError"
        )
          setEntryError(
            abort.signal.reason?.name === "TimeoutError"
              ? t("sync.timeout")
              : error.message,
          );
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      abort.abort();
    };
  }, [summary?.id, summary?.revision, summary?.partial, retry]);

  function create(day = date, time = "") {
    const value = newTool("journal", project, scope || homeId);
    value.tool.date = day;
    value.tool.endDate = day;
    if (time) {
      value.tool.startTime = time;
      value.tool.endTime =
        time === "23:00"
          ? "23:59"
          : String(Number(time.slice(0, 2)) + 1).padStart(2, "0") + ":00";
    }
    setEditing(value);
  }
  useEffect(() => {
    if (createRequested) {
      create();
      onCreated();
    }
  }, [createRequested]);
  const open = (n) => {
    setDate(n.tool.date);
    setActiveId(n.id);
  };
  return (
    <section className="collection-view journal-calendar-view">
      <div className="collection-toolbar">
        <label>
          {t("tools.project")}
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">{t("tools.allProjects")}</option>
            {nodes
              .filter((n) => n.type === "project")
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
          </select>
        </label>
        <label className="journal-experience-filter">
          <input
            type="checkbox"
            checked={experienceOnly}
            onChange={(e) => setExperienceOnly(e.target.checked)}
          />
          {t("journal.experiencesOnly")}
        </label>
        <span>{t("tools.entries", entries.length)}</span>
      </div>
      {searchError && (
        <p className="error-banner" role="alert">
          {searchError}
          <button onClick={() => setRetry((n) => n + 1)}>{t("m146")}</button>
        </p>
      )}
      {searching && (
        <p className="journal-loading" role="status">
          <LoaderCircle size={18} className="spin" />
          {t("journal.searching")}
        </p>
      )}
      {searchQuery && !searching && !searchError && (
        <div
          className="calendar-search-results"
          aria-label={t("calendar.searchResults")}
        >
          {entries.length ? (
            entries.map((n) => (
              <button
                key={n.id}
                className="secondary-button"
                onClick={() => open(n)}
              >
                {n.tool.date} · {n.title}
              </button>
            ))
          ) : (
            <p>{t("tools.empty.journal")}</p>
          )}
        </div>
      )}
      <JournalCalendar
        date={date}
        mode={mode}
        entries={entries}
        onDate={setDate}
        onMode={setMode}
        onOpen={(n) => setActiveId(n.id)}
        onCreate={create}
      />
      {active && !editing && (
        <JournalRecordDialog
          node={active}
          error={entryError}
          onRetry={() => setRetry((n) => n + 1)}
          onClose={() => setActiveId("")}
          onEdit={() => setEditing(active)}
          onRefresh={onRefresh}
        >
          {!active.partial && (
            <JournalEntry
              key={active.id}
              autoPreview
              node={active}
              entries={entries}
              settings={settings}
              nodes={nodes}
              onSelect={onSelect}
              onEntry={setActiveId}
            />
          )}
        </JournalRecordDialog>
      )}
      {editing && (
        <ToolEditor
          key={editing.id}
          initial={editing}
          nodes={nodes}
          onClose={() => setEditing(null)}
          onSaved={async (n) => {
            await onRefresh();
            setDate(n.tool.date);
            setActiveId(n.id);
          }}
        />
      )}
    </section>
  );
}
function JournalRecordDialog({
  node,
  children,
  error,
  onRetry,
  onClose,
  onEdit,
  onRefresh,
}) {
  useDialogKeys(React, onClose);
  return (
    <div className="modal-backdrop">
      <section
        className="modal journal-record-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={node.title}
      >
        <header>
          <div>
            <h2>{node.title}</h2>
            <small>
              {node.tool.date}
              {node.tool.endDate && node.tool.endDate !== node.tool.date
                ? " — " + node.tool.endDate
                : ""}
              {node.tool.startTime
                ? " · " + node.tool.startTime + "–" + node.tool.endTime
                : ""}
            </small>
          </div>
          <button
            className="secondary-button"
            disabled={node.partial}
            onClick={onEdit}
          >
            <Pencil size={16} />
            {t("tools.edit.journal")}
          </button>
          <button
            autoFocus
            className="icon-button"
            aria-label={t("calendar.closeEntry")}
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="journal-record-body">
          {error ? (
            <p className="error-banner" role="alert">
              {error}
              <button onClick={onRetry}>{t("m146")}</button>
            </p>
          ) : node.partial ? (
            <p className="journal-loading" role="status">
              <LoaderCircle size={18} className="spin" />
              {t("journal.loadingEntry")}
            </p>
          ) : (
            <>
              <RecordImportance node={node} onSaved={onRefresh} />
              {node.summary && (
                <p className="notebook-summary">{node.summary}</p>
              )}
              {children}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
