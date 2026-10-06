import React, {
  useState,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  Download,
  Upload,
  ShieldCheck,
  Wrench,
  ArrowRight,
  X,
} from "lucide-react";
import { api } from "./client.js";
import { t, locale, localizeMessage } from "../shared/i18n.js";
import { backupTransfer } from "./backup-transfer.js";
import { BackupTransferPanel } from "./backup-transfer-panel.jsx";
import { PackagePreview } from "./package-preview.jsx";
import { BACKUP_PARTS } from "../shared/backup-selection.js";

export function DataTools({ onChanged, backupOnly = false }) {
  const transfer = useSyncExternalStore(
    backupTransfer.subscribe,
    backupTransfer.getSnapshot,
  );
  const [coverage, setCoverage] = useState(null);
  const [selection, setSelection] = useState([]);
  const [working, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState(null),
    [migration, setMigration] = useState(null),
    [diagnostics, setDiagnostics] = useState(null),
    [repair, setRepair] = useState(null),
    [confirmed, setConfirmed] = useState(false);
  const busy = working || backupTransfer.active;
  const previousMerge = useRef(transfer.mergeResult);
  useEffect(() => {
    setPreview(transfer.preview);
    setConfirmed(false);
  }, [transfer.preview]);
  useEffect(() => {
    if (
      transfer.mergeResult &&
      previousMerge.current !== transfer.mergeResult
    ) {
      Promise.resolve(onChanged()).catch((e) => setError(e.message));
      refreshCoverage();
    }
    previousMerge.current = transfer.mergeResult;
  }, [transfer.mergeResult]);
  const refreshCoverage = () =>
    api("backups/summary")
      .then(setCoverage)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refreshCoverage();
  }, []);
  async function run(action) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file, purpose = "restore") {
    if (!file) return;
    await run(async () => {
      if (preview)
        await api(`backups/${preview.id}`, { method: "DELETE", body: "{}" });
      setPreview(null);
      await backupTransfer.clearPreview();
      setConfirmed(false);
      await backupTransfer.start("upload", file, null, purpose);
    });
  }
  return (
    <section className="data-tools">
      <div className="editor-label">
        <span>
          <ShieldCheck size={18} />{" "}
          {t(backupOnly ? "backup.contents" : "data.title")}
        </span>
      </div>
      <p className="field-help">{t("data.description")}</p>
      {coverage && (
        <div className="backup-coverage">
          <h3>{t("backup.full")}</h3>
          <div className="backup-metrics">
            <div>
              <strong>{coverage.records}</strong>
              <span>{t("backup.records")}</span>
            </div>
            <div>
              <strong>{coverage.files}</strong>
              <span>{t("backup.files")}</span>
            </div>
            <div>
              <strong>{coverage.documents}</strong>
              <span>{t("backup.documents")}</span>
            </div>
            <div>
              <strong>
                {(coverage.bytes / 1024).toLocaleString(locale(), {
                  maximumFractionDigits: 1,
                })}
              </strong>
              <span>KiB</span>
            </div>
          </div>
          <p>{t("backup.included")}</p>
          <p className="field-help">
            {t("backup.references", coverage.externalReferences)}
          </p>
          <p className="field-help">{t("backup.drafts")}</p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={refreshCoverage}
          >
            {t("backup.refresh")}
          </button>
        </div>
      )}
      <fieldset className="backup-selection" disabled={busy}>
        <legend>{t("backup.selection")}</legend>
        <label>
          <input
            type="checkbox"
            checked={!selection.length}
            onChange={() => setSelection([])}
          />
          {t("backup.full")}
        </label>
        {BACKUP_PARTS.map((part) => (
          <label key={part}>
            <input
              type="checkbox"
              checked={selection.includes(part)}
              onChange={(e) =>
                setSelection((old) =>
                  e.target.checked
                    ? [...old, part]
                    : old.filter((p) => p !== part),
                )
              }
            />
            {t(`backup.part.${part}`)}
          </label>
        ))}
        <p className="field-help">
          {t(selection.length ? "backup.selectionHelp" : "backup.fullHelp")}
        </p>
      </fieldset>
      <div className="data-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            setError("");
            backupTransfer.start(
              "download",
              null,
              null,
              "restore",
              selection.length ? selection : undefined,
            );
          }}
        >
          <Download size={16} />
          {t(selection.length ? "backup.downloadSelected" : "data.backup")}
        </button>
        <label className="secondary-button upload-label">
          <Upload size={16} />
          {t("data.upload")}
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                run(async () => {
                  if (preview)
                    await api(`backups/${preview.id}`, {
                      method: "DELETE",
                      body: "{}",
                    });
                  setPreview(null);
                  await backupTransfer.clearPreview();
                  setConfirmed(false);
                  await backupTransfer.start("upload", file);
                });
            }}
          />
        </label>
        <label className="secondary-button upload-label">
          <Upload size={16} />
          {t("package.upload")}
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              upload(file, "merge");
            }}
          />
        </label>
        {!backupOnly && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              run(async () => setMigration(await api("migrations")))
            }
          >
            <ArrowRight size={16} />
            {t("data.migrate")}
          </button>
        )}
        {!backupOnly && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              run(async () => setDiagnostics(await api("maintenance")))
            }
          >
            <Wrench size={16} />
            {t("data.diagnostics")}
          </button>
        )}
      </div>
      <BackupTransferPanel />
      {transfer.mergeResult && (
        <p className="document-message" role="status">
          {t(
            "package.result",
            transfer.mergeResult.added,
            transfer.mergeResult.replaced,
            transfer.mergeResult.kept,
            transfer.mergeResult.documents,
          )}
        </p>
      )}
      {working && !backupTransfer.active && (
        <p role="status">{t("data.busy")}</p>
      )}
      {message && (
        <p className="document-message" role="status">
          {localizeMessage(message)}
        </p>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {preview?.kind === "merge" && (
        <PackagePreview
          preview={preview}
          busy={busy}
          onApply={(options) => backupTransfer.merge(preview, options)}
          onRefresh={() =>
            backupTransfer.start("upload", null, backupTransfer.session)
          }
          onDiscard={() =>
            run(async () => {
              await api(`backups/${preview.id}`, {
                method: "DELETE",
                body: "{}",
              });
              await backupTransfer.clearPreview();
              setPreview(null);
            })
          }
        />
      )}
      {preview && preview.kind !== "merge" && (
        <div className="data-panel">
          <h3>{t("data.restorePreview")}</h3>
          {preview.checksumVerified && (
            <p className="backup-verified">
              <ShieldCheck size={18} />
              {t("backup.verified")}
            </p>
          )}
          {preview.backupCreated && (
            <p>
              {t(
                "backup.created",
                new Date(preview.backupCreated).toLocaleString(locale()),
              )}
            </p>
          )}
          {!preview.includesHistory && (
            <p role="alert">{t("backup.noHistory")}</p>
          )}
          <p>
            {t(
              "data.counts",
              preview.records,
              preview.files,
              (preview.bytes / 1024 ** 2).toLocaleString(locale(), {
                maximumFractionDigits: 1,
              }),
            )}
          </p>
          <p>{t("data.collisions", preview.collisions.length)}</p>
          <p>
            {t("data.portable")} <code>{preview.documentRoot}</code>
          </p>
          <p>
            {t("data.preserved")} <code>{preview.rollbackDirectory}</code>
          </p>
          <p className="field-help">{t("data.external")}</p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t("data.confirm")}
          </label>
          <div className="data-actions">
            <button
              type="button"
              className="primary-button"
              disabled={busy || !confirmed}
              onClick={() =>
                run(async () => {
                  await api(`backups/${preview.id}/restore`, {
                    method: "POST",
                    body: JSON.stringify({ revision: preview.revision }),
                  });
                  setPreview(null);
                  await backupTransfer.clearPreview();
                  setMessage(t("data.restored"));
                  await onChanged();
                  await refreshCoverage();
                })
              }
            >
              {t("data.restore")}
            </button>
            <button
              type="button"
              disabled={busy}
              className="secondary-button"
              onClick={() =>
                run(async () => {
                  await api(`backups/${preview.id}`, {
                    method: "DELETE",
                    body: "{}",
                  });
                  setPreview(null);
                  await backupTransfer.clearPreview();
                })
              }
            >
              <X size={15} />
              {t("data.discard")}
            </button>
          </div>
        </div>
      )}
      {migration && (
        <div className="data-panel">
          <h3>{t("data.migrationPreview")}</h3>
          <p>{t("data.migrationCount", migration.files.length)}</p>
          <p className="field-help">{t("data.migrationHelp")}</p>
          {migration.errors.map((e, i) => (
            <p className="error-banner" key={i}>
              {e.file}: {localizeMessage(e.message)}
            </p>
          ))}
          <button
            type="button"
            className="primary-button"
            disabled={
              busy || migration.errors.length > 0 || !migration.files.length
            }
            onClick={() =>
              run(async () => {
                const result = await api("migrations", {
                  method: "POST",
                  body: JSON.stringify({ revision: migration.revision }),
                });
                setMigration(await api("migrations"));
                setMessage(t("data.migrated", result.changed));
                await onChanged();
              })
            }
          >
            {t("data.applyMigration")}
          </button>
        </div>
      )}
      {diagnostics && (
        <div className="data-panel">
          <h3>{t("data.diagnostics")}</h3>
          <p>
            {t("data.version", diagnostics.version)} ·{" "}
            {new Date(diagnostics.checkedAt).toLocaleString(locale())}
          </p>
          <p>
            {t(
              "data.free",
              diagnostics.freeBytes == null
                ? "?"
                : (diagnostics.freeBytes / 1024 ** 3).toLocaleString(locale(), {
                    maximumFractionDigits: 1,
                  }),
            )}
          </p>
          {diagnostics.errors.length ? (
            diagnostics.errors.map((e, i) => (
              <div className="diagnostic-row" key={i}>
                <span>
                  <code>{e.file}</code>
                  <br />
                  {localizeMessage(e.message)}
                </span>
                {e.file !== "graph" && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      run(async () =>
                        setRepair(
                          await api(`repair/${encodeURIComponent(e.file)}`),
                        ),
                      )
                    }
                  >
                    {t("data.repair")}
                  </button>
                )}
              </div>
            ))
          ) : (
            <p>{t("data.healthy")}</p>
          )}
          <p className="field-help">
            {t("data.operations")}{" "}
            <code>{diagnostics.operationsDirectory}</code>
          </p>
        </div>
      )}
      {repair && (
        <div className="data-panel">
          <h3>
            {t("data.repair")} · {repair.file}
          </h3>
          <p className="field-help">{t("data.repairHelp")}</p>
          <textarea
            className="repair-editor"
            spellCheck={false}
            aria-label={t("data.repairText")}
            value={repair.body}
            onChange={(e) => setRepair({ ...repair, body: e.target.value })}
          />
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(`repair/${encodeURIComponent(repair.file)}`, {
                  method: "PUT",
                  body: JSON.stringify(repair),
                });
                setRepair(null);
                setDiagnostics(await api("maintenance"));
                setMessage(t("data.repaired"));
                await onChanged();
              })
            }
          >
            {t("data.saveRepair")}
          </button>
        </div>
      )}
    </section>
  );
}
