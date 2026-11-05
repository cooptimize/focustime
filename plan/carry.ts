// PL-1: rolling into a new week. Pure. Last week's features against what DevOps says now, one proposal row each:
//
//   Last week's feature                                   New week
//   Resolved or closed                                    "Finished last week" (shown, nothing to plan)
//   Open, with my open stories                            Carried over as a must, with those stories
//   Open, my part done, I'm the owner or a client lead    Watching (with its 30-minute check-in)
//   Open, my part done, otherwise                         "Your part is done", with Keep watching
//   Open, stories never mine, owner or client lead        Watching
//   Open, stories never mine, otherwise                   "Not yours yet", with Take one and Drop
//   Open, no stories at all, owner or client lead         "Needs stories", with Break down
//   Open, no stories at all, otherwise                    Not carried
//
// Owner: the feature's DevOps Assigned To is me. Client lead: plan/levels.ts (customers only, Cooptimizers only).
// Nothing is added to the plan until a row is accepted; a decided row isn't proposed again that week. Only clients
// (clientAccounts()) get rows, and only a Cooptimizer gets any. A feature DevOps can't say anything about right now is
// counted as unknown, never guessed.
import { countsAsDone, isOpen, isRemoved } from "./process.ts";
import type { IsoDate, PortfolioItem } from "../week/types.ts";
import type { Pick as PlanPick, WeekWatch } from "./types.ts";

export const CARRY_KINDS = ["finished", "carry", "watch", "part_done", "not_yours", "needs_stories"] as const;
export type CarryKind = (typeof CARRY_KINDS)[number];
export type CarryDecision = "kept" | "dropped" | "watching";

/** One child of a feature as the DevOps store has it (every state). */
export type TreeChild = { id: number; title: string; type: string; level: string; stateCategory: string; url: string; assignedTo: string | null; assignedToEmail: string | null; /** Assigned to me (my DevOps identity for that client). */ mine: boolean };
/** A feature as the DevOps store has it now, with every child. */
export type FeatureTree = { id: number; title: string; type: string; url: string; stateCategory: string; /** Its DevOps Assigned To is me (the owner). */ mine: boolean; children: readonly TreeChild[] };

/** A feature from the DevOps source's by-id read. */
export const treeOf = (i: Pick<PortfolioItem, "id" | "title" | "type" | "url" | "stateCategory" | "mine" | "children">): FeatureTree => ({
  id: i.id,
  title: i.title,
  type: i.type,
  url: i.url,
  stateCategory: i.stateCategory,
  mine: i.mine,
  children: i.children.map((c) => ({ id: c.id, title: c.title, type: c.type, level: c.level, stateCategory: c.stateCategory, url: c.url, assignedTo: c.assignedTo, assignedToEmail: c.assignedToEmail ?? null, mine: c.mine })),
});

/** A feature or story on last week's list. */
export type LastWeekItem = { clientKey: string; itemId: number; level: "feature" | "story"; tier: "must" | "nice"; title: string; itemType: string | null; url: string | null; estimate: number | null; position: number | null };

export type CarryRow = {
  clientKey: string;
  itemId: number;
  kind: CarryKind;
  title: string;
  itemType: string | null;
  url: string | null;
  /** Last week's estimate (minutes), carried with the must. */
  estimate: number | null;
  /** Why I'd watch it: I own it, or I lead its client (Watching and Needs stories rows). */
  why: "owner" | "lead" | null;
  /** Carry: my open stories under it. Not yours yet: teammates' open stories (for Take one). */
  stories: TreeChild[];
};

export type CarryInput = {
  /** Who I am (my user id), or null: no rows. My stories and ownership come from DevOps's "assigned to me". */
  me: string | null;
  /** Only a Cooptimizer gets a proposal (guests and automation accounts never do). */
  meIsCooptimizer: boolean;
  isClient: (clientKey: string) => boolean;
  isLead: (clientKey: string) => boolean;
  lastWeek: readonly LastWeekItem[];
  /** Already on this week's list or watched this week: not proposed again. */
  planned: readonly { clientKey: string; itemId: number }[];
  /** Decided this week (kept, dropped or watching): not proposed again. */
  decided: readonly { clientKey: string; itemId: number }[];
  /** The feature as DevOps has it now; null: DevOps can't say right now. */
  tree: (clientKey: string, itemId: number) => FeatureTree | null;
};

const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const k = (clientKey: string, itemId: number) => `${clientKey}\u0000${itemId}`;

/** Story-level children that still count (Removed ones are out). */
export const storiesOf = (t: FeatureTree) => t.children.filter((c) => c.level === "story" && !isRemoved(c.stateCategory));

