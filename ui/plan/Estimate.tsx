// E2 (D446): the two estimate controls, shared by Plan the week, Plan ahead, Plan the day and the detail panel.
// - HoursStepper: "− 6h +". The arrows step 1h (2h above 8h); a click on the value makes it a box: Enter saves,
//   Esc cancels, whole hours 1 to 80. A feature whose load comes from its stories shows the hours without a stepper.
// - SizeChip: XS, S, M, L, or a muted "Size?" when unsized (never amber). "M · 2h" where the row has room, else "M" with
//   "2h" on hover. A click opens a tiny menu: S, M, L, Clear. Sizing is optional: an unsized story counts as the person's assumption (SZ-1).
import { PlanCtx } from "../planview.ts";
import { useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { aboutText, hoursText, MAX_ESTIMATE_HOURS, MIN_ESTIMATE_HOURS, parseHours, sizeChipText, stepHours, storyMinutes, STORY_SIZES, unsizedText, type SizeScale, type StorySize } from "../../plan/estimate.ts";
import { MenuCtx } from "../Menus.tsx";
import type { MenuStep } from "../menu.ts";
import { Icon } from "../icons.tsx";

type StepperProps = {
  /** The estimate in minutes (whole hours). */
  minutes: number;
  /** At 1h, − clears instead (Plan ahead: takes the feature off that week). */
  onClear?: (() => void) | undefined;
  /** Saves a new estimate in whole hours. Absent: read only. */
  onSet?: ((hours: number) => void) | undefined;
  /** The load comes from its stories: the hours, no stepper ("from its stories" on hover). */
  derived?: boolean | undefined;
  /** "about 6h" (an estimate) rather than "6h". */
  about?: boolean | undefined;
  /** What it estimates, for the labels ("Order history export"). */
  label: string;
  disabled?: boolean | undefined;
  className?: string | undefined;
  tabIndex?: number | undefined;
};

export function HoursStepper({ minutes, onSet, onClear, derived = false, about = !derived, label, disabled = false, className = "", tabIndex }: StepperProps) {
  const hours = Math.max(MIN_ESTIMATE_HOURS, Math.round(minutes / 60));
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) box.current?.select();
  }, [editing]);
  const words = about ? aboutText(minutes) : hoursText(minutes);
  if (derived || !onSet)
    return (
      <span className={`hours-stepper derived ${className}`} role="group" aria-label={`Hours for ${label}${derived ? ", from its stories" : ""}`}>
        <span className="hs-step hs-ph"><Icon name="minus" /></span>
        <span className="hs-value static" title={derived ? "From its stories" : undefined}>{words}</span>
        <span className="hs-step hs-ph"><Icon name="add" /></span>
      </span>
    );
  const save = () => {
    const h = parseHours(text);
    setEditing(false);
    if (h !== null && h !== hours) onSet(h);
  };
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <span className={`hours-stepper ${className}`} role="group" aria-label={`Hours for ${label}`} onClick={stop} onDoubleClick={stop}>
      <button type="button" className="hs-step" tabIndex={tabIndex} disabled={disabled || (hours <= MIN_ESTIMATE_HOURS && !onClear)} aria-label={hours <= MIN_ESTIMATE_HOURS && onClear ? "None" : `Less: ${hoursText(stepHours(hours, -1) * 60)}`} onClick={() => (hours <= MIN_ESTIMATE_HOURS && onClear ? onClear() : onSet(stepHours(hours, -1)))}>
        <Icon name="minus" />
      </button>
      {editing ? (
        <input
          ref={box}
          className="hs-input"
          inputMode="numeric"
          aria-label={`Hours for ${label}, ${MIN_ESTIMATE_HOURS} to ${MAX_ESTIMATE_HOURS}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") save();
            else if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <button type="button" className="hs-value" tabIndex={tabIndex} disabled={disabled} title="Your estimate. Click to type hours" onClick={() => (setText(String(hours)), setEditing(true))}>
          {words}
        </button>
      )}
      <button type="button" className="hs-step" tabIndex={tabIndex} disabled={disabled || hours >= MAX_ESTIMATE_HOURS} aria-label={`More: ${hoursText(stepHours(hours, 1) * 60)}`} onClick={() => onSet(stepHours(hours, 1))}>
        <Icon name="add" />
      </button>
    </span>
  );
}

/** The tiny size menu: XS, S, M, L, Clear. */
export function sizeMenu(title: string, size: StorySize | null, onSet: (s: StorySize | null) => void, sizes: SizeScale): MenuStep {
  return {
    title: `Size of "${title}"`,
    items: [
      ...STORY_SIZES.map((z) => ({ id: `size-${z}`, label: sizeChipText(z, sizes), checked: size === z, run: () => onSet(z) })),
      { id: "size-clear", label: "Clear", hint: `counts as ${unsizedText(sizes)}`, checked: size === null, run: () => onSet(null) },
    ],
  };
}

type ChipProps = {
  size: StorySize | null;
  title: string;
  /** Sets or clears the size. Absent: a static chip. */
  onSet?: ((s: StorySize | null) => void) | undefined;
  /** "M · 2h" (room on the row) or "M" with "2h" on hover. */
  wide?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Shown on hover instead of the size's hours (e.g. "40m focused"). */
  note?: string | null | undefined;
  className?: string | undefined;
  tabIndex?: number | undefined;
  /** TX-1: once there's progress the chip reads "1h of 2h left" instead of the size. */
  left?: string | null | undefined;
};

export function SizeChip({ size, title, onSet, wide = false, disabled = false, note = null, className = "", tabIndex, left = null, asHours = false }: ChipProps & { /** WK-5: the size as hours ("1h"), for a Week row's time line. */ asHours?: boolean }) {
  const { open } = useContext(MenuCtx);
  const { sizes } = useContext(PlanCtx);
  const hours = size ? hoursText(storyMinutes(size, sizes)) : unsizedText(sizes);
  const text = left ?? (asHours && size ? hours : wide ? sizeChipText(size, sizes) : (size ?? "Size?"));
  const hover = note ?? (size ? `${size} is ${hours}` : `Not sized: counts as ${hours}`);
  const cls = `size-chip${size ? "" : " unsized"} ${className}`;
  if (!onSet || disabled)
    return (
      <span className={`${cls} static`} title={hover}>
        {text}
      </span>
    );
  const show = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    open({ x: r.left, y: r.bottom + 4 }, sizeMenu(title, size, onSet, sizes));
  };
  return (
    <button type="button" className={cls} tabIndex={tabIndex} title={`${hover}. Click to change`} aria-label={`Size ${size ?? "not set"} (${hours}), change`} aria-haspopup="menu" onClick={show} onDoubleClick={(e) => e.stopPropagation()}>
      {text}
    </button>
  );
}
