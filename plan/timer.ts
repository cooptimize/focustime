// The focus timer (step 6c). Pure: plain data the server stores (so it survives window close and restarts), and
// the rules for pausing, ending, extending and the 5-minute warnings. Time comes in as an Instant.
import { formatTime } from "../week/format.ts";
import type { Day, Slot } from "../week/types.ts";
import type { Size } from "./types.ts";

export type TimerKind = "focus" | "break";

export type TimerState = {
  kind: TimerKind;
  /** The pick it is timeboxing; null for a plain timer. */
  pickId: number | null;
  label: string;
  plannedMinutes: number;
  /** Milliseconds counted before the current run. */
  elapsedMs: number;
  /** ISO instant the current run started; null when paused or ended. */
  runningSince: string | null;
  startedAt: string;
  /** Reached its length; waiting for Done, +15 min or Next pick. */
  ended: boolean;
  /** Warning points already sent (their keys). */
  warned: string[];
  /** Step 16.3: deep focus (my Teams status is Do not disturb instead of Busy). Missing in older states: false. */
  deep?: boolean;
};

/** One stretch of focused time, for the focus log. */
export type Segment = { startedAt: string; endedAt: string; seconds: number };

/** Preset lengths in 5-minute steps (plus Custom in the UI). */
export const PRESETS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120] as const;
export const MAX_MINUTES = 240;
export const WARN_MINUTES = 5;

const ms = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;

export function startTimer(now: Temporal.Instant, o: { kind: TimerKind; pickId: number | null; label: string; minutes: number; deep?: boolean }): TimerState {
  return { kind: o.kind, pickId: o.pickId, label: o.label, plannedMinutes: o.minutes, elapsedMs: 0, runningSince: now.toString(), startedAt: now.toString(), ended: false, warned: [], ...(o.deep && o.kind === "focus" ? { deep: true } : {}) };
}

export const elapsedMs = (s: TimerState, now: Temporal.Instant) => s.elapsedMs + (s.runningSince ? Math.max(0, now.epochMilliseconds - ms(s.runningSince)) : 0);
export const remainingMs = (s: TimerState, now: Temporal.Instant) => Math.max(0, s.plannedMinutes * 60_000 - elapsedMs(s, now));

/** The running part from runningSince to `end`, or null when not running. */
function segmentTo(s: TimerState, end: Temporal.Instant): Segment | null {
  if (!s.runningSince) return null;
  const seconds = Math.max(0, Math.round((end.epochMilliseconds - ms(s.runningSince)) / 1000));
  return { startedAt: s.runningSince, endedAt: end.toString(), seconds };
}

export function pauseTimer(s: TimerState, now: Temporal.Instant): { state: TimerState; segment: Segment | null } {
  if (!s.runningSince) return { state: s, segment: null };
  return { state: { ...s, elapsedMs: elapsedMs(s, now), runningSince: null }, segment: segmentTo(s, now) };
}

export function resumeTimer(s: TimerState, now: Temporal.Instant): TimerState {
  return s.runningSince || s.ended ? s : { ...s, runningSince: now.toString() };
}

/** Stops: the running part is logged; the caller clears the stored state. */
export function stopTimer(s: TimerState, now: Temporal.Instant): { segment: Segment | null } {
  return { segment: pauseTimer(s, now).segment };
}

/**
 * Checks whether a running timer has reached its length. It ends at exactly that moment even when noticed late
 * (the window was closed or the server was down), so only the planned length is logged.
 */
export function tickTimer(s: TimerState, now: Temporal.Instant): { state: TimerState; ended: boolean; segment: Segment | null } {
  if (!s.runningSince || s.ended) return { state: s, ended: false, segment: null };
  const left = remainingMs(s, now);
  if (left > 0) return { state: s, ended: false, segment: null };
  const endAt = Temporal.Instant.fromEpochMilliseconds(ms(s.runningSince) + (s.plannedMinutes * 60_000 - s.elapsedMs));
  return { state: { ...s, elapsedMs: s.plannedMinutes * 60_000, runningSince: null, ended: true }, ended: true, segment: segmentTo(s, endAt) };
}

/** Adds minutes; an ended timer runs again from now. */
export function extendTimer(s: TimerState, now: Temporal.Instant, minutes: number): TimerState {
  const plannedMinutes = Math.min(MAX_MINUTES * 2, s.plannedMinutes + minutes);
  return s.ended ? { ...s, plannedMinutes, ended: false, runningSince: now.toString() } : { ...s, plannedMinutes };
}

/** A pick's suggested length: its size's minutes, to the 5-minute step below, within 5 to 240. */
export function suggestMinutes(size: Size, sizes: Readonly<Record<Size, number>>): number {
  return Math.max(5, Math.min(MAX_MINUTES, Math.floor(sizes[size] / 5) * 5));
}

// ---- warnings ----
export type WarnPoint = { key: string; at: string; label: string };
const SLOT_NAMES: Record<Slot["half"], string> = { AM: "morning", PM: "afternoon", EVE: "evening" };

/** Busy meeting starts and the ends of working windows on a day: what a session is warned about. */
export function warnPoints(day: Day, tz: string): WarnPoint[] {
  const at = (iso: string) => formatTime(Temporal.Instant.from(iso).toZonedDateTimeISO(tz));
  const out = new Map<string, WarnPoint>();
  for (const s of [day.am, day.pm, ...(day.eve ? [day.eve] : [])]) {
    for (const p of s.events) {
      const e = p.event;
      if (e.allDay || e.showAs === "free" || e.showAs === "workingElsewhere" || e.responseStatus === "declined") continue;
      const key = `event:${e.source}:${e.id}:${e.start}`;
      out.set(key, { key, at: e.start, label: `${e.title} at ${at(e.start)}` });
    }
    const last = s.windows.at(-1);
    if (last) {
      const key = `end:${s.half}:${last.end}`;
      out.set(key, { key, at: last.end, label: `The ${SLOT_NAMES[s.half]} ends at ${at(last.end)}` });
    }
  }
  return [...out.values()].sort((a, b) => ms(a.at) - ms(b.at));
}

/** Points within the next WARN_MINUTES not warned about yet. */
export function dueWarnings(points: readonly WarnPoint[], now: Temporal.Instant, warned: readonly string[]): WarnPoint[] {
  const t = now.epochMilliseconds;
  return points.filter((p) => !warned.includes(p.key) && t >= ms(p.at) - WARN_MINUTES * 60_000 && t < ms(p.at));
}
