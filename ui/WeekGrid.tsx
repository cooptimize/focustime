// Week's grid: the days as columns, each with its blocks (ui/BlockCard.tsx), PTO and catch-up days as one cell, the
// weekend's quiet column, the Evening band and folded days (WK-1 to WK-3). WD-1: a day's header selects its first
// block and opens the block panel; there is no Plan chip and no planning column any more.
import { DaySuggestLine } from "./Suggest.tsx";
import { offWord, ptoLabel } from "../plan/days.ts";
import { useContext, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { callMarks, MeetingCalls, useMine } from "./meetings/calls.ts";
import { liveOf, useCoworkData } from "./cowork.tsx";
import { liveCallCard, type CoworkChatView } from "../plan/cowork.ts";
import { worstSeverity } from "../week/risks.ts";
import type { CalEvent, Day, Half, Week } from "../week/types.ts";
import type { FollowUpView } from "../actions/types.ts";
import { weekDueBadges } from "../plan/due.ts";
import { homeRail, lateOnCards, type CardRail } from "../plan/rail-promises.ts";
import { canAddWork, planButton } from "../plan/days.ts";
import { bandIds, eveningBand, weekendRows, type EveningBand } from "../plan/evening.ts";
import { dayMenu } from "./menu.ts";
import { useMenu } from "./Menus.tsx";
import type { IsoDate } from "../week/types.ts";
import { DueBadge } from "./FollowUps.tsx";
import { weekFit, type Tier } from "./weekfit.ts";
import { focusIndex, foldOrder, longWeekday, stepShown } from "../plan/weekdays.ts";
import { clientColor, eventRange, SampleSources, shortDate, shortRange, sourceName, startClock } from "./labels.ts";
import { cardHalves, eveOnly, slotOf } from "./halves.ts";
import { dayBlocks, type WholeDay as WholeKind } from "../plan/dayblocks.ts";
import { type Layout } from "./viewport.ts";
import { PlanCtx } from "./planview.ts";
import { HalfScope } from "./scope.ts";
import { interactive } from "./cardclick.ts";
import { userZone } from "../week/zone.ts";
import type { RailItem } from "../plan/inbox-items.ts";
import { useDropTarget } from "./WeekStories.tsx";
import { nowClock, nowSpot, type NowSpot } from "../plan/nowline.ts";
import { NowLine } from "./NowLine.tsx";
import { railNowOf, type RailNow } from "./Timeline.tsx";
import { LiveOnCard, RowFormCtx, RulerCtx, TierCtx, TimelineCtx, type PanelFocus, type Selection } from "./weekctx.ts";
import { BlockCard, CardPick, CardPicks } from "./BlockCard.tsx";
import { Icon } from "./icons.tsx";
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
  /** WD-2: a click on a day's header opens Day on that date; "+ Add" on a block; Friday's "Add hours" link. */
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
  /** WD-2: Day: only this day's column, with no day header, its blocks side by side when there's room. */
  only?: number | undefined;
  /** WK-5: per day, whether Week shows it (the catch-up day and weekend days can be hidden); all by default. */
  shown?: readonly boolean[] | undefined;
  /** WK-5: what decides the day in focus: the block panel's day, a folded day opened with the panel closed (then today). */
  focusAt?: { panel: IsoDate | null; chosen: IsoDate | null } | undefined;
  /** WK-5: a folded day's click or Enter: it becomes the day in focus. */
  onFoldOpen?: ((dayIndex: number) => void) | undefined;
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
            {/* WK-5: Week's cards put a to-do's time under its title; Day (one day, `only`) keeps it at the right. */}
            <RowFormCtx.Provider value={props.only === undefined ? "stack" : "side"}>
              <Grid {...props} />
            </RowFormCtx.Provider>
          </TimelineCtx.Provider>
        </LiveOnCard.Provider>
      </MeetingCalls.Provider>
    </RulerCtx.Provider>
  );
}

