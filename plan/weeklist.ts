// The week plan by client (step 11): each followed client's list of DevOps features and stories for a week, split
// into Must and Nice to have, in DevOps stack rank order unless reordered locally (never written back). Pins to a day
// or half-day are optional. Pure: ordering, done (DevOps state, a local mark, a done pick), progress per client, the
// midweek on-track question and when a dropped must offers a heads-up. No I/O.
import type { ClientWork, IsoDate } from "../week/types.ts";

export type Tier = "must" | "nice";
export type ItemLevel = "feature" | "story";
export const TIER_NAMES: Record<Tier, string> = { must: "Must", nice: "Nice to have" };
/** A new item's share of the client's week, in blocks (editable in half-block steps). */
export const DEFAULT_BLOCKS: Record<ItemLevel, number> = { feature: 1, story: 0.5 };
export const MAX_BLOCKS = 20;

export type Pin = { date: IsoDate; half: "AM" | "PM" };
export type ListItem = {
  clientKey: string;
  itemId: number;
  level: ItemLevel;
  tier: Tier;
  blocks: number;
  /** Local order within the client's tier; null follows DevOps stack rank. */
  position: number | null;
  doneAt: string | null;
  slots: readonly Pin[];
  createdAt: string;
};

/** A valid block count: 0.5 to 20 in half steps. */
export const validBlocks = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0.5 && n <= MAX_BLOCKS && Number.isInteger(n * 2);

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
    return seen.stateCategory === "Completed" ? "done" : seen.stateCategory === "Resolved" ? "resolved" : seen.stateCategory === "Removed" ? "removed" : "open";
  };
}

export type DoneBy = "local" | "devops" | "resolved" | "pick";
/** Done: a local mark, DevOps Completed or Resolved (Q65), or (a story) a pick of it ticked done this week. */
export function itemDone(i: Pick<ListItem, "clientKey" | "itemId" | "level" | "doneAt">, devops: (clientKey: string, itemId: number) => DevOpsState, pickDone: (clientKey: string, itemId: number) => boolean): DoneBy | null {
  if (i.doneAt) return "local";
  const d = devops(i.clientKey, i.itemId);
  if (d === "done") return "devops";
  if (d === "resolved") return "resolved";
  if (i.level === "story" && pickDone(i.clientKey, i.itemId)) return "pick";
  return null;
}

export type Progress = { clientKey: string; musts: number; done: number; left: number; leftBlocks: number; nice: number };
/** Per client, against the current plan: musts done of musts now on the list, and the blocks the open ones need. */
export function progress<T extends Pick<ListItem, "clientKey" | "tier" | "blocks">>(items: readonly T[], done: (i: T) => boolean): Progress[] {
  const out = new Map<string, Progress>();
  for (const i of items) {
    const p = out.get(i.clientKey) ?? { clientKey: i.clientKey, musts: 0, done: 0, left: 0, leftBlocks: 0, nice: 0 };
    if (i.tier === "nice") p.nice++;
    else {
      p.musts++;
      if (done(i)) p.done++;
      else {
        p.left++;
        p.leftBlocks += i.blocks;
      }
    }
    out.set(i.clientKey, p);
  }
  return [...out.values()];
}

/** "Fabrikam: 2 of 4 musts done". */
export const progressLabel = (p: Pick<Progress, "musts" | "done">) => (p.musts ? `${p.done} of ${p.musts} must${p.musts === 1 ? "" : "s"} done` : "No musts");

/** A block's free share still ahead of `now`: whole when it hasn't started, the part left when under way. */
export type CapacityBlock = { start: string; end: string; freeMinutes: number; totalMinutes: number; pto: boolean };
export function blocksLeft(blocks: readonly CapacityBlock[], now: string): number {
  const t = Temporal.Instant.from(now);
  let n = 0;
  for (const b of blocks) {
    if (b.pto || b.totalMinutes <= 0) continue;
    const s = Temporal.Instant.from(b.start), e = Temporal.Instant.from(b.end);
    if (Temporal.Instant.compare(e, t) <= 0) continue;
    const share = Math.min(1, b.freeMinutes / b.totalMinutes);
    const span = s.until(e).total("minutes");
    const ahead = Temporal.Instant.compare(s, t) >= 0 ? 1 : span > 0 ? t.until(e).total("minutes") / span : 0;
    n += share * ahead;
  }
  return Math.round(n * 10) / 10;
}

export type TrackKind = "none" | "done" | "on_track" | "at_risk";
const blocksWord = (n: number) => {
  const r = Math.round(n * 2) / 2;
  return r === 0.5 ? "half a block" : `${r} block${r === 1 ? "" : "s"}`;
};
/**
 * The midweek question per client: the blocks its open musts need against the blocks still ahead this week. Worded as
 * a question, never an alarm: "3 musts left, 2 blocks left. Still realistic?"
 */
export function onTrack(p: Pick<Progress, "musts" | "left" | "leftBlocks">, remainingBlocks: number): { kind: TrackKind; text: string } {
  if (!p.musts) return { kind: "none", text: "No musts this week" };
  if (!p.left) return { kind: "done", text: "All musts done" };
  // Compared at the half block the text shows, so "1 must left, 1 block left" never asks.
  const r = Math.round(remainingBlocks * 2) / 2;
  const left = `${p.left} must${p.left === 1 ? "" : "s"} left, ${r <= 0 ? "no blocks" : blocksWord(r)} left.`;
  return p.leftBlocks > r + 1e-9 ? { kind: "at_risk", text: `${left} Still realistic?` } : { kind: "on_track", text: `${left} Looks doable.` };
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

type ListLike = Pick<ListItem, "clientKey" | "itemId" | "level" | "tier" | "position" | "doneAt" | "blocks">;
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
): { items: Listed<F>[]; progress: Progress[] } {
  const devops = devopsStateFrom(work);
  const items = orderList(features, stackRank(work, portfolios)).map((f) => ({ ...f, done: itemDone(f, devops, pickDone) }));
  return { items, progress: progress(items, (i) => !!i.done) };
}
