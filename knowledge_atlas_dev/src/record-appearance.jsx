import React from "react";
import { Check } from "lucide-react";
import { t } from "../shared/i18n.js";
import {
  RECORD_COLORS,
  randomRecordColor,
  recordMapSize,
} from "../shared/record-appearance.js";
import "./record-appearance.css";

export function RecordAppearance({ record, onChange }) {
  const size = Math.round(recordMapSize(record) * 100);
  return (
    <details className="editor-extra record-appearance">
      <summary>{t("appearance.bubble")}</summary>
      <div className="record-appearance-fields">
        <div>
          <span className="record-appearance-label">
            {t("appearance.color")}
          </span>
          <div
            className="colors"
            role="group"
            aria-label={t("appearance.color")}
          >
            {RECORD_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={t("m401", color)}
                aria-pressed={record.color === color}
                className={record.color === color ? "chosen" : ""}
                style={{ background: color }}
                onClick={() => onChange("color", color)}
              >
                {record.color === color && <Check size={15} />}
              </button>
            ))}
            <input
              type="color"
              aria-label={t("m208")}
              value={record.color}
              onChange={(e) => onChange("color", e.target.value)}
            />
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onChange("color", randomRecordColor())}
          >
            {t("appearance.randomColor")}
          </button>
        </div>
        <label>
          <span>
            {t("appearance.size")} · {size}%
          </span>
          <input
            type="range"
            min="50"
            max="300"
            step="5"
            value={size}
            aria-label={t("appearance.size")}
            aria-valuetext={`${size}%`}
            onChange={(e) => onChange("mapSize", Number(e.target.value) / 100)}
          />
          <span className="record-appearance-help">
            {t("appearance.sizeHelp")}
          </span>
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={size === 100}
          onClick={() => onChange("mapSize", 1)}
        >
          {t("appearance.resetSize")}
        </button>
      </div>
    </details>
  );
}
