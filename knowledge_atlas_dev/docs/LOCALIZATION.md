# Localization implementation

English is the default and fallback language. All Czech interface strings live in `shared/locales/cs.json`. Catalog keys are stable opaque message IDs; the matching English catalog documents their default text. New messages can also use descriptive keys.

`shared/i18n.js` handles interpolation and the active interface language. React subscribes to language changes. Module-level label maps use getters so enum labels change without changing their keys. Server settings persist the selection; default values and legacy settings without a language field use English. The API and logs remain English. Known server messages are localized only when displayed by the client.

User values are interpolated as plain strings and displayed through React, not HTML injection. The translator never evaluates code or recursively substitutes placeholders inside user text. Record IDs, type/status enums, function names, variable names, API paths and stored record bodies are not translated.

Localization leaves code identifiers unchanged. Search normalizes case with `toLowerCase` independently of the selected interface language.

`npm run check:languages` scans all distributable text outside the Czech catalog for Czech characters and common untranslated words, checks decoded JavaScript strings and translation references, and verifies matching keys and interpolation placeholders. Generated files, dependencies and private runtime data are excluded because they are not committed. Review human-facing text in addition to this automated heuristic.

Tests switch both catalogs, preserve task/priority IDs, exercise interpolation containing code-like values, verify the English default, restart the server after both language choices and compare record bytes before and after settings updates.

The application uses a new-install marker to initialize `languageSelectionCompleted: false` only for a fresh empty library. Older settings omit this field and read as completed; their bytes are not rewritten on startup. Completing setup is a revision-checked server settings write. This state is independent of browser storage and version numbers, so upgrades do not reopen the language screen. Interrupted setup remains pending. The first-launch form previews the selected translation locally before saving it for all sessions.
