import React, { useEffect, useRef } from "react";
import {
  CatBehavior,
  catFreeIntervals,
  catLanding,
  catControlInterval,
} from "./cat-behavior.js";
import "./atlas-cat.css";
import { useCatMotion } from "./cat-motion.js";
import { PetDrag } from "./cat-physics.js";
import { t } from "../shared/i18n.js";

function clippedBounds() {
  const clips = new Map();
  return (element, rect = element.getBoundingClientRect()) => {
    let { left, right, top, bottom } = rect;
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (!clips.has(parent)) {
        const style = getComputedStyle(parent);
        clips.set(parent, {
          rect: parent.getBoundingClientRect(),
          x: /auto|scroll|hidden|clip/.test(style.overflowX),
          y: /auto|scroll|hidden|clip/.test(style.overflowY),
        });
      }
      const clip = clips.get(parent);
      if (clip.x) {
        left = Math.max(left, clip.rect.left);
        right = Math.min(right, clip.rect.right);
      }
      if (clip.y) {
        top = Math.max(top, clip.rect.top);
        bottom = Math.min(bottom, clip.rect.bottom);
      }
    }
    return {
      left,
      right,
      top,
      bottom,
      width: bottom > top ? Math.max(0, right - left) : 0,
    };
  };
}

// One local animation clock; explicit grabs never activate the controls beneath.
export function AtlasCat({
  enabled,
  motion,
  personality = "classic",
  yarnEnabled = true,
  yarnLayer = "front",
}) {
  const runtime = useRef();
  const element = useRef();
  const yarnElement = useRef();
  const reduced = useCatMotion(motion);
  useEffect(() => {
    if (!enabled) return;
    const cat = new CatBehavior(Math.random, personality);
    const ids = new WeakMap();
    let nextId = 0,
      frame,
      timer,
      measureFrame,
      dialog,
      focusedField,
      placedElement,
      pointerStart,
      gesture,
      suppressClick,
      hadFlight = false,
      hadYarn = false,
      controlElements = new Map(),
      disposed = false;
    const observed = new Set();
    let pausedAt = document.hidden ? performance.now() : null,
      pausedTime = 0;
    const now = () => (pausedAt ?? performance.now()) - pausedTime;
    const id = (item) => {
      if (!ids.has(item)) ids.set(item, ++nextId);
      return ids.get(item);
    };
    const paint = () => {
      const s = cat.scene,
        node = element.current;
      if (!node) return;
      node.style.transform = `translate3d(${s.x.toFixed(2)}px,${s.y.toFixed(2)}px,0)`;
      node.style.setProperty("--cat-direction", s.direction);
      node.style.setProperty(
        "--cat-tilt",
        `${Math.max(-18, Math.min(18, (cat.flight?.vx || 0) * 9)) * s.direction}deg`,
      );
      const gaze = cat.gaze;
      node.style.setProperty("--cat-gaze-x", `${gaze.x.toFixed(2)}px`);
      node.style.setProperty("--cat-gaze-y", `${gaze.y.toFixed(2)}px`);
      const name = `atlas-cat cat-${s.pose}`;
      if (node.className !== name) node.className = name;
      node.dataset.visible = String(s.visible);
      node.dataset.paused = String(pausedAt !== null);
      node.dataset.reduced = String(cat.reduced);
      node.dataset.personality = cat.personality;
      node.dataset.context = cat.context;
      const ball = cat.yarn.ball,
        toy = yarnElement.current;
      if (toy) {
        toy.hidden = !ball;
        if (ball) {
          toy.dataset.phase = ball.phase;
          toy.style.transform = `translate3d(${(ball.x - 22).toFixed(2)}px,${(ball.y - 22).toFixed(2)}px,0) rotate(${ball.rotation.toFixed(2)}deg) scale(${ball.scale})`;
          toy.style.opacity = ball.opacity;
        }
      }
      if ((hadYarn && !ball) || (hadFlight && !cat.flight)) {
        placedElement = controlElements.get(cat.railId) || placedElement;
        requestMeasure();
      }
      hadYarn = !!ball;
      hadFlight = !!cat.flight;
    };
    function run() {
      cancelAnimationFrame(frame);
      frame = null;
      clearTimeout(timer);
      if (disposed || pausedAt !== null || !element.current) return;
      const time = now();
      cat.tick(time);
      paint();
      if (cat.animated) frame = requestAnimationFrame(run);
      else if (!cat.reduced && Number.isFinite(cat.deadline))
        timer = setTimeout(run, Math.max(16, cat.deadline - time));
    }
    const controls =
      'button, input:not([type="hidden"]), textarea, select, a[href], summary, [role="button"], [role="combobox"], [role="tab"], [contenteditable="true"]';
    function controlRails(item, bounds, blocks) {
      const raw = item.getBoundingClientRect(),
        r = bounds(item, raw);
      if (
        !item.isConnected ||
        !item.getClientRects().length ||
        r.width < 28 ||
        r.bottom - r.top < 12 ||
        raw.top < 70 ||
        raw.top > innerHeight - 8 ||
        Math.abs(raw.top - r.top) > 1 ||
        getComputedStyle(item).visibility !== "visible"
      )
        return [];
      const [a, z] = catControlInterval(r, innerWidth);
      return catFreeIntervals(
        a,
        z,
        r.top - 67,
        blocks
          .filter(
            ({ element: e }) =>
              e !== item && !(e.contains(item) && e.tagName !== "LABEL"),
          )
          .map(({ rect }) => rect),
      )
        .map(([left, right], index) => ({
          id: `drop:${id(item)}:${index}`,
          surface: `drop:${id(item)}`,
          kind: "control",
          anchorX: raw.left,
          left,
          right,
          y: r.top - 67,
          supportLeft: Math.max(r.left, left + 47 - 48),
          supportRight: Math.min(r.right, right + 47 + 48),
        }))
        .filter((rail) => {
          const x = Math.max(
            r.left + 1,
            Math.min(r.right - 1, (rail.left + rail.right) / 2 + 47),
          );
          const hit = document
            .elementsFromPoint(x, r.top + 2)
            .find((e) => !e.closest("[data-atlas-pet]"));
          return hit === item || item.contains(hit);
        });
    }
    function collectControlRails(scope, bounds) {
      const items = [...scope.querySelectorAll(controls)].filter((item) => {
        if (item.closest("[data-atlas-pet]")) return false;
        const r = bounds(item);
        return (
          r.width >= 28 &&
          r.bottom > 0 &&
          r.top < innerHeight &&
          r.right > 0 &&
          r.left < innerWidth
        );
      });
      const blocks = [
        ...items,
        ...scope.querySelectorAll("h2, h3, .field-help, .markdown-toolbar"),
      ].map((item) => ({ element: item, rect: bounds(item) }));
      for (const label of scope.querySelectorAll("label")) {
        for (const child of label.childNodes)
          if (child.nodeType === 3 && child.textContent.trim()) {
            const range = document.createRange();
            range.selectNode(child);
            blocks.push({
              element: label,
              rect: bounds(label, range.getBoundingClientRect()),
            });
          }
      }
      return items.flatMap((item) =>
        controlRails(item, bounds, blocks).map((rail) => ({
          ...rail,
          element: item,
        })),
      );
    }
    cat.findLanding = () => {
      // Resolve controls only when released, not on every animation frame.
      const scope =
        [...document.querySelectorAll('[role="dialog"]')]
          .filter((d) => d.getClientRects().length)
          .at(-1) || document.body;
      const candidates = collectControlRails(scope, clippedBounds());
      const landing = catLanding(
        cat.scene,
        [
          ...candidates,
          ...cat.rails.filter(
            (r) => !r.id.startsWith("drop:") && r.id !== "drop-floor",
          ),
        ],
        innerWidth,
        innerHeight,
      );
      placedElement = landing.rail.element || null;
      const { element: ignored, ...rail } = landing.rail;
      if (placedElement) requestMeasure();
      return { ...landing, rail };
    };
    function measure() {
      cancelAnimationFrame(measureFrame);
      measureFrame = null;
      if (disposed || pausedAt !== null || !element.current) return;
      const bounds = clippedBounds();
      const nextDialog = [...document.querySelectorAll('[role="dialog"]')]
        .filter((d) => d.getClientRects().length)
        .at(-1);
      let priority = nextDialog !== dialog;
      if (priority && gesture) finishGesture(null, true, false);
      dialog = nextDialog;
      const workbench = document.querySelector(".workbench");
      const contextElement =
        dialog || workbench?.querySelector("[data-cat-context]") || workbench;
      const context =
        contextElement?.dataset.catContext || (dialog ? "editor" : "workspace");
      const contextKey = contextElement
        ? `${id(contextElement)}:${context}`
        : context;
      if (gesture && contextKey !== cat.contextKey)
        finishGesture(null, true, false);
      priority = cat.setContext(context, contextKey, now()) || priority;
      const classic = cat.personality === "classic";
      const activeField =
        dialog?.contains(document.activeElement) &&
        document.activeElement.matches('textarea, [contenteditable="true"]')
          ? document.activeElement
          : null;
      if (activeField && focusedField !== activeField) priority = true;
      focusedField = activeField;
      // Text fields are preferred perches. Only their visible upper edge qualifies.
      let panels = dialog
        ? [
            ...dialog.querySelectorAll('textarea, [contenteditable="true"]'),
            dialog,
            dialog.querySelector("header"),
          ].filter(Boolean)
        : [
            ...document.querySelectorAll(
              ".workbench, .calendar-month, .collection-toolbar .segmented",
            ),
          ];
      if (!classic) {
        const extra =
          (dialog || workbench)?.querySelectorAll(
            dialog
              ? ".task-tabs, .document-preview, .journal-entry, .journal-entry-text, .journal-auto-attachments, .attachment-gallery, .resource-editor, .checkpoint-editor, .task-comments, .task-activity"
              : ".calendar-month, .calendar-time, .calendar-year, .timeline-surface, .deck-column, .inventory-table, .backup-transfer",
          ) || [];
        panels = [...new Set([...panels, ...extra])];
      }
      if (
        placedElement &&
        (!placedElement.isConnected ||
          !cat.railId?.startsWith("drop:") ||
          (dialog && !dialog.contains(placedElement)))
      )
        placedElement = null;
      const playRails =
        cat.yarn.ball || cat.held || cat.flight
          ? collectControlRails(dialog || document.body, bounds)
          : [];
      if (playRails.length)
        controlElements = new Map(playRails.map((r) => [r.id, r.element]));
      if (placedElement && !playRails.some((r) => r.element === placedElement))
        panels.push(placedElement);
      const kind = (item) => {
        if (item.matches('textarea, [contenteditable="true"]'))
          return "writing";
        if (item.matches(".task-tabs, .segmented")) return "tabs";
        if (
          item.matches(
            ".calendar-month, .calendar-time, .calendar-year, .timeline-surface",
          )
        )
          return "calendar";
        if (item.matches(".deck-column")) return "column";
        if (item.matches(".checkpoint-editor")) return "checkpoint";
        if (
          item.matches(
            ".document-preview, .journal-entry, .journal-entry-text, .journal-auto-attachments, .attachment-gallery, .resource-editor, .task-comments, .task-activity, .inventory-table",
          )
        )
          return "reader";
        return "frame";
      };
      if (activeField)
        panels.sort(
          (a, b) => (b === activeField ? 1 : 0) - (a === activeField ? 1 : 0),
        );
      const watched = [
        ...new Set([...panels, ...playRails.map((r) => r.element)]),
      ];
      for (const item of observed)
        if (!watched.includes(item)) {
          sizes.unobserve(item);
          observed.delete(item);
        }
      for (const item of watched)
        if (!observed.has(item)) {
          observed.add(item);
          sizes.observe(item);
        }
      const obstacles = [
        ...(dialog || document).querySelectorAll(
          dialog
            ? 'button, input, select, h2, h3, [role="tablist"], .markdown-toolbar'
            : ".page-heading > div, .toolbar, .collection-toolbar, .topbar, .space-bar",
        ),
      ];
      if (!classic)
        obstacles.push(
          ...(dialog || document).querySelectorAll(
            ".tasks-toolbar, .calendar-toolbar, .combined-calendar-controls, .timeline-controls, .board-actions, .deck-column > header, .cat-personality-details, .cat-personalities, .field-help, .notebook-summary, .backup-transfer-heading, .backup-transfer-numbers",
          ),
        );
      const blocks = obstacles.map((o) => ({
        element: o,
        rect: bounds(o),
      }));
      // A label's text, not its full-width box, must remain readable.
      if (dialog)
        for (const label of dialog.querySelectorAll("label")) {
          for (const child of label.childNodes)
            if (child.nodeType === 3 && child.textContent.trim()) {
              const range = document.createRange();
              range.selectNode(child);
              blocks.push({
                element: label,
                rect: bounds(label, range.getBoundingClientRect()),
              });
            }
        }
      const rails = panels.flatMap((item) => {
        if (item === placedElement) return controlRails(item, bounds, blocks);
        const r = item.getBoundingClientRect();
        if (
          !item.getClientRects().length ||
          r.width < 110 ||
          r.top < 70 ||
          r.top > innerHeight - 30
        )
          return [];
        const scroller = item.closest(
          ".task-dialog-body, .editor-body, .tool-editor-body",
        );
        if (scroller) {
          const clip = scroller.getBoundingClientRect();
          if (r.top < clip.top + 68 || r.top > clip.bottom - 8) return [];
        }
        const y = r.top - 67;
        const intervals = catFreeIntervals(
          Math.max(8, r.left + 8),
          Math.min(innerWidth - 102, r.right - 102),
          y,
          blocks
            .filter(
              ({ element: obstacle }) =>
                obstacle !== item &&
                !(obstacle.contains(item) && obstacle.tagName !== "LABEL"),
            )
            .map(({ rect }) => rect),
        );
        return intervals
          .filter(([a, z]) => z >= a)
          .map(([left, right], index) => ({
            id: `${id(item)}:${index}`,
            surface: id(item),
            kind: kind(item),
            anchorX: r.left,
            left,
            right,
            y,
          }));
      });
      // On a compact dialog there may be no 72px headroom above the frame.
      // Use the free right-hand part of its header before falling back to the viewport edge.
      if (!rails.length && dialog) {
        const r = dialog.getBoundingClientRect();
        const header = dialog.querySelector("header");
        const h = header?.getBoundingClientRect();
        if (h && h.width > 380) {
          const title = header.querySelector("h2");
          const range = document.createRange();
          if (title) range.selectNodeContents(title);
          const left = Math.max(
            r.left + 12,
            title ? range.getBoundingClientRect().right + 12 : r.left + 12,
          );
          const right = Math.min(innerWidth - 102, r.right - 150);
          if (right >= left)
            rails.push({
              id: `${id(dialog)}:header`,
              kind: "frame",
              anchorX: r.left,
              left,
              right,
              y: Math.max(4, h.bottom - 67),
            });
        }
      }
      if (!rails.length) {
        const y = Math.max(0, innerHeight - 76);
        const controls = [
          ...(dialog || document).querySelectorAll(
            "button, input, select, textarea",
          ),
        ].map((e) => bounds(e));
        for (const status of (dialog || document).querySelectorAll(
          'footer [role="status"]',
        )) {
          const range = document.createRange();
          range.selectNodeContents(status);
          controls.push(range.getBoundingClientRect());
        }
        const free = catFreeIntervals(
          8,
          Math.max(8, innerWidth - 102),
          y,
          controls,
        );
        for (const [index, [left, right]] of free.entries())
          rails.push({ id: `viewport:${index}`, anchorX: 0, left, right, y });
        if (!rails.length) rails.push({ id: "viewport", left: 8, right: 8, y });
      }
      cat.setRails([...rails, ...playRails], now(), {
        width: innerWidth,
        height: innerHeight,
        priority,
      });
      run();
    }
    const requestMeasure = () => {
      if (measureFrame == null && pausedAt === null && !disposed)
        measureFrame = requestAnimationFrame(measure);
    };
    const point = (e) => ({ x: e.clientX, y: e.clientY });
    function finishGesture(event, cancelled = false, remeasure = true) {
      const g = gesture;
      if (!g || (event && event.pointerId !== g.pointerId)) return;
      gesture = null;
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (g.node.hasPointerCapture(g.pointerId))
        g.node.releasePointerCapture(g.pointerId);
      const time = now();
      if (event && !cancelled) {
        const position = g.drag.move(point(event), time);
        if (g.drag.dragged) g.actor.dragTo(position);
      }
      suppressClick = { until: time + 800 };
      pointerStart = null;
      if (cancelled || g.drag.dragged)
        g.actor.release(
          cancelled ? { vx: 0, vy: 0 } : g.drag.velocity(time),
          time,
        );
      else if (g.kind === "yarn") cat.yarn.stop(time);
      else cat.shoo(time);
      if (remeasure) measure();
    }
    const onPetDown = (event) => {
      suppressClick = null;
      const node = event.target.closest?.("[data-atlas-pet]");
      if (!node || event.button !== 0 || event.isPrimary === false || gesture)
        return;
      event.preventDefault();
      event.stopPropagation();
      pointerStart = null;
      const kind = node.dataset.atlasPet;
      const actor = kind === "yarn" ? cat.yarn : cat;
      const body = kind === "yarn" ? cat.yarn.ball : cat.scene;
      if (!body) return;
      const drag = new PetDrag(point(event), body, now());
      actor.grab(now());
      gesture = { node, kind, actor, drag, pointerId: event.pointerId };
      node.setPointerCapture(event.pointerId);
      measure();
    };
    const onPetClick = (event) => {
      if (
        event.target.closest?.("[data-atlas-pet]") ||
        (suppressClick && now() < suppressClick.until)
      ) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick = null;
      }
    };
    const onPetKey = (event) => {
      if (gesture && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finishGesture(null, true);
        return;
      }
      const node = event.target.closest?.("[data-atlas-pet]");
      if (!node || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (node.dataset.atlasPet === "yarn") cat.yarn.stop(now());
      else cat.shoo(now());
      run();
    };
    const onPointer = (event) => {
      if (gesture) {
        if (event.pointerId !== gesture.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const position = gesture.drag.move(point(event), now());
        if (gesture.drag.dragged) gesture.actor.dragTo(position);
        run();
        return;
      }
      if (
        pointerStart &&
        Math.hypot(
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
        ) > 6
      )
        pointerStart.dragged = true;
      if (event.pointerType === "touch") return;
      if (event.buttons) {
        onInteraction();
        return;
      }
      cat.point({ x: event.clientX, y: event.clientY }, now());
      if (frame == null && pausedAt === null)
        frame = requestAnimationFrame(run);
    };
    const onInteraction = (event) => {
      if (event?.type === "pointerdown")
        pointerStart = {
          x: event.clientX,
          y: event.clientY,
          target: event.target,
          time: now(),
          dragged: false,
        };
      const typing =
        event?.type === "keydown" &&
        !!event.target?.closest?.('input, textarea, [contenteditable="true"]');
      cat.yieldPointer(now(), { typing });
      if (frame == null && pausedAt === null)
        frame = requestAnimationFrame(run);
    };
    const onBackgroundClick = (event) => {
      const start = pointerStart;
      pointerStart = null;
      if (
        !cat.yarn.enabled ||
        cat.reduced ||
        !start ||
        start.dragged ||
        now() - start.time > 700 ||
        event.button !== 0 ||
        event.detail !== 1 ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 ||
        start.target !== event.target ||
        document.getSelection()?.toString()
      )
        return;
      // Backgrounds of canvases and gestures are still interactive, as are
      // disabled controls, labels and modal backdrops. Never consume the click.
      if (
        event.target.closest(
          `${controls}, label, [tabindex], [draggable="true"], [role="menuitem"], [role="option"], [role="slider"], [role="checkbox"], [role="switch"], canvas, svg, video, audio, .timeline-surface, .map-canvas`,
        ) ||
        event.target.matches(".modal-backdrop, .drawer-backdrop") ||
        event.target.closest("[inert]")
      )
        return;
      measure();
      if (dialog && !dialog.contains(event.target)) return;
      const candidates = collectControlRails(
        dialog || document.body,
        clippedBounds(),
      );
      controlElements = new Map(candidates.map((r) => [r.id, r.element]));
      cat.setRails(
        [...cat.rails.filter((r) => !r.id.startsWith("drop:")), ...candidates],
        now(),
      );
      cat.yarn.spawn({ x: event.clientX, y: event.clientY }, now());
      requestMeasure();
      run();
    };
    const onPointerUp = (event) => finishGesture(event);
    const onPointerCancel = (event) => {
      pointerStart = null;
      finishGesture(event, true);
    };
    const onBlur = () => {
      finishGesture(null, true);
      onInteraction();
    };
    const onLeave = (event) => {
      if (!event.relatedTarget) {
        cat.point(null, now());
        run();
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        finishGesture(null, true);
        pausedAt = performance.now();
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        cancelAnimationFrame(measureFrame);
        measureFrame = null;
        paint();
      } else {
        if (pausedAt !== null) pausedTime += performance.now() - pausedAt;
        pausedAt = null;
        cat.point(null, now());
        measure();
      }
    };
    const changes = new MutationObserver(requestMeasure);
    changes.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "data-cat-context"],
    });
    const sizes = new ResizeObserver(requestMeasure);
    sizes.observe(document.body);
    if (document.querySelector(".main"))
      sizes.observe(document.querySelector(".main"));
    runtime.current = { cat, now, measure };
    cat.yarn.setEnabled(yarnEnabled, now());
    cat.setReduced(reduced, now());
    measure();
    document.addEventListener("pointermove", onPointer, {
      passive: false,
      capture: true,
    });
    document.addEventListener("pointerdown", onPetDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("lostpointercapture", onPointerCancel, true);
    document.addEventListener("click", onPetClick, true);
    document.addEventListener("keydown", onPetKey, true);
    document.addEventListener("pointerout", onLeave, { passive: true });
    document.addEventListener("pointerdown", onInteraction, { passive: true });
    document.addEventListener("pointercancel", onPointerCancel, true);
    document.addEventListener("click", onBackgroundClick);
    document.addEventListener("keydown", onInteraction);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("focusin", requestMeasure);
    window.addEventListener("scroll", requestMeasure, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", requestMeasure);
    return () => {
      disposed = true;
      if (gesture?.node.hasPointerCapture(gesture.pointerId))
        gesture.node.releasePointerCapture(gesture.pointerId);
      gesture = null;
      if (runtime.current?.cat === cat) runtime.current = null;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      cancelAnimationFrame(measureFrame);
      measureFrame = null;
      changes.disconnect();
      sizes.disconnect();
      document.removeEventListener("pointermove", onPointer, true);
      document.removeEventListener("pointerdown", onPetDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("lostpointercapture", onPointerCancel, true);
      document.removeEventListener("click", onPetClick, true);
      document.removeEventListener("keydown", onPetKey, true);
      document.removeEventListener("pointerout", onLeave);
      document.removeEventListener("pointerdown", onInteraction);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      document.removeEventListener("click", onBackgroundClick);
      document.removeEventListener("keydown", onInteraction);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("focusin", requestMeasure);
      window.removeEventListener("scroll", requestMeasure, true);
      window.removeEventListener("resize", requestMeasure);
    };
  }, [enabled, reduced]);
  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    current.cat.setPersonality(personality, current.now());
    current.measure();
  }, [personality]);
  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    current.cat.yarn.setEnabled(yarnEnabled, current.now());
    current.measure();
  }, [yarnEnabled]);
  if (!enabled) return null;
  return (
    <>
      <div
        ref={yarnElement}
        className="cat-yarn"
        data-atlas-pet="yarn"
        data-layer={yarnLayer}
        role="button"
        tabIndex={0}
        aria-label={t("cat.yarn.interact")}
        title={t("cat.yarn.interact")}
        hidden
      >
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          focusable="false"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="#cb91ce"
            stroke="#79517d"
            strokeWidth="1.5"
          />
          <g
            fill="none"
            stroke="#f2cef1"
            strokeWidth="1.25"
            strokeLinecap="round"
          >
            <path d="M5 5 Q18 8 19 18 M3 10 Q16 12 16 21 M5 18 Q12 11 11 3 M9 21 Q17 12 15 3 M3 14 Q8 7 19 8" />
            <path d="M13 12 Q5 8 10 6 Q15 6 15 12" />
          </g>
        </svg>
      </div>
      <div
        ref={element}
        className="atlas-cat"
        data-atlas-pet="cat"
        role="button"
        tabIndex={0}
        aria-label={t("cat.interact")}
        title={t("cat.interact")}
        data-visible="false"
      >
        <div className="cat-stage">
          <svg
            viewBox="0 0 110 84"
            width="94"
            height="72"
            focusable="false"
            aria-hidden="true"
          >
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
                className="cat-tail cat-hit"
                d="M34 66 C13 76 7 59 15 51 C21 46 25 50 23 55"
                fill="none"
                stroke="#e5ad72"
                strokeWidth="9"
              />
              <path
                d="M34 71 C27 57 34 42 46 40 C62 35 77 43 82 62 L78 75Z"
                className="cat-hit"
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
              <g className="cat-collar">
                <path
                  d="M53 51 Q69 58 84 50 L81 56 Q66 63 53 56Z"
                  fill="#94b6a0"
                  stroke="#587566"
                />
                <path
                  d="M73 57 L84 61 L75 67Z"
                  fill="#94b6a0"
                  stroke="#587566"
                />
              </g>
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
              <g className="cat-reaching-paws" fill="#fae2c1">
                <path d="M49 62 Q40 37 52 13 L59 15 Q51 39 60 59Z" />
                <path d="M72 62 Q82 38 74 13 L66 15 Q72 40 64 60Z" />
                <ellipse cx="55" cy="12" rx="6" ry="5" />
                <ellipse cx="70" cy="12" rx="6" ry="5" />
              </g>
              <g className="cat-head">
                <path
                  d="M44 37 L41 11 Q41 6 46 9 L59 19 Q68 16 78 20 L91 10 Q95 7 95 13 L92 38 Q88 54 69 54 Q48 54 44 37Z"
                  className="cat-hit"
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
                  <g className="cat-pupils">
                    <path
                      d="M57 32 V38 M81 32 V38"
                      stroke="#19292a"
                      strokeWidth="2"
                    />
                    <circle cx="58" cy="33" r=".9" fill="white" stroke="none" />
                    <circle cx="82" cy="33" r=".9" fill="white" stroke="none" />
                  </g>
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
                  className="cat-tongue"
                  d="M67 46 Q69 57 73 47"
                  fill="#dd9497"
                  stroke="none"
                />
                <path
                  d="M69 43 V45 M64 45 Q67 48 69 45 Q72 48 75 45 M50 40 L38 38 M50 44 L37 45 M88 40 L101 38 M88 44 L101 45"
                  fill="none"
                  strokeWidth="1"
                />
              </g>
              <g className="cat-peek-paws" fill="#fae2c1">
                <ellipse cx="48" cy="58" rx="7" ry="5" />
                <ellipse cx="87" cy="58" rx="7" ry="5" />
              </g>
            </g>
          </svg>
        </div>
      </div>
    </>
  );
}
