// WD-2: the block panel's model, the one side panel for a block on Week and on Day. Pure: what the panel can do on
// this block (add, or only tick and move on a past day, or nothing on a day off), whose work it lists, what is on the
// block, the Add list before typing (Assigned to you: my features and stories grouped by feature; then More in the
// client), the search results with the two "New" rows, and what Take off the plan does to each kind of
// to-do. Every list is built for one client's key, so one client's items never show under another's heading (GD-2).
import type { DraftStory, Pick as Todo } from "./types.ts";
import type { Half, IsoDate, TypeLook, WorkItem } from "../week/types.ts";
import { matches } from "./addpane.ts";
import { isOpen, typeNeedsBreakdown } from "./process.ts";
import { blockWord, defaultAddBlock, roomWords, type BlockAt } from "./addwork.ts";
import { blockClient, isPickable } from "./rules.ts";

type FollowLike = { id: number; clientKey: string | null; due: string | null; openedAt: string; what: string; who?: string | null; hasWho?: boolean };
type PickLike = { id: number; date: IsoDate; half: Half; clientKey: string; itemId: number | null; draftId: number | null; followUpId: number | null; status: string };
type WorkLike = { items: readonly WorkItem[]; children: readonly WorkItem[]; committed?: readonly WorkItem[]; types?: readonly TypeLook[] };

const live = (p: { status: string }) => p.status === "planned" || p.status === "done";

/**
 * What the panel offers on a block: "add" (today or later, with working time: everything), "past" (a day that has
 * passed: tick, wrap up and move work forward; no Add), "off" (PTO or no working hours: what's on it, read only).
 */
export type PanelMode = "add" | "past" | "off";
export function panelMode(b: { date: IsoDate; today: IsoDate; pto: boolean; off: boolean }): PanelMode {
  if (b.date < b.today) return "past";
  return b.pto || b.off ? "off" : "add";
}

/**
 * The client whose work the block takes: its focus block's client; for an Open half-day or a catch-up block the one
 * chosen in the panel, else the client of the to-dos already on it. Null: none yet, so the chooser asks first.
 */
export function panelClient(focusClientKey: string | null, chosen: string | null, blockPicks: readonly Todo[]): { clientKey: string | null; choose: boolean } {
  if (focusClientKey) return { clientKey: focusClientKey, choose: false };
  return { clientKey: chosen ?? blockClient(null, blockPicks).clientKey, choose: true };
}

/**
 * The block the panel opens on. Asked for with its half: that block, whatever it can take (a past or PTO block opens
 * for ticking and reading). Asked for a day only: that day's block that can take work and isn't over, else its first
 * that can, else its first. Nothing asked ("+ Add" in the header): the block under way or the next one that can take
 * work, as before.
 */
export function panelBlock(blocks: readonly BlockAt[], now: string, asked?: { date: IsoDate | null; half: Half | null } | null): { date: IsoDate; half: Half } | null {
  if (asked?.date) {
    const same = blocks.filter((b) => b.date === asked.date);
    const t = Temporal.Instant.from(now);
    const hit = (asked.half ? same.find((b) => b.half === asked.half) : null) ?? same.find((b) => b.plannable && Temporal.Instant.compare(Temporal.Instant.from(b.end), t) > 0) ?? same.find((b) => b.plannable) ?? same[0];
    if (hit) return { date: hit.date, half: hit.half };
  }
  return defaultAddBlock(blocks, now, null);
}

/** The header's first line: "Northwind · Wed AM" ("Open · Wed AM" before a client is chosen). */
export function panelTitle(clientName: string | null, date: IsoDate, half: Half, o: { wholeDay?: boolean; open?: string } = {}): string {
  return `${clientName ?? o.open ?? "Open"} · ${blockWord(date, half, !!o.wholeDay)}`;
}

/** The header's second line: "8:00 to 12:30 · 1h free", "… · a little over"; no room on a past day or a day off. */
export function panelWhen(range: string, mode: PanelMode, freeMinutes: number, plannedMinutes: number): { text: string; over: boolean } {
  const span = range.replace("–", " to ");
  if (mode !== "add") return { text: mode === "past" ? `${span} · past` : span, over: false };
  const room = roomWords(freeMinutes, plannedMinutes);
  return { text: `${span} · ${room.text}`, over: room.over };
}

