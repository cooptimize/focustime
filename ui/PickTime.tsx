// A pick's time on its own row (step 14.5, D259): "+ time" when untimed, "9:00–11:00" when timed in FocusTime,
// "9:00–11:00 · Outlook" with a calendar icon when it is on Outlook. Clicking opens the same small editor everywhere
// (week cards, Today, Plan the day): the block's free gaps, start and length, Put on Outlook, Remove time. Hidden when
// "Use timeboxing" is off (D261).
import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { pickTime } from "../plan/picktime.ts";
import type { Pick } from "../plan/types.ts";
import { MenuCtx, useMenu } from "./Menus.tsx";
import { spanText, timeStep } from "./menu.ts";
import { useTimeboxes } from "./Timeboxes.tsx";
import { Icon } from "./icons.tsx";

const HINT_KEY = "focustime.hint.picktime";
function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/** A small calendar glyph for "on Outlook". */
function CalIcon() {
  return (
    <Icon name="calendar" className="pt-cal" />
  );
}

/**
 * The time part of a pick row. `editable` is false on past days and for picks that aren't planned (the time still
 * shows). `hint` puts the one-time hint next to "+ time" (the first untimed pick in Plan the day or Today).
 */
export function PickTime({ pick, editable = true, hint = false }: { pick: Pick; editable?: boolean; hint?: boolean }): ReactNode {
  const env = useTimeboxes();
  const menu = useMenu((m) => timeStep(m, pick));
  const [seen, setSeen] = useState(hintSeen);
  const today = useContext(MenuCtx).env?.today ?? null;
  if (!env || !env.settings.enabled) return null;
  const { state, timebox: t } = pickTime(pick.id, env.timeboxes);
  const canEdit = editable && pick.status === "planned" && (today === null || pick.date >= today);
  const open = canEdit ? menu.onContextMenu : undefined;
  const stop = { onDoubleClick: (e: { stopPropagation: () => void }) => e.stopPropagation(), onKeyDown: (e: { stopPropagation: () => void }) => e.stopPropagation() };
  if (state === "untimed" || !t) {
    if (!canEdit) return null;
    return (
      <span className="pt-anchor">
        <button type="button" className="pt-add" aria-haspopup="menu" onClick={open} title="Give it a time in this block's free time" {...stop}>
          <Icon name="add" /> time
        </button>
        {hint && !seen && <TimeHint onDone={() => setSeen(true)} />}
      </span>
    );
  }
  const when = spanText(t.start, t.end, env.tz);
  const pending = state === "outlook" && !t.onOutlook;
  const note = t.conflict ? "Changed in FocusTime and in Outlook: choose a version" : t.outlookNote ?? (pending ? "Not on Outlook yet: confirm the preview" : null);
  const label = `${when}${state === "outlook" ? " on Outlook" : ""}${note ? `. ${note}` : ""}${canEdit ? ". Change the time" : ""}`;
  return (
    <button type="button" className={`pt-time ${state}${t.conflict ? " conflict" : ""}${pending ? " pending" : ""}`} aria-haspopup={canEdit ? "menu" : undefined} aria-label={label} title={label} onClick={open} disabled={!canEdit} {...stop}>
      {t.conflict && <><Icon name="risk" /> </>}
      <span className="pt-when">{when}</span>
      {state === "outlook" && (
        <span className="pt-ol">
          {" "}
          · Outlook <CalIcon />
        </span>
      )}
    </button>
  );
}

/** Where the hint must stay: the card its row is in (a Plan the day block, a Today block, a week card or a panel). */
export const HINT_CARD = ".pd2-block, .today-block, .half.card, .block-panel, .pl-card, .checklist";

/**
 * fix/planday-pane: the one-time hint as a small popover under "+ time" (it used to sit in the row and overflow it).
 * Anchored to the button's right edge; shifted right if it would leave the card on the left, and shown above the
 * button when there's no room below it inside the card.
 */
function TimeHint({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const card = el?.closest(HINT_CARD) as HTMLElement | null;
    if (!el || !card) return;
    const fit = () => {
      el.classList.remove("up");
      el.style.setProperty("--pt-shift", "0px");
      const c = card.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const shift = Math.max(0, c.left + 6 - r.left);
      el.style.setProperty("--pt-shift", `${Math.round(shift)}px`);
      if (r.bottom > c.bottom - 4 && r.top - c.top > r.height + 30) el.classList.add("up");
    };
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(card);
    return () => ro?.disconnect();
  }, []);
  return (
    <span ref={ref} className="pt-hint" role="note">
      Give it a time, optionally put it on Outlook.{" "}
      <button
        type="button"
        className="link-btn"
        onClick={(e) => {
          e.stopPropagation();
          onDone();
          try {
            localStorage.setItem(HINT_KEY, "1");
          } catch {
            // Storage can fail; the hint just shows again next time.
          }
        }}
      >
        Got it
      </button>
    </span>
  );
}
