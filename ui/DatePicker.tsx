// AH-5: the app's own date picker (no native date input): a box at the top that takes a typed date ("nov 20",
// "11/20"), the quick picks (Today, Tomorrow, Next Monday, +1 week, Clear), and a month calendar with today marked and
// the week starting on Monday. Arrow keys move a day or a week in the calendar, Page Up and Page Down a month.
// DateField is the same picker behind a button, for filters and forms.
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CellPopover } from "./CellPopover.tsx";
import { dayText, monthGrid, parseTypedDate, quickPicks } from "./dateinput.ts";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const monthTitle = (y: number, m: number) => Temporal.PlainDate.from({ year: y, month: m, day: 1 }).toLocaleString("en-US", { month: "long", year: "numeric" });
const longDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/**
 * The picker's body. `value` is the chosen day (or null for none); `onChange` gets each choice; Enter in the box keeps
 * the typed day and lets the popover save (`onEnter`). `clearable` shows Clear among the quick picks.
 */
export function DatePicker({ value, onChange, today, label, clearable = true, onEnter, children }: { value: string | null; onChange: (d: string | null) => void; today: string; label: string; clearable?: boolean; /** Enter: keep this day and save (the popover's Save with it). */ onEnter?: (d: string | null) => void; children?: React.ReactNode }) {
  const [text, setText] = useState(() => (value ? dayText(value, today) : ""));
  const [bad, setBad] = useState(false);
  const shown0 = Temporal.PlainDate.from(value ?? today);
  const [month, setMonth] = useState({ y: shown0.year, m: shown0.month });
  const [focusDay, setFocusDay] = useState(value ?? today);
  const grid = useMemo(() => monthGrid(month.y, month.m), [month]);
  const cal = useRef<HTMLDivElement>(null);
  const typed = useRef(false);
  // A pick from the calendar or a quick pick shows in the box; typing doesn't get rewritten under the cursor.
  useEffect(() => {
    if (typed.current) return;
    setText(value ? dayText(value, today) : "");
  }, [value, today]);
  const choose = (d: string | null) => {
    typed.current = false;
    setBad(false);
    onChange(d);
    if (d) {
      const p = Temporal.PlainDate.from(d);
      setMonth({ y: p.year, m: p.month });
      setFocusDay(d);
    }
  };
  const step = (n: number) => setMonth((x) => {
    const p = Temporal.PlainDate.from({ year: x.y, month: x.m, day: 1 }).add({ months: n });
    return { y: p.year, m: p.month };
  });
  const moveFocus = (days: number, months = 0) => {
    const p = Temporal.PlainDate.from(focusDay).add({ days, months });
    setFocusDay(p.toString());
    setMonth({ y: p.year, m: p.month });
    requestAnimationFrame(() => cal.current?.querySelector<HTMLElement>(`[data-day="${p.toString()}"]`)?.focus());
  };
  return (
    <div className="dp">
      <input
        className={`dp-box${bad ? " bad" : ""}`}
        data-autofocus
        aria-label={label}
        aria-invalid={bad || undefined}
        placeholder="Type a date, like nov 20 or 11/20"
        value={text}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
          const d = parseTypedDate(e.target.value, today);
          setBad(!!e.target.value.trim() && !d);
          if (d) {
            onChange(d);
            const p = Temporal.PlainDate.from(d);
            setMonth({ y: p.year, m: p.month });
            setFocusDay(d);
          } else if (!e.target.value.trim() && clearable) onChange(null);
        }}
        onBlur={() => {
          typed.current = false;
          if (!bad) setText(value ? dayText(value, today) : "");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && bad) e.preventDefault();
          else if (e.key === "Enter" && onEnter) (e.preventDefault(), (typed.current = false), onEnter(value));
          else if (e.key === "ArrowDown") (e.preventDefault(), cal.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus());
        }}
      />
      {bad && <p className="dp-bad">That isn't a date FocusTime can read. Try nov 20 or 11/20.</p>}
      <div className="dp-quick" role="group" aria-label="Quick picks">
        {quickPicks(today, value)
          .filter((q) => clearable || q.key !== "clear")
          .map((q) => (
            <button key={q.key} type="button" className={`dp-chip${q.date !== null && q.date === value ? " on" : ""}`} title={q.date ? longDay(q.date) : "No date"} onClick={() => choose(q.date)}>
              {q.label}
            </button>
          ))}
      </div>
      <div className="dp-cal" ref={cal}>
        <div className="dp-nav">
          <button type="button" className="dp-step" aria-label="Previous month" onClick={() => step(-1)}>
            ‹
          </button>
          <span className="dp-month" aria-live="polite">
            {monthTitle(month.y, month.m)}
          </span>
          <button type="button" className="dp-step" aria-label="Next month" onClick={() => step(1)}>
            ›
          </button>
        </div>
        <table className="dp-grid" role="grid" aria-label={monthTitle(month.y, month.m)}>
          <thead>
            <tr>
              {WEEKDAYS.map((w) => (
                <th key={w} scope="col" abbr={w}>
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((week) => (
              <tr key={week[0]!.date}>
                {week.map((d) => (
                  <td key={d.date} role="gridcell" aria-selected={d.date === value}>
                    <button
                      type="button"
                      data-day={d.date}
                      tabIndex={d.date === focusDay ? 0 : -1}
                      className={`dp-day${d.inMonth ? "" : " out"}${d.date === today ? " today" : ""}${d.date === value ? " on" : ""}`}
                      aria-label={`${longDay(d.date)}${d.date === today ? ", today" : ""}`}
                      aria-pressed={d.date === value}
                      onClick={() => choose(d.date)}
                      onKeyDown={(e) => {
                        const k = e.key;
                        const by: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [-7, 0], ArrowDown: [7, 0], PageUp: [0, -1], PageDown: [0, 1] };
                        if (by[k]) {
                          e.preventDefault();
                          e.stopPropagation();
                          moveFocus(by[k]![0], by[k]![1]);
                        } else if (k === "Enter" && onEnter) {
                          // Enter on a day picks it and saves; Space (or a click) only picks.
                          e.preventDefault();
                          choose(d.date);
                          onEnter(d.date);
                        }
                      }}
                    >
                      {Temporal.PlainDate.from(d.date).day}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {children}
    </div>
  );
}

/**
 * A date behind a button (filters, forms): shows the day or a placeholder; opens the picker in a popover with Save and
 * Cancel. Never a native date input.
 */
export function DateField({ value, onChange, label, today, placeholder = "Any", clearable = true, className = "" }: { value: string | null; onChange: (d: string | null) => void; label: string; today: string; placeholder?: string; clearable?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(value);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => (setOpen(false), requestAnimationFrame(() => btn.current?.focus()));
  const save = (v: string | null = draft) => (onChange(v), close());
  return (
    <>
      <button ref={btn} type="button" className={`date-field${value ? "" : " empty"} ${className}`} aria-label={`${label}: ${value ? longDay(value) : "none"}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => (setDraft(value), setOpen(!open))}>
        <span>{value ? dayText(value, today) : placeholder}</span>
        <span className="date-field-icon" aria-hidden="true">▾</span>
      </button>
      {open && (
        <CellPopover anchor={btn.current} title={label} onSave={() => save()} onCancel={close} className="dp-pop">
          <DatePicker value={draft} onChange={setDraft} today={today} label={label} clearable={clearable} onEnter={save} />
        </CellPopover>
      )}
    </>
  );
}
