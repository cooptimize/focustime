// MC-2b: the pure rules for a person's own Pocket recordings in Calls. Whose recordings are kept from what a key lists,
// which call a recording goes with, the part of a long recording during its call, Pocket's line times in seconds,
// and its segments as a call's transcript lines (speakers numbered, never named). No I/O, no clock of its own.
import { linesOf, type TranscriptLine } from "./transcript.ts";
import { ms, type RecordingSpan, type Span } from "./pocket-match.ts";
export { forCall, goesWith, lengthWords, LONGER_BY_S, longerThanCall, overlapSeconds, withNoCall, type RecordingSpan } from "./pocket-match.ts";

/** The calls window's length (Calls' own, plan/calls.ts's OTHER_CALL_DAYS) and how long a press's list is held. */
export const POCKET_HOLD_MS = 5 * 60_000;
/** The part during the call takes this much either side. */
export const AROUND_S = 5 * 60;

/**
 * PK-4: why each listed item is kept or left out. "mine": its recorder is an address FocusTime knows me by or one I set
 * as my Pocket address; "one": no recording is mine by address, and every recording that names a recorder names the
 * same one, an address no other FocusTime person has (a key someone made for themselves, MC-2b); "address": under an
 * address FocusTime doesn't know me by; "no_recorder": no recorder, beside someone else's recordings; "not_recording":
 * no length or no time it was recorded (Pocket's docs give `state` no values, so it isn't read).
 */
export type ListedWhy = "mine" | "one" | "address" | "no_recorder" | "not_recording";
export const keptWhy = (w: ListedWhy) => w === "mine" || w === "one";

const norm = (e: string | null) => (e === null ? null : e.trim().toLowerCase() || null);

/** An address's domain, lower case ("" when it has none). */
export const domainOf = (e: string) => e.slice(e.lastIndexOf("@") + 1).trim().toLowerCase();

/**
 * PK-4: whether `r` is a colleague's address: one another FocusTime person is known by, or any other address on the
 * domain of my work address (mine there would already be known, so another one there is someone else's).
 */
export function colleagueOf(work: readonly string[], theirs: readonly string[]) {
  const domains = new Set(work.map(domainOf).filter(Boolean));
  const mine = new Set(work.map((e) => e.trim().toLowerCase()));
  const them = new Set(theirs.map((e) => e.trim().toLowerCase()));
  return (r: string) => !mine.has(r) && (them.has(r) || domains.has(domainOf(r)));
}

/**
 * PK-4: whose listed items are kept, from their recorders' addresses and, only where the addresses don't settle it, by
 * asking `isRecording` (its length and when it was recorded). Asked of an item under an address FocusTime doesn't know
 * anyone by only while no recording is mine by address and no other FocusTime person is listed (it may be mine); never
 * of an item under another FocusTime person's address, nor of anyone else's once mine are found by address. Replaced
 * MC-2b's rule, a guess that kept nothing when one item had no recorder (Nov 18). With `others` false (who else
 * FocusTime knows couldn't be read) the one-recorder rule doesn't apply: it fails closed.
 */
export function whoseKept(
  recorders: readonly (string | null)[],
  o: {
    mine: readonly string[];
    /** Addresses other FocusTime people are known by. */ theirs?: readonly string[];
    /** False: `theirs` couldn't be read. */ others?: boolean;
    /** My sign-in addresses: another address on their domain is a colleague's. */ work?: readonly string[];
  },
  isRecording: (i: number) => boolean,
): ListedWhy[] {
  const me = new Set(o.mine.map(norm).filter((e): e is string => !!e));
  const colleague = colleagueOf(o.work ?? [], o.theirs ?? []);
  const them = { has: (r: string) => !me.has(r) && colleague(r) };
  const rs = recorders.map(norm);
  const asked = new Map<number, boolean>();
  const rec = (i: number) => {
    if (!asked.has(i)) asked.set(i, isRecording(i));
    return asked.get(i)!;
  };
  const known = (r: string | null): r is string => r !== null && me.has(r);
  // 1. Mine by address: those of mine that are recordings, and those with no recorder when nobody else is under the key.
  const mineAt = rs.map((r, i) => (known(r) ? i : -1)).filter((i) => i >= 0);
  if (mineAt.some((i) => rec(i))) {
    const someoneElse = rs.some((r) => r !== null && !me.has(r));
    return rs.map((r, i): ListedWhy => (known(r) ? (rec(i) ? "mine" : "not_recording") : r !== null ? "address" : someoneElse ? "no_recorder" : rec(i) ? "mine" : "not_recording"));
  }
  // 2. One recorder: every recording that names a recorder names the same one, and nobody FocusTime knows as someone else.
  const theirsListed = o.others === false || rs.some((r) => r !== null && them.has(r));
  const named = new Set<string>();
  if (!theirsListed) rs.forEach((r, i) => r !== null && !known(r) && rec(i) && named.add(r));
  if (!theirsListed && named.size <= 1) return rs.map((r, i): ListedWhy => (known(r) || !rec(i) ? "not_recording" : "one"));
  // 3. Otherwise nothing more is kept; only counted.
  return rs.map((r, i): ListedWhy => (r === null ? "no_recorder" : them.has(r) || !asked.has(i) || asked.get(i) ? "address" : "not_recording"));
}

