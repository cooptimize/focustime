// Step 16.2: one mode switch per tab, always at the right of the page header, the same everywhere. Each mode may show
// a ✓ (done for that day or week) or a small dot (due now). Status is shown, never forced.
import { usePhone } from "./viewport.ts";
import type { ModeStatus } from "../plan/modes.ts";
import { MODE_NAMES, MODES, TAB_NAMES, type ModeName, type Tab } from "./nav.ts";
import { Icon } from "./icons.tsx";
import { CARD_MEETINGS } from "../plan/call-words.ts";

const STATUS_WORDS = { done: "done", due: "due now" } as const;

/** AH-3: `counts` adds " · N" to a mode ("Fix next · 12"). UI-7: `badges` puts a small badge in a segment (the Inbox's, styled like the top bar's Inbox badge); none at 0. */
export function ModeSwitch({ tab, current, status = {}, counts = {}, badges = {}, onMode }: { tab: Tab; current: ModeName; status?: Partial<Record<ModeName, ModeStatus>>; counts?: Partial<Record<ModeName, number>>; badges?: Partial<Record<ModeName, number | null>>; onMode: (m: ModeName) => void }) {
  const modes = MODES[tab];
  if (modes.length < 2) return null;
  return (
    <nav className="mode-switch" aria-label={`${TAB_NAMES[tab]} ${tab === "ahead" ? "views" : "modes"}`} data-tour={`modes-${tab}`}>
      {modes.map((m) => {
        const s = status[m] ?? null;
        const n = badges[m] ?? 0;
        return (
          <button key={m} type="button" className="ms-btn" aria-current={current === m ? "page" : undefined} onClick={() => current !== m && onMode(m)} title={s ? `${MODE_NAMES[m]}: ${STATUS_WORDS[s]}` : MODE_NAMES[m]}>
            {MODE_NAMES[m]}
            {counts[m] !== undefined && <span className="ms-count"> · {counts[m]}</span>}
            {n > 0 && <span className="count" aria-label={`${n} open`}>{n}</span>}
            {s === "done" && <span className="ms-done"><Icon name="done" label="done" /></span>}
            {s === "due" && <span className="ms-due" role="img" aria-label="due now" />}
          </button>
        );
      })}
    </nav>
  );
}

/** The right side of a page header: a planning mode's state (UI-7: Draft, Confirmed, changed since you confirmed), its green Done, then the switch. */
export function ModeArea({ children, done, note = null }: { children: React.ReactNode; done?: { label?: string; title?: string; disabled?: boolean; onClick: () => void } | null; note?: string | null }) {
  const phone = usePhone();
  return (
    <div className="mode-area">
      {note && <span className="ma-note" role="status">{note}</span>}
      {done && (phone && /^Back to /.test(done.label ?? "") ? (
        // MB-1: on the phone a way back is a small text link with an arrow, not a big green button.
        <button type="button" className="done-link" data-tour="mode-done" disabled={done.disabled} onClick={done.onClick} title={done.title ?? "Go back"}>
          <Icon name="arrow-left" />{" "}
          {done.label}
        </button>
      ) : (
        <button type="button" className="done-btn" data-tour="mode-done" disabled={done.disabled} onClick={done.onClick} title={done.title ?? "Save and go back"}>
          {done.label ?? "Done"}
        </button>
      ))}
      {children}
    </div>
  );
}

/**
 * PS-1: Cards | Timeline, the one switch for a view's two layouts, on Day and on Week (Week's single toggle button
 * before). The pressed half is the view shown; B, the ⋯ menus and the command menu still switch it.
 */
export function CardsTimelineSwitch({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <span className="day-switch" role="group" aria-label="Cards or timeline" data-tour="wk-timeline">
      <button type="button" aria-pressed={!shown} onClick={() => shown && onToggle()} title="The blocks as cards (B)">
        Cards
      </button>
      <button type="button" aria-pressed={shown} onClick={() => !shown && onToggle()} title="The blocks with an hour timeline (B)">
        Timeline
      </button>
    </span>
  );
}

/**
 * WK-6: Week's Meetings switch, beside Cards and Timeline: on, every card names its meetings (with a call's state on its
 * meeting's row); off, the start, only the day in focus does. A real switch (role switch, its state said to a screen
 * reader, Tab and Space or Enter). Remembered in this browser as one word; not a Setting, nothing sent to the server.
 */
export function MeetingsSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`meetings-switch${on ? " on" : ""}`} onClick={onToggle} title={CARD_MEETINGS.switchHint}>
      <span className="ms-track" aria-hidden="true">
        <span className="ms-knob" />
      </span>
      <span className="ms-label">{CARD_MEETINGS.switchLabel}</span>
    </button>
  );
}

/** WK-6: the switch's one word in this browser ("all" while on); unreadable or anything else reads as off. */
const MEETINGS_KEY = "focustime.week.meetings";
export function rememberedMeetingsAll(): boolean {
  try {
    return localStorage.getItem(MEETINGS_KEY) === "all";
  } catch {
    return false;
  }
}
export function rememberMeetingsAll(on: boolean) {
  try {
    if (on) localStorage.setItem(MEETINGS_KEY, "all");
    else localStorage.removeItem(MEETINGS_KEY);
  } catch {
    /* a convenience only */
  }
}
