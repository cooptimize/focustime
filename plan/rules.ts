// Plan the day rules: capacity, fit, carry-over, block client and story level. Pure, no I/O.
import { pickNeed } from "./types.ts";
import { isResolved } from "./process.ts";
import { freeMinutes } from "../week/free.ts";
import type { Half, IsoDate, WorkItem } from "../week/types.ts";
import { SIZE_MINUTES, type Pick, type Size } from "./types.ts";


/**
 * Real capacity of a half-day: the same total free time the week view shows (week/free.ts, D100), counting
 * only time from `now` on, so planning at 9:40 doesn't plan the 9:00 to 9:40 that has passed. PTO lowers it.
 */
export function capacityMinutes(slot: Parameters<typeof freeMinutes>[0], now: string): number {
  return freeMinutes(slot, now);
}

/** Planned minutes of the picks still to do (planned); done, moved and dropped don't use capacity. */
export function plannedMinutes(picks: readonly Pick[], sizes: Readonly<Record<Size, number>> = SIZE_MINUTES): number {
  return picks.filter((p) => p.status === "planned").reduce((sum, p) => sum + pickNeed(p, sizes), 0);
}

export type Fit = { kind: "empty" } | { kind: "fits"; spare: number } | { kind: "tight"; spare: number } | { kind: "over"; by: number };

/** Less than this much slack left counts as tight. */
export const TIGHT_SLACK_MINUTES = 30;

export function fitOf(planned: number, capacity: number): Fit {
  if (planned === 0) return { kind: "empty" };
  if (planned > capacity) return { kind: "over", by: planned - capacity };
  const spare = capacity - planned;
  return spare < TIGHT_SLACK_MINUTES ? { kind: "tight", spare } : { kind: "fits", spare };
}

/** How far back unfinished picks are offered again. */
export const CARRY_DAYS = 7;

/**
 * Carry-over for `today`: picks still planned on an earlier date within CARRY_DAYS. Moving a pick marks
 * the original "moved", and done or dropped picks are settled, so each unfinished pick shows once until
 * it is carried, done or dropped. Newest day first, then block and position.
 */
export function carryOver(picks: readonly Pick[], today: IsoDate, days = CARRY_DAYS, pending: (p: Pick) => boolean = () => false): Pick[] {
  if (days <= 0) return [];
  const t = Temporal.PlainDate.from(today);
  const from = t.subtract({ days });
  return picks
    .filter((p) => p.status === "planned")
    .filter((p) => {
      const d = Temporal.PlainDate.from(p.date);
      return Temporal.PlainDate.compare(d, t) < 0 && Temporal.PlainDate.compare(d, from) >= 0;
    })
    // A pick being made up tonight or on a weekend isn't unfinished until its session has ended (Q45).
    .filter((p) => !pending(p))
    .sort((a, b) => b.date.localeCompare(a.date) || a.half.localeCompare(b.half) || a.position - b.position);
}

/**
 * When the session a pick sits in ends, for picks in an evening or on a day without regular hours (a weekend): the
 * later of the day's last working span and its flex sessions, else midnight ("24:00"). Null for a regular morning or
 * afternoon pick, which carry-over never waits for (Q45).
 */
export function sessionEnd(p: Pick, day: { segments: readonly { end: string }[]; main: { end: string } | null }, flexEnds: readonly string[]): string | null {
  if (p.half !== "EVE" && day.main) return null;
  const ends = [...(p.half === "EVE" ? day.segments.slice(1) : day.segments).map((s) => s.end), ...flexEnds].sort();
  return ends.at(-1) ?? "24:00";
}

export type BlockClient = { clientKey: string | null; mixed: boolean; clients: string[] };

/**
 * The client of a block: its focus block's client, or for an Open half-day the client of the first pick.
 * Mixing clients in one block is allowed but flagged. Only picks still in play (planned or done) count.
 */
export function blockClient(focusClientKey: string | null, picks: readonly Pick[]): BlockClient {
  const live = [...picks].filter((p) => p.status === "planned" || p.status === "done").sort((a, b) => a.position - b.position);
  const clients = [...new Set(live.map((p) => p.clientKey))];
  const clientKey = focusClientKey ?? clients[0] ?? null;
  return { clientKey, mixed: clients.some((c) => c !== clientKey), clients };
}

/** Only story-level items (child and task levels, and parent types that don't need breakdown) that aren't resolved can be picked. */
export const isPickable = (item: { level: WorkItem["level"]; stateCategory?: string }) => item.level === "story" && !isResolved(item.stateCategory);

