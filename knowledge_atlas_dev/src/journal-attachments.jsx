import React, { useEffect, useState } from "react";
import { Download, FileText, LoaderCircle, MapPin } from "lucide-react";
import { t, locale } from "../shared/i18n.js";
import { resourceLocation } from "./atlas-model.js";
import { documentType } from "../shared/document-types.js";
import { loadJournalPreviews } from "./journal-previews.js";
import { formatBytes } from "./transfer-progress.js";
import { DocumentViewer } from "./documents.jsx";

export function JournalAttachments({ node, settings }) {
  const [files, setFiles] = useState({}),
    [selected, setSelected] = useState(null);
  const signature = JSON.stringify(node.resources);
  useEffect(() => {
    const controller = new AbortController(),
      urls = [];
    setFiles({});
    setSelected(null);
    const resources = JSON.parse(signature).filter((r) =>
      settings.locations.some(
        (l) =>
          l.id === resourceLocation(r) && ["addon", "server"].includes(l.kind),
      ),
    );
    loadJournalPreviews(node.id, resources, {
      signal: controller.signal,
      onUpdate: (id, item) => {
        if (item.blob) {
          item.url = URL.createObjectURL(item.blob);
          urls.push(item.url);
          delete item.blob;
        }
        setFiles((old) => ({ ...old, [id]: item }));
      },
    });
    return () => {
      controller.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [node.id, signature, settings.revision]);
  if (!node.resources.length) return null;
  const images = node.resources.filter(
    (r) => documentType(r.path || r.url || "").kind === "image",
  );
  const index = images.findIndex((r) => r.id === selected?.id);
  return (
    <section aria-label={t("journal.attachments")}>
      <h3>{t("journal.attachments")}</h3>
      <p className="field-help">{t("journal.autoPreviewHelp")}</p>
      <div className="journal-auto-attachments">
        {node.resources.map((r) => {
          const item = files[r.id],
            location = settings.locations.find(
              (l) => l.id === resourceLocation(r),
            );
          const available = ["addon", "server", "web"].includes(location?.kind);
          const status =
            item?.status ||
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
              {available && (
                <span className="attachment-preview-action">
                  <Download size={14} />
                  {t(item?.url ? "documents.preview" : "journal.loadPreview")}
                </span>
              )}
            </>
          );
          return available ? (
            <button
              key={r.id}
              className="journal-auto-file"
              disabled={status === "queued" || status === "loading"}
              onClick={() => setSelected(r)}
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
