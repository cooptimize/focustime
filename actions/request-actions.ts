// Inbox › Requests (was Asks; shared polling, D514 to D518). The job (actions/request-poll.ts) reads every registered
// client chat for everyone; this is the person's view of it. A chat, its messages and its Requests are shown only to a
// member of that chat (the store's viewer, D521) who follows its client; a Request's state is shared, so whoever
// resolves it resolves it for everyone, by name. Refresh polls the chats this person sees through the same job, now.
// Promises stay each person's own (their plan store), with the message text read from the shared store. Chat text is
// client data: it goes only to that client's cards, never into a log or an error (ids and counts only, and not even
// ids in logs).
import type { AppConfig } from "../config/schema.ts";
import type { LogRecord } from "../log/logger.ts";
import { askTitle, CONTEXT_MESSAGES, type ContextMessage, messageLink, ruleLabel, type PromiseView, type PromisesData, type RequestChatStatus, type RequestsData, type RequestView } from "../plan/asks.ts";
import { LIKELY_MIN, notSortedText, promiseClosedBy, type StoredPromise } from "../plan/asks-ai.ts";
import type { AiService } from "../ai/service.ts";
import { classifyAsk } from "./ask-ai.ts";
import { CHAT_ID, isExternal, teamsLink } from "../plan/chats.ts";
import { POLL_MINUTES, type ClientChat, type Request } from "../plan/requests.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import type { TeamsStore, TeamsView } from "../store/teams-store.ts";
import type { WorkItem } from "../week/types.ts";
import { localToday } from "../week/dates.ts";
import { userZone } from "../week/zone.ts";
import type { CycleResult } from "./request-poll.ts";
import { mapSeq } from "./seq.ts";
import type { ActionResponse } from "./types.ts";

export type { ContextMessage, PromisesData, PromiseView, RequestChatStatus, RequestsData, RequestView } from "../plan/asks.ts";
export const REQUEST_ACTIONS = [
  "requests.list", "requests.refresh", "requests.context", "requests.resolve", "requests.reopen", "requests.search", "requests.purge",
  "requests.sort_again", "requests.show", "promises.list", "promises.resolve", "promises.reopen", "promises.followup", "promises.link",
] as const;
export type RequestAction = (typeof REQUEST_ACTIONS)[number];

/** The shared store and the job's Refresh, as the server hands them in (absent: no shared store, e.g. tests). */
export type RequestsPort = { teams: TeamsStore; refresh: (chatIds: readonly string[]) => Promise<CycleResult> };

export type RequestContext = {
  plan?: PlanStore | undefined;
  requests?: RequestsPort | undefined;
  /** The person's Entra object id (from their sign-in), or null. */
  me: () => Promise<string | null>;
  /** The person's clients (as Settings › Clients lists them); null when Dataverse couldn't be read. */
  followed: () => Promise<ReadonlySet<string> | null>;
  config: () => Promise<AppConfig | null>;
  homeTenant: () => Promise<string | null>;
  /** A client's open DevOps items (mine and their children), for Link; null when DevOps couldn't be read. */
  openItems: (cfg: AppConfig, clientKey: string) => Promise<WorkItem[] | null>;
  /** The clients with DevOps write access (a write PAT): Create is offered only for these. */
  writeClients: () => Promise<string[]>;
  now: () => string;
  log: (r: LogRecord) => void;
  /** AP-2: this person's AI service (null or absent where there is none). */
  ai?: () => Promise<AiService | null>;
  /** AP-2: a client's items read by id, done ones included; null unknown. */
  itemDone?: (cfg: AppConfig, clientKey: string, itemId: number) => boolean | null;
};

/** Resolved requests stay on the tab this long (with Undo), then only open ones show. */
const RESOLVED_SHOWN_MS = 24 * 3600_000;

