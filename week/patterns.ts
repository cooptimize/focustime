import { weekDates } from "./dates.ts";
import type { DayPart, FocusBlock, FocusPattern, Half, IsoDate, StandingBlock, WorkWeekday } from "./types.ts";

const WORK_DAYS: readonly WorkWeekday[] = ["Mon", "Tue", "Wed", "Thu"];

function halvesOf(part: DayPart): Half[] {
  return part === "AllDay" ? ["AM", "PM"] : [part];
}

function inRange(date: IsoDate, start: IsoDate, end: IsoDate | null): boolean {
  const d = Temporal.PlainDate.from(date);
  if (Temporal.PlainDate.compare(d, Temporal.PlainDate.from(start)) < 0) return false;
  return end === null || Temporal.PlainDate.compare(d, Temporal.PlainDate.from(end)) <= 0;
}

function bySlot(a: FocusBlock, b: FocusBlock): number {
  return a.date === b.date ? a.half.localeCompare(b.half) : a.date.localeCompare(b.date);
}

/** Expand recurring Focus Time patterns into AM/PM focus blocks for Mon to Thu of one week. */
export function expandPatterns(patterns: readonly FocusPattern[], weekStart: IsoDate): FocusBlock[] {
  const dates = weekDates(weekStart);
  const out: FocusBlock[] = [];
  for (const p of patterns) {
    if (!p.active) continue;
    WORK_DAYS.forEach((wd, i) => {
      const part = p.days[wd];
      const date = dates[i]!;
      if (!part || !inRange(date, p.startDate, p.endDate)) return;
      for (const half of halvesOf(part)) {
        const block: FocusBlock = { id: `${p.id}:${date}:${half}`, clientKey: p.clientKey, clientName: p.clientName, date, half, source: "dataverse", patternId: p.id };
        if (p.clientFullName) block.clientFullName = p.clientFullName;
        out.push(block);
      }
    });
  }
  return out.sort(bySlot);
}

/** Standing blocks from Coopilot config, placed on this week's dates. */
export function standingBlocksFor(standing: readonly StandingBlock[], weekStart: IsoDate): FocusBlock[] {
  const dates = weekDates(weekStart);
  return standing.map((s) => {
    const date = dates[WORK_DAYS.indexOf(s.day)]!;
    return { id: `standing:${s.day}:${s.half}:${s.clientKey}`, clientKey: s.clientKey, clientName: s.clientName, date, half: s.half, source: "config" as const };
  });
}

/**
 * Focus blocks for one half-day. Dataverse blocks come first and win; a standing block for a
 * different client stays in the list so the slot reads as double-booked. Blocks for the same
 * client are merged (first one kept), since they are not a conflict.
 */
export function mergeFocus(dataverse: readonly FocusBlock[], standing: readonly FocusBlock[]): FocusBlock[] {
  const seen = new Set<string>();
  const out: FocusBlock[] = [];
  for (const b of [...dataverse, ...standing]) {
    if (seen.has(b.clientKey)) continue;
    seen.add(b.clientKey);
    out.push(b);
  }
  return out;
}
