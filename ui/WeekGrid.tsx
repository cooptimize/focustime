import { createContext, useContext, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { TimeboxBands, TimeboxList } from "./Timeboxes.tsx";
import { formatDuration } from "../week/format.ts";
import { worstSeverity } from "../week/risks.ts";
import type { CalEvent, Day, Half, PlacedEvent, Slot, Week } from "../week/types.ts";
import type { PtoDay } from "../week/pto.ts";
import type { Pick } from "../plan/types.ts";
import type { FollowUpView } from "../actions/types.ts";
import { capFollowUps, followUpsOnDay } from "../plan/due.ts";
import { canAddWork, planButton } from "../plan/days.ts";
import { dayMenu, eventMenu, slotMenu } from "./menu.ts";
import { MenuCtx, useMenu } from "./Menus.tsx";
import { PickRow } from "./PickRow.tsx";
import { hourMarks, labelHere, layoutEvents, rulerSpan, showRuler } from "./layout.ts";
import { DevOpsWork } from "./work.ts";
import { clientColor, eventRange, halfTag, SampleSources, shortDate, showAsLabel, slotRange, sourceName, startClock } from "./labels.ts";
import { cardHalves, eveOnly, slotOf } from "./halves.ts";
import type { Layout } from "./viewport.ts";
import { cardPlan, featuresOn, PlanCtx, type PlanView } from "./planview.ts";
import { blockStatus } from "../plan/blockstatus.ts";

import { HalfScope } from "./scope.ts";

export type Selection = { dayIndex: number; half: Half };

/** Step 15.1 (D276): the layout and the timelines switch, for the compact time ruler on each card. */
const RulerCtx = createContext<{ layout: Layout; on: boolean }>({ layout: "wide", on: false });

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
  onOpen: (s: Selection) => void;
  /** wide: hour timelines; medium: compact cards; narrow: the selected day only. */
  layout: Layout;
  /** Half-days as compact cards (medium, and narrow windows too thin for rail plus timeline). */
  compact: boolean;
  /** Step 15.1 (D276): compact timelines on medium cards (the switch; showRuler decides per card). */
  timelines?: boolean | undefined;
  /** Plan the day: this day's column becomes the planning panel; the rest of the week is dimmed. */
  planDay?: { dayIndex: number; node: ReactNode } | undefined;
  /** Step 13.6: the day header's Plan button, "+ Add work" on a block and Friday's "Add hours" link. */
  onPlanDay?: ((date: string) => void) | undefined;
  onAddWork?: ((date: string, half: Half) => void) | undefined;
  onAddHours?: ((date: string) => void) | undefined;
};

export function WeekGrid(props: Props) {
  return (
    <RulerCtx.Provider value={{ layout: props.layout, on: props.timelines ?? false }}>
      <Grid {...props} />
    </RulerCtx.Provider>
  );
}

function Grid({ week, colors, minFocusWindow, today, now, selection, cellRefs, onSelect, onOpen, layout, compact, planDay, onPlanDay, onAddWork, onAddHours }: Props) {
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
      tz={week.timeZone}
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
    />
  );
  if (layout === "narrow") {
    const i = selection.dayIndex;
    const go = (d: number) => onSelect({ dayIndex: Math.max(0, Math.min(week.days.length - 1, d)), half: selection.half });
    return (
      <main className="grid narrow" role="group" aria-label="Day view. Left and right arrows change the day, up and down pick the half-day, Enter opens details.">
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
      className={`grid ${layout} ${planDay ? "planning" : ""} ${hasEve ? "has-eve" : ""}`}
      style={{ gridTemplateColumns: tracks }}
      role="group"
      aria-label="Week grid. Arrow keys move between half-days, Enter opens details."
    >
      {week.days.map(column)}
    </main>
  );
}

