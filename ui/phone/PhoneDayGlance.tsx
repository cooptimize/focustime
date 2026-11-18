// PH-2: a day at a glance on the phone, one layout for every day: a section per block in time order, then Evening when it
// has anything. A section: the block's name (a button that opens the block's sheet, as a card's body does) with its
// color, its hours and its status with the reason when it is at risk; its to-dos (a tick box, done at once with Undo,
// and the title, which opens the to-do's sheet; the size in words where it has one); its meetings in time order, each
// with its time, DY-1's repeat mark and a call's mark (the mark opens the call); the card's own line of meetings and
// free time; then one quiet Add that opens the block's sheet on adding. Another day also gets a small header that
// stays in view (DayGlanceHead). Every word about a block or a to-do is the one the computer's card uses.
import type { CSSProperties, ReactNode } from "react";
import type { WeekLoadData } from "../../actions/types.ts";
import type { Day, Half, Slot } from "../../week/types.ts";
import type { Pick } from "../../plan/types.ts";
import { blockStatus } from "../../plan/blockstatus.ts";
import { canAddWork } from "../../plan/days.ts";
import { progressChip } from "../../plan/progress.ts";
import { WEEK_TEXT as W } from "../../plan/phone-week.ts";
import { meetingsLine } from "../BlockCard.tsx";
import { BlockSuggestions } from "../Suggest.tsx";
import { useTodoSheet } from "../TodoSheet.tsx";
import { clientColor, startClock } from "../labels.ts";
import { formatDuration } from "../../week/format.ts";
import { userZone } from "../../week/zone.ts";
import { callForEvent, useCallMarks } from "../meetings/calls.ts";
import { MeetingMark, titleOpensCall } from "../meetings/CallMark.tsx";
import { eveningBand } from "../../plan/evening.ts";
import { Icon } from "../icons.tsx";
import { blockName, useTopOffset } from "./PhoneWeek.tsx";

const ms = (iso: string) => Date.parse(iso.replace(/\[.*\]$/, ""));
const live = (p: Pick) => p.status === "planned" || p.status === "done";
const halfWord = (h: Half) => (h === "AM" ? "morning" : h === "PM" ? "afternoon" : "evening");

/** A to-do's size in words: what's left once there is progress, else its hours ("1h"); nothing when unsized. */
export function sizeWords(p: Pick, sizes: WeekLoadData["planning"]["sizes"]): string | null {
  return progressChip(p, sizes) ?? (p.size ? formatDuration(sizes[p.size]) : null);
}

