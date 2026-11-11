// SG-1: the board suggests. Pure: which empty blocks get suggested to-dos and which ones, from FocusTime's own store
// (the week's to-dos, the unfinished ones, the DevOps work the week already loaded). No AI, no DevOps request.
//
// Which blocks: a block that can take work (a client's focus block, not PTO, with working hours, not a catch-up or an
// Open half-day), with no to-dos on it, not ended, on today or the next working day, and not cleared.
// What, for the block's client, in order: its unfinished to-dos from earlier days that aren't placed anywhere now;
// then my open stories in the block panel's "Assigned to you" order, a story whose target date (or its feature's)
// falls in that week or earlier lifted to the front; a feature of mine with no stories offered once as itself
// ("Needs breakdown"). Never: anything on a block that week, done or closed, cleared, or another client's.
// How many: what fits the block's free time by size (unsized as the person's assumption, SZ-1), at least one when
// there is anything, at most four. The same thing is never suggested on two blocks; earlier blocks choose first.
//
// A suggestion is an offer: it is not a to-do, counts against nothing and is never stored. Only what was cleared is
// stored (the plan store's per-person markers, `SUGGEST_CLEARED`).
import { freeMinutes } from "../week/free.ts";
import type { FreeGap, Half, IsoDate, WorkItem } from "../week/types.ts";
import { assignedList } from "./blockpanel.ts";
import { storyMinutes, validStorySize, type SizeScale, type StorySize } from "./estimate.ts";
import { isOpen } from "./process.ts";
import type { Pick as Todo } from "./types.ts";

/** At most this many suggestions on one block. */
export const MAX_PER_BLOCK = 4;
/** The plan store marker kind for what was cleared; its keys are `clearKey`'s. */
export const SUGGEST_CLEARED = "sg_clear";

export type SuggestSlot = {
  date: IsoDate;
  half: Half;
  end: string;
  pto: boolean;
  off: boolean;
  open: boolean;
  focus: readonly { clientKey: string; clientName?: string }[];
  freeGaps: readonly FreeGap[];
};
export type SuggestDay = { date: IsoDate; kind: string; pto?: unknown; am: SuggestSlot; pm: SuggestSlot };
type WorkLike = { clientName?: string; items: readonly WorkItem[]; children: readonly WorkItem[]; committed?: readonly WorkItem[]; parents?: readonly WorkItem[]; types?: readonly import("../week/types.ts").TypeLook[] };
type PickLike = Pick<Todo, "id" | "date" | "half" | "clientKey" | "itemId" | "draftId" | "followUpId" | "status"> & { size?: string | null };

export type SuggestKind = "unfinished" | "story" | "feature";
export type Suggestion = {
  /** What it is, the same key the block panel uses ("i<client>:<id>", "d<draft>", "f<follow-up>", or "p<to-do>" for a plain to-do). */
  key: string;
  at: { date: IsoDate; half: "AM" | "PM" };
  clientKey: string;
  kind: SuggestKind;
  title: string;
  itemType: string | null;
  url: string | null;
  itemId: number | null;
  /** An unfinished to-do: the to-do Keep moves here (pick.move). */
  pickId: number | null;
  size: StorySize | null;
  minutes: number;
  /** The hover: "Unfinished from Tue", "Next in Northwind's backlog", "Target date Fri". */
  reason: string;
  /** A feature of mine with no stories, offered as itself. */
  needsBreakdown: boolean;
};

export type SuggestInput = {
  /** Settings › Planning "Suggest work for empty blocks". Off: nothing is worked out. */
  on: boolean;
  now: string;
  today: IsoDate;
  /** The next day with focus blocks that isn't PTO or a day off (the server's `nextWorkDay`). */
  nextWorkDay: IsoDate | null;
  days: readonly SuggestDay[];
  /** The loaded week's to-dos, every client and status. */
  weekPicks: readonly PickLike[];
  /** Other work on a block that isn't a to-do (a feature placed as a placeholder, a Watching check-in). */
  busy?: (date: IsoDate, half: Half) => boolean;
  /** To-dos kept from a suggestion in this session: they don't stop the block's other suggestions. */
  kept?: ReadonlySet<number>;
  /** Unfinished to-dos from earlier days (planday.carry), oldest first. */
  unfinished: readonly Todo[];
  work: (clientKey: string) => WorkLike | undefined;
  /** DevOps resolved, closed or removed it. */
  resolved?: (clientKey: string, itemId: number) => boolean;
  /** Cleared keys (`clearKey`). */
  cleared: ReadonlySet<string>;
  sizes: SizeScale;
  clientName?: (clientKey: string) => string;
};