function DayColumn(props: { day: Day; dayIndex: number; tz: string; isToday: boolean; hasEve: boolean } & Omit<Props, "week" | "today">) {
  const { colors, minFocusWindow, compact } = props;
  const { day, dayIndex, tz, isToday } = props;
  const overflow = day.kind === "overflow";
  const offDay = day.kind !== "work" && day.am.off && day.pm.off;
  const menu = useMenu((env) => dayMenu(env, day.date));
  const halves = cardHalves(day);
  // Step 13.5: open follow-ups on the client's first block of the day; dated ones also on their due day.
  const pv = useContext(PlanCtx);
  const fuOn = followUpsOnDay(
    day.date,
    halves.map((h) => {
      const sl = slotOf(day, h)!;
      return { half: h, clientKey: overflow || day.kind === "weekend" || h === "EVE" ? null : (sl.focus[0]?.clientKey ?? null), working: !sl.off && !day.pto };
    }),
    pv.followUps ?? [],
    pv.today ?? day.date,
  );
  // Medium layout shares rows across days: a day without a card in a row keeps an empty cell there.
  // An evening-only day (a weekend flex session) gets one card spanning the three rows.
  const rows: (typeof halves[number] | null)[] = props.layout === "medium" && props.hasEve && !eveOnly(day) && !day.eve ? [...halves, null] : halves;
  const firstView = (day.eve && eveOnly(day) ? day.eve : day.am).view.start;
  // Step 13.6 (D240): Plan, Planned ✓, Friday's Add hours link, or nothing.
  const dayPlan = pv.week?.[day.date];
  const btn = planButton({
    date: day.date,
    today: pv.today ?? "",
    pto: !!day.pto,
    hasHours: !(day.am.off && day.pm.off && (!day.eve || day.eve.off)) || day.flexMinutes > 0,
    committed: !!dayPlan?.committedAt,
    hasPicks: (dayPlan?.picks ?? []).some((p) => p.status === "planned" || p.status === "done"),
  });
  const lastView = (day.eve ?? day.pm).view.end;

  return (
    <section className={`day ${overflow ? "overflow" : day.kind === "weekend" ? "weekend overflow" : "work"} ${isToday ? "today" : ""} ${day.pto ? "pto-full" : ""}`} aria-label={`${day.weekday} ${shortDate(day.date)}${day.pto ? `, ${ptoLabel(day.pto)}` : ""}`}>
      <header className="day-head" onContextMenu={menu.onContextMenu}>
        <span className="dow">{day.weekday}</span>
        <span className="date">{shortDate(day.date)}</span>
        {isToday && <span className="today-pill">Today</span>}
        {overflow && !day.pto && <span className="overflow-pill">{offDay ? "Overflow · catch-up" : "Working hours"}</span>}
        {day.kind === "weekend" && !day.pto && <span className="overflow-pill">{day.flexMinutes > 0 ? "Flex" : "Weekend"}</span>}
        {day.pto && (
          <span className="pto-pill full" title={day.pto.titles.join(", ")}>
            {ptoLabel(day.pto)}
          </span>
        )}
        {btn === "plan" || btn === "planned" ? (
          <button type="button" className={`day-plan ${btn}`} onClick={() => props.onPlanDay?.(day.date)} title={btn === "planned" ? "Planned: open it to see or change the plan" : "Plan this day"}>
            {btn === "planned" ? "Planned ✓" : "Plan"}
          </button>
        ) : btn === "add_hours" ? (
          <button type="button" className="day-addhours" onClick={() => props.onAddHours?.(day.date)} title="Friday has catch-up work but no working hours">
            Add hours
          </button>
        ) : null}
        {/* In the Tab order only for the selected day (Shift+Tab from its half-day reaches it). */}
        <HalfScope.Provider value={props.selection.dayIndex === dayIndex}>{menu.button(`Actions for ${day.weekday} ${shortDate(day.date)}`)}</HalfScope.Provider>
      </header>

      <Strip kind="allday" label="All day" items={day.allDay.map((e) => ({ key: e.id, e, time: "" }))} />
      <Strip kind="early" label={hourLabel(firstView, tz) === "midnight" ? "" : `Before ${hourLabel(firstView, tz)}`} items={day.early.map((p) => ({ key: p.event.id, e: p.event, time: startClock(p.event.start, tz) }))} />

      {rows.map((half, k) =>
        half === null ? (
          <div key={`gap-${k}`} className="half-gap" aria-hidden="true" />
        ) : (
        <HalfDay
          key={half}
          slot={slotOf(day, half)!}
          overflow={overflow || day.kind === "weekend"}
          offDay={offDay}
          tag={eveOnly(day) ? (day.flexMinutes > 0 ? "Flex" : "Hours") : undefined}
          tz={tz}
          colors={colors}
          minFocusWindow={minFocusWindow}
          selected={props.selection.dayIndex === dayIndex && props.selection.half === half}
          refFn={(el) => {
            const k = `${dayIndex}${half}`;
            if (el) props.cellRefs.set(k, el);
            else props.cellRefs.delete(k);
          }}
          onSelect={() => props.onSelect({ dayIndex, half })}
          onOpen={() => props.onOpen({ dayIndex, half })}
          dayLabel={`${day.weekday} ${shortDate(day.date)}`}
          compact={compact}
          now={props.now}
          ptoOff={!!day.pto}
          followUps={fuOn.get(half) ?? []}
          earlier={new Set(half === "PM" ? day.am.events.map((p) => p.event.id) : half === "EVE" ? day.pm.events.map((p) => p.event.id) : [])}
          addWork={props.onAddWork && canAddWork({ date: day.date, today: pv.today ?? "", pto: !!day.pto, off: slotOf(day, half)!.off }) ? () => props.onAddWork!(day.date, half) : undefined}
        />
        ),
      )}

      <Strip kind="evening" label={hourLabel(lastView, tz) === "midnight" ? "" : `After ${hourLabel(lastView, tz)}`} items={day.evening.map((p) => ({ key: p.event.id, e: p.event, time: startClock(p.event.start, tz) }))} />
    </section>
  );
}

