import { useContext, useState, type CSSProperties, type ReactNode } from "react";
import { formatDuration } from "../week/format.ts";
import { topRisk, worstSeverity } from "../week/risks.ts";
import type { CalEvent, Day, Half, PlacedEvent, Slot, Week, WorkItem } from "../week/types.ts";
import type { PtoDay } from "../week/pto.ts";
import type { Pick } from "../plan/types.ts";
import { freeMinutes, longestFree, nowIfUnderway } from "../week/free.ts";
import { dayMenu, itemMenu, pickMenu, slotMenu } from "./menu.ts";
import { useMenu } from "./Menus.tsx";
import { hourMarks, layoutEvents } from "./layout.ts";
import { DevOpsWork, typeTag, workStatusLabel } from "./work.ts";
import { clientColor, eventRange, halfTag, ruleLabel, SampleSources, severityLabel, shortDate, showAsLabel, slotRange, sourceName, startClock } from "./labels.ts";
import { cardHalves, eveOnly, slotOf } from "./halves.ts";
import type { Layout } from "./viewport.ts";
import { CARD_ITEMS, cardPlan, PlanCtx } from "./planview.ts";
import { fitLabel } from "./planday.ts";
import { WorkLink } from "./WorkLink.tsx";
import { ITEM_ATTRS } from "./keys.ts";
import { HalfScope, useScopedTab } from "./scope.ts";

export type Selection = { dayIndex: number; half: Half };

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
  /** Plan the day: this day's column becomes the planning panel; the rest of the week is dimmed. */
  planDay?: { dayIndex: number; node: ReactNode } | undefined;
};

export function WeekGrid({ week, colors, minFocusWindow, today, now, selection, cellRefs, onSelect, onOpen, layout, compact, planDay }: Props) {
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
  const slots = [day.am, day.pm, ...(day.eve ? [day.eve] : [])];
  const risks = slots.flatMap((s) => s.risks);
  const atRisk = slots.filter((s) => worstSeverity(s.risks) === "at_risk").length;
  const watch = slots.filter((s) => worstSeverity(s.risks) === "watch").length;
  const menu = useMenu((env) => dayMenu(env, day.date));
  const halves = cardHalves(day);
  // Medium layout shares rows across days: a day without a card in a row keeps an empty cell there.
  // An evening-only day (a weekend flex session) gets one card spanning the three rows.
  const rows: (typeof halves[number] | null)[] = props.layout === "medium" && props.hasEve && !eveOnly(day) && !day.eve ? [...halves, null] : halves;
  const firstView = (day.eve && eveOnly(day) ? day.eve : day.am).view.start;
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
        <span className="day-sum">
          {atRisk > 0 && <span className="sum at_risk">{atRisk} at risk</span>}
          {watch > 0 && <span className="sum watch">{watch} watch</span>}
          {day.kind === "work" && !day.pto && risks.length === 0 && <span className="sum ok">Clear</span>}
        </span>
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
};

