// AP-1: Asks (Inbox › Asks). Read only against Teams, no AI: the delivery chats a person switched Read for asks on are
// read for new messages (their own delegated Chat.Read, allowed by them when they switch it on), every few minutes in
// their working hours on days that aren't PTO, or on Refresh. New messages are stored (only the listed fields) and the
// rules in plan/asks.ts decide which are asks. An ask is resolved here: linked to an existing item, handled or
// dismissed (each undoable), or created in DevOps through the write framework (devops-write-actions.ts, ask_create).
// Chat text is client data: it goes only to that client's cards, never into a log or an error (ids and counts only,
// and not even ids in logs).
import type { AppConfig } from "../config/schema.ts";
import type { LogRecord } from "../log/logger.ts";
import { inWorkingHours } from "../plan/notify.ts";
import { askTitle, backoffUntil, CONTEXT_MESSAGES, type AskView, type AsksData, type ContextMessage, matchAsk, messageLink, nextPollAt, pollDue, ruleLabel, type Ask, type PromiseView, type PromisesData, type StoredMessage } from "../plan/asks.ts";
import { LIKELY_MIN, matchPromise, notSortedText, promiseClosedBy, type StoredPromise } from "../plan/asks-ai.ts";
import type { AiService } from "../ai/service.ts";
import { classifyAsk, extractPromise, type AskAiDeps } from "./ask-ai.ts";
import { CHAT_ID, isExternal, teamsLink, type DeliveryChat } from "../plan/chats.ts";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import type { WorkItem } from "../week/types.ts";
import { localToday } from "../week/dates.ts";
import { userZone } from "../week/zone.ts";
import { storedIdentity, type MicrosoftAccount } from "./account.ts";
import { mapSeq } from "./seq.ts";
import type { ActionResponse } from "./types.ts";

export type { AskChatStatus, AskView, AsksData, ContextMessage, PromiseView, PromisesData } from "../plan/asks.ts";
export const ASK_ACTIONS = [
  "asks.list", "asks.refresh", "asks.switch", "asks.context", "asks.resolve", "asks.reopen", "asks.search", "asks.purge",
  // AP-2
  "asks.sort_again", "asks.show", "promises.list", "promises.resolve", "promises.reopen", "promises.followup", "promises.link",
] as const;
export type AskAction = (typeof ASK_ACTIONS)[number];

export type AskContext = {
  plan?: PlanStore | undefined;
  account: MicrosoftAccount | null;
  config: () => Promise<AppConfig | null>;
  homeTenant: () => Promise<string | null>;
  /** Whether a date is a PTO day (no reading then). */
  pto: (date: string) => Promise<boolean>;
  /** A client's open DevOps items (mine and their children), for Link; null when DevOps couldn't be read. */
  openItems: (cfg: AppConfig, clientKey: string) => Promise<WorkItem[] | null>;
  /** The clients with DevOps write access (a write PAT): Create is offered only for these. */
  writeClients: () => Promise<string[]>;
  now: () => string;
  log: (r: LogRecord) => void;
  /** AP-2: this person's AI service (null or absent where there is none: the demo, no store). */
  ai?: () => Promise<AiService | null>;
  /** AP-2: a client's items read by id, done ones included (a linked promise closes when its item is done); null unknown. */
  itemDone?: (cfg: AppConfig, clientKey: string, itemId: number) => boolean | null;
};

/** Resolved asks stay on the tab this long (with Undo), then only open ones show. */
const RESOLVED_SHOWN_MS = 24 * 3600_000;
/** A Refresh reads at most this many chats at once. */
const MAX_CHATS = 40;

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
const hhmm = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toString({ smallestUnit: "minute" });
const later = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/** A failed read as a plain status line (no ids, no text) and whether it waits for Retry-After. */
function failureOf(e: unknown): { status: (until: string) => string; retryAfter: number | null } {
  if (e instanceof HttpError && (e.status === 429 || e.status === 503)) return { status: (t) => `Teams asked FocusTime to slow down. Reading again at ${t}`, retryAfter: e.retryAfter };
  if ((e instanceof HttpError && (e.status === 401 || e.status === 403)) || (e instanceof AuthFailure && e.kind === "consent"))
    return { status: () => "FocusTime isn't allowed to read this chat's messages. Switch Read for asks off and on to allow it", retryAfter: null };
  if (e instanceof AuthFailure) return { status: () => "Sign in with Microsoft again to read this chat", retryAfter: null };
  if (e instanceof HttpError && e.status === 404) return { status: () => "You aren't in this chat any more, or it was deleted", retryAfter: null };
  if (e instanceof NetworkError) return { status: (t) => `Teams couldn't be reached. Trying again at ${t}`, retryAfter: null };
  return { status: (t) => `Teams didn't answer as expected. Trying again at ${t}`, retryAfter: null };
}

