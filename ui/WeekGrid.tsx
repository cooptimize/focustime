import { createContext, Fragment, useContext, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { TimeboxBands } from "./Timeboxes.tsx";
import { formatDuration } from "../week/format.ts";
import { worstSeverity } from "../week/risks.ts";
import type { CalEvent, Day, Half, PlacedEvent, Slot, Week } from "../week/types.ts";
import type { PtoDay } from "../week/pto.ts";
import type { Pick } from "../plan/types.ts";
import type { FollowUpView } from "../actions/types.ts";
import { wasDueText, weekDueBadges } from "../plan/due.ts";
import { homeRail, railMarks, type RailSpan } from "../plan/rail-promises.ts";
import { canAddWork, planButton } from "../plan/days.ts";
import { checkinMenu, dayMenu, eventMenu, slotMenu } from "./menu.ts";
import { MenuRow, useMenu } from "./Menus.tsx";
import { EyeIcon } from "./Watching.tsx";
import type { IsoDate } from "../week/types.ts";
import { PickRow } from "./PickRow.tsx";
import { DueBadge } from "./FollowUps.tsx";
import { hourMarks, labelHere, layoutEvents, rulerSpan, showRuler } from "./layout.ts";
import { DevOpsWork } from "./work.ts";
import { clientColor, eventRange, SampleSources, shortDate, shortRange, showAsLabel, slotRange, sourceName, startClock } from "./labels.ts";
import { cardHalves, eveOnly, slotOf } from "./halves.ts";
import { usePhone, type Layout } from "./viewport.ts";
import { cardPlan, clientFeatures, featuresLine, PlanCtx, storiesUnder, type PlanView } from "./planview.ts";
import { blockStatus } from "../plan/blockstatus.ts";
import { mondayOf } from "../week/dates.ts";

import { HalfScope } from "./scope.ts";
import { interactive } from "./DetailPanel.tsx";
import { userZone } from "../week/zone.ts";
import type { DayPromise } from "../plan/conversation-views.ts";
import { cardGroups } from "../plan/blockstories.ts";
import { TypeIcon } from "./TypeIcon.tsx";
import { pickDragged, useDragSource, useDropTarget } from "./WeekStories.tsx";
import { OriginPick, SuggestedCards, useIsOrigin } from "./Carry.tsx";
import { nowClock, nowSpot, type NowSpot } from "../plan/nowline.ts";
import { NowEdge, NowLine, NowPast } from "./NowLine.tsx";

/** UI-B: the now line for one rail: where it is (null when not on it), how much of the rail has passed, the time. */
type RailNow = { at: number | null; past: number; label: string; onClick: () => void };

export type Selection = { dayIndex: number; half: Half };
/** U3: where the detail panel opens: the features list, one follow-up or one pick. */
export type PanelFocus = { kind: "features" } | { kind: "followup"; id: number } | { kind: "pick"; id: number };

/** Step 15.1 (D276): the layout, for the time rail on each compact card (U3: always on, the one home for meetings). */
const RulerCtx = createContext<{ layout: Layout; promises: readonly DayPromise[]; onPromise?: (() => void) | undefined; today: string; now: string; home: RailSpan | null }>({ layout: "wide", promises: [], today: "", now: "", home: null });

type Props = {
  week: Week;
  colors: Record<string, string>;
  minFocusWindow: number;
  today: string;
  /** The clock (pinned by ?now=), for free time in a half-day under way. */
  now: string;
  selection: Selection;
  cellRefs: Map<string, HTMLDivElement>;
  onSelect: (s: Selection) => void;
  /** U3: opens the detail panel on a block (a click on the card body, its features line or a due badge, or Enter). */
  onOpen: (s: Selection, focus?: PanelFocus) => void;
  /** wide: hour timelines; medium: compact cards; narrow: the selected day only. */
  layout: Layout;
  /** Half-days as compact cards (medium, and narrow windows too thin for rail plus timeline). */
  compact: boolean;
  /** Plan the day: this day's column becomes the planning panel; the rest of the week is dimmed. */
  planDay?: { dayIndex: number; node: ReactNode } | undefined;
  /** Step 13.6: the day header's Plan button, "+ Add work" on a block and Friday's "Add hours" link. */
  onPlanDay?: ((date: string) => void) | undefined;
  onAddWork?: ((date: string, half: Half) => void) | undefined;
  onAddHours?: ((date: string) => void) | undefined;
  /** CV-1: my promises with a time, marked on the rail (overdue in amber). */
  promises?: readonly DayPromise[] | undefined;
  onPromise?: (() => void) | undefined;
  /** UI-8: the detail panel is open beside the grid; the grid keeps clear of it, so Friday stays visible and droppable. */
  panelOpen?: boolean | undefined;
};

export function WeekGrid(props: Props) {
  // CV-3: today's rails, for promises overdue from an earlier day (or with no time): drawn at "now" on today's block.
  const day = props.week.days.find((d) => d.date === props.today);
  const rails = day ? cardHalves(day).flatMap((h) => {
    const sl = slotOf(day, h)!;
    return sl.off ? [] : [{ key: `${day.date}|${h}`, start: sl.view.start, end: sl.view.end }];
  }) : [];
  const home = homeRail(rails, props.now);
  return (
    <RulerCtx.Provider value={{ layout: props.layout, promises: props.promises ?? [], onPromise: props.onPromise, today: props.today, now: props.now, home }}>
      <Grid {...props} />
    </RulerCtx.Provider>
  );
}

function Grid({ week, colors, minFocusWindow, today, now, selection, cellRefs, onSelect, onOpen, layout, compact, planDay, onPlanDay, onAddWork, onAddHours, panelOpen }: Props) {
  const pv = useContext(PlanCtx);
  // U3: due badges, each follow-up once in the week (on its day, an overdue one on today).
  const badges = weekDueBadges(
    week.days.map((d) => ({
      date: d.date,
      slots: cardHalves(d)
        .filter((h) => h !== "EVE")
        .map((h) => {
          const sl = slotOf(d, h)!;
          return { half: h, clientKey: sl.focus[0]?.clientKey ?? null, working: d.kind === "work" && !sl.off && !d.pto };
        }),
    })),
    pv.followUps ?? [],
    pv.today ?? today,
  );
  const column = (day: Day, i: number) =>
    planDay?.dayIndex === i ? (
      <div key={day.date} className="pd-cell">
        {planDay.node}
      </div>
    ) : (
    <DayColumn
      key={day.date}
      day={day}
      dayIndex={i}
      tz={userZone(week)}
      hasEve={week.days.some((d) => d.eve)}
      colors={colors}
      minFocusWindow={minFocusWindow}
      isToday={day.date === today}
      now={now}
      selection={selection}
      cellRefs={cellRefs}
      onSelect={onSelect}
      onOpen={onOpen}
      layout={layout}
      compact={compact}
      onPlanDay={onPlanDay}
      onAddWork={onAddWork}
      onAddHours={onAddHours}
      badges={badges}
    />
  );
  if (layout === "narrow") {
    const i = selection.dayIndex;
    const swipe = { x: 0, y: 0 };
    const go = (d: number) => onSelect({ dayIndex: Math.max(0, Math.min(week.days.length - 1, d)), half: selection.half });
    return (
      <main
        className="grid narrow"
        role="group"
        aria-label="Day view. Left and right arrows change the day, up and down pick the half-day, Enter opens details."
        // P1: on a touch screen a sideways swipe changes the day.
        onTouchStart={(e) => (swipe.x = e.touches[0]!.clientX, swipe.y = e.touches[0]!.clientY)}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0]!.clientX - swipe.x;
          const dy = e.changedTouches[0]!.clientY - swipe.y;
          if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 2 * Math.abs(dy)) go(i + (dx < 0 ? 1 : -1));
        }}
      >
        <nav className="daybar" aria-label="Day">
          <button type="button" className="day-step" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous day">
            <kbd>←</kbd>
          </button>
          <div className="day-tabs">
            {week.days.map((d, k) => (
              <button
                key={d.date}
                type="button"
                className={`day-tab ${k === i ? "current" : ""} ${d.date === today ? "today" : ""} kind-${d.kind}`}
                aria-current={k === i ? "date" : undefined}
                onClick={() => go(k)}
              >
                {d.weekday.slice(0, 3)}
                <span className="tab-date">{Temporal.PlainDate.from(d.date).day}</span>
              </button>
            ))}
          </div>
          <button type="button" className="day-step" onClick={() => go(i + 1)} disabled={i === week.days.length - 1} aria-label="Next day">
            <kbd>→</kbd>
          </button>
        </nav>
        {column(week.days[i]!, i)}
      </main>
    );
  }
  // Work days are full width, Friday and weekend days lighter. While planning, the planned day's track widens and
  // the other days stay visible behind a dim.
  const light = layout === "medium" ? (planDay ? "minmax(150px, 0.6fr)" : "minmax(190px, 0.6fr)") : "minmax(0, 0.6fr)";
  const tracks = week.days.map((d, i) => (planDay?.dayIndex === i ? "minmax(0, 2.6fr)" : d.kind === "work" ? "minmax(0, 1fr)" : light)).join(" ");
  const hasEve = week.days.some((d) => d.eve);
  return (
    <main
      className={`grid ${layout} ${planDay ? "planning" : ""} ${hasEve ? "has-eve" : ""}${panelOpen ? " with-panel" : ""}`}
      style={{ gridTemplateColumns: tracks }}
      role="group"
      aria-label="Week grid. Arrow keys move between half-days, Enter opens details."
    >
      {week.days.map(column)}
    </main>
  );
}

