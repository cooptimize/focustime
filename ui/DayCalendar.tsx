// Step 17.6: the day's meetings on Today and in Plan the day. Rows in time order with the Week view's show-as styling,
// the meeting under way highlighted and the next one marked; all-day events in one slim row; meetings outside the
// blocks in a slim line before or after them. Each row opens the same event menu as on Week. Never "no meetings":
// with nothing to show it renders nothing, and a source that failed is reported by the status line, not here.
import type { CalEvent } from "../week/types.ts";
import type { DayEvent } from "../plan/todaycal.ts";
import { showAsLabel } from "./labels.ts";
import { spanText } from "./menu.ts";
import { useEventMenu } from "./WeekGrid.tsx";

/** One meeting row: time, title, Now / Next, and the show-as word when it isn't busy. */
export function DayEventRow({ e, tz }: { e: DayEvent; tz: string }) {
  const show = e.event.showAs ?? "busy";
  const menu = useEventMenu(e.event);
  const word = show !== "busy" && show !== "unknown" ? showAsLabel(e.event) : e.kind === "unavailable" ? "unavailable" : null;
  return (
    <li className={`show-${show} ${e.kind} when-${e.when}`} title={`${e.event.title}\n${spanText(e.start, e.end, tz)}${word ? ` · ${word}` : ""}`} {...menu}>
      <span className="ev-time">{spanText(e.start, e.end, tz)}</span>
      <span className="ev-title">{e.event.title}</span>
      {e.when === "now" && <span className="cal-tag now">Now</span>}
      {e.when === "next" && <span className="cal-tag next">Next</span>}
      {word && <span className="cal-word">{word}</span>}
    </li>
  );
}

export function DayEventList({ events, tz, label }: { events: readonly DayEvent[]; tz: string; label: string }) {
  if (!events.length) return null;
  return (
    <ul className="ev-list day-cal" aria-label={label}>
      {events.map((e) => (
        <DayEventRow key={`${e.event.id}${e.start}`} e={e} tz={tz} />
      ))}
    </ul>
  );
}

/** All-day events as one slim row. */
export function AllDayRow({ events }: { events: readonly CalEvent[] }) {
  if (!events.length) return null;
  return (
    <p className="day-allday" aria-label="All day">
      <span className="day-line-label">All day</span>
      {events.map((e) => (
        <span key={e.id} className={`day-allday-ev show-${e.showAs ?? "busy"}${e.isPersonal ? " personal" : ""}`} title={`${e.title} · ${showAsLabel(e)}`}>
          {e.title}
        </span>
      ))}
    </p>
  );
}

/** Meetings outside the blocks on screen: a slim labelled line ("Before your blocks", "After your blocks"). */
export function OutsideLine({ label, events, tz }: { label: string; events: readonly DayEvent[]; tz: string }) {
  if (!events.length) return null;
  return (
    <div className="day-outside">
      <span className="day-line-label">{label}</span>
      <DayEventList events={events} tz={tz} label={label} />
    </div>
  );
}