function HalfDay({ slot, colors, minFocusWindow, overflow, offDay, tag, tz, selected, dayLabel, refFn, onSelect, onOpen, compact, now, ptoOff }: HalfProps) {
  const primary = slot.focus[0];
  const sev = worstSeverity(slot.risks);
  const { top, more } = topRisk(slot.risks);
  const allWork = useContext(DevOpsWork);
  const plan = useContext(PlanCtx);
  const [showItems, setShowItems] = useState(false);
  // Only the block's own client; Open half-days and Friday have no client, so nothing from DevOps.
  const work = primary && !overflow ? allWork.get(primary.clientKey) : undefined;
  const eve = slot.half === "EVE";
  // Committed: picks with their fit, the DevOps list without picked items and collapsed (step 6.1).
  const cp = cardPlan(plan.week, slot, primary?.clientKey ?? null, work?.items ?? [], now, plan.sizes);
  const ticks = cp.picks;
  const checklist = ticks.length > 0 && (
    <div className="card-plan">
      {cp.fit && (
        <div className="plan-fit" title="Planned picks against this block's free time">
          <span className="pf-label">Plan</span>
          <span className={`fit ${cp.fit.kind}`}>{fitLabel(cp.fit)}</span>
        </div>
      )}
      <ul className="checklist" aria-label={`Committed plan for ${dayLabel} ${slot.half}`}>
        {ticks.map((p) => (
          <PickRow key={p.id} pick={p} toggle={plan.toggle} />
        ))}
      </ul>
    </div>
  );
  const collapsed = cp.collapsed && !showItems;
  const items = { top: collapsed ? [] : cp.items.slice(0, CARD_ITEMS), more: collapsed ? 0 : Math.max(0, cp.items.length - CARD_ITEMS) };
  const style = { "--c": clientColor(primary?.clientKey, colors), ...(compact ? {} : { flexGrow: minutesOf(slot) }) } as CSSProperties;
  const state = eve ? "eve" : overflow ? "overflow" : slot.open ? "open" : slot.off ? "off" : "focus";
  const reasonsId = `reasons-${slot.date}-${slot.half}`;
  const label = `${dayLabel} ${eve ? "evening" : slot.half}, ${primary ? primary.clientName : eve ? (slot.flex.length ? "flex session" : "evening hours") : overflow ? "overflow" : slot.off ? "no working hours" : "Open"}${ptoOff ? ", PTO" : ""}${sev ? `, ${sev === "at_risk" ? "at risk" : "watch"}` : ""}`;
  const menu = useMenu((env) => slotMenu(env, slot.date, slot.half, primary?.clientKey ?? null, primary?.clientName ?? null));
  const more_ = menu.button(`Actions for ${dayLabel} ${slot.half}`);
  const summary = <SlotSummary slot={slot} now={now} ptoOff={ptoOff} offDay={offDay} />;
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

  const workList = work && (
    <>
      {cp.collapsed && cp.items.length > 0 && (
        <ItemsToggle open={showItems} count={cp.items.length} onToggle={() => setShowItems((o) => !o)} label={`${primary!.clientName} DevOps items`} />
      )}
      {items.top.length > 0 && (
        <ul className="work-items" aria-label={`DevOps items assigned to you for ${primary!.clientName}`}>
          {items.top.map((i) => (
            <WorkRow key={i.id} clientKey={primary!.clientKey} item={i} />
          ))}
          {items.more > 0 && <li className="wi-more">+{items.more} more</li>}
        </ul>
      )}
      {cp.items.length === 0 && work.status !== "ok" && <div className="work-note">DevOps: {workStatusLabel(work)}</div>}
    </>
  );
  const badge = top && (
    <div className="badges" id={reasonsId}>
      <div className={`badge ${top.severity}`}>
        <span className="badge-text">
          <span className="dot" aria-hidden="true" />
          {severityLabel(top)}: {ruleLabel[top.rule]}
          {more > 0 && <span className="more">+{more} more</span>}
        </span>
        <span className="reason">{top.reason}</span>
      </div>
    </div>
  );
  const who = primary ? (
    <>
      <div className="client">
        <span className="swatch" />
        {primary.clientName}
      </div>
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
    </>
  );

  return (
    <div
      ref={refFn}
      className={`half ${state} ${tag ? "span-all" : ""} ${sev ?? ""} ${selected ? "selected" : ""} ${compact ? "card" : ""} ${ptoOff ? "pto-off" : ""}`}
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
        <CardBody tag={tag} slot={slot} tz={tz} overflow={overflow && !eve} who={who} badge={badge} workList={workList} checklist={checklist} summary={summary} more={more_} flex={flexList} />
      ) : (
        <>
      {(!overflow || eve) && (
        <aside className="rail">
          <div className="half-label">
            <span className="half-tag">{tag ?? halfTag(slot.half)}</span> {slotRange(slot, tz)}
            {more_}
          </div>
          {who}
          {summary}
          {flexList}

          {checklist}
          {workList}
          {badge}
        </aside>
      )}

          <Timeline slot={slot} tz={tz} showGaps={(!overflow || eve) && !slot.open} minFocusWindow={minFocusWindow} />
        </>
      )}
      </HalfScope.Provider>
    </div>
  );
}

/** "2h meetings · 2h 15m free · longest 1h" in every layout (D100); the PTO instead on a full PTO day. */
function SlotSummary({ slot, now, ptoOff, offDay }: { slot: Slot; now: string; ptoOff: boolean; offDay: boolean }) {
  if (ptoOff) return <div className="stats pto">PTO · nothing planned</div>;
  if (slot.off) return <div className="stats off">{offDay && slot.half !== "EVE" ? "Not a working day" : "No working hours"}</div>;
  const at = nowIfUnderway(slot, now);
  const free = freeMinutes(slot, at);
  return (
    <div className="stats" title={at ? "Free time from now on" : "Free time in this half-day"}>
      <span>{formatDuration(slot.busyMeetingMinutes)} meetings</span>
      <span className="free">
        {formatDuration(free)} free{at ? " left" : ""}
      </span>
      <span>longest {formatDuration(longestFree(slot, at))}</span>
    </div>
  );
}

/** A work item on a card: opens in Edge; "⋯" or right-click for the rest. */
function WorkRow({ clientKey, item }: { clientKey: string; item: WorkItem }) {
  const menu = useMenu((env) => itemMenu(env, clientKey, item));
  return (
    <li title={`${item.type} ${item.id}: ${item.title} (${item.state})`} onContextMenu={menu.onContextMenu} {...ITEM_ATTRS(clientKey, item.url)}>
      <span className="wi-type">{typeTag(item.type)}</span>
      <WorkLink clientKey={clientKey} url={item.url} className="wi-title">
        {item.title}
      </WorkLink>
      {menu.button(`Actions for ${item.type} ${item.id}`)}
    </li>
  );
}

