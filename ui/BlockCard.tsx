// WD-1: one block card, used on Week now and on Day in WD-2 (was Week's HalfDay). A header with the client's colour
// and name, the block's time and one status chip that never wraps (the worst state; the rest in its tooltip); rows
// with a checkbox, type icon, a title on up to two lines and the size or time (a title opens the story card, FN-1);
// a feature placed with no stories as "Needs stories · Break down"; "+ Add" as the last row of every block, which
// selects it and opens the block panel with the cursor in its Add box (WD-2); meetings as one summary line that opens into the list when there is no
// rail. With the Timeline switch on the hour rail is a slim strip (about 56 px) so titles keep their width.
import { Fragment, useContext, useState, type CSSProperties } from "react";
import { callsIn, useCallMarks } from "./meetings/calls.ts";
import { LiveCalls } from "./cowork.tsx";
import { TimeboxBands } from "./Timeboxes.tsx";
import { formatDuration } from "../week/format.ts";
import { freeMinutes } from "../week/free.ts";
import { FoldLine } from "./plan/FoldLine.tsx";
import { chipFold, foldDone } from "../plan/cardfold.ts";
import type { CalEvent, Slot } from "../week/types.ts";
import type { Pick } from "../plan/types.ts";
import type { FollowUpView } from "../actions/types.ts";
import { wasDueText } from "../plan/due.ts";
import { railMarks, type RailSpan } from "../plan/rail-promises.ts";
import { checkinMenu, slotMenu } from "./menu.ts";
import { MenuRow, useMenu } from "./Menus.tsx";
import { EyeIcon } from "./Watching.tsx";
import type { IsoDate } from "../week/types.ts";
import { PickRow } from "./PickRow.tsx";
import { DueBadge, promiseAbout } from "./FollowUps.tsx";
import { hourMarks, layoutEvents, railFor, rulerSpan } from "./layout.ts";
import { DevOpsWork } from "./work.ts";
import { clientColor, eventRange, SampleSources, shortRange, showAsLabel, slotRange, sourceName, startClock } from "./labels.ts";
import { usePhone } from "./viewport.ts";
import { cardPlan, PlanCtx, type PlanView } from "./planview.ts";
import { blockStatus, watchTip } from "../plan/blockstatus.ts";
import { HalfScope } from "./scope.ts";
import { interactive, onRowOrChip } from "./cardclick.ts";
import type { RailItem } from "../plan/inbox-items.ts";
import { cardGroups } from "../plan/blockstories.ts";
import { TypeIcon } from "./TypeIcon.tsx";
import { pickDragged, useDragSource, useDropTarget } from "./WeekStories.tsx";
import { OriginPick, useIsOrigin } from "./Carry.tsx";
import { BlockSuggestions } from "./Suggest.tsx";
import { NowLine, NowMark, NowPast, NowTick } from "./NowLine.tsx";
import { Timeline, ms, offHours, pct, useEventMenu, type RailNow } from "./Timeline.tsx";
import { AddPanelCtx, LiveOnCard, NextTodoCtx, RulerCtx, TierCtx, TimelineCtx, type PanelFocus } from "./weekctx.ts";
import { PlacedFeatures } from "./BlockPanel.tsx";

/**
 * WD-1 (MB-1's agenda line on every card with no rail): "3 meetings · 2h 30m · 1h 45m free", the block's meetings and
 * personal events (shown as free left out), their time inside the block, and the free time.
 */
export function meetingsLine(slot: Slot): string {
  const busy = slot.events.filter((e) => e.event.showAs !== "free");
  const minutes = busy.reduce((m, e) => m + Math.max(0, Math.round((ms(e.clipEnd) - ms(e.clipStart)) / 60000)), 0);
  const n = busy.length;
  return [n ? `${n} meeting${n === 1 ? "" : "s"}` : "No meetings", n && minutes ? formatDuration(minutes) : "", `${formatDuration(freeMinutes(slot))} free`].filter(Boolean).join(" · ");
}
export type BlockCardProps = {
  /** Ids of events drawn in the block before this one on the same day (labelHere, D271). */
  earlier: ReadonlySet<string>;
  slot: Slot;
  colors: Record<string, string>;
  minFocusWindow: number;
  /** Friday or a weekend day (only catch-up or a flex session). */
  overflow: boolean;
  /** An evening-only day: one card spanning the rows. */
  span: boolean;
  tz: string;
  selected: boolean;
  dayLabel: string;
  refFn: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onOpen: (focus?: PanelFocus) => void;
  /** A compact card (the time rail on the right instead of the hour timeline) for the medium layout. */
  compact: boolean;
  /** WK-2: a card in a layout that sizes cards by their minutes (wide, the one-day timeline), kept with the timeline hidden. */
  grow: boolean;
  now: string;
  /** Done picks stay visible on today; on other days they collapse to "N done". */
  isToday: boolean;
  /** Follow-ups due this week to badge on this card (U3). */
  dueBadges: readonly FollowUpView[];
  /** WD-2: "+ Add" opens the block panel on this block, the cursor in its Add box. Absent where work can't be added (a past or PTO block). */
  addWork?: (() => void) | undefined;
  /** UI-B: today's now line on this block's rail; null on other days. */
  railNow: RailNow | null;
};


