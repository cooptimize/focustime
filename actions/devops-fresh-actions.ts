// DV-2: DevOps changes show up on their own. Three actions:
// - devops.versions: each of my clients' DevOps version and freshness (asked by the page every 30 s while visible, as a
//   background call, so it never counts as use). Versions and check times only: never an item, a title, or anything
//   about a client I can't see. The page rereads a screen's data only when a version it shows moves.
// - devops.refresh: R and Refresh on every tab. A check now for the clients on screen (30 s apart per client, shared by
//   everyone, D592), waited for up to 8 s, and what it found in plain words.
// - devops.find: Settings › DevOps › Find an item. For one client I can see and one item number: whether DevOps has
//   it (one read by id through the client's limiter), whether FocusTime has it, the scope, and whether Day, Week,
//   Ahead and Status show it, and why not. At most 10 a minute per person, so it can't be used to sweep numbers.
import type { AppConfig } from "../config/schema.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import type { FindAnswer, ForcedCheck, RefreshAnswer, VersionsAnswer } from "../plan/devops-fresh-types.ts";
export type { FindAnswer, RefreshAnswer, VersionsAnswer } from "../plan/devops-fresh-types.ts";
import { findAnswer, type AheadPresence, type FindFacts, type StatusPresence } from "../plan/find-item.ts";
import { DEFAULT_FILTERS, groups } from "../plan/ahead-model.ts";
import type { AheadFilters } from "../plan/ahead-edit.ts";
import type { ActionResponse, AheadLoad } from "./types.ts";

export const FRESH_ACTIONS = ["devops.versions", "devops.refresh", "devops.find"] as const;
export type FreshAction = (typeof FRESH_ACTIONS)[number];

export type FreshContext = {
  config: () => Promise<AppConfig | null>;
  /** The clients I see DevOps for (followed, clients only, with DevOps), as Ahead reads them. */
  clients: (cfg: AppConfig) => Promise<ClientRef[]>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "freshness" | "refreshNow" | "findItem">;
  /** Ahead's load and my saved filters (absent or failing: "Ahead couldn't be read"). */
  ahead?: () => Promise<{ load: AheadLoad; filters: AheadFilters | null } | null>;
  /** Status's features for one client: shown and Also assigned (absent or failing: unavailable). */
  status?: (clientKey: string) => Promise<{ shown: number[]; also: number[] } | null>;
  /** To-dos on today's plan (item ids), and the items on this week's plan (with their parents) for a client. */
  todayItems?: (clientKey: string) => Promise<number[]>;
  weekItems?: (clientKey: string) => Promise<number[]>;
  nowMs: () => number;
  /** One key per person, for the finder's limit. */
  who: object;
};


const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
const isKey = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 100;
const obj = (input: unknown, allowed: string[]): Record<string, unknown> | null => {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  return Object.keys(o).every((k) => allowed.includes(k)) ? o : null;
};
/** Only clients I see: keys I asked for that aren't mine are dropped without a word (never an error naming them). */
const pick = (mine: readonly ClientRef[], keys: unknown): ClientRef[] | null => {
  if (keys === undefined) return [...mine];
  if (!Array.isArray(keys) || keys.length > 50 || !keys.every(isKey)) return null;
  const want = new Set(keys);
  return mine.filter((c) => want.has(c.clientKey));
};

/** "in 4 min", "in 1 min", "soon". */
const inMinutes = (at: string | null, nowMs: number) => {
  if (!at) return "soon";
  const m = Math.ceil((Date.parse(at) - nowMs) / 60_000);
  return m <= 0 ? "soon" : `in ${m} min`;
};

