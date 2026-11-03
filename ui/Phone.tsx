// P1 (phone): under 600 px FocusTime is for checking and doing, not planning. The bottom bar, the read-only frame for
// planning screens, Today's Now card and its due follow-ups. Planning stays on a bigger screen (D-P1 in decisions).
import { useState, type CSSProperties, type ReactNode } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import type { IsoDate, Slot } from "../week/types.ts";
import type { Pick } from "../plan/types.ts";
import { urgentFollowUps } from "../plan/today.ts";
import { captureClients } from "./Capture.tsx";
import { FollowUpRow } from "./FollowUps.tsx";
import { clientColor, slotRange } from "./labels.ts";
import { countdown, timerLeft } from "./NowStrip.tsx";
import { userZone } from "../week/zone.ts";

export type BottomTab = "today" | "week" | "capture" | "more";

/** Today, Week, Capture and ⋯ at the foot of the screen; the top bar keeps the logo, the VM dot and the avatar. */
export function BottomBar({ current, inboxCount, dot, onTab }: { current: BottomTab | null; inboxCount: number; dot: boolean; onTab: (t: BottomTab, e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const tab = (t: BottomTab, label: string, extra?: ReactNode) => (
    <button key={t} type="button" className="bb-tab" aria-current={current === t ? "page" : undefined} onClick={(e) => onTab(t, e)} aria-haspopup={t === "more" ? "menu" : undefined}>
      <span className="bb-label">{label}</span>
      {extra}
    </button>
  );
  return (
    <nav className="bottom-bar" aria-label="Tabs">
      {tab("today", "Today")}
      {tab("week", "Week")}
      {tab("capture", "Capture")}
      {tab("more", "⋯", (inboxCount > 0 || dot) && <span className="bb-dot" aria-label={inboxCount > 0 ? `${inboxCount} in the Inbox` : "Something new"} />)}
    </nav>
  );
}

/** The line on a planning screen on the phone: it reads, but changes wait for a bigger screen. */
export const PHONE_PLAN_LINE = "Planning works best on a bigger screen";

/**
 * A planning screen on the phone: the screen as it is, read-only (inert: no taps, no focus), under one line with Copy
 * link (to open the same place on a computer) and Back where there is somewhere to go back to.
 */
export function PhoneReadOnly({ children, onBack, backLabel = "Back" }: { children: ReactNode; onBack?: (() => void) | undefined; backLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="phone-ro">
      <div className="phone-ro-bar" role="note">
        <span className="phone-ro-line">{PHONE_PLAN_LINE}</span>
        <span className="phone-ro-acts">
          <button
            type="button"
            className="mini"
            onClick={() => {
              void navigator.clipboard?.writeText(location.href).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          {onBack && (
            <button type="button" className="mini primary" onClick={onBack}>
              {backLabel}
            </button>
          )}
        </span>
      </div>
      <div className="phone-ro-body" inert>
        {children}
      </div>
    </div>
  );
}

/**
 * Today › Now on the phone: the block under way (or the next one today), its next pick with Start focus or the running
 * timer, and Mark done. One primary action, as on desktop. Nothing to plan from here.
 */
export function PhoneNow({ data, block, pick, nowMs, nameOf, onStart, onTimer, onFocusScreen, onDone }: {
  data: WeekLoadData;
  block: Slot | null;
  pick: Pick | null;
  nowMs: number;
  nameOf: (k: string) => string;
  onStart: (p: Pick) => void;
  onTimer: (a: "timer.done" | "timer.extend") => void;
  onFocusScreen: () => void;
  /** Null while the day isn't committed (picks are drafts until then). */
  onDone: ((p: Pick) => void) | null;
}) {
  const t = data.timer;
  const tz = userZone(data);
  if (!block && !t) return null;
  const client = block?.focus[0]?.clientKey ?? pick?.clientKey ?? null;
  const running = t && (!pick || t.pickId === pick.id);
  const title = client ? nameOf(client) : block?.open ? "Open" : "Focus";
  return (
    <section className="phone-now" aria-label="Now" style={{ "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties}>
      <header>
        <span className="pn-tag">{running ? "Focusing" : "Now"}</span>
        <h2>{title}</h2>
        {block && <span className="pn-when">{slotRange(block, tz)}</span>}
      </header>
      {pick ? <p className="pn-pick">{pick.title}</p> : !running && <p className="pn-pick muted">Nothing planned for this block.</p>}
      {running && t ? (
        <div className="pn-timer">
          <button type="button" className="pn-count" onClick={onFocusScreen} aria-label="Open the focus screen">
            {t.ended ? "Time's up" : countdown(timerLeft(t, nowMs))}
          </button>
          <button type="button" className="primary" onClick={() => onTimer("timer.done")}>
            Done
          </button>
          <button type="button" onClick={() => onTimer("timer.extend")} aria-label="Add 15 minutes">
            +15
          </button>
        </div>
      ) : pick ? (
        <div className="pn-acts">
          <button type="button" className="primary" onClick={() => onStart(pick)}>
            Start focus
          </button>
          {onDone && (
            <button type="button" onClick={() => onDone(pick)}>
              Mark done
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Today on the phone ends with the follow-ups due today or overdue, each with its own actions. */
export function PhoneFollowUps({ data, date, onChanged }: { data: WeekLoadData; date: IsoDate; onChanged: (msg?: string) => void }) {
  const due = urgentFollowUps(data.followUps, date);
  if (!due.length) return null;
  const tz = userZone(data);
  const clients = captureClients(data);
  return (
    <section className="phone-due" aria-label="Follow-ups due">
      <h2 className="section-label">Follow-ups due</h2>
      {due.map((l) => (
        <FollowUpRow key={l.id} l={l} timeZone={tz} today={date} clients={clients} onChanged={onChanged} compact />
      ))}
    </section>
  );
}
