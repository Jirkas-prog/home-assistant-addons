import { useEffect, useState } from "react";
import { api } from "./client.js";
import { t } from "../shared/i18n.js";
const NO_MATCHES = new Set();

// Overview payloads cannot be edited. Fetch only the record being opened.
export function useRecord(summary, enabled) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const id = summary?.id,
    revision = summary?.revision;
  useEffect(() => {
    if (!enabled || !summary?.partial) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let active = true;
    setResult(null);
    api(`nodes/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((node) => {
        if (active) setResult({ id, revision, node });
      })
      .catch((error) => {
        if (active)
          setResult({
            id,
            revision,
            error: controller.signal.aborted
              ? t("workspace.recordTimeout")
              : error.message,
          });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [id, revision, enabled, summary?.partial, attempt]);
  const current =
    result?.id === id && result?.revision === revision ? result : null;
  return {
    node: summary?.partial ? current?.node || summary : summary,
    error: current?.error,
    retry: () => setAttempt((n) => n + 1),
  };
}

export function useRecordSearch(query, enabled, revision) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const key = query.trim();
  useEffect(() => {
    if (!enabled || !key) return;
    const controller = new AbortController();
    let active = true,
      timeout;
    const timer = setTimeout(() => {
      timeout = setTimeout(() => controller.abort(), 60_000);
      api(`search?q=${encodeURIComponent(key)}`, { signal: controller.signal })
        .then((value) => {
          if (active) setResult({ key, revision, ids: new Set(value.ids) });
        })
        .catch((error) => {
          if (active)
            setResult({
              key,
              revision,
              error: controller.signal.aborted
                ? t("workspace.searchTimeout")
                : error.message,
            });
        })
        .finally(() => clearTimeout(timeout));
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [key, enabled, revision, attempt]);
  const current =
    result?.key === key && result?.revision === revision ? result : null;
  return {
    ids: enabled && key ? current?.ids || NO_MATCHES : null,
    pending: !!(enabled && key && !current),
    error: enabled && key ? current?.error : null,
    retry: () => {
      setResult(null);
      setAttempt((n) => n + 1);
    },
  };
}
