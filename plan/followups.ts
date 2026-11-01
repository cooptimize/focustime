// Follow-up rules (step 7, stage A of D93): deterministic, no AI. Each rule opens a follow-up once and, where a DevOps signal
// can prove it, closes it again. Pure: plan picks, DevOps results already loaded and the follow-ups so far in; what to
// open, update and close out. The server applies it to the plan store. Nothing is ever posted anywhere.
import { mondayOf } from "../week/dates.ts";
import type { Half, IsoDate, WorkItem } from "../week/types.ts";
import type { Pick } from "./types.ts";

/** A follow-up as the rules see it (the store's Follow-up fits this). */
export type FollowUpLike = {
  id: number;
  kind: string;
  clientKey: string | null;
  itemId: number | null;
  ruleKey: string | null;
  refAt: string | null;
  detail: { picks?: number[]; date?: IsoDate } | null;
  openedAt: string;
  closedAt: string | null;
  closedBy: "me" | "signal" | null;
  /** The copyable draft as it stands (slip follow-ups), to redraft one that repeats items. */
  draft?: string | null;
};

/** Where a rule's follow-up came from (step 13.5): the triggering action, the items, and when. */
export type Origin = { trigger: string; items: { itemId: number | null; title: string }[]; at: string };

export type RuleFollowUp = {
  kind: "devops_update" | "slip" | "blocked" | "priorities";
  ruleKey: string;
  clientKey: string;
  who: string;
  what: string;
  itemId?: number | null;
  refAt?: string | null;
  draft?: string | null;
  detail?: { picks: number[]; date: IsoDate } | null;
  origin?: Origin | null;
};

/** One client's DevOps result as far as the rules need it. */
export type WorkState = {
  clientKey: string;
  status: string;
  fromCache: boolean;
  items: readonly WorkItem[];
  children?: readonly WorkItem[];
  /** Items read by id because a follow-up is about them (completed ones included). */
  watched?: readonly WorkItem[];
};

export type DetectInput = {
  today: IsoDate;
  /** Recent picks (the last couple of weeks up to today). */
  picks: readonly Pick[];
  /** Any pick by id (for follow-ups about picks outside the window). */
  pick: (id: number) => Pick | null;
  committedAt: (date: IsoDate) => string | null;
  /** The pick a moved pick went to. */
  movedTo: (id: number) => Pick | null;
  /** DevOps per client; null when DevOps wasn't loaded (the rules that need it do nothing). */
  work: readonly WorkState[] | null;
  /** Every follow-up so far, open and closed. */
  followUps: readonly FollowUpLike[];
  /** Clients a heads-up isn't owed to: Cooptimize and standing-block clients. */
  internal: ReadonlySet<string>;
  clientName: (key: string) => string;
  /** Whether a date is a workday (working hours), for the blocker re-nudge (Q43). Mon to Fri when absent. */
  isWorkday?: (date: IsoDate) => boolean;
};

/** Workdays to wait before nudging again on an item still blocked after a nudge by hand (Q43). */
export const RENUDGE_WORKDAYS = 3;

/** Workdays after `from` up to and including `to`. */
export function workdaysAfter(from: IsoDate, to: IsoDate, isWorkday: (d: IsoDate) => boolean): number {
  let n = 0;
  for (let d = Temporal.PlainDate.from(from).add({ days: 1 }); Temporal.PlainDate.compare(d, to) <= 0 && n < 366; d = d.add({ days: 1 })) if (isWorkday(d.toString())) n++;
  return n;
}

export type Detected = {
  open: RuleFollowUp[];
  update: { id: number; what: string; draft: string; detail: { picks: number[]; date: IsoDate }; origin: Origin | null }[];
  close: { id: number; note: string }[];
};

const OPEN_CATEGORIES = new Set(["Proposed", "InProgress"]);
const DONE_CATEGORIES = new Set(["Completed", "Removed"]);
const BLOCKED = /\bblocked\b/i;

/** Blocked by its state ("Blocked", "10-Blocked") or a tag ("Blocked", "Blocked by vendor"). */
export const isBlocked = (state: string, tags: readonly string[]) => BLOCKED.test(state) || tags.some((t) => BLOCKED.test(t));

const monToFri = (d: IsoDate) => Temporal.PlainDate.from(d).dayOfWeek <= 5;
const instant = (s: string) => Temporal.Instant.from(s);
const after = (a: string, b: string) => !!a && !!b && Temporal.Instant.compare(instant(a), instant(b)) > 0;
const dayText = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const HALF_WORDS: Record<Half, string> = { AM: "morning", PM: "afternoon", EVE: "evening" };
const ref = (p: Pick) => (p.itemId !== null ? `#${p.itemId} ${p.title}` : p.title);

