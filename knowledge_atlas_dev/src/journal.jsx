import React, { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  Upload,
  MapPin,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Download,
} from "lucide-react";
import { t } from "../shared/i18n.js";
import {
  journalRange,
  journalDays,
  periodEnd,
  photoSuggestions,
} from "../shared/journal.js";
import { documentType } from "../shared/document-types.js";
import { api } from "./client.js";
import { resourceLocation } from "./atlas-model.js";
import { DocumentViewer } from "./documents.jsx";
import { MarkdownContent } from "./markdown.jsx";
import { JournalAttachments } from "./journal-attachments.jsx";
import "./journal.css";

const imageResources = (node, settings) =>
  node.resources.filter(
    (r) =>
      settings.locations.some(
        (l) =>
          l.id === resourceLocation(r) && ["addon", "server"].includes(l.kind),
      ) && documentType(r.path || "").kind === "image",
  );

export function AttachmentGallery({ node, settings }) {
  const [selected, setSelected] = useState(null);
  useEffect(() => setSelected(null), [node.id]);
  const images = imageResources(node, settings);
  const index = images.findIndex((r) => r.id === selected?.id);
  if (!images.length) return null;
  return (
    <section className="attachment-gallery" aria-label={t("journal.photos")}>
      {images.map((r) => (
        <button
          key={r.id}
          className="photo-card"
          onClick={() => setSelected(r)}
        >
          <ImageIcon size={28} aria-hidden="true" />
          <span>{r.label}</span>
          {r.photo?.takenAt && (
            <small>{r.photo.takenAt.replace("T", " ")}</small>
          )}
          <span className="attachment-preview-action">
            <Download size={14} />
            {t("journal.loadPreview")}
          </span>
        </button>
      ))}
      {selected && (
        <DocumentViewer
          key={selected.id}
          resource={{
            nodeId: node.id,
            resourceId: selected.id,
            title: selected.label,
          }}
          onClose={() => setSelected(null)}
          navigation={{
            index,
            total: images.length,
            onPrevious: () => setSelected(images[index - 1]),
            onNext: () => setSelected(images[index + 1]),
          }}
        />
      )}
    </section>
  );
}

