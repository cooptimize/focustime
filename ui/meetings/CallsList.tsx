// MC-4: the pieces of Calls' list: a call's mark, Needs you's two-line rows, a week's one-line rows (a meeting that
// repeats as one row with its menu), the Closed and Hidden rows, and the bar for ticked rows. The state lives in
// CallsPage (ui/meetings/Meetings.tsx); these only draw it and say what was pressed. Every word is plan/call-words.ts's.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { clientColor } from "../labels.ts";
import { Icon } from "../icons.tsx";
import { lengthLabel } from "../../plan/calls.ts";
import { CALL_LIST, CLOSE_TEXT, LIST_TEXT, MARK_TEXT } from "../../plan/call-words.ts";
import { callClientChoices, closedLine, markShort, markWords, needsAction, needsNote, shortWhen, type CallMarkKind, type CallRow, type SeriesEntry } from "../../plan/call-list.ts";
import type { CaptureClient } from "../../plan/capture.ts";

const timeOf = (iso: string, zone: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
const dayOf = (iso: string, zone: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone });
/** "Tue, Nov 10 · 2:00 PM": when a call was, in my zone. */
export const whenOf = (iso: string, zone: string) => `${dayOf(iso, zone)} · ${timeOf(iso, zone)}`;

/** MC-4: where a call's transcript is, drawn the same way for Teams and Pocket (MC-2b's mark): an icon and the words. */
export function TranscriptMark({ mark, check }: { mark: CallMarkKind; check?: CallRow["check"] }) {
  const words = markWords(mark) ?? (check === "checking" ? MARK_TEXT.checking : check === "unchecked" ? MARK_TEXT.unchecked : null);
  if (!words) return null;
  return (
    <span className={`calls-mark${mark ? ` has ${mark}` : " quiet"}`} data-call-mark={mark ?? check ?? ""}>
      {mark && <Icon name={mark === "pocket" ? "mic" : "file"} />}
      {words}
    </span>
  );
}

/**
 * MC-6: a week row whose title doesn't fit on its line beside the picker and the mark. The title is first laid out on one
 * line and measured; when it is wider than its room the row is "long": the title takes the whole row (wrapping if it
 * must) and the picker and the mark go under it. Measured again when the row's width or the title changes.
 */
function useLongTitle(title: string) {
  const row = useRef<HTMLLIElement>(null);
  const name = useRef<HTMLSpanElement>(null);
  const [on, setOn] = useState(false);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const li = row.current;
    if (!li || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => setWidth(Math.round(es[0]!.contentRect.width)));
    ro.observe(li);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => setOn(false), [width, title]);
  useLayoutEffect(() => {
    const n = name.current;
    if (!on && n && n.scrollWidth > n.clientWidth + 1) setOn(true);
  });
  return { row, name, on };
}

/** A tick for a row that can be done together with others (Hide, or Skip all and close); only while selecting. */
function Tick({ on, name, onTick }: { on: boolean; name: string; onTick: (on: boolean) => void }) {
  return (
    <label className="calls-tick" title={CLOSE_TEXT.tick(name)}>
      <input type="checkbox" checked={on} onChange={(e) => onTick(e.target.checked)} aria-label={CLOSE_TEXT.tick(name)} data-call-tick="" />
    </label>
  );
}

/** MC-5: a thin bar of how much is decided (its words are the row's "N left"). */
function Bar({ done }: { done: number }) {
  return <span className="calls-left-bar" aria-hidden="true" data-call-bar=""><span style={{ width: `${Math.round(done * 100)}%` }} /></span>;
}

type RowActs = {
  open: boolean;
  zone: string;
  today: string;
  colors: Record<string, string>;
  /** MC-5: ticks show only once Select calls is chosen. */
  selecting: boolean;
  ticked: boolean;
  onTick: (on: boolean) => void;
  onOpen: () => void;
};

/** MC-5: the client's square: its color, or dashed when no client is said yet. */
const Square = ({ color }: { color: string | null }) => <span className={`swatch calls-sq${color ? "" : " none"}`} aria-hidden="true" />;

/**
 * MC-5: a call in Needs you, two lines in one bordered card. Line 1: the client's square, the name (one line, its full
 * name on hover), and on the right "N left" or the one button. Line 2: when and the client, and on the right a thin bar
 * once something is decided or the short amber note; Skip all is a quiet button there on the selected, hovered or focused
 * row (not on the phone: there it is only in the call's header). A click anywhere on the row or Enter opens the call.
 */
