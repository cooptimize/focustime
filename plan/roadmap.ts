// The Roadmap view (step 16, D278 to D281): features and epics I own, their stories done and open, who works on
// them, a daily snapshot trend and a plain on-track signal against the target date. Pure: no I/O, no tokens.
import type { ClientPortfolio, IsoDate, PortfolioItem } from "../week/types.ts";

export type RoadmapSnapshot = { date: IsoDate; done: number; open: number };
export type StoryCounts = { done: number; open: number; people: { name: string; count: number; /** The DevOps email, for matching only (never shown); null for me or when unknown. */ email: string | null }[]; unassigned: number; unsized: number | null; stale: number };

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
  // Step 16.4: one person per email (DevOps uniqueName) when there is one, so two people with the same display name stay
  // apart and one person's renamed display name doesn't split them; the display name only when there is no email.
  const byKey = new Map<string, { name: string; email: string | null; count: number }>();
  // My own stories show as "You", whatever my display name is.
  for (const c of open) {
    const name = c.mine ? "You" : c.assignedTo;
    if (!name) continue;
    const email = c.mine ? null : (c.assignedToEmail ?? null);
    const key = c.mine ? "me" : email ? `e:${email}` : `n:${name}`;
    const p = byKey.get(key) ?? { name, email, count: 0 };
    p.count++;
    byKey.set(key, p);
  }
  const cutoff = Temporal.Instant.from(now).subtract({ hours: STALE_DAYS * 24 }).epochMilliseconds;
  return {
    done: kids.length - open.length,
    open: open.length,
    people: [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
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
/** Whole numbers only (step 16.4): "about 3 close a week", or "about 1 closes every 3 weeks" when slower. */
export const paceText = (r: number) => (r < 0.75 ? `about 1 closes every ${Math.max(2, Math.round(1 / r))} weeks` : `about ${Math.round(r)} close a week`);
/** "2 weeks", "10 days", "1 day": weeks once two or more, whole. */
export function leftText(days: number): string {
  if (days % 7 === 0 && days > 0) return `${days / 7} ${days === 7 ? "week" : "weeks"}`;
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"}`;
  return `${Math.round(days / 7)} weeks`;
}

// ---- Step 17: one state per row ----

/** The states, in the order they are evaluated: the first that applies wins (D344). */
export const STATE_ORDER = ["blocked", "at_risk", "not_scoped", "stalled", "watch", "needs_date", "on_track", "done"] as const;
export type RoadmapStateKind = (typeof STATE_ORDER)[number];
export const STATE_WORDS: Record<RoadmapStateKind, string> = {
  blocked: "Blocked", at_risk: "At risk", not_scoped: "Not scoped", stalled: "Stalled", watch: "Watch", needs_date: "Needs a date", on_track: "On track", done: "Done",
};
/** What each state means, for "What do these mean?". */
export const STATE_MEANING: Record<RoadmapStateKind, string> = {
  blocked: "A story under it is blocked (Blocked state or tag).",
  at_risk: "At the pace stories close, it won't finish by its target date, or the date has passed.",
  not_scoped: "It has no stories yet (an epic: no features yet).",
  stalled: "No story under it has changed for a while.",
  watch: "At the pace stories close, it finishes close to its target date.",
  needs_date: "It has open stories and no target date.",
  on_track: "At the pace stories close, it finishes before its target date (or the trend is still building).",
  done: "Every story under it is done or resolved.",
};
/** Settings > Roadmap (D345): whole numbers. */
export type RoadmapThresholds = { stalledDays: number; watchWeeks: number };
export const DEFAULT_THRESHOLDS: RoadmapThresholds = { stalledDays: STALE_DAYS, watchWeeks: 1 };

export type RowStateInput = {
  open: number;
  done: number;
  /** Open children that are blocked. */
  blocked: number;
  /** The latest change of any child (ISO instant), null when unknown or none. */
  lastActivity: string | null;
  perWeek: number | null;
  /** Days of snapshot history behind perWeek. */
  days: number;
  targetDate: IsoDate | null;
  today: IsoDate;
  now: string;
  noun: "stories" | "features";
  th?: RoadmapThresholds;
};
export type RowState = {
  state: RoadmapStateKind;
  reason: string;
  /** Under a week of daily counts: rule-based states only, no pace (D346). */
  trendBuilding: boolean;
  /** When the open work finishes at the current pace (whole days from today); null without a pace. */
  forecastEnd: IsoDate | null;
};

/** The day the open work finishes at `perWeek`, rounded up to a whole day; null without a pace. */
export function forecastEnd(open: number, perWeek: number | null, today: IsoDate): IsoDate | null {
  if (perWeek === null || perWeek <= 0 || open <= 0) return null;
  return Temporal.PlainDate.from(today).add({ days: Math.ceil((open / perWeek) * 7) }).toString();
}

/**
 * One state per row (step 17, D344), evaluated in STATE_ORDER. The pace rules (At risk, Watch) need a week of daily
 * counts; before that only the rules that need no pace apply (a passed target date is still At risk).
 */
export function rowState(i: RowStateInput): RowState {
  const th = i.th ?? DEFAULT_THRESHOLDS;
  const total = i.open + i.done;
  const building = i.perWeek === null || i.days < MIN_HISTORY_DAYS;
  const fc = building ? null : forecastEnd(i.open, i.perWeek, i.today);
  const out = (state: RoadmapStateKind, reason: string): RowState => ({ state, reason, trendBuilding: building, forecastEnd: fc });
  const open = `${count(i.open, i.noun)} open`;
  const left = i.targetDate ? daysBetween(i.today, i.targetDate) : null;
  const leftWords = left === null ? null : left === 0 ? "due today" : `${leftText(left)} left`;
  const pace = building ? null : i.perWeek === 0 ? `none closed in the last ${i.days} days` : paceText(i.perWeek!);
  const sentence = (...parts: (string | null)[]) => parts.filter(Boolean).join(", ");

  if (total === 0) return out("not_scoped", `No ${i.noun} yet`);
  if (i.open === 0) return out("done", `All ${count(i.done, i.noun)} done`);
  if (i.blocked > 0) return out("blocked", `${count(i.blocked, i.noun)} blocked, ${open}`);
  // At risk: the date has passed, or the pace won't make it.
  let paced: "at_risk" | "watch" | null = null;
  let needed: string | null = null;
  if (left !== null && left < 0) return out("at_risk", `Target date passed ${leftText(-left)} ago, ${open}`);
  if (left !== null && !building) {
    if (i.perWeek === 0) paced = left < 14 ? "at_risk" : "watch";
    else {
      const late = daysBetween(i.targetDate!, fc!);
      if (late > 0) {
        paced = "at_risk";
        needed = `needs about ${leftText(daysBetween(i.today, fc!))}`;
      } else if (-late < th.watchWeeks * 7) paced = "watch";
    }
  }
  if (paced === "at_risk") return out("at_risk", sentence(open, pace, leftWords, needed));
  const quietDays = i.lastActivity ? Math.floor((Temporal.Instant.from(i.now).epochMilliseconds - Temporal.Instant.from(i.lastActivity).epochMilliseconds) / 86_400_000) : null;
  if (quietDays === null || quietDays >= th.stalledDays) return out("stalled", quietDays === null ? `No story changes seen, ${open}` : `No story changes in ${leftText(quietDays)}, ${open}`);
  if (paced === "watch") return out("watch", sentence(open, pace, leftWords));
  if (!i.targetDate) return out("needs_date", sentence(open, pace, "no target date"));
  return out("on_track", sentence(open, pace, leftWords));
}

/** The latest change among an item's children (stories, or an epic's features), Removed left out. */
export function lastActivity(item: PortfolioItem): string | null {
  let best: string | null = null;
  for (const c of item.children) {
    if (c.stateCategory === "Removed" || !c.changedAt) continue;
    if (!best || Temporal.Instant.compare(Temporal.Instant.from(c.changedAt), Temporal.Instant.from(best)) > 0) best = c.changedAt;
  }
  return best;
}

/** The earliest change among an item's children: the closest Coopilot gets to "first story activity" (Plan ahead). */
export function firstActivity(item: PortfolioItem): string | null {
  let best: string | null = null;
  for (const c of item.children) {
    if (c.stateCategory === "Removed" || !c.changedAt) continue;
    if (!best || Temporal.Instant.compare(Temporal.Instant.from(c.changedAt), Temporal.Instant.from(best)) < 0) best = c.changedAt;
  }
  return best;
}

/** Open children that are blocked (one level down, Removed left out). */
export function blockedCount(item: PortfolioItem): number {
  const level = item.tier === "epic" ? "portfolio" : "story";
  return item.children.filter((c) => c.level === level && c.stateCategory !== "Removed" && !DONE.has(c.stateCategory) && c.blocked).length;
}

/** Features and epics I contribute to: the parent of a story assigned to me, not assigned to me (D347). */
export function contributingItems(p: ClientPortfolio): PortfolioItem[] {
  return p.items.filter((i) => !i.why.includes("assigned") && i.why.includes("parent"));
}

// ---- Step 17: the status board's filters (they combine; empty lists mean all) ----

export type RoadmapSort = "risk" | "target";
export type RoadmapFilter = { relation: "both" | "owned" | "contributing"; states: RoadmapStateKind[]; clients: string[]; q: string; sort: RoadmapSort; overbooked?: boolean };
export const DEFAULT_FILTER: RoadmapFilter = { relation: "both", states: [], clients: [], q: "", sort: "risk" };
type FilterRow = { id: number; title: string; relation: "owned" | "contributing"; targetDate: IsoDate | null; status: { state: RoadmapStateKind } };

const textMatch = (r: FilterRow, q: string) => {
  const t = q.trim().toLowerCase().replace(/^#/, "");
  return !t || r.title.toLowerCase().includes(t) || String(r.id) === t;
};
/** Every filter but the state ones: what the summary bar counts, so its numbers stay true while states are chosen. */
export function baseMatch(clientKey: string, r: FilterRow, f: RoadmapFilter): boolean {
  return (f.relation === "both" || r.relation === f.relation) && (!f.clients.length || f.clients.includes(clientKey)) && textMatch(r, f.q);
}
/** The rows to show for one client, in the chosen order: risk (state order, then target date) or target date. */
export function filterRows<R extends FilterRow>(clientKey: string, rows: readonly R[], f: RoadmapFilter, extra: (r: R) => boolean = () => true): R[] {
  const rank = (r: R) => STATE_ORDER.indexOf(r.status.state);
  const date = (r: R) => r.targetDate ?? "9999-12-31";
  return rows
    .filter((r) => baseMatch(clientKey, r, f) && (!f.states.length || f.states.includes(r.status.state)) && extra(r))
    .sort((a, b) => (f.sort === "risk" ? rank(a) - rank(b) || date(a).localeCompare(date(b)) : date(a).localeCompare(date(b)) || rank(a) - rank(b)) || a.title.localeCompare(b.title));
}
/** State counts for the summary bar, over the rows the other filters keep. */
export function stateCounts(clients: readonly { clientKey: string; rows: readonly FilterRow[] }[], f: RoadmapFilter): Record<RoadmapStateKind, number> {
  const out = Object.fromEntries(STATE_ORDER.map((k) => [k, 0])) as Record<RoadmapStateKind, number>;
  for (const c of clients) for (const r of c.rows) if (baseMatch(c.clientKey, r, f)) out[r.status.state]++;
  return out;
}