/**
 * Reads the chats with Read for asks on that are due (or all of them, on Refresh), stores their new messages and adds
 * the asks the rules find. One chat failing never stops the others. Returns counts only.
 */
export type PollResult = { read: number; added: number; failed: number; sorted: number; promises: number; urgent: { chatId: string; messageId: string; clientKey: string; title: string }[] };
export async function pollAsks(ctx: AskContext, o: { force: boolean }): Promise<PollResult> {
  const out: PollResult = { read: 0, added: 0, failed: 0, sorted: 0, promises: 0, urgent: [] };
  const plan = ctx.plan;
  const cfg = await ctx.config();
  if (!plan || !cfg) return out;
  const chats = (await plan.deliveryChats()).filter((c) => c.asks?.on);
  if (!chats.length) return out;
  const tz = userZone(cfg);
  const now = ctx.now();
  const zoned = Temporal.Instant.from(now).toZonedDateTimeISO(tz);
  const inHours = inWorkingHours(cfg.week.hours, zoned);
  const pto = inHours && !o.force ? await ctx.pto(localToday(now, tz)).catch(() => false) : false;
  const due = chats.filter((c) => {
    const a = c.asks!;
    if (o.force) return !a.retryAt || !later(a.retryAt, now);
    return pollDue({ now, lastPolledAt: a.polledAt, retryAt: a.retryAt, pollMinutes: cfg.asks.pollMinutes, inHours, pto });
  }).slice(0, MAX_CHATS);
  if (!due.length) return out;
  const client = ctx.account?.chatMessages;
  const home = await ctx.homeTenant();
  const me = (await storedIdentity(plan))?.oid ?? null;
  const aiDeps: AskAiDeps = { plan, ai: ctx.ai ?? (async () => null), homeTenant: home, me, openItems: ctx.openItems };
  await mapSeq(due, async (c) => {
    const a = c.asks!;
    try {
      if (!client) throw new AuthFailure("not_connected", "not signed in");
      const r = await client.messagesSince(c.chatId, c.clientKey, a.seenAt ?? a.since ?? now);
      // No backfill: nothing written before Read for asks was switched on.
      const fresh = r.messages.filter((m) => !a.since || later(m.createdAt, a.since));
      await plan.addChatMessages(fresh.map(({ mentionedUserIds: _m, modifiedAt: _t, ...m }) => m));
      for (const m of fresh) {
        const hit = home ? matchAsk(m, { homeTenant: home, me, members: c.members ?? [], settings: cfg.asks }) : null;
        if (hit && (await plan.addAsk({ chatId: c.chatId, messageId: m.messageId, clientKey: c.clientKey, rule: hit.rule, ruleDetail: hit.detail, at: m.createdAt }))) {
          out.added++;
          // AP-2: one AI request per new candidate (never every message); a failure is stored as "Not sorted".
          const sorted = await classifyAsk(aiDeps, cfg, { chatId: c.chatId, messageId: m.messageId, clientKey: c.clientKey }).catch(() => null);
          if (sorted?.status === "sorted") out.sorted++;
          if (sorted?.status === "sorted" && sorted.sort.urgency === "now" && sorted.sort.kind !== "none") out.urgent.push({ chatId: c.chatId, messageId: m.messageId, clientKey: c.clientKey, title: sorted.sort.title });
        }
        // AP-2: my own messages with commitment phrasing are promise candidates.
        const mine = !!me && !!m.authorId && m.authorId.toLowerCase() === me.toLowerCase();
        const phrase = mine ? matchPromise(m.text, cfg.asks.promisePhrases) : null;
        if (phrase) {
          const p = await extractPromise(aiDeps, cfg, m).catch(() => null);
          if (p && (await plan.addPromise({ chatId: c.chatId, messageId: m.messageId, clientKey: c.clientKey, phrase, at: m.createdAt, draft: p.draft, aiStatus: p.aiStatus }))) out.promises++;
        }
      }
      const seen = r.newest && (!a.seenAt || later(r.newest, a.seenAt)) ? r.newest : undefined;
      await plan.recordAsksRead(c.chatId, { polledAt: now, ...(seen ? { seenAt: seen } : {}), retryAt: null, failures: 0, status: null });
      out.read++;
    } catch (e) {
      const f = failureOf(e);
      const failures = a.failures + 1;
      const retryAt = backoffUntil(now, f.retryAfter, failures);
      await plan.recordAsksRead(c.chatId, { polledAt: now, retryAt, failures, status: f.status(hhmm(retryAt, tz)) });
      out.failed++;
    }
  });
  ctx.log({ source: "outlook", op: "asks_read", kind: out.failed ? (out.read ? "partial" : "failed") : "ok", count: out.read });
  if (out.added) ctx.log({ source: "plan", op: "asks_added", count: out.added });
  if (out.promises) ctx.log({ source: "plan", op: "promises_added", count: out.promises });
  return out;
}

