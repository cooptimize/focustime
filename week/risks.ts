import { iso } from "./dates.ts";
import { formatDuration, formatRange, toZoned } from "./format.ts";
import type { CalEvent, FocusBlock, FreeGap, PlacedEvent, Risk, RiskRule, RiskThresholds, Severity } from "./types.ts";

export type RiskInput = {
  focus: readonly FocusBlock[];
  /** Events placed in this half-day, clipped to it. */
  events: readonly PlacedEvent[];
  /** All-day events on this date. */
  allDay: readonly CalEvent[];
  start: string;
  end: string;
  /** Working time inside the slot (step 6b). Free time, meeting load and conflicts count only here. Default: start to end. */
  windows?: readonly { start: string; end: string }[];
  timeZone: string;
};

export type RiskResult = { risks: Risk[]; longestFreeMinutes: number; busyMeetingMinutes: number; freeGaps: FreeGap[] };

/** Free and working-elsewhere events are ignored everywhere. Missing or unknown showAs counts as busy. */
export function isBusy(e: CalEvent): boolean {
  return e.showAs !== "free" && e.showAs !== "workingElsewhere";
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
  return b.source === "dataverse" ? "Dataverse" : "standing block, FocusTime config";
}

/**
 * The four v1 rules from docs/spec.md section 6. Only half-days with a focus block are evaluated.
 * Returned in rule order: meeting load, personal conflict, no focus window, double-booked.
 */
export function evaluateRisks(input: RiskInput, t: RiskThresholds): RiskResult {
  const windows = union((input.windows ?? [{ start: input.start, end: input.end }]).map((w): Interval => [ms(w.start), ms(w.end)]));
  /** The parts of an interval inside working time. */
  const inWork = ([a, b]: Interval): Interval[] => windows.map(([x, y]): Interval => [Math.max(a, x), Math.min(b, y)]).filter(([x, y]) => y > x);
  const workMinutes = (iv: Interval) => inWork(iv).reduce((n, [x, y]) => n + (y - x), 0) / 60000;
  const busy = input.events.filter((p) => isBusy(p.event));
  // Unavailable time is busy (it takes free time) but it is not a meeting.
  const meetingIvs = busy.filter((p) => !p.event.isPersonal && !p.event.unavailable).flatMap((p) => inWork([ms(p.clipStart), ms(p.clipEnd)]));
  const busyMeetingMinutes = minutes(union(meetingIvs).reduce((sum, [a, b]) => sum + (b - a), 0));
  const busyIvs = busy.map((p): Interval => [ms(p.clipStart), ms(p.clipEnd)]);
  const gapIvs = windows.flatMap(([a, b]) => gaps(busyIvs, a, b));
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
    risks.push({ rule: "meeting_load", severity, reason: `${formatDuration(busyMeetingMinutes)} of meetings inside ${block}`, short: `${formatDuration(busyMeetingMinutes)} of meetings` });
  }

  // 2. Personal conflict: timed events overlapping (at risk), all-day events on the day (watch)
  const overlapsWork = (p: PlacedEvent) => workMinutes([ms(p.clipStart), ms(p.clipEnd)]) > 0;
  for (const p of busy.filter((x) => x.event.isPersonal && overlapsWork(x))) {
    const range = formatRange(toZoned(p.event.start, input.timeZone), toZoned(p.event.end, input.timeZone));
    risks.push({ rule: "personal_conflict", severity: "at_risk", reason: `${p.event.title} ${range} overlaps ${block}`, short: `${p.event.title} ${clockOf(p.event.start, input.timeZone)}` });
  }
  for (const e of input.allDay.filter((x) => x.isPersonal && isBusy(x))) {
    risks.push({ rule: "personal_conflict", severity: "watch", reason: `All-day personal event: ${e.title}`, short: `${e.title} all day` });
  }

  // Q7: out of office puts covered half-days at risk; other all-day Outlook events flag only when busy.
  for (const p of busy.filter((x) => !x.event.isPersonal && x.event.showAs === "oof" && overlapsWork(x))) {
    const range = formatRange(toZoned(p.event.start, input.timeZone), toZoned(p.event.end, input.timeZone));
    risks.push({ rule: "out_of_office", severity: "at_risk", reason: `Out of office (${p.event.title}) ${range} overlaps ${block}`, short: `Out of office ${clockOf(p.event.start, input.timeZone)}` });
  }
  for (const e of input.allDay.filter((x) => !x.isPersonal)) {
    if (e.showAs === "oof") risks.push({ rule: "out_of_office", severity: "at_risk", reason: `Out of office (${e.title}) covers ${block}`, short: "Out of office" });
    else if (e.showAs === "busy" || e.showAs === undefined) risks.push({ rule: "all_day_busy", severity: "watch", reason: `All-day busy event: ${e.title}`, short: `${e.title} all day` });
  }

  // 3. No focus window
  if (longestFreeMinutes < t.minFocusWindowMinutes) {
    risks.push({
      rule: "no_focus_window",
      severity: "at_risk",
      reason: `Longest free stretch is ${formatDuration(longestFreeMinutes)}, under ${formatDuration(t.minFocusWindowMinutes)}, in ${block}`,
      short: longestFreeMinutes ? `Longest gap ${formatDuration(longestFreeMinutes)}` : "No free time",
    });
  }

  // 4. Double-booked
  if (input.focus.length > 1) {
    const names = input.focus.map((b) => `${b.clientName} (${sourceLabel(b)})`);
    risks.push({ rule: "double_booked_block", severity: "at_risk", reason: `Double-booked: ${names.join(" and ")}`, short: "Double-booked" });
  }

  return { risks, longestFreeMinutes, busyMeetingMinutes, freeGaps };
}

/** "12:00", "9:30": a start time for the short reason (no AM/PM; the card shows its own range). */
function clockOf(at: string, tz: string): string {
  const z = toZoned(at, tz);
  return `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")}`;
}

export function worstSeverity(risks: readonly Risk[]): Severity | null {
  if (risks.some((r) => r.severity === "at_risk")) return "at_risk";
  return risks.length ? "watch" : null;
}

/**
 * Most serious first: at risk before watch; within a level, out of office, personal conflict,
 * double-booked block, no focus window, all-day event, meetings. Stable for equal ranks.
 */
const RULE_ORDER: readonly RiskRule[] = ["out_of_office", "personal_conflict", "double_booked_block", "no_focus_window", "all_day_busy", "meeting_load"];

export function rankRisks(risks: readonly Risk[]): Risk[] {
  const sev = (r: Risk) => (r.severity === "at_risk" ? 0 : 1);
  return [...risks].sort((a, b) => sev(a) - sev(b) || RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
}

/** The one badge a card shows, and how many others the details panel lists. */
export function topRisk(risks: readonly Risk[]): { top: Risk | null; more: number } {
  const ranked = rankRisks(risks);
  return { top: ranked[0] ?? null, more: Math.max(0, ranked.length - 1) };
}
