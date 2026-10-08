import { Select } from "./select.jsx";
import React, { useState, useEffect, useRef } from "react";
import {
  Plus,
  Trash2,
  X,
  Check,
  LoaderCircle,
  BookOpen,
  Tag,
  Paperclip,
  Link2,
  MapPin,
} from "lucide-react";
import { t } from "../shared/i18n.js";
import { validateNode } from "../shared/schema.js";
import { VIEW_RULES } from "../shared/tools.js";
import { JOURNAL_STARTERS, startJournal } from "../shared/journal-starters.js";
import { api, useDialogKeys } from "./client.js";
import { useDraft, DraftNotice, DraftExit, ConflictReview } from "./drafts.jsx";
import { localDate } from "./work-model.js";
import { ImportanceStars } from "./importance.jsx";
import { recordImportance } from "../shared/importance.js";
import { JournalFields } from "./journal.jsx";
import { useValidationFocus, validationMessage } from "./validation-focus.js";
import "./task-workspace.css";

const uid = () => crypto.randomUUID();
const JOURNAL_TABS = [
  ["entry", BookOpen],
  ["organization", Tag],
  ["attachments", Paperclip],
  ["links", Link2],
  ["places", MapPin],
];
export function newTool(kind, projectId, parent) {
  const tool = { schema: 1, kind };
  if (kind === "journal")
    Object.assign(tool, {
      date: localDate(),
      endDate: localDate(),
      period: "day",
      places: [],
      minutes: 0,
      next: "",
    });
  if (kind === "bom")
    Object.assign(tool, {
      reserve: false,
      lines: [{ id: uid(), label: "", itemId: "", quantity: 1, note: "" }],
    });
  if (kind === "procedure") tool.steps = [{ id: uid(), label: "" }];
  if (kind === "cards")
    Object.assign(tool, {
      cards: [
        { id: uid(), question: "", answer: "", sourceId: "", sourcePage: "" },
      ],
      reviews: [],
    });
  if (kind === "view")
    tool.filter = {
      rule: "all",
      type: "all",
      status: "all",
      projectId: projectId || "",
      tag: "",
      query: "",
    };
  return {
    schema: 2,
    id: uid(),
    title: "",
    type: "knowledge",
    status: "active",
    parent: projectId || parent || null,
    projectId: projectId || "",
    summary: "",
    color: "#b0ef88",
    tags: [],
    related: [],
    resources: [],
    body: "",
    tool,
  };
}
export function ToolEditor({ initial, nodes, onClose, onSaved }) {
  const titleInput = useRef();
  const [form, setForm] = useState(() => structuredClone(initial)),
    [base, setBase] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [leaving, setLeaving] = useState(false),
    [conflict, setConflict] = useState(null),
    [journalTab, setJournalTab] = useState("entry");
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const draft = useDraft(
    `v3:${initial.revision ? initial.id : "new-" + initial.tool.kind + "-" + (initial.projectId || "")}`,
    form,
    base,
    dirty,
  );
  const close = () => {
    if (!busy) dirty ? setLeaving(true) : onClose();
  };
  useDialogKeys(React, close);
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const toolSet = (key, value) =>
    setForm((old) => ({ ...old, tool: { ...old.tool, [key]: value } }));
  const updateRow = (field, id, key, value) =>
    toolSet(
      field,
      form.tool[field].map((row) =>
        row.id === id ? { ...row, [key]: value } : row,
      ),
    );
  const remove = (field, id) =>
    toolSet(
      field,
      form.tool[field].filter((row) => row.id !== id),
    );
  const kind = form.tool.kind;
  const focusError = useValidationFocus(kind, setJournalTab);
  useEffect(() => {
    if (!draft.available) titleInput.current?.focus();
  }, [!!draft.available]);
  const Panel = kind === "journal" ? "div" : React.Fragment;
  async function save(event) {
    event.preventDefault();
    if (busy || draft.available) return;
    setBusy(true);
    setError("");
    try {
      const value = { ...form, tags: form.tags.filter(Boolean) };
      validateNode(value);
      const result = await api(base.revision ? `nodes/${base.id}` : "nodes", {
        method: base.revision ? "PUT" : "POST",
        body: JSON.stringify({ ...value, revision: base.revision }),
      });
      draft.clear();
      await onSaved(result);
      onClose();
    } catch (e) {
      setError(validationMessage(e));
      focusError(e);
      if (e.status === 409 && base.revision) {
        try {
          setConflict(await api(`nodes/${base.id}`));
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }
  const projects = nodes.filter((n) => n.type === "project"),
    items = nodes.filter((n) => n.type === "item");
  return (
    <div className="modal-backdrop">
      <form
        className={`modal editor tool-editor ${kind === "journal" ? "journal-editor" : ""}`}
        data-cat-context={
          kind === "journal"
            ? journalTab === "attachments"
              ? "attachments"
              : "journal"
            : "editor"
        }
        noValidate={kind === "journal"}
        role="dialog"
        aria-modal="true"
        aria-label={t(
          `${initial.revision ? "tools.edit." : "tools.new."}${kind}`,
        )}
        onSubmit={save}
      >
        <header>
          <h2>
            {t(`${initial.revision ? "tools.edit." : "tools.new."}${kind}`)}
          </h2>
          <button
            className="icon-button"
            type="button"
            aria-label={t("m188")}
            onClick={close}
            disabled={busy}
          >
            <X />
          </button>
        </header>
        {kind === "journal" && (
          <div
            className="task-tabs journal-editor-tabs"
            role="tablist"
            aria-label={t("journal.editTabs")}
          >
            {JOURNAL_TABS.map(([name, Icon], index) => (
              <button
                type="button"
                role="tab"
                id={`journal-tab-${name}`}
                aria-controls={`journal-panel-${name}`}
                aria-selected={journalTab === name}
                tabIndex={journalTab === name ? 0 : -1}
                key={name}
                onClick={() => setJournalTab(name)}
                onKeyDown={(e) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  const next =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 4
                        : (index + (e.key === "ArrowRight" ? 1 : 4)) % 5;
                  setJournalTab(JOURNAL_TABS[next][0]);
                  e.currentTarget.parentElement.children[next].focus();
                }}
              >
                <Icon size={20} />
                <span>
                  {t(`journal.tab.${name}`)}
                  {name === "attachments" && ` ${form.resources.length}`}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="editor-body">
          {kind === "journal" &&
            !initial.revision &&
            nodes
              .filter((n) => n.type === "task" && form.related.includes(n.id))
              .map((n) => (
                <p className="field-help" key={n.id}>
                  {t("tasks.linkedTask", n.title)}
                </p>
              ))}
          {leaving && (
            <DraftExit
              failed={draft.state === "failed"}
              onStay={() => setLeaving(false)}
              onLeave={onClose}
            />
          )}
          <DraftNotice
            draft={draft}
            onRecover={(saved) => {
              setForm(saved.value);
              setBase(saved.original);
            }}
          />
          {conflict && (
            <ConflictReview
              base={base}
              mine={form}
              current={conflict}
              onCancel={() => setConflict(null)}
              onApply={(merged) => {
                setForm({
                  ...merged,
                  id: base.id,
                  revision: conflict.revision,
                });
                setBase(conflict);
                setConflict(null);
                setError("");
              }}
            />
          )}
          {error && (
            <div className="error-banner" role="alert" tabIndex={-1}>
              {error}
            </div>
          )}
          <fieldset
            className="draft-fields"
            disabled={!!draft.available || busy}
          >
            <div className="importance-field">
              <span>{t("importance.label")}</span>
              <ImportanceStars
                value={recordImportance(form)}
                onChange={(value) => set("importance", value)}
              />
            </div>
            <Panel
              {...(kind === "journal"
                ? {
                    role: "tabpanel",
                    id: `journal-panel-${journalTab}`,
                    "aria-labelledby": `journal-tab-${journalTab}`,
                    "data-field":
                      journalTab === "attachments"
                        ? "resources"
                        : journalTab === "links"
                          ? "related"
                          : undefined,
                  }
                : {})}
            >
              {(kind !== "journal" || journalTab === "entry") && (
                <label>
                  {t("m189")}
                  <input
                    required
                    ref={titleInput}
                    data-field="title"
                    maxLength={180}
                    value={form.title}
                    onChange={(e) => set("title", e.target.value)}
                  />
                </label>
              )}
              {kind === "journal" && journalTab === "entry" && (
                <>
                  <label className="tool-notes journal-entry-text">
                    {t("journal.entryText")}
                    <textarea
                      rows={7}
                      value={form.body}
                      maxLength={1_000_000}
                      placeholder={t("journal.writePlaceholder")}
                      onChange={(e) => set("body", e.target.value)}
                    />
                  </label>
                  {!initial.revision && !form.body.trim() && (
                    <div
                      className="journal-starters"
                      role="group"
                      aria-label={t("journal.starter.label")}
                    >
                      <span>{t("journal.starter.label")}</span>
                      {JOURNAL_STARTERS.map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          title={t(`journal.starter.${kind}Help`)}
                          onClick={() => {
                            setForm((old) => startJournal(old, kind, t));
                            titleInput.current
                              ?.closest('[role="tabpanel"]')
                              ?.querySelector("textarea")
                              ?.focus();
                          }}
                        >
                          {t(`journal.starter.${kind}`)}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {(kind !== "journal" || journalTab === "organization") && (
                <>
                  <div className="form-grid">
                    <label>
                      {t("tools.project")}
                      <Select
                        value={form.projectId || ""}
                        onChange={(e) => {
                          const projectId = e.target.value;
                          setForm((old) => ({
                            ...old,
                            projectId,
                            parent:
                              projectId ||
                              (old.parent === old.projectId
                                ? null
                                : old.parent),
                          }));
                        }}
                      >
                        <option value="">{t("tools.noProject")}</option>
                        {projects.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.title}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label>
                      {t("tools.status")}
                      <Select
                        value={form.status}
                        onChange={(e) => set("status", e.target.value)}
                      >
                        {["draft", "active", "learning", "done"].map(
                          (status) => (
                            <option key={status} value={status}>
                              {t("tools.status." + status)}
                            </option>
                          ),
                        )}
                      </Select>
                    </label>
                  </div>
                  <label>
                    {t("tools.summary")}
                    <input
                      maxLength={2000}
                      data-field="summary"
                      value={form.summary}
                      onChange={(e) => set("summary", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("tools.tags")}
                    <input
                      data-field="tags"
                      value={form.tags.join(", ")}
                      onChange={(e) =>
                        set(
                          "tags",
                          e.target.value.split(",").map((x) => x.trim()),
                        )
                      }
                    />
                  </label>
                </>
              )}
              {kind === "journal" && (
                <JournalFields
                  part={journalTab}
                  form={form}
                  setForm={setForm}
                  nodes={nodes}
                  busy={busy}
                  onBusy={setBusy}
                />
              )}
              {kind === "bom" && (
                <>
                  <label className="tool-check">
                    <input
                      type="checkbox"
                      checked={form.tool.reserve}
                      onChange={(e) => toolSet("reserve", e.target.checked)}
                    />
                    {t("tools.reserve")}
                  </label>
                  <p className="field-help">{t("tools.reserveHelp")}</p>
                  {form.tool.lines.map((line, index) => (
                    <fieldset className="tool-row-editor" key={line.id}>
                      <legend>{t("tools.line", index + 1)}</legend>
                      <div className="form-grid">
                        <label>
                          {t("tools.inventoryItem")}
                          <Select
                            value={line.itemId}
                            onChange={(e) => {
                              const item = items.find(
                                (n) => n.id === e.target.value,
                              );
                              toolSet(
                                "lines",
                                form.tool.lines.map((row) =>
                                  row.id === line.id
                                    ? {
                                        ...row,
                                        itemId: e.target.value,
                                        label: item?.title || row.label,
                                      }
                                    : row,
                                ),
                              );
                            }}
                          >
                            <option value="">{t("tools.unlinkedItem")}</option>
                            {items.map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.title}
                              </option>
                            ))}
                          </Select>
                        </label>
                        <label>
                          {t("tools.required")}
                          <input
                            type="number"
                            min="1"
                            max="1000000000"
                            required
                            value={line.quantity}
                            onChange={(e) =>
                              updateRow(
                                "lines",
                                line.id,
                                "quantity",
                                Number(e.target.value),
                              )
                            }
                          />
                        </label>
                      </div>
                      <label>
                        {t("tools.label")}
                        <input
                          required
                          maxLength={180}
                          value={line.label}
                          onChange={(e) =>
                            updateRow("lines", line.id, "label", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        {t("tools.lineNote")}
                        <input
                          maxLength={2000}
                          value={line.note}
                          onChange={(e) =>
                            updateRow("lines", line.id, "note", e.target.value)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => remove("lines", line.id)}
                      >
                        <Trash2 size={15} />
                        {t("tools.removeRow")}
                      </button>
                    </fieldset>
                  ))}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      toolSet("lines", [
                        ...form.tool.lines,
                        {
                          id: uid(),
                          itemId: "",
                          label: "",
                          quantity: 1,
                          note: "",
                        },
                      ])
                    }
                  >
                    <Plus size={15} />
                    {t("tools.addLine")}
                  </button>
                </>
              )}
              {kind === "procedure" && (
                <>
                  <p className="field-help">{t("tools.templateHelp")}</p>
                  {form.tool.steps.map((step, index) => (
                    <fieldset className="tool-row-editor" key={step.id}>
                      <legend>{t("tools.step", index + 1)}</legend>
                      <label>
                        {t("tools.instructions")}
                        <textarea
                          rows={2}
                          required
                          maxLength={2000}
                          value={step.label}
                          onChange={(e) =>
                            updateRow("steps", step.id, "label", e.target.value)
                          }
                        />
                      </label>
                      <div className="data-actions">
                        <button
                          type="button"
                          className="text-button"
                          disabled={!index}
                          onClick={() => {
                            const rows = [...form.tool.steps];
                            [rows[index - 1], rows[index]] = [
                              rows[index],
                              rows[index - 1],
                            ];
                            toolSet("steps", rows);
                          }}
                        >
                          {t("tools.moveUp")}
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => remove("steps", step.id)}
                        >
                          {t("tools.removeRow")}
                        </button>
                      </div>
                    </fieldset>
                  ))}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      toolSet("steps", [
                        ...form.tool.steps,
                        { id: uid(), label: "" },
                      ])
                    }
                  >
                    <Plus size={15} />
                    {t("tools.addStep")}
                  </button>
                </>
              )}
              {kind === "cards" && (
                <>
                  {form.tool.cards.map((card, index) => (
                    <fieldset className="tool-row-editor" key={card.id}>
                      <legend>{t("tools.card", index + 1)}</legend>
                      <label>
                        {t("tools.question")}
                        <textarea
                          rows={2}
                          required
                          maxLength={5000}
                          value={card.question}
                          onChange={(e) =>
                            updateRow(
                              "cards",
                              card.id,
                              "question",
                              e.target.value,
                            )
                          }
                        />
                      </label>
                      <label>
                        {t("tools.answer")}
                        <textarea
                          rows={3}
                          required
                          maxLength={10000}
                          value={card.answer}
                          onChange={(e) =>
                            updateRow(
                              "cards",
                              card.id,
                              "answer",
                              e.target.value,
                            )
                          }
                        />
                      </label>
                      <div className="form-grid">
                        <label>
                          {t("tools.source")}
                          <Select
                            value={card.sourceId}
                            onChange={(e) =>
                              updateRow(
                                "cards",
                                card.id,
                                "sourceId",
                                e.target.value,
                              )
                            }
                          >
                            <option value="">{t("tools.noSource")}</option>
                            {nodes
                              .filter((n) => n.id !== form.id)
                              .map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.title}
                                </option>
                              ))}
                          </Select>
                        </label>
                        <label>
                          {t("tools.sourcePage")}
                          <input
                            maxLength={80}
                            value={card.sourcePage}
                            onChange={(e) =>
                              updateRow(
                                "cards",
                                card.id,
                                "sourcePage",
                                e.target.value,
                              )
                            }
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => remove("cards", card.id)}
                      >
                        {t("tools.removeRow")}
                      </button>
                    </fieldset>
                  ))}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      toolSet("cards", [
                        ...form.tool.cards,
                        {
                          id: uid(),
                          question: "",
                          answer: "",
                          sourceId: "",
                          sourcePage: "",
                        },
                      ])
                    }
                  >
                    <Plus size={15} />
                    {t("tools.addCard")}
                  </button>
                </>
              )}
              {kind === "view" && (
                <div className="tool-filter-editor">
                  <h3>{t("tools.viewFilters")}</h3>
                  <label>
                    {t("tools.rule")}
                    <Select
                      value={form.tool.filter.rule}
                      onChange={(e) =>
                        toolSet("filter", {
                          ...form.tool.filter,
                          rule: e.target.value,
                        })
                      }
                    >
                      {VIEW_RULES.map((rule) => (
                        <option key={rule} value={rule}>
                          {t("tools.rule." + rule)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <div className="form-grid">
                    <label>
                      {t("tools.recordType")}
                      <Select
                        value={form.tool.filter.type}
                        onChange={(e) =>
                          toolSet("filter", {
                            ...form.tool.filter,
                            type: e.target.value,
                          })
                        }
                      >
                        {[
                          "all",
                          "category",
                          "project",
                          "knowledge",
                          "skill",
                          "code",
                          "item",
                          "task",
                        ].map((type) => (
                          <option key={type} value={type}>
                            {t("tools.type." + type)}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label>
                      {t("tools.status")}
                      <Select
                        value={form.tool.filter.status}
                        onChange={(e) =>
                          toolSet("filter", {
                            ...form.tool.filter,
                            status: e.target.value,
                          })
                        }
                      >
                        {["all", "draft", "active", "learning", "done"].map(
                          (status) => (
                            <option key={status} value={status}>
                              {t("tools.status." + status)}
                            </option>
                          ),
                        )}
                      </Select>
                    </label>
                  </div>
                  <label>
                    {t("tools.filterProject")}
                    <Select
                      value={form.tool.filter.projectId}
                      onChange={(e) =>
                        toolSet("filter", {
                          ...form.tool.filter,
                          projectId: e.target.value,
                        })
                      }
                    >
                      <option value="">{t("tools.allProjects")}</option>
                      {projects.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.title}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    {t("tools.searchWords")}
                    <input
                      maxLength={500}
                      value={form.tool.filter.query}
                      onChange={(e) =>
                        toolSet("filter", {
                          ...form.tool.filter,
                          query: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("tools.exactTag")}
                    <input
                      maxLength={120}
                      value={form.tool.filter.tag}
                      onChange={(e) =>
                        toolSet("filter", {
                          ...form.tool.filter,
                          tag: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              )}
              {kind !== "journal" && (
                <label className="tool-notes">
                  {t("tools.notes")}
                  <textarea
                    className="code-input"
                    rows={7}
                    value={form.body}
                    maxLength={1_000_000}
                    onChange={(e) => set("body", e.target.value)}
                  />
                </label>
              )}
            </Panel>
          </fieldset>
        </div>
        <footer>
          <span>{t("tools.markdownStorage")}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={close}
            disabled={busy}
          >
            {t("tools.cancel")}
          </button>
          <button
            className="primary-button"
            disabled={busy || !!conflict || !!draft.available}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{" "}
            {t(kind === "journal" ? "journal.saveEntry" : "tools.save")}
          </button>
        </footer>
      </form>
    </div>
  );
}
