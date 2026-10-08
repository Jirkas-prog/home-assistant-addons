import { Select } from "./select.jsx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useDialogKeys } from "./client.js";
import { t, locale } from "../shared/i18n.js";
import {
  calendarRange,
  calendarMove,
  calendarSegments,
  timedSegments,
  timedEntry,
  dayOffset,
  dayDistance,
} from "../shared/journal-calendar.js";
import { localDate } from "./work-model.js";
import "./journal-calendar.css";

const stamp = (day, options) =>
  new Intl.DateTimeFormat(locale(), { ...options, timeZone: "UTC" }).format(
    new Date(day + "T12:00:00Z"),
  );
function EntryButton({ segment, onOpen, style, timed = false }) {
  const n = segment.entry;
  return (
    <button
      className={`calendar-entry ${timed ? "timed" : ""} ${segment.before ? "continues-before" : ""} ${segment.after ? "continues-after" : ""}`}
      style={{ ...style, "--entry-color": n.color }}
      onClick={() => onOpen(n)}
      title={`${n.title} · ${n.tool.date}${n.tool.startTime ? " " + n.tool.startTime : ""} — ${n.tool.endDate || n.tool.date}${n.tool.endTime ? " " + n.tool.endTime : ""}`}
    >
      {timedEntry(n) && (
        <small>
          {n.tool.startTime}
          {timed ? `–${n.tool.endTime}` : ""}
        </small>
      )}
      <strong>{n.title}</strong>
      {n.tool.experience && (
        <span aria-label={t("journal.experience")}> ✦</span>
      )}
    </button>
  );
}
function DayEntries({ day, entries, onOpen, onClose }) {
  useDialogKeys(React, onClose);
  return (
    <div className="modal-backdrop">
      <section
        className="modal calendar-day-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={stamp(day, { dateStyle: "full" })}
      >
        <header>
          <h2>{stamp(day, { dateStyle: "full" })}</h2>
          <button
            autoFocus
            className="icon-button"
            onClick={onClose}
            aria-label={t("m188")}
          >
            <X />
          </button>
        </header>
        <div className="calendar-day-entries">
          {entries.map((n) => (
            <button
              className="secondary-button"
              key={n.id}
              onClick={() => {
                onClose();
                onOpen(n);
              }}
            >
              <span style={{ color: n.color }}>●</span>
              <strong>{n.title}</strong>
              <small>{n.tool.startTime || t("calendar.allDay")}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
function Month({ date, entries, onOpen, onDay, onCreate, dateOnly }) {
  const container = useRef();
  const [height, setHeight] = useState(500);
  const [overflowDay, setOverflowDay] = useState(null);
  useEffect(() => {
    const element = container.current;
    const measure = () => {
      if (!element?.isConnected) return;
      setHeight(
        Math.max(
          350,
          window.innerHeight -
            element.getBoundingClientRect().top -
            window.scrollY -
            20,
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const range = calendarRange(date, "month"),
    today = localDate();
  const weeks = Array.from(
    { length: (dayDistance(range.start, range.end) + 1) / 7 },
    (_, i) => dayOffset(range.start, i * 7),
  );
  const rowHeight = Math.max(100, Math.floor((height - 38) / weeks.length));
  const visibleLanes = Math.max(
    1,
    Math.min(6, Math.floor((rowHeight - 74) / 28)),
  );
  return (
    <>
      <div
        ref={container}
        style={{ "--week-height": `${rowHeight}px` }}
        className="calendar-month"
        role="region"
        aria-label={t("calendar.month")}
      >
        <div className="calendar-weekdays">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i}>
              {stamp(dayOffset(range.start, i), { weekday: "short" })}
            </span>
          ))}
        </div>
        {weeks.map((start) => {
          const segments = calendarSegments(
              entries,
              start,
              dayOffset(start, 6),
            ),
            shown = segments.filter((s) => s.lane < visibleLanes);
          return (
            <div className="calendar-week" key={start}>
              <div className="calendar-days">
                {Array.from({ length: 7 }, (_, i) => {
                  const day = dayOffset(start, i),
                    hidden = segments.filter(
                      (s) =>
                        s.lane >= visibleLanes &&
                        s.start <= day &&
                        s.end >= day,
                    ).length;
                  return (
                    <div
                      className={`calendar-day ${day.slice(0, 7) !== date.slice(0, 7) ? "outside" : ""}`}
                      key={day}
                    >
                      <button
                        className={`calendar-date ${day === today ? "today" : ""}`}
                        aria-label={stamp(day, { dateStyle: "full" })}
                        onClick={() => onDay(day)}
                      >
                        {Number(day.slice(-2))}
                      </button>
                      <button
                        className="calendar-add"
                        aria-label={t(
                          dateOnly ? "tasks.addOn" : "calendar.addOn",
                          day,
                        )}
                        onClick={() => onCreate(day)}
                      >
                        <Plus size={13} />
                      </button>
                      {hidden > 0 && (
                        <button
                          className="calendar-more"
                          onClick={() => setOverflowDay(day)}
                          aria-label={`${stamp(day, { dateStyle: "full" })}: ${t("calendar.more", hidden)}`}
                        >
                          {t("calendar.more", hidden)}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="calendar-bars">
                {shown.map((s) => (
                  <EntryButton
                    key={s.entry.id}
                    segment={s}
                    onOpen={onOpen}
                    style={{
                      gridColumn: `${s.column + 1} / span ${s.span}`,
                      gridRow: s.lane + 1,
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {overflowDay && (
        <DayEntries
          day={overflowDay}
          entries={entries.filter(
            (n) =>
              n.tool.date <= overflowDay &&
              (n.tool.endDate || n.tool.date) >= overflowDay,
          )}
          onOpen={onOpen}
          onClose={() => setOverflowDay(null)}
        />
      )}
    </>
  );
}
function TimeGrid({ date, mode, entries, onOpen, onCreate, dateOnly }) {
  const range = calendarRange(date, mode),
    days = Array.from({ length: mode === "day" ? 1 : 7 }, (_, i) =>
      dayOffset(range.start, i),
    );
  const allDay = calendarSegments(
      entries.filter((n) => !timedEntry(n)),
      range.start,
      range.end,
    ),
    today = localDate(),
    scroll = useRef();
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 7 * 52;
  }, [date, mode]);
  return (
    <div className="calendar-time" style={{ "--days": days.length }}>
      <div className="calendar-time-head">
        <span />
        {days.map((day) => (
          <button
            key={day}
            className={day === today ? "today" : ""}
            onClick={() => onCreate(day)}
          >
            {stamp(day, { weekday: "short" })}
            <strong>{Number(day.slice(-2))}</strong>
          </button>
        ))}
      </div>
      <div className="calendar-all-day">
        <span>{t("calendar.allDay")}</span>
        <div
          className="calendar-all-bars"
          style={{
            minHeight: Math.max(
              34,
              (Math.max(-1, ...allDay.map((s) => s.lane)) + 1) * 29,
            ),
          }}
        >
          {allDay.map((s) => (
            <EntryButton
              key={s.entry.id}
              segment={s}
              onOpen={onOpen}
              style={{
                gridColumn: `${s.column + 1} / span ${s.span}`,
                gridRow: s.lane + 1,
              }}
            />
          ))}
        </div>
      </div>
      {!dateOnly && (
        <div className="calendar-hours-scroll" ref={scroll}>
          <div className="calendar-hours">
            <div className="calendar-hour-labels">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h}>{String(h).padStart(2, "0")}:00</span>
              ))}
            </div>
            {days.map((day) => (
              <div className="calendar-hour-day" key={day}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <button
                    key={hour}
                    className="calendar-hour-slot"
                    aria-label={t(
                      "calendar.addAt",
                      day,
                      `${String(hour).padStart(2, "0")}:00`,
                    )}
                    onClick={() =>
                      onCreate(day, `${String(hour).padStart(2, "0")}:00`)
                    }
                  />
                ))}
                {timedSegments(entries, day).map((s) => (
                  <EntryButton
                    timed
                    key={s.entry.id}
                    segment={s}
                    onOpen={onOpen}
                    style={{
                      top: `${(s.start / 1440) * 100}%`,
                      height: `${((s.end - s.start) / 1440) * 100}%`,
                      left: `${(s.lane / s.columns) * 100}%`,
                      width: `${100 / s.columns}%`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
export function JournalCalendar({
  date,
  mode,
  entries,
  onDate,
  onMode,
  onOpen,
  onCreate,
  dateOnly = false,
}) {
  const monthTitle = stamp(date, { month: "long", year: "numeric" });
  const heading =
    mode === "day"
      ? stamp(date, { dateStyle: "long" })
      : mode === "year"
        ? date.slice(0, 4)
        : mode === "week"
          ? `${stamp(calendarRange(date, mode).start, { day: "numeric", month: "short" })} – ${stamp(calendarRange(date, mode).end, { day: "numeric", month: "short", year: "numeric" })}`
          : monthTitle;
  const months = useMemo(
    () =>
      Array.from(
        { length: 12 },
        (_, i) => `${date.slice(0, 4)}-${String(i + 1).padStart(2, "0")}-01`,
      ),
    [date.slice(0, 4)],
  );
  return (
    <>
      <div className="calendar-toolbar">
        <button
          className="secondary-button"
          onClick={() => onDate(localDate())}
        >
          {t("calendar.today")}
        </button>
        <button
          className="icon-button"
          aria-label={t("calendar.previous")}
          onClick={() => onDate(calendarMove(date, mode, -1))}
        >
          <ChevronLeft size={20} />
        </button>
        <button
          className="icon-button"
          aria-label={t("calendar.next")}
          onClick={() => onDate(calendarMove(date, mode, 1))}
        >
          <ChevronRight size={20} />
        </button>
        <h2 aria-live="polite">{heading}</h2>
        <input
          type="date"
          aria-label={t("calendar.goTo")}
          value={date}
          onChange={(e) => e.target.value && onDate(e.target.value)}
        />
        <Select
          aria-label={t("calendar.view")}
          value={mode}
          onChange={(e) => onMode(e.target.value)}
        >
          {["day", "week", "month", "year"].map((m) => (
            <option key={m} value={m}>
              {t(`calendar.${m}`)}
            </option>
          ))}
        </Select>
      </div>
      {mode === "month" ? (
        <Month
          dateOnly={dateOnly}
          date={date}
          entries={entries}
          onOpen={onOpen}
          onDay={(day) => {
            onDate(day);
            onMode("day");
          }}
          onCreate={onCreate}
        />
      ) : mode === "year" ? (
        <div className="calendar-year">
          {months.map((month) => {
            const range = calendarRange(month, "month"),
              count = dayDistance(range.start, range.end) + 1;
            return (
              <section key={month}>
                <button
                  className="calendar-month-title"
                  onClick={() => {
                    onDate(month);
                    onMode("month");
                  }}
                >
                  {stamp(month, { month: "long" })}
                </button>
                <div className="calendar-mini-grid">
                  {Array.from({ length: 7 }, (_, i) => (
                    <small key={i}>
                      {stamp(dayOffset(range.start, i), { weekday: "narrow" })}
                    </small>
                  ))}
                  {Array.from({ length: count }, (_, i) => {
                    const day = dayOffset(range.start, i),
                      n = calendarSegments(entries, day, day).length;
                    return (
                      <button
                        key={day}
                        className={`${day.slice(0, 7) !== month.slice(0, 7) ? "outside" : ""} ${n ? "has-entries" : ""} ${day === localDate() ? "today" : ""}`}
                        aria-label={`${stamp(day, { dateStyle: "full" })} · ${t(dateOnly ? "tasks.count" : "tools.entries", n)}`}
                        onClick={() => {
                          onDate(day);
                          onMode("day");
                        }}
                      >
                        {Number(day.slice(-2))}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <TimeGrid
          dateOnly={dateOnly}
          date={date}
          mode={mode}
          entries={entries}
          onOpen={onOpen}
          onCreate={onCreate}
        />
      )}
    </>
  );
}
