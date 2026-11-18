// PH-2: the phone's Week. The whole week on one screen: a header that stays in view (the week's dates, Previous week and
// Next week, This week on another week, and the line App hands in: "N to place · Review" and its neighbours), then one
// row per day the week shows (WK-5's rules, the `shown` App hands in). A row: the day's short name and date (today
// marked, past days quieter), how many of my promises are due that day in the due badge's words, then a tile per block,
// morning and afternoon side by side in the client's color; one tile across for a day that is one thing (PTO, a holiday,
// the catch-up day with no hours, a weekend day); a slim Evening tile when the evening has something. A tile and a
// day's name open that day; nothing here ticks, adds, moves or edits. A sideways swipe changes the week.
import { useContext, useLayoutEffect, type CSSProperties, type ReactNode } from "react";
import type { Day, Slot, Week } from "../../week/types.ts";
import type { InboxItemView } from "../../plan/inbox-items.ts";
import type { Pick } from "../../plan/types.ts";
import { blockStatus } from "../../plan/blockstatus.ts";
import { dayBlocks, isCatchUp, slotOf } from "../../plan/dayblocks.ts";
import { eveningBand, weekendRows } from "../../plan/evening.ts";
import { firstThing, promisesLine, tileLine, underWay, WEEK_TEXT as W, type Thing } from "../../plan/phone-week.ts";
import { PlanCtx } from "../planview.ts";
import { clientColor, startClock } from "../labels.ts";
import { dueWords } from "../inbox/model.ts";
import { Icon } from "../icons.tsx";

const live = (p: Pick) => p.status === "planned" || p.status === "done";
/** P1's swipe distance, as Week's day strip had it. */
const SWIPE_PX = 50;
const swipe = { x: 0, y: 0 };

/** A block's name, as its card says it (ui/BlockCard.tsx): PTO, the client, No working hours, Catch-up or Open. */
export function blockName(day: Day, s: Slot): string {
  if (s.pto && s.half !== "EVE") return W.pto;
  const c = s.focus[0];
  if (c) return c.clientName;
  if (s.off) return W.noHours;
  return isCatchUp(day, s) ? W.catchUp : W.open;
}

/** A to-do's window as an instant, so evening things sort and say their time like events. */
const windowAt = (p: Pick, tz: string) => (p.window ? Temporal.PlainDate.from(p.date).toZonedDateTime({ timeZone: tz, plainTime: p.window.start }).toInstant().toString() : null);

/** The evening's things (events after the day's hours, evening to-dos, deployments), or null when it has none. */
export function eveningThings(day: Day, week: Week, picks: readonly Pick[], tz: string): Thing[] | null {
  if (day.kind === "weekend") return null;
  if (day.eve) {
    const things = [...day.eve.events.map((e) => ({ title: e.event.title, start: e.clipStart })), ...picks.filter((p) => p.half === "EVE" && live(p)).map((p) => ({ title: p.title, start: windowAt(p, tz) }))];
    return things.length ? things : null;
  }
  const band = eveningBand(day, week, picks);
  if (!band) return null;
  return [...band.events.map((e) => ({ title: e.title, start: e.start })), ...band.picks.map((p) => ({ title: p.title, start: windowAt(p, tz) }))];
}

/** The phone's top bar's height as --ph-top, so a header that stays in view sits under it at every Text size. */
export function useTopOffset() {
  useLayoutEffect(() => {
    const t = document.querySelector<HTMLElement>(".app.phone > .topbar");
    if (!t) return;
    const set = () => document.documentElement.style.setProperty("--ph-top", `${Math.ceil(t.getBoundingClientRect().height)}px`);
    set();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(set);
    ro?.observe(t);
    return () => ro?.disconnect();
  }, []);
}

const dayShort = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short" });
const dateShort = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const dayLong = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" });

