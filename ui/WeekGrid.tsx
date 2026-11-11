// Week's grid: the days as columns, each with its blocks (ui/BlockCard.tsx), PTO and catch-up days as one cell, the
// weekend's quiet column, the Evening band and folded days (WK-1 to WK-3). WD-1: a day's header selects its first
// block and opens the Add work panel; there is no Plan chip and no planning column any more.
import { useContext, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { callMarks, MeetingCalls, useMine } from "./meetings/calls.ts";
import { liveOf, useCoworkData } from "./cowork.tsx";
import { liveCallCard, type CoworkChatView } from "../plan/cowork.ts";
import { worstSeverity } from "../week/risks.ts";
import type { CalEvent, Day, Half, Week } from "../week/types.ts";
import type { PtoDay } from "../week/pto.ts";
import type { FollowUpView } from "../actions/types.ts";
import { weekDueBadges } from "../plan/due.ts";
import { homeRail, lateOnCards, type CardRail } from "../plan/rail-promises.ts";
import { canAddWork, planButton } from "../plan/days.ts";
import { bandIds, eveningBand, weekendRows, type EveningBand } from "../plan/evening.ts";
import { dayMenu } from "./menu.ts";
import { useMenu } from "./Menus.tsx";
import type { IsoDate } from "../week/types.ts";
import { DueBadge } from "./FollowUps.tsx";
import { dayShare, weekFit, type Tier } from "./weekfit.ts";
import { clientColor, eventRange, SampleSources, shortDate, shortRange, sourceName, startClock } from "./labels.ts";
import { cardHalves, eveOnly, slotOf } from "./halves.ts";
import { type Layout } from "./viewport.ts";
import { PlanCtx } from "./planview.ts";
import { HalfScope } from "./scope.ts";
import { interactive } from "./DetailPanel.tsx";
import { userZone } from "../week/zone.ts";
import type { RailItem } from "../plan/inbox-items.ts";
import { useDropTarget } from "./WeekStories.tsx";
import { nowClock, nowSpot, type NowSpot } from "../plan/nowline.ts";
import { NowLine } from "./NowLine.tsx";
import { railNowOf, type RailNow } from "./Timeline.tsx";
import { LiveOnCard, RulerCtx, TierCtx, TimelineCtx, type PanelFocus, type Selection } from "./weekctx.ts";
import { BlockCard, CardPick, CardPicks } from "./BlockCard.tsx";
export type { PanelFocus, Selection } from "./weekctx.ts";
export { CardWhen, LateChip, RulerPromises } from "./BlockCard.tsx";

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
  /** WD-1: a click on a day's header (its first block, with the Add work panel); "+ Add" on a block; Friday's "Add hours" link. */
  onDayHead?: ((date: string) => void) | undefined;
  onAddWork?: ((date: string, half: Half) => void) | undefined;
  onAddHours?: ((date: string) => void) | undefined;
  /** CV-1: my promises with a time, marked on the rail (overdue in amber). IB-1 slice 4: the Inbox's rows (inbox.today); a click opens that item in the Inbox. */
  promises?: readonly RailItem[] | undefined;
  onPromise?: ((key: string) => void) | undefined;
  /** UI-9: a card's "N late" chip with several: the Inbox's Promises, late ones, for that client (null: the card's are several clients'). */
  onLate?: ((clientKey: string | null) => void) | undefined;
  /** UI-8: the detail panel is open beside the grid; the grid keeps clear of it, so Friday stays visible and droppable. */
  panelOpen?: boolean | undefined;
  /** WK-2: the Timeline toggle (default shown). Hidden, every card is a full-width list with its meetings as lines. */
  timeline?: boolean | undefined;
};