export function NeedsRow({ r, open, zone, today, colors, selecting, ticked, onTick, onOpen, onAction, onSkipAll, phone = false }: RowActs & { r: CallRow; onAction: (kind: "upload" | "pocket" | "retry") => void; onSkipAll: () => void; phone?: boolean }) {
  const color = r.clientKey ? clientColor(r.clientKey, colors) : null;
  const act = needsAction(r);
  const note = needsNote(r, today);
  return (
    <li className={`calls-row need-row${open ? " open" : ""}${selecting ? " selecting" : ""}`} style={color ? ({ "--c": color } as CSSProperties) : undefined} data-row={r.key}>
      {selecting && (r.left?.open ? <Tick on={ticked} name={r.name} onTick={onTick} /> : <span className="calls-tick" aria-hidden="true" />)}
      <Square color={color} />
      <button type="button" className="calls-row-main" title={r.name} aria-current={open ? "true" : undefined} data-call-row={r.key} data-bucket={r.bucket} onClick={onOpen}>
        <span className="calls-name">{r.name}</span>
      </button>
      <span className="calls-row-end">
        {act?.kind === "left" ? <span className="calls-left" data-call-left="">{act.text}</span> : act ? <button type="button" className="mini primary" onClick={() => onAction(act.kind)} data-call-act={act.kind}>{act.text}</button> : null}
      </span>
      <span className="calls-meta">{shortWhen(r.startAt, r.day, today, zone)} · {r.clientName ?? CALL_LIST.noClient}{!act && !r.state.needsMe ? <span data-call-state=""> · {r.state.label}</span> : null}</span>
      <span className="calls-row-end two">
        {r.left?.open && !phone ? <button type="button" className="mini quiet calls-skip" onClick={onSkipAll} data-call-act="skip-all">{r.left.open === r.left.all ? LIST_TEXT.skipAll : LIST_TEXT.skipLast(r.left.open)}</button> : null}
        {note && "amber" in note ? <span className="calls-amber" data-call-note="">{note.amber}</span> : note ? <Bar done={note.done} /> : null}
      </span>
    </li>
  );
}

/** What Review from a row is doing, or why it stopped (with Upload a file). */
export type RowStatus = { busy: string | null; error: string | null; occurrenceId: number | null };

/** MC-5: a week row's mark, short, with its full words as its label and on hover. */
export function MarkShort({ mark, check, from }: { mark: CallMarkKind; check?: CallRow["check"]; /** MC-2c: where the call came from ("From a chat"), said in the mark's label and hover. */ from?: string | undefined }) {
  const m = markShort(mark);
  // No mark yet: while Teams is asked, "Checking…"; past the cap, "Not checked" (MC-4's words, kept).
  if (!m) {
    const w = check === "checking" ? MARK_TEXT.checking : check === "unchecked" ? MARK_TEXT.unchecked : null;
    return w ? <span className="calls-mark quiet" data-call-mark={check ?? ""}>{w}</span> : null;
  }
  const full = from ? `${m.full} · ${from}` : m.full;
  return <span className={`calls-mark ${mark}`} title={full} aria-label={full} data-call-mark={mark ?? ""}>{m.short}</span>;
}

/**
 * MC-5: one line under a week (or in the fold): when, the client's square, the name, the client as a small picker (my
 * choice, else FocusTime's suggestion, else "Which client?" in amber), the mark and Hide (on hover or focus, always on
 * touch). A call FocusTime keeps (waiting on someone else) shows its client and its state instead. A click opens the
 * review straight away only when a client shows and Teams has the transcript; otherwise the setup (CallsPage decides).
 */