/** DV-2: Refresh's one line and its problems, in plain words. Pure. */
export function refreshWords(results: readonly (ForcedCheck & { clientName: string })[], nowMs: number): { line: string; problems: string[] } {
  if (!results.length) return { line: "No DevOps to check for the clients here", problems: [] };
  const problems: string[] = [];
  for (const r of results) {
    if (r.problem?.kind === "refused") problems.push(`${r.clientName}'s DevOps sign-in was refused`);
    else if (r.problem?.kind === "slowed") problems.push(`${r.clientName} is slowed by DevOps, next check ${inMinutes(r.nextAt, nowMs)}`);
    else if (r.problem?.kind === "failed") problems.push(`${r.clientName}: ${r.problem.words}`);
    else if (r.problem?.kind === "first") problems.push(`${r.clientName}'s DevOps is being read for the first time`);
    else if (r.pending) problems.push(`${r.clientName} is still being checked`);
  }
  const counted = results.filter((r) => r.changes !== null);
  if (!counted.length) return { line: problems.length ? `DevOps couldn't be checked now · ${problems.join(" · ")}` : "DevOps checked just now", problems };
  const n = counted.reduce((k, r) => k + (r.changes ?? 0), 0);
  const line = `DevOps checked just now · ${n === 0 ? "no changes" : n === 1 ? "1 change" : `${n} changes`}`;
  return { line: problems.length ? `${line} · ${problems.join(" · ")}` : line, problems };
}

// ---- the finder's limit: 10 a minute per person ----
const FIND_LIMIT = 10;
const finds = new WeakMap<object, number[]>();
function allowFind(who: object, nowMs: number): boolean {
  const recent = (finds.get(who) ?? []).filter((t) => nowMs - t < 60_000);
  if (recent.length >= FIND_LIMIT) return (finds.set(who, recent), false);
  finds.set(who, [...recent, nowMs]);
  return true;
}

/** Ahead's answer for one item, from Ahead's own load and filters (the Grid's rules, plan/ahead-model.ts). */
export function aheadPresence(load: AheadLoad, saved: AheadFilters | null, clientKey: string, id: number): AheadPresence {
  const f: AheadFilters = { ...DEFAULT_FILTERS, ...(saved ?? {}) };
  const rowIn = (x: AheadFilters) => groups(load, x, { stories: true }).some((g) => g.client.clientKey === clientKey && g.rows.some((r) => r.item.id === id && !r.context));
  if (rowIn(f)) return { kind: "shown" };
  const none: AheadFilters = { ...DEFAULT_FILTERS, owner: Object.fromEntries(load.clients.map((c) => [c.clientKey, "all" as const])), ...(f.whole ? { whole: true } : {}) };
  if (!rowIn(none)) return { kind: "absent" };
  // Which one of my filters hides it: each relaxed alone.
  const tries: [Extract<AheadPresence, { kind: "filtered" }>["filter"], AheadFilters][] = [
    ["clients", { ...f, clients: [] }],
    ["owner", { ...f, owner: { ...f.owner, [clientKey]: "all" } }],
    ["epic", { ...f, epic: null }],
    ["ready", { ...f, gaps: false, kinds: [] }],
    ["dates", (({ range: _r, ...rest }) => ({ ...rest, from: null, to: null }))(f)],
    ["stale", { ...f, stale: false }],
    ["text", { ...f, q: "" }],
  ];
  for (const [filter, x] of tries) if (rowIn(x)) return filter === "owner" ? { kind: "filtered", filter, owner: f.owner[clientKey] === "contributing" ? "contributing" : "mine" } : { kind: "filtered", filter };
  return { kind: "filtered", filter: "several" };
}