function find(w: WorkState | undefined, id: number): WorkItem | null {
  if (!w) return null;
  return w.items.find((i) => i.id === id) ?? w.children?.find((i) => i.id === id) ?? w.watched?.find((i) => i.id === id) ?? null;
}

/** One item's identity across picks: its DevOps id, else its title. */
const itemKey = (p: Pick) => (p.itemId !== null ? `i:${p.itemId}` : `t:${p.title.trim().toLowerCase()}`);
const instantOf = (z: string) => Temporal.Instant.from(z.replace(/\[.*\]$/, ""));
const later = (a: Pick, b: Pick) => Temporal.Instant.compare(instantOf(a.updatedAt), instantOf(b.updatedAt)) >= 0;

/** Where a slipped pick's work ended up: still in its week (and where), in a later week, or off the plan. */
type Fate = { kind: "in_week" | "later_week"; to: Pick } | { kind: "off_plan" };
function fateOf(p: Pick, movedTo: (id: number) => Pick | null, all: readonly Pick[]): Fate {
  let f: Pick = p;
  for (let n = 0; n < 20 && f.status === "moved"; n++) {
    const next = movedTo(f.id);
    if (!next) break;
    f = next;
  }
  const week = mondayOf(p.date);
  if (f !== p && f.status !== "dropped") return { kind: mondayOf(f.date) === week ? "in_week" : "later_week", to: f };
  // Dropped (or moved with no trace): the work is still in the week if the same item is planned or done there.
  const still = all
    .filter((x) => x.clientKey === p.clientKey && itemKey(x) === itemKey(p) && (x.status === "planned" || x.status === "done") && mondayOf(x.date) === week && x.id !== p.id)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return still ? { kind: "in_week", to: still } : { kind: "off_plan" };
}

/**
 * Does a slip owe the client a heads-up (D235)? Only when it slipped on or after its own day, or the work left its
 * week (moved to another week, or dropped and not planned elsewhere that week). Moving a future pick between days of
 * the same week, reordering and resizing never do. Stamps are local, so their first ten characters are the local date.
 */
export function slipTrigger(p: Pick, movedTo: (id: number) => Pick | null, all: readonly Pick[]): string | null {
  const day = p.updatedAt.slice(0, 10);
  if (day === p.date) return "Slipped on its day";
  if (day > p.date) return "Slipped after its day";
  const f = fateOf(p, movedTo, all);
  if (f.kind === "later_week") return "Moved out of the week";
  if (f.kind === "off_plan") return "Dropped from the week";
  return null;
}

/** Each item once with its latest status: the latest slipped pick per item, and where its work is now. */
function latestPerItem(picks: readonly Pick[]): Pick[] {
  const by = new Map<string, Pick>();
  for (const p of picks) {
    const k = itemKey(p);
    const cur = by.get(k);
    if (!cur || later(p, cur)) by.set(k, p);
  }
  return [...by.values()].sort((a, b) => picks.indexOf(a) - picks.indexOf(b));
}

/** The plain-text heads-up for one client and day: each slipped item once, with where it is now. No AI, a template. */
export function slipDraft(clientName: string, date: IsoDate, picks: readonly Pick[], movedTo: (id: number) => Pick | null, all: readonly Pick[] = picks): string {
  const lines = latestPerItem(picks).map((p) => {
    const f = fateOf(p, movedTo, all);
    const plan = f.kind === "off_plan" ? "off my plan for now; I'll come back with a new date" : `moving to ${dayText(f.to.date)} (${HALF_WORDS[f.to.half]})`;
    return `- ${ref(p)}: ${plan}`;
  });
  return [`Hi ${clientName}, a quick heads-up on my plan for ${dayText(date)}:`, ...lines, "I'll keep you posted."].join("\n");
}

const slipWhat = (clientName: string, n: number) => `Heads-up to ${clientName} about the slip${n > 1 ? ` (${n} items)` : ""}`;

/** Why a heads-up opened; null when none of its picks meets the heads-up rule (an older one being redrafted). */
function originOf(picks: readonly Pick[], movedTo: (id: number) => Pick | null, all: readonly Pick[]): Origin | null {
  const latest = latestPerItem(picks);
  const triggers = [...new Set(picks.map((p) => slipTrigger(p, movedTo, all)).filter((t): t is string => !!t))];
  const at = picks.reduce((m, p) => (later(p, m) ? p : m), picks[0]!).updatedAt;
  if (!triggers.length) return null;
  return { trigger: triggers.join("; "), items: latest.map((p) => ({ itemId: p.itemId, title: p.title })), at };
}

