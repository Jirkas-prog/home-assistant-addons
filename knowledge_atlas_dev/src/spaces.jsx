import { Select } from "./select.jsx";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  Layers3,
  Plus,
  Settings2,
  Star,
  X,
  Cat,
  ArrowUpRight,
} from "lucide-react";
import {
  api,
  useDialogKeys,
  mutationCount,
  subscribeMutations,
} from "./client.js";
import { backupTransfer } from "./backup-transfer.js";
import { getLanguage, t } from "../shared/i18n.js";
import "./spaces.css";
import { useCatMotion } from "./cat-motion.js";

export const spaceName = (space) =>
  space.id === "general" && space.name === "General"
    ? t("spaces.general")
    : space.name;
export function spaceHref(id) {
  return /\/spaces\/[^/]+\/$/.test(location.pathname)
    ? `../${encodeURIComponent(id)}/`
    : `./spaces/${encodeURIComponent(id)}/`;
}

export function SpaceBar({ settings, onSettings }) {
  const reduced = useCatMotion(settings.catMotion);
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [dialog, setDialog] = useState(null),
    [busy, setBusy] = useState(false);
  useSyncExternalStore(backupTransfer.subscribe, backupTransfer.getSnapshot);
  const mutations = useSyncExternalStore(subscribeMutations, mutationCount);
  const load = async () => {
    try {
      setData(await api("spaces"));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);
  const blocked = busy || mutations > 0 || backupTransfer.active;
  const current = data?.spaces.find((space) => space.id === data.currentId);
  return (
    <>
      <div className="space-bar">
        <div className="space-picker">
          <span className="space-emblem">
            <Layers3 size={21} />
          </span>
          <label className="space-select">
            <span>{t("spaces.label")}</span>
            <Select
              aria-label={t("spaces.label")}
              value={data?.currentId || ""}
              disabled={!data || blocked}
              onChange={(e) => {
                if (e.target.value === "__new") setDialog("new");
                else if (e.target.value !== data.currentId)
                  location.assign(spaceHref(e.target.value));
              }}
            >
              {!data && <option value="">{t("spaces.loading")}</option>}
              {data?.spaces.map((space) => (
                <option value={space.id} key={space.id}>
                  {spaceName(space)}
                  {space.id === data.defaultId
                    ? ` · ${t("spaces.default")}`
                    : ""}
                </option>
              ))}
              {data && <option value="__new">+ {t("spaces.new")}</option>}
            </Select>
          </label>
          <button
            className="icon-button space-new"
            disabled={!data || blocked}
            title={t("spaces.new")}
            aria-label={t("spaces.new")}
            onClick={() => setDialog("new")}
          >
            <Plus size={19} />
          </button>
          <button
            className="icon-button space-manage"
            disabled={!data || busy}
            title={t("spaces.manage")}
            aria-label={t("spaces.manage")}
            onClick={() => setDialog("manage")}
          >
            <Settings2 size={18} />
          </button>
        </div>
        <button
          className={`cat-toggle ${settings.catEnabled !== false ? "enabled" : ""}`}
          aria-pressed={settings.catEnabled !== false}
          aria-label={t("cat.toggle")}
          title={t(settings.catEnabled !== false ? "cat.hide" : "cat.show")}
          disabled={!settings.revision || busy || mutations > 0}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              onSettings(
                await api("settings", {
                  method: "PUT",
                  body: JSON.stringify({
                    ...settings,
                    catEnabled: settings.catEnabled === false,
                  }),
                }),
              );
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Cat size={21} />
          <span>
            {t("cat.name")}
            <small>
              {t(
                settings.catEnabled === false
                  ? "cat.sleeping"
                  : reduced
                    ? "cat.stillStatus"
                    : "cat.roaming",
              )}
            </small>
          </span>
          <i />
        </button>
      </div>
      {error && (
        <div className="space-message" role="alert">
          {error} <button onClick={load}>{t("spaces.retry")}</button>
        </div>
      )}
      {backupTransfer.active && (
        <p className="space-message">{t("spaces.transfer")}</p>
      )}
      {dialog &&
        data &&
        createPortal(
          <SpacesDialog
            key={dialog}
            mode={dialog}
            data={data}
            current={current}
            blocked={blocked}
            onClose={() => setDialog(null)}
            onChanged={setData}
          />,
          document.body,
        )}
    </>
  );
}

function SpacesDialog({ mode, data, current, blocked, onChanged, onClose }) {
  const [name, setName] = useState(mode === "new" ? "" : spaceName(current));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const close = () => {
    if (!busy) onClose();
  };
  useDialogKeys(React, close);
  const update = async (id, body) => {
    setBusy(true);
    setError("");
    try {
      onChanged(
        await api(`spaces/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop upper-modal">
      <section
        className="modal spaces-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spaces-title"
      >
        <header>
          <span className="space-emblem">
            <Layers3 size={24} />
          </span>
          <h2 id="spaces-title">
            {t(mode === "new" ? "spaces.new" : "spaces.manage")}
          </h2>
          <button
            className="icon-button"
            aria-label={t("spaces.close")}
            disabled={busy}
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <div className="editor-body">
          <p className="space-help">{t("spaces.help")}</p>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (mode === "manage") {
                await update(current.id, { name });
                return;
              }
              setBusy(true);
              setError("");
              try {
                const result = await api("spaces", {
                  method: "POST",
                  body: JSON.stringify({ name, language: getLanguage() }),
                });
                onChanged(result);
                location.assign(spaceHref(result.createdId));
              } catch (err) {
                setError(err.message);
                setBusy(false);
              }
            }}
          >
            <label>
              {t("spaces.name")}
              <input
                autoFocus
                required
                maxLength={80}
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("spaces.example")}
              />
            </label>
            {mode === "new" && (
              <div className="space-suggestions">
                {["work", "personal"].map((key) => (
                  <button
                    type="button"
                    className="secondary-button"
                    key={key}
                    disabled={busy}
                    onClick={() => setName(t(`spaces.${key}`))}
                  >
                    {t(`spaces.${key}`)}
                  </button>
                ))}
              </div>
            )}
            <button
              type="submit"
              className="primary-button"
              disabled={busy || (mode === "new" && blocked)}
            >
              {t(
                busy
                  ? "spaces.saving"
                  : mode === "new"
                    ? "spaces.create"
                    : "spaces.rename",
              )}
            </button>
          </form>
          {mode === "manage" && (
            <div className="space-list">
              {data.spaces.map((space) => (
                <div className="space-row" key={space.id}>
                  <a
                    href={spaceHref(space.id)}
                    target="_blank"
                    rel="noopener"
                    title={t("spaces.openTab")}
                  >
                    <Layers3 size={18} />
                    <span>
                      {spaceName(space)}
                      <small>
                        {space.id === data.currentId
                          ? t("spaces.current")
                          : t("spaces.openTab")}
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
                  </a>
                  <button
                    className={`secondary-button ${space.id === data.defaultId ? "is-default" : ""}`}
                    disabled={busy || space.id === data.defaultId}
                    onClick={() => update(space.id, { makeDefault: true })}
                    aria-label={t("spaces.defaultFor", spaceName(space))}
                  >
                    <Star
                      size={15}
                      fill={
                        space.id === data.defaultId ? "currentColor" : "none"
                      }
                    />
                    {t(
                      space.id === data.defaultId
                        ? "spaces.default"
                        : "spaces.setDefault",
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="field-help">
            {t(mode === "new" ? "spaces.emptyHelp" : "spaces.backupHelp")}
          </p>
        </div>
      </section>
    </div>
  );
}
