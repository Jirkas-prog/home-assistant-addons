import { t, localizeMessage } from "../shared/i18n.js";
export async function api(url, options = {}) {
  const response = await fetch(`./api/${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Knowledge-Client": "atlas",
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(localizeMessage(result.error) || t("m001")), {
      status: response.status,
      details: result,
    });
  return result;
}
export function useDialogKeys(React, close) {
  const closeRef = React.useRef(close);
  closeRef.current = close;
  React.useEffect(() => {
    const previous = document.activeElement;
    const handler = (e) => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')],
        dialog = dialogs.at(-1);
      if (!dialog?.contains(document.activeElement) && e.key !== "Escape")
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const items = [
          ...dialog.querySelectorAll(
            "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
          ),
        ].filter((el) => el.getClientRects().length);
        if (!items.length) return;
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => {
      document.removeEventListener("keydown", handler, true);
      previous?.focus?.();
    };
  }, []);
}
