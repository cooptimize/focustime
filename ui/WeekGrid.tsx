import { useContext, type CSSProperties, type ReactNode } from "react";
import { formatDuration } from "../week/format.ts";
import { topRisk, worstSeverity } from "../week/risks.ts";
import type { CalEvent, Day, Half, PlacedEvent, Slot, Week } from "../week/types.ts";
import { hourMarks, layoutEvents } from "./layout.ts";
import { DevOpsWork, topWork, typeTag, workStatusLabel } from "./work.ts";
import { clientColor, eventRange, ruleLabel, SampleSources, severityLabel, shortDate, slotRange, sourceName, startClock } from "./labels.ts";
import type { Layout } from "./viewport.ts";
import { checklistFor, PlanCtx } from "./planview.ts";

export type Selection = { dayIndex: number; half: Half };

type Props = {
  week: Week;
  colors: Record<string, string>;
  minFocusWindow: number;
  today: string;
  selection: Selection;
  cellRefs: Map<string, HTMLDivElement>;
  onSelect: (s: Selection) => void;
  onOpen: (s: Selection) => void;
  /** wide: hour timelines; medium: compact cards; narrow: the selected day only. */
  layout: Layout;
  /** Half-days as compact cards (medium, and narrow windows too thin for rail plus timeline). */
  compact: boolean;
  /** Morning ignition: this day's column becomes the planning panel; the rest of the week is dimmed. */
  ignition?: { dayIndex: number; node: ReactNode } | undefined;
};