function Strip({ kind, label, items }: { kind: string; label: string; items: { key: string; e: CalEvent; time: string }[] }) {
  const samples = useContext(SampleSources);
  return (
    <div className={`strip ${kind} ${items.length ? "" : "empty"}`}>
      <span className="strip-label">{label}</span>
      {items.map(({ key, e, time }) => (
        <span key={key} className={`chip ${e.unavailable ? "unavailable" : e.isPersonal ? "personal" : "meeting"}`} title={`${e.title} · ${sourceName(e, samples)}`}>
          {time && <span className="chip-time">{time}</span>}
          {e.title}
        </span>
      ))}
    </div>
  );
}

type HalfProps = {
  /** Ids of events drawn in the block before this one on the same day (labelHere, D271). */
  earlier: ReadonlySet<string>;
  slot: Slot;
  colors: Record<string, string>;
  minFocusWindow: number;
  overflow: boolean;
  /** Friday or a weekend day with no working hours (only catch-up or a flex session). */
  offDay: boolean;
  /** Replaces the AM/PM/Eve tag (an evening-only day says Flex). */
  tag?: string | undefined;
  tz: string;
  selected: boolean;
  dayLabel: string;
  refFn: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onOpen: () => void;
  /** A compact card (no hour timeline) for the medium layout. */
  compact: boolean;
  now: string;
  /** A full PTO day: the card is dimmed and shows the PTO instead of free time. */
  ptoOff: boolean;
  /** Follow-ups to show on this card (step 13.5); at most three, then "+N more" (step 13.6). */
  followUps: readonly FollowUpView[];
  /** "+ Add work" (step 13.6): opens Plan the day on this block's picker. Absent where work can't be added. */
  addWork?: (() => void) | undefined;
};

