import React, { useEffect, useState } from "react";
import { t, locale } from "../shared/i18n.js";
import { compareChanges } from "../shared/merge.js";

let draftLibrary = "uninitialized";
export function setDraftLibrary(id) {
  draftLibrary = id || "uninitialized";
}

export function useDraft(id, value, original, dirty) {
  const key = `atlas-draft-v5:${draftLibrary}:${location.pathname}:${id}`;
  const [available, setAvailable] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      return saved?.value && saved?.original ? saved : null;
    } catch {
      return null;
    }
  });
  const [state, setState] = useState("");
  useEffect(() => {
    // A pending recovery choice owns this storage slot until it is resolved.
    if (!dirty || available) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ value, original, savedAt: new Date().toISOString() }),
      );
      setState("saved");
    } catch {
      setState("failed");
    }
  }, [key, value, original, dirty, available]);
  const clear = () => {
    try {
      localStorage.removeItem(key);
    } catch {}
    setAvailable(null);
    setState("");
  };
  return { available, state, clear, recovered: () => setAvailable(null) };
}
export function DraftNotice({ draft, onRecover }) {
  return (
    <>
      {draft.available && (
        <div className="conflict-panel draft-recovery" role="status">
          <p>{t("draft.available")}</p>
          {draft.available.value.title && (
            <strong>{draft.available.value.title}</strong>
          )}
          {draft.available.savedAt && (
            <p>{new Date(draft.available.savedAt).toLocaleString(locale())}</p>
          )}
          <p>{t("draft.chooseFirst")}</p>
          <div className="data-actions">
            <button
              type="button"
              autoFocus
              className="secondary-button"
              onClick={() => {
                onRecover(draft.available);
                draft.recovered();
              }}
            >
              {t("draft.recover")}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={draft.clear}
            >
              {t("draft.discard")}
            </button>
          </div>
        </div>
      )}
      {draft.state && (
        <p className="draft-notice" role="status">
          {t(draft.state === "saved" ? "draft.saved" : "draft.failed")}
        </p>
      )}
    </>
  );
}
export function DraftExit({ failed, onLeave, onStay }) {
  return (
    <div
      className="conflict-panel"
      role="alertdialog"
      aria-label={t("draft.exitTitle")}
    >
      <p>{t(failed ? "draft.failed" : "draft.leave")}</p>
      <div className="data-actions">
        <button
          type="button"
          autoFocus
          className="primary-button"
          onClick={onStay}
        >
          {t("draft.stay")}
        </button>
        <button type="button" className="secondary-button" onClick={onLeave}>
          {t("draft.exit")}
        </button>
      </div>
    </div>
  );
}
export function ConflictReview({ base, mine, current, onApply, onCancel }) {
  const [choices, setChoices] = useState({});
  const comparison = compareChanges(base, mine, current);
  const display = (value) =>
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "—");
  return (
    <section className="conflict-panel" aria-label={t("conflict.title")}>
      <h3>{t("conflict.title")}</h3>
      <p>{t("conflict.help")}</p>
      {comparison.conflicts.map((field) => (
        <div key={field.key}>
          <strong>{field.key}</strong>
          <div className="conflict-grid">
            {["base", "mine", "current"].map((side) => (
              <div key={side}>
                <small>{t(`conflict.${side}`)}</small>
                <pre>{display(field[side])}</pre>
              </div>
            ))}
          </div>
          <label>
            {t("conflict.choose")}
            <select
              value={choices[field.key] || ""}
              onChange={(e) =>
                setChoices({ ...choices, [field.key]: e.target.value })
              }
            >
              <option value="">—</option>
              <option value="mine">{t("conflict.mine")}</option>
              <option value="current">{t("conflict.current")}</option>
            </select>
          </label>
        </div>
      ))}
      <div className="data-actions">
        <button
          type="button"
          className="primary-button"
          disabled={comparison.conflicts.some((f) => !choices[f.key])}
          onClick={() => {
            const merged = { ...comparison.merged };
            for (const field of comparison.conflicts) {
              const value = field[choices[field.key]];
              if (value === undefined) delete merged[field.key];
              else merged[field.key] = value;
            }
            onApply(merged);
          }}
        >
          {t("conflict.apply")}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          {t("conflict.cancel")}
        </button>
      </div>
    </section>
  );
}
