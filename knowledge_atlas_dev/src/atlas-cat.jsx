import React, { useEffect, useRef, useState } from "react";
import "./atlas-cat.css";

// Decorative only: the companion never captures clicks or keyboard focus.
export function AtlasCat({ enabled }) {
  const element = useRef();
  const [scene, setScene] = useState({
    x: -120,
    y: 0,
    pose: "hide",
    direction: 1,
    duration: 0,
  });
  useEffect(() => {
    if (!enabled) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let timer,
      previous,
      step = 0,
      stopped = false;
    const schedule = (delay) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(visit, delay);
    };
    const hide = () => setScene((s) => ({ ...s, pose: "hide", duration: 0 }));
    const rails = () => {
      const modal = [...document.querySelectorAll('[role="dialog"]')].at(-1);
      const elements = modal
        ? [modal]
        : [
            ...document.querySelectorAll(
              ".workbench, .collection-toolbar .segmented, .calendar-month, .space-bar",
            ),
          ];
      const obstacles = [
        ...document.querySelectorAll(
          ".page-heading > div, .toolbar, .collection-toolbar, .topbar, .space-picker, .cat-toggle",
        ),
      ];
      return elements.flatMap((item) => {
        const rect = item.getBoundingClientRect();
        if (
          rect.width < 130 ||
          rect.top < 65 ||
          rect.top >= innerHeight - 50 ||
          rect.right < 100 ||
          rect.left >= innerWidth - 100
        )
          return [];
        const y = rect.top - 65;
        let intervals = [
          [
            Math.max(8, rect.left + 16),
            Math.min(innerWidth - 98, rect.right - 104),
          ],
        ];
        // Keep the whole walking path away from headings, counters and controls.
        for (const obstacle of obstacles) {
          if (obstacle.contains(item)) continue;
          const r = obstacle.getBoundingClientRect();
          if (!r.width || r.bottom <= y || r.top >= y + 65) continue;
          const from = r.left - 100,
            to = r.right + 6;
          intervals = intervals.flatMap(([left, right]) => {
            if (to <= left || from >= right) return [[left, right]];
            return [
              [left, Math.min(right, from)],
              [Math.max(left, to), right],
            ].filter(([a, b]) => b >= a);
          });
        }
        return intervals
          .filter(([left, right]) => right >= left)
          .map(([left, right]) => ({ left, right, y }));
      });
    };
    const typing = () =>
      document.activeElement?.matches(
        'input, textarea, select, [contenteditable="true"]',
      );
    function visit() {
      if (document.hidden) {
        hide();
        return;
      }
      if (typing()) {
        hide();
        schedule(1800);
        return;
      }
      const choices = rails();
      if (!choices.length) {
        hide();
        schedule(2400);
        return;
      }
      const rail = choices[Math.floor(Math.random() * choices.length)];
      const side = Math.random() > 0.5;
      const x = side ? rail.right : rail.left;
      if (reduced.matches) {
        setScene({
          x: rail.right,
          y: rail.y,
          pose: "sit",
          direction: 1,
          duration: 0,
        });
        return;
      }
      if (step % 4 === 0 || !previous) {
        previous = { x, y: rail.y, rail };
        setScene({
          x,
          y: rail.y,
          pose: "peek",
          direction: side ? -1 : 1,
          duration: 0,
        });
        schedule(3800);
      } else if (step % 4 === 1) {
        const target =
          previous.x < (previous.rail.left + previous.rail.right) / 2
            ? previous.rail.right
            : previous.rail.left;
        const duration = Math.max(
          1800,
          Math.min(6500, Math.abs(target - previous.x) * 14),
        );
        setScene({
          x: target,
          y: previous.y,
          pose: "walk",
          direction: target > previous.x ? 1 : -1,
          duration,
        });
        previous.x = target;
        schedule(duration);
      } else if (step % 4 === 2) {
        setScene((s) => ({
          ...s,
          pose: Math.random() > 0.5 ? "sit" : "sleep",
          duration: 0,
        }));
        schedule(6500);
      } else {
        hide();
        schedule(2800);
      }
      step++;
    }
    const returnLater = () => {
      hide();
      step = 0;
      previous = null;
      schedule(reduced.matches ? 200 : 1900);
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.hidden) hide();
      else returnLater();
    };
    const onFocus = () => {
      if (typing()) returnLater();
    };
    const onPointer = (event) => {
      const rect = element.current?.getBoundingClientRect();
      if (
        rect &&
        event.clientX > rect.left - 20 &&
        event.clientX < rect.right + 20 &&
        event.clientY > rect.top - 15 &&
        event.clientY < rect.bottom + 15
      )
        returnLater();
    };
    const observer = new ResizeObserver(returnLater);
    for (const panel of document.querySelectorAll(".main, .workbench"))
      observer.observe(panel);
    schedule(650);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("resize", returnLater);
    window.addEventListener("scroll", returnLater, {
      passive: true,
      capture: true,
    });
    reduced.addEventListener("change", returnLater);
    return () => {
      observer.disconnect();
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("pointermove", onPointer);
      window.removeEventListener("resize", returnLater);
      window.removeEventListener("scroll", returnLater, true);
      reduced.removeEventListener("change", returnLater);
    };
  }, [enabled]);
  if (!enabled) return null;
  return (
    <div
      ref={element}
      className={`atlas-cat cat-${scene.pose}`}
      aria-hidden="true"
      style={{
        transform: `translate3d(${scene.x}px,${scene.y}px,0)`,
        transitionDuration: `${scene.duration}ms`,
        "--cat-direction": scene.direction,
      }}
    >
      <div className="cat-stage">
        <svg viewBox="0 0 110 84" width="94" height="72" focusable="false">
          <ellipse
            className="cat-shadow"
            cx="57"
            cy="78"
            rx="35"
            ry="3"
            fill="#000"
            opacity=".24"
          />
          <g
            className="cat-shape"
            stroke="#684f3e"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <path
              className="cat-tail"
              d="M34 66 C13 76 7 59 15 51 C21 46 25 50 23 55"
              fill="none"
              stroke="#e5ad72"
              strokeWidth="9"
            />
            <path
              d="M34 71 C27 57 34 42 46 40 C62 35 77 43 82 62 L78 75Z"
              fill="#eabd89"
            />
            <path
              d="M47 48 C56 43 69 48 68 69 L48 73Z"
              fill="#fae5c4"
              stroke="none"
            />
            <path
              d="M34 49 L41 53 M33 57 L40 60 M37 66 L42 67"
              fill="none"
              stroke="#b88352"
              strokeWidth="3.5"
            />
            <g className="cat-leg cat-back-leg">
              <path
                d="M40 63 L39 74 Q35 80 29 77 Q27 72 34 70 L35 60"
                fill="#eabd89"
              />
            </g>
            <g className="cat-leg cat-front-leg">
              <path
                d="M73 59 L75 73 Q83 73 80 78 L65 78 L65 60"
                fill="#f8d9ae"
              />
            </g>
            <g className="cat-head">
              <path
                d="M44 37 L41 11 Q41 6 46 9 L59 19 Q68 16 78 20 L91 10 Q95 7 95 13 L92 38 Q88 54 69 54 Q48 54 44 37Z"
                fill="#edc18e"
              />
              <path
                d="M47 15 L49 29 L57 23Z M88 17 L79 24 L90 30Z"
                fill="#cc8e85"
                stroke="none"
              />
              <path
                d="M58 22 L62 30 M68 20 L69 28 M78 23 L76 30"
                fill="none"
                stroke="#b88352"
                strokeWidth="3"
              />
              <path
                d="M53 39 Q53 49 69 50 Q84 49 86 39 L75 36 L64 36Z"
                fill="#fff0d6"
                stroke="none"
              />
              <g className="cat-eyes">
                <ellipse cx="57" cy="35" rx="4" ry="4.6" fill="#577666" />
                <ellipse cx="81" cy="35" rx="4" ry="4.6" fill="#577666" />
                <path
                  d="M57 32 V38 M81 32 V38"
                  stroke="#19292a"
                  strokeWidth="2"
                />
                <circle cx="58" cy="33" r=".9" fill="white" stroke="none" />
                <circle cx="82" cy="33" r=".9" fill="white" stroke="none" />
              </g>
              <path
                className="cat-closed-eyes"
                d="M53 36 Q57 33 61 36 M77 36 Q81 33 85 36"
                fill="none"
                stroke="#493e39"
              />
              <path
                d="M66 40 Q69 38 72 40 L69 43Z"
                fill="#b77f7b"
                stroke="none"
              />
              <path
                d="M69 43 V45 M64 45 Q67 48 69 45 Q72 48 75 45 M50 40 L38 38 M50 44 L37 45 M88 40 L101 38 M88 44 L101 45"
                fill="none"
                strokeWidth="1"
              />
            </g>
            <path
              d="M53 51 Q69 58 84 50 L81 56 Q66 63 53 56Z"
              fill="#94b6a0"
              stroke="#587566"
            />
            <path d="M73 57 L84 61 L75 67Z" fill="#94b6a0" stroke="#587566" />
            <g className="cat-peek-paws" fill="#fae2c1">
              <ellipse cx="48" cy="58" rx="7" ry="5" />
              <ellipse cx="87" cy="58" rx="7" ry="5" />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
