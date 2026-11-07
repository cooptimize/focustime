// Step 16.2: one mode switch per tab, always at the right of the page header, the same everywhere. Each mode may show
// a ✓ (done for that day or week) or a small dot (due now). Status is shown, never forced.
import type { ModeStatus } from "../plan/modes.ts";
import { MODE_NAMES, MODES, TAB_NAMES, type ModeName, type Tab } from "./nav.ts";

const STATUS_WORDS = { done: "done", due: "due now" } as const;

/** AH-3: `counts` adds " · N" to a mode ("Fix next · 12"). UI-7: `badges` puts a small badge in a segment (the Inbox's, styled like the top bar's Inbox badge); none at 0. */
export function ModeSwitch({ tab, current, status = {}, counts = {}, badges = {}, onMode }: { tab: Tab; current: ModeName; status?: Partial<Record<ModeName, ModeStatus>>; counts?: Partial<Record<ModeName, number>>; badges?: Partial<Record<ModeName, number | null>>; onMode: (m: ModeName) => void }) {
  const modes = MODES[tab];
  if (modes.length < 2) return null;
  return (
    <nav className="mode-switch" aria-label={`${TAB_NAMES[tab]} modes`}>
      {modes.map((m) => {
        const s = status[m] ?? null;
        const n = badges[m] ?? 0;
        return (
          <button key={m} type="button" className="ms-btn" aria-current={current === m ? "page" : undefined} onClick={() => current !== m && onMode(m)} title={s ? `${MODE_NAMES[m]}: ${STATUS_WORDS[s]}` : MODE_NAMES[m]}>
            {MODE_NAMES[m]}
            {counts[m] !== undefined && <span className="ms-count"> · {counts[m]}</span>}
            {n > 0 && <span className="count" aria-label={`${n} open`}>{n}</span>}
            {s === "done" && <span className="ms-done" aria-label="done">✓</span>}
            {s === "due" && <span className="ms-due" role="img" aria-label="due now" />}
          </button>
        );
      })}
    </nav>
  );
}

/** The right side of a page header: a planning mode's state (UI-7: Draft, Confirmed, changed since you confirmed), its green Done, then the switch. */
export function ModeArea({ children, done, note = null }: { children: React.ReactNode; done?: { label?: string; title?: string; disabled?: boolean; onClick: () => void } | null; note?: string | null }) {
  return (
    <div className="mode-area">
      {note && <span className="ma-note" role="status">{note}</span>}
      {done && (
        <button type="button" className="done-btn" disabled={done.disabled} onClick={done.onClick} title={done.title ?? "Save and go back"}>
          {done.label ?? "Done"}
        </button>
      )}
      {children}
    </div>
  );
}

/**
 * WK-2: the Board's Timeline toggle, beside the mode switch: one click shows or hides the hour rail beside each card's
 * to-dos (B, Week's ⋯ and the command do the same). Pressed while the timeline shows.
 */
export function TimelineToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const words = shown ? "Hide timeline" : "Show timeline";
  return (
    <button type="button" className={`tl-toggle${shown ? " on" : ""}`} aria-pressed={shown} onClick={onToggle} title={`${words} (B)`} aria-label={words}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
        <line x1="11.5" y1="6" x2="13.5" y2="6" stroke="currentColor" strokeWidth="1.1" />
        <line x1="11.5" y1="9" x2="13.5" y2="9" stroke="currentColor" strokeWidth="1.1" />
        {!shown && <line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" strokeWidth="1.3" />}
      </svg>
      <span className="tl-word">Timeline</span>
    </button>
  );
}
