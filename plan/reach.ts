// AH-1 (D663): can a feature's open work reach its target date? Its open stories' hours (FocusTime's size, unsized as
// 2h; a DevOps size field is in its own unit, so it isn't hours) against the free focus time before the target in the
// blocks of the people they're assigned to. Only my own blocks are known to FocusTime, so a story assigned to someone
// else (or to nobody) means it can't be checked, and that is said, never guessed. Pure; minutes in.
import type { IsoDate } from "../week/types.ts";

export const UNSIZED_MINUTES = 120;

export type ReachInput = {
  target: IsoDate | null;
  today: IsoDate;
  /** My DevOps email for this client. */
  me: string | null;
  stories: { assigneeEmail: string | null; assigneeName: string | null; minutes: number | null }[];
  /** My free focus minutes for this client: weeks 1 to 4 (each from its Monday) and month columns after (from, to exclusive). */
  weeks: readonly { weekStart: IsoDate; freeMinutes: number }[];
  months: readonly { from: IsoDate; to: IsoDate; available: number }[];
};
export type Reach = { kind: "ok"; needMinutes: number; freeMinutes: number } | { kind: "short"; needMinutes: number; freeMinutes: number } | { kind: "unknown"; text: string } | { kind: "none" };

const D = (d: IsoDate) => Temporal.PlainDate.from(d);
/** Weekdays (Monday to Friday) from a up to b (exclusive): focus time sits on working days. */
const days = (a: IsoDate, b: IsoDate) => {
  let n = 0;
  for (let d = D(a); Temporal.PlainDate.compare(d, D(b)) < 0; d = d.add({ days: 1 })) if (d.dayOfWeek <= 5) n++;
  return n;
};

/** Free minutes before the end of the target day, prorating the week or month the target (or today) falls in, by weekdays. */
export function freeBefore(i: Pick<ReachInput, "today" | "weeks" | "months">, target: IsoDate): number {
  const end = D(target).add({ days: 1 }).toString();
  let n = 0;
  const part = (from: IsoDate, to: IsoDate, minutes: number) => {
    const a = from > i.today ? from : i.today;
    const b = to < end ? to : end;
    if (b <= a) return 0;
    return Math.round((minutes * days(a, b)) / Math.max(1, days(from, to)));
  };
  for (const w of i.weeks) n += part(w.weekStart, D(w.weekStart).add({ days: 7 }).toString(), w.freeMinutes);
  for (const m of i.months) n += part(m.from, m.to, m.available);
  return n;
}

export function reach(i: ReachInput): Reach {
  if (!i.target || i.target < i.today) return { kind: "none" };
  if (!i.stories.length) return { kind: "none" };
  const others = [...new Set(i.stories.filter((s) => s.assigneeEmail && s.assigneeEmail.toLowerCase() !== (i.me ?? "").toLowerCase()).map((s) => s.assigneeName ?? s.assigneeEmail!))];
  if (others.length) return { kind: "unknown", text: `Can't check: ${others.length === 1 ? `${others[0]}'s blocks aren't` : `${others.slice(0, -1).join(", ")} and ${others.at(-1)}'s blocks aren't`} known` };
  const loose = i.stories.filter((s) => !s.assigneeEmail).length;
  if (loose) return { kind: "unknown", text: `Can't check: ${loose === 1 ? "1 story isn't" : `${loose} stories aren't`} assigned` };
  const need = i.stories.reduce((n, s) => n + (s.minutes ?? UNSIZED_MINUTES), 0);
  const free = freeBefore(i, i.target);
  return need > free ? { kind: "short", needMinutes: need, freeMinutes: free } : { kind: "ok", needMinutes: need, freeMinutes: free };
}
