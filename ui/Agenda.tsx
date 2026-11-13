// The block agenda (step 13.6, D244): a block's meetings, personal events, unavailable time and timeboxes in time order,
// with the free gaps between. Moved out of Plan the day (WD-1) for the detail panel.
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
  if (!env) return null;
  // With timeboxing off (D261), timeboxes stay but the agenda shows only the calendar and free time.
  const rows = agendaOf(slot, env.settings.enabled ? env.timeboxes : [], isTodayIn(slot.date, now, tz) ? now : undefined);
  if (!rows.length) return null;
  const sel = open !== null ? env.timeboxes.find((t) => t.id === open && !t.removedAt) ?? null : null;
  const row = (r: (typeof rows)[number]): ReactNode => {
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
              {tb.conflict && <><Icon name="risk" /> </>}
              {tb.title}
            </span>
            {tb.onOutlook && <span className="tb-ol" title="On Outlook">O</span>}
            {tb.outlookNote && <span className="tb-note">{tb.outlookNote}</span>}
          </button>
        </li>
      );
    const w = r.eventId ? whens?.get(r.eventId) : undefined;
    return (
      <li key={`e${r.eventId}${r.start}`} className={`ag-${r.kind} show-${r.showAs ?? "busy"}${r.free ? " shown-free" : ""}${w ? ` when-${w}` : ""}`}>
        <span className="ag-time">{when}</span>
        <span className="ag-title" title={r.title}>
          {r.title}
        </span>
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
