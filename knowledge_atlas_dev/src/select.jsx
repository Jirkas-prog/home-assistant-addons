import React, {
  Children,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { t } from "../shared/i18n.js";
import "./select.css";

// Keep the existing controlled option API while rendering the same menu on every device.
export function Select({
  children,
  value,
  onChange,
  className = "",
  disabled,
  required,
  ...props
}) {
  const id = useId(),
    trigger = useRef(),
    popup = useRef(),
    search = useRef();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const [active, setActive] = useState(""),
    [position, setPosition] = useState({});
  const options = Children.toArray(children)
    .filter(React.isValidElement)
    .map(({ props: p }) => ({
      value: String(p.value ?? ""),
      label: Children.toArray(p.children).join(""),
      disabled: p.disabled,
    }));
  const selected = options.find((o) => o.value === String(value ?? ""));
  const visible = options.filter((o) =>
    o.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const enabled = visible.filter((o) => !o.disabled);
  const close = (focus = false) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const choose = (option) => {
    if (option.disabled || trigger.current?.matches(":disabled")) return;
    close(true);
    if (option.value !== String(value ?? ""))
      onChange?.({
        target: { value: option.value },
        currentTarget: { value: option.value },
      });
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current.getBoundingClientRect(),
        viewport = window.visualViewport;
      const width = viewport?.width || window.innerWidth,
        height = viewport?.height || window.innerHeight;
      const x = viewport?.offsetLeft || 0,
        y = viewport?.offsetTop || 0;
      const below = y + height - rect.bottom - 12,
        above = rect.top - y - 12;
      const up = below < 220 && above > below,
        menuWidth = Math.min(Math.max(rect.width, 240), width - 16);
      setPosition({
        left: Math.max(x + 8, Math.min(rect.left, x + width - menuWidth - 8)),
        width: menuWidth,
        maxHeight: Math.max(80, Math.min(360, up ? above : below)),
        ...(up
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    const scroll = (e) => {
      if (!popup.current?.contains(e.target)) place();
    };
    window.addEventListener("scroll", scroll, true);
    const outside = (e) => {
      if (
        !popup.current?.contains(e.target) &&
        !trigger.current?.contains(e.target)
      )
        close();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => {
    if (open)
      popup.current
        ?.querySelector('[data-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  const show = () => {
    if (trigger.current?.matches(":disabled")) return;
    setQuery("");
    setActive(selected?.value ?? enabled[0]?.value);
    setOpen(true);
  };
  const keydown = (e) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "Tab" && open) {
      close(true);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        show();
        return;
      }
      const index = enabled.findIndex((o) => o.value === active);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? enabled.length - 1
            : (index + (e.key === "ArrowDown" ? 1 : -1) + enabled.length) %
              enabled.length;
      setActive(enabled[next]?.value);
      return;
    }
    if (e.key === "Enter" || (e.key === " " && e.target === trigger.current)) {
      e.preventDefault();
      e.stopPropagation();
      if (open) {
        const option = enabled.find((o) => o.value === active);
        if (option) choose(option);
      } else show();
    } else if (
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      e.target === trigger.current
    ) {
      e.preventDefault();
      if (!open) show();
      if (options.length > 10) {
        const next = (open ? query : "") + e.key;
        setQuery(next);
        setActive(
          options.find(
            (o) =>
              !o.disabled &&
              o.label.toLocaleLowerCase().includes(next.toLocaleLowerCase()),
          )?.value,
        );
        requestAnimationFrame(() => search.current?.focus());
      } else
        setActive(
          options.find(
            (o) =>
              !o.disabled &&
              o.label.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()),
          )?.value,
        );
    }
  };
  return (
    <>
      <button
        {...props}
        ref={trigger}
        type="button"
        role="combobox"
        disabled={disabled}
        className={`atlas-select ${className}`}
        aria-required={required || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={
          open && enabled.some((o) => o.value === active)
            ? `${id}-${active}`
            : undefined
        }
        onClick={() => (open ? close() : show())}
        onKeyDown={keydown}
      >
        <span className="atlas-select-value">
          {selected?.label || "\u00a0"}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            data-select-popup
            className="atlas-select-popup"
            style={position}
            onKeyDown={keydown}
            onClick={(e) => e.stopPropagation()}
          >
            {options.length > 10 && (
              <input
                ref={search}
                type="search"
                aria-label={t("select.search")}
                placeholder={t("select.search")}
                value={query}
                role="combobox"
                aria-expanded="true"
                aria-controls={`${id}-list`}
                aria-autocomplete="list"
                aria-activedescendant={
                  enabled.some((o) => o.value === active)
                    ? `${id}-${active}`
                    : undefined
                }
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(
                    options.find(
                      (o) =>
                        !o.disabled &&
                        o.label
                          .toLocaleLowerCase()
                          .includes(e.target.value.toLocaleLowerCase()),
                    )?.value,
                  );
                }}
              />
            )}
            <div
              role="listbox"
              id={`${id}-list`}
              aria-label={props["aria-label"] || t("select.options")}
              className="atlas-select-options"
            >
              {visible.map((o) => (
                <div
                  key={o.value}
                  id={`${id}-${o.value}`}
                  role="option"
                  aria-selected={o.value === String(value ?? "")}
                  aria-disabled={!!o.disabled}
                  data-active={o.value === active}
                  onMouseMove={() => !o.disabled && setActive(o.value)}
                  onPointerDown={(e) => {
                    if (e.pointerType === "mouse") e.preventDefault();
                  }}
                  onClick={() => choose(o)}
                >
                  <span>{o.label}</span>
                  {o.value === String(value ?? "") && (
                    <Check size={16} aria-hidden="true" />
                  )}
                </div>
              ))}
              {!visible.length && <p role="status">{t("select.empty")}</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
