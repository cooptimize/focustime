// MB-1: a to-do's sheet on the phone, the same from Today's rows and Week's ⋯: Done, Move to tomorrow, Snooze (to
// this afternoon), Add time and Open in DevOps. Every one is an existing action (pick.mark_done, pick.move, the
// timebox menu, link.open); a change to my own plan runs at once with Undo, as the Week's moves do (pick.uncarry puts
// a to-do moved to another day back, a move within the day is moved back, Done takes back Done). Phone only: on a computer the ⋯ menu is unchanged.
import { createContext, useContext, type ReactNode } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import type { Half, IsoDate } from "../week/types.ts";
import type { Pick } from "../plan/types.ts";
import { planAction } from "./api.ts";
import { MenuCtx } from "./Menus.tsx";
import { timeStep } from "./menu.ts";
import { PlanCtx } from "./planview.ts";
import { WeekDnd } from "./WeekStories.tsx";
import { PhoneSheet } from "./PhoneShell.tsx";
import { nextWorkingDay } from "../plan/todayday.ts";
import { hoursOn } from "../week/hours.ts";
import { startClock, shortDate } from "./labels.ts";
import { formatDuration } from "../week/format.ts";
import { userZone } from "../week/zone.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

/** Opens a to-do's sheet; null off the phone (rows keep their ⋯ menu). */
export const TodoSheetCtx = createContext<((p: Pick) => void) | null>(null);
export const useTodoSheet = () => useContext(TodoSheetCtx);

/** "9:00–10:00 · M 2h · Northwind": the to-do's second line (its time, its size, its client). */
export function todoLine(p: Pick, data: WeekLoadData, o: { client?: boolean } = {}): string {
  const tz = userZone(data);
  const box = data.timeboxes.find((t) => t.pickId === p.id && !t.removedAt);
  const size = p.size ? `${p.size} ${formatDuration(data.planning.sizes[p.size])}` : `Size? ${formatDuration(data.planning.sizes.M)}`;
  const client = data.planClients.find((c) => c.clientKey === p.clientKey)?.clientName ?? p.clientKey;
  return [box ? `${startClock(box.start, tz)}–${startClock(box.end, tz)}` : null, size, o.client === false ? null : client].filter(Boolean).join(" · ");
}

/** Where Move to tomorrow and Snooze go: the next working day (same half), and this afternoon while it's the morning. */
export function sheetMoves(p: Pick, data: WeekLoadData, nowIso: string): { tomorrow: { date: IsoDate; half: Half; label: string } | null; later: { date: IsoDate; half: Half; label: string } | null } {
  const isPto = (d: IsoDate) => data.ptoAhead.includes(d) || !!data.week.days.find((x) => x.date === d)?.pto;
  const next = nextWorkingDay(p.date, (d) => hoursOn(data.hours, d).segments.length > 0, isPto);
  const nextIsTomorrow = !!next && Temporal.PlainDate.from(p.date).add({ days: 1 }).toString() === next;
  const tomorrow = next ? { date: next, half: p.half, label: nextIsTomorrow ? "Move to tomorrow" : `Move to ${Temporal.PlainDate.from(next).toLocaleString("en-US", { weekday: "long" })}` } : null;
  const day = data.week.days.find((d) => d.date === p.date);
  const pm = day && !day.pm.off && !day.pto ? day.pm : null;
  const later = p.half === "AM" && pm && Date.parse(pm.end) > Date.parse(nowIso) ? { date: p.date, half: "PM" as Half, label: "Snooze to this afternoon" } : null;
  return { tomorrow, later };
}

export function TodoSheet({ pick, data, now, onClose, onChanged }: { pick: Pick; data: WeekLoadData; now: string; onClose: () => void; onChanged: () => void }): ReactNode {
  const pv = useContext(PlanCtx);
  const dnd = useContext(WeekDnd);
  const menu = useContext(MenuCtx);
  const note = (t: string, undo: (() => Promise<void>) | null = null) => dnd?.note(t, undo);
  const done = pick.status === "done";
  const planned = pick.status === "planned";
  const today = data.planDay.date;
  const editable = pick.date >= today && (planned || done);
  const { tomorrow, later } = sheetMoves(pick, data, now);
  const timeOn = data.timeboxSettings.enabled !== false && planned && pick.date >= today;

  const tick = () => {
    onClose();
    pv.toggle(pick.id, !done);
    note(done ? `Not done: ${pick.title}` : `Done: ${pick.title}`, async () => pv.toggle(pick.id, done));
  };
  const move = async (to: { date: IsoDate; half: Half }, label: string) => {
    onClose();
    try {
      const r = await planAction("pick.move", { id: pick.id, date: to.date, half: to.half });
      onChanged();
      // The same day moves the to-do in place (Undo moves it back); another day carries a copy (Undo puts it back).
      const copy = r.pick?.id;
      const undo =
        to.date === pick.date ? async () => (await planAction("pick.move", { id: pick.id, date: pick.date, half: pick.half }), onChanged())
        : copy ? async () => (await planAction("pick.uncarry", { id: copy }), onChanged())
        : null;
      note(`${label} · ${pick.title}`, undo);
    } catch (e) {
      note(errText(e));
    }
  };
  const addTime = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onClose();
    if (menu.env) menu.open({ x: r.right, y: r.top }, timeStep(menu.env, pick));
  };
  const where = `${shortDate(pick.date)} ${pick.half === "EVE" ? "evening" : pick.half}`;
  return (
    <PhoneSheet label={`To-do: ${pick.title}`} title={pick.title} onClose={onClose} className="todo-sheet">
      <p className="ts-line muted">{todoLine(pick, data)} · {where}</p>
      <div className="ts-acts">
        {editable && (
          <button type="button" className={done ? "" : "primary"} onClick={tick}>
            {done ? "Not done" : "Done"}
          </button>
        )}
        {planned && tomorrow && (
          <button type="button" onClick={() => void move(tomorrow, tomorrow.label === "Move to tomorrow" ? "Moved to tomorrow" : `Moved to ${shortDate(tomorrow.date)}`)}>
            {tomorrow.label}
          </button>
        )}
        {planned && later && (
          <button type="button" onClick={() => void move(later, "Snoozed to this afternoon")}>
            {later.label}
          </button>
        )}
        {timeOn && (
          <button type="button" aria-haspopup="menu" onClick={addTime}>
            {data.timeboxes.some((t) => t.pickId === pick.id && !t.removedAt) ? "Change time" : "Add time"}
          </button>
        )}
        {pick.itemUrl && menu.env && (
          <button type="button" onClick={() => (onClose(), menu.env!.openLink(pick.clientKey, pick.itemUrl!))}>
            Open in DevOps{pick.itemId !== null ? ` · #${pick.itemId}` : ""}
          </button>
        )}
      </div>
      {!planned && !done && <p className="muted">This to-do was {pick.status}; nothing to change here.</p>}
    </PhoneSheet>
  );
}
