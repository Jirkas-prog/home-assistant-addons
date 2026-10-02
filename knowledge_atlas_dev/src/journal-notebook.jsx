import React, { useMemo, useState, useEffect } from "react";
import { BookOpen, Plus, Pencil } from "lucide-react";
import { t, locale } from "../shared/i18n.js";
import {
  journalEntries,
  journalGroups,
  journalRange,
} from "../shared/journal.js";
import { filterNodes } from "./atlas-model.js";
import { JournalEntry } from "./journal.jsx";
import { ToolEditor, newTool } from "./tool-editor.jsx";
import { RecordImportance } from "./importance.jsx";

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
  const [grouping, setGrouping] = useState("month"),
    [activeId, setActiveId] = useState(""),
    [editing, setEditing] = useState(null),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [project, setProject] = useState(""),
    [experienceOnly, setExperienceOnly] = useState(false);
  const entries = useMemo(
    () =>
      journalEntries(
        filterNodes(nodes, {
          query,
          scope,
          importance,
          type: experienceOnly ? "experience" : "all",
          locations: settings.locations,
        }).filter(
          (n) =>
            !project || n.projectId === project || n.related.includes(project),
        ),
        { from, to },
      ),
    [
      nodes,
      query,
      scope,
      importance,
      settings,
      experienceOnly,
      from,
      to,
      project,
    ],
  );
  useEffect(() => {
    if (focusId) setActiveId(focusId);
  }, [focusId]);
  const active = entries.find((n) => n.id === activeId) || entries[0];
  const groups = journalGroups(entries, grouping);
  const date = (value) =>
    new Intl.DateTimeFormat(locale(), {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(value + "T12:00:00Z"));
  function create() {
    setEditing(newTool("journal", project, scope || homeId));
  }
  useEffect(() => {
    if (createRequested) {
      create();
      onCreated();
    }
  }, [createRequested]);
  return (
    <section className="collection-view journal-notebook">
      <div className="collection-toolbar">
        <label>
          {t("journal.groupBy")}
          <select
            value={grouping}
            onChange={(e) => setGrouping(e.target.value)}
          >
            {["day", "week", "month"].map((p) => (
              <option key={p} value={p}>
                {t(`journal.group.${p}`)}
              </option>
            ))}
          </select>
        </label>
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
        <button className="primary-button" onClick={create}>
          <Plus size={16} />
          {t("tools.new.journal")}
        </button>
      </div>
      <div className="journal-date-filter">
        <label>
          {t("journal.filterFrom")}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          {t("journal.filterTo")}
          <input
            type="date"
            min={from}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="text-button"
          onClick={() => {
            setFrom("");
            setTo("");
          }}
        >
          {t("journal.allDates")}
        </button>
        <span>{t("tools.entries", entries.length)}</span>
      </div>
      {!active ? (
        <div className="tool-empty">
          <BookOpen size={34} />
          <h2>{t("tools.empty.journal")}</h2>
          <p>{t("journal.emptyHelp")}</p>
          <button className="secondary-button" onClick={create}>
            {t("tools.new.journal")}
          </button>
        </div>
      ) : (
        <div className="notebook-spread">
          <nav className="notebook-index" aria-label={t("journal.contents")}>
            {groups.map((group) => (
              <section key={group.start}>
                <h3>
                  {grouping === "month"
                    ? new Intl.DateTimeFormat(locale(), {
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      }).format(new Date(group.start + "T12:00:00Z"))
                    : date(group.start)}
                  {grouping === "week" ? ` — ${date(group.end)}` : ""}
                </h3>
                {group.entries.map((n) => (
                  <button
                    key={n.id}
                    aria-current={n.id === active.id ? "page" : undefined}
                    onClick={() => setActiveId(n.id)}
                  >
                    <small>
                      {date(n.tool.date)}
                      {journalRange(n.tool).end !== n.tool.date
                        ? ` — ${date(journalRange(n.tool).end)}`
                        : ""}
                    </small>
                    <strong>{n.title}</strong>
                    {n.tool.experience && (
                      <span className="notebook-badge">
                        {t("journal.experience")}
                      </span>
                    )}
                  </button>
                ))}
              </section>
            ))}
          </nav>
          <article className="notebook-page" key={active.id}>
            <header>
              <div>
                <small>
                  {t(`journal.period.${active.tool.period || "day"}`)}
                </small>
                <h2>{active.title}</h2>
                {active.tool.experience && (
                  <span className="notebook-badge">
                    {t("journal.experience")}
                  </span>
                )}
              </div>
              <button
                className="secondary-button"
                onClick={() => setEditing(active)}
              >
                <Pencil size={15} />
                {t("tools.edit.journal")}
              </button>
            </header>
            <RecordImportance node={active} onSaved={onRefresh} />
            {active.summary && (
              <p className="notebook-summary">{active.summary}</p>
            )}
            <JournalEntry
              node={active}
              entries={entries}
              settings={settings}
              nodes={nodes}
              onSelect={onSelect}
              onEntry={setActiveId}
            />
          </article>
        </div>
      )}
      {editing && (
        <ToolEditor
          key={editing.id}
          initial={editing}
          nodes={nodes}
          onClose={() => setEditing(null)}
          onSaved={async (n) => {
            await onRefresh();
            setActiveId(n.id);
          }}
        />
      )}
    </section>
  );
}