export function PlaceMap({ places = [] }) {
  const points = places.filter(
    (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
  );
  if (!places.length)
    return <p className="field-help">{t("journal.noPlace")}</p>;
  const minLat = Math.min(...points.map((p) => p.latitude)),
    maxLat = Math.max(...points.map((p) => p.latitude));
  const minLon = Math.min(...points.map((p) => p.longitude)),
    maxLon = Math.max(...points.map((p) => p.longitude));
  const x = (p) =>
    50 + ((p.longitude - minLon) / Math.max(0.01, maxLon - minLon)) * 460;
  const y = (p) =>
    200 - ((p.latitude - minLat) / Math.max(0.01, maxLat - minLat)) * 155;
  return (
    <section className="journal-places">
      <h3>
        <MapPin size={17} /> {t("journal.places")}
      </h3>
      {points.length > 0 && (
        <>
          <svg
            viewBox="0 0 560 245"
            role="img"
            aria-label={t("journal.coordinateMap")}
          >
            {[50, 165, 280, 395, 510].map((v) => (
              <path key={v} d={`M${v} 30V215`} className="map-grid" />
            ))}
            {[45, 85, 125, 165, 205].map((v) => (
              <path key={v} d={`M30 ${v}H530`} className="map-grid" />
            ))}
            {points.map((p) => (
              <g key={p.id}>
                <circle
                  cx={points.length === 1 ? 280 : x(p)}
                  cy={points.length === 1 ? 120 : y(p)}
                  r="9"
                />
                <text
                  x={(points.length === 1 ? 280 : x(p)) + 13}
                  y={(points.length === 1 ? 120 : y(p)) + 4}
                >
                  {places.findIndex((place) => place.id === p.id) + 1}
                </text>
                <title>
                  {p.label}: {p.latitude}, {p.longitude}
                </title>
              </g>
            ))}
          </svg>
          <small>{t("journal.mapHelp")}</small>
        </>
      )}
      <ol>
        {places.map((p) => (
          <li key={p.id}>
            <strong>{p.label || t("journal.coordinates")}</strong>
            {Number.isFinite(p.latitude) && (
              <code>
                {p.latitude.toFixed(6)}, {p.longitude.toFixed(6)}
              </code>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function JournalFields({
  form,
  setForm,
  nodes,
  busy,
  onBusy,
  part = "all",
}) {
  const [uploadError, setUploadError] = useState(""),
    [linkQuery, setLinkQuery] = useState("");
  const tool = form.tool,
    places = tool.places || [],
    period =
      tool.period ||
      (tool.endDate && tool.endDate !== tool.date ? "custom" : "day");
  const change = (patch) =>
    setForm((old) => ({ ...old, tool: { ...old.tool, ...patch } }));
  const updatePlace = (id, patch) =>
    change({
      places: places.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  const suggestions = photoSuggestions(form.resources);
  const knownPlaces = [
    ...new Map(
      nodes
        .flatMap((n) => n.tool?.places || [])
        .filter((p) => p.label)
        .map((p) => [p.label, p]),
    ).values(),
  ];
  async function upload(files) {
    onBusy(true);
    setUploadError("");
    try {
      for (const file of files) {
        if (file.size > 50_000_000) throw new Error(t("journal.fileLimit"));
        const name =
          file.name
            .replace(/[^\p{L}\p{N}._ -]/gu, "_")
            .replace(/^\.+/, "")
            .slice(-160) || "attachment";
        const resource = await api(
          `documents?path=${encodeURIComponent(`journal/${form.id}/${crypto.randomUUID()}-${name}`)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: file,
          },
        );
        setForm((old) => ({
          ...old,
          resources: [...old.resources, { ...resource, label: file.name }],
        }));
      }
    } catch (e) {
      setUploadError(e.message);
    } finally {
      onBusy(false);
    }
  }
  return (
    <section className="journal-fields">
      {["all", "organization"].includes(part) && (
        <>
          <label className="journal-experience-filter">
            <input
              type="checkbox"
              checked={tool.experience === true}
              onChange={(e) => change({ experience: e.target.checked })}
            />
            {t("journal.markExperience")}
          </label>
          <p className="field-help">{t("journal.experienceHelp")}</p>
        </>
      )}
      {["all", "entry"].includes(part) && (
        <>
          <div className="form-grid">
            <label>
              {t("journal.period")}
              <select
                value={period}
                onChange={(e) =>
                  change({
                    period: e.target.value,
                    endDate:
                      e.target.value === "custom"
                        ? tool.endDate || tool.date
                        : periodEnd(tool.date, e.target.value),
                  })
                }
              >
                {["day", "week", "month", "custom"].map((p) => (
                  <option key={p} value={p}>
                    {t(`journal.period.${p}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("journal.start")}
              <input
                type="date"
                required
                value={tool.date}
                onChange={(e) =>
                  change({
                    date: e.target.value,
                    ...(period !== "custom"
                      ? { endDate: periodEnd(e.target.value, period) }
                      : {}),
                  })
                }
              />
            </label>
            <label>
              {t("journal.end")}
              <input
                type="date"
                required
                min={tool.date}
                value={tool.endDate || tool.date}
                onChange={(e) =>
                  change({ endDate: e.target.value, period: "custom" })
                }
              />
            </label>
            <label>
              {t("tools.minutes")}
              <input
                type="number"
                min="0"
                max={Math.min(5256000, journalDays(tool) * 1440)}
                required
                value={tool.minutes}
                onChange={(e) => change({ minutes: Number(e.target.value) })}
              />
            </label>
          </div>
          <p className="field-help">{t("journal.rangeHelp")}</p>
          <label className="journal-experience-filter">
            <input
              type="checkbox"
              checked={!(tool.startTime || tool.endTime)}
              onChange={(e) =>
                change(
                  e.target.checked
                    ? { startTime: "", endTime: "" }
                    : { startTime: "09:00", endTime: "10:00" },
                )
              }
            />
            {t("calendar.allDay")}
          </label>
          {(tool.startTime || tool.endTime) && (
            <div className="form-grid">
              <label>
                {t("calendar.startTime")}
                <input
                  type="time"
                  required
                  value={tool.startTime}
                  onChange={(e) => change({ startTime: e.target.value })}
                />
              </label>
              <label>
                {t("calendar.endTime")}
                <input
                  type="time"
                  required
                  value={tool.endTime || ""}
                  onChange={(e) => change({ endTime: e.target.value })}
                />
              </label>
            </div>
          )}
        </>
      )}
      {["all", "places"].includes(part) && (
        <>
          <h3>{t("journal.places")}</h3>
          <datalist id="journal-known-places">
            {knownPlaces.map((p) => (
              <option value={p.label} key={p.label} />
            ))}
          </datalist>
          {places.map((p) => (
            <fieldset className="journal-place-editor" key={p.id}>
              <label>
                {t("journal.placeName")}
                <input
                  maxLength={300}
                  list="journal-known-places"
                  value={p.label}
                  onChange={(e) => {
                    const known = knownPlaces.find(
                      (k) => k.label === e.target.value,
                    );
                    updatePlace(
                      p.id,
                      known
                        ? {
                            label: known.label,
                            latitude: known.latitude,
                            longitude: known.longitude,
                          }
                        : { label: e.target.value },
                    );
                  }}
                />
              </label>
              <div className="form-grid">
                <label>
                  {t("journal.latitude")}
                  <input
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    value={p.latitude ?? ""}
                    onChange={(e) =>
                      updatePlace(p.id, {
                        latitude:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  {t("journal.longitude")}
                  <input
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    value={p.longitude ?? ""}
                    onChange={(e) =>
                      updatePlace(p.id, {
                        longitude:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  change({ places: places.filter((x) => x.id !== p.id) })
                }
              >
                <Trash2 size={14} />
                {t("journal.removePlace")}
              </button>
            </fieldset>
          ))}
          <button
            className="secondary-button"
            type="button"
            disabled={places.length >= 100}
            onClick={() =>
              change({
                places: [...places, { id: crypto.randomUUID(), label: "" }],
              })
            }
          >
            <Plus size={14} />
            {t("journal.addPlace")}
          </button>
          <p className="field-help">{t("journal.placeHelp")}</p>
        </>
      )}
      {["all", "links"].includes(part) && (
        <>
          <h3>{t("journal.links")}</h3>
          <p className="field-help">{t("journal.taskLinksHelp")}</p>
          <input
            aria-label={t("journal.findLink")}
            placeholder={t("journal.findLink")}
            value={linkQuery}
            onChange={(e) => setLinkQuery(e.target.value)}
          />
          <div className="journal-link-choices">
            {nodes
              .filter(
                (n) =>
                  n.id !== form.id &&
                  (form.related.includes(n.id) ||
                    (linkQuery &&
                      n.title
                        .toLocaleLowerCase()
                        .includes(linkQuery.toLocaleLowerCase()))),
              )
              .slice(0, 60)
              .map((n) => (
                <label key={n.id}>
                  <input
                    type="checkbox"
                    checked={form.related.includes(n.id)}
                    onChange={(e) =>
                      setForm((old) => ({
                        ...old,
                        related: e.target.checked
                          ? [...old.related, n.id]
                          : old.related.filter((id) => id !== n.id),
                      }))
                    }
                  />
                  {n.title}
                  {n.type === "task" && <small> · {t("m079")}</small>}
                </label>
              ))}
          </div>
        </>
      )}
      {["all", "attachments"].includes(part) && (
        <>
          <h3>{t("journal.attachments")}</h3>
          <label className="journal-upload">
            <Upload size={16} />
            {t("journal.upload")}
            <input
              type="file"
              multiple
              disabled={busy}
              onChange={(e) => {
                const files = [...e.target.files];
                e.target.value = "";
                upload(files);
              }}
            />
          </label>
          <p className="field-help">{t("journal.uploadHelp")}</p>
          {uploadError && (
            <p className="error-banner" role="alert">
              {uploadError}
            </p>
          )}
          {form.resources.map((r) => (
            <div key={r.id} className="journal-attachment-edit">
              <label>
                {t("journal.caption")}
                <input
                  value={r.label}
                  onChange={(e) =>
                    setForm((old) => ({
                      ...old,
                      resources: old.resources.map((x) =>
                        x.id === r.id ? { ...x, label: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <small>{r.photo?.takenAt || r.path}</small>
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={t("journal.removeAttachment")}
                onClick={() =>
                  setForm((old) => ({
                    ...old,
                    resources: old.resources.filter((x) => x.id !== r.id),
                    previewResourceId:
                      old.previewResourceId === r.id
                        ? ""
                        : old.previewResourceId,
                  }))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {(suggestions.start || suggestions.places.length > 0) && (
            <div className="journal-exif">
              <p>{t("journal.exifHelp")}</p>
              {suggestions.start && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    change({
                      date: suggestions.start,
                      endDate: suggestions.end,
                      period:
                        suggestions.start === suggestions.end
                          ? "day"
                          : "custom",
                    })
                  }
                >
                  {t("journal.useDates", suggestions.start, suggestions.end)}
                </button>
              )}
              {suggestions.places.length > 0 && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    change({
                      places: [
                        ...places,
                        ...suggestions.places.filter(
                          (p) => !places.some((x) => x.id === p.id),
                        ),
                      ].slice(0, 100),
                    })
                  }
                >
                  {t("journal.useGps", suggestions.places.length)}
                </button>
              )}
            </div>
          )}
        </>
      )}
      {["all", "organization"].includes(part) && (
        <label>
          {t("tools.next")}
          <textarea
            rows={2}
            maxLength={2000}
            value={tool.next}
            onChange={(e) => change({ next: e.target.value })}
          />
        </label>
      )}
    </section>
  );
}

export function JournalEntry({
  node,
  entries,
  settings,
  nodes,
  onSelect,
  onEntry,
  autoPreview = false,
}) {
  const [document, setDocument] = useState(null);
  useEffect(() => setDocument(null), [node.id]);
  const imageIds = new Set(imageResources(node, settings).map((r) => r.id));
  const files = node.resources.filter((r) => !imageIds.has(r.id));
  const range = journalRange(node.tool),
    index = entries.findIndex((n) => n.id === node.id);
  const linked = [...new Set([node.projectId, ...node.related].filter(Boolean))]
    .map((id) => nodes.find((n) => n.id === id))
    .filter(Boolean);
  return (
    <div className="journal-entry">
      <nav className="journal-navigation" aria-label={t("journal.browse")}>
        <button
          className="secondary-button"
          disabled={index >= entries.length - 1}
          onClick={() => onEntry(entries[index + 1].id)}
        >
          <ChevronLeft size={16} />
          {t("journal.older")}
        </button>
        <span>
          {index + 1} / {entries.length}
        </span>
        <button
          className="secondary-button"
          disabled={index <= 0}
          onClick={() => onEntry(entries[index - 1].id)}
        >
          {t("journal.newer")}
          <ChevronRight size={16} />
        </button>
      </nav>
      <div className="tool-meta">
        <strong>
          {range.start}
          {range.end !== range.start ? ` — ${range.end}` : ""}
        </strong>
        <span>{t("journal.days", journalDays(node.tool))}</span>
        {node.tool.minutes > 0 && (
          <span>{t("tools.duration", node.tool.minutes)}</span>
        )}
      </div>
      <MarkdownContent>{node.body}</MarkdownContent>
      <PlaceMap places={node.tool.places} />
      {linked.length > 0 && (
        <section className="journal-links">
          <h3>{t("journal.links")}</h3>
          {linked.map((n) => (
            <button
              key={n.id}
              className="secondary-button"
              onClick={() => onSelect(n)}
            >
              {n.title}
              {n.type === "task" && <small> · {t("m079")}</small>}
            </button>
          ))}
        </section>
      )}
      {autoPreview ? (
        <JournalAttachments key={node.id} node={node} settings={settings} />
      ) : (
        <>
          {node.resources.length > 0 && (
            <p className="field-help">{t("journal.manualPreviewHelp")}</p>
          )}
          <AttachmentGallery node={node} settings={settings} />
          {files.length > 0 && (
            <section className="journal-files">
              <h3>{t("journal.attachments")}</h3>
              {files.map((r) => {
                const location = settings.locations.find(
                  (l) => l.id === resourceLocation(r),
                );
                const available = ["addon", "server", "web"].includes(
                  location?.kind,
                );
                return available ? (
                  <button
                    key={r.id}
                    className="resource record-document"
                    onClick={() =>
                      setDocument({
                        nodeId: node.id,
                        resourceId: r.id,
                        title: r.label,
                      })
                    }
                  >
                    <FileText size={16} />
                    <span>
                      {r.label}
                      <small>{t("journal.loadPreview")}</small>
                    </span>
                    <Download size={16} />
                  </button>
                ) : (
                  <div className="resource" key={r.id}>
                    <MapPin size={16} />
                    <span>
                      {r.label}
                      <small>
                        {location?.name}: {r.path || r.url}
                      </small>
                    </span>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
      {node.tool.next && (
        <section className="tool-next">
          <h3>{t("tools.next")}</h3>
          <p>{node.tool.next}</p>
        </section>
      )}
      {document && (
        <DocumentViewer
          key={document.resourceId}
          resource={document}
          onClose={() => setDocument(null)}
        />
      )}
    </div>
  );
}
