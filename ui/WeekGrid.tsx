import { createContext, useContext, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { TimeboxBands } from "./Timeboxes.tsx";
import { formatDuration } from "../week/format.ts";
import { worstSeverity } from "../week/risks.ts";
import type { CalEvent, Day, Half, PlacedEvent, Slot, Week } from "../week/types.ts";
import type { PtoDay } from "../week/pto.ts";
import type { Pick } from "../plan/types.ts";
import type { FollowUpView } from "../actions/types.ts";
import { weekDueBadges } from "../plan/due.ts";
import { canAddWork, planButton } from "../plan/days.ts";
import { dayMenu, eventMenu, slotMenu } from "./menu.ts";
import { useMenu } from "./Menus.tsx";
import { PickRow } from "./PickRow.tsx";
import { DueBadge } from "./FollowUps.tsx";
import { hourMarks, labelHere, layoutEvents, rulerSpan, showRuler } from "./layout.ts";
import { DevOpsWork } from "./work.ts";
import { clientColor, eventRange, SampleSources, shortDate, shortRange, showAsLabel, slotRange, sourceName, startClock } from "./labels.ts";
import { cardHalves, eveOnly, slotOf } from "./halves.ts";
import type { Layout } from "./viewport.ts";
import { cardPlan, clientFeatures, featuresLine, PlanCtx, storiesUnder, type PlanView } from "./planview.ts";
import { blockStatus } from "../plan/blockstatus.ts";
import { mondayOf } from "../week/dates.ts";

import { HalfScope } from "./scope.ts";
import { interactive } from "./DetailPanel.tsx";

export type Selection = { dayIndex: number; half: Half };
/** U3: where the detail panel opens: the features list, one follow-up or one pick. */
export type PanelFocus = { kind: "features" } | { kind: "followup"; id: number } | { kind: "pick"; id: number };

/** Step 15.1 (D276): the layout, for the time rail on each compact card (U3: always on, the one home for meetings). */
const RulerCtx = createContext<{ layout: Layout }>({ layout: "wide" });

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
};

export function WeekGrid(props: Props) {
  return (
    <RulerCtx.Provider value={{ layout: props.layout }}>
      <Grid {...props} />
    </RulerCtx.Provider>
  );
}

function Grid({ week, colors, minFocusWindow, today, now, selection, cellRefs, onSelect, onOpen, layout, compact, planDay, onPlanDay, onAddWork, onAddHours }: Props) {
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
      badges={badges}
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
function WholeDay({ day, kind, tz, selected, refAm, refPm, onOpen, dayLabel }: { day: Day; kind: "pto" | "catchup"; tz: string; selected: boolean; refAm: (el: HTMLDivElement | null) => void; refPm: (el: HTMLDivElement | null) => void; onOpen: (focus?: PanelFocus) => void; dayLabel: string }) {
  const plan = useContext(PlanCtx);
  const samples = useContext(SampleSources);
  // All-day events are chips under the day header (D406); the cell lists only timed events.
  const events = [...day.early, ...day.am.events, ...day.pm.events, ...day.evening].map((p) => ({ e: p.event, start: p.event.start }));
  const seen = new Set<string>();
  const lines = events.filter(({ e }) => !seen.has(e.id) && !!seen.add(e.id));
  const picks = kind === "catchup" ? [...catchUp(plan.week, day.am), ...catchUp(plan.week, day.pm)] : [];
  const label = kind === "pto" ? "PTO" : "Catch-up";
  return (
    <div
      ref={(el) => (refAm(el), refPm(el))}
      className={`half whole ${kind}${selected ? " selected" : ""}`}
      tabIndex={selected ? 0 : -1}
      role="button"
      aria-label={`${dayLabel}, ${kind === "pto" ? ptoLabel(day.pto!) : "catch-up, no working hours"}`}
      aria-pressed={selected}
      onClick={(e) => !interactive(e) && onOpen()}
    >
      <div className="whole-label" title={kind === "pto" && day.pto ? ptoLabel(day.pto) : undefined}>
        {label}
      </div>
      {picks.length > 0 && (
        <ul className="checklist" aria-label={`Catch-up work for ${dayLabel}`}>
          {picks.map((p) => (
            <PickRow key={p.id} pick={p} toggle={plan.toggle} density="week" tabIndex={selected ? 0 : -1} />
          ))}
        </ul>
      )}
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
};


function HalfDay({ earlier, slot, colors, minFocusWindow, overflow, span, tz, selected, dayLabel, refFn, onSelect, onOpen, compact, now, isToday, dueBadges, addWork }: HalfProps) {
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
  const shown = isToday ? ticks : ticks.filter((p) => p.status !== "done");
  const rc = useContext(RulerCtx);
  const ruler = compact && showRuler(rc.layout, slot);
  const style = { "--c": clientColor(primary?.clientKey, colors), ...(compact ? {} : { flexGrow: minutesOf(slot) }) } as CSSProperties;
  const state = eve ? "eve" : overflow ? "overflow" : slot.open ? "open" : slot.off ? "off" : "focus";
  const reasonsId = `reasons-${slot.date}-${slot.half}`;
  const name = primary ? primary.clientName : eve ? (slot.flex.length ? "Flex" : "Evening") : slot.off ? "No working hours" : overflow ? "Catch-up" : "Open";
  const label = `${dayLabel} ${eve ? "evening" : slot.half}, ${name}${sev ? `, ${sev === "at_risk" ? "at risk" : "watch"}` : ""}`;
  const menu = useMenu((env) => slotMenu(env, slot.date, slot.half, primary?.clientKey ?? null, primary?.clientName ?? null));
  const status = blockStatus(cp.fit, slot.risks);
  const pill = status.kind === "at_risk" ? `At risk${status.short ? ` · ${status.short}` : ""}` : status.label;

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
      <div className="card-head">
        <span className="swatch" aria-hidden="true" />
        <span className={`card-client${primary ? "" : " open-label"}`} title={name}>{name}</span>
        <span className="card-when">{shortRange(slot, tz)}</span>
        <span className="card-more">{menu.button(`Actions for ${dayLabel} ${slot.half}`)}</span>
      </div>
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
      {shown.length > 0 && (
        <ul className="checklist" aria-label={`Plan for ${dayLabel} ${slot.half}`}>
          {shown.map((p) => (
            <PickRow key={p.id} pick={p} toggle={plan.toggle} density="week" tabIndex={selected ? 0 : -1} />
          ))}
        </ul>
      )}
      {doneHidden.length > 0 && <div className="card-done">{doneHidden.length} done</div>}
      {addWork && (
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
      className={`half ${state} ${span ? "span-all" : ""} ${sev ?? ""} ${selected ? "selected" : ""} ${compact ? "card" : ""}${ruler ? " has-ruler" : ""}`}
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
            {ruler && <Ruler slot={slot} tz={tz} label={`${dayLabel} ${eve ? "evening" : slot.half}`} />}
          </>
        ) : (
          <>
            <aside className="card-main">{body}</aside>
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
      </div>
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
export function useEventMenu(e: CalEvent) {
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

const pct = (f: number) => `${(f * 100).toFixed(3)}%`;
