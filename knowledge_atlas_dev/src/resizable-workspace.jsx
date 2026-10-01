import React, { useEffect, useRef, useState } from "react";
import { release } from "../shared/release.js";
import { t } from "../shared/i18n.js";
import "./resizable-workspace.css";

const storageKey = `${release.slug}:details-width`;
const minimumWidth = 260;
const minimumContentWidth = 280;

function readWidth() {
  try {
    const value = Number(localStorage.getItem(storageKey));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function saveWidth(value) {
  try {
    if (value === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, String(value));
  } catch {
    // Resizing remains available when browser storage is disabled.
  }
}

export function ResizableWorkspace({ detail, children }) {
  const workspaceRef = useRef(null);
  const dragRef = useRef(null);
  const [preferredWidth, setPreferredWidth] = useState(readWidth);
  const preferredRef = useRef(preferredWidth);
  const [resizing, setResizing] = useState(false);
  const [layout, setLayout] = useState({ width: 0, defaultWidth: 320 });
  const maximumWidth = Math.max(
    minimumWidth,
    layout.width - minimumContentWidth,
  );
  const clamp = (value) =>
    Math.round(Math.min(maximumWidth, Math.max(minimumWidth, value)));
  const width = clamp(preferredWidth ?? layout.defaultWidth);

  useEffect(() => {
    const element = workspaceRef.current;
    const measure = () => {
      const defaultWidth =
        parseFloat(
          getComputedStyle(element).getPropertyValue("--details-default-width"),
        ) || 320;
      const nextWidth = element.clientWidth;
      setLayout((previous) =>
        previous.width === nextWidth && previous.defaultWidth === defaultWidth
          ? previous
          : { width: nextWidth, defaultWidth },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [detail]);

  useEffect(() => {
    if (!detail) {
      dragRef.current = null;
      setResizing(false);
    }
  }, [detail]);

  const updateWidth = (value, persist = false) => {
    preferredRef.current = value;
    setPreferredWidth(value);
    if (persist) saveWidth(value);
  };
  const finishDrag = (event, cancel = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (cancel) updateWidth(drag.previousWidth);
    else saveWidth(preferredRef.current);
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={workspaceRef}
      className={`workspace ${detail ? "with-detail" : ""} ${resizing ? "resizing-details" : ""}`}
      style={{ "--details-width": `${width}px` }}
    >
      {children}
      {detail && (
        <div
          className="details-resize-handle"
          role="separator"
          tabIndex={0}
          aria-label={t("layout.resizeDetails")}
          aria-description={t("layout.resizeHint")}
          aria-orientation="vertical"
          aria-controls="record-details"
          aria-valuemin={minimumWidth}
          aria-valuemax={maximumWidth}
          aria-valuenow={width}
          aria-valuetext={t("layout.detailsWidth", width)}
          title={t("layout.resizeHint")}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              width,
              previousWidth: preferredRef.current,
            };
            setResizing(true);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (drag?.pointerId === event.pointerId)
              updateWidth(clamp(drag.width + drag.x - event.clientX));
          }}
          onPointerUp={finishDrag}
          onPointerCancel={(event) => finishDrag(event, true)}
          onLostPointerCapture={finishDrag}
          onDoubleClick={() => updateWidth(null, true)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 60 : 20;
            let next;
            if (event.key === "ArrowLeft") next = width + step;
            else if (event.key === "ArrowRight") next = width - step;
            else if (event.key === "Home") next = minimumWidth;
            else if (event.key === "End") next = maximumWidth;
            else return;
            event.preventDefault();
            updateWidth(clamp(next), true);
          }}
        />
      )}
    </div>
  );
}