const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });
const only = (input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null => {
  const o = input === undefined || input === null ? {} : input;
  if (typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (Object.keys(r).some((k) => !required.includes(k) && !optional.includes(k))) return null;
  if (required.some((k) => r[k] === undefined)) return null;
  return r;
};
const MESSAGE_ID = /^[0-9A-Za-z._-]{1,100}$/;
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const newest = (xs: readonly (string | null)[]) => xs.reduce<string | null>((a, b) => (b && (!a || Date.parse(b) > Date.parse(a)) ? b : a), null);

/** A member's name from the chat (token owners and resolvers are always members), or null. */
const memberName = (c: ClientChat | undefined, id: string | null) => (id ? (c?.members?.find((m) => same(m.userId, id))?.displayName ?? null) : null);

/** The chats this person may see: the store's view gives only chats they're in now (D521); here, those of clients they follow. */
export async function visibleChats(view: TeamsView | null, followed: ReadonlySet<string> | null): Promise<ClientChat[]> {
  if (!view) return [];
  return (await view.chats()).filter((c) => !followed || followed.has(c.clientKey));
}

/** A request the AI said needs no action, open and not shown again. */
const isHidden = (a: Request) => a.status === "open" && a.sortStatus === "sorted" && a.sort?.kind === "none" && !a.shown;

function people(chat: ClientChat | undefined, home: string | null) {
  return (authorId: string | null, tenant: string | null, name: string | null) => {
    const m = chat?.members?.find((x) => x.userId && authorId && same(x.userId, authorId));
    const external = home ? isExternal({ tenantId: tenant ?? m?.tenantId ?? null, ...(m?.guest ? { guest: true } : {}) }, home) : false;
    return { name: name ?? m?.displayName ?? (external ? "Someone outside Cooptimize" : "Someone at Cooptimize"), external };
  };
}

export function chatStatus(c: ClientChat, clientName: string): RequestChatStatus {
  return {
    clientKey: c.clientKey, clientName, chatId: c.chatId, chatName: c.displayName, polledAt: c.polledAt, fetchedAt: c.fetchedAt,
    state: c.pollState, via: c.pollState === "via" ? memberName(c, c.tokenUser) : null, note: c.pollNote, retryAt: c.retryAt,
  };
}

/** A client's open items once per list (for "Looks like #1234 <title>"); null when DevOps couldn't be read. */
function itemsOnce(ctx: RequestContext, cfg: AppConfig) {
  const memo = new Map<string, Promise<WorkItem[] | null>>();
  return (k: string) => memo.get(k) ?? memo.set(k, ctx.openItems(cfg, k).catch(() => null)).get(k)!;
}

/** AP-2: promises closed by what they were turned into: the follow-up closed, or the linked item done. */
async function closePromises(ctx: RequestContext, plan: PlanStore, cfg: AppConfig, all: readonly StoredPromise[]): Promise<boolean> {
  let changed = false;
  for (const p of all) {
    if (p.status === "followup" && p.followUpId !== null) {
      const f = await plan.getFollowUp(p.followUpId);
      if (!f || !f.closedAt) continue;
      if (f.outcome === "not_needed") await plan.closePromise(p.chatId, p.messageId, "dismissed");
      else if (promiseClosedBy(p, { followUpDone: true, itemDone: null })) await plan.closePromise(p.chatId, p.messageId);
      changed = true;
    } else if (p.status === "linked" && p.itemId !== null && ctx.itemDone) {
      if (promiseClosedBy(p, { followUpDone: null, itemDone: ctx.itemDone(cfg, p.clientKey, p.itemId) })) {
        await plan.closePromise(p.chatId, p.messageId);
        changed = true;
      }
    }
  }
  if (changed) ctx.log({ source: "plan", op: "promises_closed" });
  return changed;
}

type Seen = { teams: TeamsView; me: string; chats: ClientChat[]; byId: Map<string, ClientChat> };
async function seen(ctx: RequestContext): Promise<Seen | null> {
  const store = ctx.requests?.teams;
  const me = await ctx.me();
  if (!store || !me) return null;
  const teams = store.viewer(me);
  const chats = await visibleChats(teams, await ctx.followed().catch(() => null));
  return { teams, me, chats, byId: new Map(chats.map((c) => [c.chatId, c])) };
}

async function list(ctx: RequestContext, plan: PlanStore | undefined, cfg: AppConfig): Promise<RequestsData> {
  const name = (k: string) => cfg.clientSettings[k]?.name ?? k;
  const v = await seen(ctx);
  const empty: RequestsData = { open: 0, requests: [], hidden: [], chats: [], writeClients: [], pollMinutes: POLL_MINUTES, promisesOpen: 0, lastPoll: null, lastFetch: null };
  if (!v) return empty;
  const home = await ctx.homeTenant();
  const now = Date.parse(ctx.now());
  const items = itemsOnce(ctx, cfg);
  let promises = plan ? await plan.promises() : [];
  if (plan && (await closePromises(ctx, plan, cfg, promises))) promises = await plan.promises();
  const promisedFor = new Map(promises.filter((p) => p.answers && p.status !== "dismissed").map((p) => [`${p.chatId}|${p.answers}`, p.what]));
  const all = await v.teams.requests(v.chats.map((c) => c.chatId));
  const shown = all.filter((a) => isHidden(a) || a.status === "open" || (a.resolvedAt && now - Date.parse(a.resolvedAt) < RESOLVED_SHOWN_MS));
  const views = await mapSeq(shown, async (a): Promise<(RequestView & { hidden: boolean }) | null> => {
    const m = await v.teams.message(a.chatId, a.messageId);
    const chat = v.byId.get(a.chatId);
    if (!m) return null;
    const who = people(chat, home)(m.senderId, m.senderTenant, m.senderName);
    const s = a.sortStatus === "sorted" ? a.sort : null;
    let likely: RequestView["likely"] = null;
    if (s?.likely && s.likely.confidence >= LIKELY_MIN) {
      const hit = (await items(a.clientKey))?.find((i) => i.id === s.likely!.id);
      likely = { id: s.likely.id, title: hit?.title ?? null, url: hit?.url ?? null };
    }
    return {
      chatId: a.chatId, messageId: a.messageId, clientKey: a.clientKey, clientName: name(a.clientKey), chatName: chat?.displayName ?? "A chat no longer registered",
      author: who.name, external: who.external, at: m.createdAt, text: m.text, hasImage: m.hasImage, hasFile: m.hasFile,
      matched: ruleLabel({ rule: a.rule, detail: a.ruleDetail }), status: a.status, item: a.itemId ? { id: a.itemId, url: a.itemUrl, title: a.itemTitle } : null, note: a.note, resolvedAt: a.resolvedAt,
      resolvedBy: a.status === "open" ? null : same(a.resolvedBy, v.me) ? "you" : (memberName(chat, a.resolvedBy) ?? "someone at Cooptimize"),
      link: messageLink(a.chatId, a.messageId),
      sort: s ? { kind: s.kind, urgency: s.urgency, reason: s.reason, itemType: s.itemType, title: s.title } : null,
      likely,
      notSorted: a.sortStatus && a.sortStatus !== "sorted" ? notSortedText(a.sortStatus, name(a.clientKey)) : null,
      promised: promisedFor.get(`${a.chatId}|${a.messageId}`) ?? null,
      hidden: isHidden(a),
    };
  });
  const rs = views.filter((x): x is RequestView & { hidden: boolean } => !!x);
  const strip = ({ hidden: _h, ...x }: RequestView & { hidden: boolean }): RequestView => x;
  const visible = rs.filter((a) => !a.hidden).map(strip);
  return {
    open: visible.filter((a) => a.status === "open").length,
    requests: visible,
    hidden: rs.filter((a) => a.hidden).map(strip),
    promisesOpen: promises.filter((p) => p.status === "open").length,
    // Only chats that are read (D523): a chat with reading off has no poll to show.
    chats: v.chats.filter((c) => c.readOn).map((c) => chatStatus(c, name(c.clientKey))),
    writeClients: await ctx.writeClients().catch(() => []),
    pollMinutes: POLL_MINUTES,
    lastPoll: newest(v.chats.map((c) => c.polledAt)),
    lastFetch: newest(v.chats.map((c) => c.fetchedAt)),
  };
}

/** AP-2: the Promises tab: open ones, and handled ones for a day (with Undo). */
async function promiseList(ctx: RequestContext, plan: PlanStore, cfg: AppConfig): Promise<PromisesData> {
  let all = await plan.promises();
  if (await closePromises(ctx, plan, cfg, all)) all = await plan.promises();
  const v = await seen(ctx);
  const name = (k: string) => cfg.clientSettings[k]?.name ?? k;
  const now = Date.parse(ctx.now());
  const shown = all.filter((p) => p.status === "open" || p.status === "followup" || p.status === "linked" || (p.resolvedAt && now - Date.parse(p.resolvedAt) < RESOLVED_SHOWN_MS));
  const views = await mapSeq(shown, async (p): Promise<PromiseView | null> => {
    // My own message: shown while the shared store keeps it (a promise keeps it from expiring).
    const m = v ? await v.teams.message(p.chatId, p.messageId) : null;
    if (!m) return null;
    const answered = p.answers && v?.byId.has(p.chatId) ? await v.teams.message(p.chatId, p.answers) : null;
    return {
      chatId: p.chatId, messageId: p.messageId, clientKey: p.clientKey, clientName: name(p.clientKey), chatName: v?.byId.get(p.chatId)?.displayName ?? "A chat no longer registered",
      what: p.what, toWhom: p.toWhom, due: p.due, at: m.createdAt, text: m.text,
      answers: answered ? { messageId: answered.messageId, title: askTitle(answered.text) } : null,
      status: p.status, followUpId: p.followUpId, item: p.itemId ? { id: p.itemId, url: p.itemUrl, title: p.itemTitle } : null,
      notSorted: p.aiStatus && p.aiStatus !== "sorted" ? notSortedText(p.aiStatus, name(p.clientKey)) : null,
      reason: p.reason, resolvedAt: p.resolvedAt, link: messageLink(p.chatId, p.messageId),
    };
  });
  const promises = views.filter((x): x is PromiseView => !!x);
  const requestsOpen = v ? (await v.teams.requests(v.chats.map((c) => c.chatId))).filter((a) => a.status === "open" && !isHidden(a)).length : 0;
  return { open: promises.filter((p) => p.status === "open").length, promises, requestsOpen, today: localToday(ctx.now(), userZone(cfg)) };
}

/** Open Requests the AI sorted as needing someone now, in the chats this person sees (Today, notifications). */
export async function urgentRequests(view: TeamsView | null, followed: ReadonlySet<string> | null): Promise<Request[]> {
  if (!view) return [];
  const chats = await visibleChats(view, followed);
  return (await view.requests(chats.map((c) => c.chatId))).filter((a) => a.status === "open" && a.sortStatus === "sorted" && !!a.sort && a.sort.kind !== "none");
}

const ids = (o: Record<string, unknown>): { chatId: string; messageId: string } | null =>
  typeof o.chatId === "string" && CHAT_ID.test(o.chatId) && typeof o.messageId === "string" && MESSAGE_ID.test(o.messageId) ? { chatId: o.chatId, messageId: o.messageId } : null;

export async function requestAction(ctx: RequestContext, action: RequestAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  /** One request this person may see, or null. */
  const mine = async (k: { chatId: string; messageId: string }) => {
    const v = await seen(ctx);
    if (!v || !v.byId.has(k.chatId)) return null;
    const r = await v.teams.request(k.chatId, k.messageId);
    return r ? { r, v } : null;
  };
  try {
    switch (action) {
      case "requests.list": {
        if (!only(input, [])) return bad("requests.list takes {}");
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
      case "requests.refresh": {
        if (!only(input, [])) return bad("requests.refresh takes {}");
        const v = await seen(ctx);
        if (v?.chats.length && ctx.requests) await ctx.requests.refresh(v.chats.map((c) => c.chatId));
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
      case "requests.context": {
        const o = only(input, ["chatId", "messageId"]);
        const k = o && ids(o);
        if (!k) return bad("requests.context takes { chatId, messageId }");
        const hit = await mine(k);
        const m = hit && (await hit.v.teams.message(k.chatId, k.messageId));
        if (!hit || !m) return bad("No such request", 404);
        const chat = hit.v.byId.get(k.chatId)!;
        const who = people(chat, await ctx.homeTenant());
        const before = await hit.v.teams.messagesBefore(k.chatId, m.createdAt, CONTEXT_MESSAGES);
        const messages: ContextMessage[] = before.map((x) => {
          const w = who(x.senderId, x.senderTenant, x.senderName);
          const self = same(x.senderId, hit.v.me);
          return { messageId: x.messageId, author: self ? "You" : w.name, external: w.external, mine: self, at: x.createdAt, text: x.text, hasImage: x.hasImage, hasFile: x.hasFile };
        });
        return { ok: true, data: { messages, chatLink: teamsLink(chat) } };
      }
      case "requests.resolve": {
        const o = only(input, ["chatId", "messageId", "status"], ["note", "itemId"]);
        const k = o && ids(o);
        if (!o || !k || !["linked", "handled", "dismissed"].includes(o.status as string)) return bad("requests.resolve takes { chatId, messageId, status: linked | handled | dismissed, note?, itemId? }");
        const status = o.status as "linked" | "handled" | "dismissed";
        if (o.note !== undefined && o.note !== null && (typeof o.note !== "string" || o.note.length > 1000)) return bad("note is text of at most 1000 characters");
        const hit = await mine(k);
        if (!hit) return bad("No such request", 404);
        const req = hit.r;
        let item: { itemId: number; itemUrl: string; itemTitle: string } | null = null;
        if (status === "linked") {
          if (typeof o.itemId !== "number" || !Number.isSafeInteger(o.itemId) || o.itemId <= 0) return bad("Link needs an itemId");
          const items = await ctx.openItems(cfg, req.clientKey);
          if (!items) return bad(`DevOps couldn't be read for ${cfg.clientSettings[req.clientKey]?.name ?? req.clientKey}. Try again in a moment`, 503);
          const found = items.find((i) => i.id === o.itemId);
          if (!found) return bad("That isn't one of this client's open items", 404);
          item = { itemId: found.id, itemUrl: found.url, itemTitle: found.title };
        }
        const note = typeof o.note === "string" && o.note.trim() ? o.note.trim() : null;
        // Idempotent: the same resolution again changes nothing.
        if (req.status === status && (status !== "linked" || req.itemId === item?.itemId)) return { ok: true, data: await list(ctx, plan, cfg) };
        await hit.v.teams.resolveRequest(k.chatId, k.messageId, { status, ...(item ?? {}), note });
        ctx.log({ source: "plan", op: "request_resolved", kind: status });
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
      case "requests.reopen": {
        const o = only(input, ["chatId", "messageId"]);
        const k = o && ids(o);
        if (!k) return bad("requests.reopen takes { chatId, messageId }");
        const hit = await mine(k);
        if (!hit) return bad("No such request", 404);
        if (hit.r.status === "created") return bad(`#${hit.r.itemId} was created in DevOps. Undo it from Settings > Data > Audit log; the request opens again`, 409, "created");
        if (hit.r.status !== "open") {
          await hit.v.teams.resolveRequest(k.chatId, k.messageId, { status: "open" });
          ctx.log({ source: "plan", op: "request_reopened", kind: hit.r.status });
        }
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
      case "requests.search": {
        const o = only(input, ["chatId", "messageId"], ["query"]);
        const k = o && ids(o);
        if (!o || !k || (o.query !== undefined && (typeof o.query !== "string" || o.query.length > 200))) return bad("requests.search takes { chatId, messageId, query? }");
        // A request's or (AP-2) one of my promises' client.
        const clientKey = (await mine(k))?.r.clientKey ?? (plan ? (await plan.promise(k.chatId, k.messageId))?.clientKey : undefined);
        if (!clientKey) return bad("No such request", 404);
        const items = await ctx.openItems(cfg, clientKey);
        if (!items) return { ok: true, data: { available: false, items: [] } };
        const q = String(o.query ?? "").trim().toLowerCase().replace(/^#/, "");
        const words = q.split(/\s+/).filter(Boolean);
        const hits = items.filter((i) => !q || String(i.id) === q || words.every((w) => i.title.toLowerCase().includes(w))).slice(0, 20);
        return { ok: true, data: { available: true, items: hits.map((i) => ({ id: i.id, title: i.title, type: i.type, state: i.state, url: i.url })) } };
      }
      case "requests.purge": {
        const o = only(input, ["clientKey"]);
        if (!o || typeof o.clientKey !== "string" || !o.clientKey || o.clientKey.length > 100) return bad("requests.purge takes { clientKey }");
        // Shared messages: only someone who sees one of the client's chats may delete them (Requests stay).
        const v = await seen(ctx);
        if (!v || !v.chats.some((c) => c.clientKey === o.clientKey)) return bad("You don't see any of this client's chats", 404);
        const n = await v.teams.purgeClient(o.clientKey);
        ctx.log({ source: "plan", op: "requests_purged", count: n });
        return { ok: true, data: { ...(await list(ctx, plan, cfg)), purged: n } };
      }
      case "requests.sort_again": {
        const o = only(input, ["chatId", "messageId"]);
        const k = o && ids(o);
        if (!k) return bad("requests.sort_again takes { chatId, messageId }");
        const hit = await mine(k);
        if (!hit) return bad("No such request", 404);
        if (hit.r.status !== "open") return bad("This request is already resolved", 409);
        const ai = ctx.ai ? await ctx.ai() : null;
        if (!ai) return bad("AI isn't available here", 409);
        // My own switches and caps: the sort is saved on the shared row as mine.
        const r = await classifyAsk({ teams: hit.v.teams, by: hit.v.me, ai: async () => ai, homeTenant: await ctx.homeTenant(), me: null, openItems: ctx.openItems }, cfg, hit.r);
        ctx.log({ source: "plan", op: "request_sorted", kind: r?.status ?? "none" });
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
      case "requests.show": {
        const o = only(input, ["chatId", "messageId", "shown"]);
        const k = o && ids(o);
        if (!o || !k || typeof o.shown !== "boolean") return bad("requests.show takes { chatId, messageId, shown }");
        const hit = await mine(k);
        if (!hit) return bad("No such request", 404);
        await hit.v.teams.setShown(k.chatId, k.messageId, o.shown);
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
    }
    if (!plan) return bad("The plan store isn't available", 503);
    switch (action) {
      case "promises.list": {
        if (!only(input, [])) return bad("promises.list takes {}");
        return { ok: true, data: await promiseList(ctx, plan, cfg) };
      }
      case "promises.resolve": {
        const o = only(input, ["chatId", "messageId", "status"]);
        const k = o && ids(o);
        if (!o || !k || (o.status !== "done" && o.status !== "dismissed")) return bad("promises.resolve takes { chatId, messageId, status: done | dismissed }");
        const p = await plan.promise(k.chatId, k.messageId);
        if (!p) return bad("No such promise", 404);
        if (p.status !== o.status) {
          if (p.status === "followup" || p.status === "linked") await plan.closePromise(k.chatId, k.messageId, o.status);
          else await plan.resolvePromise(k.chatId, k.messageId, { status: o.status });
        }
        ctx.log({ source: "plan", op: "promise_resolved", kind: o.status });
        return { ok: true, data: await promiseList(ctx, plan, cfg) };
      }
      case "promises.reopen": {
        const o = only(input, ["chatId", "messageId"]);
        const k = o && ids(o);
        if (!k) return bad("promises.reopen takes { chatId, messageId }");
        const p = await plan.promise(k.chatId, k.messageId);
        if (!p) return bad("No such promise", 404);
        if (p.status === "followup") return bad("This promise is a follow-up now: change it in the Inbox", 409);
        if (p.status !== "open") await plan.resolvePromise(k.chatId, k.messageId, { status: "open" });
        return { ok: true, data: await promiseList(ctx, plan, cfg) };
      }
      case "promises.followup": {
        const o = only(input, ["chatId", "messageId"], ["who", "what", "due"]);
        const k = o && ids(o);
        if (!o || !k) return bad("promises.followup takes { chatId, messageId, who?, what?, due? }");
        const p = await plan.promise(k.chatId, k.messageId);
        if (!p) return bad("No such promise", 404);
        if (p.status !== "open") return bad("This promise is already handled", 409);
        const text = (v: unknown, n: string, max: number) => (v === undefined || v === null ? undefined : typeof v === "string" && v.trim().length <= max ? v.trim() : (() => { throw new PlanError(`${n} is text of at most ${max} characters`); })());
        const what = text(o.what, "what", 200) || p.what;
        const who = text(o.who, "who", 200) ?? p.toWhom;
        const due = o.due === undefined ? p.due : o.due === null || o.due === "" ? null : typeof o.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.due) ? o.due : null;
        if (o.due !== undefined && o.due !== null && o.due !== "" && !due) return bad("due is a date like 2026-11-06");
        const f = await plan.addFollowUp({ who: who || null, what, due, clientKey: p.clientKey, channel: "teams" });
        await plan.resolvePromise(k.chatId, k.messageId, { status: "followup", followUpId: f.id });
        ctx.log({ source: "plan", op: "promise_resolved", kind: "followup" });
        return { ok: true, data: { ...(await promiseList(ctx, plan, cfg)), followUpId: f.id } };
      }
      case "promises.link": {
        const o = only(input, ["chatId", "messageId", "itemId"]);
        const k = o && ids(o);
        if (!o || !k || typeof o.itemId !== "number" || !Number.isSafeInteger(o.itemId) || o.itemId <= 0) return bad("promises.link takes { chatId, messageId, itemId }");
        const p = await plan.promise(k.chatId, k.messageId);
        if (!p) return bad("No such promise", 404);
        if (p.status !== "open") return bad("This promise is already handled", 409);
        const items = await ctx.openItems(cfg, p.clientKey);
        if (!items) return bad(`DevOps couldn't be read for ${cfg.clientSettings[p.clientKey]?.name ?? p.clientKey}. Try again in a moment`, 503);
        const hit = items.find((i) => i.id === o.itemId);
        if (!hit) return bad("That isn't one of this client's open items", 404);
        await plan.resolvePromise(k.chatId, k.messageId, { status: "linked", itemId: hit.id, itemUrl: hit.url, itemTitle: hit.title });
        ctx.log({ source: "plan", op: "promise_resolved", kind: "linked" });
        return { ok: true, data: await promiseList(ctx, plan, cfg) };
      }
    }
    return bad("unknown action");
  } catch (e) {
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
