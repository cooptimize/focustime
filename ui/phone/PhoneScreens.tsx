// PH-1: the phone's own screens, loaded only on a phone (ui/screens.ts "phone"; ui/main.tsx asks for it at start on a
// phone, so the phone's first download holds the shell and Now, and a computer never fetches it). The bar (Now, Week,
// Capture, Inbox, More), the parts of Day on the phone (the Now card, Next, the one thing that needs you) and More with
// Everything else. Every word is in plan/phone-now.ts. Every change is an existing action, passed in by Day or App.
import "./phone.css";
import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { WeekLoadData } from "../../actions/types.ts";
import type { Pick } from "../../plan/types.ts";
import type { NowCard as NowState } from "../../plan/phonenow.ts";
import { blockGone, blockLine, PHONE_TEXT as W, type NextLine, type OneThing } from "../../plan/phone-now.ts";
// Day reads these through this file, so the phone's words and rules stay out of the computer's first download.
export { nextLines, oneThing, PHONE_TEXT } from "../../plan/phone-now.ts";
import { clientColor, startClock } from "../labels.ts";
import { formatDuration } from "../../week/format.ts";
import { countdown, timerLeft } from "../NowStrip.tsx";
import { todoLine } from "../TodoSheet.tsx";
import { userZone } from "../../week/zone.ts";
import { LiveCalls, liveOf, useCoworkData } from "../cowork.tsx";
import { Icon, type IconName } from "../icons.tsx";
import { RepeatMark } from "../meetings/CallMark.tsx";
import { VmCtx } from "../Account.tsx";

export type PhoneTab = "day" | "week" | "inbox" | "more";

/** The bar: Day, Week, Capture (the raised round button), Inbox (with its count), More (a dot when a source needs attention or a notification is new). */
export function PhoneBar({ current, needsYou, moreDot, captureOpen, onTab, onCapture }: {
  current: PhoneTab | null;
  needsYou: number;
  moreDot: "trouble" | "new" | null;
  captureOpen: boolean;
  onTab: (t: PhoneTab) => void;
  onCapture: () => void;
}) {
  const tab = (t: PhoneTab, icon: IconName, label: string, extra?: ReactNode, aria?: string) => (
    <button key={t} type="button" className="pb-tab" data-tab={t} aria-current={current === t ? "page" : undefined} aria-label={aria} onClick={() => onTab(t)}>
      <span className="pb-icon">
        <Icon name={icon} />
        {extra}
      </span>
      <span className="pb-label" aria-hidden={aria ? "true" : undefined}>
        {label}
      </span>
    </button>
  );
  return (
    <nav className="bottom-bar phone-bar" aria-label={W.barLabel}>
      {tab("day", "day", W.tabs.day)}
      {tab("week", "week", W.tabs.week)}
      <span className="pb-capture-slot">
        <button type="button" className="pb-capture" aria-label={W.tabs.capture} aria-expanded={captureOpen} title="Quick capture: one line, saved at once" onClick={onCapture}>
          <Icon name="add" />
        </button>
      </span>
      {tab("inbox", "inbox", W.tabs.inbox, needsYou > 0 ? <span className="pb-count" aria-hidden="true">{needsYou}</span> : null, needsYou > 0 ? `${W.tabs.inbox}, ${needsYou}` : undefined)}
      {tab("more", "more", W.tabs.more, moreDot ? <span className="pb-dot" aria-hidden="true" /> : null, moreDot === "trouble" ? W.moreDot : moreDot === "new" ? W.moreNew : undefined)}
    </nav>
  );
}

/** The top bar's Ask: the assistant, as the old bar's Ask was. */
export function PhoneAsk({ open, onAsk }: { open: boolean; onAsk: () => void }) {
  return (
    <button type="button" className="top-btn ph-ask" data-tour="ask" aria-label={W.askLabel} aria-expanded={open} onClick={onAsk}>
      <Icon name="ask" />
      <span aria-hidden="true">{W.ask}</span>
    </button>
  );
}

const ms = (iso: string) => Date.parse(iso.replace(/\[.*\]$/, ""));

/**
 * The Now card. In a block: tinted with the client's color, NOW and until when, the client large, the block's bar, the
 * time left and the meeting that matters, then the one thing (Done box, title, its item and size) and Start focus; a
 * running session shows its time left with Done and Stop. Before, between and after: what the phone said before PH-1.
 */
