// The week plan by client (step 11): each followed client's list of DevOps features and stories for a week, split
// into Must and Nice to have, in DevOps stack rank order unless reordered locally (never written back). Pins to a day
// or half-day are optional. Pure: ordering, done (DevOps state, a local mark, a done pick), progress per client, the
// midweek on-track question and when a dropped must offers a heads-up. No I/O.
import { isCompleted, isRemoved, isResolved } from "./process.ts";
import type { ClientWork, IsoDate } from "../week/types.ts";
import { estimate, hoursText, storyMinutes, validEstimateHours } from "./estimate.ts";
import type { StorySize } from "./estimate.ts";

export type Tier = "must" | "nice";
export type ItemLevel = "feature" | "story";
export const TIER_NAMES: Record<Tier, string> = { must: "Must", nice: "Nice to have" };
export { MAX_ESTIMATE_HOURS } from "./estimate.ts";

export type Pin = { date: IsoDate; half: "AM" | "PM" };
export type ListItem = {
  clientKey: string;
  itemId: number;
  level: ItemLevel;
  tier: Tier;
  /** E2: a feature's estimate in minutes (null: 4h), used until a sized story of it is on the list; null for a story. */
  estimate: number | null;
  /** Step 16.4: a story's size and parent feature. */
  size?: StorySize | null;
  parentId?: number | null;
  /** Local order within the client's tier; null follows DevOps stack rank. */
  position: number | null;
  doneAt: string | null;
  slots: readonly Pin[];
  createdAt: string;
};

/** A valid estimate: whole hours, 1 to 80 (E2). */
export const validHours = validEstimateHours;

/**
 * List order: musts before nice-to-haves; within a client's tier, items placed by hand (position set) in that order,
 * then the rest in DevOps stack rank order (unknown rank last, then by id). Clients keep the order they come in.
 */
export function orderList<T extends Pick<ListItem, "clientKey" | "itemId" | "tier" | "position">>(items: readonly T[], rank: (clientKey: string, itemId: number) => number | null): T[] {
  const clients = [...new Set(items.map((i) => i.clientKey))];
  const r = (i: T) => rank(i.clientKey, i.itemId) ?? Number.POSITIVE_INFINITY;
  return [...items].sort(
    (a, b) =>
      clients.indexOf(a.clientKey) - clients.indexOf(b.clientKey) ||
      (a.tier === b.tier ? 0 : a.tier === "must" ? -1 : 1) ||
      (a.position === null ? 1 : 0) - (b.position === null ? 1 : 0) ||
      (a.position ?? 0) - (b.position ?? 0) ||
      r(a) - r(b) ||
      a.itemId - b.itemId,
  );
}

/**
 * Moving one item within its client's tier: the new order of the whole group as positions 1..n. `ordered` is the
 * group as shown (orderList); `to` is the index it moves to (clamped).
 */
export function moveWithin(ordered: readonly number[], itemId: number, to: number): { itemId: number; position: number }[] {
  const rest = ordered.filter((id) => id !== itemId);
  if (rest.length === ordered.length) return ordered.map((id, i) => ({ itemId: id, position: i + 1 }));
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), itemId, ...rest.slice(at)].map((id, i) => ({ itemId: id, position: i + 1 }));
}

/**
 * DevOps stack rank per client: the portfolio read's board order (features), then the work read's board order (my
 * items, then children, committed and watched items). Both reads come back in stack rank order already.
 */
export function stackRank(work: readonly ClientWork[] | null, portfolios: readonly { clientKey: string; items: readonly { id: number; order: number | null }[] }[] = []): (clientKey: string, itemId: number) => number | null {
  const map = new Map<string, number>();
  for (const p of portfolios) p.items.forEach((i, n) => map.has(`${p.clientKey}:${i.id}`) || map.set(`${p.clientKey}:${i.id}`, n));
  for (const w of work ?? []) {
    const all = [...w.items, ...w.children, ...(w.committed ?? []), ...(w.watched ?? [])];
    all.forEach((i, n) => {
      const k = `${w.clientKey}:${i.id}`;
      if (!map.has(k)) map.set(k, 1_000_000 + n);
    });
  }
  return (clientKey, itemId) => map.get(`${clientKey}:${itemId}`) ?? null;
}

export type DevOpsState = "open" | "resolved" | "done" | "removed" | null;

/**
 * An item's DevOps state from fresh results only (not failed, not cached): done when Completed, resolved when Resolved
 * (counts as done for the week, Q65), removed when Removed, open otherwise; null when DevOps can't say right now.
 */
