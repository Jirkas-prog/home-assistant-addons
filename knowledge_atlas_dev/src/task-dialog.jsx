import { Select } from "./select.jsx";
import React, { useEffect, useRef, useState } from "react";
import {
  Home,
  BookOpen,
  Plus,
  Paperclip,
  MessageSquare,
  Activity,
  Flag,
  X,
  Save,
  Bold,
  Italic,
  List,
  Link2,
} from "lucide-react";
import { t, locale, localizeMessage } from "../shared/i18n.js";
import { api, useDialogKeys } from "./client.js";
import { useDraft, DraftNotice, DraftExit, ConflictReview } from "./drafts.jsx";
import { ImportanceStars } from "./importance.jsx";
import { recordImportance, withImportance } from "../shared/importance.js";
import { CheckpointEditor, UrgencySummary } from "./checkpoints.jsx";
import { checkpoints, taskUrgencies } from "../shared/checkpoints.js";
import { useToday } from "./use-today.js";
import { ResourceEditor, ResourceList } from "./locations.jsx";
import { DocumentViewer } from "./documents.jsx";
import { MarkdownContent } from "./markdown.jsx";
import { columnsFor, columnFor } from "../shared/boards.js";
import { projectForTask } from "../shared/task-workflow.js";
import { projectFor } from "./work-model.js";
import { validateNode } from "../shared/schema.js";
import { descendants } from "./atlas-model.js";
import { RecordOrder } from "./record-list.jsx";
import { useValidationFocus } from "./validation-focus.js";
import "./task-workspace.css";

const TABS = [
  ["details", Home],
  ["attachments", Paperclip],
  ["comments", MessageSquare],
  ["activity", Activity],
  ["checkpoints", Flag],
];
const dateTime = (date) =>
  date ? new Date(date).toLocaleString(locale()) : "";
export function MarkdownEditor({ value, onChange, label }) {
  const input = useRef();
  const [preview, setPreview] = useState(false);
  const insert = (before, after) => {
    const el = input.current;
    if (!el) return;
    const start = el.selectionStart,
      end = el.selectionEnd;
    onChange(
      value.slice(0, start) +
        before +
        value.slice(start, end) +
        after +
        value.slice(end),
    );
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, end + before.length);
    });
  };
  return (
    <section className="task-markdown">
      <div className="task-formatting">
        {[
          [Bold, "**", "**", "task.bold"],
          [Italic, "_", "_", "task.italic"],
          [List, "\n- ", "", "task.list"],
          [Link2, "[", "](https://)", "task.link"],
        ].map(([Icon, a, b, key]) => (
          <button
            key={key}
            type="button"
            className="icon-button"
            disabled={preview}
            aria-label={t(key)}
            title={t(key)}
            onClick={() => insert(a, b)}
          >
            <Icon size={16} />
          </button>
        ))}
        <button
          type="button"
          className="secondary-button"
          onClick={() => setPreview(!preview)}
        >
          {t(preview ? "m400" : "m210")}
        </button>
      </div>
      {preview ? (
        <div className="task-markdown-preview">
          <MarkdownContent>{value}</MarkdownContent>
        </div>
      ) : (
        <textarea
          ref={input}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={9}
        />
      )}
    </section>
  );
}

