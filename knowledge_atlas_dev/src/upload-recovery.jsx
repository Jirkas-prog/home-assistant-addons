import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Upload, X } from "lucide-react";
import { api, useDialogKeys } from "./client.js";
import { backupTransfer } from "./backup-transfer.js";
import { formatBytes, formatPercent } from "./transfer-progress.js";
import { t, locale, localizeMessage } from "../shared/i18n.js";

export function UploadRecovery({ onContinue }) {
  const transfer = useSyncExternalStore(
    backupTransfer.subscribe,
    backupTransfer.getSnapshot,
  );
  const [uploads, setUploads] = useState([]),
    [collapsed, setCollapsed] = useState(false);
  const refreshRef = useRef();
  useEffect(() => {
    let stopped = false,
      pending = false;
    const refresh = async () => {
      if (pending || backupTransfer.active) return;
      pending = true;
      try {
        const result = await api("backup-transfers");
        if (!stopped) setUploads(result.uploads);
      } catch {
        /* Retry on return to the app or when the connection returns. */
      } finally {
        pending = false;
      }
    };
    refreshRef.current = refresh;
    refresh();
    const timer = setInterval(refresh, 10000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    if (!backupTransfer.active) refreshRef.current?.();
  }, [transfer.phase]);
  const available = uploads.filter(
    (upload) =>
      upload.preview?.id !== transfer.preview?.id || !transfer.preview,
  );
  if (backupTransfer.active || !available.length) return null;
  if (collapsed)
    return (
      <button
        className="upload-recovery-reminder secondary-button"
        onClick={() => setCollapsed(false)}
      >
        <Upload size={16} />
        {t("transfer.unfinished", available.length)}
      </button>
    );
  return (
    <RecoveryDialog
      uploads={available}
      onClose={() => setCollapsed(true)}
      onRemoved={() => refreshRef.current?.()}
      onResume={(upload, file) => {
        setCollapsed(true);
        onContinue();
        backupTransfer.start("upload", file, upload);
      }}
    />
  );
}

function RecoveryDialog({ uploads, onClose, onResume, onRemoved }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const fileInput = useRef(),
    selected = useRef();
  useDialogKeys(React, onClose);
  return (
    <div className="upload-recovery-backdrop">
      <section
        className="upload-recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-recovery-title"
        aria-describedby="upload-recovery-help"
      >
        <div className="backup-transfer-heading">
          <h2 id="upload-recovery-title">{t("transfer.recoveryTitle")}</h2>
          <button
            className="icon-button"
            aria-label={t("transfer.later")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p id="upload-recovery-help">{t("transfer.recoveryHelp")}</p>
        {uploads.map((upload, index) => (
          <article key={upload.id} className="upload-recovery-item">
            <strong>{upload.source?.name || upload.filename}</strong>
            <p>
              {formatPercent(upload.offset, upload.total, locale())} ·{" "}
              {formatBytes(upload.offset, locale())} /{" "}
              {formatBytes(upload.total, locale())}
            </p>
            <p className="field-help">
              {t(
                upload.offset === upload.total
                  ? "transfer.alreadyUploaded"
                  : "transfer.selectOriginal",
              )}
            </p>
            <div className="data-actions">
              <button
                type="button"
                autoFocus={index === 0}
                disabled={busy}
                className="primary-button"
                onClick={() => {
                  if (upload.offset === upload.total) onResume(upload, null);
                  else {
                    selected.current = upload;
                    fileInput.current.click();
                  }
                }}
              >
                {t("transfer.resumeUpload")}
              </button>
              <button
                type="button"
                disabled={busy}
                className="secondary-button"
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await api(`backup-transfers/${upload.id}`, {
                      method: "DELETE",
                      body: "{}",
                    });
                    await onRemoved();
                  } catch (e) {
                    setError(localizeMessage(e.message));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("transfer.cancel")}
              </button>
            </div>
          </article>
        ))}
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file && selected.current) onResume(selected.current, file);
          }}
        />
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        <button className="secondary-button" onClick={onClose}>
          {t("transfer.later")}
        </button>
      </section>
    </div>
  );
}
