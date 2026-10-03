import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./client.js";
import { applyMapPositions } from "./map-positions.js";
import { t } from "../shared/i18n.js";

export function useMapPositions(nodes, computed, remote, slot, refresh) {
  const [draft, setDraft] = useState(null),
    [error, setError] = useState("");
  const busy = useRef(false),
    latest = useRef(remote);
  latest.current = remote;
  useEffect(() => {
    if (
      draft?.ack &&
      (remote.revision === draft.ack || remote.revision !== draft.revision)
    )
      setDraft(null);
  }, [remote.revision, draft]);
  const unsaved = !!draft && !draft.ack;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  const saved = draft?.slot === slot ? draft.positions : remote.views?.[slot];
  const positions = useMemo(
    () => applyMapPositions(nodes, computed, saved || []),
    [nodes, computed, saved],
  );
  async function save(
    positions,
    target = slot,
    expected = latest.current.revision,
  ) {
    if (busy.current) return;
    busy.current = true;
    const pending = { slot: target, positions, revision: expected };
    setDraft(pending);
    setError("");
    try {
      const result = await api(`map-positions/${encodeURIComponent(target)}`, {
        method: "PUT",
        body: JSON.stringify({ positions, revision: expected }),
      });
      latest.current = result;
      setDraft({ ...pending, ack: result.revision });
      refresh();
    } catch (err) {
      // Keep the unsaved arrangement visible. A conflicting overwrite needs an
      // explicit retry using the current server revision, never a silent retry.
      setError(
        err.status === 409 ? t("map.positionsConflict") : t("map.saveFailed"),
      );
    } finally {
      busy.current = false;
    }
  }
  return {
    positions,
    error,
    saving: !!draft && !error,
    disabled: !!remote.invalid || !remote.revision || !!draft,
    save,
    retry: async () => {
      if (!draft) return;
      try {
        const current = await api("map-positions");
        await save(draft.positions, draft.slot, current.revision);
      } catch {
        setError(t("map.saveFailed"));
      }
    },
    reset: () => save(null),
  };
}