export function devopsStateFrom(work: readonly ClientWork[] | null): (clientKey: string, itemId: number) => DevOpsState {
  return (clientKey, itemId) => {
    const w = work?.find((x) => x.clientKey === clientKey);
    if (!w || w.status !== "ok" || w.fromCache) return null;
    const seen = [...w.items, ...w.children, ...(w.committed ?? []), ...(w.watched ?? [])].find((i) => i.id === itemId);
    if (!seen) return null;
    return isCompleted(seen.stateCategory) ? "done" : isResolved(seen.stateCategory) ? "resolved" : isRemoved(seen.stateCategory) ? "removed" : "open";
  };
}

export type DoneBy = "local" | "devops" | "resolved" | "pick";
/** Done: a local mark, DevOps Completed or Resolved (Q65), or (a story) a pick of it ticked done this week. */
export function itemDone(i: Pick<ListItem, "clientKey" | "itemId" | "level" | "doneAt">, devops: (clientKey: string, itemId: number) => DevOpsState, pickDone: (clientKey: string, itemId: number) => boolean, resolved: (clientKey: string, itemId: number) => boolean = () => false): DoneBy | null {
  if (i.doneAt) return "local";
  const d = devops(i.clientKey, i.itemId);
  if (d === "done") return "devops";
  if (d === "resolved") return "resolved";
  // PL-1: the DevOps store says it's resolved, closed or removed (features read by id too, not only my work items).
  if (resolved(i.clientKey, i.itemId)) return "resolved";
  if (i.level === "story" && pickDone(i.clientKey, i.itemId)) return "pick";
  return null;
}

export type Progress = { clientKey: string; musts: number; done: number; left: number; /** Minutes the open musts still need (E2). */ leftMinutes: number; nice: number };
/**
 * Per client, against the current plan: musts done of musts now on the list (features and loose stories; a story
 * under a listed feature is part of it and takes its tier), and the minutes the open ones still need.
 */
export function progress<T extends Pick<ListItem, "clientKey" | "itemId" | "tier" | "estimate" | "level" | "size" | "parentId">>(items: readonly T[], done: (i: T) => boolean): Progress[] {
  const est = estimate(items.map((i) => ({ ...i, src: i, done: done(i) })));
  const out = new Map<string, Progress>();
  const at = (k: string) => out.get(k) ?? out.set(k, { clientKey: k, musts: 0, done: 0, left: 0, leftMinutes: 0, nice: 0 }).get(k)!;
  for (const i of items) at(i.clientKey);
  for (const e of est.envelopes) {
    const p = at(e.feature.clientKey);
    if (e.feature.tier === "nice") p.nice++;
    else {
      p.musts++;
      if (e.feature.done) p.done++;
      else {
        p.left++;
        p.leftMinutes += e.minutes - e.doneMinutes;
      }
    }
  }
  for (const s of est.loose) {
    const p = at(s.clientKey);
    if (s.tier === "nice") p.nice++;
    else {
      p.musts++;
      if (s.done) p.done++;
      else {
        p.left++;
        p.leftMinutes += storyMinutes(s.size as StorySize | null | undefined);
      }
    }
  }
  return [...out.values()];
}

/** "Fabrikam: 2 of 4 musts done". */
export const progressLabel = (p: Pick<Progress, "musts" | "done">) => (p.musts ? `${p.done} of ${p.musts} must${p.musts === 1 ? "" : "s"} done` : "No musts");

/**
 * Free focus time still ahead of `now` this week (E2): each block's free minutes (after meetings, personal events,
 * unavailable time; none on a day off), the one under way only for the share of it still to come.
 */
export type CapacityBlock = { start: string; end: string; freeMinutes: number; totalMinutes: number; pto: boolean };
export function freeLeft(blocks: readonly CapacityBlock[], now: string): number {
  const t = Temporal.Instant.from(now);
  let n = 0;
  for (const b of blocks) {
    if (b.pto || b.totalMinutes <= 0 || b.freeMinutes <= 0) continue;
    const s = Temporal.Instant.from(b.start), e = Temporal.Instant.from(b.end);
    if (Temporal.Instant.compare(e, t) <= 0) continue;
    const share = Temporal.Instant.compare(s, t) < 0 ? t.until(e).total("minutes") / s.until(e).total("minutes") : 1;
    n += Math.round(b.freeMinutes * share);
  }
  return n;
}

export type TrackKind = "none" | "done" | "on_track" | "at_risk";
/**
 * The midweek question per client: the minutes its open musts need against the free time still ahead this week.
 * Worded as a question, never an alarm: "3 musts left, about 6h free left. Still realistic?"
 */