function HalfDay({ earlier, slot, colors, minFocusWindow, overflow, offDay, tag, tz, selected, dayLabel, refFn, onSelect, onOpen, compact, now, ptoOff, followUps, addWork }: HalfProps) {
  const primary = slot.focus[0];
  const sev = worstSeverity(slot.risks);
  const allWork = useContext(DevOpsWork);
  const plan = useContext(PlanCtx);
  // Only the block's own client; Open half-days and Friday have no client, so nothing from DevOps.
  const work = primary && !overflow ? allWork.get(primary.clientKey) : undefined;
  const eve = slot.half === "EVE";
  // Committed: picks with their fit, the DevOps list without picked items and collapsed (step 6.1).
  const cp = cardPlan(plan.week, slot, primary?.clientKey ?? null, work?.items ?? [], now, plan.sizes, plan.timeboxes);
  // Step 13.6 (D238): Friday's catch-up work shows on its card even though Friday is never committed.
  const ticks = overflow && !eve && !cp.picks.length ? catchUp(plan.week, slot) : cp.picks;
  const checklist = ticks.length > 0 && (
    <div className="card-plan">
      <ul className="checklist" aria-label={`Committed plan for ${dayLabel} ${slot.half}`}>
        {ticks.map((p) => (
          <PickRow key={p.id} pick={p} toggle={plan.toggle} tabIndex={selected ? 0 : -1} />
        ))}
      </ul>
    </div>
  );
  const rc = useContext(RulerCtx);
  const ruler = compact && !ptoOff && showRuler(rc.layout, rc.on, slot);
  const style = { "--c": clientColor(primary?.clientKey, colors), ...(compact ? {} : { flexGrow: minutesOf(slot) }) } as CSSProperties;
  const state = eve ? "eve" : overflow ? "overflow" : slot.open ? "open" : slot.off ? "off" : "focus";
  const reasonsId = `reasons-${slot.date}-${slot.half}`;
  const label = `${dayLabel} ${eve ? "evening" : slot.half}, ${primary ? primary.clientName : eve ? (slot.flex.length ? "flex session" : "evening hours") : overflow ? "overflow" : slot.off ? "no working hours" : "Open"}${ptoOff ? ", PTO" : ""}${sev ? `, ${sev === "at_risk" ? "at risk" : "watch"}` : ""}`;
  const menu = useMenu((env) => slotMenu(env, slot.date, slot.half, primary?.clientKey ?? null, primary?.clientName ?? null));
  const more_ = menu.button(`Actions for ${dayLabel} ${slot.half}`);
  // Step 10: one status per block; free time, DevOps items and resume notes are in the details panel (Enter).
  const status = blockStatus(cp.fit, slot.risks);
  const summary = <SlotNote slot={slot} ptoOff={ptoOff} offDay={offDay} />;
  const flexList = slot.flex.length > 0 && (
    <ul className="flex-list" aria-label="Flex sessions">
      {slot.flex.map((f) => (
        <li key={f.id} title={f.note ?? ""}>
          <span className="flex-tag">Flex</span>
          <span className="flex-time">{startClock(f.start, tz)}–{startClock(f.end, tz)}</span>
          <span className="flex-what">{f.clientKey}{f.itemTitle ? ` · ${f.itemTitle}` : f.note ? ` · ${f.note}` : ""}</span>
          {!!f.overlapMinutes && <span className="flex-overlap">{formatDuration(f.overlapMinutes)} inside working hours, not counted</span>}
        </li>
      ))}
    </ul>
  );

  const badge = status.kind !== "none" && (
    <div className="badges" id={reasonsId}>
      <span className={`status-pill ${status.kind}`} title={status.detail ?? undefined}>
        {status.label}
      </span>
      {status.detail && <span className="sr-only">{status.detail}</span>}
    </div>
  );
  // Committed features (step 8): placed on this block, or the client's not yet placed. Not on the evening slot.
  const { env: menuEnv } = useContext(MenuCtx);
  const canPlan = !!addWork;
  const feats = !eve && !ptoOff && (slot.half === "AM" || slot.half === "PM") ? featuresOn(plan.weekFeatures ?? [], slot.date, slot.half, primary?.clientKey ?? null) : [];
  const featList = feats.length > 0 && (
    <ul className="week-feats" aria-label="Features committed this week">
      {feats.map((f) => (
        <li key={f.id} title={`Planned for this week: ${f.blocks} block${f.blocks === 1 ? "" : "s"}${f.slots.some((x) => x.date === slot.date && x.half === slot.half) ? ", placed here" : ""}`}>
          <span className="feat-tag">This week:</span>{" "}
          {menuEnv?.planFeature && canPlan ? (
            <button type="button" className="link-btn feat-link" tabIndex={selected ? 0 : -1} onClick={(e) => (e.stopPropagation(), menuEnv.planFeature!(slot.date, slot.half, f.itemId))} onDoubleClick={(e) => e.stopPropagation()} title="Plan this block from that feature">
              {f.title}
            </button>
          ) : (
            f.title
          )}
        </li>
      ))}
    </ul>
  );
  const fuCap = capFollowUps(followUps);
  const fuList = followUps.length > 0 && (
    <ul className="week-fus" aria-label="Follow-ups">
      {fuCap.shown.map((f) => (
        <li key={f.id} className={f.dueState ? `due-${f.dueState.level}` : undefined} title={`Follow-up${f.hasWho ? ` to ${f.who}` : ""}: ${f.what}`}>
          <span className="fu-tag">Follow-up</span>
          {f.dueState && f.dueState.level !== "later" && <span className={`due-badge ${f.dueState.level}`}>{f.dueState.text}</span>}
          <span className="fu-what">{f.what}</span>
        </li>
      ))}
      {fuCap.more > 0 && (
        <li className="fu-more">
          <button
            type="button"
            className="link-btn"
            tabIndex={selected ? 0 : -1}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            title="Open the details for every follow-up"
          >
            +{fuCap.more} more
          </button>
        </li>
      )}
    </ul>
  );
  const addBtn = addWork && (
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
      onDoubleClick={(e) => e.stopPropagation()}
    >
      + Add work
    </button>
  );
  const who = primary ? (
    <>
      <div className="client">
        <span className="swatch" />
        {primary.clientName}
      </div>
      {featList}
      {fuList}
      {slot.focus.slice(1).map((b) => (
        <div key={b.id} className="also" style={{ "--c2": clientColor(b.clientKey, colors) } as CSSProperties}>
          <span className="swatch small" />
          Also booked: {b.clientName}
        </div>
      ))}
    </>
  ) : eve ? null : slot.off ? (
    <div className="client open-label off-label">{overflow ? "Catch-up" : "No working hours"}</div>
  ) : (
    <>
      <div className="client open-label">Open</div>
      {featList}
      {fuList}
    </>
  );

  return (
    <div
      ref={refFn}
      className={`half ${state} ${tag ? "span-all" : ""} ${sev ?? ""} ${selected ? "selected" : ""} ${compact ? "card" : ""}${ruler ? " has-ruler" : ""} ${ptoOff ? "pto-off" : ""}`}
      style={style}
      tabIndex={selected ? 0 : -1}
      role="button"
      aria-label={label}
      aria-describedby={slot.risks.length ? reasonsId : undefined}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        onSelect();
        menu.onContextMenu(e);
      }}
    >
      <HalfScope.Provider value={selected}>
      {compact ? (
        <>
          <CardBody tag={tag} slot={slot} tz={tz} overflow={overflow && !eve} who={who} badge={badge} checklist={checklist} summary={summary} more={more_} flex={flexList} add={addBtn} />
          {ruler && <Ruler slot={slot} tz={tz} label={`${dayLabel} ${eve ? "evening" : slot.half}`} />}
        </>
      ) : (
        <>
      {overflow && !eve && checklist && (
        <aside className="rail catchup">
          <div className="half-label">
            <span className="half-tag">{tag ?? halfTag(slot.half)}</span> Catch-up
            {more_}
          </div>
          {checklist}
        </aside>
      )}
      {(!overflow || eve) && (
        <aside className="rail">
          <div className="half-label">
            <span className="half-tag">{tag ?? halfTag(slot.half)}</span> {slotRange(slot, tz)}
            {more_}
          </div>
          {who}
          {badge}
          {summary}
          {flexList}
          {checklist}
          {addBtn}
        </aside>
      )}

          <Timeline slot={slot} tz={tz} earlier={earlier} showGaps={(!overflow || eve) && !slot.open} minFocusWindow={minFocusWindow} />
        </>
      )}
      </HalfScope.Provider>
    </div>
  );
}

