// PV-1, WD-2: small rules about stories on blocks. Which items are child level (a story is what a day plans; features
// and epics are only headers), the client's known work as one pool, DevOps backlog order, a block's short label, and a
// card's to-dos grouped under their feature. (WD-2: the Week panel's "Your stories" list went with the Details panel;
// the block panel's Add list is plan/blockpanel.ts.) Pure: no I/O.
import type { ClientWork, Half, IsoDate, TypeLook, WorkItem } from "../week/types.ts";

/** Child level in the project's process (stories, and bugs on the story backlog); tasks and portfolio items aren't. */
export function isChildLevel(item: Pick<WorkItem, "type" | "level">, types: readonly TypeLook[] | undefined): boolean {
  const look = types?.find((t) => t.name === item.type);
  if (look?.level) return look.level === "child";
  // Older caches or no backlog metadata: the story backlog level.
  return item.level === "story";
}

/** Every item the client's DevOps read has, once each: mine, children, committed features and parents read by id. */
export function workPool(work: Pick<ClientWork, "items" | "children" | "committed" | "parents">): WorkItem[] {
  const seen = new Set<number>();
  const out: WorkItem[] = [];
  for (const i of [...work.items, ...work.children, ...(work.committed ?? []), ...(work.parents ?? [])]) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    out.push(i);
  }
  return out;
}

/** Backlog order: the process's order field, unset last, then id. */
export const byBacklog = (a: Pick<WorkItem, "order" | "id">, b: Pick<WorkItem, "order" | "id">) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) || a.id - b.id;

/** "Thu AM", for "Planned · Thu AM". */
export function blockLabel(at: { date: IsoDate; half: Half }): string {
  const day = Temporal.PlainDate.from(at.date).toLocaleString("en-US", { weekday: "short" });
  return `${day} ${at.half === "EVE" ? "evening" : at.half}`;
}

/** A Week card's picks under small feature headers: features in the order their first pick comes, "No feature" last. */
export type CardGroup<P> = { feature: Pick<WorkItem, "id" | "title" | "type" | "url"> | null; picks: P[] };

export function cardGroups<P extends { clientKey: string; itemId: number | null }>(picks: readonly P[], work: Pick<ClientWork, "items" | "children" | "committed" | "parents"> | undefined): CardGroup<P>[] {
  const pool = work ? workPool(work) : [];
  const byId = new Map(pool.map((x) => [x.id, x]));
  const groups = new Map<number | null, CardGroup<P>>();
  for (const p of picks) {
    const item = p.itemId !== null ? byId.get(p.itemId) : undefined;
    const parent = item?.parentId != null ? byId.get(item.parentId) : undefined;
    const f = parent && parent.level === "portfolio" ? parent : null;
    const k = f?.id ?? null;
    const g = groups.get(k) ?? groups.set(k, { feature: f ? { id: f.id, title: f.title, type: f.type, url: f.url } : null, picks: [] }).get(k)!;
    g.picks.push(p);
  }
  const none = groups.get(null);
  groups.delete(null);
  return [...groups.values(), ...(none ? [none] : [])];
}