/** When this person's next chat read is due (for the idle rule), or null when none is on or it's outside their hours. */
export async function asksNextDue(ctx: Pick<AskContext, "plan" | "config" | "now">): Promise<string | null> {
  const cfg = await ctx.config();
  if (!ctx.plan || !cfg) return null;
  const chats = (await ctx.plan.deliveryChats()).flatMap((c) => (c.asks?.on ? [c.asks] : []));
  return nextPollAt(chats, cfg.asks.pollMinutes, ctx.now());
}

function people(chat: DeliveryChat | undefined, home: string | null) {
  return (authorId: string | null, tenant: string | null) => {
    const m = chat?.members?.find((x) => x.userId && authorId && x.userId.toLowerCase() === authorId.toLowerCase());
    const external = home ? isExternal({ tenantId: tenant ?? m?.tenantId ?? null, ...(m?.guest ? { guest: true } : {}) }, home) : false;
    return { name: m?.displayName ?? (external ? "Someone outside Cooptimize" : "Someone at Cooptimize"), external };
  };
}

/** A client's open items once per list (for "Looks like #1234 <title>"); null when DevOps couldn't be read. */
function itemsOnce(ctx: AskContext, cfg: AppConfig) {
  const memo = new Map<string, Promise<WorkItem[] | null>>();
  return (k: string) => memo.get(k) ?? memo.set(k, ctx.openItems(cfg, k).catch(() => null)).get(k)!;
}

/**
 * AP-2: promises closed by what they were turned into: the follow-up closed (done: done; not needed: dismissed), or
 * the linked item in a done state. Checked when the tabs are read.
 */