export function onTrack(p: Pick<Progress, "musts" | "left" | "leftMinutes">, freeLeftMinutes: number): { kind: TrackKind; text: string } {
  if (!p.musts) return { kind: "none", text: "No musts this week" };
  if (!p.left) return { kind: "done", text: "All musts done" };
  const free = Math.max(0, freeLeftMinutes);
  const left = `${p.left} must${p.left === 1 ? "" : "s"} left, ${free ? `about ${hoursText(free)} free left` : "no free time left"}.`;
  return p.leftMinutes - free > 10 ? { kind: "at_risk", text: `${left} Still realistic?` } : { kind: "on_track", text: `${left} Looks doable.` };
}

/**
 * A heads-up follow-up is offered when a must is dropped (made nice to have or taken off) after the week was committed
 * with it on the list. Nothing else is asked.
 */
export function offersHeadsUp(i: Pick<ListItem, "tier" | "createdAt">, committedAt: string | null): boolean {
  if (!committedAt || i.tier !== "must") return false;
  return Temporal.Instant.compare(Temporal.ZonedDateTime.from(i.createdAt).toInstant(), Temporal.ZonedDateTime.from(committedAt).toInstant()) <= 0;
}

/** A pin's label: "Tue PM". */
export const pinLabel = (p: Pin) => `${Temporal.PlainDate.from(p.date).toLocaleString("en-US", { weekday: "short" })} ${p.half}`;

/** One heads-up follow-up per dropped must and week (the slip rule's kind, step 7). */
export const headsUpKey = (weekStart: IsoDate, clientKey: string, itemId: number) => `slip:week:${weekStart}:${clientKey}:${itemId}`;
/** The plain-text heads-up for a must dropped from a committed week. No AI, a template. */
export function weekHeadsUpDraft(clientName: string, weekStart: IsoDate, item: { itemId: number; title: string }): string {
  const week = Temporal.PlainDate.from(weekStart).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return [`Hi ${clientName}, a quick heads-up: #${item.itemId} ${item.title} won't be finished the week of ${week} as I planned.`, "I'll let you know where it lands."].join("\n");
}

type ListLike = Pick<ListItem, "clientKey" | "itemId" | "level" | "tier" | "position" | "doneAt" | "estimate"> & Partial<Pick<ListItem, "size" | "parentId">>;
export type Listed<F> = F & { done: DoneBy | null };
/** Picks ticked done, by client and DevOps item (a story's pick done counts it done). */
export function pickDoneFrom(days: Readonly<Record<string, { picks: readonly { clientKey: string; itemId: number | null; status: string }[] }>> | null | undefined): (clientKey: string, itemId: number) => boolean {
  const done = new Set<string>();
  for (const d of Object.values(days ?? {})) for (const p of d.picks) if (p.status === "done" && p.itemId !== null) done.add(`${p.clientKey}:${p.itemId}`);
  return (k, id) => done.has(`${k}:${id}`);
}
/**
 * The week list as every view shows it: in list order (orderList on stack rank), each item with how it is done, and
 * progress per client against the current list.
 */
export function weekList<F extends ListLike>(
  features: readonly F[],
  work: readonly ClientWork[] | null,
  portfolios: readonly { clientKey: string; items: readonly { id: number; order: number | null }[] }[] = [],
  pickDone: (clientKey: string, itemId: number) => boolean = () => false,
  resolved: (clientKey: string, itemId: number) => boolean = () => false,
): { items: Listed<F>[]; progress: Progress[] } {
  const devops = devopsStateFrom(work);
  const items = orderList(features, stackRank(work, portfolios)).map((f) => ({ ...f, done: itemDone(f, devops, pickDone, resolved) }));
  return { items, progress: progress(items, (i) => !!i.done) };
}

/**
 * E1: a feature's other open stories in DevOps (not on the week list) as one muted line instead of their titles:
 * "5 more stories · 2 assigned to others" (the second part only when some are). Null when there are none.
 */
export function otherStoriesLine(children: readonly { level: string; open: boolean; id: number; mine: boolean; assignedTo: string | null }[], listed: ReadonlySet<number>): string | null {
  const rest = children.filter((c) => c.level === "story" && c.open && !listed.has(c.id));
  if (!rest.length) return null;
  const others = rest.filter((c) => !c.mine && c.assignedTo != null).length;
  return `${rest.length} more ${rest.length === 1 ? "story" : "stories"}${others ? ` · ${others} assigned to others` : ""}`;
}
