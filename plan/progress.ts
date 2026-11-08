// TX-1: a timebox is a work session; an item keeps its time spent and left. Check-ins (midday and end of day only) ask
// what happened in the timeboxes that have ended. Pure: which timeboxes qualify, what an answer does to spent and
// remaining, the chip's words, the quick picks and the DevOps text. Hours here are the one place with halves ("1.5h"):
// a check-in talks about real time left, not an estimate (E2's whole hours stay for estimates and totals).
import { storyMinutes, type SizeScale, type StorySize } from "./estimate.ts";
import { minutesOf, type Timebox } from "./timebox.ts";
import { pickNeed, type Pick as Todo } from "./types.ts";
import type { IsoDate } from "../week/types.ts";

export const SESSION_ANSWERS = ["done", "partly", "none"] as const;
export type SessionAnswer = (typeof SESSION_ANSWERS)[number];
/** Partly's quick picks for the time left. */
export const LEFT_CHOICES: readonly number[] = [30, 60, 90, 120];
/** A typed time left: 5 minutes to 40 hours, in 5 minute steps. */
export const MIN_LEFT = 5;
export const MAX_LEFT = 40 * 60;

/** "30m", "1h", "1.5h", "1.25h". */
export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : Number(h.toFixed(2))}h`;
}

/** What a person types for the time left: "45", "45m", "1h", "1.5h", "1h 30m", or null when it isn't a time. */
export function parseLeft(text: string): number | null {
  const t = text.trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hours?)?(?:\s+(\d+)\s*(?:m|min|mins|minutes))?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]?.startsWith("h") ? 60 : m[2] ? 1 : n < 10 ? 60 : 1; // A bare "2" is hours, a bare "45" minutes.
  const minutes = Math.round(n * unit) + (m[3] ? Number(m[3]) : 0);
  return validLeft(minutes) ? minutes : null;
}
export const validLeft = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= MIN_LEFT && n <= MAX_LEFT && n % 5 === 0;

/** The size this progress is measured against: the size, or the person's assumption when unsized. */
export const baseMinutes = (p: { size: string | null; minutes?: number | null }, sizes: SizeScale) => p.minutes ?? storyMinutes(p.size, sizes);

/** The chip once there's progress: "1h of 2h left"; more left than the size: "3h left · was 2h". Null with no progress. */
export function progressChip(p: { size: string | null; minutes?: number | null; remainingMinutes?: number | null }, sizes: SizeScale): string | null {
  if (p.remainingMinutes == null) return null;
  const base = baseMinutes(p, sizes);
  if (p.remainingMinutes > base) return `${durationText(p.remainingMinutes)} left · was ${durationText(base)}`;
  return `${durationText(p.remainingMinutes)} of ${durationText(base)} left`;
}

/**
 * A size change once there's progress: the time left moves by the same amount, at least 15 minutes. (Spending time never
 * changes a size; this is the other way round, the person re-sizing work that's under way.) Null: no progress to adjust.
 */
export function resizedRemaining(remaining: number | null | undefined, before: StorySize | null, after: StorySize | null, sizes: SizeScale): number | null {
  if (remaining == null || remaining === 0) return null;
  return Math.max(15, remaining + storyMinutes(after, sizes) - storyMinutes(before, sizes));
}

export type SessionRow = {
  pickId: number;
  /** Every unanswered, ended timebox of this to-do that day; the answer covers them all. */
  timeboxIds: number[];
  title: string;
  clientKey: string;
  itemId: number | null;
  /** The minutes of those timeboxes. */
  minutes: number;
  /** Time left before this answer (the size, or what an earlier check-in left). */
  remaining: number;
  /** Size, or the assumption. */
  base: number;
  /** "All went to plan" marks it done: the timeboxes covered all the time left. */
  covers: boolean;
};

type BoxIn = Pick<Timebox, "id" | "date" | "pickId" | "start" | "end" | "removedAt"> & { settled?: string | null };

/**
 * What a check-in asks about: this day's timeboxes that have ended, not answered yet, on a to-do still planned and not
 * done in DevOps, one row per to-do. A timebox with no to-do isn't asked about. Nothing else nags: there's no state for
 * "asked before", so skipped rows are simply still here at the next check-in, and a closed-out day asks nothing.
 */
export function sessionRows(date: IsoDate, boxes: readonly BoxIn[], picks: readonly Todo[], now: string, sizes: SizeScale): SessionRow[] {
  const nowMs = Temporal.Instant.from(now).epochMilliseconds;
  const ended = boxes.filter((b) => b.date === date && !b.removedAt && !b.settled && b.pickId !== null && Temporal.Instant.from(b.end).epochMilliseconds <= nowMs);
  const out: SessionRow[] = [];
  for (const b of [...ended].sort((x, y) => Temporal.Instant.compare(Temporal.Instant.from(x.start), Temporal.Instant.from(y.start)))) {
    const row = out.find((r) => r.pickId === b.pickId);
    if (row) {
      row.timeboxIds.push(b.id);
      row.minutes += minutesOf(b);
      row.covers = row.minutes >= row.remaining;
      continue;
    }
    const p = picks.find((x) => x.id === b.pickId);
    if (!p || p.status !== "planned" || p.resolved) continue;
    const remaining = pickNeed(p, sizes);
    const minutes = minutesOf(b);
    out.push({ pickId: p.id, timeboxIds: [b.id], title: p.title, clientKey: p.clientKey, itemId: p.itemId, minutes, remaining, base: baseMinutes(p, sizes), covers: minutes >= remaining });
  }
  return out;
}

export type Outcome = { as: SessionAnswer; spent: number; remaining: number };

/**
 * What an answer does, from the time already spent and left.
 * - Done: the timeboxes count as spent; nothing is left.
 * - Partly: the timeboxes count as spent; left is what the person said.
 * - Didn't get to it: nothing changes.
 */
export function outcomeOf(answer: SessionAnswer, row: Pick<SessionRow, "minutes" | "remaining">, spentBefore: number, left?: number): Outcome {
  if (answer === "none") return { as: "none", spent: spentBefore, remaining: row.remaining };
  if (answer === "done") return { as: "done", spent: spentBefore + row.minutes, remaining: 0 };
  return { as: "partly", spent: spentBefore + row.minutes, remaining: left! };
}

/**
 * "All went to plan": a to-do whose timeboxes covered all its time left is done; any other counts the timeboxes as
 * spent, with that much less left. Equals `covers` by construction: the rule is one comparison in one place.
 */
export function planOutcome(row: Pick<SessionRow, "minutes" | "remaining" | "covers">, spentBefore: number): Outcome {
  return row.covers ? outcomeOf("done", row, spentBefore) : { as: "partly", spent: spentBefore + row.minutes, remaining: row.remaining - row.minutes };
}

/** The short comment for a process with no Remaining Work: "Worked 1h today, about 1h left". */
export const progressComment = (workedMinutes: number, leftMinutes: number) => `Worked ${durationText(workedMinutes)} today, about ${durationText(leftMinutes)} left`;
/** The end of day offer in words, from how many stories take each kind of update. */
export function progressAsk(remaining: number, comment: number): string {
  const n = (c: number) => `${c} ${c === 1 ? "story" : "stories"}`;
  if (remaining && comment) return `Update Remaining Work on ${n(remaining)} and comment on ${n(comment)}?`;
  return remaining ? `Update Remaining Work on ${n(remaining)}?` : `Add a short comment on ${n(comment)}?`;
}
/** DevOps keeps Remaining Work in hours. */
export const remainingHours = (minutes: number) => Number((minutes / 60).toFixed(2));
