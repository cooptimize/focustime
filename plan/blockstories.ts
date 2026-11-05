// PV-1 (D569): the Week block panel's "Your stories for <client>". Only stories are planned into a day, so the panel
// lists only child-level items (per the project's process) assigned to me for the block's client, open ones only,
// grouped under their parent feature. Features and epics are only group headers, never plannable rows.
// Order: features on this week's plan first (the plan's order: musts, then nice to haves, by hand, then stack rank),
// then other features with my open stories in DevOps backlog order; stories in a group in backlog order; stories with
// no parent under "No feature" last. A feature on this week's plan with no open stories of mine still shows, with my
// teammates' open stories in it (for Take one). Pure: no I/O.
import { isOpen } from "./process.ts";
import { aboutText, storyMinutes, type StorySize } from "./estimate.ts";
import { orderList } from "./weeklist.ts";
import type { ClientWork, Half, IsoDate, TypeLook, WorkItem } from "../week/types.ts";

/** Where a story is planned this week: the block, and the pick to move. */
export type PlannedAt = { date: IsoDate; half: Half; pickId: number };

export type StoryRow = {
  item: WorkItem;
  /** The FocusTime size: its pick's this week, else its size on the week list; null counts as 2h. */
  size: StorySize | null;
  minutes: number;
  /** Planned in this block (a pick here). */
  here: PlannedAt | null;
  /** Planned in another block this week (the first one), shown as "Planned · Thu AM", never hidden. */
  elsewhere: PlannedAt | null;
};

export type StoryGroup = {
  /** The parent item (a feature, or an epic for a story right under one); null: "No feature". */
  feature: WorkItem | null;
  /** On this week's plan for this client. */
  committed: boolean;
  /** My open stories in it, in backlog order. */
  stories: StoryRow[];
  /** The sum of my stories' hours. */
  minutes: number;
  /** Teammates' open stories in it (any other assignee or none), only when I have none, in backlog order. */
  others: WorkItem[];
};

type PickLike = { id: number; date: IsoDate; half: Half; clientKey: string; itemId: number | null; status: string; size: StorySize | null };
type ListLike = { clientKey: string; itemId: number; level: "feature" | "story"; tier: "must" | "nice"; position: number | null; size: StorySize | null; weekStart: IsoDate };

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

export function blockStories(i: {
  work: Pick<ClientWork, "clientKey" | "items" | "children" | "committed" | "parents" | "types">;
  /** This week's list (any client; only this client's, this week's, are used). */
  list: readonly ListLike[];
  weekStart: IsoDate;
  /** This week's picks (any client). */
  picks: readonly PickLike[];
  date: IsoDate;
  half: Half;
}): StoryGroup[] {
  const { work } = i;
  const client = work.clientKey;
  const pool = workPool(work);
  const byId = new Map(pool.map((x) => [x.id, x]));
  const live = i.picks.filter((p) => p.clientKey === client && p.itemId !== null && (p.status === "planned" || p.status === "done"));
  const list = i.list.filter((f) => f.clientKey === client && f.weekStart === i.weekStart);
  const listSize = new Map(list.filter((f) => f.level === "story").map((f) => [f.itemId, f.size]));
  const stories = (mine: boolean) => pool.filter((x) => isChildLevel(x, work.types) && isOpen(x.stateCategory) && !!x.assignedToMe === mine);

  const row = (item: WorkItem): StoryRow => {
    const mineHere = live.filter((p) => p.itemId === item.id);
    const hereP = mineHere.find((p) => p.date === i.date && p.half === i.half) ?? null;
    const other = mineHere.filter((p) => p !== hereP).sort((a, b) => a.date.localeCompare(b.date) || halfRank(a.half) - halfRank(b.half))[0] ?? null;
    const size = hereP?.size ?? other?.size ?? listSize.get(item.id) ?? null;
    const at = (p: PickLike | null): PlannedAt | null => (p ? { date: p.date, half: p.half, pickId: p.id } : null);
    return { item, size, minutes: storyMinutes(size), here: at(hereP), elsewhere: at(other) };
  };

  // A story's group: its parent when that is a portfolio item we know; else "No feature".
  const groupOf = (s: WorkItem): number | null => {
    const p = s.parentId !== null ? byId.get(s.parentId) : undefined;
    return p && !isChildLevel(p, work.types) && p.level === "portfolio" ? p.id : null;
  };
  const mine = stories(true).sort(byBacklog);
  const groups = new Map<number | null, WorkItem[]>();
  for (const s of mine) {
    const g = groupOf(s);
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }

  // This week's plan for the client, in the plan's order (feature level only).
  const rank = (_: string, id: number) => byId.get(id)?.order ?? null;
  const planned = orderList(list.filter((f) => f.level === "feature"), rank).map((f) => f.itemId);
  const plannedSet = new Set(planned);
  const others = stories(false);

  const out: StoryGroup[] = [];
  const make = (featureId: number | null): StoryGroup => {
    const rows = (groups.get(featureId) ?? []).map(row);
    const feature = featureId === null ? null : byId.get(featureId) ?? null;
    return {
      feature,
      committed: featureId !== null && plannedSet.has(featureId),
      stories: rows,
      minutes: rows.reduce((n, r) => n + r.minutes, 0),
      others: rows.length || featureId === null ? [] : others.filter((o) => o.parentId === featureId).sort(byBacklog),
    };
  };
  for (const id of planned) {
    // A feature on the plan that DevOps no longer has (closed, removed, not read) isn't shown.
    const f = byId.get(id);
    if (!f || !isOpen(f.stateCategory)) continue;
    out.push(make(id));
  }
  const rest = [...groups.keys()].filter((k): k is number => k !== null && !plannedSet.has(k)).map((k) => byId.get(k)!).sort(byBacklog);
  for (const f of rest) out.push(make(f.id));
  if (groups.has(null)) out.push(make(null));
  return out;
}

const halfRank = (h: Half) => (h === "AM" ? 0 : h === "PM" ? 1 : 2);

/** "3 stories · about 6h", "1 story · about 2h". */
export function groupLine(g: Pick<StoryGroup, "stories" | "minutes">): string {
  const n = g.stories.length;
  return `${n} ${n === 1 ? "story" : "stories"} · ${aboutText(g.minutes)}`;
}

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
