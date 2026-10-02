import React, { useEffect, useState } from "react";
import { t, locale } from "../shared/i18n.js";
import { formatPercent, formatDuration } from "./transfer-progress.js";

export function IndexProgress({ state }) {
  const [now, setNow] = useState(Date.now);
  const phase = state?.phase;
  useEffect(() => {
    setNow(Date.now());
    if (["building", "waiting"].includes(phase)) {
      const timer = setInterval(() => setNow(Date.now()), 500);
      return () => clearInterval(timer);
    }
    if (phase === "ready") {
      const timer = setTimeout(() => setNow(Date.now()), 5000);
      return () => clearTimeout(timer);
    }
  }, [phase, state?.startedAt, state?.finishedAt]);
  if (!state || phase === "checking") return null;
  const complete = phase === "ready";
  // Server elapsed time avoids depending on matching browser and server clocks.
  const elapsed =
    Math.max(
      0,
      (state.elapsedMs || 0) +
        (!complete ? Math.max(0, now - state.receivedAt) : 0),
    ) / 1000;
  if (
    complete &&
    (state.ageMs || 0) + Math.max(0, now - state.receivedAt) >= 5000
  )
    return null;
  if (phase === "error")
    return (
      <div className="error-banner" role="status">
        {t("sync.indexError")}
      </div>
    );
  const percent = complete
    ? 100
    : Math.min(99.99, state.total ? (state.processed / state.total) * 100 : 0);
  const eta =
    !complete && state.processed > 0 && state.processed < state.total
      ? (elapsed / state.processed) * (state.total - state.processed)
      : null;
  return (
    <section
      className="backup-transfer index-progress"
      aria-label={t("sync.indexTitle")}
    >
      <div className="backup-transfer-heading">
        <strong role="status">
          {t(complete ? "sync.indexReady" : "sync.indexTitle")}
        </strong>
        <span>
          {t(
            "sync.indexRecords",
            state.processed.toLocaleString(locale()),
            state.total.toLocaleString(locale()),
          )}
        </span>
      </div>
      <div className="backup-transfer-numbers">
        <strong>{formatPercent(percent, 100, locale())}</strong>
        <span>{t("sync.elapsed", formatDuration(elapsed))}</span>
        {!complete && (
          <span>
            {eta == null
              ? t("transfer.etaUnknown")
              : t("transfer.eta", formatDuration(eta))}
          </span>
        )}
      </div>
      <progress max="100" value={percent} aria-label={t("sync.indexTitle")} />
      {!complete && <p className="field-help">{t("sync.background")}</p>}
    </section>
  );
}
