import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  ChevronDown,
  Check,
  BookOpen,
  FileText,
  Folder,
  X,
} from "lucide-react";
import { t } from "../shared/i18n.js";
import { useDialogKeys } from "./client.js";
import "./quick-create.css";

const TYPES = [
  ["task", Check],
  ["journal", BookOpen],
  ["knowledge", FileText],
  ["project", Folder],
];

export function CaptureDialog({ onClose, onCreate, kinds, description }) {
  useDialogKeys(React, onClose);
  const first = useRef();
  useEffect(() => first.current?.focus(), []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal quick-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-create-title"
      >
        <header>
          <h2 id="quick-create-title">{t("capture.title")}</h2>
          <button
            className="icon-button"
            aria-label={t("m188")}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <p>{description || t("capture.help")}</p>
        <div className="quick-create-options">
          {TYPES.filter(([kind]) => !kinds || kinds.includes(kind)).map(
            ([kind, Icon], index) => (
              <button
                key={kind}
                ref={index === 0 ? first : undefined}
                onClick={() => onCreate(kind)}
              >
                <Icon size={22} aria-hidden="true" />
                <span>
                  <strong>{t(`capture.${kind}`)}</strong>
                  <small>{t(`capture.${kind}Help`)}</small>
                </span>
              </button>
            ),
          )}
        </div>
        {!kinds && (
          <small className="quick-create-hint">{t("capture.shortcut")}</small>
        )}
      </section>
    </div>,
    document.body,
  );
}

export function QuickCreate({ children, disabled, onCreate }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e) => {
      if (
        disabled ||
        e.defaultPrevented ||
        e.repeat ||
        e.isComposing ||
        e.ctrlKey ||
        e.metaKey ||
        !e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== "n" ||
        e.target?.closest?.(
          "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
        ) ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [data-select-popup]',
        )
      )
        return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [disabled]);
  return (
    <div className={`quick-create ${children ? "quick-create-split" : ""}`}>
      {children}
      <button
        className={
          children
            ? "primary-button quick-create-toggle"
            : "secondary-button quick-create-toggle"
        }
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={t("capture.title")}
        aria-keyshortcuts="Alt+N"
        title={`${t("capture.title")} (Alt+N)`}
        onClick={() => setOpen(true)}
      >
        {children ? (
          <ChevronDown size={17} />
        ) : (
          <>
            <Plus size={17} />
            <span>{t("capture.add")}</span>
          </>
        )}
      </button>
      {open && (
        <CaptureDialog
          onClose={() => setOpen(false)}
          onCreate={(kind) => {
            setOpen(false);
            onCreate(kind);
          }}
        />
      )}
    </div>
  );
}
