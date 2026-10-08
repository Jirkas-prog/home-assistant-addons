import { Select } from "./select.jsx";
import React, { useEffect, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Play,
  FileText,
  BookOpen,
  ClipboardList,
  ListFilter,
  Wrench,
  Download,
  CheckCircle2,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t, locale } from "../shared/i18n.js";
import {
  bomModel,
  cardState,
  matchesToolFilter,
  projectIdFor,
  toolStats,
} from "../shared/tools.js";
import { filterNodes } from "./atlas-model.js";
import { useRecordSearch } from "./use-record.js";
import { localDate } from "./work-model.js";
import { api } from "./client.js";
import { ToolEditor, newTool } from "./tool-editor.jsx";
import { JournalEntry } from "./journal.jsx";
import { journalEntries, journalRange } from "../shared/journal.js";

const tabs = ["journal", "bom", "procedure", "cards", "view"];
const icons = {
  journal: FileText,
  bom: Wrench,
  procedure: ClipboardList,
  cards: BookOpen,
  view: ListFilter,
};
function Notes({ text }) {
  return text ? (
    <div className="markdown tool-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => (
            <span className="image-placeholder">
              {t("m085")} {alt || t("m394")}
            </span>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  ) : null;
}
function useToday() {
  const [date, setDate] = useState(localDate);
  useEffect(() => {
    const timer = setInterval(() => setDate(localDate()), 30000);
    return () => clearInterval(timer);
  }, []);
  return date;
}
function Study({ deck, nodes, today, onRefresh, onSelect }) {
  const [revealed, setRevealed] = useState(false),
    [cursor, setCursor] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(null);
  const due = deck.tool.cards.filter(
      (card) => cardState(deck, card.id, today).ready,
    ),
    card = due.length ? due[cursor % due.length] : null;
  useEffect(() => {
    setRevealed(false);
    pending.current = null;
  }, [card?.id, deck.id]);
  async function review(rating) {
    if (!card) return;
    setBusy(true);
    setError("");
    const signature = deck.id + card.id + rating + today;
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: crypto.randomUUID() };
    try {
      await api(`tools/${deck.id}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          revision: deck.revision,
          operationId: pending.current.id,
          cardId: card.id,
          rating,
          date: today,
        }),
      });
      pending.current = null;
      setRevealed(false);
      setCursor((value) => value + 1);
      await onRefresh();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) await onRefresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="study-panel">
      <div className="tool-section-title">
        <h3>{t("tools.practice")}</h3>
        <span>{t("tools.dueCount", due.length, deck.tool.cards.length)}</span>
      </div>
      {!card ? (
        <div className="tool-empty">
          <CheckCircle2 />
          <h3>{t("tools.studyComplete")}</h3>
          <p>{t("tools.studyCompleteHelp")}</p>
        </div>
      ) : (
        <>
          <p className="tool-overline">{t("tools.question")}</p>
          <Notes text={card.question} />
          {card.sourceId && (
            <button
              className="text-button"
              onClick={() =>
                onSelect(nodes.find((n) => n.id === card.sourceId))
              }
            >
              {t("tools.source")}:{" "}
              {nodes.find((n) => n.id === card.sourceId)?.title ||
                card.sourceId}
              {card.sourcePage ? " · " + card.sourcePage : ""}
            </button>
          )}
          {revealed ? (
            <>
              <div className="study-answer">
                <p className="tool-overline">{t("tools.answer")}</p>
                <Notes text={card.answer} />
              </div>
              <p className="field-help">{t("tools.ratingHelp")}</p>
              <div className="review-actions">
                {["again", "hard", "good", "easy"].map((rating) => (
                  <button
                    disabled={busy}
                    key={rating}
                    className="secondary-button"
                    onClick={() => review(rating)}
                  >
                    {t("tools.rating." + rating)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button
              className="primary-button"
              onClick={() => setRevealed(true)}
            >
              {t("tools.reveal")}
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <details className="tool-history">
        <summary>{t("tools.studySchedule")}</summary>
        <div className="tool-table">
          <table>
            <thead>
              <tr>
                <th>{t("tools.question")}</th>
                <th>{t("tools.nextReview")}</th>
                <th>{t("tools.reviewCount")}</th>
              </tr>
            </thead>
            <tbody>
              {deck.tool.cards.map((card) => {
                const state = cardState(deck, card.id, today);
                return (
                  <tr key={card.id}>
                    <td>{card.question}</td>
                    <td>{state.due}</td>
                    <td>{state.reviewed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
export function WorkTools({
  searchIds,
  searchPending,
  importance = [],
  nodes,
  settings,
  query,
  scope,
  homeId,
  initialProject = "",
  focusId = "",
  onRefresh,
  onSelect,
}) {
  const [tab, setTab] = useState(() => {
    const value = new URLSearchParams(location.search).get("tool");
    return tabs.includes(value) ? value : "journal";
  });
  const [project, setProject] = useState(initialProject),
    [activeId, setActiveId] = useState(
      () => new URLSearchParams(location.search).get("toolId") || focusId,
    ),
    [editing, setEditing] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const today = useToday(),
    pending = useRef(null);
  const [journalFrom, setJournalFrom] = useState(""),
    [journalTo, setJournalTo] = useState("");
  const lastFocus = useRef(null);
  useEffect(() => setProject(initialProject), [initialProject]);
  useEffect(() => {
    const target =
      lastFocus.current === null
        ? new URLSearchParams(location.search).get("toolId") || focusId
        : focusId;
    lastFocus.current = focusId;
    const node = nodes.find((n) => n.id === target);
    if (node?.tool) {
      setTab(node.tool.kind === "run" ? "procedure" : node.tool.kind);
      setActiveId(node.id);
    }
  }, [focusId]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("tool", tab);
    activeId
      ? url.searchParams.set("toolId", activeId)
      : url.searchParams.delete("toolId");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [tab, activeId]);
  const scoped = filterNodes(nodes, {
    searchIds,
    query,
    importance,
    scope: tab === "journal" ? "" : scope,
    locations: settings.locations,
  }).filter(
    (n) =>
      !project ||
      projectIdFor(n, nodes) === project ||
      (n.tool?.kind === "journal" && n.related.includes(project)),
  );
  const entries =
    tab === "journal"
      ? journalEntries(scoped, { from: journalFrom, to: journalTo })
      : scoped
          .filter(
            (n) =>
              n.tool &&
              (n.tool.kind === tab ||
                (tab === "procedure" && n.tool.kind === "run")),
          )
          .sort(
            (a, b) =>
              (b.tool.date || b.updated || "").localeCompare(
                a.tool.date || a.updated || "",
              ) || a.title.localeCompare(b.title, locale()),
          );
  const active = entries.find((n) => n.id === activeId) || entries[0],
    stats = toolStats(scoped, today);
  const projects = nodes.filter((n) => n.type === "project");
  async function action(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) await onRefresh();
    } finally {
      setBusy(false);
    }
  }
  function startRun() {
    const signature = active.id + active.revision + today;
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: crypto.randomUUID() };
    action(async () => {
      const result = await api(`tools/${active.id}/runs`, {
        method: "POST",
        body: JSON.stringify({
          operationId: pending.current.id,
          revision: active.revision,
          date: today,
        }),
      });
      pending.current = null;
      setActiveId(result.id);
    });
  }
  const Icon = icons[tab];
  const viewSearch = useRecordSearch(
    active?.tool.filter?.query || "",
    active?.tool.kind === "view",
    nodes,
  );
  const viewResults =
    active?.tool.kind === "view"
      ? nodes.filter((n) =>
          matchesToolFilter(n, active.tool.filter, nodes, today, (node) =>
            viewSearch.ids?.has(node.id),
          ),
        )
      : [];
  const materials = active?.tool.kind === "bom" ? bomModel(active, nodes) : [];
  return (
    <div className="collection-view tool-workspace">
      <div className="tool-tabs" role="group" aria-label={t("tools.title")}>
        {tabs.map((kind) => {
          const Icon = icons[kind];
          return (
            <button
              key={kind}
              aria-pressed={tab === kind}
              className={tab === kind ? "active" : ""}
              onClick={() => {
                setTab(kind);
                setActiveId("");
                setError("");
              }}
            >
              <Icon size={17} />
              {t("tools.kind." + kind)}
            </button>
          );
        })}
      </div>
      <div className="tool-metrics">
        <div>
          <strong>{stats.journal}</strong>
          <span>{t("tools.journalEntries")}</span>
        </div>
        <div>
          <strong>{stats.minutes}</strong>
          <span>{t("tools.recordedMinutes")}</span>
        </div>
        <div>
          <strong>{stats.due}</strong>
          <span>{t("tools.cardsDue")}</span>
        </div>
        <div>
          <strong>{stats.runs}</strong>
          <span>{t("tools.completedRuns")}</span>
        </div>
      </div>
      <div className="collection-toolbar">
        <label>
          {t("tools.project")}
          <Select
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setActiveId("");
            }}
          >
            <option value="">{t("tools.allProjects")}</option>
            {projects.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </Select>
        </label>
        <span>{t("tools.entries", entries.length)}</span>
        <button
          className="primary-button"
          onClick={() => setEditing(newTool(tab, project, scope || homeId))}
        >
          <Plus size={16} />
          {t("tools.new." + tab)}
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {tab === "journal" && (
        <div className="journal-date-filter">
          <label>
            {t("journal.filterFrom")}
            <input
              type="date"
              value={journalFrom}
              onChange={(e) => setJournalFrom(e.target.value)}
            />
          </label>
          <label>
            {t("journal.filterTo")}
            <input
              type="date"
              min={journalFrom}
              value={journalTo}
              onChange={(e) => setJournalTo(e.target.value)}
            />
          </label>
          <button
            className="text-button"
            onClick={() => {
              setJournalFrom("");
              setJournalTo("");
            }}
          >
            {t("journal.allDates")}
          </button>
          <small>{t("journal.browseHelp")}</small>
        </div>
      )}
      {searchPending ? (
        <p role="status">{t("workspace.searching")}</p>
      ) : !entries.length ? (
        <div className="tool-empty">
          <Icon size={34} />
          <h2>{t("tools.empty." + tab)}</h2>
          <p>{t("tools.help." + tab)}</p>
          <button
            className="secondary-button"
            onClick={() => setEditing(newTool(tab, project, scope || homeId))}
          >
            <Plus size={15} />
            {t("tools.new." + tab)}
          </button>
        </div>
      ) : (
        <div className="tool-layout">
          <nav className="tool-records" aria-label={t("tools.records")}>
            {entries.map((node) => (
              <button
                key={node.id}
                className={active?.id === node.id ? "active" : ""}
                onClick={() => {
                  setActiveId(node.id);
                  setError("");
                }}
              >
                <span className="tool-record-type">
                  {t("tools.kind." + node.tool.kind)}
                </span>
                <strong>{node.title}</strong>
                <small>
                  {(node.tool.kind === "journal"
                    ? `${node.tool.date}${journalRange(node.tool).end !== node.tool.date ? " — " + journalRange(node.tool).end : ""}`
                    : node.tool.date) ||
                    nodes.find((p) => p.id === projectIdFor(node, nodes))
                      ?.title ||
                    t("tools.noProject")}
                </small>
                {node.tool.kind === "run" && (
                  <span className="tool-progress">
                    {node.tool.completed.length}/{node.tool.steps.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <article className="tool-detail">
            <header>
              <div>
                <p className="tool-overline">
                  {t("tools.kind." + active.tool.kind)}
                </p>
                <h2>{active.title}</h2>
                {active.summary && <p>{active.summary}</p>}
              </div>
              <div className="tool-actions">
                {active.tool.kind !== "run" && (
                  <button
                    className="icon-button"
                    aria-label={t("tools.edit")}
                    onClick={() => setEditing(active)}
                  >
                    <Pencil size={17} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={t("tools.openRecord")}
                  onClick={() => onSelect(active)}
                >
                  <FileText size={17} />
                </button>
                <a
                  className="icon-button"
                  title={t("tools.download")}
                  aria-label={t("tools.download")}
                  href={`./api/nodes/${active.id}/markdown`}
                >
                  <Download size={17} />
                </a>
              </div>
            </header>
            {active.tool.kind === "journal" && (
              <JournalEntry
                node={active}
                entries={entries}
                settings={settings}
                nodes={nodes}
                onSelect={onSelect}
                onEntry={setActiveId}
              />
            )}
            {active.tool.kind === "bom" && (
              <>
                <p className="field-help">{t("tools.bomHelp")}</p>
                <p className="tool-meta">
                  {t(
                    active.tool.reserve && active.status !== "done"
                      ? "tools.planned"
                      : "tools.unplanned",
                  )}
                </p>
                <div className="tool-table">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "label",
                          "required",
                          "available",
                          "otherDemand",
                          "free",
                          "shortage",
                        ].map((key) => (
                          <th key={key}>{t("tools." + key)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {materials.map((line) => (
                        <tr key={line.id}>
                          <td>
                            {line.item ? (
                              <button
                                className="text-button"
                                onClick={() => onSelect(line.item)}
                              >
                                {line.label}
                              </button>
                            ) : (
                              line.label
                            )}
                            {line.note && <small>{line.note}</small>}
                          </td>
                          <td>{line.quantity}</td>
                          <td>{line.available}</td>
                          <td>{line.planned}</td>
                          <td>{line.free}</td>
                          <td className={line.shortage ? "tool-shortage" : ""}>
                            {line.shortage}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {materials.some((line) => line.overbooked) && (
                  <p className="tool-warning">{t("tools.overbooked")}</p>
                )}
                <div className="tool-section-title">
                  <h3>{t("tools.shopping")}</h3>
                  <a
                    href={`./api/tools/${active.id}/bom.csv`}
                    className="secondary-button"
                  >
                    <Download size={15} />
                    {t("tools.exportShopping")}
                  </a>
                </div>
                {materials.some((line) => line.shortage) ? (
                  <ul className="shopping-list">
                    {materials
                      .filter((line) => line.shortage)
                      .map((line) => (
                        <li key={line.id}>
                          <span>{line.label}</span>
                          <strong>{line.shortage}</strong>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p>{t("tools.nothingMissing")}</p>
                )}
                <Notes text={active.body} />
              </>
            )}
            {active.tool.kind === "procedure" && (
              <>
                <p className="field-help">{t("tools.templateHelp")}</p>
                <ol className="procedure-steps">
                  {active.tool.steps.map((step) => (
                    <li key={step.id}>{step.label}</li>
                  ))}
                </ol>
                <button
                  disabled={busy}
                  className="primary-button"
                  onClick={startRun}
                >
                  <Play size={16} />
                  {t("tools.startRun")}
                </button>
                <Notes text={active.body} />
                <h3 className="tool-section-title">{t("tools.runHistory")}</h3>
                {nodes
                  .filter(
                    (n) =>
                      n.tool?.kind === "run" && n.tool.sourceId === active.id,
                  )
                  .map((run) => (
                    <button
                      className="tool-result"
                      key={run.id}
                      onClick={() => setActiveId(run.id)}
                    >
                      <span>{run.title}</span>
                      <small>
                        {run.tool.completed.length}/{run.tool.steps.length} ·{" "}
                        {t("tools.status." + run.status)}
                      </small>
                    </button>
                  ))}
              </>
            )}
            {active.tool.kind === "run" && (
              <>
                <p className="field-help">{t("tools.runHelp")}</p>
                <div className="tool-meta">
                  <span>{active.tool.date}</span>
                  <span>
                    {active.tool.completed.length}/{active.tool.steps.length}
                  </span>
                  <span>{t("tools.status." + active.status)}</span>
                </div>
                <div className="run-checklist">
                  {active.tool.steps.map((step) => (
                    <label key={step.id}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={active.tool.completed.includes(step.id)}
                        onChange={(e) =>
                          action(() =>
                            api(`tools/${active.id}/steps`, {
                              method: "POST",
                              body: JSON.stringify({
                                revision: active.revision,
                                stepId: step.id,
                                completed: e.target.checked,
                              }),
                            }),
                          )
                        }
                      />
                      <span>{step.label}</span>
                    </label>
                  ))}
                </div>
                <Notes text={active.body} />
              </>
            )}
            {active.tool.kind === "cards" && (
              <>
                <Study
                  key={active.id}
                  deck={active}
                  nodes={nodes}
                  today={today}
                  onRefresh={onRefresh}
                  onSelect={onSelect}
                />
                <Notes text={active.body} />
              </>
            )}
            {active.tool.kind === "view" && (
              <>
                {(viewSearch.pending || viewSearch.error) && (
                  <p role={viewSearch.error ? "alert" : "status"}>
                    {viewSearch.error || t("workspace.searching")}
                    {viewSearch.error && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={viewSearch.retry}
                      >
                        {t("workspace.retryRead")}
                      </button>
                    )}
                  </p>
                )}
                <p className="field-help">{t("tools.viewHelp")}</p>
                <div className="tool-meta">
                  <span>{t("tools.rule." + active.tool.filter.rule)}</span>
                  <strong>{t("tools.matches", viewResults.length)}</strong>
                </div>
                {viewResults.map((node) => (
                  <button
                    className="tool-result"
                    key={node.id}
                    onClick={() => onSelect(node)}
                  >
                    <span>
                      {node.title}
                      <small>{node.summary}</small>
                    </span>
                    <small>{t("tools.type." + node.type)}</small>
                  </button>
                ))}
                {!viewResults.length &&
                  !viewSearch.pending &&
                  !viewSearch.error && (
                    <p className="tool-empty">{t("tools.noMatches")}</p>
                  )}
                <Notes text={active.body} />
              </>
            )}
          </article>
        </div>
      )}
      {editing && (
        <ToolEditor
          key={editing.id}
          initial={editing}
          nodes={nodes}
          onClose={() => setEditing(null)}
          onSaved={async (node) => {
            setActiveId(node.id);
            await onRefresh();
          }}
        />
      )}
    </div>
  );
}