/** Picks moved to the overflow day (step 13.6, D238): planned and done ones, committed or not. */
function catchUp(week: PlanView["week"], slot: Slot): Pick[] {
  return (week?.[slot.date]?.picks ?? []).filter((p) => p.half === slot.half && (p.status === "planned" || p.status === "done"));
}

/** A PTO day or a half-day without working hours says so; free time is in the details panel (step 10). */
function SlotNote({ slot, ptoOff, offDay }: { slot: Slot; ptoOff: boolean; offDay: boolean }) {
  if (ptoOff) return <div className="stats pto">PTO · nothing planned</div>;
  if (slot.off) return <div className="stats off">{offDay && slot.half !== "EVE" ? "Not a working day" : "No working hours"}</div>;
  return null;
}

export function ptoLabel(p: PtoDay): string {
  return `PTO · ${p.titles.join(", ")}`;
}

const MAX_MEETINGS = 4;
const MAX_PERSONAL = 3;

/** Compact half-day: client, free time, one badge, meetings and personal events as short lists, top DevOps items. */
function CardBody({ tag, slot, tz, overflow, who, badge, checklist, summary, more, flex, add }: { slot: Slot; tz: string; overflow: boolean; who: ReactNode; badge: ReactNode; checklist: ReactNode; summary: ReactNode; more: ReactNode; flex: ReactNode; add: ReactNode; tag?: string | undefined }) {
  const meetings = slot.events.filter((p) => !p.event.isPersonal);
  const personal = slot.events.filter((p) => p.event.isPersonal);
  return (
    <div className="card-body">
      <div className="half-label">
        <span className="half-tag">{tag ?? halfTag(slot.half)}</span> {slotRange(slot, tz)}
        {more}
      </div>
      {!overflow && who}
      {!overflow && badge}
      {summary}
      {flex}
      {checklist}
      <TimeboxList slot={slot} />
      <EventList kind="meeting" label="Meetings" events={meetings} max={MAX_MEETINGS} tz={tz} />
      <EventList kind="personal" label="Personal" events={personal} max={MAX_PERSONAL} tz={tz} />
      {add}
    </div>
  );
}