/** Committed cards keep their DevOps items behind "+N more items" (step 6.1). */
function ItemsToggle({ open, count, onToggle, label }: { open: boolean; count: number; onToggle: () => void; label: string }) {
  const tabIndex = useScopedTab();
  return (
    <button type="button" className="items-toggle" tabIndex={tabIndex} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${count} ${label}`} onClick={onToggle} onDoubleClick={(e) => e.stopPropagation()}>
      {open ? "Hide items" : `+${count} more ${count === 1 ? "item" : "items"}`}
    </button>
  );
}

/** A committed pick on a card: tick it, or "⋯" / right-click for size, move, drop and more. */
function PickRow({ pick, toggle }: { pick: Pick; toggle: (id: number, done: boolean) => void }) {
  const menu = useMenu((env) => pickMenu(env, pick));
  const tabIndex = useScopedTab();
  return (
    <li className={pick.status} onContextMenu={menu.onContextMenu} {...ITEM_ATTRS(pick.clientKey, pick.itemUrl)}>
      <label onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <input type="checkbox" tabIndex={tabIndex} checked={pick.status === "done"} onChange={(e) => toggle(pick.id, e.target.checked)} />
        <span className="ck-title" title={pick.title}>{pick.title}</span>
        <span className="size-tag">{pick.size}</span>
      </label>
      {menu.button(`Actions for ${pick.title}`)}
    </li>
  );
}

export function ptoLabel(p: PtoDay): string {
  return `PTO · ${p.titles.join(", ")}`;
}

const MAX_MEETINGS = 4;
const MAX_PERSONAL = 3;

/** Compact half-day: client, free time, one badge, meetings and personal events as short lists, top DevOps items. */
function CardBody({ tag, slot, tz, overflow, who, badge, workList, checklist, summary, more, flex }: { slot: Slot; tz: string; overflow: boolean; who: ReactNode; badge: ReactNode; workList: ReactNode; checklist: ReactNode; summary: ReactNode; more: ReactNode; flex: ReactNode; tag?: string | undefined }) {
  const meetings = slot.events.filter((p) => !p.event.isPersonal);
  const personal = slot.events.filter((p) => p.event.isPersonal);
  return (
    <div className="card-body">
      <div className="half-label">
        <span className="half-tag">{tag ?? halfTag(slot.half)}</span> {slotRange(slot, tz)}
        {more}
      </div>
      {!overflow && who}
      {summary}
      {flex}
      {!overflow && badge}
      {checklist}
      <EventList kind="meeting" label="Meetings" events={meetings} max={MAX_MEETINGS} tz={tz} />
      <EventList kind="personal" label="Personal" events={personal} max={MAX_PERSONAL} tz={tz} />
      {workList}
    </div>
  );
}

function EventList({ kind, label, events, max, tz }: { kind: "meeting" | "personal"; label: string; events: PlacedEvent[]; max: number; tz: string }) {
  const samples = useContext(SampleSources);
  if (events.length === 0) return null;
  const shown = events.slice(0, max);
  return (
    <ul className={`ev-list ${kind}`} aria-label={label}>
      {shown.map((p) => {
        const e = p.event;
        const show = e.showAs ?? "busy";
        return (
          <li key={e.id} className={`show-${show}`} title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e, samples)} · ${showAsLabel(e)}`}>
            <span className="ev-time">{startClock(e.start, tz)}</span>
            <span className="ev-title">{e.title}</span>
          </li>
        );
      })}
      {events.length > max && <li className="ev-more">+{events.length - max} more</li>}
    </ul>
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

function Timeline({ slot, tz, showGaps, minFocusWindow }: { slot: Slot; tz: string; showGaps: boolean; minFocusWindow: number }) {
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
      <div className="lanes">
        {laid.map(({ placed, top, height, lane, lanes }) => (
          <EventCard key={placed.event.id} placed={placed} tz={tz} style={{ top: pct(top), height: pct(height), left: `calc(${pct(lane / lanes)} + 4px)`, width: `calc(${pct(1 / lanes)} - 8px)` }} />
        ))}
      </div>
    </div>
  );
}

function EventCard({ placed, tz, style }: { placed: PlacedEvent; tz: string; style: CSSProperties }) {
  const e = placed.event;
  const samples = useContext(SampleSources);
  const kind = e.isPersonal ? "personal" : "meeting";
  const show = e.showAs ?? "busy";
  return (
    <div
      className={`event ${e.unavailable ? "unavailable" : kind} show-${show} ${placed.continuesBefore ? "cont-before" : ""} ${placed.continuesAfter ? "cont-after" : ""}`}
      style={style}
      title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e, samples)} · ${showAsLabel(e)}`}
    >
      <span className="ev-line">
        <span className="ev-time">{eventRange(e, tz)}</span>
        <span className="ev-title">{e.title}</span>
      </span>
      <span className="ev-meta">
        {e.unavailable ? "Unavailable" : sourceName(e, samples)}
        {show !== "busy" && show !== "unknown" ? ` · ${showAsLabel(e)}` : ""}
      </span>
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