/** The kind of row a feature gets, or null (not carried). */
export function carryKind(t: FeatureTree, lead: boolean): { kind: CarryKind; why: "owner" | "lead" | null; stories: TreeChild[] } | null {
  const owner = t.mine;
  const why = owner ? "owner" : lead ? "lead" : null;
  if (isRemoved(t.stateCategory)) return null;
  if (!isOpen(t.stateCategory)) return { kind: "finished", why, stories: [] };
  const stories = storiesOf(t);
  if (!stories.length) return why ? { kind: "needs_stories", why, stories: [] } : null;
  const mine = stories.filter((s) => s.mine);
  const mineOpen = mine.filter((s) => isOpen(s.stateCategory));
  if (mineOpen.length) return { kind: "carry", why, stories: mineOpen };
  if (why) return { kind: "watch", why, stories: [] };
  if (mine.length) return { kind: "part_done", why: null, stories: [] };
  return { kind: "not_yours", why: null, stories: stories.filter((s) => isOpen(s.stateCategory) && !s.mine) };
}

/** The proposal: rows per client in last week's list order, and how many features DevOps couldn't say anything about. */
export function carryProposal(i: CarryInput): { rows: CarryRow[]; unknown: number } {
  const me = low(i.me);
  if (!me || !i.meIsCooptimizer) return { rows: [], unknown: 0 };
  const skip = new Set([...i.planned, ...i.decided].map((x) => k(x.clientKey, x.itemId)));
  const rows: CarryRow[] = [];
  let unknown = 0;
  const features = i.lastWeek
    .filter((f) => f.level === "feature" && i.isClient(f.clientKey) && !skip.has(k(f.clientKey, f.itemId)))
    .sort((a, b) => a.clientKey.localeCompare(b.clientKey) || (a.tier === b.tier ? 0 : a.tier === "must" ? -1 : 1) || (a.position ?? 1e9) - (b.position ?? 1e9) || a.itemId - b.itemId);
  for (const f of features) {
    const t = i.tree(f.clientKey, f.itemId);
    if (!t) {
      unknown++;
      continue;
    }
    const r = carryKind(t, i.isLead(f.clientKey));
    if (!r) continue;
    rows.push({ clientKey: f.clientKey, itemId: f.itemId, kind: r.kind, title: t.title || f.title, itemType: t.type || f.itemType, url: t.url || f.url, estimate: f.estimate, why: r.why, stories: r.stories });
  }
  return { rows, unknown };
}

/** Counts per row kind (the dry run reports only these, never titles). */
export function proposalCounts(rows: readonly Pick<CarryRow, "kind">[], unknown = 0): Record<CarryKind | "unknown", number> {
  const out = Object.fromEntries([...CARRY_KINDS, "unknown"].map((x) => [x, 0])) as Record<CarryKind | "unknown", number>;
  for (const r of rows) out[r.kind]++;
  out.unknown = unknown;
  return out;
}

/** What Accept all does: every row that plans something (Finished is shown only; Not yours yet needs a Take one). */
export const acceptAllDecision = (kind: CarryKind): CarryDecision | null => (kind === "carry" || kind === "needs_stories" ? "kept" : kind === "watch" ? "watching" : null);

// ---- Watching ----

/** The check-in every Watching row starts with. */
export const CHECKIN_MINUTES = 30;

/** Movement in the week: a child's state changed since Monday. Amber only from Wednesday, so Monday isn't a false alarm. */
export const QUIET_FROM_WEEKDAY = 3;

export type WatchState =
  | { kind: "moving" }
  | { kind: "early" }
  | { kind: "unknown"; text: "Movement not known yet" }
  | { kind: "quiet"; text: "No movement this week"; checkInWith: string | null };

/**
 * A watched feature this week. `changed`: the children whose state changed since Monday per the change log, or null when
 * the store has no change data for the whole week yet (just after DV-1): "Movement not known yet", never amber.
 * "Check in with <name>": the Cooptimizer (not me) with the most open stories on it.
 */
export function watchState(o: { tree: FeatureTree | null; changed: ReadonlySet<number> | null; weekday: number; me: string | null; isCooptimizer: (email: string) => boolean }): WatchState {
  if (!o.tree || o.changed === null) return { kind: "unknown", text: "Movement not known yet" };
  const kids = o.tree.children.filter((c) => !isRemoved(c.stateCategory));
  if (kids.some((c) => o.changed!.has(c.id))) return { kind: "moving" };
  if (o.weekday < QUIET_FROM_WEEKDAY) return { kind: "early" };
  return { kind: "quiet", text: "No movement this week", checkInWith: checkInWith(o.tree, o.me, o.isCooptimizer) };
}

export function checkInWith(t: FeatureTree, me: string | null, isCooptimizer: (email: string) => boolean): string | null {
  const counts = new Map<string, { name: string; n: number }>();
  for (const c of storiesOf(t)) {
    const email = low(c.assignedToEmail);
    if (!email || c.mine || email === low(me) || !c.assignedTo || !isOpen(c.stateCategory) || !isCooptimizer(email)) continue;
    const e = counts.get(email) ?? { name: c.assignedTo, n: 0 };
    e.n++;
    counts.set(email, e);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))[0]?.name ?? null;
}