function TodoRows({ picks, data, tickable, label, onTick }: { picks: readonly Pick[]; data: WeekLoadData; tickable: boolean; label: string; onTick: (p: Pick, done: boolean) => void }) {
  const sheet = useTodoSheet();
  if (!picks.length) return null;
  return (
    <ul className="dg-todos" aria-label={label}>
      {picks.map((p) => {
        const size = sizeWords(p, data.planning.sizes);
        return (
          <li key={p.id} className={`dg-todo ${p.status}`}>
            <label className="dg-tick">
              <input type="checkbox" checked={p.status === "done"} disabled={!tickable && p.status !== "done"} onChange={(e) => onTick(p, e.target.checked)} aria-label={`Done: ${p.title}`} />
            </label>
            <button type="button" className="dg-title" aria-haspopup="dialog" onClick={() => sheet?.(p)} aria-label={`${p.title}${size ? `, ${size}` : ""}. Actions`}>
              <span className="dg-title-text">{p.title}</span>
              {size && <span className="dg-size">{size}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A section's meetings and events, in time order: time, title (a call's opens the call), and its mark. */
function Meetings({ slot, tz, label }: { slot: Slot; tz: string; label: string }) {
  const marks = useCallMarks();
  if (!slot.events.length) return null;
  const events = [...slot.events].sort((a, b) => ms(a.clipStart) - ms(b.clipStart));
  return (
    <ul className="dg-meetings" aria-label={label}>
      {events.map((p) => {
        const call = callForEvent(marks, p.event);
        return (
          <li key={p.event.id} className={`dg-meeting${p.event.isPersonal ? " personal" : ""}${p.event.unavailable ? " unavailable" : ""}`}>
            <span className="dg-at">
              {startClock(p.clipStart, tz)}–{startClock(p.clipEnd, tz)}
            </span>
            <span className="dg-mtitle" {...titleOpensCall(call)}>
              {p.event.title}
            </span>
            <MeetingMark e={p.event} call={call} />
          </li>
        );
      })}
    </ul>
  );
}

export function DaySections({ day, blocks, data, picks, now, today, tickable, hideId = null, onTick, onOpenBlock, onAdd }: {
  day: Day;
  /** The day's blocks, as Day draws them (plan/todayday.ts). */
  blocks: readonly Slot[];
  data: WeekLoadData;
  picks: readonly Pick[];
  now: string;
  today: string;
  tickable: boolean;
  /** Today: the to-do the Now card shows, not listed again. */
  hideId?: number | null;
  onTick: (p: Pick, done: boolean) => void;
  onOpenBlock: (half: Half) => void;
  onAdd: (half: Half) => void;
}): ReactNode {
  const tz = userZone(data);
  const box = (p: Pick) => data.timeboxes.find((t) => t.pickId === p.id && !t.removedAt)?.start ?? null;
  const order = (a: Pick, b: Pick) => (box(a) && box(b) ? ms(box(a)!) - ms(box(b)!) : box(a) ? -1 : box(b) ? 1 : a.position - b.position || a.id - b.id);
  // The block's live to-dos; the one on today's Now card counts for the block but isn't listed again.
  const all = (half: Half) => picks.filter((p) => p.half === half && live(p)).sort(order);
  const empty = !picks.some(live);
  const dayWord = day.date === today ? "today" : Temporal.PlainDate.from(day.date).toLocaleString("en-US", { weekday: "long" });
  const band = day.eve ? null : eveningBand(day, data.week, picks);
  const bandIds = new Set((band?.picks ?? []).map((p) => p.id));
  return (
    <div className="dg" data-tour="today-blocks">
      {empty && blocks.length > 0 && <p className="dg-empty-day">{W.nothingPlannedDay(dayWord)}</p>}
      {[...blocks].sort((a, b) => ms(a.start) - ms(b.start)).map((s) => {
        const name = s.half === "EVE" ? W.evening : blockName(day, s);
        const st = blockStatus(s.risks);
        const past = day.date < today;
        const own = all(s.half).filter((p) => !bandIds.has(p.id));
        const todos = own.filter((p) => p.id !== hideId);
        const ended = ms(s.end) <= ms(now);
        const add = canAddWork({ date: day.date, today, pto: !!day.pto || s.pto, off: s.off }) && !ended;
        const client = s.focus[0]?.clientKey;
        return (
          <section key={s.half} className={`dg-block${ended ? " over" : ""}${client ? "" : " plain"}`} data-half={s.half} style={{ "--c": clientColor(client, data.clients) } as CSSProperties} aria-label={`${name}, ${halfWord(s.half)}`}>
            <button type="button" className="dg-head" aria-haspopup="dialog" onClick={() => onOpenBlock(s.half)} aria-label={W.openBlock(name, halfWord(s.half))}>
              <span className="swatch" aria-hidden="true" />
              <span className="dg-name">{name}</span>
              <span className="dg-hours">
                {startClock(s.start, tz)}–{startClock(s.end, tz)}
              </span>
              {st.kind === "at_risk" && !past && <span className="dg-risk">{W.atRisk(st.short ?? null)}</span>}
            </button>
            <TodoRows picks={todos} data={data} tickable={tickable} label={W.todosOf(name)} onTick={onTick} />
            {!own.length && !empty && <p className="dg-none">{W.nothingPlanned}</p>}
            {/* SG-1: an empty block's suggestions with Keep all and Clear, as the phone's Today list had them. */}
            {!own.length && s.half !== "EVE" && <BlockSuggestions date={s.date} half={s.half} where="phone" />}
            <Meetings slot={s} tz={tz} label={W.meetingsOf(name)} />
            {!s.pto && !s.off && <p className="dg-line">{meetingsLine(s)}</p>}
            {add && (
              <button type="button" className="add-work add-row dg-add" onClick={() => onAdd(s.half)} aria-label={`Add to ${name}`}>
                <Icon name="add" /> Add
              </button>
            )}
          </section>
        );
      })}
      {band && (
        <section className="dg-block plain eve" aria-label={W.evening}>
          <h3 className="dg-head static">
            <span className="dg-name">{W.evening}</span>
          </h3>
          <TodoRows picks={band.picks} data={data} tickable={tickable} label={W.todosOf(W.evening)} onTick={onTick} />
          {band.events.length > 0 && (
            <ul className="dg-meetings" aria-label={W.meetingsOf(W.evening)}>
              {band.events.map((e) => (
                <li key={e.id} className={`dg-meeting${e.isPersonal ? " personal" : ""}`}>
                  <span className="dg-at">
                    {startClock(e.start, tz)}–{startClock(e.end, tz)}
                  </span>
                  <span className="dg-mtitle">{e.title}</span>
                  <MeetingMark e={e} call={null} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** Another day's small header, which stays in view: the day and date, Previous day and Next day, Week, and Today. */
export function DayGlanceHead({ date, today, pill, read, onPrev, onNext, onWeek, onToday }: { date: string; today: string; pill: ReactNode; read: ReactNode; onPrev: () => void; onNext: () => void; onWeek: () => void; onToday: () => void }) {
  useTopOffset();
  const d = Temporal.PlainDate.from(date);
  return (
    <header className="dg-headbar day-bar">
      {/* Previous day, the date, Next day: the arrows on either side, as Week's header has them. */}
      <span className="pd-step-ph">
        <button type="button" onClick={onPrev} aria-label={W.previousDay} title={`${W.previousDay} ([)`}>
          <Icon name="back" />
        </button>
      </span>
      <h1 className="dg-date" title={d.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>
        {d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}
      </h1>
      <span className="pd-step-ph">
        <button type="button" onClick={onNext} aria-label={W.nextDay} title={`${W.nextDay} (])`}>
          <Icon name="next" />
        </button>
      </span>
      {pill}
      <span className="dg-headacts">
        {date !== today && (
          <button type="button" className="dg-today" onClick={onToday} title="Back to today">
            {W.today}
          </button>
        )}
        <button type="button" className="dg-week" onClick={onWeek} aria-label={W.backToWeekLabel}>
          <Icon name="week" /> {W.backToWeek}
        </button>
      </span>
      {read}
    </header>
  );
}
