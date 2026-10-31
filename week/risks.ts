import { iso } from "./dates";
import { formatDuration, formatRange, toZoned } from "./format";
import type { CalEvent, FocusBlock, FreeGap, PlacedEvent, Risk, RiskThresholds, Severity } from "./types";

export type RiskInput = {
  focus: readonly FocusBlock[];
  /** Events placed in this half-day, clipped to it. */
  events: readonly PlacedEvent[];
  /** All-day events on this date. */
  allDay: readonly CalEvent[];
  start: string;
  end: string;
  timeZone: string;
};

export type RiskResult = { risks: Risk[]; longestFreeMinutes: number; busyMeetingMinutes: number; freeGaps: FreeGap[] };

/** Free events are ignored everywhere. Missing showAs counts as busy. */
export function isBusy(e: CalEvent): boolean {
  return e.showAs !== "free";
}

type Interval = [number, number];
const ms = (isoStr: string) => Temporal.Instant.from(isoStr).epochMilliseconds;

function union(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

const minutes = (msVal: number) => Math.round(msVal / 60000);

function gaps(busy: Interval[], start: number, end: number): Interval[] {
  const out: Interval[] = [];
  let cursor = start;
  for (const [a, b] of union(busy)) {
    if (a > cursor) out.push([cursor, Math.min(a, end)]);
    cursor = Math.max(cursor, b);
  }
  if (end > cursor) out.push([cursor, end]);
  return out.filter(([a, b]) => b > a);
}

function sourceLabel(b: FocusBlock): string {
  return b.source === "dataverse" ? "Dataverse" : "standing block, Coopilot config";
}

/**
 * The four v1 rules from docs/spec.md section 6. Only half-days with a focus block are evaluated.
 * Returned in rule order: meeting load, personal conflict, no focus window, double-booked.
 */
export function evaluateRisks(input: RiskInput, t: RiskThresholds): RiskResult {
  const start = ms(input.start);
  const end = ms(input.end);
  const busy = input.events.filter((p) => isBusy(p.event));
  const meetingIvs = busy.filter((p) => !p.event.isPersonal).map((p): Interval => [ms(p.clipStart), ms(p.clipEnd)]);
  const busyMeetingMinutes = minutes(union(meetingIvs).reduce((sum, [a, b]) => sum + (b - a), 0));
  const gapIvs = gaps(busy.map((p): Interval => [ms(p.clipStart), ms(p.clipEnd)]), start, end);
  const longestFreeMinutes = gapIvs.reduce((best, [a, b]) => Math.max(best, minutes(b - a)), 0);
  const toIso = (x: number) => iso(Temporal.Instant.fromEpochMilliseconds(x).toZonedDateTimeISO(input.timeZone));
  const freeGaps = gapIvs.map(([a, b]) => ({ start: toIso(a), end: toIso(b), minutes: minutes(b - a) }));

  const primary = input.focus[0];
  if (!primary) return { risks: [], longestFreeMinutes, busyMeetingMinutes, freeGaps };
  const block = `the ${primary.clientName} block`;
  const risks: Risk[] = [];

  // 1. Meeting load
  if (busyMeetingMinutes >= t.meetingWatchMinutes) {
    const severity: Severity = busyMeetingMinutes >= t.meetingAtRiskMinutes ? "at_risk" : "watch";
    risks.push({ rule: "meeting_load", severity, reason: `${formatDuration(busyMeetingMinutes)} of meetings inside ${block}` });
  }

  // 2. Personal conflict: timed events overlapping (at risk), all-day events on the day (watch)
  for (const p of busy.filter((x) => x.event.isPersonal && x.minutesInside > 0)) {
    const range = formatRange(toZoned(p.event.start, input.timeZone), toZoned(p.event.end, input.timeZone));
    risks.push({ rule: "personal_conflict", severity: "at_risk", reason: `${p.event.title} ${range} overlaps ${block}` });
  }
  for (const e of input.allDay.filter((x) => x.isPersonal && isBusy(x))) {
    risks.push({ rule: "personal_conflict", severity: "watch", reason: `All-day personal event: ${e.title}` });
  }

  // 3. No focus window
  if (longestFreeMinutes < t.minFocusWindowMinutes) {
    risks.push({
      rule: "no_focus_window",
      severity: "at_risk",
      reason: `Longest free stretch is ${formatDuration(longestFreeMinutes)}, under ${formatDuration(t.minFocusWindowMinutes)}, in ${block}`,
    });
  }

  // 4. Double-booked
  if (input.focus.length > 1) {
    const names = input.focus.map((b) => `${b.clientName} (${sourceLabel(b)})`);
    risks.push({ rule: "double_booked_block", severity: "at_risk", reason: `Double-booked: ${names.join(" and ")}` });
  }

  return { risks, longestFreeMinutes, busyMeetingMinutes, freeGaps };
}

export function worstSeverity(risks: readonly Risk[]): Severity | null {
  if (risks.some((r) => r.severity === "at_risk")) return "at_risk";
  return risks.length ? "watch" : null;
}