/** P1: how far a finger moves sideways, in CSS px, to change the day. */
const SWIPE_PX = 50;

/** U3: a whole day in one cell: a PTO day (hatched) or a day with no working hours (Friday's dashed catch-up). */
type Whole = "pto" | "catchup" | null;

function wholeDay(day: Day): Whole {
  if (day.pto) return "pto";
  if (day.kind !== "work" && day.am.off && day.pm.off && !day.eve) return "catchup";
  return null;
}

function DayColumn(props: { day: Day; dayIndex: number; tz: string; isToday: boolean; hasEve: boolean; badges: ReadonlyMap<string, FollowUpView[]> } & Omit<Props, "week" | "today">) {
  const { colors, minFocusWindow, compact } = props;
  const { day, dayIndex, tz, isToday } = props;
  const overflow = day.kind === "overflow";
  const menu = useMenu((env) => dayMenu(env, day.date));
  const halves = cardHalves(day);
  const pv = useContext(PlanCtx);
  const whole = wholeDay(day);
  // Medium layout shares rows across days: a day without a card in a row keeps an empty cell there.
  // An evening-only day (a weekend flex session) gets one card spanning the three rows.
  const rows: (typeof halves[number] | null)[] = props.layout === "medium" && props.hasEve && !eveOnly(day) && !day.eve ? [...halves, null] : halves;
  // Step 13.6 (D240); U3: a Plan chip only on a day not planned yet; Friday's Add hours link; or nothing.
  const dayPlan = pv.week?.[day.date];
  const btn = planButton({
    date: day.date,
    today: pv.today ?? "",
    pto: !!day.pto,
    hasHours: !(day.am.off && day.pm.off && (!day.eve || day.eve.off)) || day.flexMinutes > 0,
    committed: !!dayPlan?.committedAt,
    hasPicks: (dayPlan?.picks ?? []).some((p) => p.status === "planned" || p.status === "done"),
  });
  const daySelected = props.selection.dayIndex === dayIndex;
  const refFor = (half: Half) => (el: HTMLDivElement | null) => {
    const k = `${dayIndex}${half}`;
    if (el) props.cellRefs.set(k, el);
    else props.cellRefs.delete(k);
  };
  const dayLabel = `${day.weekday} ${shortDate(day.date)}`;
  // UI-B: today's now line (null on any other day, so on other weeks too), in the person's zone.
  const spot: NowSpot | null = isToday ? nowSpot(day, props.now, tz, !!whole) : null;
  const nowLabel = spot ? nowClock(props.now, tz) : "";
  const toNow = () => props.onSelect({ dayIndex, half: spot?.kind === "rail" ? spot.half : "AM" });
  const railNow = (half: Half): RailNow | null => {
    if (!spot) return null;
    const s = slotOf(day, half);
    if (!s) return null;
    // Before the day the line sits on the top edge of the first rail, after it on the bottom edge of the last, so the
    // column's layout never changes.
    const last = day.eve ? "EVE" : "PM";
    const on = spot.kind === "rail" && spot.half === half ? spot.at : spot.kind === "before" && half === "AM" ? 0 : spot.kind === "after" && half === last ? 1 : null;
    const ended = Temporal.Instant.compare(Temporal.Instant.from(props.now), Temporal.Instant.from(s.view.end)) >= 0;
    return { at: on, past: ended ? 1 : spot.kind === "rail" && spot.half === half ? spot.at : 0, label: nowLabel, onClick: toNow };
  };

  return (
    <section className={`day ${overflow ? "overflow" : day.kind === "weekend" ? "weekend overflow" : "work"} ${isToday ? "today" : ""} ${day.pto ? "pto-full" : ""}${daySelected ? " sel-day" : ""}`} aria-label={`${dayLabel}${day.pto ? `, ${ptoLabel(day.pto)}` : ""}`}>
      <header className="day-head" onContextMenu={menu.onContextMenu}>
        <span className="dow">{day.weekday}</span>
        <span className="date">{shortDate(day.date)}</span>
        {isToday && <span className="today-pill">Today</span>}
        {day.pto && (
          <span className="pto-pill" title={ptoLabel(day.pto)}>
            PTO
          </span>
        )}
        <span className="day-gap" />
        {btn === "plan" ? (
          <button type="button" className="day-plan plan" onClick={() => props.onPlanDay?.(day.date)} title="Plan this day">
            Plan
          </button>
        ) : btn === "add_hours" ? (
          <button type="button" className="day-addhours" onClick={() => props.onAddHours?.(day.date)} title="Friday has catch-up work but no working hours">
            Add hours
          </button>
        ) : null}
        {/* In the Tab order only for the selected day (Shift+Tab from its half-day reaches it); shown on hover and focus. */}
        <HalfScope.Provider value={daySelected}>{menu.button(`Actions for ${dayLabel}`)}</HalfScope.Provider>
      </header>

      {/* U5.1 (D406): one chip per day an all-day event covers, PTO and Catch-up days too; the chip is its one home. */}
      <AllDay events={day.allDay} />
      <OutLine kind="early" items={whole ? [] : day.early.map((p) => p.event)} tz={tz} />

      {whole ? (
        <WholeDay
          day={day}
          kind={whole}
          tz={tz}
          selected={daySelected}
          refAm={refFor("AM")}
          refPm={refFor("PM")}
          onOpen={(focus) => props.onOpen({ dayIndex, half: "AM" }, focus)}
          dayLabel={dayLabel}
          now={spot?.kind === "whole" ? { at: spot.at, label: nowLabel, onClick: toNow } : null}
        />
      ) : (
        rows.map((half, k) =>
          half === null ? (
            <div key={`gap-${k}`} className="half-gap" aria-hidden="true" />
          ) : (
            <HalfDay
              key={half}
              slot={slotOf(day, half)!}
              overflow={overflow || day.kind === "weekend"}
              span={eveOnly(day)}
              tz={tz}
              colors={colors}
              minFocusWindow={minFocusWindow}
              selected={daySelected && props.selection.half === half}
              refFn={refFor(half)}
              onSelect={() => props.onSelect({ dayIndex, half })}
              onOpen={(focus) => props.onOpen({ dayIndex, half }, focus)}
              dayLabel={dayLabel}
              compact={compact}
              now={props.now}
              isToday={isToday}
              dueBadges={props.badges.get(`${day.date}:${half}`) ?? []}
              earlier={new Set(half === "PM" ? day.am.events.map((p) => p.event.id) : half === "EVE" ? day.pm.events.map((p) => p.event.id) : [])}
              railNow={railNow(half)}
              addWork={props.onAddWork && canAddWork({ date: day.date, today: pv.today ?? "", pto: !!day.pto, off: slotOf(day, half)!.off }) ? () => props.onAddWork!(day.date, half) : undefined}
            />
          ),
        )
      )}

      <OutLine kind="late" items={whole ? [] : day.evening.map((p) => p.event)} tz={tz} />
    </section>
  );
}

