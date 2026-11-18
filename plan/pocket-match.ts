// MC-2b: which call a person's Pocket recording goes with, from times alone. Pure and small (Calls' list uses it in the
// first download); the rest of the Pocket rules are in plan/pocket-recordings.ts.

/** A recording longer than its call by more than this asks which part comes in. */
export const LONGER_BY_S = 10 * 60;

export type Span = { startAt: string; endAt: string };
/** A recording as the matching sees it: when it started and how long it ran. */
export type RecordingSpan = { id: string; startAt: string; seconds: number };

export const ms = (iso: string) => Date.parse(iso);
const endOf = (r: RecordingSpan) => ms(r.startAt) + r.seconds * 1000;

/** How many seconds a recording and a call overlap. */
export function overlapSeconds(r: RecordingSpan, c: Span): number {
  return Math.max(0, (Math.min(endOf(r), ms(c.endAt)) - Math.max(ms(r.startAt), ms(c.startAt))) / 1000);
}

/** A recording goes with a call when they overlap for at least half the call's length. */
export function goesWith(r: RecordingSpan, c: Span): boolean {
  const len = (ms(c.endAt) - ms(c.startAt)) / 1000;
  return len > 0 && overlapSeconds(r, c) >= len / 2;
}

/** The recordings that go with a call, the longer overlap first. */
export function forCall<R extends RecordingSpan>(recs: readonly R[], c: Span): R[] {
  return recs.filter((r) => goesWith(r, c)).sort((a, b) => overlapSeconds(b, c) - overlapSeconds(a, c) || a.id.localeCompare(b.id));
}

/** The recordings that go with none of these calls: each its own row. */
export function withNoCall<R extends RecordingSpan>(recs: readonly R[], calls: readonly Span[]): R[] {
  return recs.filter((r) => !calls.some((c) => goesWith(r, c)));
}

/** Longer than its call by more than 10 minutes: the setup asks which part comes in. */
export function longerThanCall(r: RecordingSpan, c: Span): boolean {
  return r.seconds - (ms(c.endAt) - ms(c.startAt)) / 1000 > LONGER_BY_S;
}

/** "1 h 40 min", "45 min". */
export function lengthWords(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}
