// UI-B: the "now" line on today (plan/nowline.ts says where): a thin accent line with a dot and the time at its left end,
// on a block's hour rail (with the past part of the rail dimmed), at the edge before or after the day, thinner on a PTO
// or catch-up day, and as a row in an agenda. It moves with the app's clock; reduced motion means it jumps, no slide.
// Clicking the time scrolls today into view (narrow windows and the phone).
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

const pct = (f: number) => `${(Math.min(1, Math.max(0, f)) * 100).toFixed(3)}%`;

/** Brings today's column into view and hands the click on (the Board selects today). */
function toToday(e: ReactMouseEvent, then?: () => void) {
  e.stopPropagation();
  (e.currentTarget as HTMLElement).closest(".day, .today-view, .pd2")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  then?.();
}

function Time({ label, onClick }: { label: string; onClick?: (() => void) | undefined }) {
  return (
    <button type="button" className="nl-time" onClick={(e) => toToday(e, onClick)} title={`Now, ${label}`} aria-label={`Now, ${label}. Show today`}>
      <span className="nl-pill">{label}</span>
    </button>
  );
}

/** On a rail or a whole-day cell, at a fraction of its height. */
export function NowLine({ at, label, thin = false, onClick }: { at: number; label: string; thin?: boolean; onClick?: () => void }) {
  return (
    <div className={`now-line${thin ? " thin" : ""}`} style={{ top: pct(at) } as CSSProperties} role="presentation">
      <span className="nl-dot" aria-hidden="true" />
      <Time label={label} onClick={onClick} />
    </div>
  );
}

/** The past part of a rail on today, dimmed (1 for a block that has ended). */
export function NowPast({ at }: { at: number }) {
  return at > 0 ? <div className="now-past" style={{ height: pct(at) }} aria-hidden="true" /> : null;
}

/** Before or after the day's blocks (or on the phone, at the top of the block under way): a line in its own row. */
export function NowEdge({ label, thin = false, onClick }: { label: string; thin?: boolean; onClick?: () => void }) {
  return (
    <div className={`now-line now-edge${thin ? " thin" : ""}`}>
      <span className="nl-dot" aria-hidden="true" />
      <Time label={label} onClick={onClick} />
    </div>
  );
}

/** A row in a time-ordered agenda list. */
export function NowRow({ label }: { label: string }) {
  return (
    <li className="now-line now-row" aria-label={`Now, ${label}`}>
      <span className="nl-dot" aria-hidden="true" />
      <span className="nl-pill">{label}</span>
    </li>
  );
}