/** Why an item can't be picked, in plain words, or null when it can. */
export function unpickableReason(item: { level: WorkItem["level"]; type: string; state?: string; stateCategory?: string }): string | null {
  if (item.level === "story" && isResolved(item.stateCategory)) return `It's ${item.state || "resolved"} in DevOps, so there are no hours left on it`;
  if (item.level === "story") return null;
  if (item.level === "portfolio") return `${item.type} is above story level. Pick one of its child items, or add a draft story if it has none`;
  return `${item.type} is not on the story, task or bug backlog, so it can't be a to-do`;
}

/**
 * Pickable descendants of a portfolio item from the children read for it (up to two levels: epic, feature, story).
 * Empty means "Needs breakdown".
 */
export function pickableChildren(parentId: number, children: readonly WorkItem[]): WorkItem[] {
  const direct = children.filter((c) => c.parentId === parentId);
  const below = direct.filter((c) => c.level === "portfolio").flatMap((c) => children.filter((g) => g.parentId === c.id));
  return [...direct, ...below].filter(isPickable);
}

type CommittedRef = {
  clientKey: string;
  itemId: number;
  title: string;
  url: string | null;
  slots: readonly { date: IsoDate; half: "AM" | "PM" }[];
  /** Step 11: must or nice to have (missing: must), feature or story (missing: feature), done this week. */
  tier?: "must" | "nice";
  level?: "feature" | "story";
  done?: boolean;
};
type WorkLike = { items: readonly WorkItem[]; children: readonly WorkItem[]; committed?: readonly WorkItem[] };

export type WeekEntry<R extends CommittedRef = CommittedRef> = { feature: R; tier: "must" | "nice"; level: "feature" | "story"; placedHere: boolean; pinnedToday: boolean; item: WorkItem | null; kids: WorkItem[] };

/**
 * Plan the day draws from the week (step 11): in a client's block, its unfinished musts first, then nice-to-haves,
 * then the rest of the board. Within each, items pinned to this half-day, then to this day, then the week list's
 * order (the caller passes it ordered). A feature opens into its pickable stories (anyone's open stories under it); a
 * story is picked directly. `item` is null when DevOps can't show it right now. `rest` is the board without them.
 */
export function weekFirst<R extends CommittedRef>(work: WorkLike | undefined, refs: readonly R[], clientKey: string, date: IsoDate, half: Half) {
  const pin = (r: R) => (r.slots.some((s) => s.date === date && s.half === half) ? 0 : r.slots.some((s) => s.date === date) ? 1 : 2);
  const mine = refs.filter((r) => r.clientKey === clientKey && !r.done).map((r, n) => ({ r, n })).sort((a, b) => pin(a.r) - pin(b.r) || a.n - b.n).map((x) => x.r);
  // My own items under a feature are in the board list, not its children list: look in both (board order first).
  const pool = work ? [...work.items, ...work.children.filter((c) => !work.items.some((i) => i.id === c.id)), ...(work.committed ?? [])] : [];
  const entries = mine.map((r): WeekEntry<R> => {
    const level = r.level ?? "feature";
    const item = pool.find((i) => i.id === r.itemId) ?? null;
    return { feature: r, tier: r.tier ?? "must", level, placedHere: pin(r) === 0, pinnedToday: pin(r) <= 1, item, kids: work && level === "feature" ? pickableChildren(r.itemId, pool) : [] };
  });
  const listed = new Set(refs.filter((r) => r.clientKey === clientKey).map((r) => r.itemId));
  const under = new Set(entries.flatMap((e) => e.kids.map((k) => k.id)));
  const rest = (work?.items ?? []).filter((i) => !listed.has(i.id) && !under.has(i.id));
  const musts = entries.filter((e) => e.tier === "must");
  const nice = entries.filter((e) => e.tier === "nice");
  return { musts, nice, committed: [...musts, ...nice], rest };
}

/** Step 8's name for it: features committed to the week first (now musts, then nice-to-haves). */
export const committedFirst = weekFirst;

/** Step 13.6 (D243): an epic with no features offers a draft feature; a feature (or an older cached item) a draft story. */
export function draftOffer(item: { level: WorkItem["level"]; tier?: "feature" | "epic" | undefined }): { kind: "feature" | "story"; action: "draft.add_feature" | "draft.add_story"; label: string } {
  return item.tier === "epic" ? { kind: "feature", action: "draft.add_feature", label: "Draft feature" } : { kind: "story", action: "draft.add_story", label: "Draft story" };
}