function Grid({ week, colors, minFocusWindow, today, now, selection, cellRefs, onSelect, onOpen, layout, compact: compactIn, onDayHead, onAddWork, onAddHours, panelOpen, timeline = true, only, shown: shownIn, focusAt, onFoldOpen }: Props) {
  // WK-2: with the timeline hidden every layout draws compact cards (no hour timeline beside them).
  const compact = compactIn || !timeline;
  const pv = useContext(PlanCtx);
  const ref = useRef<HTMLElement>(null);
  const box = useGridBox(ref, layout !== "narrow" && only === undefined);
  // WK-5 review: a day folding or opening replaces the focused cell (or the strip's button); focus goes back to the
  // selection's cell instead of falling to the page.
  const hadFocus = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => void (hadFocus.current = true);
    const off = (e: FocusEvent) => {
      const t = e.target as Node;
      queueMicrotask(() => {
        if (t.isConnected) hadFocus.current = el.contains(document.activeElement);
      });
    };
    el.addEventListener("focusin", on);
    el.addEventListener("focusout", off);
    return () => (el.removeEventListener("focusin", on), el.removeEventListener("focusout", off));
  });
  useLayoutEffect(() => {
    if (!hadFocus.current) return;
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected) return;
    cellRefs.get(`${selection.dayIndex}${selection.half}`)?.focus({ preventScroll: true });
  });
  const shown = shownIn ?? week.days.map(() => true);
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
      hasEve={week.days.some((d, i) => shown[i] && d.eve)}
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
      bare={only !== undefined}
      grow={!compactIn && only === undefined}
      band={eveningBand(day, week, pv.week?.[day.date]?.picks ?? [])}
    />
  );
  // WD-2: Day is one day of this grid: the same column and cards, no day header, AM and PM side by side.
  if (only !== undefined && week.days[only])
    return (
      <TierCtx.Provider value={null}>
        {/* Day is the page's main; this is its blocks. */}
        <div className={`grid day-only${timeline ? "" : " no-timeline"}`} role="group" aria-label="The day's blocks. Arrow keys move between them, Enter opens one.">
          {column(week.days[only]!, only)}
        </div>
      </TierCtx.Provider>
    );
  if (layout === "narrow") {
    const i = selection.dayIndex;
    const swipe = { x: 0, y: 0 };
    // WK-5: hidden days have no tab and the arrows and swipes pass over them.
    const go = (d: number) => {
      // A tab goes straight to its day; a swipe onto a hidden day goes on to the next shown one that way.
      const to = d === i || shown[d] ? d : stepShown(shown, i, d < i ? -1 : 1);
      if (to >= 0) onSelect({ dayIndex: to, half: selection.half });
    };
    const first = shown.indexOf(true);
    const last = shown.lastIndexOf(true);
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
          <button type="button" className="day-step" onClick={() => go(i - 1)} disabled={i <= first} aria-label="Previous day">
            <kbd>←</kbd>
          </button>
          <div className="day-tabs">
            {week.days.map((d, k) => !shown[k] ? null : (
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
          <button type="button" className="day-step" onClick={() => go(i + 1)} disabled={i >= last} aria-label="Next day">
            <kbd>→</kbd>
          </button>
        </nav>
        {column(week.days[i]!, i)}
      </main>
    );
  }
  // WK-5: only the shown days take a column. The day in focus (the block panel's day, a folded day opened, else today)
  // takes twice a working day's share; Friday, weekend days and PTO days are lighter (WK-1, WK-3). When a shown day
  // can't have its narrowest readable width, days fold in a fixed order (weekfit.ts, plan/weekdays.ts). Every layout
  // but the one-day ones.
  const hasEve = week.days.some((d, i) => shown[i] && d.eve);
  const idx = week.days.map((_, i) => i).filter((i) => shown[i]);
  const focusAll = focusIndex(week.days, shown, { panel: focusAt?.panel ?? null, chosen: focusAt?.chosen ?? null, today });
  const focus = idx.indexOf(focusAll);
  const order = foldOrder(week.days, shown, focusAll, pv.today ?? today).map((i) => idx.indexOf(i));
  const shownDays = idx.map((i) => week.days[i]!);
  const fit = box ? weekFit({ contentPx: box.content, gapPx: box.gap, scale: box.scale, days: shownDays, focus, order }) : null;
  const tracks = fit?.tracks ?? shownDays.map((d, k) => `minmax(0, ${k === focus ? 2 : d.kind === "weekend" ? 0.4 : d.kind === "work" && !d.pto ? 1 : 0.6}fr)`).join(" ");
  // WK-2: each open column draws the tier of its own width (Friday and PTO days too); the grid's class keeps the focus
  // day's (or a working day's) tier.
  return (
    <TierCtx.Provider value={layout === "medium" ? fit?.tier ?? "rail" : null}>
      <main
        ref={ref}
        className={`grid ${layout} ${hasEve ? "has-eve" : ""}${panelOpen ? " with-panel" : ""}${layout === "medium" ? ` tier-${fit?.tier ?? "rail"}` : ""}${fit && fit.open.some((o) => !o) ? " folded" : ""}${timeline ? "" : " no-timeline"}`}
        style={{ gridTemplateColumns: tracks, ...(fit ? { "--rail-w": `${fit.railPx}px` } : {}) } as CSSProperties}
        role="group"
        aria-label="Week grid. Arrow keys move between half-days, Enter opens details."
        data-focus-day={focusAll >= 0 ? week.days[focusAll]!.date : undefined}
      >
        {idx.map((i, k) =>
          !fit || fit.open[k] ? (
            column(week.days[i]!, i, layout === "medium" ? fit?.days[k] : undefined)
          ) : (
            <FoldedDay key={week.days[i]!.date} day={week.days[i]!} dayIndex={i} tz={userZone(week)} hasEve={hasEve} colors={colors} isToday={week.days[i]!.date === today} now={now} side={focus >= 0 && k > focus ? "after" : "before"} selected={selection.dayIndex === i} cellRefs={cellRefs} onOpen={() => (onFoldOpen ? onFoldOpen(i) : onSelect({ dayIndex: i, half: "AM" }))} />
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

/** U3: a whole day in one cell: a PTO day (hatched) or a day with no working hours (Friday's dashed catch-up). RS-2: the shared answer. */
type Whole = WholeKind | null;
const wholeDay = (day: Day): Whole => dayBlocks(day).whole;

function DayColumn(props: { /** WD-2: Day draws the column with no header (Day has its own). */ bare?: boolean; day: Day; dayIndex: number; tz: string; isToday: boolean; hasEve: boolean; badges: ReadonlyMap<string, FollowUpView[]>; own?: { tier: Tier; railPx: number } | undefined; grow?: boolean; /** WK-3: the Evening band's items, or null (no band). */ band?: EveningBand | null } & Omit<Props, "week" | "today">) {
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
  const dayPlan = pv.week?.[day.date];
  // WD-1: no Plan chip any more; Friday's Add hours link stays.
  const btn = planButton({
    date: day.date,
    today: pv.today ?? "",
    pto: !!day.pto,
    hasHours: !(day.am.off && day.pm.off && (!day.eve || day.eve.off)) || day.flexMinutes > 0,
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
      {!props.bare && <header className="day-head" onContextMenu={menu.onContextMenu}>
        {/* WD-2: the weekday and date open Day on that date. */}
        <button type="button" className="day-open" tabIndex={daySelected ? 0 : -1} onClick={() => props.onDayHead?.(day.date)} title={`Open ${day.weekday} in Day`} aria-label={`${dayLabel}: open in Day`}>
          <span className="dow">{day.weekday}</span>
          {/* PS-1: one short form in a week ("Tue 3"; the title says the month); the long one is Day's ("Tue, Nov 3"). */}
          <span className="date">
            <span className="date-short">{Number(day.date.slice(8))}</span>
          </span>
        </button>
        {isToday && <span className="today-pill">Today</span>}
        {day.pto && (
          <span className={`pto-pill${day.pto.holiday ? " holiday-pill" : ""}`} title={ptoLabel(day.pto)}>
            {offWord(day.pto)}
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
        {/* SG-1: "5 suggested · Keep all · Clear" as the header's second line (the header is one row of the shared grid). */}
        <DaySuggestLine date={day.date} className="sug-week-day" tabIndex={daySelected ? 0 : -1} />
      </header>}

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
export function WholeDay({ day, band, kind, tz, selected, refAm, refPm, onOpen, dayLabel }: { day: Day; band: EveningBand | null; kind: "pto" | "catchup"; tz: string; selected: boolean; refAm: (el: HTMLDivElement | null) => void; refPm: (el: HTMLDivElement | null) => void; onOpen: (focus?: PanelFocus) => void; dayLabel: string }) {
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
  // PS-1: a holiday's cell carries its name ("Thanksgiving Day (observed)"), never "PTO".
  const label = kind === "pto" ? (day.pto?.holiday ?? "PTO") : "Catch-up";
  // PV-1: the whole day is one drop target (PTO refuses it; catch-up takes it with no fit).
  const drop = useDropTarget({ date: day.date, half: "AM" });
  return (
    <div
      ref={(el) => (refAm(el), refPm(el))}
      {...drop.props}
      className={`half whole ${kind}${day.pto?.holiday ? " holiday" : ""}${selected ? " selected" : ""}${drop.cls}`}
      tabIndex={selected ? 0 : -1}
      role="button"
      aria-label={`${dayLabel}, ${kind === "pto" ? ptoLabel(day.pto!) : "catch-up, no working hours"}`}
      aria-pressed={selected}
      onClick={(e) => !interactive(e) && onOpen()}
    >
      <div className="whole-label" title={kind === "pto" && day.pto ? ptoLabel(day.pto) : undefined}>
        {/* RS-1: what kind of day off it is, as an icon before its name (a holiday, PTO, the catch-up day). */}
        <Icon name={kind === "pto" ? (day.pto?.holiday ? "holiday" : "pto") : "catchup"} /> {label}
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
 * WK-1, WK-5: a folded day (the shown days didn't all fit at their narrowest readable width): a narrow strip with the
 * weekday and date, "Today" when it is today, and one mark per block in its client's colour with its count of open
 * to-dos (each a drop target, as before), PTO hatched or Catch-up dashed, and today's now line. A click, or Enter on its
 * header, makes it the day in focus (it opens; another folds if needed). Its title and screen reader name say the day,
 * its blocks and their counts. The arrow keys stop on its header (selecting it doesn't move widths).
 */
function FoldedDay({ day, dayIndex, tz, hasEve, colors, isToday, now, side, selected, cellRefs, onOpen }: { day: Day; dayIndex: number; tz: string; hasEve: boolean; colors: Record<string, string>; isToday: boolean; now: string; side: "before" | "after"; selected: boolean; cellRefs: Map<string, HTMLDivElement>; onOpen: () => void }) {
  const pv = useContext(PlanCtx);
  const whole = wholeDay(day);
  const halves = cardHalves(day);
  const dayLabel = `${day.weekday} ${shortDate(day.date)}`;
  const spot: NowSpot | null = isToday ? nowSpot(day, now, tz, !!whole) : null;
  const nowLabel = spot ? nowClock(now, tz) : "";
  // NL-1: only the half under way gets the line.
  const at = (half: Half): number | null => (spot?.kind === "rail" && spot.half === half ? spot.at : null);
  const picks = (pv.week?.[day.date]?.picks ?? []).filter((p) => p.status === "planned");
  const count = (half: Half | null) => picks.filter((p) => half === null || p.half === half).length;
  const rows: (Half | null)[] = hasEve && !eveOnly(day) && !day.eve ? [...halves, null] : halves;
  const marks = whole || day.kind === "weekend" ? [{ half: null as Half | null, name: foldName(day, null, whole), n: count(null) }] : halves.map((h) => ({ half: h as Half | null, name: foldName(day, h, whole), n: count(h) }));
  const todo = (n: number) => `${n} to-do${n === 1 ? "" : "s"}`;
  const words = `${dayLabel}${isToday ? ", today" : ""}${day.pto ? `, ${ptoLabel(day.pto)}` : ""}: ${marks.map((m) => `${m.half ? `${m.half === "EVE" ? "evening" : m.half} ` : ""}${m.name}, ${todo(m.n)}`).join("; ")}`;
  const ref = (el: HTMLButtonElement | null) => {
    for (const h of ["AM", "PM", "EVE"] as Half[]) {
      if (el) cellRefs.set(`${dayIndex}${h}`, el as unknown as HTMLDivElement);
      else if (cellRefs.get(`${dayIndex}${h}`)?.classList.contains("fold-open")) cellRefs.delete(`${dayIndex}${h}`);
    }
  };
  return (
    <section className={`day folded fold-${side}${selected ? " sel-day" : ""}${isToday ? " today" : ""}${day.pto ? " pto-full" : ""}${day.kind === "weekend" ? " weekend" : ""}${day.date < (pv.today ?? "") ? " past-day" : ""}`} aria-label={`${dayLabel}, folded`}>
      <header className="day-head fold-head">
        <button ref={ref} type="button" className="fold-open" tabIndex={selected ? 0 : -1} onClick={onOpen} title={`${words}. Open ${longWeekday(day.date)}`} aria-label={`${words}. Open ${longWeekday(day.date)}`}>
          <span className="dow">{day.weekday.slice(0, 3)}</span>
          <span className="date">{Temporal.PlainDate.from(day.date).day}</span>
          {isToday && <span className="fold-today">Today</span>}
        </button>
      </header>
      <div className="day-allday empty" />
      <div className="day-out early empty" />
      {whole || day.kind === "weekend" ? (
        <FoldHalf day={day} half="AM" whole={whole ?? "catchup"} name={marks[0]!.name} count={marks[0]!.n} colors={colors} now={null} nowLabel={nowLabel} onOpen={onOpen} />
      ) : (
        rows.map((h, k) => (h === null ? <div key={`gap-${k}`} className="half-gap" aria-hidden="true" /> : <FoldHalf key={h} day={day} half={h} whole={null} name={foldName(day, h, null)} count={count(h)} colors={colors} now={at(h)} nowLabel={nowLabel} onOpen={onOpen} />))
      )}
      <div className="day-out late empty" />
    </section>
  );
}

/** What a folded block is: its client, PTO, Catch-up, Weekend, Open or Evening. */
function foldName(day: Day, half: Half | null, whole: Whole): string {
  if (whole === "pto") return offWord(day.pto);
  if (day.kind === "weekend") return "Weekend";
  if (whole === "catchup" || half === null) return "Catch-up";
  const slot = slotOf(day, half)!;
  return slot.pto ? "PTO" : slot.focus[0] ? slot.focus[0].clientName : slot.off ? "No working hours" : slot.open ? "Open" : half === "EVE" ? "Evening" : "Catch-up";
}

function FoldHalf({ day, half, whole, name, count, colors, now, nowLabel, onOpen }: { day: Day; half: Half; whole: Whole; name: string; count: number; colors: Record<string, string>; now: number | null; nowLabel: string; onOpen: () => void }) {
  const slot = slotOf(day, half)!;
  const primary = whole ? undefined : slot.focus[0];
  const sev = whole ? null : worstSeverity(slot.risks);
  const drop = useDropTarget(half === "EVE" || whole === "pto" ? (whole === "pto" ? { date: day.date, half: "AM" } : null) : { date: day.date, half });
  const state = whole ? `whole ${whole}` : slot.pto ? "pto-half" : primary ? "focus" : slot.open ? "open" : "off";
  return (
    <div
      {...drop.props}
      className={`half fold-half ${state}${sev ? ` ${sev}` : ""}${drop.cls}`}
      style={{ "--c": clientColor(primary?.clientKey, colors) } as CSSProperties}
      aria-hidden="true"
      title={`${name}: ${count} to-do${count === 1 ? "" : "s"}`}
      onClick={onOpen}
    >
      {sev && <span className={`fold-risk ${sev}`} />}
      {count > 0 && <span className="fold-count">{count}</span>}
      {now != null && <NowLine at={now} label={nowLabel} thin onClick={onOpen} />}
      {drop.tip}
    </div>
  );
}


export { offWord, ptoLabel } from "../plan/days.ts";