function Comments({ nodeId, onChanged }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [text, setText] = useState(""),
    [editing, setEditing] = useState(null);
  const draft = useDraft(
    `comment:${nodeId}`,
    { text, editing },
    { id: nodeId },
    !!text,
  );
  const load = async (page = 0) => {
    const next = await api(`tasks/${nodeId}/comments?page=${page}`);
    if (page && data?.revision !== next.revision) return load();
    setData((old) =>
      page && old?.revision === next.revision
        ? { ...next, entries: [...old.entries, ...next.entries] }
        : next,
    );
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [nodeId]);
  async function save(patch) {
    if (busy || draft.available) return;
    setBusy(true);
    setError("");
    try {
      await api(`tasks/${nodeId}/comments`, {
        method: "POST",
        body: JSON.stringify({ ...patch, revision: data.revision }),
      });
      if (patch.body !== undefined) {
        setText("");
        setEditing(null);
        draft.clear();
      }
      await load();
      await onChanged();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="task-comments">
      <DraftNotice
        draft={draft}
        onRecover={(saved) => {
          setText(saved.value.text);
          setEditing(saved.value.editing);
        }}
      />
      <fieldset className="draft-fields" disabled={!!draft.available || busy}>
        <MarkdownEditor
          value={text}
          onChange={setText}
          label={t("task.comment")}
        />
        <div className="data-actions">
          <button
            type="button"
            className="primary-button"
            disabled={busy || !data || !text.trim()}
            onClick={() => save({ id: editing, body: text })}
          >
            {t(editing ? "task.saveComment" : "task.addComment")}
          </button>
          {editing && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setEditing(null);
                setText("");
                draft.clear();
              }}
            >
              {t("conflict.cancel")}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        {data?.entries.map((c) => (
          <article className="task-comment" key={c.id}>
            <small>
              {dateTime(c.created)}
              {c.updated !== c.created &&
                ` · ${t("task.edited")} ${dateTime(c.updated)}`}
            </small>
            {c.deleted ? (
              <p>{t("task.deletedComment")}</p>
            ) : (
              <MarkdownContent>{c.body}</MarkdownContent>
            )}
            <div className="data-actions">
              {!c.deleted && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(c.id);
                    setText(c.body);
                  }}
                >
                  {t("task.edit")}
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => save({ id: c.id, deleted: !c.deleted })}
              >
                {t(c.deleted ? "task.restoreComment" : "task.deleteComment")}
              </button>
            </div>
          </article>
        ))}
        {data?.next != null && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => load(data.next).catch((e) => setError(e.message))}
          >
            {t("task.more")}
          </button>
        )}
        {data && !data.total && (
          <p className="task-empty">{t("task.noComments")}</p>
        )}
      </fieldset>
    </section>
  );
}
function ActivityFeed({ nodeId }) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  const load = async (before = "") => {
    const next = await api(
      `tasks/${nodeId}/activity?before=${encodeURIComponent(before)}`,
    );
    setData((old) => ({
      ...next,
      entries: before ? [...old.entries, ...next.entries] : next.entries,
    }));
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [nodeId]);
  return (
    <section className="task-activity">
      {error && <p role="alert">{error}</p>}
      {data?.entries.map((e) => (
        <article key={e.id}>
          <Activity size={17} />
          <div>
            <strong>{t(`task.event.${e.source}`)}</strong>
            <p>
              {e.fields
                .map((f) =>
                  t(`task.field.${f}`) === `task.field.${f}`
                    ? f
                    : t(`task.field.${f}`),
                )
                .join(", ")}
            </p>
          </div>
          <time dateTime={e.at}>{dateTime(e.at)}</time>
        </article>
      ))}
      {data && !data.entries.length && (
        <p className="task-empty">{t("task.noActivity")}</p>
      )}
      {data?.next && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => load(data.next).catch((e) => setError(e.message))}
        >
          {t("task.more")}
        </button>
      )}
    </section>
  );
}