export function WeekGrid(props: Props) {
  // CV-3: today's rails, for promises overdue from an earlier day (or with no time): drawn at "now" on today's block.
  const day = props.week.days.find((d) => d.date === props.today);
  const rails = day ? cardHalves(day).flatMap((h) => {
    const sl = slotOf(day, h)!;
    return sl.off ? [] : [{ key: `${day.date}|${h}`, start: sl.view.start, end: sl.view.end }];
  }) : [];
  const home = homeRail(rails, props.now);
  // UI-9: each card's late promises, placed as the rail places them but only on a card booked for their client.
  const cardRails: CardRail[] = props.week.days.flatMap((d) =>
    d.pto ? [] : cardHalves(d).flatMap((h) => {
      const sl = slotOf(d, h)!;
      return sl.off || sl.pto ? [] : [{ key: `${d.date}|${h}`, date: d.date, start: sl.view.start, end: sl.view.end, clients: sl.focus.map((f) => f.clientKey) }];
    }),
  );
  const late = lateOnCards(props.promises ?? [], cardRails, { today: props.today, now: props.now });
  // MC-1: the registered client calls I review or attend, marked on the card they start in.
  const mine = useMine();
  // CW-1: a call live in a client's delivery chat, on that client's first card today that hasn't ended.
  const cowork = useCoworkData();
  const liveOn = new Map<string, CoworkChatView[]>();
  const todayCards = cardRails.filter((c) => c.date === props.today).map((c) => ({ key: c.key, clientKey: c.clients[0] ?? null, start: c.start, end: c.end }));
  for (const k of new Set((cowork?.chats ?? []).filter((c) => c.live).map((c) => c.clientKey))) {
    const at = liveCallCard(todayCards, k, props.now);
    if (at) liveOn.set(at, [...(liveOn.get(at) ?? []), ...liveOf(cowork, k)]);
  }
  return (
    <RulerCtx.Provider value={{ layout: props.layout, promises: props.promises ?? [], onPromise: props.onPromise, onLate: props.onLate, today: props.today, now: props.now, home, late }}>
      <MeetingCalls.Provider value={callMarks(mine)}>
        <LiveOnCard.Provider value={liveOn}>
          <TimelineCtx.Provider value={props.timeline ?? true}>
            <Grid {...props} />
          </TimelineCtx.Provider>
        </LiveOnCard.Provider>
      </MeetingCalls.Provider>
    </RulerCtx.Provider>
  );
}

