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
 * Which listed recordings are kept, from their recorders' addresses alone: one whose recorder is me (any address
 * FocusTime knows me by), or every one when the whole list has one and the same recorder (a key someone made for
 * themselves under an address FocusTime doesn't know). Everything else is dropped unread and only counted.
 */
export function whoseKept(recorders: readonly (string | null)[], mine: readonly string[]): boolean[] {
  const me = new Set(mine.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const rs = recorders.map((r) => (r === null ? null : r.trim().toLowerCase() || null));
  const first = rs[0] ?? null;
  const oneRecorder = first !== null && rs.every((r) => r === first);
  return rs.map((r) => r !== null && (me.has(r) || oneRecorder));
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
  const last = Math.max(0, ...segs.map((s) => s.end ?? s.start ?? 0));
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
