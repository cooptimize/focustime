// P1 (phone): under 600 px FocusTime is for checking and doing, not planning. The bottom bar, the read-only frame for
// planning screens, Today's Now card, its due follow-ups and the iPhone install how-to. Planning stays on a bigger
// screen (D476).
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import type { IsoDate } from "../week/types.ts";
import { urgentFollowUps } from "../plan/today.ts";
import { captureClients } from "./Capture.tsx";
import { FollowUpRow } from "./FollowUps.tsx";
import { userZone } from "../week/zone.ts";

/**
 * MB-1: the phone's bar: Today, Week, Capture (the raised + in the middle), Inbox and Ask. Ahead is made for a bigger
 * screen, so it isn't here (its address still opens, with a notice). Was NV-1's four tabs with Capture in the top bar.
 */
export type BottomTab = "today" | "week" | "inbox";

/** The bottom bar's icons, drawn in the tab's text color: a day, the week's half-days, a tray, a speech bubble. */
const BB_ICONS: Record<BottomTab | "ask", ReactNode> = {
  today: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16M9 3v4M15 3v4" />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  week: (
    <>
      <rect x="3" y="5" width="4" height="6" rx="1" />
      <rect x="10" y="5" width="4" height="6" rx="1" />
      <rect x="17" y="5" width="4" height="6" rx="1" />
      <rect x="3" y="13" width="4" height="6" rx="1" />
      <rect x="10" y="13" width="4" height="6" rx="1" />
      <rect x="17" y="13" width="4" height="6" rx="1" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13l2.5-7.5h11L20 13v5.5H4z" />
      <path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" />
    </>
  ),
  ask: <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8l-4 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" />,
};

const icon = (k: BottomTab | "ask") => (
  <svg className="bb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {BB_ICONS[k]}
  </svg>
);

export function BottomBar({ current, inboxCount, onTab, onCapture, onAsk, askOpen = false, captureOpen = false }: {
  current: BottomTab | "ahead" | null;
  inboxCount: number;
  onTab: (t: BottomTab, e: React.MouseEvent<HTMLButtonElement>) => void;
  onCapture: () => void;
  onAsk: () => void;
  askOpen?: boolean;
  captureOpen?: boolean;
}) {
  const tab = (t: BottomTab, label: string, extra?: ReactNode) => (
    <button key={t} type="button" className="bb-tab" aria-current={current === t && !askOpen ? "page" : undefined} onClick={(e) => onTab(t, e)}>
      {icon(t)}
      <span className="bb-label">{label}</span>
      {extra}
    </button>
  );
  return (
    <nav className="bottom-bar bb-five" aria-label="Tabs">
      {tab("today", "Day")}
      {tab("week", "Week")}
      <span className="bb-capture-slot">
        <button type="button" className="bb-capture" aria-label="Capture" aria-expanded={captureOpen} title="Quick capture: one line, saved at once" onClick={onCapture}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </span>
      {tab("inbox", "Inbox", inboxCount > 0 && <span className="bb-count" aria-label={`${inboxCount} need you`}>{inboxCount}</span>)}
      <button type="button" className="bb-tab" data-tour="ask" aria-label="Ask the assistant" aria-expanded={askOpen} aria-current={askOpen ? "page" : undefined} onClick={onAsk}>
        {icon("ask")}
        <span className="bb-label" aria-hidden="true">Ask</span>
      </button>
    </nav>
  );
}

/** The line on a planning screen on the phone: it reads, but changes wait for a bigger screen. */
export const PHONE_PLAN_LINE = "Planning works best on a bigger screen";

/**
 * A planning screen on the phone: the screen as it is, read-only (inert: no taps, no focus), under one line with Copy
 * link (to open the same place on a computer) and Back where there is somewhere to go back to.
 */
export function PhoneReadOnly({ children, onBack, backLabel = "Back", line = PHONE_PLAN_LINE }: { children: ReactNode; onBack?: (() => void) | undefined; backLabel?: string; /** ST-1: Settings says its own line. */ line?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="phone-ro">
      <div className="phone-ro-bar" role="note">
        <span className="phone-ro-line">{line}</span>
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

/** Today on the phone ends with the follow-ups due today or overdue, each with its own actions. */
export function PhoneFollowUps({ data, date, onChanged }: { data: WeekLoadData; date: IsoDate; onChanged: (msg?: string) => void }) {
  const due = urgentFollowUps(data.followUps, date);
  if (!due.length) return null;
  const tz = userZone(data);
  const clients = captureClients(data);
  return (
    <section className="phone-due" aria-label="Promises due">
      <h2 className="section-label">Promises due</h2>
      {due.map((l) => (
        <FollowUpRow key={l.id} l={l} timeZone={tz} today={date} clients={clients} onChanged={onChanged} compact />
      ))}
    </section>
  );
}

/**
 * ⋯ › Install app on an iPhone or iPad: Safari has no install button, so the three taps, and why (notifications on
 * iPhone come only to the app on the home screen).
 */
export function InstallHowTo({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useReturnFocus();
  useEffect(() => close.current?.focus(), []);
  return (
    <div className="command-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="command-menu install-howto"
        data-overlay="modal"
        role="dialog"
        aria-label="Install FocusTime"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") (e.preventDefault(), onClose());
        }}
      >
        <div className="command-head">
          <span className="command-step-title">Install FocusTime</span>
          <CloseButton buttonRef={close} onClose={onClose} />
        </div>
        <ol className="howto-steps">
          <li>
            Tap <strong>Share</strong> <span className="howto-icon" aria-hidden>⬆︎</span> at the bottom of Safari (in Chrome, at the top).
          </li>
          <li>
            Tap <strong>Add to Home Screen</strong> (scroll down if you don't see it).
          </li>
          <li>
            Tap <strong>Add</strong>, then open FocusTime from your home screen.
          </li>
        </ol>
        <p className="howto-foot muted">On iPhone, notifications come only to FocusTime on the home screen. Open it from there, then Settings › Notifications › Notify this device.</p>
      </div>
    </div>
  );
}
