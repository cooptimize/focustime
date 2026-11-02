// The Roadmap view (step 16, D278 to D281): features and epics I own, their stories done and open, who works on
// them, a daily snapshot trend and a plain on-track signal against the target date. Pure: no I/O, no tokens.
import type { ClientPortfolio, IsoDate, PortfolioItem } from "../week/types.ts";

export type RoadmapSnapshot = { date: IsoDate; done: number; open: number };
export type RoadmapLevel = "on_track" | "watch" | "at_risk";
export type RoadmapSignal = { level: RoadmapLevel | null; reason: string };
export type StoryCounts = { done: number; open: number; people: { name: string; count: number }[]; unassigned: number; unsized: number | null; stale: number };

/** Days without a change before an open story counts as quiet. */
export const STALE_DAYS = 14;
/** How far back the trend looks. */
export const TREND_DAYS = 21;
/** How much history the signal needs. */
export const MIN_HISTORY_DAYS = 7;
const DONE = new Set(["Resolved", "Completed"]);

/** The features and epics assigned to me (not those only listed as a parent of my stories or above them). */
export function ownedItems(p: ClientPortfolio): PortfolioItem[] {
  return p.items.filter((i) => i.why.includes("assigned"));
}

/**
 * Done and open among an item's direct children one level down: stories under a feature, features under an epic.
 * Resolved and Completed are done; Removed is left out. People, unassigned, unsized and quiet count open ones only.
 */
export function storyCounts(item: PortfolioItem, now: string, sizeKnown: boolean): StoryCounts {
  const level = item.tier === "epic" ? "portfolio" : "story";
  const kids = item.children.filter((c) => c.level === level && c.stateCategory !== "Removed");
  const open = kids.filter((c) => !DONE.has(c.stateCategory));
  const byName = new Map<string, number>();
  // My own stories show as "You", whatever my display name is.
  for (const c of open) {
    const name = c.mine ? "You" : c.assignedTo;
    if (name) byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  const cutoff = Temporal.Instant.from(now).subtract({ hours: STALE_DAYS * 24 }).epochMilliseconds;
  return {
    done: kids.length - open.length,
    open: open.length,
    people: [...byName].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    unassigned: open.filter((c) => !c.assignedTo).length,
    // Sizes are for stories: an epic's features have no unsized count.
    unsized: sizeKnown && item.tier === "feature" ? open.filter((c) => c.size === null || c.size === undefined).length : null,
    stale: open.filter((c) => c.changedAt && Temporal.Instant.from(c.changedAt).epochMilliseconds < cutoff).length,
  };
}

const daysBetween = (a: IsoDate, b: IsoDate) => Temporal.PlainDate.from(a).until(Temporal.PlainDate.from(b), { largestUnit: "days" }).days;

/** Stories closed per week from the oldest snapshot in the last 21 days to the newest; never negative. */
export function trendRate(snaps: readonly RoadmapSnapshot[], today: IsoDate): { perWeek: number | null; days: number; points: RoadmapSnapshot[] } {
  const from = Temporal.PlainDate.from(today).subtract({ days: TREND_DAYS }).toString();
  const points = snaps.filter((s) => s.date >= from && s.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 2) return { perWeek: null, days: 0, points };
  const first = points[0]!, last = points[points.length - 1]!;
  const days = daysBetween(first.date, last.date);
  if (days <= 0) return { perWeek: null, days: 0, points };
  return { perWeek: (Math.max(0, last.done - first.done) / days) * 7, days, points };
}

const count = (n: number, noun: "stories" | "features") => `${n} ${n === 1 ? (noun === "stories" ? "story" : "feature") : noun}`;
const rateText = (r: number) => (r < 1 ? String(Math.round(r * 10) / 10) : String(Math.round(r)));
function leftText(days: number): string {
  if (days % 7 === 0) return `${days / 7} ${days === 7 ? "week" : "weeks"}`;
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"}`;
  return `${Math.round(days / 7)} weeks`;
}

/**
 * On track, Watch or At risk against the target date, from the simple rate only (D281). No target date, or less than
 * a week of snapshots, gives no signal, only the reason.
 */
export function roadmapSignal(i: { open: number; done: number; perWeek: number | null; days: number; targetDate: IsoDate | null; today: IsoDate; noun: "stories" | "features" }): RoadmapSignal {
  if (i.open === 0 && i.done === 0) return { level: null, reason: `No ${i.noun} yet` };
  if (i.open === 0) return { level: "on_track", reason: `All ${count(i.done, i.noun)} done` };
  if (!i.targetDate) return { level: null, reason: "No target date" };
  const left = daysBetween(i.today, i.targetDate);
  if (left < 0) return { level: "at_risk", reason: `Target date passed, ${count(i.open, i.noun)} open` };
  if (i.perWeek === null || i.days < MIN_HISTORY_DAYS) return { level: null, reason: `Trend after a week of daily counts (${i.days} ${i.days === 1 ? "day" : "days"} so far)` };
  const target = `${leftText(left)} to target`;
  if (i.perWeek === 0) return { level: left >= 14 ? "watch" : "at_risk", reason: `${count(i.open, i.noun)} open, none closed in the last ${i.days} days, ${target}` };
  const needed = i.open / i.perWeek, weeksLeft = left / 7;
  const level: RoadmapLevel = needed <= weeksLeft ? "on_track" : needed <= 1.5 * weeksLeft ? "watch" : "at_risk";
  return { level, reason: `${count(i.open, i.noun)} open, about ${rateText(i.perWeek)} closed per week, ${target}` };
}
