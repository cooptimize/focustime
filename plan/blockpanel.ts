// WD-2: the block panel's model, the one side panel for a block on Week and on Day. Pure: what the panel can do on
// this block (add, or only tick and move on a past day, or nothing on a day off), whose work it lists, what is on the
// block, the Add list before typing (this week's features first with their stories, then promises, then the other
// work assigned to me), the search results with the two "New" rows, and what Take off the plan does to each kind of
// to-do. Every list is built for one client's key, so one client's items never show under another's heading (GD-2).
import type { DraftStory, Pick as Todo } from "./types.ts";
import type { Half, IsoDate, TypeLook, WorkItem } from "../week/types.ts";
import { addSections, matches, type PriorityRow, type RestRow } from "./addpane.ts";
import { blockWord, defaultAddBlock, roomWords, type BlockAt } from "./addwork.ts";
import { blockClient, isPickable } from "./rules.ts";

type Ref = { clientKey: string; itemId: number; title: string; url: string | null; slots: readonly { date: IsoDate; half: "AM" | "PM" }[]; level?: "feature" | "story"; done?: boolean; parentId?: number | null };
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

/** One feature in the Add list: its row (stories and drafts to add), and "2 of 3 on" (placed anywhere this week). */
export type FeatureLine<R extends Ref> = { row: PriorityRow<R>; on: number; total: number; label: string | null };

export type AddList<R extends Ref, F extends FollowLike> = {
  /** This week's features for the client, in the week list's order, each with its stories. */
  features: FeatureLine<R>[];
  /** My open promises for the client, in due order (the caller passes them ordered). */
  promises: F[];
  /** "Other work assigned to you": what isn't under a feature on this week, grouped under its parent; collapsed. */
  other: RestRow[];
  otherCount: number;
  /** Drafts with no feature that aren't on a block (a plain to-do taken off the plan is one): listed under To place. */
  loose: DraftStory[];
};

export type AddInput<R extends Ref, F extends FollowLike> = {
  clientKey: string;
  date: IsoDate;
  half: Half;
  work: WorkLike | undefined;
  /** The week's list (any client), in list order. */
  week: readonly R[];
  followUps: readonly F[];
  drafts: readonly DraftStory[];
  /** The week's to-dos (any client). */
  weekPicks: readonly PickLike[];
};

/** The Add list before typing. Rows already on a block stay listed, so each can say where it is. */
export function addList<R extends Ref, F extends FollowLike>(i: AddInput<R, F>): AddList<R, F> {
  const placed = new Set(i.weekPicks.filter(live).map(keyOf).filter((k): k is string => !!k));
  // Nothing is hidden for being on the day: every row shows, with where it is.
  const s = addSections<R, F>({ clientKey: i.clientKey, date: i.date, half: i.half, work: i.work, week: i.week, followUps: i.followUps, drafts: i.drafts, picked: new Set() });
  const features = s.priorities.map((row): FeatureLine<R> => {
    if (row.level === "story") return { row, on: 0, total: 0, label: null };
    const on = row.stories.filter((x) => placed.has(`i${i.clientKey}:${x.id}`)).length + row.drafts.filter((d) => placed.has(`d${d.id}`)).length;
    const total = row.stories.length + row.drafts.length;
    return { row, on, total, label: total ? `${on} of ${total} on` : null };
  });
  // A story under a listed parent shows there once, not again on its own.
  const grouped = new Set(s.rest.flatMap((r) => r.kids.map((k) => k.id)));
  const seen = new Set<number>();
  const other = s.rest.flatMap((r) => {
    if (!r.kids.length) return grouped.has(r.item.id) ? [] : [r];
    const kids = r.kids.filter((k) => !seen.has(k.id) && (seen.add(k.id), true));
    return kids.length ? [{ ...r, kids }] : [];
  });
  const loose = i.drafts.filter((d) => d.clientKey === i.clientKey && d.parentItemId === null && d.level === "story" && d.devopsId == null && !placed.has(`d${d.id}`));
  return { features, promises: s.followUps, other, otherCount: other.reduce((n, r) => n + (r.kids.length || 1), 0), loose };
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
export function searchPanel<F extends FollowLike>(i: { clientKey: string; work: WorkLike | undefined; followUps: readonly F[]; drafts: readonly DraftStory[] }, query: string): SearchModel<F> | null {
  const text = query.trim();
  if (!text) return null;
  const pool = i.work ? [...new Map([...i.work.items, ...i.work.children].map((x) => [x.id, x])).values()] : [];
  const title = new Map([...pool, ...(i.work?.committed ?? [])].map((x) => [x.id, x.title]));
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

/** The features a new draft story can go under: the client's features on this week, then "No feature yet". */
export function draftParents<R extends Ref>(features: readonly FeatureLine<R>[]): { id: number | null; title: string }[] {
  return [...features.filter((f) => f.row.level === "feature" && f.row.ref.itemId > 0 && f.row.item).map((f) => ({ id: f.row.ref.itemId as number | null, title: f.row.ref.title })), { id: null, title: "No feature yet" }];
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
