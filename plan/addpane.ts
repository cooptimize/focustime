// Plan the day's two panes (step 15, D263 to D265, D268). Pure: which block is selected, what the right pane offers
// for it and in what order, what Done does, and the musts summary on the context line.
import type { DraftStory } from "./types.ts";
import type { Progress } from "./weeklist.ts";
import type { Half, IsoDate, WorkItem } from "../week/types.ts";
import { isPickable, weekFirst } from "./rules.ts";
import type { FitWords } from "./fit.ts";

export type BlockChoice = { half: Half; ended: boolean; fit: FitWords["kind"] };

/** The block the right pane starts on: the one asked for, else the first not over with room, else the first not over. */
export function defaultBlock(blocks: readonly BlockChoice[], requested?: Half | null): Half | null {
  if (requested && blocks.some((b) => b.half === requested)) return requested;
  const live = blocks.filter((b) => !b.ended);
  return (live.find((b) => b.fit !== "over") ?? live[0] ?? blocks[0])?.half ?? null;
}

type Ref = { clientKey: string; itemId: number; title: string; url: string | null; slots: readonly { date: IsoDate; half: "AM" | "PM" }[]; tier?: "must" | "nice"; level?: "feature" | "story"; done?: boolean };
type FollowLike = { id: number; clientKey: string | null; due: string | null; openedAt: string };

/** One row of "This week's priorities": a story to add, or a feature that opens into its stories. */
export type PriorityRow<R extends Ref = Ref> = {
  ref: R;
  tier: "must" | "nice";
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
  work: { items: readonly WorkItem[]; children: readonly WorkItem[]; committed?: readonly WorkItem[] } | undefined;
  /** The client's week list in list order, done ones marked. */
  week: readonly R[];
  followUps: readonly F[];
  drafts: readonly DraftStory[];
  /** Keys of what is already on the day: "i<client>:<id>", "d<draftId>", "f<followUpId>". */
  picked: ReadonlySet<string>;
  /** From a card's "This week: <feature>": only that item in priorities. */
  focus?: number | null;
  query?: string;
};

/** The right pane: priorities (musts, then nice to haves), the client's follow-ups (due order), then everything else in DevOps order. */
export function addSections<R extends Ref, F extends FollowLike>(i: AddInput<R, F>): AddSections<R, F> {
  const free = (w: WorkItem) => !i.picked.has(`i${i.clientKey}:${w.id}`);
  const first = i.half === "EVE" ? { musts: [], nice: [], rest: [...(i.work?.items ?? [])] } : weekFirst(i.work, i.week, i.clientKey, i.date, i.half);
  const draftsUnder = (id: number) => i.drafts.filter((d) => d.clientKey === i.clientKey && d.parentItemId === id && d.level === "story" && d.devopsId == null);
  const priorities: PriorityRow<R>[] = [];
  for (const e of [...first.musts, ...first.nice]) {
    if (i.focus != null && e.feature.itemId !== i.focus) continue;
    if (e.level === "story") {
      if (e.item && (!isPickable(e.item) || !free(e.item))) continue;
      priorities.push({ ref: e.feature, tier: e.tier, level: "story", item: e.item, stories: [], drafts: [], breakDown: false, allPicked: false, pinnedHere: e.placedHere });
      continue;
    }
    const allDrafts = draftsUnder(e.feature.itemId);
    const stories = e.kids.filter(free);
    const drafts = allDrafts.filter((d) => !i.picked.has(`d${d.id}`));
    const breakDown = !!i.work && e.kids.length === 0 && allDrafts.length === 0;
    priorities.push({ ref: e.feature, tier: e.tier, level: "feature", item: e.item, stories, drafts, breakDown, allPicked: !breakDown && stories.length === 0 && drafts.length === 0, pinnedHere: e.placedHere });
  }
  const followUps = i.followUps.filter((f) => f.clientKey === i.clientKey && !i.picked.has(`f${f.id}`));
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

/** What Done does: the first one commits the day (heads-up rules start from it), later ones only close. */
export const doneAction = (committedAt: string | null): "commit" | "close" => (committedAt ? "close" : "commit");

/** The context line's musts: "Cooptimize 0/2 · Fabrikam 0/1", clients with musts only. */
export function mustsSummary(rows: readonly Pick<Progress, "clientKey" | "musts" | "done">[], name: (clientKey: string) => string): string {
  return rows
    .filter((r) => r.musts > 0)
    .map((r) => `${name(r.clientKey)} ${r.done}/${r.musts}`)
    .join(" · ");
}