const live = (p: { status: string }) => p.status === "planned" || p.status === "done";
const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
const monday = (d: IsoDate) => {
  const p = Temporal.PlainDate.from(d);
  return p.subtract({ days: p.dayOfWeek - 1 }).toString();
};
const sunday = (d: IsoDate) => Temporal.PlainDate.from(monday(d)).add({ days: 6 }).toString();
const weekday = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short" });
const monthDay = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });

/** The panel's key for a to-do's work; a plain to-do has none of its own, so it is "p<id>". */
export const todoKey = (p: Pick<Todo, "id" | "clientKey" | "itemId" | "draftId" | "followUpId">) =>
  p.itemId !== null ? `i${p.clientKey}:${p.itemId}` : p.draftId !== null ? `d${p.draftId}` : p.followUpId !== null ? `f${p.followUpId}` : `p${p.id}`;

/** What a Clear stores: one item for that week, a block for that day, or a whole day. */
export type ClearScope = { scope: "item"; date: IsoDate; key: string } | { scope: "block"; date: IsoDate; half: Half } | { scope: "day"; date: IsoDate };
export function clearKey(c: ClearScope): string {
  if (c.scope === "item") return `item:${monday(c.date)}:${c.key}`;
  if (c.scope === "block") return `block:${c.date}:${c.half}`;
  return `day:${c.date}`;
}
/** Whether a stored key is one `clearKey` makes (the server accepts only these). */
export const validClearKey = (k: string) => /^(item:\d{4}-\d{2}-\d{2}:(i[^\s]{1,120}:\d{1,10}|[dfp]\d{1,10})|block:\d{4}-\d{2}-\d{2}:(AM|PM)|day:\d{4}-\d{2}-\d{2})$/.test(k);

/** The next day after `today` with a focus block in a half that isn't PTO or a day off; null when none is in `days`. */
export function nextWorkDay(days: readonly SuggestDay[], today: IsoDate): IsoDate | null {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of sorted) {
    if (d.date <= today || d.kind === "weekend" || d.pto) continue;
    if ([d.am, d.pm].some((s) => !!s.focus[0] && !s.pto && !s.off)) return d.date;
  }
  return null;
}

/** Whether a block can be given suggestions at all (before its to-dos and what was cleared). */
export function suggestable(s: SuggestSlot, day: Pick<SuggestDay, "kind" | "pto">, o: { now: string; today: IsoDate; nextWorkDay: IsoDate | null }): boolean {
  if (s.date !== o.today && s.date !== o.nextWorkDay) return false;
  if (day.kind !== "work" || day.pto || s.pto || s.off || s.open || !s.focus[0]) return false;
  return ms(s.end) > ms(o.now);
}

type Candidate = Omit<Suggestion, "at">;

/** The block's client's offers in order, before what is taken, cleared or doesn't fit. */
function candidates(i: SuggestInput, clientKey: string, at: { date: IsoDate }): Candidate[] {
  const work = i.work(clientKey);
  const name = i.clientName?.(clientKey) ?? work?.clientName ?? clientKey;
  const weekEnd = sunday(at.date);
  const byId = new Map([...(work?.items ?? []), ...(work?.children ?? []), ...(work?.committed ?? []), ...(work?.parents ?? [])].map((x) => [x.id, x]));
  const closed = (id: number) => !!i.resolved?.(clientKey, id) || (byId.has(id) && !isOpen(byId.get(id)!.stateCategory));
  const out: Candidate[] = [];
  // 1. Unfinished to-dos from earlier days, oldest first.
  for (const p of [...i.unfinished].filter((p) => p.clientKey === clientKey && p.status === "planned" && p.date < at.date && p.todoKind !== "deployment").sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position)) {
    if (p.itemId !== null && closed(p.itemId)) continue;
    const size = p.size && validStorySize(p.size) ? (p.size as StorySize) : null;
    out.push({
      key: todoKey(p), clientKey, kind: "unfinished", title: p.title, itemType: p.itemType, url: p.itemUrl, itemId: p.itemId, pickId: p.id, size,
      minutes: Math.max(1, p.remainingMinutes ?? storyMinutes(size, i.sizes)),
      reason: `Unfinished from ${monday(p.date) === monday(at.date) ? weekday(p.date) : monthDay(p.date)}`,
      needsBreakdown: false,
    });
  }
  // 2. My open stories in Assigned to you's order (and a feature of mine with none, as itself), target dates lifted.
  const groups = assignedList({ clientKey, work, drafts: [], weekPicks: i.weekPicks, sort: "backlog" });
  const backlog: { c: Candidate; due: IsoDate | null }[] = [];
  for (const g of groups) {
    const items = g.breakDown && g.feature ? [g.feature] : g.stories;
    for (const x of items) {
      if (!isOpen(x.stateCategory) || i.resolved?.(clientKey, x.id)) continue;
      const parent = x.parentId != null ? byId.get(x.parentId) : undefined;
      const target = x.targetDate ?? parent?.targetDate ?? null;
      const due = target && target <= weekEnd ? target : null;
      const feature = x === g.feature;
      backlog.push({
        due,
        c: {
          key: `i${clientKey}:${x.id}`, clientKey, kind: feature ? "feature" : "story", title: x.title, itemType: x.type, url: x.url, itemId: x.id, pickId: null, size: null,
          minutes: storyMinutes(null, i.sizes),
          reason: due ? `Target date ${monday(due) === monday(at.date) ? weekday(due) : monthDay(due)}` : feature ? "Needs breakdown" : `Next in ${name}'s backlog`,
          needsBreakdown: feature,
        },
      });
    }
  }
  out.push(...backlog.filter((b) => b.due).map((b) => b.c), ...backlog.filter((b) => !b.due).map((b) => b.c));
  return out;
}

