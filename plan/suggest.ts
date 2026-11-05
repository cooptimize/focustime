// UI-B: where an unfinished pick is suggested. Pure: the caller passes the loaded week, the unfinished picks
// (planday.carry) and the clock. Nothing is stored: a suggestion is worked out each time and never applies by itself;
// Keep moves the pick there (pick.move), Move to… elsewhere, Drop settles it.
import type { Half, IsoDate } from "../week/types.ts";
import type { Pick } from "./types.ts";

type SlotLike = { end: string; pto: boolean; off: boolean; focus: readonly { clientKey: string }[] };
export type BlockDay = { date: IsoDate; kind: string; am: SlotLike; pm: SlotLike };
export type BlockAt = { date: IsoDate; half: "AM" | "PM" };

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;

/**
 * The client's next plannable block in these days: its own focus block (never an Open half-day), not PTO (a day or
 * a half), not a catch-up day, with working hours, and not ended by `now`. Null when there is none.
 */
export function nextBlockFor(days: readonly BlockDay[], clientKey: string, now: string): BlockAt | null {
  const t = ms(now);
  for (const d of days) {
    if (d.kind !== "work") continue;
    for (const half of ["AM", "PM"] as const) {
      const s = half === "AM" ? d.am : d.pm;
      if (s.pto || s.off || s.focus[0]?.clientKey !== clientKey || ms(s.end) <= t) continue;
      return { date: d.date, half };
    }
  }
  return null;
}

export type Suggestion = { pick: Pick; to: BlockAt };
export type CarryPlan = {
  /** Picks from earlier days of this week with a block to go to: dashed cards there. */
  cards: Suggestion[];
  /** Picks from earlier days of this week with no block left for their client this week. */
  earlierDays: Pick[];
  /** Picks from earlier weeks ("From last week"). */
  earlierWeeks: Pick[];
};

/** Splits the unfinished picks into suggested cards and the folded lists. */
export function suggestCarry(picks: readonly Pick[], days: readonly BlockDay[], weekStart: IsoDate, now: string): CarryPlan {
  const out: CarryPlan = { cards: [], earlierDays: [], earlierWeeks: [] };
  for (const p of picks) {
    if (p.date < weekStart) {
      out.earlierWeeks.push(p);
      continue;
    }
    const to = nextBlockFor(days, p.clientKey, now);
    if (to) out.cards.push({ pick: p, to });
    else out.earlierDays.push(p);
  }
  return out;
}

/**
 * HK-3: Plan today's "Unfinished from earlier days" list: the day's carry-over without the picks suggested as a card in
 * a block this week (shown as that card in the block when it is this day's, and not here at all when it is another's).
 */
export const carryListed = (picks: readonly Pick[], suggested: ReadonlyMap<number, BlockAt>): Pick[] => picks.filter((p) => !suggested.has(p.id));

/** "Mon AM" for a block. */
export const blockName = (b: { date: IsoDate; half: Half }) => `${Temporal.PlainDate.from(b.date).toLocaleString("en-US", { weekday: "short" })} ${b.half === "EVE" ? "evening" : b.half}`;

/** The note on the original block: where its pick is suggested, or where it went once kept. */
export function originNote(p: Pick, suggested: ReadonlyMap<number, BlockAt>): string | null {
  if (p.status === "moved" && p.carriedTo) return `→ moved to ${blockName(p.carriedTo)}`;
  const s = suggested.get(p.id);
  return p.status === "planned" && s ? `→ suggested ${blockName(s)}` : null;
}
