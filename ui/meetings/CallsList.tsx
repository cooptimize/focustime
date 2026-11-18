// MC-4: the pieces of Calls' list: a call's mark, Needs you's two-line rows, a week's one-line rows (a meeting that
// repeats as one row with its menu), the Closed and Hidden rows, and the bar for ticked rows. The state lives in
// CallsPage (ui/meetings/Meetings.tsx); these only draw it and say what was pressed. Every word is plan/call-words.ts's.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { clientColor } from "../labels.ts";
import { Icon } from "../icons.tsx";
import { lengthLabel } from "../../plan/calls.ts";
import { CALL_LIST, CLOSE_TEXT, MARK_TEXT } from "../../plan/call-words.ts";
import { closedLine, markWords, type CallMarkKind, type CallRow, type SeriesEntry } from "../../plan/call-list.ts";
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

/** A tick for a row that can be done together with others (Hide, or Skip all and close). */
function Tick({ on, name, onTick }: { on: boolean; name: string; onTick: (on: boolean) => void }) {
  return (
    <label className="calls-tick" title={CLOSE_TEXT.tick(name)}>
      <input type="checkbox" checked={on} onChange={(e) => onTick(e.target.checked)} aria-label={CLOSE_TEXT.tick(name)} data-call-tick="" />
    </label>
  );
}

/** "3 left of 11" with a small bar. */
function Left({ left }: { left: NonNullable<CallRow["left"]> }) {
  const done = left.all ? (left.all - left.open) / left.all : 0;
  return (
    <span className="calls-left">
      <span className="calls-left-bar" aria-hidden="true"><span style={{ width: `${Math.round(done * 100)}%` }} /></span>
      {CLOSE_TEXT.left(left.open, left.all)}
    </span>
  );
}

type RowActs = {
  open: boolean;
  zone: string;
  colors: Record<string, string>;
  ticked: boolean;
  onTick: (on: boolean) => void;
  onOpen: () => void;
};

/**
 * MC-4: a call in Needs you, two lines: when and its name; then its client, how far along and one button (Review,
 * Upload or Open), with Skip all and close where proposals are left.
 */
export function NeedsRow({ r, open, zone, colors, ticked, onTick, onOpen, onSkipAll }: RowActs & { r: CallRow; onSkipAll: () => void }) {
  const color = r.clientKey ? clientColor(r.clientKey, colors) : null;
  const action = r.left?.open ? CALL_LIST.reviewButton : r.state.label === CALL_LIST.uploadState ? CALL_LIST.uploadButton : CALL_LIST.openButton;
  return (
    <li className={`calls-row need-row${open ? " open" : ""}`} style={color ? ({ "--c": color } as CSSProperties) : undefined} data-row={r.key}>
      {r.left?.open ? <Tick on={ticked} name={r.name} onTick={onTick} /> : <span className="calls-tick" aria-hidden="true" />}
      <button type="button" className="calls-row-main" aria-current={open ? "true" : undefined} data-call-row={r.key} data-bucket={r.bucket} onClick={onOpen}>
        <span className="calls-row-one">
          <span className="calls-time">{whenOf(r.startAt, zone)}</span>
          <span className="calls-name">{r.name}</span>
        </span>
        <span className="calls-row-two">
          <span className={`swatch${color ? "" : " none"}`} aria-hidden="true" />
          <span className="calls-meta">{r.clientName ?? CALL_LIST.noClient}</span>
          {r.left ? <Left left={r.left} /> : <span className="calls-state needs">{r.state.label}</span>}
        </span>
      </button>
      <span className="calls-row-acts">
        <button type="button" className="mini primary" onClick={onOpen} data-call-act="open">{action}</button>
        {r.left?.open ? <button type="button" className="mini quiet" onClick={onSkipAll} data-call-act="skip-all">{r.left.open === r.left.all ? CLOSE_TEXT.skipAllClose : CLOSE_TEXT.skipLastClose(r.left.open)}</button> : null}
      </span>
    </li>
  );
}

/** What Review from a row is doing, or why it stopped (with Upload a file). */
export type RowStatus = { busy: string | null; error: string | null; occurrenceId: number | null };

/**
 * MC-4: one line under a week (or in the fold): when, the name, the client it would be about (a calendar call, as
 * "About Northwind", which is the client choice), its mark, Review and Hide. A call FocusTime keeps (waiting on someone
 * else) shows its state instead.
 */
