// Loop rules (step 7, stage A of D93): deterministic, no AI. Each rule opens a loop once and, where a DevOps signal
// can prove it, closes it again. Pure: plan picks, DevOps results already loaded and the loops so far in; what to
// open, update and close out. The server applies it to the plan store. Nothing is ever posted anywhere.
import type { Half, IsoDate, WorkItem } from "../week/types.ts";
import type { Pick } from "./types.ts";

/** A loop as the rules see it (the store's Loop fits this). */
export type LoopLike = {
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
};

export type RuleLoop = {
  kind: "devops_update" | "slip" | "blocked";
  ruleKey: string;
  clientKey: string;
  who: string;
  what: string;
  itemId?: number | null;
  refAt?: string | null;
  draft?: string | null;
  detail?: { picks: number[]; date: IsoDate } | null;
};

/** One client's DevOps result as far as the rules need it. */
export type WorkState = {
  clientKey: string;
  status: string;
  fromCache: boolean;
  items: readonly WorkItem[];
  children?: readonly WorkItem[];
  /** Items read by id because a loop is about them (completed ones included). */
  watched?: readonly WorkItem[];
};

export type DetectInput = {
  today: IsoDate;
  /** Recent picks (the last couple of weeks up to today). */
  picks: readonly Pick[];
  /** Any pick by id (for loops about picks outside the window). */
  pick: (id: number) => Pick | null;
  committedAt: (date: IsoDate) => string | null;
  /** The pick a moved pick went to. */
  movedTo: (id: number) => Pick | null;
  /** DevOps per client; null when DevOps wasn't loaded (the rules that need it do nothing). */
  work: readonly WorkState[] | null;
  /** Every loop so far, open and closed. */
  loops: readonly LoopLike[];
  /** Clients a heads-up isn't owed to: Cooptimize and standing-block clients. */
  internal: ReadonlySet<string>;
  clientName: (key: string) => string;
};

export type Detected = {
  open: RuleLoop[];
  update: { id: number; what: string; draft: string; detail: { picks: number[]; date: IsoDate } }[];
  close: { id: number; note: string }[];
};

const OPEN_CATEGORIES = new Set(["Proposed", "InProgress"]);
const DONE_CATEGORIES = new Set(["Completed", "Removed"]);
const BLOCKED = /\bblocked\b/i;

/** Blocked by its state ("Blocked", "10-Blocked") or a tag ("Blocked", "Blocked by vendor"). */
export const isBlocked = (state: string, tags: readonly string[]) => BLOCKED.test(state) || tags.some((t) => BLOCKED.test(t));

const instant = (s: string) => Temporal.Instant.from(s);
const after = (a: string, b: string) => !!a && !!b && Temporal.Instant.compare(instant(a), instant(b)) > 0;
const dayText = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const HALF_WORDS: Record<Half, string> = { AM: "morning", PM: "afternoon", EVE: "evening" };
const ref = (p: Pick) => (p.itemId !== null ? `#${p.itemId} ${p.title}` : p.title);

function find(w: WorkState | undefined, id: number): WorkItem | null {
  if (!w) return null;
  return w.items.find((i) => i.id === id) ?? w.children?.find((i) => i.id === id) ?? w.watched?.find((i) => i.id === id) ?? null;
}

/** The plain-text heads-up for one client and day: the slipped items and where each went. No AI, a template. */
export function slipDraft(clientName: string, date: IsoDate, picks: readonly Pick[], movedTo: (id: number) => Pick | null): string {
  const lines = picks.map((p) => {
    const to = p.status === "moved" ? movedTo(p.id) : null;
    const plan = to ? `moving to ${dayText(to.date)} (${HALF_WORDS[to.half]})` : "off my plan for now; I'll come back with a new date";
    return `- ${ref(p)}: ${plan}`;
  });
  return [`Hi ${clientName}, a quick heads-up on my plan for ${dayText(date)}:`, ...lines, "I'll keep you posted."].join("\n");
}

const slipWhat = (clientName: string, n: number) => `Heads-up to ${clientName} about the slip${n > 1 ? ` (${n} items)` : ""}`;

export function detectLoops(i: DetectInput): Detected {
  const out: Detected = { open: [], update: [], close: [] };
  const byKey = new Set(i.loops.map((l) => l.ruleKey).filter(Boolean));
  const open = i.loops.filter((l) => !l.closedAt);
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
    // Already updated after it was ticked done: nothing owed.
    if (after(item.changedAt, p.updatedAt)) continue;
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
    else if (l.refAt && after(item.changedAt, l.refAt)) out.close.push({ id: l.id, note: `DevOps #${item.id} was updated` });
  }

  // 2. Planned work moved to another day or dropped from a committed day: "Heads-up to <client> about the slip".
  const covered = new Set(i.loops.filter((l) => l.kind === "slip").flatMap((l) => l.detail?.picks ?? []));
  const groups = new Map<string, Pick[]>();
  for (const p of i.picks) {
    if (p.status !== "moved" && p.status !== "dropped") continue;
    if (i.internal.has(p.clientKey) || covered.has(p.id)) continue;
    const committed = i.committedAt(p.date);
    if (!committed || !after(p.updatedAt, committed) && p.updatedAt !== committed) continue;
    const g = `${p.date}\u0000${p.clientKey}`;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  for (const [g, picks] of groups) {
    const [date, clientKey] = g.split("\u0000") as [IsoDate, string];
    const name = i.clientName(clientKey);
    const existing = open.find((l) => l.kind === "slip" && l.clientKey === clientKey && l.detail?.date === date);
    if (existing) {
      const ids = [...(existing.detail?.picks ?? []), ...picks.map((p) => p.id)];
      const all = ids.map((id) => i.pick(id)).filter((p): p is Pick => !!p);
      out.update.push({ id: existing.id, what: slipWhat(name, all.length), draft: slipDraft(name, date, all, i.movedTo), detail: { picks: ids, date } });
      continue;
    }
    const ids = picks.map((p) => p.id);
    out.open.push({ kind: "slip", ruleKey: `slip:${date}:${clientKey}:${Math.min(...ids)}`, clientKey, who: name, what: slipWhat(name, picks.length), draft: slipDraft(name, date, picks, i.movedTo), detail: { picks: ids, date } });
  }

  // 3. A DevOps item assigned to me that is blocked: "Nudge on blocker for #id". Closes when it no longer is.
  for (const w of i.work ?? []) {
    if (w.status !== "ok" || w.fromCache) continue;
    for (const item of w.items) {
      if (!item.blocked) continue;
      const mine = i.loops.filter((l) => l.kind === "blocked" && l.clientKey === w.clientKey && l.itemId === item.id);
      if (mine.some((l) => !l.closedAt)) continue;
      // Closed by me while it stays blocked: I've nudged. Closed by a signal (it was unblocked): blocked again.
      const last = mine.at(-1);
      if (last && last.closedBy !== "signal") continue;
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
  return out;
}

/** Items DevOps should read by id for the open loops about them, per client (they may have left my open items). */
export function watchedIds(loops: readonly LoopLike[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const l of loops) {
    if (l.closedAt || l.itemId === null || !l.clientKey || (l.kind !== "devops_update" && l.kind !== "blocked")) continue;
    const ids = (out[l.clientKey] ??= []);
    if (!ids.includes(l.itemId)) ids.push(l.itemId);
  }
  return out;
}
