import { t, locale } from "../shared/i18n.js";
import React, { useState, useRef } from "react";
import {
  Plus,
  X,
  Check,
  Upload,
  Settings,
  MapPin,
  Copy,
  FileText,
  Folder,
  ExternalLink,
} from "lucide-react";
import { api, useDialogKeys } from "./client.js";
import { resourceLocation } from "./atlas-model.js";
import { DataTools } from "./data-tools.jsx";
import { locationDescendants, locationLabel } from "../shared/locations.js";
const KINDS = {
  get addon() {
    return t("m024");
  },
  get server() {
    return t("m387");
  },
  get device() {
    return t("m025");
  },
  get web() {
    return t("m026");
  },
  get physical() {
    return t("m027");
  },
};
export function LocationsSettings({ initial, nodes, onClose, onSaved }) {
  const [form, setForm] = useState(() => structuredClone(initial)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [replacement, setReplacement] = useState({});
  const change = (key, value) => {
    setDirty(true);
    setForm((f) => ({
      ...f,
      [key]: value,
    }));
  };
  const close = () => {
    if (!dirty || confirm(t("m028"))) onClose();
  };
  useDialogKeys(React, close);
  const update = (id, key, value) =>
    change(
      "locations",
      form.locations.map((l) =>
        l.id === id
          ? {
              ...l,
              [key]: value,
            }
          : l,
      ),
    );
  return (
    <div className="modal-backdrop upper-modal">
      <form
        className="modal locations-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("m029")}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const saved = await api("settings", {
              method: "PUT",
              body: JSON.stringify(form),
            });
            onSaved(saved);
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <div>
            <h2>{t("m029")}</h2>
          </div>
          <button
            type="button"
            autoFocus
            className="icon-button"
            aria-label={t("m031")}
            onClick={close}
          >
            <X />
          </button>
        </header>
        <div className="editor-body">
          <label>
            {t("settings.language")}
            <select
              value={form.language || "en"}
              onChange={(e) => change("language", e.target.value)}
            >
              <option value="en">{t("language.en")}</option>
              <option value="cs">{t("language.cs")}</option>
            </select>
          </label>
          <p className="field-help">{t("settings.languageHelp")}</p>
          <label>
            {t("m032")}
            <input
              required
              value={form.documentRoot}
              onChange={(e) => change("documentRoot", e.target.value)}
            />
          </label>
          <p className="field-help">{t("m033")}</p>
          <div className="editor-label">
            <span>{t("m034")}</span>
            <button
              type="button"
              onClick={() =>
                change("locations", [
                  ...form.locations,
                  {
                    id: crypto.randomUUID(),
                    name: "",
                    kind: "physical",
                  },
                ])
              }
            >
              <Plus size={15} />
              {t("m035")}
            </button>
          </div>
          {form.locations.map((l) => {
            const used = nodes.filter((n) =>
              [...n.resources, ...(n.stock?.placements || [])].some(
                (r) => resourceLocation(r) === l.id,
              ),
            ).length;
            const descendants = locationDescendants(form.locations, l.id);
            const children = form.locations.filter(
              (x) => x.parentId === l.id,
            ).length;
            return (
              <div className="location-card" key={l.id}>
                <div className="location-fields">
                  <label>
                    {t("m036")}
                    <input
                      required
                      maxLength={100}
                      value={l.name}
                      onChange={(e) => update(l.id, "name", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("m037")}
                    <select
                      value={l.kind}
                      onChange={(e) => update(l.id, "kind", e.target.value)}
                    >
                      {Object.entries(KINDS).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={used > 0 || children > 0}
                    title={used ? t("m038", used) : t("m039")}
                    aria-label={t("m040", l.name)}
                    className="icon-button"
                    onClick={() =>
                      change(
                        "locations",
                        form.locations.filter((x) => x.id !== l.id),
                      )
                    }
                  >
                    <X size={17} />
                  </button>
                </div>
                {l.kind === "physical" && (
                  <>
                    <label>
                      {t("locations.parent")}
                      <select
                        value={l.parentId || ""}
                        onChange={(e) =>
                          update(l.id, "parentId", e.target.value || null)
                        }
                      >
                        <option value="">{t("locations.root")}</option>
                        {form.locations
                          .filter(
                            (x) =>
                              x.kind === "physical" && !descendants.has(x.id),
                          )
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {locationLabel(form.locations, x.id)}
                            </option>
                          ))}
                      </select>
                    </label>
                    {(used > 0 || children > 0) && (
                      <details>
                        <summary>{t("locations.replace")}</summary>
                        <p className="field-help">
                          {t("locations.replaceHelp", used, children)}
                        </p>
                        <select
                          aria-label={t("locations.destination", l.name)}
                          disabled={dirty || busy}
                          value={replacement[l.id] || ""}
                          onChange={(e) =>
                            setReplacement({
                              ...replacement,
                              [l.id]: e.target.value,
                            })
                          }
                        >
                          <option value="">{t("stock.choose")}</option>
                          {form.locations
                            .filter(
                              (x) =>
                                x.kind === "physical" && !descendants.has(x.id),
                            )
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {locationLabel(form.locations, x.id)}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          disabled={dirty || busy || !replacement[l.id]}
                          className="secondary-button"
                          onClick={async () => {
                            setBusy(true);
                            setError("");
                            try {
                              await api(`locations/${l.id}/replace`, {
                                method: "POST",
                                body: JSON.stringify({
                                  target: replacement[l.id],
                                  revision: form.revision,
                                }),
                              });
                              const next = await api("settings");
                              setForm(next);
                              onSaved(next);
                            } catch (e) {
                              setError(e.message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          {t("locations.moveAndRemove")}
                        </button>
                      </details>
                    )}
                  </>
                )}
                {l.kind === "server" && (
                  <label>
                    {t("m041")}
                    <input
                      required
                      value={l.basePath || ""}
                      placeholder={t("m042")}
                      onChange={(e) => update(l.id, "basePath", e.target.value)}
                    />
                  </label>
                )}
                {["addon", "server"].includes(l.kind) && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={!!l.writable}
                      onChange={(e) =>
                        update(l.id, "writable", e.target.checked)
                      }
                    />
                    {t("m043")}
                    {l.kind === "addon" ? t("m044") : ""}
                  </label>
                )}
                <small>
                  {used}
                  {" " + t("m045") + " "}
                  {l.id}
                </small>
              </div>
            );
          })}
          <p className="field-help">{t("m046")}</p>
          {dirty && <p className="field-help">{t("data.saveSettingsFirst")}</p>}
          <fieldset className="maintenance-fieldset" disabled={dirty}>
            <DataTools
              onChanged={async () => {
                const latest = await api("settings");
                setForm(latest);
                setDirty(false);
                onSaved(latest);
              }}
            />
          </fieldset>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={close}>
            {t("m047")}
          </button>
          <button disabled={busy} className="primary-button">
            <Check size={16} />
            {busy ? t("m022") : t("m048")}
          </button>
        </footer>
      </form>
    </div>
  );
}
export function ResourceEditor({ resources, onChange, settings, onManage }) {
  const uploadRef = useRef(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [destination, setDestination] = useState(""),
    [showUpload, setShowUpload] = useState(false);
  const locations = settings.locations || [];
  const update = (i, patch) =>
    onChange(
      resources.map((r, j) =>
        j === i
          ? {
              ...r,
              label: r.label,
              path: r.path || r.url || "",
              locationId: resourceLocation(r),
              ...patch,
            }
          : r,
      ),
    );
  async function upload(file, isEmpty = false) {
    if (!destination.trim()) {
      setError(t("m049"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api(`documents?path=${encodeURIComponent(destination)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: isEmpty ? new Uint8Array() : file,
      });
      onChange([...resources, r]);
      setShowUpload(false);
      setDestination("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="resource-editor">
      <div className="editor-label">
        <span>{t("m050")}</span>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...resources,
              {
                label: "",
                locationId: locations[0]?.id || "",
                path: "",
              },
            ])
          }
        >
          <Plus size={14} />
          {t("m051")}
        </button>
      </div>
      {resources.map((r, i) => (
        <div className="resource-form" key={i}>
          <input
            aria-label={t("m052", i + 1)}
            placeholder={t("m053")}
            required
            value={r.label}
            onChange={(e) =>
              update(i, {
                label: e.target.value,
              })
            }
          />
          <div className="path-field">
            <select
              aria-label={t("m054", i + 1)}
              value={resourceLocation(r)}
              onChange={(e) =>
                e.target.value === "__manage"
                  ? onManage()
                  : update(i, {
                      locationId: e.target.value,
                    })
              }
            >
              {!locations.some((l) => l.id === resourceLocation(r)) && (
                <option value={resourceLocation(r)}>{t("m055")}</option>
              )}
              {locations.map((l) => (
                <option value={l.id} key={l.id}>
                  {locationLabel(locations, l.id)}
                </option>
              ))}
              <option value="__manage">{t("m056")}</option>
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label={t("m057", i + 1)}
              onClick={onManage}
            >
              <Plus size={16} />
            </button>
            <input
              aria-label={t("m388", i + 1)}
              placeholder={
                locations.find((l) => l.id === resourceLocation(r))?.kind ===
                "physical"
                  ? t("m058")
                  : t("m059")
              }
              required
              value={r.path || r.url || ""}
              onChange={(e) =>
                update(i, {
                  path: e.target.value,
                })
              }
            />
            <button
              type="button"
              className="icon-button"
              aria-label={t("m389", i + 1)}
              onClick={() => onChange(resources.filter((_, j) => j !== i))}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ))}
      <div className="attachment-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setShowUpload(!showUpload)}
        >
          <Upload size={15} />
          {t("m060")}
        </button>
        <button type="button" className="text-button" onClick={onManage}>
          <Settings size={15} />
          {t("m061")}
        </button>
      </div>
      {showUpload && (
        <div className="upload-box">
          <label>
            {t("m062")}
            <input
              value={destination}
              placeholder={t("m063")}
              onChange={(e) => setDestination(e.target.value)}
            />
          </label>
          <p className="field-help">{t("m064")}</p>
          <div className="attachment-actions">
            <button
              type="button"
              disabled={busy}
              className="secondary-button"
              onClick={() => uploadRef.current.click()}
            >
              {busy ? t("m065") : t("m066")}
            </button>
            <button
              type="button"
              disabled={busy || !/\.txt$/i.test(destination)}
              className="secondary-button"
              onClick={() => upload(null, true)}
            >
              {t("m067")}
            </button>
          </div>
          <input
            type="file"
            ref={uploadRef}
            hidden
            onChange={(e) => {
              const file = e.target.files[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
export function ResourceList({
  node,
  settings,
  env,
  onDocument,
  notify,
  physicalOnly = null,
}) {
  return node.resources
    .filter(
      (r) =>
        physicalOnly === null ||
        (settings.locations?.find((l) => l.id === resourceLocation(r))?.kind ===
          "physical") ===
          physicalOnly,
    )
    .map((r, i) => {
      const loc = settings.locations?.find((l) => l.id === resourceLocation(r)),
        value = r.path || r.url || "",
        web = loc?.kind === "web" && /^https?:\/\//i.test(value),
        physical = loc?.kind === "physical",
        localPC =
          loc?.kind === "device" && loc.id === "pc" && env.canOpenFolders,
        available = ["addon", "server", "web"].includes(loc?.kind) || localPC;
      return (
        <div key={r.id || i} className="resource resource-wrap">
          <div className="resource-line">
            {physical ? (
              <MapPin size={18} />
            ) : web ? (
              <ExternalLink size={18} />
            ) : (
              <FileText size={18} />
            )}
            <div>
              {available ? (
                <button
                  className="resource-title"
                  onClick={() =>
                    onDocument({
                      nodeId: node.id,
                      resourceId: r.id,
                      title: r.label,
                    })
                  }
                >
                  {r.label}
                </button>
              ) : (
                <span>{r.label}</span>
              )}
              {node.previewResourceId === r.id && (
                <small className="default-document">
                  {t("documents.doubleClickTarget")}
                </small>
              )}
              <small className="location-name">{loc?.name || t("m055")}</small>
              <small>{value}</small>
            </div>
            <button
              className="icon-button"
              aria-label={t("m068", r.label)}
              onClick={() =>
                navigator.clipboard
                  .writeText(value)
                  .then(() => notify(t("m069")))
                  .catch(() => notify(t("m070")))
              }
            >
              <Copy size={14} />
            </button>
          </div>
          <div className="resource-actions">
            {web && (
              <a href={value} target="_blank" rel="noreferrer">
                {t("m071")}
              </a>
            )}
            {available && (
              <button
                onClick={() =>
                  onDocument({
                    nodeId: node.id,
                    resourceId: r.id,
                    index: i,
                    title: r.label,
                  })
                }
              >
                {t("m072")}
              </button>
            )}
            {localPC && (
              <button
                onClick={async () => {
                  try {
                    await api(`nodes/${node.id}/resources/${r.id}/open`, {
                      method: "POST",
                      body: "{}",
                    });
                    notify(t("m073"));
                  } catch (e) {
                    notify(e.message);
                  }
                }}
              >
                <Folder size={13} />
                {t("m074")}
              </button>
            )}
            {!available && <small>{physical ? t("m075") : t("m076")}</small>}
          </div>
        </div>
      );
    });
}
