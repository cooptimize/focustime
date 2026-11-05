// Step 16.2: one mode switch per tab, always at the right of the page header, the same everywhere. Each mode may show
// a ✓ (done for that day or week) or a small dot (due now). Status is shown, never forced.
import type { ModeStatus } from "../plan/modes.ts";
import { MODE_NAMES, MODES, TAB_NAMES, type ModeName, type Tab } from "./nav.ts";

const STATUS_WORDS = { done: "done", due: "due now" } as const;

export function ModeSwitch({ tab, current, status = {}, onMode }: { tab: Tab; current: ModeName; status?: Partial<Record<ModeName, ModeStatus>>; onMode: (m: ModeName) => void }) {
  const modes = MODES[tab];
  if (modes.length < 2) return null;
  return (
    <nav className="mode-switch" aria-label={`${TAB_NAMES[tab]} modes`}>
      {modes.map((m) => {
        const s = status[m] ?? null;
        return (
          <button key={m} type="button" className="ms-btn" aria-current={current === m ? "page" : undefined} onClick={() => current !== m && onMode(m)} title={s ? `${MODE_NAMES[m]}: ${STATUS_WORDS[s]}` : MODE_NAMES[m]}>
            {MODE_NAMES[m]}
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
