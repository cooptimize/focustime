// Plan the day's two panes (step 15, D263 to D265, D268). Pure: which block is selected, what the right pane offers
// for it and in what order, what Done does, and the musts summary on the context line.
import { typeNeedsBreakdown } from "./process.ts";
import type { DraftStory } from "./types.ts";
import type { Half, IsoDate, TypeLook, WorkItem } from "../week/types.ts";
import { isPickable, weekFirst } from "./rules.ts";
import type { FitWords } from "./fit.ts";

export type BlockChoice = { half: Half; ended: boolean; fit: FitWords["kind"] };

/** The block the right pane starts on: the one asked for, else the first not over with room, else the first not over. */
export function defaultBlock(blocks: readonly BlockChoice[], requested?: Half | null): Half | null {
  if (requested && blocks.some((b) => b.half === requested)) return requested;
  const live = blocks.filter((b) => !b.ended);
  return (live.find((b) => b.fit !== "over") ?? live[0] ?? blocks[0])?.half ?? null;
}

type Ref = { clientKey: string; itemId: number; title: string; url: string | null; slots: readonly { date: IsoDate; half: "AM" | "PM" }[]; level?: "feature" | "story"; done?: boolean; parentId?: number | null };
type FollowLike = { id: number; clientKey: string | null; due: string | null; openedAt: string };

/** One row of "This week's priorities": a story to add, or a feature that opens into its stories. */
export type PriorityRow<R extends Ref = Ref> = {
  ref: R;
  level: "feature" | "story";
  /** The DevOps item, or null when DevOps can't show it now. */
  item: WorkItem | null;
  /** A feature's open, pickable stories not on the plan yet. */
  stories: WorkItem[];
  /** Draft stories under it, not on the plan yet. */
  drafts: DraftStory[];
  /** A feature with no stories and no drafts at all: one "Break it down" row. */
  breakDown: boolean;
  /** Every story of it is already on the plan. */
  allPicked: boolean;
  /** Pinned to this block in Plan the week. */
  pinnedHere: boolean;
  /** U4: "2 of 3 stories planned": its stories and drafts, and how many of them are on the day. */
  total: number;
  planned: number;
};

export type RestRow = { item: WorkItem; kids: WorkItem[] };
export type AddSections<R extends Ref, F extends FollowLike> = { priorities: PriorityRow<R>[]; followUps: F[]; rest: RestRow[] };

/** Case-insensitive match on the title or the id ("#123" or "123"). */
export function matches(query: string, item: { id: number; title: string }): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  return !q || item.title.toLowerCase().includes(q) || String(item.id).startsWith(q);
}

export type AddInput<R extends Ref, F extends FollowLike> = {
  clientKey: string;
  date: IsoDate;
  half: Half;
  work: { items: readonly WorkItem[]; children: readonly WorkItem[]; committed?: readonly WorkItem[]; types?: readonly TypeLook[] } | undefined;
  /** The client's week list in list order, done ones marked. */
  week: readonly R[];
  followUps: readonly F[];
  drafts: readonly DraftStory[];
  /** Keys of what is already on the day: "i<client>:<id>", "d<draftId>", "f<followUpId>". */
  picked: ReadonlySet<string>;
  /** Keys planned in this block (step 15.2): kept in the lists so the row can say "Already planned here". */
  here?: ReadonlySet<string>;
  /** From a card's "This week: <feature>": only that item in priorities. */
  focus?: number | null;
  query?: string;
};

/** The right pane: the week's features (CF-1: all the same), the client's follow-ups (due order), then everything else in DevOps order. */
export function addSections<R extends Ref, F extends FollowLike>(i: AddInput<R, F>): AddSections<R, F> {
  const here = i.here ?? new Set<string>();
  /** Not on the day yet, or on it in this block (shown as already planned here). */
  const shown = (k: string) => !i.picked.has(k) || here.has(k);
  const free = (w: WorkItem) => shown(`i${i.clientKey}:${w.id}`);
  const open = (k: string) => !i.picked.has(k);
  const first = i.half === "EVE" ? { committed: [], rest: [...(i.work?.items ?? [])] } : weekFirst(i.work, i.week, i.clientKey, i.date, i.half);
  const draftsUnder = (id: number) => i.drafts.filter((d) => d.clientKey === i.clientKey && d.parentItemId === id && d.level === "story" && d.devopsId == null);
  const priorities: PriorityRow<R>[] = [];
  // Step 16.4: a story whose feature is on the week list shows in that feature's row, not again on its own.
  const listedFeatures = new Set(i.week.filter((w) => w.clientKey === i.clientKey && (w.level ?? "feature") === "feature").map((w) => w.itemId));
  for (const e of first.committed) {
    if (i.focus != null && e.feature.itemId !== i.focus) continue;
    if (e.level === "story") {
      const parent = e.feature.parentId ?? e.item?.parentId ?? null;
      if (parent !== null && listedFeatures.has(parent)) continue;
      if (e.item && (!isPickable(e.item) || !free(e.item))) continue;
      priorities.push({ ref: e.feature, level: "story", item: e.item, stories: [], drafts: [], breakDown: false, allPicked: false, pinnedHere: e.placedHere, total: 0, planned: 0 });
      continue;
    }
    const allDrafts = draftsUnder(e.feature.itemId);
    const stories = e.kids.filter(free);
    const drafts = allDrafts.filter((d) => shown(`d${d.id}`));
    // WT-1: only a type that needs breakdown in the project's process asks for stories.
    const breakDown = !!i.work && e.kids.length === 0 && allDrafts.length === 0 && (!e.item || typeNeedsBreakdown(i.work.types, e.item.type));
    const left = stories.filter((x) => open(`i${i.clientKey}:${x.id}`)).length + drafts.filter((d) => open(`d${d.id}`)).length;
    const total = e.kids.length + allDrafts.length;
    const planned = e.kids.filter((x) => i.picked.has(`i${i.clientKey}:${x.id}`)).length + allDrafts.filter((d) => i.picked.has(`d${d.id}`)).length;
    priorities.push({ ref: e.feature, level: "feature", item: e.item, stories, drafts, breakDown, allPicked: !breakDown && left === 0, pinnedHere: e.placedHere, total, planned });
  }
  const followUps = i.followUps.filter((f) => f.clientKey === i.clientKey && shown(`f${f.id}`));
  const pool = i.work ? [...i.work.items, ...i.work.children] : [];
  const kidsOf = (id: number) => pool.filter((c) => c.parentId === id && isPickable(c) && free(c));
  const rest: RestRow[] = [];
  for (const item of first.rest) {
    if (item.level === "portfolio") {
      const kids = kidsOf(item.id).filter((k) => !i.query || matches(i.query, k) || matches(i.query, item));
      if (kids.length) rest.push({ item, kids });
    } else if (isPickable(item) && free(item) && (!i.query || matches(i.query, item))) rest.push({ item, kids: [] });
  }
  return { priorities, followUps, rest };
}