export function WeekRow({ r, open, zone, colors, ticked, onTick, onOpen, clients, client, onClient, onReview, onHide, status, onUpload, inSeries = false }: RowActs & {
  r: CallRow;
  clients: readonly CaptureClient[];
  /** The client on the row: my choice, else FocusTime's suggestion, else none ("Which client?"). */
  client: string | null;
  onClient: (key: string) => void;
  onReview: () => void;
  onHide: () => void;
  status: RowStatus | null;
  onUpload: () => void;
  inSeries?: boolean;
}) {
  const color = r.clientKey ? clientColor(r.clientKey, colors) : client ? clientColor(client, colors) : null;
  // PK-4: a recording with no call hides too, by its id alone.
  const canHide = (!!r.other && r.occurrenceId === null) || !!r.recording;
  const nameOf = (k: string) => clients.find((c) => c.clientKey === k)?.clientName ?? k;
  return (
    <li className={`calls-row one${open ? " open" : ""}${inSeries ? " in-series" : ""}`} style={color ? ({ "--c": color } as CSSProperties) : undefined} data-row={r.key}>
      {canHide ? <Tick on={ticked} name={r.name} onTick={onTick} /> : <span className="calls-tick" aria-hidden="true" />}
      <button type="button" className="calls-row-main" aria-current={open ? "true" : undefined} data-call-row={r.key} data-bucket={r.bucket} onClick={onOpen}>
        <span className="calls-row-one">
          <span className="calls-time">{inSeries ? dayOf(r.startAt, zone) : whenOf(r.startAt, zone)}</span>
          <span className="calls-name">{inSeries ? timeOf(r.startAt, zone) : r.name}</span>
          {r.occurrenceId !== null && <span className="calls-state">{r.state.label}</span>}
        </span>
      </button>
      <span className="calls-row-acts">
        <TranscriptMark mark={r.mark} check={r.check} />
        {r.other && r.occurrenceId === null && (
          <label className={`calls-about${client ? "" : " none"}`} title={CLOSE_TEXT.aboutHint}>
            <span className="sr-only">{CALL_LIST.aboutLabel}</span>
            <select value={client ?? ""} onChange={(e) => onClient(e.target.value)} data-call-about="">
              {!client && <option value="">{CLOSE_TEXT.whichClient}</option>}
              {clients.map((c) => <option key={c.clientKey} value={c.clientKey}>{CLOSE_TEXT.about(nameOf(c.clientKey))}</option>)}
            </select>
          </label>
        )}
        {(r.other || r.recording) && r.occurrenceId === null && (
          <button type="button" className={`mini${r.mark ? " primary" : ""}`} disabled={!!status?.busy} onClick={onReview} data-call-act="review">{CALL_LIST.reviewButton}</button>
        )}
        {canHide && <button type="button" className="mini quiet" onClick={onHide} data-call-act="hide">{CLOSE_TEXT.hide}</button>}
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
export function SeriesRow({ e, weekLabel, expanded, onExpand, onHideEvery, onHideWeek, ticked, onTick, children }: {
  e: SeriesEntry;
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
      <Tick on={ticked} name={e.name} onTick={onTick} />
      <button type="button" className="calls-row-main" aria-expanded={expanded} data-call-row={e.key} onClick={() => onExpand(!expanded)}>
        <span className="calls-row-one">
          <span className="calls-name">{e.name}</span>
          <span className="calls-time">· {CLOSE_TEXT.series(e.rows.length, weekLabel)}</span>
          <Icon name={expanded ? "up" : "next"} />
        </span>
      </button>
      <span className="calls-row-acts">
        <TranscriptMark mark={e.mark} />
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

/** MC-4: a closed call, one line: when, its name, and what came of it. */
export function ClosedRow({ r, open, zone, colors, onOpen }: { r: CallRow; open: boolean; zone: string; colors: Record<string, string>; onOpen: () => void }) {
  const color = r.clientKey ? clientColor(r.clientKey, colors) : null;
  return (
    <li className={`calls-row one closed${open ? " open" : ""}`} style={color ? ({ "--c": color } as CSSProperties) : undefined} data-row={r.key}>
      <span className="calls-tick" aria-hidden="true" />
      <button type="button" className="calls-row-main" aria-current={open ? "true" : undefined} data-call-row={r.key} data-bucket={r.bucket} onClick={onOpen}>
        <span className="calls-row-one">
          <span className="calls-time">{whenOf(r.startAt, zone)}</span>
          <span className="calls-name">{r.name}</span>
          <span className="calls-state" data-closed-line="">{r.closed ? closedLine(r.closed) : ""}</span>
        </span>
      </button>
    </li>
  );
}

/** MC-4: a hidden meeting, with Put back (a series hidden for every one says so). */
export function HiddenRow({ r, every, count = 1, zone, onPutBack }: { r: CallRow; every: boolean; /** A series hidden for every one: its calls in the window, as one row. */ count?: number; zone: string; onPutBack: () => void }) {
  return (
    <li className="calls-row one hidden-row" data-row={r.key}>
      <span className="calls-tick" aria-hidden="true" />
      <span className="calls-row-main as-text" data-call-row={r.key} tabIndex={-1}>
        <span className="calls-row-one">
          {!every && <span className="calls-time">{whenOf(r.startAt, zone)}</span>}
          <span className="calls-name">{r.name}</span>
          {every && <span className="calls-time">· {CLOSE_TEXT.series(count, "")} · {CLOSE_TEXT.hiddenEveryLine}</span>}
        </span>
      </span>
      <span className="calls-row-acts">
        <button type="button" className="mini" onClick={onPutBack} data-call-act="put-back">{CLOSE_TEXT.putBack}</button>
      </span>
    </li>
  );
}

/** MC-4: the bar for ticked rows: Hide N and Skip all and close N, with Clear. */
export function TickBar({ hide, close, onHide, onClose, onClear }: { hide: number; close: number; onHide: () => void; onClose: () => void; onClear: () => void }) {
  if (!hide && !close) return null;
  return (
    <div className="calls-tickbar" role="region" aria-label={CLOSE_TEXT.ticked(hide + close)} data-calls-tickbar="">
      <span className="muted">{CLOSE_TEXT.ticked(hide + close)}</span>
      {hide > 0 && <button type="button" className="mini" onClick={onHide} data-tickbar="hide">{CLOSE_TEXT.hideSeveral(hide)}</button>}
      {close > 0 && <button type="button" className="mini" onClick={onClose} data-tickbar="close">{CLOSE_TEXT.skipSeveral(close)}</button>}
      <button type="button" className="mini quiet" onClick={onClear}>{CLOSE_TEXT.clearTicks}</button>
    </div>
  );
}

export { lengthLabel };
