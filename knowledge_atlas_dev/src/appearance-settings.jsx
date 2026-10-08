import React from "react";
import { Palette, Check } from "lucide-react";
import {
  APPEARANCES,
  appearanceId,
  appearanceVariables,
} from "../shared/appearance.js";
import { t } from "../shared/i18n.js";
import "./appearance-settings.css";

export function AppearanceSettings({ value, onChange }) {
  return (
    <section className="appearance-settings" aria-labelledby="appearance-title">
      <h3 id="appearance-title">
        <Palette size={20} />
        {t("appearance.title")}
      </h3>
      <p className="field-help">{t("appearance.help")}</p>
      <fieldset className="appearance-choices">
        <legend>{t("appearance.choose")}</legend>
        <div className="appearance-grid">
          {Object.entries(APPEARANCES).map(([id, palette]) => (
            <label
              key={id}
              className="appearance-card"
              data-selected={appearanceId(value) === id}
            >
              <input
                type="radio"
                name="appearance"
                value={id}
                checked={appearanceId(value) === id}
                onChange={() => onChange(id)}
              />
              <span
                className="appearance-mini"
                style={appearanceVariables(id)}
                aria-hidden="true"
              >
                <span className="appearance-mini-sidebar">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="appearance-mini-content">
                  <span>
                    <i />
                    <b />
                  </span>
                  <span>
                    <i />
                    <i />
                  </span>
                </span>
              </span>
              <span className="appearance-card-title">
                {t(`appearance.${id}`)}
                {appearanceId(value) === id && <Check size={16} />}
              </span>
              <small>{t(`appearance.${id}.description`)}</small>
              <span className="appearance-tone">
                {t(`appearance.${palette.scheme}`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="appearance-preview-note" role="status">
        {t("appearance.preview")}
      </p>
    </section>
  );
}
