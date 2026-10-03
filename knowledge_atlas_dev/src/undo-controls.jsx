import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Undo2, Redo2 } from "lucide-react";
import { api, mutationCount, subscribeMutations } from "./client.js";
import { t, localizeMessage } from "../shared/i18n.js";
import { undoShortcut } from "./undo-shortcut.js";
import "./undo.css";

export function UndoControls({ remote, onChanged, disabled }) {
  const [status, setStatus] = useState(remote || {}),
    [error, setError] = useState(""),
    [traveling, setTraveling] = useState(false);
  const pending = useSyncExternalStore(subscribeMutations, mutationCount);
  const busy = useRef(false),
    request = useRef(0);
  useEffect(() => {
    if (remote) setStatus(remote);
  }, [remote]);
  useEffect(() => {
    if (pending) return;
    const id = ++request.current;
    api("undo")
      .then((value) => {
        if (request.current === id) setStatus(value);
      })
      .catch((err) => {
        if (request.current === id) setError(err.message);
      });
    return () => {
      request.current++;
    };
  }, [pending]);
  async function travel(direction) {
    if (
      busy.current ||
      disabled ||
      pending ||
      !status[direction] ||
      status.error
    )
      return;
    busy.current = true;
    setTraveling(true);
    setError("");
    try {
      const result = await api(`undo/${direction}`, {
        method: "POST",
        body: JSON.stringify({ revision: status.revision }),
      });
      setStatus(result);
      await onChanged();
    } catch (err) {
      setError(err.message);
      try {
        setStatus(await api("undo"));
      } catch {}
    } finally {
      busy.current = false;
      setTraveling(false);
    }
  }
  useEffect(() => {
    const key = (event) => {
      const direction = undoShortcut(event);
      if (!direction || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      travel(direction);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return (
    <div className="undo-controls" role="group" aria-label={t("undo.history")}>
      {["undo", "redo"].map((direction) => {
        const action = status[`${direction}Action`],
          Icon = direction === "undo" ? Undo2 : Redo2;
        const label = t(`undo.${direction}`),
          count = status[direction] || 0;
        const detail = action
          ? t(`undo.action.${action.kind}`) +
            (action.title ? `: ${action.title}` : "")
          : t("undo.empty");
        return (
          <button
            key={direction}
            type="button"
            className="secondary-button"
            aria-label={t("undo.available", label, count)}
            title={`${label}: ${detail} · ${t("undo.capacity", status.limit || 1000)}`}
            disabled={
              disabled || !!pending || traveling || !!status.error || !count
            }
            onClick={() => travel(direction)}
          >
            <Icon size={17} />
            <span className="undo-label">{label}</span>
            <span className="undo-count">{count}</span>
          </button>
        );
      })}
      {(error || status.error) && (
        <span className="undo-error" role="alert">
          {localizeMessage(error || status.error)}
        </span>
      )}
    </div>
  );
}