export default function TaskDialog({
  initial,
  nodes,
  settings,
  env = {},
  orderRevision,
  onManage,
  onClose,
  onRefresh,
  onJournal,
  onSave,
}) {
  const { _tab, ...initialValue } = initial;
  const [form, setForm] = useState(initialValue),
    [original, setOriginal] = useState(initialValue),
    [tab, setTab] = useState(_tab || "details");
  const titleInput = useRef();
  const focusError = useValidationFocus("task", setTab);
  const [loading, setLoading] = useState(!!initial.partial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [dirty, setDirty] = useState(false),
    [leaving, setLeaving] = useState(false),
    [conflict, setConflict] = useState(null),
    [document, setDocument] = useState(null),
    [project, setProject] = useState(null),
    [createdProjects, setCreatedProjects] = useState([]),
    [projectName, setProjectName] = useState(null),
    [creatingProject, setCreatingProject] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const draft = useDraft(
    `record:${initial.id || "new"}`,
    form,
    original,
    dirty,
  );
  const close = () => {
    if (busy || creatingProject) return;
    if (dirty) setLeaving(true);
    else onClose();
  };
  useDialogKeys(React, close);
  useEffect(() => {
    if (!loading && !draft.available && !_tab) titleInput.current?.focus();
  }, [loading, !!draft.available]);
  useEffect(() => {
    if (!initial.partial) return;
    const abort = new AbortController();
    api(`nodes/${initial.id}`, { signal: abort.signal })
      .then((n) => {
        setForm(n);
        setOriginal(n);
        setLoading(false);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [initial.id]);
  const projectNodes = [
    ...nodes,
    ...createdProjects.filter((n) => !nodes.some((old) => old.id === n.id)),
  ];
  const owner = projectFor(form, projectNodes)?.id;
  useEffect(() => {
    setProject(null);
    if (!owner) return;
    let live = true;
    api(`nodes/${owner}`)
      .then((n) => {
        if (live) setProject(n);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [owner]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const set = (key, value) => {
    setDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
    setConfirmed(false);
  };
  const columns = columnsFor(project),
    currentColumn = columnFor(form, columns);
  const points = checkpoints(form),
    today = useToday();
  const urgency = taskUrgencies(
    [...nodes.filter((n) => n.type === "task" && n.id !== form.id), form],
    today,
  ).get(form.id);
  const excluded = descendants(nodes, form.id);
  async function save(toJournal = false) {
    if (busy || creatingProject || loading || draft.available) return;
    setBusy(true);
    setError("");
    try {
      if (
        form.status === "done" &&
        original.status !== "done" &&
        points.some((p) => !p.done) &&
        !confirmed
      ) {
        setError(t("task.incomplete"));
        return;
      }
      const value = {
        ...withImportance(form, recordImportance(form)),
        id: form.id || crypto.randomUUID(),
        schema: 2,
        tags: form.tags.filter(Boolean),
        resources: form.resources.map((r) => ({
          ...r,
          id: r.id || crypto.randomUUID(),
        })),
      };
      validateNode(value);
      const n = await onSave(value);
      setForm(n);
      setOriginal(n);
      setDirty(false);
      draft.clear();
      if (toJournal) onJournal(n);
    } catch (e) {
      setError(localizeMessage(e.message));
      focusError(e);
      if (e.status === 409 && form.id)
        setConflict(await api(`nodes/${form.id}`).catch(() => null));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal task-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("task.card")}
      >
        <header>
          <div>
            <h2>{form.title || t("m255")}</h2>
            {form.created && (
              <small>
                {t("task.created")} {dateTime(form.created)}
                {form.updated &&
                  ` · ${t("task.updated")} ${dateTime(form.updated)}`}
              </small>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("m188")}
            onClick={close}
            disabled={busy}
          >
            <X />
          </button>
        </header>
        <div className="task-pinned">
          <div className="task-rating">
            <span>{t("importance.label")}</span>
            <ImportanceStars
              value={recordImportance(form)}
              disabled={busy || loading || !!draft.available}
              onChange={(v) => set("importance", v)}
            />
          </div>
          <div className="task-locations">
            {form.resources
              .filter(
                (r) =>
                  settings.locations.find((l) => l.id === r.locationId)
                    ?.kind === "physical",
              )
              .map((r, i) => (
                <span key={r.id || i}>
                  {settings.locations.find((l) => l.id === r.locationId)?.name}:{" "}
                  {r.path}
                </span>
              ))}
            <button type="button" onClick={() => setTab("attachments")}>
              {form.resources.find((r) => r.id === form.previewResourceId)
                ?.label || t("documents.recordMarkdown")}{" "}
              · {t("task.attachments")}
            </button>
          </div>
        </div>
        <div className="task-tabs" role="tablist" aria-label={t("task.card")}>
          {TABS.map(([name, Icon], index) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === name}
              aria-controls={`task-panel-${name}`}
              id={`task-tab-${name}`}
              tabIndex={tab === name ? 0 : -1}
              key={name}
              onClick={() => setTab(name)}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                  return;
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? 4
                      : (index + (e.key === "ArrowRight" ? 1 : 4)) % 5;
                setTab(TABS[next][0]);
                e.currentTarget.parentElement.children[next].focus();
              }}
            >
              <Icon size={20} />
              <span>
                {t(`task.${name}`)}
                {name === "checkpoints" &&
                  ` ${points.filter((p) => p.done).length}/${points.length}`}
                {name === "attachments" && ` ${form.resources.length}`}
              </span>
            </button>
          ))}
        </div>
        <div className="task-dialog-body">
          {leaving && (
            <DraftExit
              failed={draft.state === "failed"}
              onLeave={onClose}
              onStay={() => setLeaving(false)}
            />
          )}
          <DraftNotice
            draft={draft}
            onRecover={(s) => {
              setForm(s.value);
              setOriginal(s.original);
              setDirty(true);
            }}
          />
          {conflict && (
            <ConflictReview
              base={original}
              mine={form}
              current={conflict}
              onCancel={() => setConflict(null)}
              onApply={(next) => {
                setForm(next);
                setOriginal(conflict);
                setConflict(null);
                setDirty(true);
                setError("");
              }}
            />
          )}
          {error && (
            <p role="alert" className="error-banner" tabIndex={-1}>
              {error}
            </p>
          )}
          {loading ? (
            <p role="status">{t("m148")}</p>
          ) : (
            <fieldset
              className="draft-fields"
              disabled={busy || creatingProject || !!draft.available}
              data-field={
                tab === "checkpoints"
                  ? "task.checkpoints"
                  : tab === "attachments"
                    ? "resources"
                    : undefined
              }
              role="tabpanel"
              id={`task-panel-${tab}`}
              aria-labelledby={`task-tab-${tab}`}
            >
              {tab === "details" && (
                <div className="task-details">
                  <label>
                    {t("m189")}
                    <input
                      ref={titleInput}
                      data-field="title"
                      value={form.title}
                      maxLength={180}
                      onChange={(e) => set("title", e.target.value)}
                    />
                  </label>
                  <div className="form-grid">
                    <div className="task-project-field">
                      <label>
                        {t("m199")}
                        <Select
                          value={form.projectId || ""}
                          onChange={(e) => set("projectId", e.target.value)}
                        >
                          <option value="">{t("m200")}</option>
                          {projectNodes
                            .filter((n) => n.type === "project")
                            .map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.title}
                              </option>
                            ))}
                        </Select>
                      </label>
                      {projectName === null ? (
                        <button
                          type="button"
                          className="task-project-new"
                          onClick={() => setProjectName("")}
                        >
                          <Plus size={14} />
                          {t("tasks.newProject")}
                        </button>
                      ) : (
                        <div className="task-project-create">
                          <input
                            autoFocus
                            aria-label={t("tasks.projectName")}
                            placeholder={t("tasks.projectName")}
                            maxLength={180}
                            value={projectName}
                            disabled={creatingProject}
                            onChange={(e) => setProjectName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                e.currentTarget.parentElement
                                  .querySelector("button")
                                  .click();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={!projectName.trim() || creatingProject}
                            onClick={async () => {
                              setCreatingProject(true);
                              setError("");
                              try {
                                const parent = projectNodes.find(
                                  (n) => n.id === form.parent,
                                );
                                const value = projectForTask(projectName, {
                                  id: crypto.randomUUID(),
                                  parent:
                                    parent?.type === "project" ||
                                    parent?.type === "task"
                                      ? parent.parent
                                      : form.parent,
                                  color: form.color,
                                });
                                const created = await api("nodes", {
                                  method: "POST",
                                  body: JSON.stringify(value),
                                });
                                setCreatedProjects((old) => [...old, created]);
                                setForm((old) => ({
                                  ...old,
                                  projectId: created.id,
                                  parent: created.id,
                                }));
                                setDirty(true);
                                setProjectName(null);
                                await onRefresh();
                              } catch (e) {
                                setError(e.message);
                              } finally {
                                setCreatingProject(false);
                              }
                            }}
                          >
                            {t("tasks.createProject")}
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={t("m188")}
                            disabled={creatingProject}
                            onClick={() => setProjectName(null)}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                    <label>
                      {t("board.column")}
                      <Select
                        value={currentColumn?.id || ""}
                        onChange={(e) => {
                          const c = columns.find(
                            (c) => c.id === e.target.value,
                          );
                          setDirty(true);
                          setConfirmed(false);
                          setForm((f) => ({
                            ...f,
                            status: c.status,
                            task: { ...f.task, columnId: c.id },
                          }));
                        }}
                      >
                        {columns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name || t(c.key)}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </div>
                  {form.task?.columnId &&
                    form.task.columnId !== currentColumn?.id && (
                      <p className="field-help">{t("board.fallback")}</p>
                    )}
                  <label>
                    {t("m205")}
                    <input
                      data-field="tags"
                      value={form.tags.join(", ")}
                      onChange={(e) =>
                        set(
                          "tags",
                          e.target.value.split(",").map((s) => s.trim()),
                        )
                      }
                    />
                  </label>
                  <div className="form-grid">
                    {["start", "due"].map((field, i) => (
                      <label key={field}>
                        {t(i ? "m195" : "m194")}
                        <input
                          type="date"
                          data-field={`task.${field}`}
                          value={form.task?.[field] || ""}
                          onChange={(e) =>
                            set("task", {
                              ...form.task,
                              [field]: e.target.value,
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    {t("m197")}
                    <input
                      value={form.task?.assignee || ""}
                      maxLength={120}
                      onChange={(e) =>
                        set("task", { ...form.task, assignee: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t("m203")}
                    <textarea
                      rows={2}
                      data-field="summary"
                      value={form.summary}
                      maxLength={2000}
                      onChange={(e) => set("summary", e.target.value)}
                    />
                  </label>
                  <label>{t("m209")}</label>
                  <MarkdownEditor
                    value={form.body}
                    onChange={(v) => set("body", v)}
                    label={t("m211")}
                  />
                  <details>
                    <summary>{t("task.organization")}</summary>
                    <label>
                      {t("m201")}
                      <Select
                        value={form.parent || ""}
                        onChange={(e) => set("parent", e.target.value || null)}
                      >
                        <option value="">{t("m202")}</option>
                        {nodes
                          .filter((n) => !excluded.has(n.id))
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.title}
                            </option>
                          ))}
                      </Select>
                    </label>
                    <label>
                      {t("list.recordDate")}
                      <input
                        type="date"
                        value={form.date || ""}
                        onChange={(e) => set("date", e.target.value)}
                      />
                    </label>
                    <div className="related-picker">
                      {nodes
                        .filter((n) => n.id !== form.id)
                        .map((n) => (
                          <label key={n.id}>
                            <input
                              type="checkbox"
                              checked={form.related.includes(n.id)}
                              onChange={(e) =>
                                set(
                                  "related",
                                  e.target.checked
                                    ? [...form.related, n.id]
                                    : form.related.filter((id) => id !== n.id),
                                )
                              }
                            />
                            {n.title}
                          </label>
                        ))}
                    </div>
                    {form.id && (
                      <RecordOrder
                        node={nodes.find((n) => n.id === form.id) || form}
                        count={nodes.length}
                        revision={orderRevision}
                        onSaved={onRefresh}
                      />
                    )}
                  </details>
                </div>
              )}
              {tab === "attachments" && (
                <>
                  <p className="field-help">{t("task.attachmentsHelp")}</p>
                  {form.id && (
                    <ResourceList
                      node={{
                        ...form,
                        resources: form.resources.filter((r) =>
                          original.resources.some((o) => o.id === r.id),
                        ),
                      }}
                      settings={settings}
                      env={env}
                      onDocument={setDocument}
                      notify={setError}
                    />
                  )}
                  <ResourceEditor
                    resources={form.resources}
                    settings={settings}
                    onManage={onManage}
                    onChange={(resources) => {
                      setDirty(true);
                      setForm((f) => ({
                        ...f,
                        resources,
                        previewResourceId: resources.some(
                          (r) => r.id === f.previewResourceId,
                        )
                          ? f.previewResourceId
                          : "",
                      }));
                    }}
                  />
                  <label>
                    {t("documents.doubleClick")}
                    <Select
                      value={form.previewResourceId || ""}
                      onChange={(e) => set("previewResourceId", e.target.value)}
                    >
                      <option value="">{t("documents.recordMarkdown")}</option>
                      {form.resources
                        .filter(
                          (r) =>
                            r.id &&
                            settings.locations.find(
                              (l) => l.id === r.locationId,
                            )?.kind !== "physical",
                        )
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                    </Select>
                  </label>
                </>
              )}
              {tab === "checkpoints" && (
                <>
                  {urgency && <UrgencySummary urgency={urgency} />}
                  <CheckpointEditor
                    node={form}
                    onChange={(points) =>
                      set("task", { ...form.task, checkpoints: points })
                    }
                  />
                </>
              )}
              {tab === "comments" &&
                (form.id ? (
                  <Comments nodeId={form.id} onChanged={onRefresh} />
                ) : (
                  <p>{t("task.saveFirst")}</p>
                ))}
              {tab === "activity" &&
                (form.id ? (
                  <ActivityFeed nodeId={form.id} />
                ) : (
                  <p>{t("task.saveFirst")}</p>
                ))}
            </fieldset>
          )}
        </div>
        <footer>
          {form.status === "done" &&
            original.status !== "done" &&
            points.some((p) => !p.done) && (
              <label className="task-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {t("task.confirmIncomplete")}
              </label>
            )}
          <button
            type="button"
            className="secondary-button"
            disabled={loading || busy || creatingProject || !!draft.available}
            onClick={() => (dirty || !form.id ? save(true) : onJournal(form))}
          >
            <BookOpen size={16} />
            {t(
              dirty || !form.id ? "tasks.saveAndJournal" : "tasks.writeJournal",
            )}
          </button>
          <span role="status">
            {dirty
              ? t("task.unsaved")
              : t(form.id ? "task.saved" : "task.notSaved")}
          </span>
          <button
            className="primary-button"
            type="button"
            disabled={
              loading ||
              busy ||
              creatingProject ||
              !!draft.available ||
              (!dirty && !!form.id)
            }
            onClick={() => save()}
          >
            <Save size={16} />
            {t("task.save")}
          </button>
        </footer>
        {document && (
          <DocumentViewer
            resource={document}
            onClose={() => setDocument(null)}
          />
        )}
      </section>
    </div>
  );
}
