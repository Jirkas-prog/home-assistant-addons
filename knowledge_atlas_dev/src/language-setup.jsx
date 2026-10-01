import { release } from "../shared/release.js";
import React, { useState } from "react";
import { ArrowRight, Languages, Check } from "lucide-react";
import { translate, localizeMessage } from "../shared/i18n.js";
import { api, useDialogKeys } from "./client.js";
import "./language-setup.css";

export function LanguageSetup({ settings, onSaved }) {
  const [language, setChoice] = useState("en");
  const [revision, setRevision] = useState(settings.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = (key) => translate(language, key);
  useDialogKeys(React, () => {});
  return (
    <main className="language-setup">
      <form
        className="language-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="language-title"
        aria-describedby="language-help"
        lang={language}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            onSaved(
              await api("settings/language", {
                method: "POST",
                body: JSON.stringify({ language, revision }),
              }),
            );
          } catch (failure) {
            if (failure.status === 409) {
              try {
                const latest = await api("settings");
                if (latest.languageSelectionCompleted) {
                  onSaved(latest);
                  return;
                }
                setRevision(latest.revision);
              } catch {
                /* Keep the original choice and report the failed save. */
              }
            }
            setError(label("setup.saveError"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="language-brand">
          <img src="./app-logo.svg" alt="" width="44" height="44" />
          <span>
            {release.name} <small>{release.version}</small>
          </span>
        </div>
        <div className="language-emblem">
          <Languages size={27} />
        </div>
        <h1 id="language-title">{label("setup.title")}</h1>
        <p id="language-help">{label("setup.description")}</p>
        <fieldset disabled={busy}>
          <legend>{label("settings.language")}</legend>
          {["en", "cs"].map((code) => (
            <label
              key={code}
              className={`language-option ${language === code ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="language"
                value={code}
                checked={language === code}
                autoFocus={code === "en"}
                onChange={() => {
                  setChoice(code);
                  setError("");
                }}
              />
              <span>
                <strong>{translate(language, `language.${code}`)}</strong>
                <small>
                  {label(code === "en" ? "setup.default" : "setup.alternative")}
                </small>
              </span>
              {language === code && <Check size={20} aria-hidden="true" />}
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="language-error" role="alert">
            {localizeMessage(error)}
          </p>
        )}
        <button
          className="primary-button language-submit"
          type="submit"
          disabled={busy}
        >
          {label(busy ? "setup.saving" : "setup.continue")}
          <ArrowRight size={18} />
        </button>
        <p className="language-footnote">{label("setup.settingsHint")}</p>
      </form>
    </main>
  );
}
