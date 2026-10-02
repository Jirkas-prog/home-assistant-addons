import React, { useSyncExternalStore } from "react";
import { Download, Upload, Pause, Play, X } from "lucide-react";
import { t, locale, localizeMessage } from "../shared/i18n.js";
import { backupTransfer } from "./backup-transfer.js";
import {
  formatBytes,
  formatDuration,
  formatPercent,
  transferPercent,
} from "./transfer-progress.js";

export function BackupTransferPanel({ floating = false }) {
  const state = useSyncExternalStore(
    backupTransfer.subscribe,
    backupTransfer.getSnapshot,
  );
  if (state.phase === "idle" || (floating && !backupTransfer.active))
    return null;
  const percentage = transferPercent(state.loaded, state.total);
  const transferring = state.phase === "transferring";
  const pausable =
    transferring || ["paused", "reconnecting"].includes(state.phase);
  const cancellable =
    backupTransfer.active &&
    !["saving", "cancelling", "merging"].includes(state.phase);
  const Icon = state.direction === "upload" ? Upload : Download;
  return (
    <section
      className={`backup-transfer ${floating ? "backup-transfer-floating" : ""}`}
      aria-label={t("transfer.title")}
    >
      <div className="backup-transfer-heading">
        <strong>
          <Icon size={18} />
          {t(
            state.purpose === "merge"
              ? "package.upload"
              : `transfer.${state.direction}`,
          )}
        </strong>
        <span role="status">
          {t(
            state.purpose === "merge" && state.phase === "verifying"
              ? "package.verifying"
              : `transfer.${state.phase}`,
          )}
        </span>
      </div>
      <div className="backup-transfer-numbers">
        <strong>{formatPercent(state.loaded, state.total, locale())}</strong>
        <span>
          {t(
            `transfer.${state.direction}Rate`,
            formatBytes(transferring ? state.rate : 0, locale()),
          )}
        </span>
        <span>
          {!transferring
            ? t("transfer.etaInactive")
            : state.eta == null
              ? t("transfer.etaUnknown")
              : t("transfer.eta", formatDuration(state.eta))}
        </span>
      </div>
      <progress
        max="100"
        value={percentage ?? undefined}
        aria-label={t(
          state.purpose === "merge"
            ? "package.upload"
            : `transfer.${state.direction}`,
        )}
        aria-valuetext={formatPercent(state.loaded, state.total, locale())}
      />
      <p className="field-help backup-transfer-size">
        {formatBytes(state.loaded, locale())}
        {state.total != null && ` / ${formatBytes(state.total, locale())}`}
      </p>
      {state.phase === "checking" && (
        <p role="status">
          {t(
            "transfer.checkingProgress",
            formatPercent(state.checked, state.checkTotal, locale()),
          )}
        </p>
      )}
      {state.phase === "reconnecting" && (
        <p className="field-help">{t("transfer.reconnectHelp")}</p>
      )}
      {state.phase === "merging" && (
        <p role="status">
          {t("package.applyingHelp")}
          {state.mergeProgress?.total != null &&
            ` (${state.mergeProgress.completed}/${state.mergeProgress.total})`}
        </p>
      )}
      <div className="data-actions">
        {pausable && (
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              state.phase === "paused"
                ? backupTransfer.resume()
                : backupTransfer.pause()
            }
          >
            {state.phase === "paused" ? (
              <Play size={16} />
            ) : (
              <Pause size={16} />
            )}
            {t(state.phase === "paused" ? "transfer.resume" : "transfer.pause")}
          </button>
        )}
        {cancellable && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => backupTransfer.cancel()}
          >
            <X size={16} />
            {t("transfer.cancel")}
          </button>
        )}
        {state.url && (
          <a
            className="primary-button"
            href={state.url}
            download={state.filename}
          >
            <Download size={16} />
            {t("transfer.save")}
          </a>
        )}
      </div>
      {state.error && (
        <p role="alert" className="error-banner">
          {localizeMessage(state.error)}
        </p>
      )}
      {state.url ? (
        <p className="field-help">{t("transfer.saveHelp")}</p>
      ) : (
        backupTransfer.active && (
          <p className="field-help">
            {t(
              state.direction === "upload"
                ? "transfer.uploadKept"
                : "transfer.keepOpen",
            )}
          </p>
        )
      )}
    </section>
  );
}
