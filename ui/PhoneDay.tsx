// MB-1: Today on the phone: today's to-dos grouped by block (a tap opens the to-do's sheet), the Now card's state, and
// a block's name. PH-1 moved the Now card and Next into the phone's own screen file (ui/phone/PhoneScreens.tsx), which
// a computer never downloads. Every change is an existing action; ticking my own to-do runs at once (Undo in the toast).
import { BlockSuggestions } from "./Suggest.tsx";
import type { CSSProperties, ReactNode } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import type { Slot } from "../week/types.ts";
import type { Pick } from "../plan/types.ts";
import type { DayEvent } from "../plan/todaycal.ts";
import { nowCard, type NowCard } from "../plan/phonenow.ts";
import { clientColor, startClock } from "./labels.ts";
import { todoLine, useTodoSheet } from "./TodoSheet.tsx";
import { userZone } from "../week/zone.ts";
import { Icon } from "./icons.tsx";
import { isCatchUp, slotOf } from "../plan/dayblocks.ts";

const ms = (iso: string) => Date.parse(iso.replace(/\[.*\]$/, ""));
/** RS-2: a block with no client is the catch-up day's ("Catch-up", as Week names it) or an Open half-day. */
const noClient = (data: WeekLoadData, date: string | undefined, half: Slot["half"]) => {
  const d = data.week.days.find((x) => x.date === date);
  return d && isCatchUp(d, slotOf(d, half) ?? d.am) ? "Catch-up" : "Open";
};
const live = (p: Pick) => p.status === "planned" || p.status === "done";

/** The Now card's state for today's blocks and calendar. */
export function phoneNowOf(blocks: readonly Slot[], events: readonly DayEvent[], now: string): NowCard {
  return nowCard(
    blocks.map((s) => ({ half: s.half, clientKey: s.focus[0]?.clientKey ?? null, start: s.start, end: s.end })),
    events.map((e) => ({ id: e.event.id, title: e.event.title, start: e.start, end: e.end, isPersonal: e.event.isPersonal, unavailable: e.event.unavailable, notMeeting: e.event.notMeeting, allDay: e.event.allDay })),
    now,
  );
}

/** PH-1: a block's name on the phone: its client, or "Catch-up" or "Open" (RS-2). */
export function phoneNameOf(data: WeekLoadData, nameOf: (k: string) => string, b: { half: string; clientKey: string | null }): string {
  return b.clientKey ? nameOf(b.clientKey) : noClient(data, data.planDay.date, b.half as Slot["half"]);
}

/** Today's to-dos, grouped by block: a checkbox, the title on its own line (two at most), then time, size and client. */
export function PhoneTodos({ heading = "To-dos", blocks, picks, data, nameOf, tickable, now, onTick, onAdd }: { /** WD-2: Add on a block that can take work: the block panel's sheet. */ onAdd?: ((half: Slot["half"]) => void) | undefined; /** PH-1: Now calls it "Today". */ heading?: string; blocks: readonly Slot[]; picks: readonly Pick[]; data: WeekLoadData; nameOf: (k: string) => string; tickable: boolean; now: string; onTick: (p: Pick, done: boolean) => void }): ReactNode {
  const sheet = useTodoSheet();
  const tz = userZone(data);
  const start = (p: Pick) => data.timeboxes.find((t) => t.pickId === p.id && !t.removedAt)?.start ?? null;
  if (!blocks.length) return null;
  return (
    <section className="ph-todos" aria-label="Today's to-dos">
      <h2 className="section-label">{heading}</h2>
      {blocks.map((s) => {
        const client = s.focus[0]?.clientKey ?? null;
        const mine = picks
          .filter((p) => p.half === s.half && live(p))
          .sort((a, b) => (start(a) && start(b) ? ms(start(a)!) - ms(start(b)!) : start(a) ? -1 : start(b) ? 1 : a.id - b.id));
        const over = ms(s.end) <= ms(now);
        return (
          <div key={s.half} className={`ph-block${over ? " over" : ""}`} style={{ "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties}>
            <h3 className="ph-block-head">
              <span className="swatch" aria-hidden="true" />
              {client ? nameOf(client) : noClient(data, s.date, s.half)}
              <span className="muted"> · {startClock(s.start, tz)}–{startClock(s.end, tz)}</span>
            </h3>
            {mine.length ? (
              <ul className="ph-todo-list">
                {mine.map((p) => (
                  <li key={p.id} className={`ph-todo ${p.status}`}>
                    <label className="tick"><input type="checkbox" checked={p.status === "done"} disabled={!tickable && p.status !== "done"} onChange={(e) => onTick(p, e.target.checked)} aria-label={`Done: ${p.title}`} /></label>
                    <button type="button" className="ph-todo-main" aria-haspopup="dialog" onClick={() => sheet?.(p)} aria-label={`${p.title}. ${todoLine(p, data, { client: false })}. Actions`}>
                      <span className="ph-todo-title">{p.title}</span>
                      <span className="ph-todo-line">{todoLine(p, data)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ph-block-none muted">Nothing here yet.</p>
            )}
            {/* SG-1: an empty block's suggestions with Keep all and Clear. */}
            {!mine.length && <BlockSuggestions date={s.date} half={s.half} where="phone" />}
            {onAdd && !over && !s.off && !s.pto && (
              <button type="button" className="add-work add-row ph-add" onClick={() => onAdd(s.half)} aria-label={`Add to ${client ? nameOf(client) : "this block"}`}>
                <Icon name="add" /> Add
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