export function WeekGrid({ week, colors, minFocusWindow, today, selection, cellRefs, onSelect, onOpen, layout, compact, ignition }: Props) {
  const column = (day: Day, i: number) =>
    ignition?.dayIndex === i ? (
      <div key={day.date} className="ign-cell">
        {ignition.node}
      </div>
    ) : (
    <DayColumn
      key={day.date}
      day={day}
      dayIndex={i}
      tz={week.timeZone}
      colors={colors}
      minFocusWindow={minFocusWindow}
      isToday={day.date === today}
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
  // While planning, today's track widens and the other days stay visible behind a dim.
  const tracks = ignition
    ? week.days.map((_, i) => (i === ignition.dayIndex ? "minmax(0, 2.6fr)" : i === 4 ? (layout === "medium" ? "minmax(150px, 0.6fr)" : "minmax(0, 0.6fr)") : "minmax(0, 1fr)")).join(" ")
    : undefined;
  return (
    <main
      className={`grid ${layout} ${ignition ? "igniting" : ""}`}
      style={tracks ? { gridTemplateColumns: tracks } : undefined}
      role="group"
      aria-label="Week grid. Arrow keys move between half-days, Enter opens details."
    >
      {week.days.map(column)}
    </main>
  );
}

function DayColumn(props: { day: Day; dayIndex: number; tz: string; isToday: boolean } & Omit<Props, "week" | "today">) {
  const { colors, minFocusWindow, compact } = props;
  const { day, dayIndex, tz, isToday } = props;
  const overflow = day.kind === "overflow";
  const risks = [...day.am.risks, ...day.pm.risks];
  const atRisk = [day.am, day.pm].filter((s) => worstSeverity(s.risks) === "at_risk").length;
  const watch = [day.am, day.pm].filter((s) => worstSeverity(s.risks) === "watch").length;

  return (
    <section className={`day ${overflow ? "overflow" : "work"} ${isToday ? "today" : ""}`} aria-label={`${day.weekday} ${shortDate(day.date)}`}>
      <header className="day-head">
        <span className="dow">{day.weekday}</span>
        <span className="date">{shortDate(day.date)}</span>
        {isToday && <span className="today-pill">Today</span>}
        {overflow && <span className="overflow-pill">Overflow · catch-up</span>}
        <span className="day-sum">
          {atRisk > 0 && <span className="sum at_risk">{atRisk} at risk</span>}
          {watch > 0 && <span className="sum watch">{watch} watch</span>}
          {!overflow && risks.length === 0 && <span className="sum ok">Clear</span>}
        </span>
      </header>

      <Strip kind="allday" label="All day" items={day.allDay.map((e) => ({ key: e.id, e, time: "" }))} />
      <Strip kind="early" label="Before 9" items={day.early.map((p) => ({ key: p.event.id, e: p.event, time: startClock(p.event.start, tz) }))} />

      {(["AM", "PM"] as const).map((half) => (
        <HalfDay
          key={half}
          slot={half === "AM" ? day.am : day.pm}
          overflow={overflow}
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
        />
      ))}

      <Strip kind="evening" label="After 5" items={day.evening.map((p) => ({ key: p.event.id, e: p.event, time: startClock(p.event.start, tz) }))} />
    </section>
  );
}

function Strip({ kind, label, items }: { kind: string; label: string; items: { key: string; e: CalEvent; time: string }[] }) {
  const samples = useContext(SampleSources);
  return (
    <div className={`strip ${kind} ${items.length ? "" : "empty"}`}>
      <span className="strip-label">{label}</span>
      {items.map(({ key, e, time }) => (
        <span key={key} className={`chip ${e.isPersonal ? "personal" : "meeting"}`} title={`${e.title} · ${sourceName(e, samples)}`}>
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
  tz: string;
  selected: boolean;
  dayLabel: string;
  refFn: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onOpen: () => void;
  /** A compact card (no hour timeline) for the medium layout. */
  compact: boolean;
};

function HalfDay({ slot, colors, minFocusWindow, overflow, tz, selected, dayLabel, refFn, onSelect, onOpen, compact }: HalfProps) {
  const primary = slot.focus[0];
  const sev = worstSeverity(slot.risks);
  const { top, more } = topRisk(slot.risks);
  const allWork = useContext(DevOpsWork);
  const plan = useContext(PlanCtx);
  const ticks = checklistFor(plan.week, slot.date, slot.half);
  const checklist = ticks.length > 0 && (
    <ul className="checklist" aria-label={`Committed plan for ${dayLabel} ${slot.half}`}>
      {ticks.map((p) => (
        <li key={p.id} className={p.status}>
          <label onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={p.status === "done"} onChange={(e) => plan.toggle(p.id, e.target.checked)} />
            <span className="ck-title" title={p.title}>{p.title}</span>
            <span className="size-tag">{p.size}</span>
          </label>
        </li>
      ))}
    </ul>
  );
  // Only the block's own client; Open half-days and Friday have no client, so nothing from DevOps.
  const work = primary && !overflow ? allWork.get(primary.clientKey) : undefined;
  const items = topWork(work);
  const style = { "--c": clientColor(primary?.clientKey, colors), ...(compact ? {} : { flexGrow: minutesOf(slot) }) } as CSSProperties;
  const state = overflow ? "overflow" : slot.open ? "open" : "focus";
  const reasonsId = `reasons-${slot.date}-${slot.half}`;
  const label = `${dayLabel} ${slot.half}, ${primary ? primary.clientName : overflow ? "overflow" : "Open"}${sev ? `, ${sev === "at_risk" ? "at risk" : "watch"}` : ""}`;

  const workList = work && (
    <>
      {items.top.length > 0 && (
        <ul className="work-items" aria-label={`DevOps items assigned to you for ${primary!.clientName}`}>
          {items.top.map((i) => (
            <li key={i.id} title={`${i.type} ${i.id}: ${i.title} (${i.state})`}>
              <span className="wi-type">{typeTag(i.type)}</span>
              <span className="wi-title">{i.title}</span>
            </li>
          ))}
          {items.more > 0 && <li className="wi-more">+{items.more} more</li>}
        </ul>
      )}
      {items.top.length === 0 && work.status !== "ok" && <div className="work-note">DevOps: {workStatusLabel(work)}</div>}
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
      {!compact && (
        <div className="src" title={primary.clientFullName ?? primary.clientName}>
          {primary.source === "dataverse" ? `Dataverse focus block${primary.clientFullName ? ` · ${primary.clientFullName}` : ""}` : "Standing block · Coopilot config"}
        </div>
      )}
      {slot.focus.slice(1).map((b) => (
        <div key={b.id} className="also" style={{ "--c2": clientColor(b.clientKey, colors) } as CSSProperties}>
          <span className="swatch small" />
          Also booked: {b.clientName}
          {!compact && <span className="src"> · {b.source === "dataverse" ? "Dataverse" : "Coopilot config"}</span>}
        </div>
      ))}
    </>
  ) : (
    <>
      <div className="client open-label">Open</div>
      {!compact && <div className="src">Free for client or internal work</div>}
    </>
  );

  return (
    <div
      ref={refFn}
      className={`half ${state} ${sev ?? ""} ${selected ? "selected" : ""} ${compact ? "card" : ""}`}
      style={style}
      tabIndex={selected ? 0 : -1}
      role="button"
      aria-label={label}
      aria-describedby={slot.risks.length ? reasonsId : undefined}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      {compact ? (
        <CardBody slot={slot} tz={tz} overflow={overflow} who={who} badge={badge} workList={workList} checklist={checklist} />
      ) : (
        <>
      {!overflow && (
        <aside className="rail">
          <div className="half-label">
            <span className="half-tag">{slot.half}</span> {slotRange(slot, tz)}
          </div>
          {who}

          <div className="stats">
            <span>{formatDuration(slot.busyMeetingMinutes)} meetings</span>
            <span>{formatDuration(slot.longestFreeMinutes)} longest free</span>
          </div>

          {checklist}
          {workList}
          {badge}
        </aside>
      )}

          <Timeline slot={slot} tz={tz} showGaps={!overflow && !slot.open} minFocusWindow={minFocusWindow} />
        </>
      )}
    </div>
  );
}

const MAX_MEETINGS = 4;
const MAX_PERSONAL = 3;

/** Compact half-day: client, free time, one badge, meetings and personal events as short lists, top DevOps items. */
function CardBody({ slot, tz, overflow, who, badge, workList, checklist }: { slot: Slot; tz: string; overflow: boolean; who: ReactNode; badge: ReactNode; workList: ReactNode; checklist: ReactNode }) {
  const meetings = slot.events.filter((p) => !p.event.isPersonal);
  const personal = slot.events.filter((p) => p.event.isPersonal);
  return (
    <div className="card-body">
      <div className="half-label">
        <span className="half-tag">{slot.half}</span> {slotRange(slot, tz)}
      </div>
      {!overflow && who}
      <div className="stats">
        <span className="free">{formatDuration(slot.longestFreeMinutes)} free</span>
        {slot.busyMeetingMinutes > 0 && <span>{formatDuration(slot.busyMeetingMinutes)} meetings</span>}
      </div>
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
          <li key={e.id} className={`show-${show}`} title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e, samples)} · ${show}`}>
            <span className="ev-time">{startClock(e.start, tz)}</span>
            <span className="ev-title">{e.title}</span>
          </li>
        );
      })}
      {events.length > max && <li className="ev-more">+{events.length - max} more</li>}
    </ul>
  );
}

function minutesOf(slot: Slot): number {
  return (Temporal.Instant.from(slot.end).epochMilliseconds - Temporal.Instant.from(slot.start).epochMilliseconds) / 60000;
}

function Timeline({ slot, tz, showGaps, minFocusWindow }: { slot: Slot; tz: string; showGaps: boolean; minFocusWindow: number }) {
  const marks = hourMarks(slot.start, slot.end, tz);
  const laid = layoutEvents(slot.events, slot.start, slot.end);
  const min = minFocusWindow;
  const pos = (s: string) =>
    (Temporal.Instant.from(s).epochMilliseconds - Temporal.Instant.from(slot.start).epochMilliseconds) /
    (Temporal.Instant.from(slot.end).epochMilliseconds - Temporal.Instant.from(slot.start).epochMilliseconds);

  return (
    <div className="timeline">
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
      className={`event ${kind} show-${show} ${placed.continuesBefore ? "cont-before" : ""} ${placed.continuesAfter ? "cont-after" : ""}`}
      style={style}
      title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e, samples)} · ${show}`}
    >
      <span className="ev-line">
        <span className="ev-time">{eventRange(e, tz)}</span>
        <span className="ev-title">{e.title}</span>
      </span>
      <span className="ev-meta">
        {sourceName(e, samples)}
        {show !== "busy" ? ` · ${show}` : ""}
      </span>
    </div>
  );
}

const pct = (f: number) => `${(f * 100).toFixed(3)}%`;