/** PK-4: what one list found, in numbers only (Settings › Connections › Pocket shows them; never a title or a name). */
export type ListCounts = { listed: number; notRecordings: number; kept: number; address: number; noRecorder: number; outside: number };

/** PK-4: the counts from each item's why. `outside` (not in Calls' last 14 days, or not ended) is added by the caller. */
export function countWhy(why: readonly ListedWhy[]): Omit<ListCounts, "outside"> {
  const n = (w: ListedWhy) => why.filter((x) => x === w).length;
  return { listed: why.length, notRecordings: n("not_recording"), kept: n("mine") + n("one"), address: n("address"), noRecorder: n("no_recorder") };
}

export type Segment = { start: number | null; end: number | null; speaker: string; text: string };

/** Whether Pocket gave the lines times. */
export const hasTimes = (segs: readonly Segment[]) => segs.some((s) => s.start !== null);

/**
 * Pocket's line times in seconds. Its docs give no unit for a segment's start and end; its examples (3.5) and the
 * recording's length (seconds, per its webhooks page) read as seconds. When the last end is far past the recording's
 * length, they are milliseconds.
 */
export function inSeconds(segs: readonly Segment[], recordingSeconds: number | null): Segment[] {
  // A loop, not a spread: a long transcript has more segments than a call's arguments can hold.
  let last = 0;
  for (const s of segs) last = Math.max(last, s.end ?? s.start ?? 0);
  const millis = recordingSeconds !== null && recordingSeconds > 0 && last > recordingSeconds * 1.5 + 60;
  return millis ? segs.map((s) => ({ ...s, start: s.start === null ? null : s.start / 1000, end: s.end === null ? null : s.end / 1000 })) : [...segs];
}

/**
 * The part of a recording during its call, 5 minutes either side, as seconds from the recording's start. Segments
 * without a time are never in a part (the setup said the whole recording comes in when none has one).
 */
export function partDuring(segs: readonly Segment[], r: Pick<RecordingSpan, "startAt">, c: Span): Segment[] {
  const from = (ms(c.startAt) - ms(r.startAt)) / 1000 - AROUND_S;
  const to = (ms(c.endAt) - ms(r.startAt)) / 1000 + AROUND_S;
  return segs.filter((s) => s.start !== null && (s.end ?? s.start) >= from && s.start <= to);
}

/**
 * Segments as a call's transcript lines: "Speaker 1", "Speaker 2" in the order of Pocket's label numbers (the lowest
 * first) when every label ends in a number, else in the order they first speak; a speaker's name is never read. The
 * line's time is seconds from the recording's start (null when Pocket gave none). Through `linesOf`, the upload's own
 * merging, splitting and line limit.
 */
export function pocketLines(segs: readonly Segment[]): TranscriptLine[] {
  const labels = [...new Set(segs.map((s) => s.speaker))];
  const num = (l: string) => /(\d+)$/.exec(l)?.[1];
  const ordered = labels.every((l) => num(l) !== undefined) ? [...labels].sort((a, b) => Number(num(a)) - Number(num(b))) : labels;
  const name = new Map(ordered.map((l, i) => [l, `Speaker ${i + 1}`]));
  return linesOf(segs.map((s) => ({ speaker: name.get(s.speaker)!, at: s.start, text: s.text })));
}
