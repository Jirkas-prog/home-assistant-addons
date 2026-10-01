import { t, locale, localizeMessage } from "../shared/i18n.js";
import React, { useState, useEffect, lazy, Suspense } from "react";
import { X, Download, Check, ExternalLink, FileText } from "lucide-react";
import { api, useDialogKeys } from "./client.js";
import { useDraft, DraftNotice, DraftExit, ConflictReview } from "./drafts.jsx";
import { MarkdownContent } from "./markdown.jsx";
import { readRemoteText } from "./remote-text.js";
import { documentType } from "../shared/document-types.js";
import "./document-preview.css";
const Pdf = lazy(() => import("./pdf-viewer.jsx"));
export function DocumentViewer({ resource, onClose, navigation }) {
  const [doc, setDoc] = useState(null),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [conflict, setConflict] = useState(null),
    [leaving, setLeaving] = useState(false),
    [editing, setEditing] = useState(false),
    [textLoaded, setTextLoaded] = useState(false);
  const [asText, setAsText] = useState(false);
  const base = `nodes/${resource.nodeId}/resources/${resource.resourceId}`,
    fileURL = `./api/${base}/file`;
  const markdown =
    doc?.format === "markdown" ||
    documentType(doc?.resolvedPath || "").format === "markdown";
  const dirty = doc?.editable && textLoaded && body !== doc.body;
  const draft = useDraft(
    `document:${resource.nodeId}:${resource.resourceId}`,
    { body },
    doc,
    dirty,
  );
  const close = () => {
    if (dirty) setLeaving(true);
    else onClose();
  };
  useDialogKeys(React, close);
  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 30_000);
    setError("");
    setDoc(null);
    setTextLoaded(false);
    setEditing(false);
    api(asText ? `${base}/as-text` : base)
      .then(async (r) => {
        if (!live) return;
        setDoc(r);
        if (r.url && r.kind === "text") {
          try {
            r = { ...r, body: await readRemoteText(r.url, abort.signal) };
          } catch (e) {
            throw new Error(
              t("documents.remoteError", localizeMessage(e.message)),
            );
          }
        }
        if (live) {
          setDoc(r);
          setBody(r.body || "");
          setTextLoaded(r.kind === "text");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      live = false;
      abort.abort();
      clearTimeout(timeout);
    };
  }, [base, asText]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await api(`${base}/text`, {
        method: "PUT",
        body: JSON.stringify({
          body,
          revision: doc.revision,
          targetRevision: doc.targetRevision,
        }),
      });
      setDoc((d) => ({
        ...d,
        ...next,
      }));
      setMessage(t("m003"));
      draft.clear();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) {
        try {
          const current = await api(base);
          if (current.kind === "text") setConflict(current);
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop upper-modal">
      <section
        className="modal document-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("m386", resource.title)}
      >
        <header>
          <div>
            <span className="eyebrow">
              {doc?.kind === "pdf"
                ? t("m004")
                : doc?.kind === "text"
                  ? t("documents.viewer")
                  : t("m006")}
            </span>
            <h2>{resource.title}</h2>
            <small>
              {doc?.location}
              {doc?.resolvedPath && ` · ${doc.resolvedPath}`}
            </small>
          </div>
          <button
            autoFocus
            className="icon-button"
            aria-label={t("m007")}
            onClick={close}
          >
            <X />
          </button>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {message && (
          <p className="document-message" role="status">
            {message}
          </p>
        )}
        {leaving && (
          <DraftExit
            failed={draft.state === "failed"}
            onLeave={onClose}
            onStay={() => setLeaving(false)}
          />
        )}
        {!doc && !error && <div className="empty">{t("m008")}</div>}
        {doc?.office && (
          <p className="document-notice">{t("journal.officeHelp")}</p>
        )}
        {doc?.binary && (
          <p className="document-notice">{t("journal.binaryHelp")}</p>
        )}
        {doc?.truncated && (
          <p className="document-notice">{t("journal.truncatedHelp")}</p>
        )}
        {doc?.kind === "pdf" && (
          <Suspense fallback={<div className="empty">{t("m009")}</div>}>
            <Pdf url={doc.url || fileURL} />
          </Suspense>
        )}
        {doc && ["image", "audio", "video"].includes(doc.kind) && (
          <div className="media-document">
            {doc.kind === "image" ? (
              <img
                src={doc.url || fileURL}
                alt={resource.title}
                referrerPolicy="no-referrer"
                onError={() => setError(t("documents.mediaError"))}
              />
            ) : doc.kind === "audio" ? (
              <audio
                controls
                preload="metadata"
                src={doc.url || fileURL}
                aria-label={resource.title}
                onError={() => setError(t("documents.mediaError"))}
              />
            ) : (
              <video
                controls
                preload="metadata"
                src={doc.url || fileURL}
                aria-label={resource.title}
                onError={() => setError(t("documents.mediaError"))}
              />
            )}
          </div>
        )}
        {doc?.kind === "text" && !textLoaded && !error && (
          <div className="empty">{t("m008")}</div>
        )}
        {doc?.kind === "text" && textLoaded && (
          <div className="text-document">
            <DraftNotice
              draft={draft}
              onRecover={(saved) => {
                setDoc(saved.original);
                setBody(saved.value.body);
                setEditing(true);
              }}
            />
            {conflict && (
              <ConflictReview
                base={{ body: doc.body }}
                mine={{ body }}
                current={{ body: conflict.body }}
                onCancel={() => setConflict(null)}
                onApply={(merged) => {
                  setDoc(conflict);
                  setBody(merged.body);
                  setConflict(null);
                  setError("");
                }}
              />
            )}
            <div className="document-toolbar">
              <div
                className="document-view-modes"
                role="group"
                aria-label={t("documents.display")}
              >
                <button
                  type="button"
                  aria-pressed={!editing}
                  onClick={() => setEditing(false)}
                >
                  {t("documents.preview")}
                </button>
                <button
                  type="button"
                  aria-pressed={editing}
                  onClick={() => setEditing(true)}
                >
                  {doc.editable ? t("documents.edit") : t("documents.source")}
                </button>
              </div>
              <span>
                {doc.editable
                  ? dirty
                    ? t("m010")
                    : t("m011")
                  : asText || doc.office
                    ? t("journal.readOnly")
                    : t("m012")}
              </span>
              <span>
                {body.length.toLocaleString(locale())}
                {" " + t("m013")}
              </span>
            </div>
            {editing ? (
              <textarea
                aria-label={t("m014")}
                value={body}
                readOnly={!doc.editable}
                spellCheck={false}
                onChange={(e) => setBody(e.target.value)}
              />
            ) : (
              <div
                className="document-preview"
                tabIndex={0}
                aria-label={t("documents.preview")}
              >
                {markdown ? (
                  <MarkdownContent>{body}</MarkdownContent>
                ) : (
                  <pre>{body}</pre>
                )}
              </div>
            )}
          </div>
        )}
        {doc && ["folder", "place", "download", "web"].includes(doc.kind) && (
          <div className="empty">
            <FileText />
            <p>{doc.kind === "place" ? t("m015") : t("m016")}</p>
            <p>{doc.resolvedPath}</p>
          </div>
        )}
        <footer>
          {navigation && (
            <div className="journal-navigation">
              <button
                className="secondary-button"
                disabled={navigation.index <= 0}
                onClick={navigation.onPrevious}
              >
                {t("journal.previousPhoto")}
              </button>
              <span>
                {navigation.index + 1} / {navigation.total}
              </span>
              <button
                className="secondary-button"
                disabled={navigation.index >= navigation.total - 1}
                onClick={navigation.onNext}
              >
                {t("journal.nextPhoto")}
              </button>
            </div>
          )}
          <button
            className="secondary-button"
            disabled={dirty || busy}
            onClick={() => setAsText(!asText)}
          >
            {t(asText ? "journal.originalView" : "journal.openAsText")}
          </button>
          {!doc && error && (
            <a className="secondary-button" href={`${fileURL}?download=1`}>
              <Download size={15} />
              {t("m018")}
            </a>
          )}
          {doc?.url && (
            <a
              className="secondary-button"
              href={doc.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={15} />
              {t("m017")}
            </a>
          )}
          {doc && !doc.url && !["place", "folder"].includes(doc.kind) && (
            <a className="secondary-button" href={`${fileURL}?download=1`}>
              <Download size={15} />
              {t("m018")}
            </a>
          )}
          {dirty && (
            <button
              className="secondary-button"
              onClick={() =>
                navigator.clipboard
                  .writeText(body)
                  .then(() => setMessage(t("m019")))
                  .catch(() => setError(t("m020")))
              }
            >
              {t("m021")}
            </button>
          )}
          {doc?.editable && (
            <button
              disabled={busy || !dirty}
              className="primary-button"
              onClick={save}
            >
              <Check size={16} />
              {busy ? t("m022") : t("m023")}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