/**
 * Open heads-ups about slipped picks that wouldn't open under the step 13.5 rule (none of their picks qualify now).
 * Listed for me to decide; never closed automatically. Must heads-ups from Plan the week always qualify.
 */
export function reviewHeadsUps(i: DetectInput): { id: number; reason: string }[] {
  const out: { id: number; reason: string }[] = [];
  for (const l of i.followUps) {
    if (l.closedAt || l.kind !== "slip" || !l.detail?.date || !l.detail.picks?.length) continue;
    const picks = l.detail.picks.map((id) => i.pick(id)).filter((p): p is Pick => !!p);
    if (!picks.length || picks.some((p) => slipTrigger(p, i.movedTo, i.picks))) continue;
    out.push({ id: l.id, reason: "Moved within the same week before its day; nothing left the week" });
  }
  return out;
}

export function detectFollowUps(i: DetectInput): Detected {
  const out: Detected = { open: [], update: [], close: [] };
  const byKey = new Set(i.followUps.map((l) => l.ruleKey).filter(Boolean));
  const open = i.followUps.filter((l) => !l.closedAt);
  const work = new Map((i.work ?? []).map((w) => [w.clientKey, w]));
  const freshWork = (key: string | null) => {
    const w = key ? work.get(key) : undefined;
    return w && w.status === "ok" && !w.fromCache ? w : undefined;
  };

  // 1. A pick ticked done whose DevOps item is still open: "Update DevOps #id".
  for (const p of i.picks) {
    if (p.status !== "done" || p.kind !== "item" || p.itemId === null || p.date > i.today) continue;
    const key = `devops_update:${p.id}`;
    if (byKey.has(key)) continue;
    if (open.some((l) => l.kind === "devops_update" && l.clientKey === p.clientKey && l.itemId === p.itemId)) continue;
    const item = find(work.get(p.clientKey), p.itemId);
    // Unknown (DevOps not loaded, item not seen): nothing to say yet.
    if (!item || !OPEN_CATEGORIES.has(item.stateCategory)) continue;
    // I already updated it after ticking it done: nothing owed. Someone else's change isn't my update (Q42).
    if (item.changedByMe && after(item.changedAt, p.updatedAt)) continue;
    out.open.push({ kind: "devops_update", ruleKey: key, clientKey: p.clientKey, who: i.clientName(p.clientKey), what: `Update DevOps #${p.itemId}: ${p.title}`, itemId: p.itemId, refAt: p.updatedAt });
  }
  for (const l of open.filter((x) => x.kind === "devops_update")) {
    const pickId = Number(l.ruleKey?.split(":")[1]);
    const p = Number.isInteger(pickId) ? i.pick(pickId) : null;
    if (p && p.status !== "done") {
      out.close.push({ id: l.id, note: "The pick is no longer marked done" });
      continue;
    }
    const w = freshWork(l.clientKey);
    const item = l.itemId !== null ? find(w, l.itemId) : null;
    if (!item) continue;
    if (DONE_CATEGORIES.has(item.stateCategory)) out.close.push({ id: l.id, note: `DevOps #${item.id} is ${item.state}` });
    // Q42: only my own change after the follow-up opened proves the update.
    else if (item.changedByMe && after(item.changedAt, l.openedAt)) out.close.push({ id: l.id, note: `DevOps #${item.id} was updated` });
  }

  // 2. Committed client work that slipped on or after its day, or left its week: "Heads-up to <client> about the
  // slip" (step 13.5, D235). One per client and day; each item once with its latest status.
  const covered = new Set(i.followUps.filter((l) => l.kind === "slip").flatMap((l) => l.detail?.picks ?? []));
  const groups = new Map<string, Pick[]>();
  for (const p of i.picks) {
    if (p.status !== "moved" && p.status !== "dropped") continue;
    if (i.internal.has(p.clientKey) || covered.has(p.id)) continue;
    const committed = i.committedAt(p.date);
    if (!committed || !after(p.updatedAt, committed) && p.updatedAt !== committed) continue;
    if (!slipTrigger(p, i.movedTo, i.picks)) continue;
    const g = `${p.date}\u0000${p.clientKey}`;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  const touched = new Set<number>();
  for (const [g, picks] of groups) {
    const [date, clientKey] = g.split("\u0000") as [IsoDate, string];
    const name = i.clientName(clientKey);
    const existing = open.find((l) => l.kind === "slip" && l.clientKey === clientKey && l.detail?.date === date);
    if (existing) {
      const ids = [...(existing.detail?.picks ?? []), ...picks.map((p) => p.id)];
      const all = ids.map((id) => i.pick(id)).filter((p): p is Pick => !!p);
      out.update.push({ id: existing.id, what: slipWhat(name, latestPerItem(all).length), draft: slipDraft(name, date, all, i.movedTo, i.picks), detail: { picks: ids, date }, origin: originOf(all, i.movedTo, i.picks) });
      touched.add(existing.id);
      continue;
    }
    const ids = picks.map((p) => p.id);
    out.open.push({ kind: "slip", ruleKey: `slip:${date}:${clientKey}:${Math.min(...ids)}`, clientKey, who: name, what: slipWhat(name, latestPerItem(picks).length), draft: slipDraft(name, date, picks, i.movedTo, i.picks), detail: { picks: ids, date }, origin: originOf(picks, i.movedTo, i.picks) });
  }
  // Open heads-ups are redrafted when their draft no longer matches (repeated items, a later move).
  for (const l of open) {
    if (l.kind !== "slip" || touched.has(l.id) || !l.detail?.date || !l.detail.picks?.length || !l.clientKey) continue;
    const all = l.detail.picks.map((id) => i.pick(id)).filter((p): p is Pick => !!p);
    if (!all.length) continue;
    const name = i.clientName(l.clientKey);
    const draft = slipDraft(name, l.detail.date, all, i.movedTo, i.picks);
    if (l.draft === undefined || l.draft === draft) continue;
    out.update.push({ id: l.id, what: slipWhat(name, latestPerItem(all).length), draft, detail: { picks: l.detail.picks, date: l.detail.date }, origin: originOf(all, i.movedTo, i.picks) });
  }

  // 3. A DevOps item assigned to me that is blocked: "Nudge on blocker for #id". Closes when it no longer is.
  for (const w of i.work ?? []) {
    if (w.status !== "ok" || w.fromCache) continue;
    for (const item of w.items) {
      if (!item.blocked) continue;
      const mine = i.followUps.filter((l) => l.kind === "blocked" && l.clientKey === w.clientKey && l.itemId === item.id);
      if (mine.some((l) => !l.closedAt)) continue;
      // Closed by a signal (it was unblocked): blocked again, nudge again. Closed by me (I nudged): nudge again only
      // if it is still blocked RENUDGE_WORKDAYS workdays later (Q43).
      const last = mine.at(-1);
      if (last && last.closedBy !== "signal") {
        // Stored stamps are local zoned date-times, so the first ten characters are the local date.
        const closedDay = last.closedAt?.slice(0, 10);
        if (!closedDay || workdaysAfter(closedDay, i.today, i.isWorkday ?? monToFri) < RENUDGE_WORKDAYS) continue;
      }
      const key = `blocked:${w.clientKey}:${item.id}:${mine.length + 1}`;
      if (byKey.has(key)) continue;
      out.open.push({ kind: "blocked", ruleKey: key, clientKey: w.clientKey, who: i.clientName(w.clientKey), what: `Nudge on blocker for #${item.id}: ${item.title}`, itemId: item.id });
    }
  }
  for (const l of open.filter((x) => x.kind === "blocked")) {
    const item = l.itemId !== null ? find(freshWork(l.clientKey), l.itemId) : null;
    if (!item) continue;
    if (DONE_CATEGORIES.has(item.stateCategory)) out.close.push({ id: l.id, note: `DevOps #${item.id} is ${item.state}` });
    else if (!item.blocked) out.close.push({ id: l.id, note: `DevOps #${item.id} is no longer blocked` });
  }

  // 5. Asked a client about priorities (Plan the week, "Block needs work"): closes once work is assigned to me there.
  for (const l of open.filter((x) => x.kind === "priorities")) {
    const w = freshWork(l.clientKey);
    if (w && w.items.length > 0) out.close.push({ id: l.id, note: `Work is assigned to you at ${i.clientName(l.clientKey!)} again` });
  }
  return out;
}

/** Items DevOps should read by id for the open follow-ups about them, per client (they may have left my open items). */
export function watchedIds(followUps: readonly FollowUpLike[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const l of followUps) {
    if (l.closedAt || l.itemId === null || !l.clientKey || (l.kind !== "devops_update" && l.kind !== "blocked")) continue;
    const ids = (out[l.clientKey] ??= []);
    if (!ids.includes(l.itemId)) ids.push(l.itemId);
  }
  return out;
}
