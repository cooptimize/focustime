// DP-2: the time twin of AH-5's DateField: a button that opens a popover with a box for a typed time ("7pm", "19:30")
// and the day's 15-minute steps. A step picks and saves at once; Enter saves the typed time; Esc cancels. Never a native
// time input.
import { useEffect, useMemo, useRef, useState } from "react";
import { CellPopover } from "./CellPopover.tsx";
import { nearestStep, parseTypedTime, quarterHours, time12 } from "./timeinput.ts";
import { Icon } from "./icons.tsx";

export function TimeField({ value, onChange, label, className = "" }: { value: string; onChange: (t: string) => void; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => (setOpen(false), requestAnimationFrame(() => btn.current?.focus()));
  const save = (t: string) => (onChange(t), close());
  return (
    <>
      <button ref={btn} type="button" className={`date-field time-field ${className}`} aria-label={`${label}: ${value ? time12(value) : "none"}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{value || "Choose"}</span>
        <span className="date-field-icon"><Icon name="open" /></span>
      </button>
      {open && <TimePop anchor={btn.current} label={label} value={value} onSave={save} onCancel={close} />}
    </>
  );
}

function TimePop({ anchor, label, value, onSave, onCancel }: { anchor: HTMLElement | null; label: string; value: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  const steps = useMemo(quarterHours, []);
  const typed = parseTypedTime(text);
  const bad = !!text.trim() && !typed;
  const [active, setActive] = useState(() => (value ? nearestStep(value) : "09:00"));
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    void list.current?.querySelector(`[data-t="${active}"]`)?.scrollIntoView({ block: "center" });
  }, [active]);
  const move = (by: number) => {
    const next = steps[Math.max(0, Math.min(steps.length - 1, steps.indexOf(active) + by))]!;
    setActive(next);
    setText(next);
  };
  return (
    <CellPopover anchor={anchor} title={label} className="tp-pop" saveDisabled={!typed} onSave={() => typed && onSave(typed)} onCancel={onCancel}>
      <input
        className={`dp-box${bad ? " bad" : ""}`}
        data-autofocus
        aria-label={label}
        aria-invalid={bad || undefined}
        placeholder="Type a time, like 7pm or 19:30"
        value={text}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          const t = parseTypedTime(e.target.value);
          if (t) setActive(nearestStep(t));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), move(1));
          else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
        }}
      />
      {bad && <p className="dp-bad">That isn't a time FocusTime can read. Try 7pm or 19:30.</p>}
      <ul className="tp-list" ref={list} role="listbox" aria-label={`${label}, every 15 minutes`}>
        {steps.map((t) => (
          <li key={t} role="option" aria-selected={t === typed}>
            <button type="button" data-t={t} tabIndex={-1} className={`tp-step${t === active ? " on" : ""}`} onClick={() => onSave(t)}>
              {t} <span className="muted">{time12(t)}</span>
            </button>
          </li>
        ))}
      </ul>
    </CellPopover>
  );
}