export function WeekRow({ r, open, zone, today, colors, selecting, ticked, onTick, onOpen, clients, client, onClient, onHide, status, onUpload, inSeries = false }: RowActs & {
  r: CallRow;
  clients: readonly CaptureClient[];
  /** The client on the row: my choice, else FocusTime's suggestion, else none ("Which client?"). */
  client: string | null;
  onClient: (key: string) => void;
  onHide: () => void;
  status: RowStatus | null;
  onUpload: () => void;
  inSeries?: boolean;
}) {
  const color = r.clientKey ? clientColor(r.clientKey, colors) : client ? clientColor(client, colors) : null;
  // PK-4: a recording with no call hides too, by its id alone.
  const canHide = (!!r.other && r.occurrenceId === null) || !!r.recording;
  const picks = (!!r.other && r.occurrenceId === null) || !!r.recording;
  const nameOf = (k: string) => clients.find((c) => c.clientKey === k)?.clientName ?? k;
  const long = useLongTitle(r.name);
  return (
    <li ref={long.row} className={`calls-row one${open ? " open" : ""}${inSeries ? " in-series" : ""}${selecting ? " selecting" : ""}${long.on ? " long" : ""}`} style={color ? ({ "--c": color } as CSSProperties) : undefined} data-row={r.key}>
      {selecting && (canHide ? <Tick on={ticked} name={r.name} onTick={onTick} /> : <span className="calls-tick" aria-hidden="true" />)}
      <span className="calls-time">{inSeries ? dayOf(r.startAt, zone) : shortWhen(r.startAt, r.day, today, zone)}{r.other?.chat && r.other.endKnown ? ` to ${timeOf(r.endAt, zone)}` : ""}</span>
      <Square color={color} />
      <button type="button" className="calls-row-main" title={r.name} aria-current={open ? "true" : undefined} data-call-row={r.key} data-bucket={r.bucket} disabled={!!status?.busy} onClick={onOpen}>
        <span className="calls-name" ref={long.name}>{inSeries ? timeOf(r.startAt, zone) : r.name}</span>
      </button>
      <span className="calls-row-end">
        {picks ? (
          <label className={`calls-about${client ? "" : " none"}`} title={CLOSE_TEXT.aboutHint}>
            <span className="sr-only">{LIST_TEXT.clientFor(r.name)}</span>
            <select className="plain-input" value={client ?? ""} onChange={(e) => onClient(e.target.value)} data-call-about="">
              {!client && <option value="">{LIST_TEXT.whichClient}</option>}
              {callClientChoices(clients, r.other?.chat).map((c) => <option key={c.clientKey} value={c.clientKey}>{nameOf(c.clientKey)}</option>)}
            </select>
          </label>
        ) : r.occurrenceId !== null && !r.pocket.length ? (
          // A recording that fits says so by its mark alone.
          <span className="calls-state" data-call-state="">{r.state.label}</span>
        ) : null}
        {/* MC-2c: a chat call says where it came from in its mark's label and hover, so its name keeps the room. */}
        <MarkShort mark={r.mark} check={r.check} from={r.other?.chat && r.occurrenceId === null ? CALL_LIST.fromChat : undefined} />
        {canHide && <button type="button" className="mini quiet calls-hide" onClick={onHide} data-call-act="hide">{CLOSE_TEXT.hide}</button>}
      </span>
      {status?.busy && <p className="calls-row-status muted" role="status">{status.busy}</p>}
      {status?.error && (
        <p className="calls-row-status error-line" role="alert">
          {status.error} {status.occurrenceId !== null && <button type="button" className="link-btn" onClick={onUpload}>{CLOSE_TEXT.uploadFile}</button>}
        </p>
      )}
    </li>
  );
}

/** MC-4: a meeting that repeats, nobody asked about, as one row for the week ("Team standup · 3 this week"), its menu and its days. */
export function SeriesRow({ e, weekLabel, expanded, onExpand, onHideEvery, onHideWeek, selecting, ticked, onTick, children }: {
  e: SeriesEntry;
  selecting: boolean;
  weekLabel: string;
  expanded: boolean;
  onExpand: (on: boolean) => void;
  onHideEvery: () => void;
  onHideWeek: () => void;
  ticked: boolean;
  onTick: (on: boolean) => void;
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (ev: MouseEvent) => !menuRef.current?.contains(ev.target as Node) && setMenu(false);
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && (ev.stopPropagation(), setMenu(false));
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => (document.removeEventListener("mousedown", away), document.removeEventListener("keydown", esc, true));
  }, [menu]);
  return (
    <li className="calls-row one series" data-row={e.key} data-series-row="">
      {selecting && <Tick on={ticked} name={e.name} onTick={onTick} />}
      <button type="button" className="calls-row-main" aria-expanded={expanded} data-call-row={e.key} onClick={() => onExpand(!expanded)}>
        <span className="calls-row-one">
          <span className="calls-name">{e.name}</span>
          <span className="calls-time">· {CLOSE_TEXT.series(e.rows.length, weekLabel)}</span>
          <Icon name={expanded ? "up" : "next"} />
        </span>
      </button>
      <span className="calls-row-acts">
        <MarkShort mark={e.mark} />
        <div className="calls-menu" ref={menuRef}>
          <button type="button" className="mini quiet" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} data-call-act="hide-menu">{CLOSE_TEXT.hide} <Icon name="more" /></button>
          {menu && (
            <div className="calls-menu-pop" role="menu">
              <button type="button" role="menuitem" onClick={() => (setMenu(false), onHideEvery())} data-hide="every">
                {CLOSE_TEXT.hideEvery}
                <span className="muted">{CLOSE_TEXT.hideEveryHint}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => (setMenu(false), onHideWeek())} data-hide="week">{CLOSE_TEXT.hideWeek}</button>
              <button type="button" role="menuitem" onClick={() => (setMenu(false), onExpand(true))} data-hide="each">
                {CLOSE_TEXT.showEach}
                <span className="muted">{CLOSE_TEXT.showEachHint}</span>
              </button>
            </div>
          )}
        </div>
      </span>
      {expanded && <ul className="calls-rows calls-series-days">{children}</ul>}
    </li>
  );
}