/** "2 meetings · 1h 15m", or null when the block has none (events shown as free don't count). */
export function meetingsWords(events: readonly { minutes: number; free: boolean }[]): string | null {
  const busy = events.filter((e) => !e.free);
  if (!busy.length) return null;
  const m = busy.reduce((n, e) => n + Math.max(0, e.minutes), 0);
  const dur = m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
  return `${busy.length} meeting${busy.length === 1 ? "" : "s"}${m ? ` · ${dur}` : ""}`;
}

/** The block's to-dos in the panel: planned and done ones, in their order. */
export function onBlock<P extends { date: IsoDate; half: Half; status: string; position: number }>(picks: readonly P[], at: { date: IsoDate; half: Half }): P[] {
  return picks.filter((p) => p.date === at.date && p.half === at.half && live(p)).sort((a, b) => a.position - b.position);
}

const keyOf = (p: PickLike) => (p.itemId !== null ? `i${p.clientKey}:${p.itemId}` : p.draftId !== null ? `d${p.draftId}` : p.followUpId !== null ? `f${p.followUpId}` : null);

/** Where each placed thing is this week: its key to the block it is on (the selected block first, else the earliest). */
export function placedMap(weekPicks: readonly PickLike[], at: { date: IsoDate; half: Half }): Map<string, { date: IsoDate; half: Half; pickId: number; here: boolean; done: boolean }> {
  const rank = { AM: 0, PM: 1, EVE: 2 } as const;
  const out = new Map<string, { date: IsoDate; half: Half; pickId: number; here: boolean; done: boolean }>();
  const sorted = weekPicks.filter(live).sort((a, b) => a.date.localeCompare(b.date) || rank[a.half] - rank[b.half]);
  for (const p of sorted) {
    const k = keyOf(p);
    if (!k) continue;
    const here = p.date === at.date && p.half === at.half;
    const had = out.get(k);
    if (!had || (here && !had.here)) out.set(k, { date: p.date, half: p.half, pickId: p.id, here, done: p.status === "done" });
  }
  return out;
}