function EventList({ kind, label, events, max, tz }: { kind: "meeting" | "personal"; label: string; events: PlacedEvent[]; max: number; tz: string }) {
  const samples = useContext(SampleSources);
  if (events.length === 0) return null;
  const shown = events.slice(0, max);
  return (
    <ul className={`ev-list ${kind}`} aria-label={label}>
      {shown.map((p) => <EventItem key={p.event.id} e={p.event} tz={tz} samples={samples} />)}
      {events.length > max && <li className="ev-more">+{events.length - max} more</li>}
    </ul>
  );
}

function EventItem({ e, tz, samples }: { e: CalEvent; tz: string; samples: ReadonlySet<string> }) {
  const show = e.showAs ?? "busy";
  const menu = useEventMenu(e);
  return (
    <li className={`show-${show}`} title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e, samples)} · ${showAsLabel(e)}`} {...menu}>
      <span className="ev-time">{startClock(e.start, tz)}</span>
      <span className="ev-title">{e.title}</span>
    </li>
  );
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

function Timeline({ slot, tz, showGaps, minFocusWindow, earlier }: { slot: Slot; tz: string; showGaps: boolean; minFocusWindow: number; earlier: ReadonlySet<string> }) {
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
      <div className="lanes">
        {laid.map(({ placed, top, height, lane, lanes }) => (
          <EventCard key={placed.event.id} placed={placed} tz={tz} label={labelHere(placed, earlier)} style={{ top: pct(top), height: pct(height), left: `calc(${pct(lane / lanes)} + 4px)`, width: `calc(${pct(1 / lanes)} - 8px)` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Step 15.1 (D276): a narrow time ruler on the right edge of a compact card, covering only the block's working hours:
 * free stretches, meetings, personal events and unavailable time, and timed picks as bands in client color. A pick
 * band opens the time editor; an event opens its menu. The list on the left is unchanged.
 */
function Ruler({ slot, tz, label }: { slot: Slot; tz: string; label: string }) {
  const bounds = { start: slot.start, end: slot.end };
  const span = Math.max(1, ms(slot.end) - ms(slot.start));
  const pos = (iso: string) => (ms(iso) - ms(slot.start)) / span;
  const marks = hourMarks(slot.start, slot.end, tz);
  const laid = layoutEvents(slot.events.filter((p) => !p.event.allDay), slot.start, slot.end);
  return (
    <div className="ruler" aria-label={`Timeline for ${label}, ${slotRange(slot, tz)}`} onDoubleClick={(e) => e.stopPropagation()}>
      {marks.map((m) => (
        <div key={m.label} className="r-hour" style={{ top: pct(m.at) }} aria-hidden="true">
          <span>{m.label.replace(/ (AM|PM)$/, "")}</span>
        </div>
      ))}
      {slot.freeGaps.map((g) => {
        const at = rulerSpan(slot, g.start, g.end);
        return at && (
          <div key={`f-${g.start}`} className="r-free" style={{ top: pct(at.top), height: pct(at.height) }} title={`Free · ${formatDuration(g.minutes)}`} aria-hidden="true">
            {g.minutes >= 45 && <span>{formatDuration(g.minutes)}</span>}
          </div>
        );
      })}
      {laid.map(({ placed, lane, lanes }) => {
        const at = rulerSpan(slot, placed.clipStart, placed.clipEnd);
        return at && <RulerEvent key={placed.event.id} e={placed.event} tz={tz} style={{ top: pct(at.top), height: `max(${pct(at.height)}, 6px)`, left: `calc(${pct(lane / lanes)} + 2px)`, width: `calc(${pct(1 / lanes)} - 4px)` }} />;
      })}
      <TimeboxBands slot={slot} pos={pos} bounds={bounds} />
    </div>
  );
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
function useEventMenu(e: CalEvent) {
  const menu = useMenu((env) => eventMenu(env, e));
  const live = !e.unavailable && e.source !== "coopilot";
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
      title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e, samples)} · ${showAsLabel(e)}${e.unavailable ? "" : "\nClick for what Coopilot can do with it"}`}
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

/** "9 AM", "5:30 PM": strip labels around the timelines. */
function hourLabel(iso: string, tz: string): string {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
  if (z.hour === 0 && z.minute === 0) return "midnight";
  return `${z.hour % 12 || 12}${z.minute ? `:${String(z.minute).padStart(2, "0")}` : ""} ${z.hour < 12 ? "AM" : "PM"}`;
}

const pct = (f: number) => `${(f * 100).toFixed(3)}%`;