async function closePromises(ctx: AskContext, plan: PlanStore, cfg: AppConfig, all: readonly StoredPromise[]): Promise<boolean> {
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

async function list(ctx: AskContext, plan: PlanStore, cfg: AppConfig): Promise<AsksData> {
  const home = await ctx.homeTenant();
  const chats = await plan.deliveryChats();
  const byId = new Map(chats.map((c) => [c.chatId, c]));
  const name = (k: string) => cfg.clientSettings[k]?.name ?? k;
  const now = Date.parse(ctx.now());
  const items = itemsOnce(ctx, cfg);
  let promises = await plan.promises();
  if (await closePromises(ctx, plan, cfg, promises)) promises = await plan.promises();
  const promisedFor = new Map(promises.filter((p) => p.answers && p.status !== "dismissed").map((p) => [`${p.chatId}|${p.answers}`, p.what]));
  const all = await plan.asks();
  const isHidden = (a: Ask) => a.status === "open" && a.sortStatus === "sorted" && a.sort?.kind === "none" && !a.shown;
  const shown = all.filter((a) => isHidden(a) || a.status === "open" || (a.resolvedAt && now - Date.parse(a.resolvedAt) < RESOLVED_SHOWN_MS));
  const views = await mapSeq(shown, async (a): Promise<(AskView & { hidden: boolean }) | null> => {
    const m = await plan.chatMessage(a.chatId, a.messageId);
    const chat = byId.get(a.chatId);
    if (!m) return null;
    const who = people(chat, home)(m.authorId, m.authorTenant);
    const s = a.sortStatus === "sorted" ? a.sort : null;
    let likely: AskView["likely"] = null;
    if (s?.likely && s.likely.confidence >= LIKELY_MIN) {
      const hit = (await items(a.clientKey))?.find((i) => i.id === s.likely!.id);
      likely = { id: s.likely.id, title: hit?.title ?? null, url: hit?.url ?? null };
    }
    return {
      chatId: a.chatId, messageId: a.messageId, clientKey: a.clientKey, clientName: name(a.clientKey), chatName: chat?.displayName ?? "A chat no longer registered",
      author: who.name, external: who.external, at: m.createdAt, text: m.text, hasImage: m.hasImage, hasFile: m.hasFile,
      matched: ruleLabel({ rule: a.rule, detail: a.ruleDetail }), status: a.status, item: a.itemId ? { id: a.itemId, url: a.itemUrl, title: a.itemTitle } : null, note: a.note, resolvedAt: a.resolvedAt,
      link: messageLink(a.chatId, a.messageId),
      sort: s ? { kind: s.kind, urgency: s.urgency, reason: s.reason, itemType: s.itemType, title: s.title } : null,
      likely,
      notSorted: a.sortStatus && a.sortStatus !== "sorted" ? notSortedText(a.sortStatus, name(a.clientKey)) : null,
      promised: promisedFor.get(`${a.chatId}|${a.messageId}`) ?? null,
      hidden: isHidden(a),
    };
  });
  const asks = views.filter((v): v is AskView & { hidden: boolean } => !!v);
  const strip = ({ hidden: _h, ...v }: AskView & { hidden: boolean }): AskView => v;
  const visible = asks.filter((a) => !a.hidden).map(strip);
  return {
    open: visible.filter((a) => a.status === "open").length,
    asks: visible,
    hidden: asks.filter((a) => a.hidden).map(strip),
    promisesOpen: promises.filter((p) => p.status === "open").length,
    chats: chats.filter((c) => c.asks?.on).map((c) => ({ clientKey: c.clientKey, clientName: name(c.clientKey), chatId: c.chatId, chatName: c.displayName, polledAt: c.asks!.polledAt, status: c.asks!.status, retryAt: c.asks!.retryAt })),
    writeClients: await ctx.writeClients().catch(() => []),
    pollMinutes: cfg.asks.pollMinutes,
  };
}

/** AP-2: the Promises tab: open ones, and handled ones for a day (with Undo). */
async function promiseList(ctx: AskContext, plan: PlanStore, cfg: AppConfig): Promise<PromisesData> {
  let all = await plan.promises();
  if (await closePromises(ctx, plan, cfg, all)) all = await plan.promises();
  const chats = new Map((await plan.deliveryChats()).map((c) => [c.chatId, c]));
  const name = (k: string) => cfg.clientSettings[k]?.name ?? k;
  const now = Date.parse(ctx.now());
  const shown = all.filter((p) => p.status === "open" || p.status === "followup" || p.status === "linked" || (p.resolvedAt && now - Date.parse(p.resolvedAt) < RESOLVED_SHOWN_MS));
  const views = await mapSeq(shown, async (p): Promise<PromiseView | null> => {
    const m = await plan.chatMessage(p.chatId, p.messageId);
    if (!m) return null;
    const answered = p.answers ? await plan.chatMessage(p.chatId, p.answers) : null;
    return {
      chatId: p.chatId, messageId: p.messageId, clientKey: p.clientKey, clientName: name(p.clientKey), chatName: chats.get(p.chatId)?.displayName ?? "A chat no longer registered",
      what: p.what, toWhom: p.toWhom, due: p.due, at: m.createdAt, text: m.text,
      answers: answered ? { messageId: answered.messageId, title: askTitle(answered.text) } : null,
      status: p.status, followUpId: p.followUpId, item: p.itemId ? { id: p.itemId, url: p.itemUrl, title: p.itemTitle } : null,
      notSorted: p.aiStatus && p.aiStatus !== "sorted" ? notSortedText(p.aiStatus, name(p.clientKey)) : null,
      reason: p.reason, resolvedAt: p.resolvedAt, link: messageLink(p.chatId, p.messageId),
    };
  });
  const promises = views.filter((v): v is PromiseView => !!v);
  const asksOpen = (await plan.asks()).filter((a) => a.status === "open" && !(a.sortStatus === "sorted" && a.sort?.kind === "none" && !a.shown)).length;
  return { open: promises.filter((p) => p.status === "open").length, promises, asksOpen, today: localToday(ctx.now(), userZone(cfg)) };
}

const ids = (o: Record<string, unknown>): { chatId: string; messageId: string } | null =>
  typeof o.chatId === "string" && CHAT_ID.test(o.chatId) && typeof o.messageId === "string" && MESSAGE_ID.test(o.messageId) ? { chatId: o.chatId, messageId: o.messageId } : null;

export async function askAction(ctx: AskContext, action: AskAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The plan store isn't available", 503);
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  try {
    switch (action) {
      case "asks.list": {
        if (!only(input, [])) return bad("asks.list takes {}");
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
      case "asks.refresh": {
        if (!only(input, [])) return bad("asks.refresh takes {}");
        await pollAsks(ctx, { force: true });
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
      case "asks.switch": {
        const o = only(input, ["chatId", "on"]);
        if (!o || typeof o.chatId !== "string" || !CHAT_ID.test(o.chatId) || typeof o.on !== "boolean") return bad("asks.switch takes { chatId, on }");
        const chat = (await plan.deliveryChats()).find((c) => c.chatId === o.chatId);
        if (!chat) return bad("That chat isn't registered for a client", 404);
        if (o.on && !chat.asks?.on) {
          // Each person allows Chat.Read for themselves the first time (D490): without it, nothing is switched on.
          if (!ctx.account?.chatMessages || !ctx.account.probe) return bad("Sign in with Microsoft to read your Teams chats", 409, "signed_out");
          const p = await ctx.account.probe("messages");
          if (p.state === "signed_out") return bad("Sign in with Microsoft to read your Teams chats", 409, "signed_out");
          if (p.state !== "granted") return bad("Allow FocusTime to read the messages in chats you register (Chat.Read). Microsoft asks you once", 409, "consent");
        }
        await plan.setAsksOn(o.chatId, o.on, ctx.now());
        ctx.log({ source: "plan", op: "asks_switch", kind: o.on ? "on" : "off" });
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
      case "asks.context": {
        const o = only(input, ["chatId", "messageId"]);
        const k = o && ids(o);
        if (!k) return bad("asks.context takes { chatId, messageId }");
        const m = await plan.chatMessage(k.chatId, k.messageId);
        if (!m || !(await plan.ask(k.chatId, k.messageId))) return bad("No such ask", 404);
        const chat = (await plan.deliveryChats()).find((c) => c.chatId === k.chatId);
        const who = people(chat, await ctx.homeTenant());
        const me = (await storedIdentity(plan))?.oid?.toLowerCase() ?? null;
        const before = await plan.messagesBefore(k.chatId, m.createdAt, CONTEXT_MESSAGES);
        const messages: ContextMessage[] = before.map((x: StoredMessage) => {
          const w = who(x.authorId, x.authorTenant);
          const mine = !!me && x.authorId?.toLowerCase() === me;
          return { messageId: x.messageId, author: mine ? "You" : w.name, external: w.external, mine, at: x.createdAt, text: x.text, hasImage: x.hasImage, hasFile: x.hasFile };
        });
        return { ok: true, data: { messages, chatLink: chat ? teamsLink(chat) : null } };
      }
      case "asks.resolve": {
        const o = only(input, ["chatId", "messageId", "status"], ["note", "itemId"]);
        const k = o && ids(o);
        if (!o || !k || !["linked", "handled", "dismissed"].includes(o.status as string)) return bad("asks.resolve takes { chatId, messageId, status: linked | handled | dismissed, note?, itemId? }");
        const status = o.status as "linked" | "handled" | "dismissed";
        if (o.note !== undefined && o.note !== null && (typeof o.note !== "string" || o.note.length > 1000)) return bad("note is text of at most 1000 characters");
        const ask = await plan.ask(k.chatId, k.messageId);
        if (!ask) return bad("No such ask", 404);
        let item: { itemId: number; itemUrl: string; itemTitle: string } | null = null;
        if (status === "linked") {
          if (typeof o.itemId !== "number" || !Number.isSafeInteger(o.itemId) || o.itemId <= 0) return bad("Link needs an itemId");
          const items = await ctx.openItems(cfg, ask.clientKey);
          if (!items) return bad(`DevOps couldn't be read for ${cfg.clientSettings[ask.clientKey]?.name ?? ask.clientKey}. Try again in a moment`, 503);
          const hit = items.find((i) => i.id === o.itemId);
          if (!hit) return bad("That isn't one of this client's open items", 404);
          item = { itemId: hit.id, itemUrl: hit.url, itemTitle: hit.title };
        }
        const note = typeof o.note === "string" && o.note.trim() ? o.note.trim() : null;
        // Idempotent: the same resolution again changes nothing.
        if (ask.status === status && (status !== "linked" || ask.itemId === item?.itemId)) return { ok: true, data: await list(ctx, plan, cfg) };
        await plan.resolveAsk(k.chatId, k.messageId, { status, ...(item ?? {}), note });
        ctx.log({ source: "plan", op: "ask_resolved", kind: status });
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
      case "asks.reopen": {
        const o = only(input, ["chatId", "messageId"]);
        const k = o && ids(o);
        if (!k) return bad("asks.reopen takes { chatId, messageId }");
        const ask = await plan.ask(k.chatId, k.messageId);
        if (!ask) return bad("No such ask", 404);
        if (ask.status === "created") return bad(`#${ask.itemId} was created in DevOps. Undo it from Settings > Data > Audit log; the ask opens again`, 409, "created");
        if (ask.status !== "open") {
          await plan.resolveAsk(k.chatId, k.messageId, { status: "open" });
          ctx.log({ source: "plan", op: "ask_reopened", kind: ask.status });
        }
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
      case "asks.search": {
        const o = only(input, ["chatId", "messageId"], ["query"]);
        const k = o && ids(o);
        if (!o || !k || (o.query !== undefined && (typeof o.query !== "string" || o.query.length > 200))) return bad("asks.search takes { chatId, messageId, query? }");
        // An ask's or (AP-2) a promise's client.
        const ask: Pick<Ask, "clientKey"> | null = (await plan.ask(k.chatId, k.messageId)) ?? (await plan.promise(k.chatId, k.messageId));
        if (!ask) return bad("No such ask", 404);
        const items = await ctx.openItems(cfg, ask.clientKey);
        if (!items) return { ok: true, data: { available: false, items: [] } };
        const q = String(o.query ?? "").trim().toLowerCase().replace(/^#/, "");
        const words = q.split(/\s+/).filter(Boolean);
        const hits = items.filter((i) => !q || String(i.id) === q || words.every((w) => i.title.toLowerCase().includes(w))).slice(0, 20);
        return { ok: true, data: { available: true, items: hits.map((i) => ({ id: i.id, title: i.title, type: i.type, state: i.state, url: i.url })) } };
      }
      case "asks.purge": {
        const o = only(input, ["clientKey"]);
        if (!o || typeof o.clientKey !== "string" || !o.clientKey || o.clientKey.length > 100) return bad("asks.purge takes { clientKey }");
        const n = await plan.purgeChatText({ clientKey: o.clientKey });
        ctx.log({ source: "plan", op: "asks_purged", count: n });
        return { ok: true, data: { ...(await list(ctx, plan, cfg)), purged: n } };
      }
      case "asks.sort_again": {
        const o = only(input, ["chatId", "messageId"]);
        const k = o && ids(o);
        if (!k) return bad("asks.sort_again takes { chatId, messageId }");
        const ask = await plan.ask(k.chatId, k.messageId);
        if (!ask) return bad("No such ask", 404);
        if (ask.status !== "open") return bad("This ask is already resolved", 409);
        const ai = ctx.ai ? await ctx.ai() : null;
        if (!ai) return bad("AI isn't available here", 409);
        const me = (await storedIdentity(plan))?.oid ?? null;
        const r = await classifyAsk({ plan, ai: async () => ai, homeTenant: await ctx.homeTenant(), me, openItems: ctx.openItems }, cfg, ask);
        ctx.log({ source: "plan", op: "ask_sorted", kind: r?.status ?? "none" });
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
      case "asks.show": {
        const o = only(input, ["chatId", "messageId", "shown"]);
        const k = o && ids(o);
        if (!o || !k || typeof o.shown !== "boolean") return bad("asks.show takes { chatId, messageId, shown }");
        if (!(await plan.ask(k.chatId, k.messageId))) return bad("No such ask", 404);
        await plan.setAskShown(k.chatId, k.messageId, o.shown);
        return { ok: true, data: await list(ctx, plan, cfg) };
      }
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
        // The existing follow-up model: who, what, the channel (that chat is in Teams), the due date.
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
  } catch (e) {
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