/** WD-2 follow-up: how the Add list is ordered: the project's backlog order, or by target date (none last). */
export type ListSort = "backlog" | "target";
type Ordered = Pick<WorkItem, "id" | "order"> & { targetDate?: IsoDate | null };
const byBacklog = (a: Ordered, b: Ordered) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) || a.id - b.id;
const byTarget = (a: Ordered, b: Ordered) => (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999") || byBacklog(a, b);
export const sorter = (sort: ListSort) => (sort === "target" ? byTarget : byBacklog);
const open = (x: Pick<WorkItem, "stateCategory">) => isOpen(x.stateCategory);

/**
 * One group of "Assigned to you": a feature (mine, or someone else's that holds a story of mine) with my stories under
 * it, its other open stories folded behind "N more in this feature", and its local drafts; or "No feature".
 */
export type AssignedGroup = {
  /** Null: my stories with no feature. */
  feature: WorkItem | null;
  /** The feature is assigned to me (else it is here only because a story of mine is under it). */
  mine: boolean;
  /** My open stories under it, in the list's order. */
  stories: WorkItem[];
  /** Its other open stories (a teammate's or nobody's), folded. */
  others: WorkItem[];
  drafts: DraftStory[];
  /** A feature of mine with no stories and no drafts, of a type that needs breaking down. */
  breakDown: boolean;
  /** "2 of 4 on": its stories and drafts on a block this week, when any is (or it is on the week's list). */
  on: number;
  total: number;
  label: string | null;
};

export type AssignedInput = {
  clientKey: string;
  work: (WorkLike & { parents?: readonly WorkItem[] }) | undefined;
  drafts: readonly DraftStory[];
  /** The week's to-dos (any client). */
  weekPicks: readonly PickLike[];
  /** Ids of the client's features on this week's list. */
  onWeek?: ReadonlySet<number>;
  sort?: ListSort;
};

/**
 * "Assigned to you" for one client (GD-2: only that client's key): every open feature assigned to me and every open
 * story assigned to me, grouped under its feature. A story of mine shows under its feature even when the feature isn't
 * mine; one with no feature goes under "No feature", last. Features in the list's order (backlog, or target date); a
 * feature I don't own sits where its first story of mine falls. Done, closed and removed items are left out; epics
 * are never groups of their own.
 */
export function assignedList(i: AssignedInput): AssignedGroup[] {
  const w = i.work;
  if (!w) return [];
  const cmp = sorter(i.sort ?? "backlog");
  const pool = [...new Map([...w.items, ...w.children, ...(w.committed ?? []), ...(w.parents ?? [])].map((x) => [x.id, x])).values()];
  const byId = new Map(pool.map((x) => [x.id, x]));
  const placed = new Set(i.weekPicks.filter(live).map(keyOf).filter((k): k is string => !!k));
  const isFeature = (x: WorkItem) => x.level === "portfolio" && x.tier !== "epic";
  const myStories = pool.filter((x) => x.assignedToMe && isPickable(x) && open(x));
  const myFeatures = pool.filter((x) => x.assignedToMe && isFeature(x) && open(x));
  // A story's group: its parent when we know it and it isn't a story itself; else none.
  const parentOf = (x: WorkItem) => {
    const p = x.parentId != null ? byId.get(x.parentId) : undefined;
    return p && p.level === "portfolio" ? p : null;
  };
  const under = new Map<number | null, WorkItem[]>();
  for (const st of myStories) {
    const k = parentOf(st)?.id ?? null;
    under.set(k, [...(under.get(k) ?? []), st]);
  }
  const ids = new Set<number>([...myFeatures.map((f) => f.id), ...[...under.keys()].filter((k): k is number => k !== null)]);
  const group = (id: number): AssignedGroup & { key: Ordered } => {
    const feature = byId.get(id)!;
    const mine = !!feature.assignedToMe && isFeature(feature) && open(feature);
    const stories = [...(under.get(id) ?? [])].sort(cmp);
    const others = pool.filter((x) => x.parentId === id && !x.assignedToMe && isPickable(x) && open(x)).sort(cmp);
    const drafts = i.drafts.filter((d) => d.clientKey === i.clientKey && d.parentItemId === id && d.level === "story" && d.devopsId == null);
    const all = [...stories, ...others];
    const on = all.filter((x) => placed.has(`i${i.clientKey}:${x.id}`)).length + drafts.filter((d) => placed.has(`d${d.id}`)).length;
    const total = all.length + drafts.length;
    return {
      feature, mine, stories, others, drafts,
      breakDown: mine && total === 0 && typeNeedsBreakdown(w.types, feature.type),
      on, total,
      label: total > 0 && (on > 0 || !!i.onWeek?.has(id)) ? `${on} of ${total} on` : null,
      // Mine: where the feature itself falls. Someone else's: where my first story under it falls.
      key: mine ? feature : (stories[0] ?? feature),
    };
  };
  const groups: AssignedGroup[] = [...ids].map(group).sort((a, b) => cmp(a.key, b.key)).map(({ key: _key, ...g }) => g);
  const loose = [...(under.get(null) ?? [])].sort(cmp);
  if (loose.length) groups.push({ feature: null, mine: false, stories: loose, others: [], drafts: [], breakDown: false, on: 0, total: loose.length, label: null });
  return groups;
}

/** The client's drafts with no feature that aren't on a block (a plain to-do taken off the plan is one): To place. */
export function looseDrafts(clientKey: string, drafts: readonly DraftStory[], weekPicks: readonly PickLike[]): DraftStory[] {
  const placed = new Set(weekPicks.filter(live).map(keyOf).filter((k): k is string => !!k));
  return drafts.filter((d) => d.clientKey === clientKey && d.parentItemId === null && d.level === "story" && d.devopsId == null && !placed.has(`d${d.id}`));
}

/** One group of "More in <client>": a feature that isn't in Assigned to you with its open stories, or loose stories. */
export type MoreGroup = { feature: WorkItem | null; stories: WorkItem[] };

/**
 * "More in <client>": everything else open in the client's DevOps (other people's features and stories), in the
 * list's order. `all` is the client's open work as Ahead reads it; what Assigned to you already shows is left out
 * (`shown`), as are epics. A story whose feature is in Assigned to you sits there (behind "N more in this feature").
 */
export function moreList(all: readonly WorkItem[], shown: ReadonlySet<number>, sort: ListSort = "backlog"): MoreGroup[] {
  const cmp = sorter(sort);
  const openOnes = all.filter((x) => open(x) && !shown.has(x.id) && !x.assignedToMe);
  const features = openOnes.filter((x) => x.level === "portfolio" && x.tier !== "epic").sort(cmp);
  const stories = openOnes.filter((x) => isPickable(x));
  const fid = new Set(features.map((f) => f.id));
  const groups: MoreGroup[] = features.map((feature) => ({ feature, stories: stories.filter((x) => x.parentId === feature.id).sort(cmp) }));
  const loose = stories.filter((x) => x.parentId == null || (!fid.has(x.parentId) && !shown.has(x.parentId))).sort(cmp);
  if (loose.length) groups.push({ feature: null, stories: loose });
  return groups;
}
export const moreCount = (groups: readonly MoreGroup[]) => groups.reduce((n, g) => n + (g.feature ? 1 : 0) + g.stories.length, 0);

/** A row's hover: its type and number, state, target date and size, joined with " · " (what the row doesn't spell out). */
export function hoverWords(x: Pick<WorkItem, "type" | "id" | "state"> & { targetDate?: IsoDate | null; size?: number | null; assignedTo?: string | null }, o: { sizeName?: string } = {}): string {
  const target = x.targetDate ? `target ${Temporal.PlainDate.from(x.targetDate).toLocaleString("en-US", { month: "short", day: "numeric" })}` : "no target date";
  return [`${x.type} ${x.id}`, x.state, target, x.size != null ? `${o.sizeName ?? "size"} ${x.size}` : "not sized"].join(" · ");
}

/** The header's one status line: "At risk · 2 reasons" (the worst state and how many reasons), or null with none. */
export function riskLine(risks: readonly { severity: string; reason: string }[]): { text: string; severity: "at_risk" | "watch"; reasons: string[] } | null {
  if (!risks.length) return null;
  const severity = risks.some((r) => r.severity === "at_risk") ? "at_risk" : "watch";
  const ordered = [...risks].sort((a, b) => Number(b.severity === "at_risk") - Number(a.severity === "at_risk"));
  return { severity, text: `${severity === "at_risk" ? "At risk" : "Watch"} · ${risks.length} ${risks.length === 1 ? "reason" : "reasons"}`, reasons: ordered.map((r) => r.reason) };
}

/** One search result: a story (with its parent's title when it has one), a draft or a promise of this client. */
export type Result<F extends FollowLike> =
  | { kind: "story"; key: string; item: WorkItem; under: string | null }
  | { kind: "draft"; key: string; draft: DraftStory }
  | { kind: "promise"; key: string; followUp: F };
/** The two rows that always end the list while typing. */
export type NewRow = { kind: "todo" | "draft"; key: "new-todo" | "new-draft"; text: string; label: string };

export const RESULT_LIMIT = 30;

export type SearchModel<F extends FollowLike> = {
  /** At most RESULT_LIMIT, the client's backlog order: stories, then drafts, then promises. */
  results: Result<F>[];
  /** How many more matched and aren't shown ("12 more. Keep typing."). */
  more: number;
  news: [NewRow, NewRow];
  /** The row Enter takes at first: the first result, or "New to-do" when nothing matches. */
  start: number;
};

/**
 * While typing: this client's DevOps work, drafts and my promises for it that match, then "New to-do: <text>" and
 * "New draft story: <text>". Empty text: null (the Add list shows instead).
 */
export function searchPanel<F extends FollowLike>(i: { clientKey: string; work: (WorkLike & { parents?: readonly WorkItem[] }) | undefined; followUps: readonly F[]; drafts: readonly DraftStory[]; /** "More in <client>": the rest of the client's open work, once read. */ more?: readonly WorkItem[] }, query: string): SearchModel<F> | null {
  const text = query.trim();
  if (!text) return null;
  // Assigned to you first, then the rest of the client's work; each item once.
  const pool = [...new Map([...(i.work ? [...i.work.items, ...i.work.children] : []), ...(i.more ?? [])].map((x) => [x.id, x] as const).reverse()).values()].reverse();
  const title = new Map([...pool, ...(i.work?.committed ?? []), ...(i.work?.parents ?? []), ...(i.more ?? [])].map((x) => [x.id, x.title]));
  const q = text.toLowerCase().replace(/^#/, "");
  // "#" alone (or "#12") is a number search: it matches work items only, never every draft and promise.
  const words = !text.startsWith("#") && q.length > 0;
  const all: Result<F>[] = [
    ...pool.filter((x) => isPickable(x) && q.length > 0 && matches(text, x)).map((item): Result<F> => ({ kind: "story", key: `i${i.clientKey}:${item.id}`, item, under: item.parentId != null ? title.get(item.parentId) ?? null : null })),
    ...i.drafts.filter((d) => d.clientKey === i.clientKey && d.level === "story" && d.devopsId == null && words && d.title.toLowerCase().includes(q)).map((draft): Result<F> => ({ kind: "draft", key: `d${draft.id}`, draft })),
    ...i.followUps.filter((f) => f.clientKey === i.clientKey && words && `${f.hasWho ? f.who ?? "" : ""} ${f.what}`.toLowerCase().includes(q)).map((followUp): Result<F> => ({ kind: "promise", key: `f${followUp.id}`, followUp })),
  ];
  const results = all.slice(0, RESULT_LIMIT);
  return {
    results,
    more: all.length - results.length,
    news: [
      { kind: "todo", key: "new-todo", text, label: `New to-do: ${text}` },
      { kind: "draft", key: "new-draft", text, label: `New draft story: ${text}` },
    ],
    // The rows are the results then the two New rows, so index 0 is the first match, or "New to-do" with none.
    start: 0,
  };
}

/** Up and Down through the results and the two New rows (no wrap). */
export function moveHighlight(at: number, dir: 1 | -1, rows: number): number {
  return Math.max(0, Math.min(rows - 1, at + dir));
}

/** The features a new draft story can go under: the ones in Assigned to you, then "No feature yet". */
export function draftParents(groups: readonly Pick<AssignedGroup, "feature">[]): { id: number | null; title: string }[] {
  return [...groups.filter((g) => g.feature).map((g) => ({ id: g.feature!.id as number | null, title: g.feature!.title })), { id: null, title: "No feature yet" }];
}

/** The kinds of to-do Take off the plan tells apart. */
export type TodoSort = "item" | "draft" | "promise" | "plain" | "deployment";
export function todoSort(p: Pick<Todo, "kind" | "followUpId" | "todoKind">): TodoSort {
  if (p.todoKind === "deployment") return "deployment";
  if (p.followUpId !== null) return "promise";
  return p.kind === "item" ? "item" : p.kind === "draft" ? "draft" : "plain";
}

/**
 * Take off the plan, for each kind of to-do: whether it can come off, and where its work is afterwards. It is never
 * Drop: nothing is marked dropped by it. A done to-do stays; a past day keeps its record.
 */
export function takeOffRule(p: Pick<Todo, "kind" | "followUpId" | "todoKind" | "status" | "date">, today: IsoDate): { ok: true; then: string } | { ok: false; why: string } {
  if (p.status === "done") return { ok: false, why: "A done to-do stays on its day" };
  if (p.status !== "planned") return { ok: false, why: "Only a planned to-do can be taken off" };
  if (p.date < today) return { ok: false, why: "A past day keeps its record. Move it to today instead" };
  switch (todoSort(p)) {
    case "deployment": return { ok: false, why: "A deployment keeps its window. Move it or drop it instead" };
    case "item": return { ok: true, then: "Back in its feature's list, not placed" };
    case "draft": return { ok: true, then: "Still a draft, not placed" };
    case "promise": return { ok: true, then: "Still in Promises, not placed" };
    case "plain": return { ok: true, then: "Kept under To place" };
  }
}

/** The notice after a take off: "Taken off Wed AM: Export orders to CSV". */
export function takenOffWords(title: string, date: IsoDate, half: Half, o: { kind: string; timeboxes?: number }): string {
  return `Taken off ${blockWord(date, half)}: ${title}${o.kind === "plain" ? " · kept under To place" : ""}${o.timeboxes ? " · its timebox is gone" : ""}`;
}
