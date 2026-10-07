import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Flag, CircleHelp } from "lucide-react";
import { t, locale } from "../shared/i18n.js";
import { dayNumber } from "./work-model.js";
import { RecordImportance } from "./importance.jsx";
import {
  checkpoints,
  taskUrgencies,
  urgencyStyle,
  dateDay,
} from "../shared/checkpoints.js";
import { urgencyDescription } from "./checkpoints.jsx";
import { useToday } from "./use-today.js";
import {
  TIME_PRESETS,
  fitTimeline,
  zoomTimeline,
  zoomFromWheel,
  zoomFromPinch,
  timelineTicks,
  packTimeline,
} from "./timeline-model.js";
import "./timeline.css";

export function Timeline({
  tasks,
  allTasks,
  statuses,
  onEdit,
  onRefresh,
  onError,
}) {
  const todayDate = useToday(),
    today = dayNumber(todayDate);
  const urgencyById = useMemo(
    () => taskUrgencies(allTasks, todayDate),
    [allTasks, todayDate],
  );
  const [view, setView] = useState({
    start: today - 5,
    days: 30,
    preset: "30",
  });
  const [helpOpen, setHelpOpen] = useState(false);
  const [width, setWidth] = useState(700);
  const host = useRef(),
    current = useRef(),
    pointers = useRef(new Map()),
    gesture = useRef(null);
  current.current = { view, width };
  const filtered = useMemo(
    () => tasks.filter((n) => statuses.includes(n.status)),
    [tasks, statuses],
  );
  const layout = useMemo(() => packTimeline(filtered, view), [filtered, view]);
  const ruler = timelineTicks(view, width);
  const percent = (day) => ((day - view.start) / view.days) * 100;
  useEffect(() => {
    const element = host.current;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    const wheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const rect = element.getBoundingClientRect();
        setView((old) => zoomFromWheel(old, e, rect));
      } else if (e.deltaX || e.shiftKey) {
        e.preventDefault();
        const distance = e.deltaX || e.deltaY;
        setView((old) => ({
          ...old,
          start: old.start + (distance / current.current.width) * old.days,
        }));
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
    };
  }, []);
  function baseline() {
    const points = [...pointers.current.values()];
    if (!points.length) {
      gesture.current = null;
      return;
    }
    const middle =
      points.length > 1 ? (points[0].x + points[1].x) / 2 : points[0].x;
    gesture.current = {
      view: current.current.view,
      middle,
      distance:
        points.length > 1
          ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
          : 0,
      left: host.current.getBoundingClientRect().left,
    };
  }
  function pointerDown(e) {
    if (
      e.button !== 0 ||
      (e.pointerType !== "touch" && e.target.closest("button"))
    )
      return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Keep single-touch buttons clickable; capture only gestures that pan or pinch.
    if (!e.target.closest("button") || pointers.current.size > 1)
      host.current.setPointerCapture(e.pointerId);
    baseline();
  }
  function pointerMove(e) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = [...pointers.current.values()],
      base = gesture.current;
    if (points.length > 1 && base.distance > 0) {
      e.preventDefault();
      const distance = Math.hypot(
        points[0].x - points[1].x,
        points[0].y - points[1].y,
      );
      const middle = (points[0].x + points[1].x) / 2;
      setView(
        zoomFromPinch(
          base.view,
          base,
          { distance, middle },
          { left: base.left, width },
        ),
      );
    } else if (host.current.hasPointerCapture(e.pointerId)) {
      const dx = e.clientX - base.middle;
      if (Math.abs(dx) > 3)
        setView({
          ...base.view,
          start: base.view.start - (dx / width) * base.view.days,
        });
    }
  }
  function pointerEnd(e) {
    pointers.current.delete(e.pointerId);
    if (host.current.hasPointerCapture(e.pointerId))
      host.current.releasePointerCapture(e.pointerId);
    baseline();
  }
  const date = (day, hours = false) =>
    new Date(Math.round(day * 1440) * 60000).toLocaleString(locale(), {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: hours ? undefined : "numeric",
      ...(hours ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  return (
    <div className="timeline-v2">
      <div className="timeline-controls">
        <label>
          <select
            aria-label={t("timeline.scale")}
            value={view.preset}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "all") setView(fitTimeline(filtered, today));
              else {
                const days = Number(value);
                setView((old) => ({
                  start: old.start + (old.days - days) / 2,
                  days,
                  preset: value,
                }));
              }
            }}
          >
            {TIME_PRESETS.map((days) => (
              <option key={days} value={days}>
                {t(`timeline.days${days}`)}
              </option>
            ))}
            <option value="all">{t("timeline.eternity")}</option>
            {view.preset === "custom" && (
              <option value="custom">{t("timeline.custom")}</option>
            )}
          </select>
        </label>
        <div className="timeline-navigation">
          <button
            className="icon-button"
            aria-label={t("timeline.previous")}
            onClick={() =>
              setView((old) => ({ ...old, start: old.start - old.days * 0.8 }))
            }
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              setView((old) => ({ ...old, start: today + 0.5 - old.days / 2 }))
            }
          >
            {t("m268")}
          </button>
          <button
            className="icon-button"
            aria-label={t("timeline.next")}
            onClick={() =>
              setView((old) => ({ ...old, start: old.start + old.days * 0.8 }))
            }
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <span className="timeline-range" aria-live="polite">
          {date(view.start, view.days <= 3)} –{" "}
          {date(view.start + view.days, view.days <= 3)}
        </span>
        <button
          className="secondary-button timeline-guide-toggle"
          aria-label={t("timeline.help")}
          title={t("timeline.help")}
          aria-expanded={helpOpen}
          aria-controls="timeline-guide"
          onClick={() => setHelpOpen(!helpOpen)}
        >
          <CircleHelp size={16} />
          <span>{t("timeline.help")}</span>
        </button>
      </div>
      {helpOpen && (
        <div className="timeline-guide" id="timeline-guide">
          <p className="timeline-instructions">{t("timeline.gestures")}</p>
          <div
            className="timeline-urgency-legend"
            aria-label={t("checkpoint.legend")}
          >
            {[
              ["onTrack", 0],
              ["attention", 0.5],
              ["urgent", 1],
            ].map(([label, score]) => (
              <span key={label} style={urgencyStyle({ score })}>
                <i />
                {t(`checkpoint.${label}`)}
              </span>
            ))}
            <span>{t("checkpoint.legendHelp")}</span>
          </div>
          <p className="timeline-lane-count">
            {t("timeline.lanes", layout.items.length, layout.lanes)}
          </p>
        </div>
      )}
      <div
        className="timeline-surface"
        ref={host}
        role="region"
        aria-label={t("m254")}
        tabIndex={0}
        style={{ height: Math.max(220, 64 + layout.lanes * 52) }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.preventDefault();
            setView((old) => ({
              ...old,
              start:
                old.start + (e.key === "ArrowLeft" ? -1 : 1) * old.days * 0.1,
            }));
          }
          if (["+", "=", "-"].includes(e.key)) {
            e.preventDefault();
            setView((old) => zoomTimeline(old, e.key === "-" ? 1.2 : 1 / 1.2));
          }
        }}
      >
        {ruler.ticks.map((day) => (
          <div
            className="timeline-tick"
            key={day}
            style={{ left: `${percent(day)}%` }}
          >
            <span>{date(day, ruler.hours)}</span>
          </div>
        ))}
        {today >= view.start && today < view.start + view.days && (
          <div className="timeline-now" style={{ left: `${percent(today)}%` }}>
            <span>{t("m268")}</span>
          </div>
        )}
        {layout.items.map(({ node, start, end, left, right, lane }) => {
          const pixels = ((right - left) / view.days) * width;
          const urgency = urgencyById.get(node.id);
          const urgencyText = `${t(`checkpoint.${urgency.completed ? "completed" : urgency.level}`)} · ${urgencyDescription(urgency)}`;
          const points = checkpoints(node);
          const markerDates = [...new Set(points.map((p) => p.due))];
          const range = `${Number.isFinite(start) ? date(start) : "−∞"} → ${Number.isFinite(end) ? date(end - 1) : "+∞"}`;
          return (
            <article
              key={node.id}
              className={`timeline-task-bar ${node.status} urgency`}
              aria-label={`${node.title} · ${range} · ${urgencyText}`}
              style={{
                ...urgencyStyle(urgency),
                left: `${percent(left)}%`,
                width: `${((right - left) / view.days) * 100}%`,
                top: 58 + lane * 52,
              }}
              title={`${node.title} · ${range} · ${urgencyText}`}
            >
              <div className="timeline-bar-content">
                <button
                  className="timeline-item-title"
                  style={{ width: Math.min(240, Math.max(42, pixels - 192)) }}
                  onClick={() => onEdit(node)}
                  title={`${node.title} · ${range} · ${urgencyText}`}
                >
                  {node.position ? `#${node.position} · ` : ""}
                  {node.title}
                </button>
                <div className="timeline-inline-stars">
                  <RecordImportance
                    node={node}
                    onSaved={onRefresh}
                    onError={onError}
                    compact
                  />
                </div>
                <button
                  className="timeline-checkpoint-button"
                  aria-label={t("checkpoint.forTask", node.title)}
                  title={urgencyText}
                  onClick={() => onEdit(node, "checkpoints")}
                >
                  <Flag size={14} />
                  {points.filter((p) => p.done).length}/{points.length}
                </button>
              </div>
              {pixels >= 16 &&
                markerDates.map((due) => {
                  const day = dateDay(due) + 1;
                  if (day < left || day > right) return null;
                  const dated = points.filter((p) => p.due === due),
                    done = dated.every((p) => p.done);
                  return (
                    <button
                      key={due}
                      className={`timeline-checkpoint-marker ${done ? "done" : due < todayDate ? "overdue" : ""}`}
                      style={{
                        left: Math.min(
                          pixels - 6,
                          Math.max(6, ((day - left) / view.days) * width),
                        ),
                      }}
                      aria-label={t(
                        "checkpoint.marker",
                        date(day - 1),
                        dated.length,
                      )}
                      title={dated.map((p) => p.description).join(" · ")}
                      onClick={() => onEdit(node, "checkpoints")}
                    />
                  );
                })}
            </article>
          );
        })}
        {!layout.items.length && (
          <div className="timeline-no-tasks">{t("timeline.empty")}</div>
        )}
      </div>
    </div>
  );
}