function Grid({ week, colors, minFocusWindow, today, now, selection, cellRefs, onSelect, onOpen, layout, compact: compactIn, onDayHead, onAddWork, onAddHours, panelOpen, timeline = true }: Props) {
  // WK-2: with the timeline hidden every layout draws compact cards (no hour timeline beside them).
  const compact = compactIn || !timeline;
  const pv = useContext(PlanCtx);
  const ref = useRef<HTMLElement>(null);
  const box = useGridBox(ref, layout === "medium");
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
  const column = (day: Day, i: number, own?: { tier: Tier; railPx: number }) => (
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
      onDayHead={onDayHead}
      onAddWork={onAddWork}
      onAddHours={onAddHours}
      badges={badges}
      own={own}
      grow={!compactIn}
      band={eveningBand(day, week, pv.week?.[day.date]?.picks ?? [])}
    />
  );
  if (layout === "narrow") {
    const i = selection.dayIndex;
    const swipe = { x: 0, y: 0 };
    const go = (d: number) => onSelect({ dayIndex: Math.max(0, Math.min(week.days.length - 1, d)), half: selection.half });
    return (
      <main
        className={`grid narrow${timeline ? "" : " no-timeline"}`}
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
  // Work days are full width; Friday, weekend days and PTO days lighter (WK-1: never wider than a working day). While
  // planning, the planned day's track widens and the other days stay visible behind a dim. WK-1: in the medium layout
  // the tier and any folding come from the grid's real width (weekfit.ts).
  const hasEve = week.days.some((d) => d.eve);
  const shares = week.days.map((d) => dayShare(d, false));
  const fit = box && layout === "medium" ? weekFit({ contentPx: box.content, gapPx: box.gap, scale: box.scale, shares, selected: selection.dayIndex }) : null;
  const tracks = fit?.tracks ?? shares.map((s) => `minmax(0, ${s}fr)`).join(" ");
  const firstOpen = fit ? fit.open.indexOf(true) : 0;
  // WK-2: each open column draws the tier of its own width (Friday and PTO days too); the grid's class keeps the
  // working days' tier.
  return (
    <TierCtx.Provider value={layout === "medium" ? fit?.tier ?? "rail" : null}>
      <main
        ref={ref}
        className={`grid ${layout} ${hasEve ? "has-eve" : ""}${panelOpen ? " with-panel" : ""}${layout === "medium" ? ` tier-${fit?.tier ?? "rail"}` : ""}${fit && fit.open.some((o) => !o) ? " folded" : ""}${timeline ? "" : " no-timeline"}`}
        style={{ gridTemplateColumns: tracks, ...(fit ? { "--rail-w": `${fit.railPx}px` } : {}) } as CSSProperties}
        role="group"
        aria-label="Week grid. Arrow keys move between half-days, Enter opens details."
      >
        {week.days.map((d, i) =>
          !fit || fit.open[i] ? (
            column(d, i, fit?.days[i])
          ) : (
            <FoldedDay key={d.date} day={d} dayIndex={i} tz={userZone(week)} hasEve={hasEve} colors={colors} isToday={d.date === today} now={now} side={i < firstOpen ? "before" : "after"} onSelect={onSelect} />
          ),
        )}
      </main>
    </TierCtx.Provider>
  );
}

/**
 * WK-1: the grid's content width, its column gap and the text scale, measured again when the grid changes size (the
 * window, the detail panel's space) or the Text size changes.
 */
function useGridBox(ref: RefObject<HTMLElement | null>, active: boolean): { content: number; gap: number; scale: number } | null {
  const [box, setBox] = useState<{ content: number; gap: number; scale: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const read = () => {
      const cs = getComputedStyle(el);
      const content = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const gap = parseFloat(cs.columnGap) || 0;
      const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-scale")) || 1;
      setBox((b) => (b && Math.abs(b.content - content) < 0.5 && b.gap === gap && b.scale === scale ? b : { content, gap, scale }));
    };
    read();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-text-size", "style", "class"] });
    window.addEventListener("resize", read);
    return () => (ro?.disconnect(), mo.disconnect(), window.removeEventListener("resize", read));
  }, [ref, active]);
  return box;
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

function DayColumn(props: { day: Day; dayIndex: number; tz: string; isToday: boolean; hasEve: boolean; badges: ReadonlyMap<string, FollowUpView[]>; own?: { tier: Tier; railPx: number } | undefined; grow?: boolean; /** WK-3: the Evening band's items, or null (no band). */ band?: EveningBand | null } & Omit<Props, "week" | "today">) {
  // WK-2: this column's own tier (from its own width) in the medium layout; the grid's otherwise.
  const gridTier = useContext(TierCtx);
  const tier = gridTier && props.own ? props.own.tier : gridTier;
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
  // WD-1: no Plan chip any more; Friday's Add hours link stays.
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
  const railNow = (half: Half): RailNow | null => railNowOf(day, half, spot, props.now, nowLabel, toNow);

  // WK-3: a weekend day is a narrow, quiet column: a muted header, then its calendar items and to-dos as plain rows
  // with their times. No AM/PM blocks, no Open half-days, no capacity or at-risk warnings.
  if (day.kind === "weekend")
    return (
      <section className={`day weekend quiet${isToday ? " today" : ""}${daySelected ? " sel-day" : ""}`} aria-label={`${dayLabel}, weekend`}>
        <header className="day-head weekend-head" onContextMenu={menu.onContextMenu}>
          <span className="dow">{day.weekday}</span>
          <span className="date">{Temporal.PlainDate.from(day.date).day}</span>
          <span className="weekend-word">· weekend</span>
          {isToday && <span className="today-pill">Today</span>}
          <span className="day-gap" />
          <HalfScope.Provider value={daySelected}>{menu.button(`Actions for ${dayLabel}`)}</HalfScope.Provider>
        </header>
        <AllDay events={day.allDay} />
        <WeekendDay day={day} tz={tz} selected={daySelected} refAm={refFor("AM")} refPm={refFor("PM")} onOpen={(focus) => props.onOpen({ dayIndex, half: "AM" }, focus)} dayLabel={dayLabel} />
      </section>
    );

  return (
    <TierCtx.Provider value={tier}>
    <section
      className={`day ${overflow ? "overflow" : "work"} ${isToday ? "today" : ""} ${day.pto ? "pto-full" : ""}${daySelected ? " sel-day" : ""}${tier ? ` tier-${tier}` : ""}`}
      style={tier && props.own ? ({ "--rail-w": `${props.own.railPx}px` } as CSSProperties) : undefined}
      aria-label={`${dayLabel}${day.pto ? `, ${ptoLabel(day.pto)}` : ""}`}
    >
      <header className="day-head" onContextMenu={menu.onContextMenu}>
        {/* WD-1: the weekday and date select the day's first block and open the Add work panel (WD-2 opens Day). */}
        <button type="button" className="day-open" tabIndex={daySelected ? 0 : -1} onClick={() => props.onDayHead?.(day.date)} title={`Add work to ${day.weekday}`} aria-label={`${dayLabel}: add work`}>
          <span className="dow">{day.weekday}</span>
          <span className="date">
            <span className="date-long">{shortDate(day.date)}</span>
            <span className="date-short" aria-hidden="true">{Number(day.date.slice(8))}</span>
          </span>
        </button>
        {isToday && <span className="today-pill">Today</span>}
        {day.pto && (
          <span className="pto-pill" title={ptoLabel(day.pto)}>
            PTO
          </span>
        )}
        <span className="day-gap" />
        {btn === "add_hours" ? (
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
          band={props.band ?? null}
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
            <BlockCard
              key={half}
              slot={slotOf(day, half)!}
              overflow={overflow}
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
              grow={!!props.grow}
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

      {props.band ? <EveningBandView band={props.band} date={day.date} tz={tz} dayLabel={dayLabel} /> : <OutLine kind="late" items={whole ? [] : day.evening.map((p) => p.event)} tz={tz} />}
    </section>
    </TierCtx.Provider>
  );
}

/** U3: all-day events as chips under the day header, only when there are some (the row stays for alignment); two or more stack. */
export function AllDay({ events }: { events: readonly CalEvent[] }) {
  const samples = useContext(SampleSources);
  return (
    <div className={`day-allday${events.length ? "" : " empty"}`}>
      {events.map((e) => (
        <span key={e.id} className={`chip ${e.unavailable ? "unavailable" : e.isPersonal ? "personal" : "meeting"}${e.calendar ? " linked" : ""}`} style={e.calendar ? ({ "--cal": e.calendar.color } as CSSProperties) : undefined} title={`${e.title} · all day · ${sourceName(e, samples)}`}>
          {e.title}
        </span>
      ))}
    </div>
  );
}

/** U3: events before or after the hours shown, as one small line at the top or bottom of the column, only when present. */
export function OutLine({ kind, items, tz }: { kind: "early" | "late"; items: readonly CalEvent[]; tz: string }) {
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
export function WholeDay({ day, band, kind, tz, selected, refAm, refPm, onOpen, dayLabel, now }: { day: Day; band: EveningBand | null; kind: "pto" | "catchup"; tz: string; selected: boolean; refAm: (el: HTMLDivElement | null) => void; refPm: (el: HTMLDivElement | null) => void; onOpen: (focus?: PanelFocus) => void; dayLabel: string; now: { at: number; label: string; onClick: () => void } | null }) {
  const plan = useContext(PlanCtx);
  const samples = useContext(SampleSources);
  // All-day events are chips under the day header (D406); the cell lists only timed events.
  // WK-3: what's after the day's end is in the Evening band below, not here.
  const events = [...day.early, ...day.am.events, ...day.pm.events, ...(band ? [] : day.evening)].map((p) => ({ e: p.event, start: p.event.start }));
  const seen = new Set<string>();
  const lines = events.filter(({ e }) => !seen.has(e.id) && !!seen.add(e.id));
  // WK-3: every to-do of the day but the band's (a Friday deployment at 2 PM sits in the evening half: Friday has no hours of its own).
  const inBand = bandIds(band);
  const picks = kind === "catchup" ? (plan.week?.[day.date]?.picks ?? []).filter((p) => (p.status === "planned" || p.status === "done") && !inBand.has(p.id)) : [];
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

/**
 * WK-3: a weekend day's one cell: its calendar items and to-dos as plain rows with their times, the promises due that
 * day, and nothing about blocks, Open half-days, capacity or risk. One drop target for the whole day (D947: a weekend
 * takes a move, with its note).
 */
function WeekendDay({ day, tz, selected, refAm, refPm, onOpen, dayLabel }: { day: Day; tz: string; selected: boolean; refAm: (el: HTMLDivElement | null) => void; refPm: (el: HTMLDivElement | null) => void; onOpen: (focus?: PanelFocus) => void; dayLabel: string }) {
  const plan = useContext(PlanCtx);
  const samples = useContext(SampleSources);
  const rows = weekendRows(day, plan.week?.[day.date]?.picks ?? [], plan.followUps ?? []);
  const drop = useDropTarget({ date: day.date, half: "AM" });
  const empty = !rows.events.length && !rows.picks.length && !rows.due.length && !(day.eve?.flex ?? []).length;
  return (
    <div
      ref={(el) => (refAm(el), refPm(el))}
      {...drop.props}
      className={`half whole weekend-cell${selected ? " selected" : ""}${drop.cls}`}
      tabIndex={selected ? 0 : -1}
      role="button"
      aria-label={`${dayLabel}, weekend: ${rows.events.length} on the calendar, ${rows.picks.length} to-do${rows.picks.length === 1 ? "" : "s"}`}
      aria-pressed={selected}
      onClick={(e) => !interactive(e) && onOpen()}
    >
      {drop.tip}
      {empty && <p className="we-empty muted">Nothing planned</p>}
      {rows.events.length > 0 && (
        <ul className="whole-lines we-events" aria-label={`Calendar on ${dayLabel}`}>
          {rows.events.map((e) => (
            <li key={e.id} className={e.isPersonal ? "personal" : undefined} title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e, samples)}`}>
              <span className="out-time">{startClock(e.start, tz)}</span> <span className="ev-title">{e.title}</span>
            </li>
          ))}
        </ul>
      )}
      {(day.eve?.flex ?? []).length > 0 && (
        <ul className="whole-lines we-flex" aria-label={`Flex sessions on ${dayLabel}`}>
          {day.eve!.flex.map((f) => (
            <li key={f.id} title={`Flex session ${shortRange({ start: f.start, end: f.end }, tz)}`}>
              <span className="out-time">{startClock(f.start, tz)}</span> <span className="ev-title">Flex session{f.itemTitle ? ` · ${f.itemTitle}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {rows.picks.length > 0 && (
        <ul className="checklist we-todos" aria-label={`To-dos on ${dayLabel}`}>
          {rows.picks.map((p) => <CardPick key={p.id} pick={p} tabIndex={selected ? 0 : -1} />)}
        </ul>
      )}
      {rows.due.length > 0 && (
        <ul className="we-due" aria-label={`Promises due on ${dayLabel}`}>
          {rows.due.map((f) => (
            <li key={f.id}><DueBadge l={f} /> <span className="ev-title">{f.what}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * WK-3: the Evening band under a weekday's afternoon: what's after the day shape's end (calendar items past the
 * card's hours, evening to-dos, deployments whose window starts after the day ends), so the day isn't stretched or
 * crowded. Only when there is something.
 */
export function EveningBandView({ band, date, tz, dayLabel }: { band: EveningBand; date: IsoDate; tz: string; dayLabel: string }) {
  const samples = useContext(SampleSources);
  void date;
  return (
    <div className="evening-band" role="group" aria-label={`${dayLabel} evening`}>
      <span className="eb-label">Evening</span>
      {band.events.length > 0 && (
        <ul className="whole-lines eb-events">
          {band.events.map((e) => (
            <li key={e.id} className={e.isPersonal ? "personal" : undefined} title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e, samples)}`}>
              <span className="out-time">{startClock(e.start, tz)}</span> <span className="ev-title">{e.title}</span>
            </li>
          ))}
        </ul>
      )}
      {band.picks.length > 0 && (
        <ul className="checklist eb-todos" aria-label={`Evening to-dos on ${dayLabel}`}>
          {band.picks.map((p) => <CardPick key={p.id} pick={p} tabIndex={-1} />)}
        </ul>
      )}
    </div>
  );
}


/**
 * WK-1: a folded day (the week didn't fit with every day open): a narrow strip with the weekday and date, its AM and PM
 * halves in the client's colour (each a drop target with the usual fit tip, highlighted while a story is over it), the
 * at-risk dot, PTO hatched or Catch-up dashed, and today's now line. A click (or the arrow keys) selects it, which
 * opens it and moves the window.
 */
function FoldedDay({ day, dayIndex, tz, hasEve, colors, isToday, now, side, onSelect }: { day: Day; dayIndex: number; tz: string; hasEve: boolean; colors: Record<string, string>; isToday: boolean; now: string; side: "before" | "after"; onSelect: (s: Selection) => void }) {
  const whole = wholeDay(day);
  const halves = cardHalves(day);
  const dayLabel = `${day.weekday} ${shortDate(day.date)}`;
  const spot: NowSpot | null = isToday ? nowSpot(day, now, tz, !!whole) : null;
  const nowLabel = spot ? nowClock(now, tz) : "";
  const last = day.eve ? "EVE" : "PM";
  const at = (half: Half): number | null =>
    !spot ? null : spot.kind === "rail" ? (spot.half === half ? spot.at : null) : spot.kind === "before" ? (half === "AM" ? 0 : null) : spot.kind === "after" ? (half === last ? 1 : null) : null;
  const open = (half: Half) => onSelect({ dayIndex, half });
  const rows: (Half | null)[] = hasEve && !eveOnly(day) && !day.eve ? [...halves, null] : halves;
  return (
    <section className={`day folded fold-${side}${isToday ? " today" : ""}${day.pto ? " pto-full" : ""}`} aria-label={`${dayLabel}, folded${day.pto ? `, ${ptoLabel(day.pto)}` : ""}`}>
      <header className="day-head fold-head">
        <button type="button" className="fold-open" onClick={() => open("AM")} title={`Open ${dayLabel}`} aria-label={`Open ${dayLabel}`}>
          <span className="dow">{day.weekday.slice(0, 3)}</span>
          <span className="date">{Temporal.PlainDate.from(day.date).day}</span>
        </button>
      </header>
      <div className="day-allday empty" />
      <div className="day-out early empty" />
      {whole ? (
        <FoldHalf day={day} half="AM" whole={whole} dayIndex={dayIndex} dayLabel={dayLabel} colors={colors} now={spot?.kind === "whole" ? spot.at : null} nowLabel={nowLabel} onOpen={open} />
      ) : (
        rows.map((h, k) => (h === null ? <div key={`gap-${k}`} className="half-gap" aria-hidden="true" /> : <FoldHalf key={h} day={day} half={h} whole={null} dayIndex={dayIndex} dayLabel={dayLabel} colors={colors} now={at(h)} nowLabel={nowLabel} onOpen={open} />))
      )}
      <div className="day-out late empty" />
    </section>
  );
}

function FoldHalf({ day, half, whole, dayLabel, colors, now, nowLabel, onOpen }: { day: Day; half: Half; whole: Whole; dayIndex: number; dayLabel: string; colors: Record<string, string>; now: number | null; nowLabel: string; onOpen: (h: Half) => void }) {
  const slot = slotOf(day, half)!;
  const primary = whole ? undefined : slot.focus[0];
  const sev = whole ? null : worstSeverity(slot.risks);
  const drop = useDropTarget(half === "EVE" || whole === "pto" ? (whole === "pto" ? { date: day.date, half: "AM" } : null) : { date: day.date, half });
  const name = whole === "pto" ? "PTO" : whole === "catchup" ? "Catch-up" : slot.pto ? "PTO" : primary ? primary.clientName : slot.off ? "No working hours" : slot.open ? "Open" : half === "EVE" ? "Evening" : "Catch-up";
  const words = `${dayLabel}${whole ? "" : ` ${half === "EVE" ? "evening" : half}`}, ${name}${sev === "at_risk" ? ", at risk" : sev === "watch" ? ", watch" : ""}`;
  const state = whole ? `whole ${whole}` : slot.pto ? "pto-half" : primary ? "focus" : slot.open ? "open" : "off";
  return (
    <div
      {...drop.props}
      className={`half fold-half ${state}${sev ? ` ${sev}` : ""}${drop.cls}`}
      style={{ "--c": clientColor(primary?.clientKey, colors) } as CSSProperties}
      role="button"
      tabIndex={-1}
      aria-label={`${words}. Open ${day.weekday}`}
      title={words}
      onClick={() => onOpen(half)}
    >
      {sev && <span className={`fold-risk ${sev}`} aria-hidden="true" />}
      {now != null && <NowLine at={now} label={nowLabel} thin onClick={() => onOpen(half)} />}
      {drop.tip}
    </div>
  );
}


export function ptoLabel(p: PtoDay): string {
  return `PTO · ${p.titles.join(", ")}`;
}