/** Done for a must: resolved or completed (WT-1's categories). Removed counts zero too but isn't "done". */
export const finishedState = (category: string | null | undefined) => countsAsDone(category);

// ---- Where the check-in goes ----

type SlotLike = { focus: readonly { clientKey: string }[]; open: boolean; pto: boolean; end: string };
type DayLike = { date: IsoDate; kind: string; am: SlotLike; pm: SlotLike };

/**
 * The client's first block of the week that hasn't ended by `now` (an instant), or the first Open half-day (Mon to
 * Thu, no focus block, not PTO) that hasn't, or null.
 */
export function checkinTarget(days: readonly DayLike[], clientKey: string, now?: string): { date: IsoDate; half: "AM" | "PM" } | null {
  const slots = days.flatMap((d) => (["AM", "PM"] as const).map((half) => ({ date: d.date, half, kind: d.kind, s: half === "AM" ? d.am : d.pm })));
  const ahead = (x: (typeof slots)[number]) => !now || Temporal.Instant.compare(Temporal.Instant.from(x.s.end), Temporal.Instant.from(now)) > 0;
  const own = slots.find((x) => !x.s.pto && x.s.focus[0]?.clientKey === clientKey && ahead(x));
  if (own) return { date: own.date, half: own.half };
  const open = slots.find((x) => !x.s.pto && x.s.open && !x.s.focus.length && x.kind !== "overflow" && ahead(x));
  return open ? { date: open.date, half: open.half } : null;
}

// ---- The budget inputs Commit and the Board share ----

/** PL-1: one set of budget inputs for Commit, the Board and Today (week.load sends it), so their numbers agree. */
export type PlanBits = {
  /** ADM-1: plan up to this % of free time. */
  planShare: number;
  /** The person's level default for Keep open, and their own per client. */
  keepOpenDefault: number;
  keepOpen: Record<string, number>;
  /** Items DevOps has resolved, closed or removed: "<client>\u0000<id>". */
  resolved: string[];
  /** Watching check-in minutes per client that count. */
  checkins: Record<string, number>;
};

/** A client's Keep open share: the person's own for that client, else the level default. */
export const keepOpenOf = (bits: Pick<PlanBits, "keepOpen" | "keepOpenDefault">) => (clientKey: string): number => {
  const own = bits.keepOpen[clientKey] ?? Object.entries(bits.keepOpen).find(([k]) => k.toLowerCase() === clientKey.toLowerCase())?.[1];
  const v = own ?? bits.keepOpenDefault;
  return Number.isInteger(v) && v >= 0 && v <= 80 ? v : 0;
};

/** The resolved check for weekBudget and the pick fit. */
export const resolvedOf = (bits: Pick<PlanBits, "resolved"> | null | undefined) => {
  const set = new Set(bits?.resolved ?? []);
  return (clientKey: string, itemId: number) => set.has(`${clientKey}\u0000${itemId}`);
};

/** A Watching check-in not yet a pick: a ghost chip on its half-day on the Board. */
export type CheckinGhost = { weekStart: IsoDate; clientKey: string; itemId: number; title: string; itemType: string | null; date: IsoDate; half: "AM" | "PM"; minutes: number };
export const checkinGhosts = (watches: readonly { weekStart: IsoDate; clientKey: string; itemId: number; title: string; itemType: string | null; checkin: { date: IsoDate; half: "AM" | "PM"; minutes: number } | null; checkinPickId: number | null }[]): CheckinGhost[] =>
  watches.flatMap((w) => (w.checkin && w.checkinPickId === null ? [{ weekStart: w.weekStart, clientKey: w.clientKey, itemId: w.itemId, title: w.title, itemType: w.itemType, ...w.checkin }] : []));

/** A Watching row as Commit and the Board show it. */
export type WatchView = WeekWatch & {
  state: WatchState;
  /** The check-in counts in the budget: a reservation, or its pick still planned or done. */
  counts: boolean;
  /** The pick it became, when it did. */
  pick: { id: number; status: PlanPick["status"]; date: IsoDate; half: PlanPick["half"] } | null;
};

export type ProposalClient = { clientKey: string; clientName: string; rows: CarryRow[] };
export type ProposalData = {
  weekStart: IsoDate;
  lastWeek: IsoDate;
  access: "plan" | "past";
  clients: ProposalClient[];
  /** Last week's features DevOps can't say anything about right now (never guessed). */
  unknown: number;
  /** The dry run: counts per row kind, never titles. */
  counts: Record<CarryKind | "unknown", number>;
  watching: WatchView[];
};