/** MC-4: a closed call, one line: when, its name, and what came of it. MC-5: a Pocket recording that fits it later shows its mark. */
export function ClosedRow({ r, open, zone, today, colors, onOpen }: { r: CallRow; open: boolean; zone: string; today: string; colors: Record<string, string>; onOpen: () => void }) {
  const color = r.clientKey ? clientColor(r.clientKey, colors) : null;
  return (
    <li className={`calls-row one closed${open ? " open" : ""}`} style={color ? ({ "--c": color } as CSSProperties) : undefined} data-row={r.key}>
      <span className="calls-time">{shortWhen(r.startAt, r.day, today, zone)}</span>
      <Square color={color} />
      <button type="button" className="calls-row-main" title={r.name} aria-current={open ? "true" : undefined} data-call-row={r.key} data-bucket={r.bucket} onClick={onOpen}>
        <span className="calls-name">{r.name}</span>
      </button>
      <span className="calls-row-end">
        <span className="calls-state" data-closed-line="">{r.closed ? closedLine(r.closed) : ""}</span>
        <MarkShort mark={r.mark} check={r.check} />
      </span>
    </li>
  );
}

/** MC-4: a hidden meeting, with Put back (a series hidden for every one says so). */
export function HiddenRow({ r, every, count = 1, zone, today, onPutBack }: { r: CallRow; every: boolean; /** A series hidden for every one: its calls in the window, as one row. */ count?: number; zone: string; today: string; onPutBack: () => void }) {
  return (
    <li className="calls-row one hidden-row" data-row={r.key}>
      {!every && <span className="calls-time">{shortWhen(r.startAt, r.day, today, zone)}</span>}
      <span className="calls-row-main as-text" data-call-row={r.key} tabIndex={-1} title={r.name}>
        <span className="calls-name">{r.name}</span>
      </span>
      <span className="calls-row-end">
        {every && <span className="calls-state">{CLOSE_TEXT.series(count, "")} · {CLOSE_TEXT.hiddenEveryLine}</span>}
        <button type="button" className="mini" onClick={onPutBack} data-call-act="put-back">{CLOSE_TEXT.putBack}</button>
      </span>
    </li>
  );
}

/** MC-4: the bar for ticked rows: Hide N and Skip all and close N, with Clear. */
export function TickBar({ hide, close, onHide, onClose, onClear, onDone }: { hide: number; close: number; onHide: () => void; onClose: () => void; onClear: () => void; /** MC-5: leaves Select calls. */ onDone: () => void }) {
  return (
    <div className="calls-tickbar" role="region" aria-label={LIST_TEXT.select} data-calls-tickbar="">
      {hide + close > 0 && <span className="muted">{CLOSE_TEXT.ticked(hide + close)}</span>}
      {hide > 0 && <button type="button" className="mini" onClick={onHide} data-tickbar="hide">{CLOSE_TEXT.hideSeveral(hide)}</button>}
      {close > 0 && <button type="button" className="mini" onClick={onClose} data-tickbar="close">{CLOSE_TEXT.skipSeveral(close)}</button>}
      {hide + close > 0 && <button type="button" className="mini quiet" onClick={onClear}>{CLOSE_TEXT.clearTicks}</button>}
      <button type="button" className="mini quiet" onClick={onDone} data-tickbar="done">{LIST_TEXT.selectDone}</button>
    </div>
  );
}

export { lengthLabel };