export function PhoneWeek({ week, title, today, now, tz, colors, shown, promises, sub, read, onPrev, onNext, onThisWeek, onOpenDay }: {
  week: Week;
  /** The week's dates, as the computer's header says them ("Nov 2–6, 2026"). */
  title: string;
  today: string;
  now: string;
  tz: string;
  colors: Record<string, string>;
  /** WK-5: per day, whether Week shows it. */
  shown: readonly boolean[];
  /** The Inbox's rows (my promises with their due days). */
  promises: readonly InboxItemView[];
  /** Under the dates: "N to place · Review" and its neighbours, as App draws them for the computer. */
  sub: ReactNode;
  /** The week asked for is being read (or failed): the read line, from App. */
  read: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  onThisWeek: (() => void) | null;
  onOpenDay: (date: string) => void;
}) {
  const pv = useContext(PlanCtx);
  useTopOffset();
  const picksOn = (date: string) => (pv.week?.[date]?.picks ?? []).filter((p) => p.date === date);
  const clock = (iso: string) => startClock(iso, tz);
  // The Guide's "A block" step points at the first block of the week's first working day shown.
  const tourDay = week.days.find((d, i) => shown[i] && !dayBlocks(d).weekend && !dayBlocks(d).whole)?.date ?? null;
  const dueOn = (date: string) => promises.filter((r) => r.kind === "promise" && !r.done && r.views.length > 0 && r.due === date).length;

  const tile = (day: Day, s: Slot) => {
    const name = blockName(day, s);
    const picks = picksOn(day.date).filter((p) => p.half === s.half && live(p));
    const st = blockStatus(s.risks);
    const past = day.date < today;
    const line = tileLine({ start: s.start, end: s.end, now, past, atRisk: st.kind === "at_risk" ? { short: st.short ?? null } : null, done: picks.filter((p) => p.status === "done").length, notDone: picks.filter((p) => p.status === "planned").length });
    const client = s.focus[0]?.clientKey;
    const open = !client && s.open;
    const nowHere = !past && underWay({ start: s.start, end: s.end, now });
    return (
      <button
        key={s.half}
        type="button"
        className={`pw-tile${open ? " open" : ""}${client ? "" : " plain"}${nowHere ? " now" : ""} st-${line.state}`}
        data-tour={day.date === tourDay && s.half === "AM" ? "wk-block" : undefined}
        style={{ "--c": clientColor(client, colors) } as CSSProperties}
        aria-label={`${dayLong(day.date)}, ${s.half === "AM" ? "morning" : s.half === "PM" ? "afternoon" : "evening"}: ${name}. ${line.text}. ${W.openDay(dayShort(day.date))}`}
        onClick={() => onOpenDay(day.date)}
      >
        <span className="pw-name">{name}</span>
        <span className="pw-line">{line.text}</span>
      </button>
    );
  };
  const whole = (day: Day, name: string, line: string | null, cls: string, key = "whole") => (
    <button key={key} type="button" className={`pw-tile whole ${cls}`} aria-label={`${dayLong(day.date)}: ${name}${line ? `. ${line}` : ""}. ${W.openDay(dayShort(day.date))}`} onClick={() => onOpenDay(day.date)}>
      <span className="pw-name">{name}</span>
      {line && <span className="pw-line">{line}</span>}
    </button>
  );

  const row = (day: Day) => {
    const b = dayBlocks(day);
    const picks = picksOn(day.date);
    const isToday = day.date === today;
    const past = day.date < today;
    const due = past ? 0 : dueOn(day.date);
    const dueText = due ? promisesLine(due, dueWords(day.date, today)) : null;
    let tiles: ReactNode;
    if (b.weekend) {
      const r = weekendRows(day, picks, []);
      const things: Thing[] = [...r.events.map((e) => ({ title: e.title, start: e.allDay ? null : e.start })), ...r.picks.map((p) => ({ title: p.title, start: windowAt(p, tz) }))];
      tiles = whole(day, W.weekend, firstThing(things, clock), "weekend");
    } else if (b.whole === "pto") {
      // A holiday says its name ("Holiday" when it has none, week/pto.ts) and that I'm off; PTO says "You're off".
      tiles = whole(day, day.pto?.holiday ?? W.off, day.pto?.holiday ? W.off : null, day.pto?.holiday ? "pto holiday" : "pto");
    } else if (b.whole === "catchup") {
      const mine = picks.filter(live);
      const done = mine.filter((p) => p.status === "done").length;
      const line = mine.length ? (past ? W.ended(done, mine.length - done) : W.counts(done, mine.length)) : W.nothingPlanned;
      tiles = whole(day, W.catchUp, line, "catchup");
    } else {
      const halves = b.halves.filter((h) => h !== "EVE");
      tiles = halves.map((h) => tile(day, slotOf(day, h)!));
      // A day that is only an evening (a weekend flex session) draws as its evening tile below.
    }
    const eve = b.weekend || b.whole ? null : eveningThings(day, week, picks, tz);
    return (
      <li key={day.date} className={`pw-row${isToday ? " today" : ""}${past ? " past" : ""}`}>
        <button type="button" className="pw-day" aria-label={`${dayLong(day.date)}${isToday ? `, ${W.today}` : ""}${dueText ? `. ${dueText}` : ""}. ${W.openDay(dayShort(day.date))}`} aria-current={isToday ? "date" : undefined} onClick={() => onOpenDay(day.date)}>
          <span className="pw-wd">{dayShort(day.date)}</span>
          <span className="pw-date">{dateShort(day.date)}</span>
          {dueText && <span className="pw-due">{dueText}</span>}
        </button>
        <div className="pw-tiles">
          {tiles}
          {eve && (
            <button type="button" className="pw-tile eve" aria-label={`${dayLong(day.date)}, ${W.evening}: ${firstThing(eve, clock)}. ${W.openDay(dayShort(day.date))}`} onClick={() => onOpenDay(day.date)}>
              <span className="pw-name">{W.evening}</span>
              <span className="pw-line">{firstThing(eve, clock)}</span>
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div
      className="pw"
      onTouchStart={(e) => ((swipe.x = e.touches[0]!.clientX), (swipe.y = e.touches[0]!.clientY))}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0]!.clientX - swipe.x;
        const dy = e.changedTouches[0]!.clientY - swipe.y;
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 2 * Math.abs(dy)) (dx < 0 ? onNext : onPrev)();
      }}
    >
      <header className="pw-head">
        <div className="pw-head-row">
          <button type="button" className="pw-step" onClick={onPrev} aria-label={W.previousWeek} title={`${W.previousWeek} ([)`}>
            <Icon name="back" />
          </button>
          <h1 className="pw-title" aria-label={W.weekLabel(title)}>
            {title}
          </h1>
          <button type="button" className="pw-step" onClick={onNext} aria-label={W.nextWeek} title={`${W.nextWeek} (])`}>
            <Icon name="next" />
          </button>
          {onThisWeek && (
            <button type="button" className="pw-this" onClick={onThisWeek}>
              {W.thisWeek}
            </button>
          )}
        </div>
        {read}
        {sub}
      </header>
      <ol className="pw-rows" aria-label={W.dayLabel}>
        {week.days.map((d, i) => (shown[i] ? row(d) : null))}
      </ol>
    </div>
  );
}
