import React, { useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  LoaderCircle,
  MapPin,
  Pause,
  Play,
} from "lucide-react";
import { t, locale } from "../shared/i18n.js";
import { resourceLocation } from "./atlas-model.js";
import { documentType } from "../shared/document-types.js";
import { loadJournalPreviews } from "./journal-previews.js";
import {
  formatBytes,
  formatPercent,
  formatDuration,
} from "./transfer-progress.js";
import { DocumentViewer } from "./documents.jsx";

export function JournalAttachments({ node, settings }) {
  const [files, setFiles] = useState({}),
    [selected, setSelected] = useState(null),
    [automatic, setAutomatic] = useState(() => {
      try {
        return localStorage.getItem("atlas-journal-auto-preview") !== "false";
      } catch {
        return true;
      }
    }),
    [requested, setRequested] = useState(null);
  const cache = useRef({});
  const signature = JSON.stringify(node.resources);
  useEffect(() => {
    cache.current = {};
    setFiles({});
    setSelected(null);
    setRequested(null);
    return () =>
      Object.values(cache.current).forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url);
      });
  }, [node.id, signature, settings.revision]);
  useEffect(() => {
    try {
      localStorage.setItem("atlas-journal-auto-preview", String(automatic));
    } catch {}
  }, [automatic]);
  useEffect(() => {
    const controller = new AbortController();
    const resources = JSON.parse(signature)
      .filter((r) =>
        settings.locations.some(
          (l) =>
            l.id === resourceLocation(r) &&
            ["addon", "server"].includes(l.kind),
        ),
      )
      .filter(
        (r) =>
          !cache.current[r.id]?.url &&
          (requested?.id === r.id ||
            (automatic &&
              !["manual", "failed"].includes(cache.current[r.id]?.status))),
      )
      .sort((a, b) => {
        const rank = (r) =>
          requested?.id === r.id
            ? -1
            : documentType(r.path || "").kind === "text"
              ? 0
              : 1;
        return rank(a) - rank(b);
      });
    const publish = (id, item) => {
      cache.current[id] = item;
      setFiles((old) => ({ ...old, [id]: item }));
    };
    resources.forEach((r) => publish(r.id, { status: "queued" }));
    loadJournalPreviews(node.id, resources, {
      signal: controller.signal,
      onUpdate: (id, item) => {
        if (item.blob) {
          item.url = URL.createObjectURL(item.blob);
          delete item.blob;
        }
        publish(id, item);
        if (requested?.id === id && ["ready", "manual"].includes(item.status))
          setSelected(node.resources.find((r) => r.id === id));
      },
    });
    return () => {
      controller.abort();
    };
  }, [node.id, signature, settings.revision, automatic, requested]);
  if (!node.resources.length) return null;
  const images = node.resources.filter(
    (r) => documentType(r.path || r.url || "").kind === "image",
  );
  const index = images.findIndex((r) => r.id === selected?.id);
  return (
    <section aria-label={t("journal.attachments")}>
      <h3>{t("journal.attachments")}</h3>
      <p className="field-help">{t("journal.autoPreviewHelp")}</p>
      <div className="attachment-queue-controls">
        <button
          className="secondary-button"
          onClick={() => {
            setRequested(null);
            setAutomatic(!automatic);
          }}
        >
          {automatic ? <Pause size={16} /> : <Play size={16} />}
          {t(automatic ? "journal.pausePreviews" : "journal.resumePreviews")}
        </button>
        <span>
          {t(
            automatic ? "journal.previewAutomatic" : "journal.previewDataSaver",
          )}
        </span>
      </div>
      <div className="journal-auto-attachments">
        {node.resources.map((r) => {
          const item = files[r.id],
            location = settings.locations.find(
              (l) => l.id === resourceLocation(r),
            );
          const available = ["addon", "server", "web"].includes(location?.kind);
          const status =
            ["addon", "server"].includes(location?.kind) &&
            !automatic &&
            requested?.id !== r.id &&
            [undefined, "queued", "loading"].includes(item?.status)
              ? "paused"
              : item?.status ||
                (["addon", "server"].includes(location?.kind)
                  ? "queued"
                  : "manual");
          const content = (
            <>
              {item?.url && item.metadata.kind === "image" ? (
                <img src={item.url} alt={r.label} decoding="async" />
              ) : status === "loading" ? (
                <LoaderCircle className="spin" size={24} />
              ) : available ? (
                <FileText size={24} />
              ) : (
                <MapPin size={24} />
              )}
              <strong>{r.label}</strong>
              <small>
                {location?.name} · {r.path || r.url}
              </small>
              {available && (
                <small>
                  {t(`journal.preview.${status}`)}
                  {Number.isFinite(item?.metadata?.size)
                    ? ` · ${formatBytes(item.metadata.size, locale())}`
                    : ""}
                </small>
              )}
              {status === "loading" && Number.isFinite(item?.loaded) && (
                <span className="attachment-transfer">
                  <progress
                    aria-label={t("journal.fileProgress", r.label)}
                    value={item.loaded}
                    max={Math.max(1, item.total)}
                  />
                  <span>
                    {formatPercent(item.loaded, item.total, locale())} ·{" "}
                    {t(
                      "transfer.downloadRate",
                      formatBytes(item.rate || 0, locale()),
                    )}
                  </span>
                  <span>
                    {item.eta == null
                      ? t("transfer.etaUnknown")
                      : t("transfer.eta", formatDuration(item.eta))}
                  </span>
                </span>
              )}
              {available && (
                <span className="attachment-preview-action">
                  <Download size={14} />
                  {t(
                    item?.url
                      ? "documents.preview"
                      : status === "queued"
                        ? "journal.downloadFirst"
                        : "journal.loadPreview",
                  )}
                </span>
              )}
            </>
          );
          return available ? (
            <button
              key={r.id}
              className="journal-auto-file"
              disabled={status === "loading"}
              onClick={() => {
                if (item?.url || status === "manual") setSelected(r);
                else setRequested({ id: r.id });
              }}
            >
              {content}
            </button>
          ) : (
            <div key={r.id} className="journal-auto-file">
              {content}
            </div>
          );
        })}
      </div>
      {selected && (
        <DocumentViewer
          key={selected.id}
          resource={{
            nodeId: node.id,
            resourceId: selected.id,
            title: selected.label,
          }}
          preloaded={files[selected.id]}
          onClose={() => setSelected(null)}
          navigation={
            index < 0
              ? undefined
              : {
                  index,
                  total: images.length,
                  onPrevious: () => setSelected(images[index - 1]),
                  onNext: () => setSelected(images[index + 1]),
                }
          }
        />
      )}
    </section>
  );
}
