import type { CSSProperties } from "react";
import { weekConfig } from "../config/defaults";
import { formatDuration } from "../week/format";
import { worstSeverity } from "../week/risks";
import type { CalEvent, Day, Half, PlacedEvent, Slot, Week } from "../week/types";
import { hourMarks, layoutEvents } from "./layout";
import { clientColor, eventRange, ruleLabel, severityLabel, shortDate, slotRange, sourceName, startClock } from "./labels";

export type Selection = { dayIndex: number; half: Half };

type Props = {
  week: Week;
  today: string;
  selection: Selection;
  cellRefs: Map<string, HTMLDivElement>;
  onSelect: (s: Selection) => void;
  onOpen: (s: Selection) => void;
};

export function WeekGrid({ week, today, selection, cellRefs, onSelect, onOpen }: Props) {
  return (
    <main className="grid" role="group" aria-label="Week grid. Arrow keys move between half-days, Enter opens details.">
      {week.days.map((day, i) => (
        <DayColumn
          key={day.date}
          day={day}
          dayIndex={i}
          tz={week.timeZone}
          isToday={day.date === today}
          selection={selection}
          cellRefs={cellRefs}
          onSelect={onSelect}
          onOpen={onOpen}
        />
      ))}
    </main>
  );
}

function DayColumn(props: { day: Day; dayIndex: number; tz: string; isToday: boolean } & Omit<Props, "week" | "today">) {
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
          selected={props.selection.dayIndex === dayIndex && props.selection.half === half}
          refFn={(el) => {
            const k = `${dayIndex}${half}`;
            if (el) props.cellRefs.set(k, el);
            else props.cellRefs.delete(k);
          }}
          onSelect={() => props.onSelect({ dayIndex, half })}
          onOpen={() => props.onOpen({ dayIndex, half })}
          dayLabel={`${day.weekday} ${shortDate(day.date)}`}
        />
      ))}

      <Strip kind="evening" label="After 5" items={day.evening.map((p) => ({ key: p.event.id, e: p.event, time: startClock(p.event.start, tz) }))} />
    </section>
  );
}

function Strip({ kind, label, items }: { kind: string; label: string; items: { key: string; e: CalEvent; time: string }[] }) {
  return (
    <div className={`strip ${kind} ${items.length ? "" : "empty"}`}>
      <span className="strip-label">{label}</span>
      {items.map(({ key, e, time }) => (
        <span key={key} className={`chip ${e.isPersonal ? "personal" : "meeting"}`} title={`${e.title} · ${sourceName(e)}`}>
          {time && <span className="chip-time">{time}</span>}
          {e.title}
        </span>
      ))}
    </div>
  );
}

type HalfProps = {
  slot: Slot;
  overflow: boolean;
  tz: string;
  selected: boolean;
  dayLabel: string;
  refFn: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onOpen: () => void;
};

function HalfDay({ slot, overflow, tz, selected, dayLabel, refFn, onSelect, onOpen }: HalfProps) {
  const primary = slot.focus[0];
  const sev = worstSeverity(slot.risks);
  const style = { "--c": clientColor(primary?.clientKey), flexGrow: minutesOf(slot) } as CSSProperties;
  const state = overflow ? "overflow" : slot.open ? "open" : "focus";
  const reasonsId = `reasons-${slot.date}-${slot.half}`;
  const label = `${dayLabel} ${slot.half}, ${primary ? primary.clientName : overflow ? "overflow" : "Open"}${sev ? `, ${sev === "at_risk" ? "at risk" : "watch"}` : ""}`;

  return (
    <div
      ref={refFn}
      className={`half ${state} ${sev ?? ""} ${selected ? "selected" : ""}`}
      style={style}
      tabIndex={selected ? 0 : -1}
      role="button"
      aria-label={label}
      aria-describedby={slot.risks.length ? reasonsId : undefined}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      {!overflow && (
        <aside className="rail">
          <div className="half-label">
            <span className="half-tag">{slot.half}</span> {slotRange(slot, tz)}
          </div>
          {primary ? (
            <>
              <div className="client">
                <span className="swatch" />
                {primary.clientName}
              </div>
              <div className="src">{primary.source === "dataverse" ? "Dataverse focus block" : "Standing block · Coopilot config"}</div>
              {slot.focus.slice(1).map((b) => (
                <div key={b.id} className="also" style={{ "--c2": clientColor(b.clientKey) } as CSSProperties}>
                  <span className="swatch small" />
                  Also booked: {b.clientName}
                  <span className="src"> · {b.source === "dataverse" ? "Dataverse" : "Coopilot config"}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="client open-label">Open</div>
              <div className="src">Free for client or internal work</div>
            </>
          )}

          <div className="stats">
            <span>{formatDuration(slot.busyMeetingMinutes)} meetings</span>
            <span>{formatDuration(slot.longestFreeMinutes)} longest free</span>
          </div>

          {slot.risks.length > 0 && (
            <ul className="badges" id={reasonsId}>
              {slot.risks.map((r, i) => (
                <li key={i} className={`badge ${r.severity}`}>
                  <span className="badge-text">
                    <span className="dot" aria-hidden="true" />
                    {severityLabel(r)}: {ruleLabel[r.rule]}
                  </span>
                  <span className="reason">{r.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}

      <Timeline slot={slot} tz={tz} showGaps={!overflow && !slot.open} />
    </div>
  );
}

function minutesOf(slot: Slot): number {
  return (Temporal.Instant.from(slot.end).epochMilliseconds - Temporal.Instant.from(slot.start).epochMilliseconds) / 60000;
}

function Timeline({ slot, tz, showGaps }: { slot: Slot; tz: string; showGaps: boolean }) {
  const marks = hourMarks(slot.start, slot.end, tz);
  const laid = layoutEvents(slot.events, slot.start, slot.end);
  const min = weekConfig.thresholds.minFocusWindowMinutes;
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
  const kind = e.isPersonal ? "personal" : "meeting";
  const show = e.showAs ?? "busy";
  return (
    <div
      className={`event ${kind} show-${show} ${placed.continuesBefore ? "cont-before" : ""} ${placed.continuesAfter ? "cont-after" : ""}`}
      style={style}
      title={`${e.title}\n${eventRange(e, tz)} · ${sourceName(e)} · ${show}`}
    >
      <span className="ev-line">
        <span className="ev-time">{eventRange(e, tz)}</span>
        <span className="ev-title">{e.title}</span>
      </span>
      <span className="ev-meta">
        {sourceName(e)}
        {show !== "busy" ? ` · ${show}` : ""}
      </span>
    </div>
  );
}

const pct = (f: number) => `${(f * 100).toFixed(3)}%`;
