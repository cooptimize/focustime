// The hour timeline of one half-day, shared by Week (the wide layout's cards) and Today's Timeline (TY-1): hour marks, the
// off hours, free gaps, meetings side by side, timeboxes and the now line. One copy: ui/WeekGrid.tsx and
// ui/TodayTimeline.tsx both draw this.
import { useContext, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type Ref } from "react";
import { TimeboxBands } from "./Timeboxes.tsx";
import { formatDuration } from "../week/format.ts";
import type { CalEvent, Day, Half, PlacedEvent, Slot } from "../week/types.ts";
import type { NowSpot } from "../plan/nowline.ts";
import { eventMenu } from "./menu.ts";
import { useMenu } from "./Menus.tsx";
import { hourMarks, labelHere, layoutEvents, overlappingIds } from "./layout.ts";
import { eventRange, SampleSources, showAsLabel, sourceName } from "./labels.ts";
import { slotOf } from "./halves.ts";
import { NowLine, NowPast } from "./NowLine.tsx";

/** UI-B: the now line for one rail: where it is (null when not on it), how much of the rail has passed, the time. */
export type RailNow = { at: number | null; past: number; label: string; onClick: () => void };

export const pct = (f: number) => `${(f * 100).toFixed(3)}%`;

/** UI-B: today's line on one half of the day; before the day it sits on the first rail's top edge, after it on the last's bottom edge. */
export function railNowOf(day: Day, half: Half, spot: NowSpot | null, now: string, label: string, onClick: () => void): RailNow | null {
  if (!spot) return null;
  const s = slotOf(day, half);
  if (!s) return null;
  const last = day.eve ? "EVE" : "PM";
  const on = spot.kind === "rail" && spot.half === half ? spot.at : spot.kind === "before" && half === "AM" ? 0 : spot.kind === "after" && half === last ? 1 : null;
  const ended = Temporal.Instant.compare(Temporal.Instant.from(now), Temporal.Instant.from(s.view.end)) >= 0;
  return { at: on, past: ended ? 1 : spot.kind === "rail" && spot.half === half ? spot.at : 0, label, onClick };
}

export const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;

/** The parts of the view outside working windows (before and after hours, lunch), shaded on the timeline. */
export function offHours(slot: Slot): { start: number; end: number }[] {
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

export function Timeline({ slot, tz, showGaps, minFocusWindow, earlier, now, children, className = "", style, rootRef, firstHour = false, markOverlaps = false }: { slot: Slot; tz: string; showGaps: boolean; minFocusWindow: number; earlier: ReadonlySet<string>; now: RailNow | null; /** TY-1: Today's extras over the hours (placeholders, a drag's ghost, promises). */ children?: ReactNode; className?: string; style?: CSSProperties; rootRef?: Ref<HTMLDivElement>; /** TY-2: a label on the line the view starts on, too. */ firstHour?: boolean; /** TY-2: "Overlaps" on events that share time. */ markOverlaps?: boolean }) {
  const { start, end } = slot.view;
  const marks = hourMarks(start, end, tz, firstHour);
  const laid = layoutEvents(slot.events, start, end);
  const clash = markOverlaps ? overlappingIds(slot.events) : null;
  const min = minFocusWindow;
  const span = Math.max(1, ms(end) - ms(start));
  const posMs = (n: number) => (n - ms(start)) / span;
  const pos = (s: string) => posMs(ms(s));

  return (
    <div ref={rootRef} className={`timeline${className ? ` ${className}` : ""}`} style={style}>
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
          <EventCard key={placed.event.id} placed={placed} tz={tz} label={labelHere(placed, earlier)} overlaps={!!clash?.has(placed.event.id)} style={{ top: pct(top), height: pct(height), left: `calc(${pct(lane / lanes)} + 4px)`, width: `calc(${pct(1 / lanes)} - 8px)` }} />
        ))}
      </div>
      {children}
      {now?.at != null && <NowLine at={now.at} label={now.label} onClick={now.onClick} />}
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

export function EventCard({ placed, tz, style, label = true, overlaps = false }: { placed: PlacedEvent; tz: string; style: CSSProperties; label?: boolean; overlaps?: boolean }) {
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
        {overlaps && <span className="ev-overlap" title="Another event is booked at the same time">Overlaps</span>}
      </span>
      <span className="ev-meta">
        {e.unavailable ? "Unavailable" : sourceName(e, samples)}
        {show !== "busy" && show !== "unknown" ? ` · ${showAsLabel(e)}` : ""}
      </span></>}
    </div>
  );
}