/** U3: all-day events as chips under the day header, only when there are some (the row stays for alignment); two or more stack. */
function AllDay({ events }: { events: readonly CalEvent[] }) {
  const samples = useContext(SampleSources);
  return (
    <div className={`day-allday${events.length ? "" : " empty"}`}>
      {events.map((e) => (
        <span key={e.id} className={`chip ${e.unavailable ? "unavailable" : e.isPersonal ? "personal" : "meeting"}`} title={`${e.title} · all day · ${sourceName(e, samples)}`}>
          {e.title}
        </span>
      ))}
    </div>
  );
}

/** U3: events before or after the hours shown, as one small line at the top or bottom of the column, only when present. */
function OutLine({ kind, items, tz }: { kind: "early" | "late"; items: readonly CalEvent[]; tz: string }) {
  const samples = useContext(SampleSources);
  return (
    <div className={`day-out ${kind}${items.length ? "" : " empty"}`}>
      {items.map((e, i) => (
        <span key={e.id} className={e.isPersonal ? "personal" : undefined} title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e, samples)}`}>
          {i > 0 && " · "}
          <span className="out-time">{startClock(e.start, tz)}</span> <span className="ev-title">{e.title}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * U3 (D387): a PTO day is one hatched cell labeled PTO, with its timed calendar items as plain lines (all-day ones are chips, D406); a day with no working
 * hours (Friday) is one dashed "Catch-up" column with the work moved there and its calendar items.
 */
function WholeDay({ day, kind, tz, selected, refAm, refPm, onOpen, dayLabel, now }: { day: Day; kind: "pto" | "catchup"; tz: string; selected: boolean; refAm: (el: HTMLDivElement | null) => void; refPm: (el: HTMLDivElement | null) => void; onOpen: (focus?: PanelFocus) => void; dayLabel: string; now: { at: number; label: string; onClick: () => void } | null }) {
  const plan = useContext(PlanCtx);
  const samples = useContext(SampleSources);
  // All-day events are chips under the day header (D406); the cell lists only timed events.
  const events = [...day.early, ...day.am.events, ...day.pm.events, ...day.evening].map((p) => ({ e: p.event, start: p.event.start }));
  const seen = new Set<string>();
  const lines = events.filter(({ e }) => !seen.has(e.id) && !!seen.add(e.id));
  const picks = kind === "catchup" ? [...catchUp(plan.week, day.am), ...catchUp(plan.week, day.pm)] : [];
  const label = kind === "pto" ? "PTO" : "Catch-up";
  // PV-1: the whole day is one drop target (PTO refuses it; catch-up takes it with no fit).
  const drop = useDropTarget({ date: day.date, half: "AM" });
  return (
    <div
      ref={(el) => (refAm(el), refPm(el))}
      {...drop.props}
      className={`half whole ${kind}${selected ? " selected" : ""}${drop.cls}`}
      tabIndex={selected ? 0 : -1}
      role="button"
      aria-label={`${dayLabel}, ${kind === "pto" ? ptoLabel(day.pto!) : "catch-up, no working hours"}`}
      aria-pressed={selected}
      onClick={(e) => !interactive(e) && onOpen()}
    >
      {now && <NowLine at={now.at} label={now.label} thin onClick={now.onClick} />}
      <div className="whole-label" title={kind === "pto" && day.pto ? ptoLabel(day.pto) : undefined}>
        {label}
      </div>
      {drop.tip}
      {picks.length > 0 && <CardPicks picks={picks} label={`Catch-up work for ${dayLabel}`} tabIndex={selected ? 0 : -1} />}
      {lines.length > 0 && (
        <ul className="whole-lines">
          {lines.map(({ e }) => (
            <li key={e.id} className={e.isPersonal ? "personal" : undefined} title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e, samples)}`}>
              <span className="out-time">{startClock(e.start, tz)}</span> <span className="ev-title">{e.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type HalfProps = {
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
  now: string;
  /** Done picks stay visible on today; on other days they collapse to "N done". */
  isToday: boolean;
  /** Follow-ups due this week to badge on this card (U3). */
  dueBadges: readonly FollowUpView[];
  /** "+ Add work" (step 13.6): opens Plan the day on this block's picker. Absent where work can't be added. */
  addWork?: (() => void) | undefined;
  /** UI-B: today's now line on this block's rail; null on other days. */
  railNow: RailNow | null;
};


function HalfDay({ earlier, slot, colors, minFocusWindow, overflow, span, tz, selected, dayLabel, refFn, onSelect, onOpen, compact, now, isToday, dueBadges, addWork, railNow }: HalfProps) {
  const primary = slot.focus[0];
  const sev = worstSeverity(slot.risks);
  const allWork = useContext(DevOpsWork);
  const plan = useContext(PlanCtx);
  const work = primary && !overflow ? allWork.get(primary.clientKey) : undefined;
  const eve = slot.half === "EVE";
  const cp = cardPlan(plan.week, slot, primary?.clientKey ?? null, work?.items ?? [], now, plan.sizes, plan.timeboxes);
  // Step 13.6 (D238): Friday's catch-up work shows on its card even though Friday is never committed.
  const ticks = overflow && !eve && !cp.picks.length ? catchUp(plan.week, slot) : cp.picks;
  // U3: on days other than today, done picks collapse to "N done".
  const doneHidden = isToday ? [] : ticks.filter((p) => p.status === "done");
  // UI-B: on a day that has passed, a pick kept or moved on from here stays as a dimmed "→ moved to Mon AM" line.
  const movedOn = slot.date < (plan.today ?? "") ? (plan.week?.[slot.date]?.picks ?? []).filter((p) => p.half === slot.half && p.status === "moved" && p.carriedTo) : [];
  const shown = [...(isToday ? ticks : ticks.filter((p) => p.status !== "done")), ...movedOn];
  const rc = useContext(RulerCtx);
  // P1: on the phone a card lists its meetings in words; no rail.
  const phone = usePhone();
  const ruler = compact && !phone && showRuler(rc.layout, slot);
  const style = { "--c": clientColor(primary?.clientKey, colors), ...(compact ? {} : { flexGrow: minutesOf(slot) }) } as CSSProperties;
  const state = eve ? "eve" : overflow ? "overflow" : slot.open ? "open" : slot.off ? "off" : "focus";
  const reasonsId = `reasons-${slot.date}-${slot.half}`;
  // S1 (D453): a PTO half reads PTO (its block, if any, stays in the data, read only).
  const ptoHalf = slot.pto && !eve;
  const name = ptoHalf ? "PTO" : primary ? primary.clientName : eve ? (slot.flex.length ? "Flex" : "Evening") : slot.off ? "No working hours" : overflow ? "Catch-up" : "Open";
  const label = `${dayLabel} ${eve ? "evening" : slot.half}, ${name}${sev ? `, ${sev === "at_risk" ? "at risk" : "watch"}` : ""}`;
  const menu = useMenu((env) => slotMenu(env, slot.date, slot.half, primary?.clientKey ?? null, primary?.clientName ?? null));
  const status = blockStatus(cp.fit, slot.risks);
  const pill = status.kind === "at_risk" ? `At risk${status.short ? ` · ${status.short}` : ""}` : status.label;
  // PV-1: a drop target for stories dragged from the panel or another block (not the evening).
  const drop = useDropTarget(eve ? null : { date: slot.date, half: slot.half });

  // U3: one line for the client's features this week: "3 features · 1 needs stories", opening the panel there.
  const feats = !eve && (slot.half === "AM" || slot.half === "PM") ? clientFeatures(plan.weekFeatures ?? [], mondayOf(slot.date), primary?.clientKey ?? null) : [];
  const needs = feats.filter((f) => !storiesUnder(work, f.itemId).length).length;
  const featLine = featuresLine(feats.length, needs);

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
      {/* UI-B: with no rail (the phone, a card too narrow for one), the now line sits at the top of the block under way. */}
      {compact && !ruler && railNow?.at != null && <NowEdge label={railNow.label} onClick={railNow.onClick} />}
      <div className="card-head">
        <span className="swatch" aria-hidden="true" />
        <span className={`card-client${primary ? "" : " open-label"}`} title={name}>{name}</span>
        <span className="card-when">{shortRange(slot, tz)}</span>
        <span className="card-more">{menu.button(`Actions for ${dayLabel} ${slot.half}`)}</span>
      </div>
      {drop.tip}
      {status.kind !== "none" && (
        <div className="card-status">
          <span className={`status-pill ${status.kind}`} id={reasonsId} title={status.detail ?? undefined}>
            {pill}
          </span>
        </div>
      )}
      {slot.focus.slice(1).map((b) => (
        <div key={b.id} className="also" style={{ "--c2": clientColor(b.clientKey, colors) } as CSSProperties}>
          <span className="swatch small" />
          Also booked: {b.clientName}
        </div>
      ))}
      {dueBadges.length > 0 && (
        <div className="card-due">
          {dueBadges.map((f) => (
            <button key={f.id} type="button" className="due-open" tabIndex={selected ? 0 : -1} onClick={(e) => (e.stopPropagation(), onOpen({ kind: "followup", id: f.id }))} title={`Follow-up${f.hasWho ? ` to ${f.who}` : ""}: ${f.what}`}>
              <DueBadge l={f} />
            </button>
          ))}
        </div>
      )}
      {flexList}
      {phone && slot.events.length > 0 && (
        <ul className="card-events" aria-label={`Meetings and events, ${dayLabel} ${slot.half}`}>
          {slot.events.map((p) => (
            <li key={p.event.id} className={p.event.isPersonal ? "personal" : p.event.unavailable ? "unavailable" : undefined}>
              <span className="ce-time">{startClock(p.clipStart, tz)}–{startClock(p.clipEnd, tz)}</span>
              <span className="ce-title">{p.event.title}</span>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && <CardPicks picks={shown} label={`Plan for ${dayLabel} ${slot.half}`} tabIndex={selected ? 0 : -1} />}
      {!eve && <SuggestedCards date={slot.date} half={slot.half} tabIndex={selected ? 0 : -1} />}
      {!eve && <CheckinChips date={slot.date} half={slot.half as "AM" | "PM"} tabIndex={selected ? 0 : -1} />}
      {doneHidden.length > 0 && <div className="card-done">{doneHidden.length} done</div>}
      {addWork && !phone && (
        <button
          type="button"
          className="add-work"
          tabIndex={selected ? 0 : -1}
          title="Add work to this block (A)"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
            addWork();
          }}
        >
          + Add work
        </button>
      )}
      {featLine && (
        <button type="button" className={`card-feats${needs ? " needs" : ""}`} tabIndex={selected ? 0 : -1} onClick={(e) => (e.stopPropagation(), onOpen({ kind: "features" }))} title="This week's features for this client">
          {featLine.split(" · ")[0]}
          {needs > 0 && <span className="needs"> · {featLine.split(" · ")[1]}</span>}
        </button>
      )}
    </div>
  );

  return (
    <div
      ref={refFn}
      {...drop.props}
      className={`half ${state}${ptoHalf ? " pto-half" : ""} ${span ? "span-all" : ""} ${sev ?? ""} ${selected ? "selected" : ""} ${compact ? "card" : ""}${ruler ? " has-ruler" : ""}${drop.cls}`}
      style={style}
      tabIndex={selected ? 0 : -1}
      role="button"
      aria-label={label}
      aria-describedby={status.kind !== "none" ? reasonsId : undefined}
      aria-pressed={selected}
      onClick={(e) => {
        if (interactive(e)) return;
        const pick = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
        onOpen(pick ? { kind: "pick", id: Number(pick.dataset.pick) } : undefined);
      }}
      onContextMenu={(e) => {
        onSelect();
        menu.onContextMenu(e);
      }}
    >
      <HalfScope.Provider value={selected}>
        {compact ? (
          <>
            {body}
            {ruler && <Ruler slot={slot} half={eve ? "EVE" : slot.half} tz={tz} label={`${dayLabel} ${eve ? "evening" : slot.half}`} now={railNow} />}
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
 * PV-1: a card's picks under small feature headers (type icon, short title), the story's type icon on each line;
 * picks with no feature under "No feature". Headers show only when some pick has a feature. Planned DevOps stories drag
 * to another block.
 */
function CardPicks({ picks, label, tabIndex }: { picks: readonly Pick[]; label: string; tabIndex: number }) {
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
function CheckinChips({ date, half, tabIndex }: { date: IsoDate; half: "AM" | "PM"; tabIndex: number }) {
  const plan = useContext(PlanCtx);
  const here = (plan.checkins ?? []).filter((c) => c.date === date && c.half === half);
  if (!here.length) return null;
  return (
    <ul className="checkin-chips" aria-label="Check-ins">
      {here.map((c) => (
        <MenuRow key={`${c.clientKey}:${c.itemId}`} build={(env) => checkinMenu(env, c)} label={`More for the check-in on ${c.title}`} className="checkin-chip" title={`Watching ${c.title}: a ${c.minutes}-minute check-in. It becomes a pick when this day is planned`}>
          <EyeIcon />
          <span className="cc-word">Check-in</span>
          <span className="cc-title" tabIndex={tabIndex}>{c.title}</span>
          <span className="cc-min">{c.minutes}m</span>
        </MenuRow>
      ))}
    </ul>
  );
}

function CardPick({ pick, tabIndex }: { pick: Pick; tabIndex: number }) {
  const plan = useContext(PlanCtx);
  const drag = useDragSource(pickDragged(pick));
  return <PickRow pick={pick} toggle={plan.toggle} density="week" tabIndex={tabIndex} typeIcon dragProps={drag} />;
}

/** Picks moved to the overflow day (step 13.6, D238): planned and done ones, committed or not. */
function catchUp(week: PlanView["week"], slot: Slot): Pick[] {
  return (week?.[slot.date]?.picks ?? []).filter((p) => p.half === slot.half && (p.status === "planned" || p.status === "done"));
}

export function ptoLabel(p: PtoDay): string {
  return `PTO · ${p.titles.join(", ")}`;
}

/** Card height follows the minutes its timeline shows (the view range), so cards line up across days. */
function minutesOf(slot: Slot): number {
  return Math.max(30, (Temporal.Instant.from(slot.view.end).epochMilliseconds - Temporal.Instant.from(slot.view.start).epochMilliseconds) / 60000);
}

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;

/** The parts of the view outside working windows (before and after hours, lunch), shaded on the timeline. */
function offHours(slot: Slot): { start: number; end: number }[] {
  const [a, b] = [ms(slot.view.start), ms(slot.view.end)];
  const out: { start: number; end: number }[] = [];
  let t = a;
  for (const w of [...slot.windows].sort((x, y) => ms(x.start) - ms(y.start))) {
    const [ws, we] = [Math.max(a, ms(w.start)), Math.min(b, ms(w.end))];
    if (ws > t) out.push({ start: t, end: ws });
    t = Math.max(t, we);
  }
  if (t < b) out.push({ start: t, end: b });
  return out;
}

function Timeline({ slot, tz, showGaps, minFocusWindow, earlier, now }: { slot: Slot; tz: string; showGaps: boolean; minFocusWindow: number; earlier: ReadonlySet<string>; now: RailNow | null }) {
  const { start, end } = slot.view;
  const marks = hourMarks(start, end, tz);
  const laid = layoutEvents(slot.events, start, end);
  const min = minFocusWindow;
  const span = Math.max(1, ms(end) - ms(start));
  const posMs = (n: number) => (n - ms(start)) / span;
  const pos = (s: string) => posMs(ms(s));

  return (
    <div className="timeline">
      {offHours(slot).map((o) => (
        <div key={o.start} className="offhours" style={{ top: pct(posMs(o.start)), height: pct(posMs(o.end) - posMs(o.start)) }} aria-hidden="true" />
      ))}
      {slot.flex.map((f) => (
        <div key={`flex-${f.id}`} className="flexband" style={{ top: pct(pos(f.start)), height: pct(pos(f.end) - pos(f.start)) }} title={`Flex session · ${f.clientKey}`} aria-hidden="true" />
      ))}
      {marks.map((m) => (
        <div key={m.label} className="hour" style={{ top: pct(m.at) }}>
          <span>{m.label}</span>
        </div>
      ))}
      {showGaps &&
        slot.freeGaps
          .filter((g) => g.minutes >= min)
          .map((g) => (
            <div key={g.start} className="gap" style={{ top: pct(pos(g.start)), height: pct(pos(g.end) - pos(g.start)) }}>
              <span>{formatDuration(g.minutes)} free</span>
            </div>
          ))}
      <TimeboxBands slot={slot} pos={pos} />
      {now && <NowPast at={now.past} />}
      <div className="lanes">
        {laid.map(({ placed, top, height, lane, lanes }) => (
          <EventCard key={placed.event.id} placed={placed} tz={tz} label={labelHere(placed, earlier)} style={{ top: pct(top), height: pct(height), left: `calc(${pct(lane / lanes)} + 4px)`, width: `calc(${pct(1 / lanes)} - 8px)` }} />
        ))}
      </div>
      {now?.at != null && <NowLine at={now.at} label={now.label} onClick={now.onClick} />}
    </div>
  );
}

/**
 * Step 15.1 (D276): a narrow time ruler on the right edge of a compact card, covering only the block's working hours:
 * free stretches, meetings, personal events and unavailable time, and timed picks as bands in client color. A pick
 * band opens the time editor; an event opens its menu. The list on the left is unchanged.
 */
function Ruler({ slot, half, tz, label, now }: { slot: Slot; half: string; tz: string; label: string; now: RailNow | null }) {
  // U5.1 (D407): the rail covers the Timelines range (slot.view: business hours, 12 hours or 24 hours), with the time
  // outside working windows shaded, as the wide timeline does.
  const bounds = { start: slot.view.start, end: slot.view.end };
  const span = Math.max(1, ms(bounds.end) - ms(bounds.start));
  const pos = (iso: string) => (ms(iso) - ms(bounds.start)) / span;
  const posMs = (n: number) => (n - ms(bounds.start)) / span;
  const marks = hourMarks(bounds.start, bounds.end, tz);
  const laid = layoutEvents(slot.events.filter((p) => !p.event.allDay), bounds.start, bounds.end);
  return (
    <div className="ruler" aria-label={`Timeline for ${label}, ${slotRange(slot, tz)}`} onDoubleClick={(e) => e.stopPropagation()}>
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
function RulerPromises({ rail, tz }: { rail: RailSpan; tz: string }) {
  const { promises, onPromise, today, now, home } = useContext(RulerCtx);
  const span = Math.max(1, ms(rail.end) - ms(rail.start));
  return railMarks(promises, rail, { today, now, home }).map(({ p, at }) => {
    const time = p.dueAt ? Temporal.Instant.from(p.dueAt).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
    const was = p.overdue ? wasDueText(p, today, tz).replace(/^Was/, "was") : null;
    return (
      <button
        key={`promise-${p.id}`}
        type="button"
        className={`r-promise${p.overdue ? " overdue" : ""}`}
        style={{ top: pct((ms(at) - ms(rail.start)) / span) }}
        title={`Promise · ${was ?? time} · ${p.what}${p.toName ? ` · to ${p.toName}` : ""}`}
        aria-label={`${was ? `Promise, ${was}` : `Promise at ${time}`}: ${p.what}`}
        onClick={(e) => (e.stopPropagation(), onPromise?.())}
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
    <div className={`r-ev ${kind} show-${e.showAs ?? "busy"}`} style={style} title={`${e.title}\n${eventRange(e, tz)} · ${e.unavailable ? "Unavailable" : sourceName(e, samples)} · ${showAsLabel(e)}`} {...menu}>
      <span>{e.title}</span>
    </div>
  );
}

/** Step 13: any calendar event opens its menu (click, right-click, Enter): only what its tier allows is enabled. */
export function useEventMenu(e: CalEvent) {
  const menu = useMenu((env) => eventMenu(env, e));
  const live = !e.unavailable && e.source !== "focustime";
  const open = (ev: ReactMouseEvent | KeyboardEvent) => {
    ev.stopPropagation();
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    menu.onContextMenu({ preventDefault: () => ev.preventDefault(), stopPropagation() {}, currentTarget: el, type: "contextmenu", clientX: "clientX" in ev ? ev.clientX : r.left + 8, clientY: "clientY" in ev ? ev.clientY : r.bottom } as never);
  };
  return live
    ? { role: "button" as const, tabIndex: -1, onClick: open, onContextMenu: open, onKeyDown: (ev: KeyboardEvent) => (ev.key === "Enter" || ev.key === "ContextMenu") && (ev.preventDefault(), open(ev)), onDoubleClick: (ev: ReactMouseEvent) => ev.stopPropagation() }
    : {};
}

function EventCard({ placed, tz, style, label = true }: { placed: PlacedEvent; tz: string; style: CSSProperties; label?: boolean }) {
  const e = placed.event;
  const samples = useContext(SampleSources);
  const kind = e.isPersonal ? "personal" : "meeting";
  const show = e.showAs ?? "busy";
  const menu = useEventMenu(e);
  return (
    <div
      className={`event ${e.unavailable ? "unavailable" : kind} show-${show} ${placed.continuesBefore ? "cont-before" : ""} ${placed.continuesAfter ? "cont-after" : ""}`}
      style={style}
      title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e, samples)} · ${showAsLabel(e)}${e.unavailable ? "" : "\nClick for what FocusTime can do with it"}`}
      {...menu}
    >
      {label && <><span className="ev-line">
        <span className="ev-time">{eventRange(e, tz)}</span>
        <span className="ev-title">{e.title}</span>
      </span>
      <span className="ev-meta">
        {e.unavailable ? "Unavailable" : sourceName(e, samples)}
        {show !== "busy" && show !== "unknown" ? ` · ${showAsLabel(e)}` : ""}
      </span></>}
    </div>
  );
}

const pct = (f: number) => `${(f * 100).toFixed(3)}%`;
