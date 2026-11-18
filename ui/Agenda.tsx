// The block agenda (step 13.6, D244): a block's meetings, personal events, unavailable time and timeboxes in time order,
// with the free gaps between. Moved out of Plan the day (WD-1) for the detail panel.
import { callHref, useBlockCalls, useCallOf, type CallMark } from "./meetings/calls.ts";
import { RepeatMark } from "./meetings/CallMark.tsx";
import { CARD_MEETINGS } from "../plan/call-words.ts";
import { useState, type CSSProperties, type ReactNode } from "react";
import { agendaOf } from "../plan/agenda.ts";
import type { DayEventWhen } from "../plan/todaycal.ts";
import type { Slot } from "../week/types.ts";
import { clientColor, halfTag } from "./labels.ts";
import { spanText } from "./menu.ts";
import { TimeboxDetails, useTimeboxes } from "./Timeboxes.tsx";
import { formatDuration } from "../week/format.ts";
import { agendaNowIndex, nowClock, ownsNow } from "../plan/nowline.ts";
import { NowRow } from "./NowLine.tsx";
import { Icon } from "./icons.tsx";

const isTodayIn = (date: string, now: string, tz: string) => Temporal.Instant.from(now).toZonedDateTimeISO(tz).toPlainDate().toString() === date;

/**
 * A block's agenda (D244): meetings, personal events, unavailable time and timeboxes in time order, with the free gaps
 * between ("Free 9:00–11:00 · 2h"). A timebox row opens its details (show as, Put on Outlook, Removed in Outlook).
 */
export function Agenda({ slot, now, tz, clientName, pickRow, whens }: { whens?: ReadonlyMap<string, DayEventWhen>; slot: Slot; now: string; tz: string; clientName: (k: string | null) => string; pickRow: (pickId: number) => ReactNode }) {
  const env = useTimeboxes();
  const [open, setOpen] = useState<number | null>(null);
  const callOf = useCallOf();
  // WK-6: the calls that need me with no meeting on my calendar are rows too, at their own time.
  const loose = useBlockCalls(slot).loose.filter((c) => c.needsMe);
  if (!env) return null;
  // With timeboxing off (D261), timeboxes stay but the agenda shows only the calendar and free time.
  type Row = ReturnType<typeof agendaOf>[number] | { kind: "call"; start: string; c: CallMark };
  const rows: Row[] = [...agendaOf(slot, env.settings.enabled ? env.timeboxes : [], isTodayIn(slot.date, now, tz) ? now : undefined), ...loose.map((c) => ({ kind: "call" as const, start: c.startAt, c }))].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (!rows.length) return null;
  const sel = open !== null ? env.timeboxes.find((t) => t.id === open && !t.removedAt) ?? null : null;
  const row = (r: Row): ReactNode => {
    if (r.kind === "call")
      return (
        <li key={`c${r.c.occurrenceId}`} className="ag-meeting ag-call-only is-call">
          <span className="ag-time">{spanText(r.c.startAt, r.c.endAt, tz)}</span>
          <a className="ag-main" href={callHref(r.c.occurrenceId)} aria-label={`${CARD_MEETINGS.callOnly}: ${r.c.name}, ${CARD_MEETINGS.state(r.c)}. ${CARD_MEETINGS.openCall}`}>
            <span className="ag-title" title={r.c.name}>
              <span className="ag-call-icon" aria-hidden="true"><Icon name="calls" /></span>
              {r.c.name}
            </span>
            <span className="ag-call">{CARD_MEETINGS.state(r.c)}</span>
          </a>
        </li>
      );
    const tb = r.kind === "timebox" ? env.timeboxes.find((t) => t.id === r.timeboxId) : undefined;
    const when = spanText(r.start, r.end, tz);
    if (r.kind === "free")
      return (
        <li key={`f${r.start}`} className="ag-free">
          <span className="ag-time">{when}</span>
          <span className="ag-title">Free · {formatDuration(r.minutes)}</span>
        </li>
      );
    // Step 14.5 (D259): a pick's timebox is the pick's own row, at its time.
    const asPick = tb && tb.pickId !== null ? pickRow(tb.pickId) : null;
    if (asPick) return asPick;
    if (tb)
      return (
        <li key={`t${tb.id}`} className={`ag-timebox${tb.outlookNote ? " noted" : ""}${tb.conflict ? " conflict" : ""}`} style={{ "--c": clientColor(tb.clientKey, env.colors) } as CSSProperties}>
          <button type="button" className="ag-open" aria-expanded={open === tb.id} onClick={() => setOpen(open === tb.id ? null : tb.id)} title="Timebox details: show as, Put on Outlook, remove">
            <span className="ag-time">{when}</span>
            <span className="ag-title">
              {tb.conflict && <><Icon name="risk" label="Conflict" /> </>}
              {tb.title}
            </span>
            {tb.onOutlook && <span className="tb-ol" title="On Outlook">O</span>}
            {tb.outlookNote && <span className="tb-note">{tb.outlookNote}</span>}
          </button>
        </li>
      );
    const w = r.eventId ? whens?.get(r.eventId) : undefined;
    // MC-1d: a registered call's meeting carries its mark here too (matched on the meeting's own start, not the clipped one).
    const ev = r.eventId ? slot.events.find((p) => p.event.id === r.eventId)?.event : undefined;
    // WK-6: a call's state sits under its meeting's name while it needs me (the row's name then opens it in Calls);
    // otherwise the meeting is plain. No mark at the row's end, so nothing runs past the panel's edge.
    const call = ev && r.kind === "meeting" ? callOf(ev) : null;
    const needs = call?.needsMe ? call : null;
    const name = (
      <>
        <span className="ag-title" title={r.title}>
          {r.title}
        </span>
        {ev?.repeats && <RepeatMark />}
      </>
    );
    return (
      <li key={`e${r.eventId}${r.start}`} className={`ag-${r.kind} show-${r.showAs ?? "busy"}${r.free ? " shown-free" : ""}${w ? ` when-${w}` : ""}${needs ? " is-call" : ""}`}>
        <span className="ag-time">{when}</span>
        {needs ? (
          <a className="ag-main" href={callHref(needs.occurrenceId)} aria-label={`${r.title}: ${CARD_MEETINGS.state(needs)}. ${CARD_MEETINGS.openCall}`}>
            <span className="ag-name">{name}</span>
            <span className="ag-call">{CARD_MEETINGS.state(needs)}</span>
          </a>
        ) : (
          name
        )}
        {w === "now" && <span className="cal-tag now">Now</span>}
        {w === "next" && <span className="cal-tag next">Next</span>}
        {r.free && <span className="muted">shown as free</span>}
      </li>
    );
  };
  // UI-B: the now row, only in the block under way (NL-1), in the person's zone.
  const nowAt = ownsNow(slot, now) ? agendaNowIndex(rows.map((r) => r.start), now, slot.date, tz) : null;
  return (
    <div className="pd-agenda">
      <ol aria-label={`${halfTag(slot.half)} agenda`}>
        {rows.flatMap((r, i) => (i === nowAt ? [<NowRow key="now" label={nowClock(now, tz)} />, row(r)] : [row(r)]))}
        {nowAt === rows.length && <NowRow key="now" label={nowClock(now, tz)} />}
      </ol>
      {sel && <TimeboxDetails tb={sel} env={env} clientName={clientName(sel.clientKey)} today={isTodayIn(sel.date, now, tz)} onRemoved={() => setOpen(null)} />}
    </div>
  );
}

/** Musts on this day's picks: the item is a must on the week list, or its parent feature is. */
