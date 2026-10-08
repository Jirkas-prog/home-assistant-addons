import { Select } from "./select.jsx";
import React, { useEffect, useState } from "react";
import { api } from "./client.js";
import { t, localizeMessage } from "../shared/i18n.js";

export function PackagePreview({
  preview,
  busy,
  onApply,
  onRefresh,
  onDiscard,
}) {
  const [decisions, setDecisions] = useState({}),
    [parent, setParent] = useState("");
  const [confirmed, setConfirmed] = useState(false),
    [nodes, setNodes] = useState([]);
  useEffect(() => {
    let stopped = false;
    setDecisions({});
    setParent("");
    setConfirmed(false);
    api("nodes")
      .then((data) => {
        if (!stopped) setNodes(data.nodes);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [preview.id]);
  const conflicts = preview.records.filter((row) => row.status === "conflict");
  return (
    <section
      className="data-panel package-preview"
      aria-label={t("package.preview")}
    >
      <h3>
        {t("package.preview")}
        {preview.title && ` · ${preview.title}`}
      </h3>
      <p>{t("package.help")}</p>
      {preview.sections?.length > 0 && (
        <p>
          {t(
            "backup.selectedPreview",
            preview.sections.map((p) => t(`backup.part.${p}`)).join(", "),
            preview.contexts,
          )}
        </p>
      )}
      <p>
        {t(
          "package.counts",
          preview.records.filter((r) => r.status === "added").length,
          conflicts.length,
          preview.records.filter((r) => r.status === "identical").length,
          preview.documents,
          preview.reused,
        )}
      </p>
      <label>
        {t("package.parent")}
        <Select
          disabled={busy}
          value={parent}
          onChange={(event) => {
            setParent(event.target.value);
            setConfirmed(false);
          }}
        >
          <option value="">{t("package.root")}</option>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.title} ({node.id})
            </option>
          ))}
        </Select>
      </label>
      {preview.issue && (
        <p className="error-banner" role="alert">
          {localizeMessage(preview.issue)} {t("package.dependencies")}
        </p>
      )}
      <div className="package-records">
        {preview.records.map((row) => (
          <details key={row.id} className="package-record">
            <summary>
              <strong>{row.title}</strong>
              <span>{t(`package.${row.status}`)}</span>
              <code>{row.id}</code>
            </summary>
            {row.status === "conflict" && (
              <label>
                {t("package.choose")}
                <Select
                  aria-label={t("package.choiceFor", row.title)}
                  disabled={busy}
                  value={
                    Object.hasOwn(decisions, row.id)
                      ? decisions[row.id]
                      : "keep"
                  }
                  onChange={(event) => {
                    setDecisions((current) => ({
                      ...current,
                      [row.id]: event.target.value,
                    }));
                    setConfirmed(false);
                  }}
                >
                  <option value="keep">{t("package.keep")}</option>
                  <option value="replace">{t("package.replace")}</option>
                </Select>
              </label>
            )}
            <div className="package-comparison">
              {[
                ["current", row.current],
                ["incoming", row.incoming],
              ]
                .filter(([, detail]) => detail)
                .map(([key, detail]) => (
                  <div key={key}>
                    <h4>{t(`package.${key}`)}</h4>
                    <strong>{detail.title}</strong>
                    <p>{detail.summary}</p>
                    <pre>{detail.body}</pre>
                    {detail.truncated && <p>{t("package.truncated")}</p>}
                    <p>{t("package.attachments", detail.attachments)}</p>
                    {detail.comments?.total > 0 && (
                      <>
                        <p>{t("task.commentPreview", detail.comments.total)}</p>
                        {detail.comments.entries.map((c) => (
                          <pre key={c.id}>
                            {c.deleted ? t("task.deletedComment") : c.body}
                          </pre>
                        ))}
                      </>
                    )}
                  </div>
                ))}
            </div>
          </details>
        ))}
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {t("package.confirm")}
      </label>
      <div className="data-actions">
        <button
          className="primary-button"
          disabled={busy || !confirmed}
          onClick={() => onApply({ decisions, parent: parent || null })}
        >
          {t("package.apply")}
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={onRefresh}
        >
          {t("package.refresh")}
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={onDiscard}
        >
          {t("data.discard")}
        </button>
      </div>
    </section>
  );
}
