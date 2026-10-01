import en from "./locales/en.json" with { type: "json" };
import cs from "./locales/cs.json" with { type: "json" };

let language = "en";
const listeners = new Set();
export const getLanguage = () => language;
export const locale = () => (language === "cs" ? "cs-CZ" : "en-GB");
export function setLanguage(value) {
  const next = value === "cs" ? "cs" : "en";
  if (next === language) return;
  language = next;
  for (const notify of listeners) notify();
}
export function subscribeLanguage(notify) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}
export function translate(code, key, ...values) {
  const message = (code === "cs" ? cs[key] : en[key]) ?? en[key] ?? key;
  return message.replace(/\{(\d+)\}/g, (placeholder, i) =>
    i < values.length ? String(values[i]) : placeholder,
  );
}
export const t = (key, ...values) => translate(language, key, ...values);

// The API and logs stay in English. Translate known messages for display only;
// captured filenames, titles and other user content are never translated.
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const messages = Object.entries(en).map(([key, value]) => ({
  key,
  pattern: new RegExp(
    "^" +
      value
        .split(/\{\d+\}/)
        .map(escape)
        .join("([\\s\\S]*?)") +
      "$",
  ),
}));
export function localizeMessage(message) {
  if (language !== "cs" || typeof message !== "string") return message;
  for (const { key, pattern } of messages) {
    const match = message.match(pattern);
    if (match) return t(key, ...match.slice(1));
  }
  return message;
}
