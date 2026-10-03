import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { t } from "../shared/i18n.js";
import "./breadcrumbs.css";

export function Breadcrumbs({ items, label, onNavigate, className = "" }) {
  const [open, setOpen] = useState(null);
  const [position, setPosition] = useState(null);
  const navigation = useRef(null);
  const menu = useRef(null);
  const typeahead = useRef({ text: "", time: 0 });
  const menuId = useId();
  const current = items.find((item) => item.id === open?.id);
  const pathKey = JSON.stringify(items.map((item) => item.id));
  const menuKey = JSON.stringify(
    current?.choices.map(({ id, label }) => [id, label]),
  );

  function close(restoreFocus = false) {
    if (restoreFocus && open?.trigger?.isConnected) open.trigger.focus();
    setOpen(null);
    setPosition(null);
  }
  function show(event, item) {
    event.preventDefault();
    event.stopPropagation();
    setPosition(null);
    typeahead.current = { text: "", time: 0 };
    setOpen({ id: item.id, trigger: event.currentTarget });
  }
  function navigate(item) {
    close();
    onNavigate(item.target);
    requestAnimationFrame(() =>
      navigation.current?.querySelector('[aria-current="page"]')?.focus(),
    );
  }
  function triggerKey(event, item) {
    if (
      event.key === "ArrowDown" ||
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    )
      show(event, item);
  }

  useLayoutEffect(() => {
    setOpen(null);
    setPosition(null);
  }, [pathKey]);

  useLayoutEffect(() => {
    if (!open || !current || !menu.current) return;
    if (!open.trigger.isConnected) {
      close();
      return;
    }
    const anchor = open.trigger.getBoundingClientRect();
    const panel = menu.current.getBoundingClientRect();
    const inset = 8;
    const left = Math.max(
      inset,
      Math.min(anchor.left, window.innerWidth - panel.width - inset),
    );
    const preferredTop = anchor.bottom + 6;
    const top =
      preferredTop + panel.height <= window.innerHeight - inset
        ? preferredTop
        : Math.max(inset, anchor.top - panel.height - 6);
    setPosition({ left, top });
    const active =
      menu.current.querySelector('[aria-checked="true"]') ||
      menu.current.querySelector('[role="menuitemradio"]');
    active?.focus({ preventScroll: true });
    active?.scrollIntoView({ block: "nearest" });
  }, [open, menuKey]);

  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (
        !menu.current?.contains(event.target) &&
        !navigation.current?.contains(event.target)
      )
        close();
    };
    const dismiss = () => close();
    const scroll = (event) => {
      if (!menu.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  function menuKeyDown(event) {
    const buttons = [
      ...menu.current.querySelectorAll('[role="menuitemradio"]'),
    ];
    const index = buttons.indexOf(document.activeElement);
    let next;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(true);
      return;
    }
    if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
    if (event.key === "ArrowUp")
      next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    if (next !== undefined && buttons.length) {
      event.preventDefault();
      buttons[next].focus();
    } else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = Date.now();
      typeahead.current = {
        text:
          (now - typeahead.current.time < 700 ? typeahead.current.text : "") +
          event.key,
        time: now,
      };
      const normalize = (text) =>
        text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      const query = normalize(typeahead.current.text);
      const ordered = [
        ...buttons.slice(index + 1),
        ...buttons.slice(0, index + 1),
      ];
      ordered
        .find((button) => normalize(button.textContent).startsWith(query))
        ?.focus();
      event.preventDefault();
    }
  }

  return (
    <>
      <nav
        ref={navigation}
        className={`path-navigation ${className}`}
        aria-label={label}
      >
        <ol>
          {items.map((item, index) => (
            <li key={item.id}>
              {index > 0 && (
                <ChevronRight
                  className="path-separator"
                  size={13}
                  aria-hidden="true"
                />
              )}
              <div className="path-level">
                <button
                  type="button"
                  className="path-link"
                  aria-current={index === items.length - 1 ? "page" : undefined}
                  aria-haspopup="menu"
                  aria-expanded={open?.id === item.id}
                  aria-controls={open?.id === item.id ? menuId : undefined}
                  title={t("navigation.hint", item.label)}
                  onClick={() => navigate(item)}
                  onContextMenu={(event) => show(event, item)}
                  onKeyDown={(event) => triggerKey(event, item)}
                >
                  {item.label}
                </button>
                <button
                  type="button"
                  className="path-menu-trigger"
                  aria-label={t("navigation.otherPaths", item.label)}
                  aria-haspopup="menu"
                  aria-expanded={open?.id === item.id}
                  aria-controls={open?.id === item.id ? menuId : undefined}
                  onClick={(event) =>
                    open?.id === item.id ? close(true) : show(event, item)
                  }
                  onContextMenu={(event) => show(event, item)}
                  onKeyDown={(event) => triggerKey(event, item)}
                >
                  <ChevronDown size={12} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </nav>
      {open &&
        current &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            className="path-menu"
            role="menu"
            aria-label={current.menuLabel || t("navigation.sameLevel")}
            style={position || { left: 0, top: 0 }}
            onKeyDown={menuKeyDown}
          >
            <div className="path-menu-heading" role="presentation">
              {current.menuLabel || t("navigation.sameLevel")}
            </div>
            {current.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                role="menuitemradio"
                tabIndex={-1}
                aria-checked={choice.id === (current.activeId || current.id)}
                onClick={() => navigate(choice)}
              >
                <span className="path-menu-check">
                  {choice.id === (current.activeId || current.id) && (
                    <Check size={15} aria-hidden="true" />
                  )}
                </span>
                <span>{choice.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
