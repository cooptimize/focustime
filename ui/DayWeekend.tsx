// Day on a Saturday or Sunday (WK-3; its own file since WD-2, unchanged in what it does).
import { useContext } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { PickRow } from "./PickRow.tsx";
import type { Pick } from "../plan/types.ts";
import { sortByTime, weekendRows } from "../plan/evening.ts";
import type { Day, IsoDate } from "../week/types.ts";
import { startClock } from "./labels.ts";
import { clientNames, PlanCtx } from "./planview.ts";
import { userZone } from "../week/zone.ts";

const live = (p: Pick) => p.status === "planned" || p.status === "done";
/**
 * WK-3: Today on a Saturday or Sunday: "Weekend", then the day's calendar items and to-dos (a Deployment with its icon
 * and window) as plain rows. To-dos tick done as anywhere (a Deployment then offers to tell the client). No Plan link,
 * no blocks, no moment card: nothing asks to plan a weekend.
 */
export function WeekendDay({ day, date, past, data, picks }: { day: Day | null; date: IsoDate; past: boolean; data: WeekLoadData; picks: readonly Pick[] }) {
  const view = useContext(PlanCtx);
  const tz = userZone(data);
  const nameOf = clientNames(data);
  const rows = day ? weekendRows(day, picks, []) : { events: [], picks: sortByTime(picks.filter(live)), due: [] };
  const empty = !rows.events.length && !rows.picks.length;
  return (
    <section className="today-weekend" aria-label="Weekend">
      <p className="today-weekend-head"><strong>Weekend</strong>{past ? <span className="muted"> · past, read only</span> : null}</p>
      {empty && <p className="muted">Nothing on {Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long" })}.</p>}
      {rows.events.length > 0 && (
        <ul className="whole-lines we-events" aria-label="Calendar">
          {rows.events.map((e) => (
            <li key={e.id} className={e.isPersonal ? "personal" : undefined}>
              <span className="out-time">{startClock(e.start, tz)}</span> <span className="ev-title">{e.title}</span>
            </li>
          ))}
        </ul>
      )}
      {rows.picks.length > 0 && (
        <ul className="checklist we-todos" aria-label="To-dos">
          {rows.picks.map((p) => <PickRow key={p.id} pick={p} toggle={view.toggle} density="today" readOnly={past} canTick={!past || p.status !== "dropped"} extra={<span className="we-client muted">{nameOf(p.clientKey)}</span>} />)}
        </ul>
      )}
    </section>
  );
}