/**
 * The suggestions for the days given, in block order (by date, AM before PM). A block with any to-do that wasn't
 * kept from a suggestion in this session gets none; one with only kept ones gets the rest, against what is left of
 * its free time.
 */
export function boardSuggestions(i: SuggestInput): Suggestion[] {
  if (!i.on) return [];
  const o = { now: i.now, today: i.today, nextWorkDay: i.nextWorkDay };
  const weekPicksLive = i.weekPicks.filter(live);
  // An unfinished to-do's own row on its earlier day doesn't make its work "placed".
  const unfinishedIds = new Set(i.unfinished.map((p) => p.id));
  const taken = new Set<string>();
  // Placed anywhere this week: never suggested (an unfinished plain to-do has no work key; its own row is the one).
  const placedByWeek = new Map<string, Set<string>>();
  for (const p of weekPicksLive.filter((x) => !unfinishedIds.has(x.id))) {
    const w = monday(p.date);
    const k = todoKey(p);
    if (!placedByWeek.has(w)) placedByWeek.set(w, new Set());
    placedByWeek.get(w)!.add(k);
  }
  const out: Suggestion[] = [];
  const days = [...i.days].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of days) {
    if (i.cleared.has(clearKey({ scope: "day", date: d.date }))) continue;
    for (const s of [d.am, d.pm]) {
      if (!suggestable(s, d, o)) continue;
      const half = s.half as "AM" | "PM";
      if (i.cleared.has(clearKey({ scope: "block", date: d.date, half }))) continue;
      const here = weekPicksLive.filter((p) => p.date === d.date && p.half === half);
      if (here.some((p) => !i.kept?.has(p.id)) || i.busy?.(d.date, half)) continue;
      const clientKey = s.focus[0]!.clientKey;
      const placed = placedByWeek.get(monday(d.date)) ?? new Set<string>();
      // What fits: the block's free time (what is left of it today), less what was kept on it.
      const free = freeMinutes(s, d.date === i.today ? i.now : undefined);
      let total = here.reduce((m, p) => m + storyMinutes(p.size ?? null, i.sizes), 0);
      let n = 0;
      for (const c of candidates(i, clientKey, { date: d.date })) {
        if (n >= MAX_PER_BLOCK) break;
        if (taken.has(c.key) || placed.has(c.key)) continue;
        if (i.cleared.has(clearKey({ scope: "item", date: d.date, key: c.key }))) continue;
        if (n > 0 || here.length) {
          if (total + c.minutes > free) break;
        }
        taken.add(c.key);
        total += c.minutes;
        n++;
        out.push({ ...c, at: { date: d.date, half } });
      }
    }
  }
  return out;
}

/** Suggestions grouped per block, "date:half". */
export const byBlock = (list: readonly Suggestion[]) => {
  const m = new Map<string, Suggestion[]>();
  for (const s of list) {
    const k = `${s.at.date}:${s.at.half}`;
    m.set(k, [...(m.get(k) ?? []), s]);
  }
  return m;
};

/** "5 suggested" for a day's line; null when there are none. */
export const suggestedWords = (n: number) => (n > 0 ? `${n} suggested` : null);
