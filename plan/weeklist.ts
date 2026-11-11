// The week plan by client (step 11): each followed client's list of DevOps features and stories for a week, in DevOps
// backlog (stack rank) order. CF-1: no Must or Nice to have; every feature on the week counts the same. Pins to a day
// or half-day are optional. Pure: ordering and done (DevOps state, a local mark, a done pick). No I/O.
import { isCompleted, isRemoved, isResolved } from "./process.ts";
import type { ClientWork, IsoDate } from "../week/types.ts";
import { validEstimateHours, type SizeScale } from "./estimate.ts";
import type { StorySize } from "./estimate.ts";

/** The stored tier column (`week_features.tier`), kept unread since CF-1 so the idea can come back. */
export type Tier = "must" | "nice";
export type ItemLevel = "feature" | "story";
export { MAX_ESTIMATE_HOURS } from "./estimate.ts";

export type Pin = { date: IsoDate; half: "AM" | "PM" };
export type ListItem = {
  clientKey: string;
  itemId: number;
  level: ItemLevel;
  /** E2: a feature's estimate in minutes (null: 4h), used until a sized story of it is on the list; null for a story. */
  estimate: number | null;
  /** Step 16.4: a story's size and parent feature. */
  size?: StorySize | null;
  parentId?: number | null;
  /** The old local order (Move up / Move down, gone in CF-1); stored, no longer read for order. */
  position: number | null;
  doneAt: string | null;
  slots: readonly Pin[];
  createdAt: string;
};

/** A valid estimate: whole hours, 1 to 80 (E2). */
export const validHours = validEstimateHours;

/**
 * List order (CF-1): the client's DevOps backlog order (unknown rank last, then by id). Clients keep the order they
 * come in.
 */
export function orderList<T extends Pick<ListItem, "clientKey" | "itemId">>(items: readonly T[], rank: (clientKey: string, itemId: number) => number | null): T[] {
  const clients = [...new Set(items.map((i) => i.clientKey))];
  const r = (i: T) => rank(i.clientKey, i.itemId) ?? Number.POSITIVE_INFINITY;
  return [...items].sort((a, b) => clients.indexOf(a.clientKey) - clients.indexOf(b.clientKey) || r(a) - r(b) || a.itemId - b.itemId);
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

/** A pin's label: "Tue PM". */
export const pinLabel = (p: Pin) => `${Temporal.PlainDate.from(p.date).toLocaleString("en-US", { weekday: "short" })} ${p.half}`;

/** The rule key of a week heads-up follow-up (step 7's slip kind). CF-1 makes none; old ones are still found by it. */
export const headsUpKey = (weekStart: IsoDate, clientKey: string, itemId: number) => `slip:week:${weekStart}:${clientKey}:${itemId}`;
type ListLike = Pick<ListItem, "clientKey" | "itemId" | "level" | "doneAt" | "estimate"> & Partial<Pick<ListItem, "size" | "parentId">>;
export type Listed<F> = F & { done: DoneBy | null };
/** Picks ticked done, by client and DevOps item (a story's pick done counts it done). */
export function pickDoneFrom(days: Readonly<Record<string, { picks: readonly { clientKey: string; itemId: number | null; status: string }[] }>> | null | undefined): (clientKey: string, itemId: number) => boolean {
  const done = new Set<string>();
  for (const d of Object.values(days ?? {})) for (const p of d.picks) if (p.status === "done" && p.itemId !== null) done.add(`${p.clientKey}:${p.itemId}`);
  return (k, id) => done.has(`${k}:${id}`);
}
/**
 * The week list as every view shows it: in backlog order (orderList on stack rank), each item with how it is done.
 */
export function weekList<F extends ListLike>(
  features: readonly F[],
  work: readonly ClientWork[] | null,
  _sizes: SizeScale,
  portfolios: readonly { clientKey: string; items: readonly { id: number; order: number | null }[] }[] = [],
  pickDone: (clientKey: string, itemId: number) => boolean = () => false,
  resolved: (clientKey: string, itemId: number) => boolean = () => false,
): { items: Listed<F>[] } {
  const devops = devopsStateFrom(work);
  const items = orderList(features, stackRank(work, portfolios)).map((f) => ({ ...f, done: itemDone(f, devops, pickDone, resolved) }));
  return { items };
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