export function BlockCard({ earlier, slot, colors, minFocusWindow, overflow, span, tz, selected, dayLabel, refFn, onSelect, onOpen, compact, grow, now, isToday, dueBadges, addWork, railNow }: BlockCardProps) {
  const primary = slot.focus[0];
  // QT-1: a card is marked only when the calendar puts it at risk; Watch alone is a hover, never a chip or a border.
  const status = blockStatus(slot.risks);
  const sev = status.kind === "at_risk" ? "at_risk" : null;
  const watch = watchTip(slot.risks);
  const allWork = useContext(DevOpsWork);
  const plan = useContext(PlanCtx);
  const work = primary && !overflow ? allWork.get(primary.clientKey) : undefined;
  const eve = slot.half === "EVE";
  const cp = cardPlan(plan.week, slot, primary?.clientKey ?? null, work?.items ?? [], now, plan.sizes, plan.timeboxes);
  // Step 13.6 (D238): Friday's catch-up work shows on its card even though Friday is never committed.
  const ticks = overflow && !eve && !cp.picks.length ? catchUp(plan.week, slot) : cp.picks;
  // U3, PS-1: done picks fold to "N done" (a click opens them): always on other days, on today in a heavy block.
  const fold = foldDone(ticks, { isToday });
  // UI-B: on a day that has passed, a pick kept or moved on from here stays as a dimmed "→ moved to Mon AM" line.
  const movedOn = slot.date < (plan.today ?? "") ? (plan.week?.[slot.date]?.picks ?? []).filter((p) => p.half === slot.half && p.status === "moved" && p.carriedTo) : [];
  const shown = [...fold.shown, ...movedOn];
  // P1: on the phone a card lists its meetings in words; no rail.
  const phone = usePhone();
  // WK-1: exactly the tier's element: the rail with titles, a slim ruler, or the day strip (strip and mini).
  const tier = useContext(TierCtx);
  const timeline = useContext(TimelineCtx);
  // WD-1: the hour rail is a slim strip (about 56 px) so titles keep their width; the strip and mini tiers stay.
  const railTier = compact && timeline ? railFor(tier, slot, phone) : null;
  const rail = railTier === "rail" ? "slim" : railTier;
  // WK-2: with no time rail (the phone, or the timeline hidden) the card lists its meetings and events as lines.
  const listEvents = phone || !timeline;
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const panel = useContext(AddPanelCtx);
  const adding = panel.at?.date === slot.date && panel.at.half === slot.half;
  const ruler = rail === "slim";
  // UI-9: a card counts its late promises in one chip; an overdue due badge for a promise a chip counts is folded into
  // it, so it shows once. WD-1: the slim rail has no labels, so its cards keep the chip too (its mark is a line only).
  const rc = useContext(RulerCtx);
  const late = rc.late.get(`${slot.date}|${slot.half}`) ?? [];
  const chipped = new Set([...rc.late.values()].flat().map((p) => p.key));
  const badges = dueBadges.filter((f) => !(f.due && f.due < (plan.today ?? "") && chipped.has(`f${f.id}`)));
  const lateChip = late.length > 0 && <LateChip late={late} tabIndex={selected ? 0 : -1} onPromise={rc.onPromise} onLate={rc.onLate} />;
  const style = { "--c": clientColor(primary?.clientKey, colors), ...((compact && !grow) || slot.date < (plan.today ?? "") ? {} : { flexGrow: minutesOf(slot) }) } as CSSProperties;
  const state = eve ? "eve" : overflow ? "overflow" : slot.open ? "open" : slot.off ? "off" : "focus";
  const reasonsId = `reasons-${slot.date}-${slot.half}`;
  // S1 (D453): a PTO half reads PTO (its block, if any, stays in the data, read only).
  const ptoHalf = slot.pto && !eve;
  const name = ptoHalf ? "PTO" : primary ? primary.clientName : eve ? (slot.flex.length ? "Flex" : "Evening") : slot.off ? "No working hours" : overflow ? "Catch-up" : "Open";
  // WK-2: a one-word label (Catch-up, Open, PTO, Flex) never splits mid-word; a card too narrow for it shows a short form.
  const short = !primary && !ptoHalf && name === "Catch-up" ? "C-up" : null;
  // QT-1: a day before today folds to its header and one line of counts; a click opens the panel to tick and move on.
  const folded = slot.date < (plan.today ?? "");
  const label = `${dayLabel} ${eve ? "evening" : slot.half}, ${name}${sev && !folded ? ", at risk" : ""}`;
  const menu = useMenu((env) => slotMenu(env, slot.date, slot.half, primary?.clientKey ?? null, primary?.clientName ?? null));
  const chipLine = chipFold([
    ...(lateChip ? [<Fragment key="late">{lateChip}</Fragment>] : []),
    ...badges.map((f) => (
      <button key={f.id} type="button" className="due-open" tabIndex={selected ? 0 : -1} onClick={(e) => (e.stopPropagation(), onOpen({ kind: "followup", id: f.id }))}>
        <DueBadge l={f} about={promiseAbout(f)} />
      </button>
    )),
  ]);
  // MB-1b (Q-MB1-7): on the phone a card with no status pill shows the late chip at the end of its title line, so the
  // chip adds no line; beside a status pill it stays on the chips line.
  const chipInHead = phone && status.kind === "none" && !!lateChip;
  // On the phone the late chip may sit in the head (MB-1b); it still counts toward the three.
  if (chipInHead) chipLine.shown.shift();
  // WD-1: one chip in the header that never wraps: the worst state alone; its reason and the rest in its tooltip.
  const pill = status.label;
  // Its tooltip: the at-risk reason, then the other reasons (Watch ones included).
  const chipTip = [`At risk${status.short ? `: ${status.short}` : ""}`, status.detail, ...slot.risks.filter((r) => r.reason !== status.detail).map((r) => r.reason)].filter((x): x is string => !!x).filter((x, i, a) => a.indexOf(x) === i).join("\n");
  // PV-1: a drop target for stories dragged from the panel or another block (not the evening).
  const drop = useDropTarget(eve ? null : { date: slot.date, half: slot.half });
  // MC-1: a registered call starting in this card's hours: its name and what it needs, opening its review.
  const calls = callsIn(useCallMarks(), slot.start, slot.end);
  // CW-1: a call live in this client's delivery chat (only on today's first card for the client that hasn't ended).
  const liveCalls = useContext(LiveOnCard).get(`${slot.date}|${slot.half}`) ?? [];


  const flexList = slot.flex.length > 0 && (
    <ul className="flex-list" aria-label="Flex sessions">
      {slot.flex.map((f) => (
        <li key={f.id} title={f.note ?? ""}>
          <span className="flex-time">{startClock(f.start, tz)}–{startClock(f.end, tz)}</span>
          <span className="flex-what">{f.clientKey}{f.itemTitle ? ` · ${f.itemTitle}` : f.note ? ` · ${f.note}` : ""}</span>
          {!!f.overlapMinutes && <span className="flex-overlap">{formatDuration(f.overlapMinutes)} inside working hours, not counted</span>}
        </li>
      ))}
    </ul>
  );

  const body = (
    <div className="card-body">
      <div className="card-head" title={!folded && status.kind === "none" ? (watch ?? undefined) : undefined}>
        <span className="swatch" aria-hidden="true" />
        <span className={`card-client${primary ? "" : " open-label"}${name.includes(" ") ? "" : " one-word"}`} title={name}>
          {short ? (
            <>
              <span className="cc-full">{name}</span>
              <span className="cc-short" aria-hidden="true">{short}</span>
            </>
          ) : (
            name
          )}
        </span>
        <CardWhen slot={slot} tz={tz} />
        {/* UI-B, PS-1: with no rail (the phone, a card too narrow for one), "now" is a marker in the block under way's header. */}
        {compact && !rail && railNow?.at != null && <NowMark label={railNow.label} onClick={railNow.onClick} />}
        {status.kind !== "none" && !folded && (
          <span className={`status-pill head-chip ${status.kind}`} id={reasonsId} title={chipTip}>
            {pill}
          </span>
        )}
        {chipInHead && lateChip}
        <span className="card-more">{menu.button(`Actions for ${dayLabel} ${slot.half}`)}</span>
      </div>
      {folded ? (
        <>
          {drop.tip}
          <div className="card-folded">{foldedLine(ticks, movedOn)}</div>
          {/* What still needs me stays: a past call to review, and late promises (beside the line, not in the header). */}
          {lateChip && !chipInHead && <div className="card-status">{lateChip}</div>}
          {calls.length > 0 && (
            <div className="card-calls">
              {calls.map((c) => (
                <a key={c.occurrenceId} href={`#/meetings/${c.occurrenceId}`} className={`call-mark${c.needsMe ? " needs" : ""}`} tabIndex={selected ? 0 : -1} onClick={(e) => e.stopPropagation()} title={`${c.name}: ${c.label}`}>
                  <span className="call-name">{c.role}</span>
                  <span className="call-what">· {c.label}</span>
                </a>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
      {rail === "strip" && <DayStrip slot={slot} tz={tz} label={`${dayLabel} ${eve ? "evening" : slot.half}`} now={railNow} />}
      {drop.tip}
      {slot.focus.slice(1).map((b) => (
        <div key={b.id} className="also" style={{ "--c2": clientColor(b.clientKey, colors) } as CSSProperties}>
          <span className="swatch small" />
          Also booked: {b.clientName}
        </div>
      ))}
      {chipLine.shown.length > 0 && (
        // PS-1: one line of chips (late promises, then due dates), three at most; the rest fold to "+N", which opens the block.
        <div className="card-status card-due">
          {chipLine.shown}
          {chipLine.more > 0 && (
            <button type="button" className="chip-more" tabIndex={selected ? 0 : -1} onClick={(e) => (e.stopPropagation(), onOpen())} aria-label={`${chipLine.more} more promises due: open the block`} title={`${chipLine.more} more promises due: open the block`}>
              +{chipLine.more}
            </button>
          )}
        </div>
      )}
      <LiveCalls chats={liveCalls} zone={tz} tabIndex={selected ? 0 : -1} className="card-live" />
      {calls.length > 0 && (
        <div className="card-calls">
          {calls.map((c) => (
            <a key={c.occurrenceId} href={`#/meetings/${c.occurrenceId}`} className={`call-mark${c.needsMe ? " needs" : ""}`} tabIndex={selected ? 0 : -1} onClick={(e) => e.stopPropagation()} title={`${c.name}: ${c.label}`}>
              <span className="call-name">{c.role}</span>
              <span className="call-what">· {c.label}</span>
            </a>
          ))}
        </div>
      )}
      {flexList}
      {listEvents && slot.events.length > 0 && (
        // MB-1, WD-1: with no rail the card's meetings are one line ("3 meetings · 2h 30m · 1h 45m free"); it opens into the list.
        <FoldLine className="card-agenda-fold" open={agendaOpen} onToggle={() => setAgendaOpen(!agendaOpen)} label={meetingsLine(slot)} />
      )}
      {listEvents && slot.events.length > 0 && agendaOpen && (
        <ul className="card-events" aria-label={`Meetings and events, ${dayLabel} ${slot.half}`}>
          {slot.events.map((p) => (
            <li key={p.event.id} className={p.event.isPersonal ? "personal" : p.event.unavailable ? "unavailable" : undefined} title={p.event.title}>
              <span className="ce-time">{startClock(p.clipStart, tz)}–{startClock(p.clipEnd, tz)}</span>
              <span className="ce-title">{p.event.title}</span>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && <CardPicks picks={shown} label={`Plan for ${dayLabel} ${slot.half}`} tabIndex={selected ? 0 : -1} />}
      {!eve && primary && <PlacedFeatures clientKey={primary.clientKey} date={slot.date} half={slot.half} tabIndex={selected ? 0 : -1} />}
      {!eve && <BlockSuggestions date={slot.date} half={slot.half} tabIndex={selected ? 0 : -1} where={phone ? "phone" : "card"} />}
      {!eve && <CheckinChips date={slot.date} half={slot.half as "AM" | "PM"} tabIndex={selected ? 0 : -1} />}
      {fold.done.length > 0 && <FoldLine className="card-done" open={doneOpen} onToggle={() => setDoneOpen(!doneOpen)} label={`${fold.done.length} done`} title={doneOpen ? "Fold the done to-dos" : "Show the done to-dos"} />}
      {doneOpen && fold.done.length > 0 && <CardPicks picks={fold.done} label={`Done on ${dayLabel} ${slot.half}`} tabIndex={selected ? 0 : -1} />}
      {addWork && (
        // WD-1, WD-2: "+ Add" is the last row of every block that can take work, always visible: it selects the block
        // and opens the block panel on it (a bottom sheet on the phone).
        <button
          type="button"
          className="add-work add-row"
          tabIndex={selected ? 0 : -1}
          title="Add to this block (A)"
          aria-label={`Add to ${dayLabel} ${eve ? "evening" : slot.half}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
            addWork();
          }}
        >
          + Add
        </button>
      )}
        </>
      )}
    </div>
  );

  return (
    <div
      ref={refFn}
      {...drop.props}
      data-tour={state === "focus" ? "wk-block" : undefined}
      className={`half ${state}${ptoHalf ? " pto-half" : ""} ${span ? "span-all" : ""} ${folded ? "folded" : (sev ?? "")} ${selected ? "selected" : ""} ${compact || folded ? "card" : ""}${ruler && !folded ? " has-ruler" : ""}${rail === "slim" && !folded ? " slim" : ""}${adding ? " adding" : ""}${drop.cls}`}
      style={style}
      tabIndex={selected ? 0 : -1}
      role="button"
      aria-label={label}
      aria-describedby={status.kind !== "none" && !folded ? reasonsId : undefined}
      aria-pressed={selected}
      onClick={(e) => {
        // WD-2: the header or empty space opens the block panel; a row, a checkbox, a chip or a drag doesn't.
        if (interactive(e) || onRowOrChip(e)) return;
        onOpen();
      }}
      onContextMenu={(e) => {
        onSelect();
        menu.onContextMenu(e);
      }}
    >
      <HalfScope.Provider value={selected}>
        {compact || folded ? (
          <>
            {body}
            {ruler && !folded && <Ruler slot={slot} half={eve ? "EVE" : slot.half} tz={tz} label={`${dayLabel} ${eve ? "evening" : slot.half}`} now={railNow} slim={rail === "slim"} />}
          </>
        ) : (
          <>
            <aside className="card-main">{body}</aside>
            <Timeline slot={slot} tz={tz} earlier={earlier} showGaps={(!overflow || eve) && !slot.open} minFocusWindow={minFocusWindow} now={railNow} />
          </>
        )}
      </HalfScope.Provider>
    </div>
  );
}

/**
 * QT-1: a past day's block in one line: "2 done · 1 unfinished", "1 moved on", or "Nothing planned". What's on it and
 * every action are in its panel.
 */
export function foldedLine(picks: readonly { status: string }[], movedOn: readonly unknown[] = []): string {
  const done = picks.filter((p) => p.status === "done").length;
  const open = picks.filter((p) => p.status === "planned").length;
  const parts = [done ? `${done} done` : "", open ? `${open} unfinished` : "", movedOn.length ? `${movedOn.length} moved on` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing planned";
}

/**
 * UI-9: "1 late" or "N late" on a card with no rail, in the urgent strip's promise colour (amber, never red). One opens
 * that promise in the Inbox; several open the Inbox's Promises, late ones, for the card's client.
 */
export function LateChip({ late, tabIndex, onPromise, onLate }: { late: readonly RailItem[]; tabIndex: number; onPromise?: ((key: string) => void) | undefined; onLate?: ((clientKey: string | null) => void) | undefined }) {
  const n = late.length;
  const clients = new Set(late.map((p) => p.clientKey));
  const open = () => (n === 1 ? onPromise?.(late[0]!.key) : onLate?.(clients.size === 1 ? late[0]!.clientKey : null));
  return (
    <button
      type="button"
      className="late-chip"
      tabIndex={tabIndex}
      aria-label={n === 1 ? "1 late promise" : `${n} late promises`}
      title={n === 1 ? `Late promise: ${late[0]!.what}${late[0]!.toName ? ` · to ${late[0]!.toName}` : ""}` : `${n} late promises: open them in the Inbox`}
      onClick={(e) => (e.stopPropagation(), open())}
      onKeyDown={(e) => e.key === "Enter" && e.stopPropagation()}
    >
      {n} late
    </button>
  );
}

/**
 * WK-2: a block's time range, never cut inside a number: it may only wrap after the dash, so a narrow card wraps there ("9:00–" over "1:00"); a very narrow one shows the hours alone ("9–1"), with the full range in its
 * title.
 */
export function CardWhen({ slot, tz }: { slot: Slot; tz: string }) {
  const full = shortRange(slot, tz);
  const [a, b] = full.split("–");
  if (b === undefined) return <span className="card-when">{full}</span>;
  const hour = (t: string) => t.replace(/:00$/, "");
  return (
    <span className="card-when" title={slotRange(slot, tz)}>
      {/* One text (one word for the reader), with a zero-width break after the dash: it wraps there, never in a number. */}
      <span className="cw-full">{`${a}–\u200B${b}`}</span>
      <span className="cw-short" aria-hidden="true">
        {hour(a!)}–{hour(b)}
      </span>
    </span>
  );
}

/**
 * WK-1: the strip and mini tiers' timeline: one thin bar under the card header across the block's hours (the Timelines
 * range), with the time outside working windows shaded, free stretches in the client's colour, meetings, personal
 * events and unavailable time as segments (their titles on hover; the panel lists them), and today's now tick.
 */
function DayStrip({ slot, tz, label, now }: { slot: Slot; tz: string; label: string; now: RailNow | null }) {
  const samples = useContext(SampleSources);
  const a = ms(slot.view.start);
  const span = Math.max(1, ms(slot.view.end) - a);
  const x = (n: number) => Math.min(1, Math.max(0, (n - a) / span));
  const seg = (s: number, e: number): CSSProperties => ({ left: pct(x(s)), width: pct(Math.max(0, x(e) - x(s))) });
  const events = slot.events.filter((p) => !p.event.allDay);
  const free = slot.freeGaps.reduce((m, g) => m + g.minutes, 0);
  const words = `${slotRange(slot, tz)}, ${events.length ? `${events.length} ${events.length === 1 ? "event" : "events"}` : "no events"}${free ? `, ${formatDuration(free)} free` : ""}`;
  return (
    <div className={`day-strip${now?.at != null ? " has-now" : ""}`} role="group" aria-label={`Timeline for ${label}: ${words}`}>
      <div className="ds-bar">
        {offHours(slot).map((o) => (
          <span key={`off-${o.start}`} className="ds-off" style={seg(o.start, o.end)} aria-hidden="true" />
        ))}
        {slot.freeGaps.map((g) => (
          <span key={`f-${g.start}`} className="ds-free" style={seg(ms(g.start), ms(g.end))} title={`Free · ${formatDuration(g.minutes)}`} aria-hidden="true" />
        ))}
        {events.map((p) => {
          const e = p.event;
          return <span key={e.id} className={`ds-ev ${e.unavailable ? "unavailable" : e.isPersonal ? "personal" : "meeting"} show-${e.showAs ?? "busy"}`} style={seg(ms(p.clipStart), ms(p.clipEnd))} title={`${e.title}\n${eventRange(e, tz)} · ${e.unavailable ? "Unavailable" : sourceName(e, samples)} · ${showAsLabel(e)}`} />;
        })}
        {now && now.past > 0 && <span className="ds-past" style={{ width: pct(Math.min(1, now.past)) }} aria-hidden="true" />}
      </div>
      {now?.at != null && <NowTick at={now.at} label={now.label} onClick={now.onClick} />}
    </div>
  );
}

/**
 * PV-1: a card's picks under small feature headers (type icon, short title), the story's type icon on each line;
 * picks with no feature under "No feature". Headers show only when some pick has a feature. Planned DevOps stories drag
 * to another block.
 */
export function CardPicks({ picks, label, tabIndex }: { picks: readonly Pick[]; label: string; tabIndex: number }) {
  const allWork = useContext(DevOpsWork);
  // UI-B: a pick suggested in a later block (or in the unfinished list) is a dimmed line here, never a second checkbox.
  const isOrigin = useIsOrigin();
  const groups = cardGroups(picks, allWork.get(picks[0]!.clientKey));
  const headed = groups.some((g) => g.feature);
  return (
    <ul className="checklist" aria-label={label}>
      {groups.map((g) => (
        <Fragment key={g.feature?.id ?? "none"}>
          {headed && (
            <li className="card-feat" title={g.feature ? `${g.feature.type} #${g.feature.id} ${g.feature.title}` : "Not under a feature"}>
              {g.feature ? <TypeIcon clientKey={picks[0]!.clientKey} type={g.feature.type} decorative /> : null}
              <span className="cf-title">{g.feature?.title ?? "No feature"}</span>
            </li>
          )}
          {g.picks.map((p) => (isOrigin(p) || p.status === "moved" ? <OriginPick key={p.id} pick={p} /> : <CardPick key={p.id} pick={p} tabIndex={tabIndex} />))}
        </Fragment>
      ))}
    </ul>
  );
}

/**
 * PL-1: a Watching row's 30-minute check-in, before its day is planned or opened: a ghost chip on its half-day ("Check-in"
 * with the feature). Move or remove it from its menu; it becomes a real pick when that day is planned or opened.
 */
export function CheckinChips({ date, half, tabIndex }: { date: IsoDate; half: "AM" | "PM"; tabIndex: number }) {
  const plan = useContext(PlanCtx);
  const here = (plan.checkins ?? []).filter((c) => c.date === date && c.half === half);
  if (!here.length) return null;
  return (
    <ul className="checkin-chips" aria-label="Check-ins">
      {here.map((c) => (
        <MenuRow key={`${c.clientKey}:${c.itemId}`} build={(env) => checkinMenu(env, c)} label={`More for the check-in on ${c.title}`} className="checkin-chip" title={`Watching ${c.title}: a ${c.minutes}-minute check-in. It becomes a to-do when this day is planned`}>
          <EyeIcon />
          <span className="cc-word">Check-in</span>
          <span className="cc-title" tabIndex={tabIndex}>{c.title}</span>
          <span className="cc-min">{c.minutes}m</span>
        </MenuRow>
      ))}
    </ul>
  );
}

export function CardPick({ pick, tabIndex }: { pick: Pick; tabIndex: number }) {
  const plan = useContext(PlanCtx);
  const drag = useDragSource(pickDragged(pick));
  // WD-2: on Day today the next to-do is highlighted and is the only one with Start focus (or the running timer).
  const next = useContext(NextTodoCtx);
  // The title opens the story card (FN-1), on Week and on Day; a click on a row never opens the block panel.
  if (next && next.id === pick.id) return <PickRow pick={pick} toggle={plan.toggle} link density="week" tabIndex={tabIndex} typeIcon dragProps={drag} next extra={next.actions(pick)} />;
  return <PickRow pick={pick} toggle={plan.toggle} link density="week" tabIndex={tabIndex} typeIcon dragProps={drag} />;
}

/** Picks moved to the overflow day (step 13.6, D238): planned and done ones, committed or not. */
function catchUp(week: PlanView["week"], slot: Slot): Pick[] {
  return (week?.[slot.date]?.picks ?? []).filter((p) => p.half === slot.half && (p.status === "planned" || p.status === "done"));
}

/** Card height follows the minutes its timeline shows (the view range), so cards line up across days. */
function minutesOf(slot: Slot): number {
  return Math.max(30, (Temporal.Instant.from(slot.view.end).epochMilliseconds - Temporal.Instant.from(slot.view.start).epochMilliseconds) / 60000);
}

/**
 * Step 15.1 (D276): a narrow time ruler on the right edge of a compact card, covering only the block's working hours:
 * free stretches, meetings, personal events and unavailable time, and timed picks as bands in client color. A pick
 * band opens the time editor; an event opens its menu. The list on the left is unchanged.
 */
function Ruler({ slot, half, tz, label, now, slim = false }: { slot: Slot; half: string; tz: string; label: string; now: RailNow | null; slim?: boolean }) {
  // U5.1 (D407): the rail covers the Timelines range (slot.view: business hours, 12 hours or 24 hours), with the time
  // outside working windows shaded, as the wide timeline does.
  const bounds = { start: slot.view.start, end: slot.view.end };
  const span = Math.max(1, ms(bounds.end) - ms(bounds.start));
  const pos = (iso: string) => (ms(iso) - ms(bounds.start)) / span;
  const posMs = (n: number) => (n - ms(bounds.start)) / span;
  const marks = hourMarks(bounds.start, bounds.end, tz);
  const laid = layoutEvents(slot.events.filter((p) => !p.event.allDay), bounds.start, bounds.end);
  return (
    <div className={`ruler${slim ? " slim" : ""}`} aria-label={`Timeline for ${label}, ${slotRange(slot, tz)}`} onDoubleClick={(e) => e.stopPropagation()}>
      {offHours(slot).map((o) => (
        <div key={`off-${o.start}`} className="r-off" style={{ top: pct(posMs(o.start)), height: pct(posMs(o.end) - posMs(o.start)) }} aria-hidden="true" />
      ))}
      {marks.map((m) => (
        <div key={m.label} className="r-hour" style={{ top: pct(m.at) }} aria-hidden="true">
          <span>{m.label.replace(/ (AM|PM)$/, "")}</span>
        </div>
      ))}
      <div className="r-lanes">
      {slot.freeGaps.map((g) => {
        const at = rulerSpan(bounds, g.start, g.end);
        return at && (
          <div key={`f-${g.start}`} className="r-free" style={{ top: pct(at.top), height: pct(at.height) }} title={`Free · ${formatDuration(g.minutes)}`} aria-hidden="true">
            {g.minutes >= 45 && <span>{formatDuration(g.minutes)}</span>}
          </div>
        );
      })}
      {laid.map(({ placed, lane, lanes }) => {
        const at = rulerSpan(bounds, placed.clipStart, placed.clipEnd);
        return at && <RulerEvent key={placed.event.id} e={placed.event} tz={tz} style={{ top: pct(at.top), height: `max(${pct(at.height)}, 6px)`, left: `calc(${pct(lane / lanes)} + 2px)`, width: `calc(${pct(1 / lanes)} - 4px)` }} />;
      })}
      <TimeboxBands slot={slot} pos={pos} bounds={bounds} />
      <RulerPromises rail={{ key: `${slot.date}|${half}`, ...bounds }} tz={tz} />
      </div>
      {now && <NowPast at={now.past} />}
      {now?.at != null && <NowLine at={now.at} label={now.label} onClick={now.onClick} avoid=".r-hour span" />}
    </div>
  );
}

/**
 * CV-1: a promise due inside the rail's range, as a thin mark at its time. CV-3: past its due it is amber with a visible
 * "was due …" label; one overdue from an earlier day (or with no time) is drawn once at "now" on today's block. Never red.
 */
export function RulerPromises({ rail, tz }: { rail: RailSpan; tz: string }) {
  const { promises, onPromise, today, now, home } = useContext(RulerCtx);
  const span = Math.max(1, ms(rail.end) - ms(rail.start));
  return railMarks(promises, rail, { today, now, home }).map(({ p, at }) => {
    const time = p.dueAt ? Temporal.Instant.from(p.dueAt).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
    const was = p.overdue ? wasDueText(p, today, tz).replace(/^Was/, "was") : null;
    return (
      <button
        key={`promise-${p.key}`}
        type="button"
        className={`r-promise${p.overdue ? " overdue" : ""}`}
        style={{ top: pct((ms(at) - ms(rail.start)) / span) }}
        title={`Promise · ${was ?? time} · ${p.what}${p.toName ? ` · to ${p.toName}` : ""}`}
        aria-label={`${was ? `Promise, ${was}` : `Promise at ${time}`}: ${p.what}`}
        onClick={(e) => (e.stopPropagation(), onPromise?.(p.key))}
      >
        <span>{was ? `${was} · ${p.what}` : p.what}</span>
      </button>
    );
  });
}

function RulerEvent({ e, tz, style }: { e: CalEvent; tz: string; style: CSSProperties }) {
  const samples = useContext(SampleSources);
  const menu = useEventMenu(e);
  const kind = e.unavailable ? "unavailable" : e.isPersonal ? "personal" : "meeting";
  return (
    <div className={`r-ev ${kind}${e.calendar ? " linked" : ""} show-${e.showAs ?? "busy"}`} style={e.calendar ? ({ ...style, "--cal": e.calendar.color } as CSSProperties) : style} title={`${e.title}\n${eventRange(e, tz)} · ${e.unavailable ? "Unavailable" : sourceName(e, samples)} · ${showAsLabel(e)}`} {...menu}>
      <span>{e.title}</span>
    </div>
  );
}