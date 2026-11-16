// Follow-up rules (step 7, stage A of D93): deterministic, no AI. Each rule opens a follow-up once and, where a DevOps signal
// can prove it, closes it again. Pure: plan picks, DevOps results already loaded and the follow-ups so far in; what to
// open, update and close out. The server applies it to the plan store. Nothing is ever posted anywhere.
import { isClosed, isOpen } from "./process.ts";
import type { IsoDate, WorkItem } from "../week/types.ts";
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

const BLOCKED = /\bblocked\b/i;

/** Blocked by its state ("Blocked", "10-Blocked") or a tag ("Blocked", "Blocked by vendor"). */
export const isBlocked = (state: string, tags: readonly string[]) => BLOCKED.test(state) || tags.some((t) => BLOCKED.test(t));

const monToFri = (d: IsoDate) => Temporal.PlainDate.from(d).dayOfWeek <= 5;
const instant = (s: string) => Temporal.Instant.from(s);
const after = (a: string, b: string) => !!a && !!b && Temporal.Instant.compare(instant(a), instant(b)) > 0;

function find(w: WorkState | undefined, id: number): WorkItem | null {
  if (!w) return null;
  return w.items.find((i) => i.id === id) ?? w.children?.find((i) => i.id === id) ?? w.watched?.find((i) => i.id === id) ?? null;
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
    if (!item || !isOpen(item.stateCategory)) continue;
    // I already updated it after ticking it done: nothing owed. Someone else's change isn't my update (Q42).
    if (item.changedByMe && after(item.changedAt, p.updatedAt)) continue;
    out.open.push({ kind: "devops_update", ruleKey: key, clientKey: p.clientKey, who: i.clientName(p.clientKey), what: `Update DevOps #${p.itemId}: ${p.title}`, itemId: p.itemId, refAt: p.updatedAt });
  }
  for (const l of open.filter((x) => x.kind === "devops_update")) {
    const pickId = Number(l.ruleKey?.split(":")[1]);
    const p = Number.isInteger(pickId) ? i.pick(pickId) : null;
    if (p && p.status !== "done") {
      out.close.push({ id: l.id, note: "The to-do is no longer marked done" });
      continue;
    }
    const w = freshWork(l.clientKey);
    const item = l.itemId !== null ? find(w, l.itemId) : null;
    if (!item) continue;
    if (isClosed(item.stateCategory)) out.close.push({ id: l.id, note: `DevOps #${item.id} is ${item.state}` });
    // Q42: only my own change after the follow-up opened proves the update.
    else if (item.changedByMe && after(item.changedAt, l.openedAt)) out.close.push({ id: l.id, note: `DevOps #${item.id} was updated` });
  }

  // 2. CF-1 (E1): no "Heads-up to <client> about the slip" any more (step 13.5's rule read the day's confirm time,
  // which is gone). Heads-ups opened before stay as they are and close the usual ways (E2).

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
    if (isClosed(item.stateCategory)) out.close.push({ id: l.id, note: `DevOps #${item.id} is ${item.state}` });
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
