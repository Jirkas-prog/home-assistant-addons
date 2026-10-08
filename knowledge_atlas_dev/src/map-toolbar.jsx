import React, { useEffect, useRef, useState } from "react";
import { Box, Network, SlidersHorizontal, X } from "lucide-react";
import { Select } from "./select.jsx";
import { MAP_LAYOUTS } from "../shared/map-layouts.js";
import { t } from "../shared/i18n.js";

export function MapToolbar({
  search,
  filters,
  types,
  activeFilters,
  clearFilters,
  layout,
  onLayout,
  mode,
  onMode,
  busy,
  detailControl,
  matches,
  pending,
  total,
  context,
}) {
  const [open, setOpen] = useState(false);
  const host = useRef(),
    trigger = useRef();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      // Select menus use a portal outside this disclosure.
      if (
        !host.current?.contains(event.target) &&
        !event.target.closest?.(".atlas-select-popup")
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className="map-toolbar-shell"
      ref={host}
      onKeyDown={(event) => {
        if (open && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="toolbar map-toolbar">
        {search}
        <button
          ref={trigger}
          className="secondary-button map-options-toggle"
          aria-expanded={open}
          aria-controls="map-options"
          onClick={() => setOpen(!open)}
        >
          <SlidersHorizontal size={16} />
          {t("map.options")}
          {!!activeFilters.length && (
            <span className="map-filter-count">{activeFilters.length}</span>
          )}
        </button>
        <div
          className="segmented"
          role="group"
          aria-label={t("map.dimensions")}
        >
          <button
            className={mode === "2d" ? "active" : ""}
            aria-pressed={mode === "2d"}
            aria-label={t("m141")}
            disabled={busy}
            onClick={() => onMode("2d")}
          >
            <Network size={15} />
            2D
          </button>
          <button
            className={mode === "3d" ? "active" : ""}
            aria-pressed={mode === "3d"}
            aria-label={t("m142")}
            disabled={busy}
            onClick={() => onMode("3d")}
          >
            <Box size={15} />
            3D
          </button>
        </div>
        {detailControl}
      </div>
      <div className="map-filter-summary">
        <span>
          {pending
            ? t("workspace.searching")
            : t("map.visibleCount", matches, total)}
          {!pending && context > 0 && ` · ${t("map.context", context)}`}
        </span>
        {activeFilters.map((filter) => (
          <button
            key={filter.id}
            className="map-filter-chip"
            title={filter.label}
            aria-label={t("map.removeFilter", filter.label)}
            onClick={filter.clear}
          >
            <span>{filter.label}</span>
            <X size={12} aria-hidden="true" />
          </button>
        ))}
        {!!activeFilters.length && (
          <button className="map-clear-filters" onClick={clearFilters}>
            {t("workspace.clearFilters")}
          </button>
        )}
      </div>
      {open && (
        <section
          className="map-options-panel"
          id="map-options"
          aria-label={t("map.options")}
        >
          <header>
            <strong>{t("map.options")}</strong>
            <button
              className="icon-button"
              aria-label={t("map.closeOptions")}
              onClick={close}
            >
              <X size={18} />
            </button>
          </header>
          <div className="map-options-fields">{filters}</div>
          {types}
          <label className="map-layout-field">
            <span>{t("map.layout")}</span>
            <Select
              aria-label={t("map.layout")}
              aria-describedby="map-layout-description"
              value={layout}
              disabled={busy}
              onChange={(e) => onLayout(e.target.value)}
            >
              {MAP_LAYOUTS.map((name, index) => (
                <option key={name} value={name}>
                  {index + 1}. {t(`map.layout.${name}`)}
                </option>
              ))}
            </Select>
          </label>
          <p className="map-layout-description" id="map-layout-description">
            {t(`map.layoutDescription.${layout}`)}
          </p>
          <footer>
            <button className="primary-button" onClick={close}>
              {t("map.showResults")}
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
