// WD-2: Day's own small rules. Pure: the header's words for a date, the next to-do on today, and what shows above the
// day's blocks (the urgent strip, one line of chips, the card for the moment, in that order and nothing else).
import type { Half, IsoDate } from "../week/types.ts";

/** The header: "Wed, Nov 11", and for a day that isn't today whether it is past or ahead. */
export function dayHeadline(date: IsoDate, today: IsoDate): { date: string; when: "" | "past" | "ahead" } {
  const d = Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return { date: d, when: date === today ? "" : date < today ? "past" : "ahead" };
}

type TodoLike = { id: number; half: Half; status: string; position: number };

/**
 * Today's next to-do: the one being timed while it is still planned, else the first planned one (in its block's
 * order) in the first block that hasn't ended. Null when nothing is left to do in a block still open.
 */
export function nextTodo<P extends TodoLike>(blocks: readonly { half: Half; ended: boolean }[], picks: readonly P[], timedPickId: number | null): P | null {
  const planned = picks.filter((p) => p.status === "planned");
  const timed = timedPickId !== null ? planned.find((p) => p.id === timedPickId) : undefined;
  if (timed) return timed;
  for (const b of blocks) {
    if (b.ended) continue;
    const first = planned.filter((p) => p.half === b.half).sort((a, c) => a.position - c.position)[0];
    if (first) return first;
  }
  return null;
}

export type AbovePart = "urgent" | "chips" | "moment";

/**
 * What shows above Day's blocks, in order: the urgent strip (when it has lines), one line of chips (when there is
 * one to show) and the card for the moment (when one is current). Only on today, outside the flows; nothing else.
 */
export function aboveBlocks(i: { mode: "now" | "checkin" | "closeout"; today: boolean; urgent: number; chips: boolean; moment: { kind: string } | null }): AbovePart[] {
  if (i.mode !== "now" || !i.today) return [];
  return [...(i.urgent > 0 ? (["urgent"] as const) : []), ...(i.chips ? (["chips"] as const) : []), ...(i.moment ? (["moment"] as const) : [])];
}