export async function freshAction(ctx: FreshContext, action: FreshAction, input: unknown): Promise<ActionResponse> {
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const src = ctx.devops(cfg);
  const mine = await ctx.clients(cfg).catch(() => [] as ClientRef[]);
  const name = (k: string) => mine.find((c) => c.clientKey === k)?.clientName ?? k;
  const serverNow = new Date(ctx.nowMs()).toISOString();

  if (action === "devops.versions") {
    const o = obj(input, ["clientKeys"]);
    const refs = o ? pick(mine, o.clientKeys) : null;
    if (!refs) return bad("devops.versions takes { clientKeys? }");
    const fresh = src.freshness ? await src.freshness(refs).catch(() => []) : [];
    return { ok: true, data: { clients: fresh.map((f) => ({ ...f, clientName: name(f.clientKey) })), serverNow } satisfies VersionsAnswer };
  }

  if (action === "devops.refresh") {
    const o = obj(input, ["clientKeys"]);
    const refs = o ? pick(mine, o.clientKeys) : null;
    if (!refs) return bad("devops.refresh takes { clientKeys? }");
    const done = src.refreshNow ? await src.refreshNow(refs).catch(() => []) : [];
    const clients = done.map((r) => ({ ...r, clientName: name(r.clientKey) }));
    return { ok: true, data: { clients, ...refreshWords(clients, ctx.nowMs()), serverNow } satisfies RefreshAnswer };
  }

  // devops.find
  const o = obj(input, ["clientKey", "itemId"]);
  const id = typeof o?.itemId === "number" ? o.itemId : typeof o?.itemId === "string" && /^#?\d{1,9}$/.test(o.itemId.trim()) ? Number(o.itemId.trim().replace("#", "")) : NaN;
  if (!o || !isKey(o.clientKey) || !Number.isInteger(id) || id <= 0) return bad("devops.find takes { clientKey, itemId }");
  // Only a client I can already see; another one reads as not mine, with nothing about it.
  const ref = mine.find((c) => c.clientKey === o.clientKey);
  if (!ref || !src.findItem) return bad("Choose one of your clients", 404);
  if (!allowFind(ctx.who, ctx.nowMs())) return bad("That's a lot of lookups at once. Try again in a minute.", 429);
  const base = await src.findItem(ref, id).catch(() => null);
  if (!base) return bad(`FocusTime can't read ${ref.clientName}'s DevOps for you now`, 409);
  const item = base.devops.kind === "found" ? base.devops.item : null;
  const [today, week, ahead, status] = await Promise.all([
    item && ctx.todayItems ? ctx.todayItems(ref.clientKey).catch(() => []) : Promise.resolve([] as number[]),
    item && ctx.weekItems ? ctx.weekItems(ref.clientKey).catch(() => []) : Promise.resolve([] as number[]),
    item && ctx.ahead ? ctx.ahead().catch(() => null) : Promise.resolve(null),
    item && ctx.status ? ctx.status(ref.clientKey).catch(() => null) : Promise.resolve(null),
  ]);
  const aheadP: AheadPresence = !ahead ? { kind: "unavailable" } : aheadPresence(ahead.load, ahead.filters, ref.clientKey, id);
  // Status lists features: a story or task answers for its feature (from Ahead's items, the same store).
  const items = ahead?.load.clients.find((c) => c.clientKey === ref.clientKey)?.items ?? [];
  const featureOf = (x: number | null, depth = 0): number | null => {
    if (x === null || depth > 6) return null;
    const it = items.find((i) => i.id === x);
    if (!it) return null;
    return it.level === "parent" ? it.id : it.level === "top" ? null : featureOf(it.parentId, depth + 1);
  };
  const fid = item?.tier === "feature" ? id : item ? featureOf(item.parentId) : null;
  const statusP: StatusPresence = !status ? { kind: "unavailable" } : status.shown.includes(id) ? { kind: "shown" } : status.also.includes(id) ? { kind: "also" } : fid !== null && fid !== id && status.shown.includes(fid) ? { kind: "feature_shown", featureId: fid } : { kind: "absent", featureId: fid };
  const facts: FindFacts = { clientName: ref.clientName, id, ...base, todayTodo: today.includes(id), weekPlanned: week.includes(id), ahead: aheadP, status: statusP };
  return { ok: true, data: { clientName: ref.clientName, id, lines: findAnswer(facts, ctx.nowMs()) } satisfies FindAnswer };
}
