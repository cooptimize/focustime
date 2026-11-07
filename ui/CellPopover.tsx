// AH-5: one small popover anchored to a cell (or any element), for editing a value that needs more room than its
// column: a title, the editor, and Save and Cancel. It sits in the top layer (like the row menus), under the anchor or
// flipped above it, and stays on screen (ui/popover-place.ts). Esc cancels, Enter saves, Tab saves and moves on (the
// owner decides where); a click outside cancels. The owner puts focus back on the anchor after it closes.
import type React from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { placePopover } from "./popover-place.ts";

export type PopoverKeys = {
  /** Enter (not Shift+Enter) anywhere in the popover, unless a control handled it first (preventDefault). */
  onSave: () => void;
  onCancel: () => void;
  /** Tab or Shift+Tab: save and move to the next or previous cell. Missing: Tab moves inside the popover. */
  onTab?: (back: boolean) => void;
};

export function CellPopover({
  anchor,
  title,
  sub,
  children,
  onSave,
  onCancel,
  onTab,
  saveLabel = "Save",
  saveDisabled = false,
  warning,
  className = "",
  width,
}: PopoverKeys & {
  anchor: HTMLElement | null;
  title: string;
  /** The item the value belongs to, after the field name: "#273 DevOps Status Report Automation". */
  sub?: string;
  children: React.ReactNode;
  saveLabel?: string;
  saveDisabled?: boolean;
  /** An inline problem (Target before Start): shown above the buttons; Save is off while it's there. */
  warning?: string | null;
  className?: string;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number; above: boolean } | null>(null);
  const place = useCallback(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    setPos(placePopover(a, { width: el.offsetWidth, height: el.scrollHeight }, { width: window.innerWidth, height: window.innerHeight }));
  }, [anchor]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A popover sits in the top layer, above side panels and dialogs.
    if (typeof el.showPopover === "function" && !el.matches(":popover-open")) el.showPopover();
    place();
    const f = el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>("input, [role=listbox], button");
    f?.focus({ preventScroll: true });
  }, [place]);
  useEffect(() => {
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    if (ref.current) ro?.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      // A click inside, or on the cell it belongs to, keeps it open.
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onCancel();
    };
    window.addEventListener("mousedown", away, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("mousedown", away, true);
    };
  }, [place, onCancel, anchor]);
  const blocked = saveDisabled || !!warning;
  return (
    <div
      ref={ref}
      className={`cell-pop ${className}`}
      role="dialog"
      aria-labelledby={titleId}
      popover="manual"
      data-overlay="modal"
      data-above={pos?.above ? "" : undefined}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxHeight, ...(width ? { width } : {}) }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter" && !e.shiftKey && !e.defaultPrevented && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          if (!blocked) onSave();
        } else if (e.key === "Tab" && onTab) {
          e.preventDefault();
          if (!blocked) onTab(e.shiftKey);
        }
      }}
    >
      <div className="cell-pop-head" id={titleId}>
        <span className="cell-pop-title">{title}</span>
        {sub && <span className="cell-pop-sub"> · {sub}</span>}
      </div>
      <div className="cell-pop-body">{children}</div>
      {warning && (
        <p className="cell-pop-warn" role="alert">
          {warning}
        </p>
      )}
      <div className="cell-pop-foot">
        <button type="button" className="mini quiet" onClick={onCancel} title="Cancel (Esc)">
          Cancel
        </button>
        <button type="button" className="mini primary" onClick={onSave} disabled={blocked} title={onTab ? `${saveLabel} (Enter, or Tab to save and go to the next cell)` : `${saveLabel} (Enter)`}>
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

export type ListOption = { key: string; label: string; /** A second, smaller line under the label (a person's domain). */ sub?: React.ReactNode; hint?: React.ReactNode; lead?: React.ReactNode; search?: string; title?: string };

/**
 * A filterable list inside a popover (State, Assigned to, a filter's choices): the box at the top filters as you type;
 * arrows move, Enter picks the active one, a click picks; the current one is checked. A combobox over a listbox.
 */
export function FilterList({ options, current, onPick, label, placeholder, empty = "Nothing matches", filter = true, note }: { options: readonly ListOption[]; current: string | null; onPick: (key: string) => void; label: string; placeholder?: string; empty?: string; filter?: boolean; note?: React.ReactNode }) {
  const [q, setQ] = useState("");
  const listId = useId();
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = options.filter((o) => words.every((w) => (o.search ?? o.label).toLowerCase().includes(w)));
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.key === current)));
  useEffect(() => {
    if (q) setActive(0);
  }, [q]);
  const at = Math.min(active, Math.max(shown.length - 1, 0));
  const list = useRef<HTMLUListElement>(null);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    (box.current ?? list.current)?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setActive(Math.min(at + 1, shown.length - 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setActive(Math.max(at - 1, 0)));
    else if (e.key === "Home" && !filter) (e.preventDefault(), setActive(0));
    else if (e.key === "End" && !filter) (e.preventDefault(), setActive(shown.length - 1));
    else if (e.key === "Enter" && shown[at]) (e.preventDefault(), onPick(shown[at]!.key));
  };
  return (
    <div className="fl">
      {filter ? (
        <input
          ref={box}
          className="fl-box"
          data-autofocus
          role="combobox"
          aria-label={label}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          {...(shown[at] ? { "aria-activedescendant": `${listId}-${at}` } : {})}
          value={q}
          placeholder={placeholder ?? "Type to filter"}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={keys}
        />
      ) : null}
      <ul ref={list} id={listId} className="fl-list" role="listbox" aria-label={label} tabIndex={filter ? -1 : 0} {...(!filter ? { "data-autofocus": "", onKeyDown: keys, ...(shown[at] ? { "aria-activedescendant": `${listId}-${at}` } : {}) } : {})}>
        {shown.map((o, i) => (
          <li
            key={o.key}
            id={`${listId}-${i}`}
            data-i={i}
            role="option"
            aria-selected={o.key === current}
            className={`fl-option${i === at ? " active" : ""}${o.key === current ? " current" : ""}`}
            title={o.title}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(o.key)}
          >
            <span className="fl-check" aria-hidden="true">{o.key === current ? "✓" : ""}</span>
            {o.lead}
            {o.sub ? (
              <span className="fl-two">
                <span className="fl-label">{o.label}</span>
                <span className="fl-sub">{o.sub}</span>
              </span>
            ) : (
              <span className="fl-label">{o.label}</span>
            )}
            {o.hint && <span className="fl-hint">{o.hint}</span>}
          </li>
        ))}
        {!shown.length && <li className="fl-empty muted">{empty}</li>}
      </ul>
      {note && <p className="fl-note muted">{note}</p>}
    </div>
  );
}

/** A small segmented control (AM | PM, Start | Target, a size's values), the mode switch's look at a smaller size. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: readonly { value: T; label: string; title?: string }[]; value: T | null; onChange: (v: T) => void; label: string }) {
  return (
    <span className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`seg-btn${value === o.value ? " on" : ""}`}
          title={o.title}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.value === o.value);
            const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
            if (n === null) return;
            e.preventDefault();
            e.stopPropagation();
            const next = options[(n + options.length) % options.length]!;
            onChange(next.value);
            ((e.currentTarget.parentElement?.children[(n + options.length) % options.length] as HTMLElement | undefined) ?? null)?.focus();
          }}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