export function NowCard({ card, data, pick, nowMs, name, tickable, onStart, onTick, onTimer, onFocusScreen, onAdd, onCloseOut }: {
  card: NowState;
  data: WeekLoadData;
  pick: Pick | null;
  nowMs: number;
  /** The block's client name, or "Open" or "Catch-up". */
  name: string;
  tickable: boolean;
  onStart: (p: Pick) => void;
  onTick: (p: Pick) => void;
  onTimer: (a: "timer.done" | "timer.stop") => void;
  onFocusScreen: () => void;
  onAdd: (half: string) => void;
  /** After the day: Close out, the moment card's own (it isn't on the phone's Day any more). */
  onCloseOut?: () => void;
}): ReactNode {
  const cowork = useCoworkData();
  if (card.kind === "none") return null;
  const tz = userZone(data);
  const when = (iso: string) => startClock(iso, tz);
  const t = data.timer;
  const block = card.kind === "after" ? null : card.block;
  const client = block?.clientKey ?? null;
  const running = !!t && (!pick || t.pickId === pick.id);
  const now = new Date(nowMs).toISOString();

  const thing = running && t ? (
    <div className="pn-thing running">
      {pick && <p className="pn-title">{pick.title}</p>}
      <div className="pn-acts">
        <button type="button" className="pn-count" onClick={onFocusScreen} aria-label={`${t.ended ? W.timesUp : countdown(timerLeft(t, nowMs))}. ${W.openFocus}`}>
          {t.ended ? W.timesUp : countdown(timerLeft(t, nowMs))}
        </button>
        <button type="button" className="primary pn-btn" onClick={() => onTimer("timer.done")}>
          {W.done}
        </button>
        <button type="button" className="pn-btn" onClick={() => onTimer("timer.stop")}>
          {W.stop}
        </button>
      </div>
    </div>
  ) : pick ? (
    <div className="pn-thing">
      <div className="pn-row">
        <label className="pn-tick">
          <input type="checkbox" checked={pick.status === "done"} disabled={!tickable} onChange={() => onTick(pick)} aria-label={W.doneBox(pick.title)} />
        </label>
        <div className="pn-what">
          <p className="pn-title">{pick.title}</p>
          <p className="pn-sub">{[pick.itemId ? `#${pick.itemId}` : null, todoLine(pick, data, { client: false })].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <button type="button" className="primary pn-main" onClick={() => onStart(pick)}>
        <Icon name="focus" /> {W.startFocus}
      </button>
    </div>
  ) : card.kind === "block" ? (
    <div className="pn-thing pn-none">
      <p className="pn-sub">{W.nothingPlanned}</p>
      <button type="button" className="pn-btn" onClick={() => onAdd(card.block.half)} aria-label={W.addTo(name)}>
        <Icon name="add" /> {W.add}
      </button>
    </div>
  ) : null;

  if (card.kind === "block") {
    const gone = blockGone(card.block.start, card.block.end, now);
    return (
      <section className="pn-card pn-block" data-tour="today-next" aria-labelledby="pn-name" style={{ "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties}>
        <p className="pn-tag">
          <span className="pn-now">{running ? W.focusing : W.nowTag}</span> <span>{W.until(when(card.block.end))}</span>
        </p>
        <h2 className="pn-name" id="pn-name">
          {name}
        </h2>
        <div className="pn-bar" role="img" aria-label={W.goneLabel(Math.round(gone * 100))}>
          <span style={{ width: `${Math.round(gone * 100)}%` }} />
        </div>
        <p className="pn-line">{blockLine(card.leftMinutes, card.block.end, card.meeting, when)}</p>
        <LiveCalls chats={liveOf(cowork, client)} zone={tz} className="now-live" />
        {thing}
      </section>
    );
  }
  // Before, between and after: MB-1's words.
  const head =
    card.kind === "before" ? { tag: "Your day starts", title: `${when(card.block.start)} · ${name}`, line: `in ${formatDuration(Math.max(0, Math.ceil((ms(card.block.start) - nowMs) / 60_000)))}` }
    : card.kind === "between" ? { tag: "Between blocks", title: `Free until ${when(card.block.start)}`, line: `Then ${client ? name : "an open block"}, ${when(card.block.start)}–${when(card.block.end)}` }
    : { tag: "Today", title: "Day done", line: "Nothing else is scheduled today." };
  return (
    <section className={`pn-card pn-${card.kind}`} data-tour="today-next" aria-labelledby="pn-name">
      <p className="pn-tag">{head.tag}</p>
      <h2 className="pn-name" id="pn-name">
        {head.title}
      </h2>
      <p className="pn-line">{head.line}</p>
      {card.kind !== "after" && thing}
      {card.kind === "after" && onCloseOut && (
        <div className="pn-thing">
          <button type="button" className="pn-main" onClick={onCloseOut}>
            {W.else.closeout}
          </button>
        </div>
      )}
    </section>
  );
}

/** Next: the next meeting today and the next block, two lines at most. */
export function NextLines({ lines }: { lines: readonly NextLine[] }) {
  if (!lines.length) return null;
  return (
    <section className="pn-next" aria-labelledby="pn-next-h">
      <h2 className="section-label" id="pn-next-h">
        {W.next}
      </h2>
      <ul>
        {lines.map((l) => (
          <li key={l.kind} className={`pn-next-row ${l.kind}`}>
            <span className="pn-at">{l.at}</span>
            <span className="pn-next-text">
              <Icon name={l.kind === "meeting" ? "meeting" : "day"} />
              <span className="pn-next-title">{l.text}</span>
              {l.callType ? <span className="pn-call-type">{l.callType}</span> : l.repeats ? <RepeatMark /> : null}
            </span>
            {l.detail && <span className={`pn-next-detail${l.kind === "block" ? " risk" : ""}`}>{l.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The one thing that needs you, as one line with "1 of N" (N the Inbox's count); it opens in the Inbox. Nothing waiting: nothing drawn. */
export function OneThingLine({ thing, onOpen }: { thing: OneThing | null; onOpen: (key: string) => void }) {
  if (!thing) return null;
  return (
    <section className="pn-one" aria-labelledby="pn-one-h" data-tour="today-urgent">
      <h2 className="section-label" id="pn-one-h">
        {W.needsYouHead}
      </h2>
      <button type="button" className={`pn-one-row ${thing.why}`} onClick={() => onOpen(thing.key)}>
        <span className="pn-one-why">{W.why[thing.why]}</span>
        <span className="pn-one-title">{thing.who ? `${thing.who}: ${thing.title}` : thing.title}</span>
        <span className="pn-one-of">{W.of(thing.of)}</span>
        <Icon name="next" />
      </button>
    </section>
  );
}

export type MoreRow = { id: string; icon: IconName; label: string; line?: string | null; dot?: boolean; run: (e: React.MouseEvent<HTMLButtonElement>) => void };

/**
 * More: a full screen of rows (56 px at least), each with an icon, a name and one quiet line of state; Everything else
 * opens the rest; then, set apart, Desktop version. Esc and Back go back (from Everything else to More, from More to
 * where the person was).
 */
export function MoreScreen({ rows, rest, onDesktop, onClose }: { rows: readonly MoreRow[]; rest: readonly MoreRow[]; onDesktop: () => void; onClose: () => void }) {
  const [inner, setInner] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [inner]);
  const row = (r: MoreRow) => (
    <li key={r.id}>
      <button type="button" className="mr-row" data-row={r.id} onClick={r.run}>
        <Icon name={r.icon} />
        <span className="mr-text">
          <span className="mr-name">{r.label}</span>
          {r.line && <span className="mr-line">{r.line}</span>}
        </span>
        {r.dot && <span className="mr-dot" aria-hidden="true" />}
        <Icon name="next" />
      </button>
    </li>
  );
  return (
    <main
      ref={ref}
      className="more-screen"
      aria-label={inner ? W.else.title : W.more}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        if (inner) setInner(false);
        else onClose();
      }}
    >
      {inner ? (
        <>
          <div className="mr-head">
            <button type="button" className="mr-back" onClick={() => setInner(false)} aria-label={W.else.back}>
              <Icon name="back" />
            </button>
            <h1 tabIndex={-1}>{W.else.title}</h1>
          </div>
          <ul className="mr-list">{rest.map(row)}</ul>
        </>
      ) : (
        <>
          <div className="mr-head">
            <h1 tabIndex={-1}>{W.more}</h1>
          </div>
          <ul className="mr-list">
            {rows.map(row)}
            {row({ id: "else", icon: "more", label: W.rows.everything, dot: rest.some((r) => r.dot), run: () => setInner(true) })}
          </ul>
          <ul className="mr-list mr-apart">{row({ id: "desktop", icon: "grid", label: W.rows.desktop, line: W.rows.desktopLine, run: onDesktop })}</ul>
        </>
      )}
    </main>
  );
}

export type MoreWhere = "backlog" | "status" | "calls" | "code" | "vm" | "settings" | "guide" | "notifications" | "sources" | "focus" | "checkin" | "closeout" | "install" | "docs" | "about" | "admin" | "account";

/**
 * More with its rows, from facts the app already has: Status's features to update (the Status tab's own count), the
 * client calls that need me (MC-1d's count, the one the computer's ⋯ shows), the VM's word, the sources'
 * health, unread notifications. Each row opens its place through `go`; the VM's row opens the VM's own menu.
 */
export function PhoneMore({ statusNeeds, calls, code, health, unread, focusing, install, admin, person, go, onDesktop, onClose }: {
  statusNeeds: number;
  calls: number;
  code: boolean;
  health: "live" | "stale" | "trouble";
  unread: number;
  focusing: boolean;
  install: boolean;
  admin: boolean;
  person: string;
  go: (where: MoreWhere, at: { x: number; y: number }) => void;
  onDesktop: () => void;
  onClose: () => void;
}) {
  const vm = useContext(VmCtx);
  const at = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left + 16, y: r.bottom - 4 };
  };
  const to = (where: MoreWhere) => (e: React.MouseEvent<HTMLButtonElement>) => go(where, at(e));
  const vmText = vm.status?.vm ? (vm.status.text ?? vm.status.label ?? null) : W.rows.vmNone;
  const rows: MoreRow[] = [
    // MC-3: Calls first (a tab on the computer; the phone's bar is unchanged), with how many need me.
    { id: "calls", icon: "calls", label: W.rows.calls, line: calls > 0 ? W.rows.callsLine(calls) : null, run: to("calls") },
    { id: "backlog", icon: "backlog", label: W.rows.backlog, run: to("backlog") },
    { id: "status", icon: "status", label: W.rows.status, line: statusNeeds > 0 ? W.rows.statusLine(statusNeeds) : null, run: to("status") },
    ...(code ? [{ id: "code", icon: "code" as const, label: W.rows.code, run: to("code") }] : []),
    // The VM's own menu (Start, Allow Azure access, Refresh, Choose), or Settings › You to find one.
    { id: "vm", icon: "vm", label: W.rows.vm, line: vmText, run: (e) => (vm.status?.vm ? (onClose(), vm.openMenu(at(e))) : go("vm", at(e))) },
    { id: "settings", icon: "settings", label: W.rows.settings, run: to("settings") },
    { id: "guide", icon: "guide", label: W.rows.guide, run: to("guide") },
  ];
  const rest: MoreRow[] = [
    { id: "notifications", icon: "notices", label: W.else.notifications, line: unread > 0 ? W.else.notificationsLine(unread) : null, dot: unread > 0, run: to("notifications") },
    { id: "sources", icon: "refresh", label: W.else.sources, line: W.else.sourcesLine[health], dot: health === "trouble", run: to("sources") },
    { id: "focus", icon: "focus", label: focusing ? W.else.focusScreen : W.else.focus, line: focusing ? null : W.else.focusLine, run: to("focus") },
    { id: "checkin", icon: "time", label: W.else.checkin, run: to("checkin") },
    { id: "closeout", icon: "done", label: W.else.closeout, run: to("closeout") },
    { id: "account", icon: "personal", label: person, run: to("account") },
    ...(install ? [{ id: "install", icon: "download" as const, label: W.else.install, run: to("install") }] : []),
    { id: "docs", icon: "docs", label: W.else.docs, run: to("docs") },
    { id: "about", icon: "about", label: W.else.about, run: to("about") },
    ...(admin ? [{ id: "admin", icon: "settings" as const, label: W.else.admin, run: to("admin") }] : []),
  ];
  return <MoreScreen rows={rows} rest={rest} onDesktop={onDesktop} onClose={onClose} />;
}
