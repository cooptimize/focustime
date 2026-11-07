// CV-1: Inbox › Conversations and My promises, the person's view of what the pipeline (actions/conversations-pipeline.ts)
// keeps for everyone. A chat, its conversations, commitments and suggestions are shown only to a member of that chat
// (the stores' viewers, D521) who follows its client. Three views: Needs you (new ones on my clients, ones that
// @mention me, ones I'm on or committed to, and unclaimed ones on clients I lead), Handled by teammates (collapsed,
// one line each: visible on purpose) and Closed. Hide for me is mine alone; Not a request, Resolve, Reopen, Move,
// Split, This is work, Link and Take it over are shared, by name. Nothing resolves by itself: a quiet conversation
// after thanks only suggests "Looks wrapped up. Resolve?". The DevOps draft for a commitment is made when its
// committer opens it (their own cap); creating and commenting go through the write framework. Chat text goes only to
// that client's cards, never a log or an error (ids and counts only, and not even ids in logs).
import { whoNotOwner } from "../plan/follow-who.ts";
import { CLOSE_HOW, type CloseHow } from "../plan/types.ts";
import { IS_WORK_PLACE } from "../plan/diagnostics.ts";
import { groupingRules } from "./conversations-pipeline.ts";
import { likelyItems } from "../plan/promise-items.ts";
import { typeChoices } from "./work-item-types.ts";
import type { ProcessModel } from "../plan/process.ts";
import type { AiService } from "../ai/service.ts";
import { AiError } from "../ai/types.ts";
import type { AppConfig } from "../config/schema.ts";
import { askTitle, messageLink } from "../plan/asks.ts";
import { CHAT_ID, isExternal, teamsLink } from "../plan/chats.ts";
import { DRAFT_INSTRUCTIONS, DRAFT_SCHEMA, DRAFT_TASK, draftFrom, draftInput, emptyDraft, type DraftAnswer } from "../plan/conversation-draft.ts";
import { isClosed } from "../plan/process.ts";
import { chatImageSrc, type CardCommitment, type CardItem, type CardSuggestion, type ConversationCard, type ConversationMessage, type ConversationsData, type DayPromise, type MessageImageView, type MyPromisesData, type Primary, type PromiseCard } from "../plan/conversation-views.ts";
import { daysWaiting, oneLine, statusLine, unsortedLine, unsortedText, type Commitment, type UnsortedLine, type Conversation, type ItemDraft } from "../plan/conversations.ts";
import type { ClientChat, FocusUser } from "../plan/requests.ts";
import { hostedImageIds, sanitizeMessageHtml } from "../plan/sanitize.ts";
import type { MessageImage } from "../store/teams-store.ts";
import { joinedSummary, MERGE_INSTRUCTIONS, MERGE_SCHEMA, MERGE_TASK, mergeFrom, mergeInput, type MergeAnswer } from "../plan/conversation-merge.ts";
import { isMeetingChat, type ConversationStore, type ConversationView } from "../store/conversation-store.ts";
import { PlanError } from "../store/plan-store.ts";
import { itemKey, type InboxFacts } from "../plan/inbox-items.ts";
import type { TeamsView } from "../store/teams-store.ts";
import { localToday } from "../week/dates.ts";
import type { WorkItem } from "../week/types.ts";
import { userZone } from "../week/zone.ts";
import { batchOf, CHAT_DAILY_AI_CALLS, participantOf, refreshStatus, runPipeline, withParticipants } from "./conversations-pipeline.ts";
import { backfillPromises } from "./conversation-backfill.ts";
import { visibleChats, type RequestContext } from "./request-actions.ts";
import type { ConversationPerson } from "./people-picker.ts";
import { personRef, type PersonRef } from "../plan/person-ref.ts";
import { mapSeq } from "./seq.ts";
import { mergePreview, type MergeSide } from "../plan/merge-preview.ts";
import type { ActionResponse } from "./types.ts";

export type { ConversationCard, ConversationMessage, ConversationsData, DayPromise, MyPromisesData, PromiseCard } from "../plan/conversation-views.ts";

export const CONVERSATION_ACTIONS = [
  "conversations.list", "conversations.count", "conversations.refresh", "conversations.messages", "conversations.seen", "conversations.resolve", "conversations.not_request", "conversations.not_work", "conversations.not_work_undo", "conversations.reopen",
  "conversations.hide", "conversations.move", "conversations.this_is_work", "conversations.link", "conversations.take_over", "conversations.sort_unsorted", "conversations.search",
  "conversations.draft", "my_promises.list", "my_promises.today", "my_promises.link", "my_promises.done", "my_promises.not_needed", "my_promises.reopen",
  // IB-1: a promise is never read-only: its due, whom it is to, and Close the loop.
  "my_promises.due", "my_promises.who", "my_promises.close",
  "suggestions.skip", "conversations.merge", "conversations.unmerge", "conversations.merge_preview", "my_promises.start_draft",
  "my_promises.search",
  // CV-5: Link to item over the client's items in scope, and its undo.
  "conversations.search_items", "conversations.unlink", "my_promises.unlink",
] as const;
export type ConversationAction = (typeof CONVERSATION_ACTIONS)[number];
/** QF-1: the close reason of Not work-related, and the mark on its messages' places (so Undo finds them). */
export const NOT_WORK = "Not work-related";
const NOT_WORK_PLACE = "not_work:";

export type ConversationContext = RequestContext & {
  conversations?: ConversationStore | undefined;
  /** Whether I lead this client: Dataverse's leads with admins' overrides (actions/client-lead.ts, ADM-1). */
  isLead: (clientKey: string) => Promise<boolean>;
  /** IB-1: whether I'm a FocusTime admin (Mark as a Social chat). */
  isAdmin?: () => Promise<boolean>;
  /** The FocusTime users (for Sort unsorted's own promises). */
  users: () => Promise<FocusUser[]>;
  /** The pipeline's AI for Sort unsorted: my switches, the app's cap. */
  pipelineAi?: () => Promise<AiService | null>;
  /** The email my DevOps identity uses for a client (to spot an item I changed since I committed). */
  devopsEmail?: (clientKey: string) => Promise<string | null>;
  /** WT-1: the client's process model (levels, valid children, the most common child), or null when it can't be read. */
  processModel?: (cfg: AppConfig, clientKey: string) => Promise<ProcessModel | null>;
  /**
   * CV-5: the client's open items in Cooptimize's scope from the central store (AH-2; mine always), by #id or title
   * words ("" for all of them), or null when the store can't say now. Without it, the open items Week reads.
   */
  searchItems?: (cfg: AppConfig, clientKey: string, query: string) => Promise<WorkItem[] | null>;
  /** CV-5: linked items as the store has them now, in any state (state, assignee, last change); null when it can't say. */
  linkedItems?: (cfg: AppConfig, clientKey: string, ids: readonly number[]) => Promise<WorkItem[] | null>;
  /**
   * MC-1: the registered meetings' "chats" (`meeting:<series id>`, one per active series, named for the call) where
   * promises and Waiting on from a meeting live. Never polled, never a Teams chat; only my own commitments show.
   */
  meetingChats?: () => Promise<ClientChat[]>;
};

/** Closed ones stay visible this long by default; the live value is the Rule conv.closed_shown_days (D604). */
const CLOSED_SHOWN_DAYS = 14;
/** How long ago a conversation may have closed and still be listed (and counted). */
const closedShownMs = (cfg: AppConfig) => (cfg.org?.rules.closedShownDays ?? CLOSED_SHOWN_DAYS) * 24 * 3600_000;
const DONE_SHOWN_MS = 24 * 3600_000;

const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });
const only = (input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null => {
  const o = input === undefined || input === null ? {} : input;
  if (typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (Object.keys(r).some((k) => !required.includes(k) && !optional.includes(k))) return null;
  if (required.some((k) => r[k] === undefined)) return null;
  return r;
};
const posInt = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);
const MESSAGE_ID = /^[0-9A-Za-z._-]{1,100}$/;
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const first = (n: string | null | undefined) => (n ?? "").split(/\s+/)[0] || "Someone";

/** `promiseChatIds`: the chats my promises and Waiting on come from: my registered chats plus MC-1's meeting chats. */
export type Seen = { teams: TeamsView; convs: ConversationView; me: string; chats: ClientChat[]; byId: Map<string, ClientChat>; store: ConversationStore; promiseChatIds: string[] };
export async function seen(ctx: ConversationContext): Promise<Seen | null> {
  const port = ctx.requests;
  const store = ctx.conversations;
  const me = await ctx.me();
  if (!port || !store || !me) return null;
  const teams = port.teams.viewer(me);
  const chats = await visibleChats(teams, await ctx.followed().catch(() => null));
  const meetings = ctx.meetingChats ? await ctx.meetingChats().catch((): ClientChat[] => []) : [];
  return { teams, convs: store.viewer(me), me, chats, byId: new Map([...chats, ...meetings].map((c) => [c.chatId, c])), store, promiseChatIds: [...chats, ...meetings].map((c) => c.chatId) };
}

/**
 * CV-2: the people of a conversation (or, for a promise with none, the people of its own messages and the one it was
 * made to) for the PersonPicker, only from a chat I'm in and whose client I follow; null otherwise.
 */
export async function conversationPeople(ctx: ConversationContext, q: { conversationId?: number; commitmentId?: number }): Promise<ConversationPerson[] | null> {
  const v = await seen(ctx);
  if (!v) return null;
  const home = await ctx.homeTenant();
  let conversation: Conversation | null = null;
  let around: { chatId: string; ids: string[] } | null = null;
  if (q.commitmentId !== undefined) {
    const k = await v.convs.commitment(q.commitmentId);
    if (!k || !v.byId.has(k.chatId)) return null;
    if (k.conversationId) conversation = await v.convs.conversation(k.conversationId);
    else {
      const senders = [];
      for (const id of k.messageIds) senders.push((await v.teams.message(k.chatId, id))?.senderId ?? null);
      around = { chatId: k.chatId, ids: [...senders, k.toId].filter((x): x is string => !!x) };
    }
  } else if (q.conversationId !== undefined) conversation = await v.convs.conversation(q.conversationId);
  const chat = v.byId.get(conversation?.chatId ?? around?.chatId ?? "");
  if (!chat) return null;
  const member = (id: string) => chat.members?.find((m) => same(m.userId, id));
  const out: ConversationPerson[] = conversation
    ? conversation.participants.map((p) => ({ id: p.id, name: p.name, external: home ? p.external : false, email: p.external ? null : (member(p.id)?.email?.toLowerCase() ?? null) }))
    : (around?.ids ?? []).flatMap((id) => {
        const m = member(id);
        if (!m?.displayName) return [];
        const external = home ? isExternal(m, home) : false;
        return [{ id, name: m.displayName, external, email: external ? null : (m.email?.toLowerCase() ?? null) }];
      });
  return out.filter((p) => !same(p.id, v.me));
}

/** CV-5: what Link to item, "Looks like" and the draft's parents choose from: the client's open items in scope. */
async function linkable(ctx: ConversationContext, cfg: AppConfig, k: string): Promise<WorkItem[] | null> {
  // Without the central store (the developer loop), the open items Week reads.
  const scoped = ctx.searchItems ? await ctx.searchItems(cfg, k, "").catch(() => null) : null;
  return scoped ?? (await ctx.openItems(cfg, k).catch(() => null));
}

/** CV-5: the search Link to item runs: an exact #id, else every title word. */
function matching(items: readonly WorkItem[], query: string, max = 20): WorkItem[] {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  const words = q.split(/\s+/).filter(Boolean);
  return items.filter((i) => !q || String(i.id) === q || words.every((w) => i.title.toLowerCase().includes(w))).slice(0, max);
}

/** A client's open items once per list (for Link and "Looks like"); null when DevOps couldn't be read. */
function itemsOnce(ctx: ConversationContext, cfg: AppConfig) {
  const memo = new Map<string, Promise<WorkItem[] | null>>();
  return (k: string) => memo.get(k) ?? memo.set(k, linkable(ctx, cfg, k)).get(k)!;
}

/** CV-5: the linked items of these rows, once per client, as the store has them now (any state). */
async function liveItems(ctx: ConversationContext, cfg: AppConfig, rows: readonly { clientKey: string; itemId: number | null }[]): Promise<Map<string, WorkItem>> {
  const out = new Map<string, WorkItem>();
  if (!ctx.linkedItems) return out;
  const by = new Map<string, number[]>();
  for (const r of rows) if (r.itemId) by.set(r.clientKey, [...(by.get(r.clientKey) ?? []), r.itemId]);
  for (const [k, ids] of by) for (const i of (await ctx.linkedItems(cfg, k, ids).catch(() => null)) ?? []) out.set(`${k}:${i.id}`, i);
  return out;
}

/** CV-5: a link as the card shows it, with its live state when the store has the item. */
function withLive(item: CardItem | null, hit: WorkItem | undefined): CardItem | null {
  if (!item || !hit) return item;
  return { ...item, title: item.title ?? hit.title, url: item.url ?? hit.url, state: hit.state, assignee: hit.assignedTo ?? null, changedAt: hit.changedAt, closed: isClosed(hit.stateCategory) };
}

/**
 * CV-5: whether FocusTime created this item from this conversation or promise (a confirmed create, not undone): its
 * undo is the audit log's (it sets the item to Removed), never Unlink.
 */
async function createdHere(ctx: ConversationContext, itemId: number, o: { conversationId: number | null; commitmentId: number | null }): Promise<boolean> {
  if (!ctx.plan) return false;
  const log = await ctx.plan.devopsWriteLog(1000).catch(() => []);
  return log.some((e) => e.op === "create" && e.status === "confirmed" && e.undoneBy === null && e.itemId === itemId && !!e.conv && ((o.conversationId !== null && e.conv.conversationId === o.conversationId) || (o.commitmentId !== null && e.conv.commitmentId === o.commitmentId)));
}

/**
 * CV-5's one-time move (D540/D548 superseded): my promises "Kept by #id" whose item is still open become open with that
 * item linked; the ones whose item closed (or that the store doesn't have) stay kept. Done once per person, when DevOps
 * could answer for every client involved.
 */
const KEPT_MOVED = "cv5_kept_reopened";
async function reopenKept(ctx: ConversationContext, cfg: AppConfig, v: Seen): Promise<void> {
  if (!ctx.plan || !ctx.linkedItems || (await ctx.plan.accountState<boolean>(KEPT_MOVED))) return;
  const kept = (await v.convs.commitmentsBy(v.promiseChatIds)).filter((k) => (k.state === "linked" || k.state === "created") && k.itemId && same(k.whoId, v.me));
  const by = new Map<string, Commitment[]>();
  for (const k of kept) by.set(k.clientKey, [...(by.get(k.clientKey) ?? []), k]);
  let reopened = 0;
  for (const [clientKey, ks] of by) {
    const items = await ctx.linkedItems(cfg, clientKey, ks.map((k) => k.itemId!)).catch(() => null);
    if (!items) return; // DevOps can't say now: try again next time, nothing changed for this client yet
    for (const k of ks) {
      const hit = items.find((i) => i.id === k.itemId);
      if (hit && !isClosed(hit.stateCategory)) {
        await v.convs.updateCommitment(k.id, { state: "open" });
        reopened++;
      }
    }
  }
  await ctx.plan.setAccountState(KEPT_MOVED, true);
  ctx.log({ source: "plan", op: "promises_kept_reopened", count: reopened });
}
const cardItem = (id: number | null, items: readonly WorkItem[] | null, url?: string | null, title?: string | null): CardItem | null => {
  if (!id) return null;
  const hit = items?.find((i) => i.id === id);
  return { id, title: title ?? hit?.title ?? null, url: url ?? hit?.url ?? null };
};

/** The commitment that makes a conversation wait: open, implies an item, past its escalation time. */
const waitingOf = (cs: readonly Commitment[]) => cs.find((k) => k.state === "open" && k.impliesItem && !k.itemId && !!k.escalatedAt) ?? null;

async function cards(ctx: ConversationContext, v: Seen, cfg: AppConfig, list: readonly Conversation[]): Promise<ConversationCard[]> {
  const home = await ctx.homeTenant();
  const views = ctx.plan ? await ctx.plan.conversationViews() : new Map();
  const ids = list.map((c) => c.id);
  const [commitments, suggestions, places] = await Promise.all([v.convs.commitmentsIn(ids), v.convs.suggestionsIn(ids), v.convs.placesIn(ids.filter((id) => !list.find((c) => c.id === id)?.closedAt))]);
  const items = itemsOnce(ctx, cfg);
  const live = await liveItems(ctx, cfg, list);
  const writeClients = await ctx.writeClients().catch((): string[] => []);
  const name = (k: string) => cfg.clientSettings[k]?.name ?? k;
  const now = ctx.now();
  return mapSeq(list, async (c): Promise<ConversationCard> => {
    const chat = v.byId.get(c.chatId);
    const cs = commitments.filter((k) => k.conversationId === c.id);
    const view = views.get(c.id);
    // Mentions of me in its work messages.
    let mentionsMe = false;
    let images = 0;
    const withImages: string[] = [];
    for (const p of places.filter((x) => x.conversationId === c.id && x.role === "work")) {
      const m = await v.teams.message(p.chatId, p.messageId);
      if (m?.mentions.some((x) => same(x.id, v.me))) mentionsMe = true;
      const n = hostedImageIds(m?.html ?? null).length;
      images += n;
      if (n) withImages.push(p.messageId);
    }
    // CV-4: the first described image's words, for the card (the AI's, seen only by members of the chat).
    const described = withImages.length ? (await v.teams.images(c.chatId, withImages)).find((i) => i.description)?.description ?? null : null;
    const wait = waitingOf(cs);
    const waiting = wait ? { name: first(wait.whoName), days: daysWaiting(wait.escalatedAt!, now) } : null;
    const openMine = cs.find((k) => k.state === "open" && same(k.whoId, v.me));
    const committer = cs.find((k) => k.state === "open") ?? null;
    const its = c.itemId || c.likelyItem ? await items(c.clientKey) : null;
    const canCreate = writeClients.includes(c.clientKey);
    const closed = c.closedAt && (c.status === "resolved" || c.status === "closed")
      ? { kind: c.status === "resolved" ? ("resolved" as const) : ("not_request" as const), by: same(c.closedBy, v.me) ? "you" : (chat?.members?.find((m) => same(m.userId, c.closedBy))?.displayName ?? "someone at Cooptimize"), at: c.closedAt, reason: c.closeReason }
      : null;
    // CV-5: Create DevOps item is offered on every conversation without an item (under ⋯ when it isn't the primary),
    // with or without my write access (the form says how to turn writes on). A linked item that closed asks Mark done.
    const item = withLive(cardItem(c.itemId, its, c.itemUrl, c.itemTitle), c.itemId ? live.get(`${c.clientKey}:${c.itemId}`) : undefined);
    let primary: Primary | null;
    if (closed) primary = "reopen";
    else if (item?.closed) primary = "mark_done";
    else if (wait && !same(wait.whoId, v.me)) primary = "take_over";
    else if (openMine?.impliesItem && !c.itemId) primary = "create";
    else if (!c.itemId && c.likelyItem) primary = "link";
    else if (!c.itemId && !c.windDown) primary = "create";
    else primary = "resolve";
    const fromInternal = chat?.kind === "delivery";
    return {
      id: c.id, clientKey: c.clientKey, clientName: name(c.clientKey), chatId: c.chatId, chatName: chat?.displayName ?? "A chat no longer registered", internalChat: fromInternal,
      title: c.title, summary: c.summary, status: c.status, statusLine: statusLine(c, committer ? first(committer.whoName) : null, waiting), lastAt: c.lastAt,
      participants: c.participants.map((p) => ({ name: p.name, external: home ? p.external : false, me: same(p.id, v.me) })),
      // Changed since I last looked (never looked: new to me), not for closed ones I haven't opened.
      updated: (!view && !c.closedAt) || (view && view.seenVersion < c.version) ? (c.changeNote ?? "Updated") : null,
      windDown: c.windDown && !closed,
      item,
      likely: c.itemId ? null : cardItem(c.likelyItem, its),
      waiting, unclaimed: !!wait && !wait.takenBy, owner: c.ownerId ? (c.participants.find((p) => same(p.id, c.ownerId))?.name ?? null) : null, mentionsMe,
      commitments: cs.map((k): CardCommitment => ({ id: k.id, whoName: k.whoName, mine: same(k.whoId, v.me), what: k.what, dueAt: k.dueAt, dueDate: k.dueDate, state: k.state, impliesItem: k.impliesItem, item: cardItem(k.itemId, null, k.itemUrl, k.itemTitle) })),
      suggestions: suggestions.filter((s) => s.conversationId === c.id && s.state === "open").map((s): CardSuggestion => ({ id: s.id, kind: s.kind, itemId: s.itemId, body: s.body, internal: s.internal, fromInternalChat: fromInternal, mine: same(s.forUser, v.me) })),
      closed, hidden: !!view?.hidden, primary, canCreate, link: chat ? teamsLink(chat) : messageLink(c.chatId, places.find((p) => p.conversationId === c.id)?.messageId ?? "0"),
      ...(images ? { images } : {}),
      ...(described ? { imageNote: described } : {}),
    };
  });
}

/** Which view a card belongs to for me. */
async function viewOf(ctx: ConversationContext, me: string, card: ConversationCard, c: Conversation): Promise<"needs" | "progress" | "teammates" | "closed"> {
  if (card.closed) return "closed";
  // CV-5: a linked item moves it to In progress (a suggestion for me still needs me).
  if (card.item && !card.suggestions.some((s) => s.mine)) return "progress";
  if (card.status === "new" || card.mentionsMe || same(c.ownerId, me) || card.commitments.some((k) => k.mine && k.state === "open") || card.suggestions.some((s) => s.mine)) return "needs";
  if (card.unclaimed && (await ctx.isLead(c.clientKey).catch(() => false))) return "needs";
  return "teammates";
}

async function list(ctx: ConversationContext, cfg: AppConfig, select: number | null = null): Promise<ConversationsData> {
  const empty: ConversationsData = { needsYou: [], inProgress: [], teammates: [], closed: [], hiddenCount: 0, unsorted: { count: 0, reasons: [] }, chatter: [], myPromisesOpen: 0, lastPoll: null, writeClients: [] };
  const v = await seen(ctx);
  if (!v) return empty;
  const now = Date.parse(ctx.now());
  const shownMs = closedShownMs(cfg);
  const all = (await v.convs.conversations(v.chats.map((c) => c.chatId))).filter((c) => !c.closedAt || now - Date.parse(c.closedAt) < shownMs);
  const built = await cards(ctx, v, cfg, all);
  const out: ConversationsData = { ...empty, writeClients: await ctx.writeClients().catch((): string[] => []) };
  for (const card of built) {
    if (card.hidden) {
      out.hiddenCount++;
      continue;
    }
    const where = await viewOf(ctx, v.me, card, all.find((c) => c.id === card.id)!);
    (where === "needs" ? out.needsYou : where === "progress" ? out.inProgress : where === "teammates" ? out.teammates : out.closed).push(card);
  }
  // Needs you: waiting and unclaimed first, then mine, then newest.
  const rank = (c: ConversationCard) => (c.unclaimed ? 0 : c.commitments.some((k) => k.mine && k.state === "open") ? 1 : c.mentionsMe ? 2 : 3);
  out.needsYou.sort((a, b) => rank(a) - rank(b) || Date.parse(b.lastAt) - Date.parse(a.lastAt));
  // In progress: a closed item (Mark done) first, then the latest.
  out.inProgress.sort((a, b) => Number(!!b.item?.closed) - Number(!!a.item?.closed) || Date.parse(b.lastAt) - Date.parse(a.lastAt));
  const unsorted = await v.convs.placesByRole(v.chats.map((c) => c.chatId), "unsorted");
  const reasons = new Map<string, { line: UnsortedLine; count: number }>();
  for (const p of unsorted) {
    const line = unsortedLine(p.reason, cfg.clientSettings[v.byId.get(p.chatId)?.clientKey ?? ""]?.name ?? "this client");
    const r = reasons.get(line.text);
    reasons.set(line.text, { line, count: (r?.count ?? 0) + 1 });
  }
  out.unsorted = { count: unsorted.length, reasons: [...reasons.values()].map(({ line, count }) => ({ text: line.text, count, does: line.does, fix: line.fix })) };
  const chatter = await v.convs.placesByRole(v.chats.map((c) => c.chatId), "chatter");
  const home = await ctx.homeTenant();
  const byClient = new Map<string, ConversationsData["chatter"][number]>();
  for (const p of chatter.slice(-200).reverse()) {
    const chat = v.byId.get(p.chatId);
    const m = chat ? await v.teams.message(p.chatId, p.messageId) : null;
    if (!chat || !m || !m.text.trim()) continue;
    const g = byClient.get(chat.clientKey) ?? { clientKey: chat.clientKey, clientName: cfg.clientSettings[chat.clientKey]?.name ?? chat.clientKey, messages: [] };
    g.messages.push({ chatId: p.chatId, messageId: p.messageId, author: same(m.senderId, v.me) ? "You" : batchOf(m, chat, home).senderName ?? "Someone", at: m.createdAt, text: m.text.slice(0, 400) });
    byClient.set(chat.clientKey, g);
  }
  out.chatter = [...byClient.values()];
  // IB-1 slice 3: the Chatter pane's chat facts (name, Teams link, Social) and whether I may mark a Social chat.
  out.chats = v.chats.map((c) => ({ chatId: c.chatId, name: c.displayName, link: teamsLink(c), social: !!c.social }));
  out.admin = (await ctx.isAdmin?.().catch(() => false)) ?? false;
  out.myPromisesOpen = (await v.convs.commitmentsBy(v.promiseChatIds)).filter((k) => k.state === "open").length;
  out.pollMinutes = cfg.org?.rules.pollMinutes ?? 5;
  // CV-2: a deep link (#/inbox/conversation/<id>): the one to select, following a merge to where it went now.
  if (select !== null) {
    let c = await v.convs.conversation(select);
    for (let hops = 0; c?.mergedInto && hops < 5; hops++) c = await v.convs.conversation(c.mergedInto);
    const listed = c && v.byId.has(c.chatId) ? [...out.needsYou, ...out.inProgress, ...out.teammates, ...out.closed].find((x) => x.id === c!.id) : undefined;
    out.selected = listed ? { id: listed.id, found: true, where: out.needsYou.includes(listed) ? "needs" : out.inProgress.includes(listed) ? "progress" : out.teammates.includes(listed) ? "teammates" : "closed" } : { id: select, found: false, where: null };
  }
  out.lastPoll = v.chats.map((c) => c.polledAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return out;
}

/**
 * NV-1: the Inbox badge's count only: how many conversations need me (the same rule as Needs you) and my open
 * promises. Reads what list reads for the cards; no unsorted, chatter or write-access lookups, no card text returned.
 */
async function counts(ctx: ConversationContext, cfg: AppConfig): Promise<{ needsYou: number; myPromisesOpen: number }> {
  const v = await seen(ctx);
  if (!v) return { needsYou: 0, myPromisesOpen: 0 };
  const now = Date.parse(ctx.now());
  const all = (await v.convs.conversations(v.chats.map((c) => c.chatId))).filter((c) => !c.closedAt || now - Date.parse(c.closedAt) < closedShownMs(cfg));
  let needsYou = 0;
  for (const card of await cards(ctx, v, cfg, all)) if (!card.hidden && (await viewOf(ctx, v.me, card, all.find((c) => c.id === card.id)!)) === "needs") needsYou++;
  const myPromisesOpen = (await v.convs.commitmentsBy(v.promiseChatIds)).filter((k) => k.state === "open").length;
  return { needsYou, myPromisesOpen };
}

/**
 * IB-1: the Inbox's facts from conversations and my chat promises, by the same rules as Needs you and My promises
 * (viewOf, the open states). Conversations I hid stay out (Hide for me lives in conversation_views). No card text.
 */
export async function inboxFacts(ctx: ConversationContext, cfg: AppConfig): Promise<InboxFacts[]> {
  const v = await seen(ctx);
  if (!v) return [];
  const now = Date.parse(ctx.now());
  const all = (await v.convs.conversations(v.chats.map((c) => c.chatId))).filter((c) => !c.closedAt || now - Date.parse(c.closedAt) < closedShownMs(cfg));
  const out: InboxFacts[] = [];
  // QF-1: a conversation marked not work-related lives in Chatter (its messages), not in Done.
  for (const card of await cards(ctx, v, cfg, all.filter((c) => !(c.closedAt && c.closeReason === NOT_WORK)))) {
    if (card.hidden) continue;
    const view = await viewOf(ctx, v.me, card, all.find((c) => c.id === card.id)!);
    // Who it is with: someone in it who isn't me.
    const asker = card.participants.find((p) => !p.me)?.name ?? null;
    const c = all.find((x) => x.id === card.id)!;
    const workRequest = !card.item && card.primary === "create";
    // Slice 3: why it needs me, from CV-1's own facts (the order viewOf checks them in).
    const needsWhy = view !== "needs" ? null
      : card.mentionsMe ? "mention"
      : card.commitments.some((k) => k.mine && k.state === "open") ? "committed"
      : card.suggestions.some((x) => x.mine) ? "suggestion"
      : same(c.ownerId, v.me) ? "owner"
      : card.unclaimed ? "unclaimed"
      : card.windDown ? "wrapped"
      : workRequest ? "work"
      : "new";
    out.push({
      key: itemKey("conversation", card.id), kind: "conversation", clientKey: card.clientKey, at: card.lastAt, done: view === "closed", conversationView: view,
      title: card.title, who: asker, where: card.chatName, itemId: card.item?.id ?? null, mentionsMe: card.mentionsMe,
      workRequest, needsWhy,
    });
  }
  // Slice 3, Waiting on: someone else's open commitment made to me, or in a conversation I own.
  const owned = new Map(all.map((c) => [c.id, same(c.ownerId, v.me)]));
  const ownedIds = all.filter((c) => same(c.ownerId, v.me)).map((c) => c.id);
  const theirs = new Map<number, Awaited<ReturnType<typeof v.convs.commitmentsIn>>[number]>();
  for (const k of [...(await v.convs.commitmentsTo(v.promiseChatIds)), ...(await v.convs.commitmentsIn(ownedIds))]) theirs.set(k.id, k);
  for (const k of theirs.values()) {
    if (k.state !== "open" || same(k.whoId, v.me) || !(same(k.toId, v.me) || (k.conversationId !== null && owned.get(k.conversationId)))) continue;
    out.push({
      key: itemKey("chatPromise", k.id), kind: "commitment", clientKey: k.clientKey, at: k.updatedAt ?? k.createdAt, done: false, waitingOn: true,
      due: k.dueDate ?? (k.dueAt ? localToday(k.dueAt, userZone(cfg)) : null), dueAt: k.dueAt,
      title: k.what, who: k.whoName, where: v.byId.get(k.chatId)?.displayName ?? null, itemId: k.itemId,
    });
  }
  for (const k of await v.convs.commitmentsBy(v.promiseChatIds)) {
    // A promise made into a follow-up before IB-1 shows once, as that follow-up (f<id>).
    if (k.state === "followup" && k.followUpId !== null) continue;
    const done = k.state === "done" || k.state === "not_needed";
    if (done && (!k.updatedAt || now - Date.parse(k.updatedAt) >= DONE_SHOWN_MS)) continue;
    out.push({
      key: itemKey("chatPromise", k.id), kind: "promise", clientKey: k.clientKey, at: k.updatedAt ?? k.createdAt, done,
      due: k.dueDate ?? (k.dueAt ? localToday(k.dueAt, userZone(cfg)) : null), dueAt: k.dueAt, linked: k.itemId !== null, onWeek: !!k.onToday,
      title: k.what, who: k.toName, where: v.byId.get(k.chatId)?.displayName ?? null, itemId: k.itemId, fromChat: true,
    });
  }
  return out;
}

// ---- My promises ----

/** CV-2: whom a promise was made to, as the PersonPicker refers to them (a Cooptimizer by Entra id, else a chat member). */
function toRefOf(k: Commitment, chat: ClientChat | undefined, home: string | null): PersonRef | null {
  if (!k.toId || !k.toName) return null;
  const m = chat?.members?.find((x) => same(x.userId, k.toId));
  const external = m ? (home ? isExternal(m, home) : false) : false;
  return external ? { kind: "external", memberId: k.toId.toLowerCase(), name: k.toName } : { kind: "cooptimizer", id: k.toId.toLowerCase(), name: k.toName };
}

async function promiseCards(ctx: ConversationContext, v: Seen, cfg: AppConfig): Promise<PromiseCard[]> {
  const now = ctx.now();
  const home = await ctx.homeTenant();
  const zone = userZone(cfg);
  const today = localToday(now, zone);
  const mine = (await v.convs.commitmentsBy(v.promiseChatIds)).filter((k) => !["done", "not_needed"].includes(k.state) || (k.updatedAt && Date.parse(now) - Date.parse(k.updatedAt) < DONE_SHOWN_MS));
  const convIds = [...new Set(mine.map((k) => k.conversationId).filter((x): x is number => x !== null))];
  const convs = new Map((await v.convs.conversations(v.chats.map((c) => c.chatId))).filter((c) => convIds.includes(c.id)).map((c) => [c.id, c]));
  const suggestions = (await v.convs.suggestionsIn(convIds)).filter((s) => s.state === "open" && same(s.forUser, v.me));
  const items = itemsOnce(ctx, cfg);
  const live = await liveItems(ctx, cfg, mine);
  return mapSeq(mine, async (k): Promise<PromiseCard> => {
    const chat = v.byId.get(k.chatId);
    const c = k.conversationId !== null ? convs.get(k.conversationId) : undefined;
    const msgs: { at: string; text: string }[] = [];
    for (const id of k.messageIds) {
      const m = await v.teams.message(k.chatId, id);
      if (m && same(m.senderId, v.me)) msgs.push({ at: m.createdAt, text: m.text });
    }
    const needsItem = k.impliesItem && k.state === "open" && !k.itemId;
    let likely: CardItem | null = null;
    if (needsItem) {
      const its = await items(k.clientKey);
      const email = ctx.devopsEmail ? await ctx.devopsEmail(k.clientKey).catch(() => null) : null;
      const hit = c?.likelyItem ? its?.find((i) => i.id === c.likelyItem) : its?.filter((i) => (i.assignedToMe || (email && same(i.assignedToEmail, email))) && Date.parse(i.changedAt) >= Date.parse(k.createdAt)).sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0];
      if (hit) likely = { id: hit.id, title: hit.title, url: hit.url };
    }
    const due = k.dueDate ?? k.onToday;
    const toRef = toRefOf(k, chat, home);
    return {
      id: k.id, conversationId: k.conversationId, toRef, conversationTitle: c?.title ?? null, clientKey: k.clientKey, clientName: cfg.clientSettings[k.clientKey]?.name ?? k.clientKey, chatName: chat?.displayName ?? "A chat no longer registered",
      what: k.what, toName: k.toName, dueAt: k.dueAt, dueDate: k.dueDate, overdue: k.state === "open" && (k.dueAt ? Date.parse(k.dueAt) < Date.parse(now) : !!due && due < today), state: k.state, onToday: k.onToday, followUpId: k.followUpId,
      item: withLive(k.itemId ? { id: k.itemId, title: k.itemTitle, url: k.itemUrl } : null, k.itemId ? live.get(`${k.clientKey}:${k.itemId}`) : undefined), needsItem, draft: k.draft, likely,
      suggestions: suggestions.filter((s) => s.conversationId === k.conversationId).map((s) => ({ id: s.id, kind: s.kind, itemId: s.itemId, body: s.body, internal: s.internal, fromInternalChat: chat?.kind === "delivery", mine: true })),
      waitingDays: k.state === "open" && k.impliesItem && !k.itemId && k.escalatedAt ? daysWaiting(k.escalatedAt, now) : null, reason: k.reason, messages: msgs,
      link: isMeetingChat(k.chatId) ? (chat?.webUrl ?? "") : k.messageIds[0] ? messageLink(k.chatId, k.messageIds[0]) : chat ? teamsLink(chat) : "", createdAt: k.createdAt,
    };
  });
}

async function myPromises(ctx: ConversationContext, cfg: AppConfig): Promise<MyPromisesData> {
  const v = await seen(ctx);
  const today = localToday(ctx.now(), userZone(cfg));
  if (!v) return { promises: [], open: 0, today, writeClients: [] };
  const all = await promiseCards(ctx, v, cfg);
  // Overdue and soonest first, then the rest newest first.
  const key = (p: PromiseCard) => p.dueAt ?? (p.dueDate ? `${p.dueDate}T23:59` : p.onToday ? `${p.onToday}T23:59` : "9999");
  all.sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || Number(b.needsItem) - Number(a.needsItem) || key(a).localeCompare(key(b)) || b.createdAt.localeCompare(a.createdAt));
  await closeFollowedUp(ctx, v, all);
  return { promises: all, open: all.filter((p) => p.state === "open").length, today, writeClients: await ctx.writeClients().catch((): string[] => []) };
}

/** A promise made into a follow-up closes when that follow-up does (Not needed when the follow-up wasn't). */
async function closeFollowedUp(ctx: ConversationContext, v: Seen, all: PromiseCard[]) {
  if (!ctx.plan) return;
  for (const p of all) {
    if (p.state !== "followup" || p.followUpId === null) continue;
    const f = await ctx.plan.getFollowUp(p.followUpId);
    if (!f?.closedAt) continue;
    const state = f.outcome === "not_needed" ? "not_needed" : "done";
    await v.convs.updateCommitment(p.id, { state });
    p.state = state;
  }
}

/** My promises with a due (or put on Today), for Today and Week: open ones only (a follow-up made from one replaces it). */
export async function dayPromises(ctx: ConversationContext, cfg: AppConfig): Promise<DayPromise[]> {
  const v = await seen(ctx);
  if (!v) return [];
  const now = ctx.now();
  const today = localToday(now, userZone(cfg));
  const mine = (await v.convs.commitmentsBy(v.promiseChatIds)).filter((k) => k.state === "open" && (k.dueDate || k.onToday));
  return mine.map((k) => {
    const day = k.dueDate ?? k.onToday!;
    return { id: k.id, what: k.what, toName: k.toName, clientKey: k.clientKey, clientName: cfg.clientSettings[k.clientKey]?.name ?? k.clientKey, dueAt: k.dueAt, dueDate: day, overdue: k.dueAt ? Date.parse(k.dueAt) < Date.parse(now) : day < today };
  }).sort((a, b) => (a.dueAt ?? `${a.dueDate}T23:59`).localeCompare(b.dueAt ?? `${b.dueDate}T23:59`));
}

// ---- the DevOps draft (opened by the committer, their own cap) ----

async function draftFor(ctx: ConversationContext, v: Seen, cfg: AppConfig, c: Conversation, regenerate: boolean, commitment: Commitment | null): Promise<{ draft: ItemDraft; notSorted: string | null }> {
  if (commitment?.draft && !regenerate) return { draft: commitment.draft, notSorted: null };
  const items = (await linkable(ctx, cfg, c.clientKey)) ?? [];
  const features = items.filter((i) => i.tier === "feature");
  const chat = v.byId.get(c.chatId);
  const home = await ctx.homeTenant();
  const places = (await v.convs.placesIn([c.id])).filter((p) => p.role === "work");
  const messages = [];
  const people = new Map<string, string>();
  for (const p of places) {
    const m = await v.teams.message(p.chatId, p.messageId);
    if (!m || !chat) continue;
    const b = batchOf(m, chat, home);
    const ref = people.get(b.senderId ?? "") ?? `p${people.size + 1}`;
    people.set(b.senderId ?? "", ref);
    messages.push({ ref: `m${messages.length + 1}`, from: first(b.senderName), side: b.external ? ("client" as const) : ("Cooptimize" as const), at: m.createdAt, text: m.text });
  }
  const ai = ctx.ai ? await ctx.ai().catch(() => null) : null;
  let draft: ItemDraft | null = null;
  let notSorted: string | null = null;
  if (ai) {
    const r = await ai.run<DraftAnswer>({ name: DRAFT_TASK, client: c.clientKey, instructions: DRAFT_INSTRUCTIONS }, draftInput({ clientName: cfg.clientSettings[c.clientKey]?.name ?? c.clientKey, title: c.title, summary: c.summary, messages, features, items }), DRAFT_SCHEMA);
    if (r.ok) draft = draftFrom(r.value, { featureIds: features.map((f) => f.id), itemIds: items.map((i) => i.id) });
    else notSorted = unsortedText(r.error instanceof AiError ? r.error.kind : "provider", cfg.clientSettings[c.clientKey]?.name ?? c.clientKey);
    if (r.ok && !draft) notSorted = unsortedText("unknown_ref", "");
  } else notSorted = "AI isn't available here";
  // CV-5: without AI (off, the client's Allow AI off, or the answer unusable) the form is empty for me to fill in, and
  // nothing is kept, so the next open drafts again once AI can.
  const final = draft ?? emptyDraft();
  if (commitment && draft) await v.convs.updateCommitment(commitment.id, { draft: final });
  return { draft: final, notSorted };
}

/** CV-2: Show messages loads this many at a time (the latest first). */
export const MESSAGE_PAGE = 20;

/**
 * CV-2: one message as Show messages renders it, like Teams: who (a short alias per list for grouping, the email only
 * for a Cooptimizer's photo), mine on the other side, the sanitized body, the quoted message (its author and first
 * line, from the store by replyToId whatever its age, else "Quoted an earlier message"), and the reactions as counts.
 */
/** CV-2: an image as the page gets it: our own address while it is (or may still be) there, else a plain why. */
/** CV-4: read from Teams when shown (never kept); a skipped one says why; each has its message's Teams link. */
function imageView(i: MessageImage, link: string): MessageImageView {
  const more = { link, ...(i.description ? { description: i.description } : {}) };
  if (i.state === "skipped") return { id: i.id, src: null, note: i.reason === "too big" ? "Image not shown: over 10 MB" : "Image not shown: not a PNG, JPEG or GIF", ...more };
  return { id: i.id, src: chatImageSrc(i.id), note: null, ...more };
}

async function messageView(m: import("../plan/requests.ts").TeamsMessage, x: { chat: ClientChat; home: string | null; me: string; teams: TeamsView; aliases: Map<string, string>; images?: readonly MessageImage[] }): Promise<ConversationMessage> {
  const b = batchOf(m, x.chat, x.home);
  const mine = same(m.senderId, x.me);
  const key = (m.senderId ?? "?").toLowerCase();
  if (!x.aliases.has(key)) x.aliases.set(key, `p${x.aliases.size + 1}`);
  const member = x.chat.members?.find((y) => same(y.userId, m.senderId));
  const byAt: { name: string | null }[] = [];
  m.mentions.forEach((y, i) => (byAt[y.at ?? i] = { name: y.name }));
  const images = (x.images ?? []).filter((i) => i.messageId === m.messageId).sort((a, b) => a.position - b.position);
  let quote: ConversationMessage["quote"] = null;
  if (m.replyToId) {
    const q = await x.teams.message(m.chatId, m.replyToId);
    if (q) {
      const qb = batchOf(q, x.chat, x.home);
      quote = { author: same(q.senderId, x.me) ? "You" : (qb.senderName ?? (qb.external ? "Someone outside Cooptimize" : "Someone at Cooptimize")), text: oneLine(q.text.split("\n").find((l) => l.trim()) ?? (q.hasImage ? "Image" : ""), 140) };
    } else quote = { author: null, text: null };
  }
  return {
    messageId: m.messageId, author: mine ? "You" : (b.senderName ?? (b.external ? "Someone outside Cooptimize" : "Someone at Cooptimize")), authorKey: x.aliases.get(key)!, name: b.senderName ?? "Someone",
    email: !b.external && member?.email ? member.email.toLowerCase() : null, external: x.home ? b.external : false, mine, at: m.createdAt,
    html: sanitizeMessageHtml(m.html ?? m.text, { contentType: m.html ? "html" : "text", mentions: byAt, ...(images.length ? { hostedImages: "drop" as const } : {}) }), text: m.text, quote, reactions: m.reactions ?? [],
    ...(images.length ? { images: images.map((i) => imageView(i, messageLink(m.chatId, m.messageId))) } : {}),
  };
}

/** CV-2: the merged conversation's title and summary: AI (my own cap, that client only), else the two joined. */
async function mergeSummary(ctx: ConversationContext, v: Seen, cfg: AppConfig, into: Conversation, from: Conversation): Promise<{ title: string; summary: string }> {
  const ai = ctx.ai ? await ctx.ai().catch(() => null) : null;
  if (!ai) return joinedSummary(into, from);
  const side = async (c: Conversation) => {
    const messages = [];
    for (const p of (await v.convs.placesIn([c.id])).filter((x) => x.role === "work")) {
      const m = await v.teams.message(p.chatId, p.messageId);
      if (m) messages.push({ from: first(m.senderName), at: m.createdAt, text: m.text });
    }
    return { title: c.title, summary: c.summary, messages };
  };
  const r = await ai.run<MergeAnswer>({ name: MERGE_TASK, client: into.clientKey, instructions: MERGE_INSTRUCTIONS }, mergeInput({ clientName: cfg.clientSettings[into.clientKey]?.name ?? into.clientKey, into: await side(into), from: await side(from) }), MERGE_SCHEMA);
  return (r.ok ? mergeFrom(r.value) : null) ?? joinedSummary(into, from);
}

// ---- actions ----

export async function conversationAction(ctx: ConversationContext, action: ConversationAction, input: unknown): Promise<ActionResponse> {
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const v = await seen(ctx);
  const respond = async () => ({ ok: true as const, data: await list(ctx, cfg) });
  const promisesNow = async () => ({ ok: true as const, data: await myPromises(ctx, cfg) });
  /** A conversation I may see. */
  const conv = async (id: unknown) => {
    const n = posInt(id);
    if (!v || !n) return null;
    const c = await v.convs.conversation(n);
    return c && v.byId.has(c.chatId) ? c : null;
  };
  const mine = async (id: unknown) => {
    const n = posInt(id);
    if (!v || !n) return null;
    const k = await v.convs.commitment(n);
    return k && v.byId.has(k.chatId) && same(k.whoId, v.me) ? k : null;
  };
  const stamp = ctx.now();
  // CV-1 migration: my AP-2 promises move to the shared commitments the first time I look (idempotent).
  if (v && ctx.plan && ctx.requests && (action === "conversations.list" || action === "my_promises.list" || action === "my_promises.today")) {
    const meName = v.chats.flatMap((c) => c.members ?? []).find((m) => same(m.userId, v.me))?.displayName ?? "You";
    await backfillPromises({ plan: ctx.plan, teams: ctx.requests.teams, convs: v.store, me: v.me, meName, chats: v.chats }).catch(() => ctx.log({ source: "plan", op: "promises_moved", kind: "failed" }));
    await reopenKept(ctx, cfg, v).catch(() => ctx.log({ source: "plan", op: "promises_kept_reopened", kind: "failed" }));
  }
  try {
    switch (action) {
      case "conversations.list": {
        const o = only(input, [], ["select"]);
        if (!o || (o.select !== undefined && !posInt(o.select))) return bad("conversations.list takes { select? }");
        return { ok: true as const, data: await list(ctx, cfg, posInt(o.select)) };
      }
      case "conversations.merge": {
        // CV-2: Merge into… (one, or several picked in a client's list): everything moves into the target, one undo each.
        const o = only(input, ["ids", "into"]);
        const ids = o && Array.isArray(o.ids) && o.ids.length >= 1 && o.ids.length <= 20 ? o.ids.map(posInt) : null;
        if (!o || !v || !ids || ids.some((x) => x === null)) return bad("conversations.merge takes { ids: [id, ...], into: id }");
        const into = await conv(o.into);
        if (!into) return bad("No such conversation", 404);
        const froms = [];
        for (const id of new Set(ids as number[])) {
          const c = await conv(id);
          if (!c) return bad("No such conversation", 404);
          if (c.id === into.id) return bad("Pick another conversation to merge into", 409);
          if (c.chatId !== into.chatId) return bad("Merge only conversations of the same chat", 409);
          froms.push(c);
        }
        const merges: number[] = [];
        let target = into;
        for (const from of froms) {
          const summary = await mergeSummary(ctx, v, cfg, target, from);
          merges.push((await v.convs.merge(from.id, target.id, summary)).id);
          target = (await v.convs.conversation(target.id))!;
        }
        await refreshStatus({ convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() }, into.id);
        ctx.log({ source: "plan", op: "conversation_merged", count: merges.length });
        return { ok: true as const, data: { ...(await list(ctx, cfg, into.id)), merges } };
      }
      case "conversations.merge_preview": {
        // IB-1 slice 4: the before → after shown in the detail pane before Merge runs. Reads only.
        const o = only(input, ["id", "into"]);
        if (!o || !v || !posInt(o.id) || !posInt(o.into)) return bad("conversations.merge_preview takes { id, into }");
        const from = await conv(o.id);
        const into = await conv(o.into);
        if (!from || !into) return bad("No such conversation", 404);
        if (from.id === into.id) return bad("Pick another conversation to merge into", 409);
        if (from.chatId !== into.chatId) return bad("Merge only conversations of the same chat", 409);
        const side = async (c: Conversation): Promise<MergeSide> => ({
          id: c.id, title: c.title, ...(await v.convs.contents(c.id)), people: c.participants.map((p) => p.name),
          item: c.itemId ? { id: c.itemId, title: c.itemTitle } : null,
        });
        return { ok: true as const, data: mergePreview(await side(from), await side(into)) };
      }
      case "conversations.unmerge": {
        const o = only(input, ["merges"]);
        const ids = o && Array.isArray(o.merges) && o.merges.length >= 1 && o.merges.length <= 20 ? o.merges.map(posInt) : null;
        if (!o || !v || !ids || ids.some((x) => x === null)) return bad("conversations.unmerge takes { merges: [id, ...] }");
        const deps = { convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() };
        // The latest first, so a chain of merges comes apart in the order it was made.
        for (const id of [...(ids as number[])].sort((a, b) => b - a)) {
          const m = await v.convs.unmerge(id);
          await refreshStatus(deps, m.fromId);
          await refreshStatus(deps, m.intoId);
        }
        ctx.log({ source: "plan", op: "conversation_unmerged", count: ids.length });
        return respond();
      }
      case "conversations.count":
        if (!only(input, [])) return bad("conversations.count takes {}");
        return { ok: true as const, data: await counts(ctx, cfg) };
      case "conversations.refresh":
        if (!only(input, [])) return bad("conversations.refresh takes {}");
        if (v?.chats.length && ctx.requests) await ctx.requests.refresh(v.chats.map((c) => c.chatId));
        return respond();
      case "conversations.messages": {
        // CV-2: as Teams shows them, the latest MESSAGE_PAGE first and "Show earlier" for the page before `before`.
        const o = only(input, ["id"], ["before"]);
        const c = o && (await conv(o.id));
        if (!o || !c || !v) return bad("No such conversation", 404);
        if (o.before !== undefined && (typeof o.before !== "string" || !MESSAGE_ID.test(o.before))) return bad("before is a message id");
        const chat = v.byId.get(c.chatId)!;
        const home = await ctx.homeTenant();
        const places = (await v.convs.placesIn([c.id])).filter((x) => x.role === "work");
        const end = typeof o.before === "string" ? places.findIndex((p) => p.messageId === o.before) : places.length;
        const page = places.slice(Math.max(0, (end < 0 ? places.length : end) - MESSAGE_PAGE), end < 0 ? places.length : end);
        const out: ConversationMessage[] = [];
        const aliases = new Map<string, string>();
        // CV-2: the page's images (rows made now for messages stored before CV-2); bytes only through /media.
        const images = await v.teams.images(chat.chatId, page.map((p) => p.messageId));
        for (const p of page) {
          const m = await v.teams.message(p.chatId, p.messageId);
          if (!m) continue;
          out.push(await messageView(m, { chat, home, me: v.me, teams: v.teams, aliases, images }));
        }
        if (ctx.plan && o.before === undefined) await ctx.plan.seeConversation(c.id, c.version);
        return { ok: true, data: { messages: out, chatLink: teamsLink(chat), earlier: page.length ? (places.indexOf(page[0]!) > 0 ? page[0]!.messageId : null) : null, total: places.length } };
      }
      case "conversations.seen": {
        const o = only(input, ["id"]);
        const c = o && (await conv(o.id));
        if (!c) return bad("No such conversation", 404);
        if (ctx.plan) await ctx.plan.seeConversation(c.id, c.version);
        return { ok: true, data: { id: c.id } };
      }
      case "conversations.resolve":
      case "conversations.not_request": {
        const o = only(input, ["id"], ["reason"]);
        const c = o && (await conv(o.id));
        if (!o || !c || !v) return bad("No such conversation", 404);
        if (o.reason !== undefined && o.reason !== null && (typeof o.reason !== "string" || o.reason.length > 400)) return bad("reason is text of at most 400 characters");
        const status = action === "conversations.resolve" ? "resolved" : "closed";
        if (c.status === status) return respond();
        const reason = typeof o.reason === "string" && o.reason.trim() ? o.reason.trim() : null;
        await v.convs.updateConversation(c.id, { status, closed: { by: v.me, at: stamp, reason }, windDown: false, changeNote: status === "resolved" ? "Resolved" : "Marked not a request" }, { bump: true });
        ctx.log({ source: "plan", op: "conversation_closed", kind: status });
        return respond();
      }
      case "conversations.not_work": {
        // QF-1: Not work-related: one click moves its messages to Chatter and closes it for everyone on the chat. The
        // places remember the conversation (reason not_work:<id>) only so Undo can put them back; nothing is learned.
        const o = only(input, ["id"]);
        const c = o && (await conv(o.id));
        if (!c || !v) return bad("No such conversation", 404);
        if (c.closedAt && c.closeReason === NOT_WORK) return respond();
        const work = (await v.convs.placesIn([c.id])).filter((p) => p.role === "work");
        await v.convs.place(work.map((p) => ({ chatId: p.chatId, messageId: p.messageId, conversationId: null, role: "chatter" as const, reason: `${NOT_WORK_PLACE}${c.id}`, placedBy: "person" as const, at: p.at })));
        await v.convs.updateConversation(c.id, { status: "closed", closed: { by: v.me, at: stamp, reason: NOT_WORK }, windDown: false, changeNote: "Marked not work-related" }, { bump: true });
        ctx.log({ source: "plan", op: "conversation_not_work", count: work.length });
        return respond();
      }
      case "conversations.not_work_undo": {
        const o = only(input, ["id"]);
        const c = o && (await conv(o.id));
        if (!c || !v) return bad("No such conversation", 404);
        const moved = (await v.convs.placesByRole([c.chatId], "chatter")).filter((p) => p.reason === `${NOT_WORK_PLACE}${c.id}`);
        await v.convs.place(moved.map((p) => ({ chatId: p.chatId, messageId: p.messageId, conversationId: c.id, role: "work" as const, reason: null, placedBy: "person" as const, at: p.at })));
        if (c.closedAt && c.closeReason === NOT_WORK) await v.convs.updateConversation(c.id, { closed: null, status: "new", changeNote: "Back from Chatter" }, { bump: true });
        await refreshStatus({ convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() }, c.id);
        ctx.log({ source: "plan", op: "conversation_not_work_undone", count: moved.length });
        return respond();
      }
      case "conversations.reopen": {
        const o = only(input, ["id"]);
        const c = o && (await conv(o.id));
        if (!c || !v) return bad("No such conversation", 404);
        if (!c.closedAt) return respond();
        await v.convs.updateConversation(c.id, { closed: null, status: "new", changeNote: "Opened again" }, { bump: true });
        await refreshStatus({ convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() }, c.id);
        ctx.log({ source: "plan", op: "conversation_reopened" });
        return respond();
      }
      case "conversations.hide": {
        const o = only(input, ["id", "hidden"]);
        const c = o && (await conv(o.id));
        if (!o || !c || typeof o.hidden !== "boolean") return bad("conversations.hide takes { id, hidden }");
        if (!ctx.plan) return bad("The plan store isn't available", 503);
        await ctx.plan.hideConversation(c.id, o.hidden);
        return respond();
      }
      case "conversations.move":
      case "conversations.this_is_work": {
        // Move: a message to another conversation of the same chat; Split (to "new"): a new conversation from it.
        // This is work: a message filtered as chatter (or waiting) starts its own conversation.
        const o = action === "conversations.move" ? only(input, ["chatId", "messageId", "to"]) : only(input, ["chatId", "messageId"]);
        if (!o || !v || typeof o.chatId !== "string" || !CHAT_ID.test(o.chatId) || typeof o.messageId !== "string" || !MESSAGE_ID.test(o.messageId)) return bad(`${action} takes { chatId, messageId${action === "conversations.move" ? ", to: id | \"new\"" : ""} }`);
        const chat = v.byId.get(o.chatId);
        const m = chat ? await v.teams.message(o.chatId, o.messageId) : null;
        const place = m ? await v.convs.placeOf(o.chatId, o.messageId) : null;
        if (!chat || !m) return bad("No such message", 404);
        const from = place?.conversationId ?? null;
        let to: number;
        if (action === "conversations.move" && o.to !== "new") {
          const target = await conv(o.to);
          if (!target || target.chatId !== o.chatId) return bad("Move a message only to a conversation of the same chat", 409);
          to = target.id;
        } else {
          const b = batchOf(m, chat, await ctx.homeTenant());
          const created = await v.convs.addConversation({ chatId: o.chatId, clientKey: chat.clientKey, title: askTitle(m.text), summary: oneLine(m.text, 300), participants: b.senderId ? [{ id: b.senderId, name: b.senderName ?? "Someone", external: b.external }] : [], firstAt: m.createdAt, lastAt: m.createdAt, lastWorkAt: m.createdAt, changeNote: action === "conversations.this_is_work" ? "Pulled back in as work" : "Split from another conversation" });
          to = created.id;
        }
        // DX-1: This is work marks its place, so Diagnostics counts it apart from Move and Split.
        await v.convs.place([{ chatId: o.chatId, messageId: o.messageId, conversationId: to, role: "work", reason: action === "conversations.this_is_work" ? IS_WORK_PLACE : null, placedBy: "person", at: m.createdAt }]);
        const deps = { convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() };
        await v.convs.updateConversation(to, { changeNote: "A message was moved here" }, { bump: true });
        await refreshStatus(deps, to);
        if (from !== null && from !== to) await refreshStatus(deps, from);
        ctx.log({ source: "plan", op: "conversation_moved", kind: action === "conversations.this_is_work" ? "work" : o.to === "new" ? "split" : "move" });
        // CV-5: the conversation it went to, so chatter's ⋯ › Create DevOps item can open the draft on it.
        return { ok: true as const, data: { ...(await list(ctx, cfg)), conversationId: to } };
      }
      case "conversations.link": {
        const o = only(input, ["id", "itemId"], ["commitmentId"]);
        const c = o && (await conv(o.id));
        const itemId = o && posInt(o.itemId);
        if (!o || !c || !itemId || !v) return bad("conversations.link takes { id, itemId, commitmentId? }");
        if (c.itemId) return bad(`This conversation is already tracked as #${c.itemId}. Unlink it first`, 409);
        const items = await linkable(ctx, cfg, c.clientKey);
        if (!items) return bad(`DevOps couldn't be read for ${cfg.clientSettings[c.clientKey]?.name ?? c.clientKey}. Try again in a moment`, 503);
        const hit = items.find((i) => i.id === itemId);
        if (!hit) return bad("That isn't one of this client's open items in scope", 404);
        await v.convs.updateConversation(c.id, { item: { id: hit.id, url: hit.url, title: hit.title }, changeNote: `Linked to #${hit.id}` }, { bump: true });
        // The commitment it fulfils: the one given, else my open one that implies an item. CV-5: it stays open with the item.
        const ks = await v.convs.commitmentsIn([c.id]);
        const k = ks.find((x) => x.id === posInt(o.commitmentId)) ?? ks.find((x) => x.state === "open" && x.impliesItem && same(x.whoId, v.me)) ?? ks.find((x) => x.state === "open" && x.impliesItem);
        if (k && !k.itemId) await v.convs.updateCommitment(k.id, { itemId: hit.id, itemUrl: hit.url, itemTitle: hit.title });
        await refreshStatus({ convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() }, c.id);
        ctx.log({ source: "plan", op: "conversation_linked" });
        return respond();
      }
      case "conversations.unlink": {
        // CV-5: Undo of Link to item (FocusTime only; nothing in DevOps changes). A create's undo is the audit log's.
        const o = only(input, ["id"]);
        const c = o && (await conv(o.id));
        if (!o || !c || !v) return bad("No such conversation", 404);
        if (!c.itemId) return respond();
        const id = c.itemId;
        if (await createdHere(ctx, id, { conversationId: c.id, commitmentId: null })) return bad(`#${id} was created in DevOps from this conversation. Undo it from Settings > Data > Audit log`, 409, "created");
        await v.convs.updateConversation(c.id, { item: null, changeNote: `Unlinked from #${id}` }, { bump: true });
        for (const k of await v.convs.commitmentsIn([c.id])) if (k.itemId === id && (k.state === "open" || k.state === "linked")) await v.convs.updateCommitment(k.id, { state: "open", itemId: null, itemUrl: null, itemTitle: null });
        await refreshStatus({ convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() }, c.id);
        ctx.log({ source: "plan", op: "conversation_unlinked" });
        return respond();
      }
      case "conversations.search_items": {
        // CV-5: Link to item's search, for a conversation (anyone on its chat) or my promise: that client's open items in scope.
        const o = only(input, [], ["id", "promiseId", "query"]);
        if (!o || (o.query !== undefined && (typeof o.query !== "string" || o.query.length > 200)) || (o.id === undefined) === (o.promiseId === undefined)) return bad("conversations.search_items takes { id or promiseId, query? }");
        const clientKey = o.id !== undefined ? (await conv(o.id))?.clientKey : (await mine(o.promiseId))?.clientKey;
        if (!clientKey) return bad("No such conversation", 404);
        const items = await linkable(ctx, cfg, clientKey);
        if (!items) return { ok: true, data: { available: false, items: [] } };
        return { ok: true, data: { available: true, items: matching(items, String(o.query ?? "")).map((i) => ({ id: i.id, title: i.title, type: i.type, state: i.state, url: i.url, tier: i.tier ?? null })) } };
      }
      case "conversations.take_over": {
        const o = only(input, ["commitmentId"]);
        const id = o && posInt(o.commitmentId);
        const k = id && v ? await v.convs.commitment(id) : null;
        if (!k || !v || !v.byId.has(k.chatId)) return bad("No such commitment", 404);
        if (same(k.whoId, v.me)) return respond();
        if (k.state !== "open") return bad("That's already handled", 409);
        const meName = v.byId.get(k.chatId)?.members?.find((m) => same(m.userId, v.me))?.displayName ?? "Someone at Cooptimize";
        // I become its committer and the conversation's owner; whoever had it is told quietly, once (their own tick).
        await v.convs.updateCommitment(k.id, { takenFrom: k.whoId, takenBy: v.me, takenAt: stamp, whoId: v.me, whoName: meName, escalatedAt: null, remindedAt: null, reason: `Taken over from ${first(k.whoName)}` });
        if (k.conversationId !== null) await v.convs.updateConversation(k.conversationId, { ownerId: v.me, changeNote: `${first(meName)} took it over` }, { bump: true });
        ctx.log({ source: "plan", op: "commitment_taken_over" });
        return respond();
      }
      case "conversations.sort_unsorted": {
        if (!only(input, [])) return bad("conversations.sort_unsorted takes {}");
        if (!v || !ctx.requests) return respond();
        const ai = ctx.pipelineAi ? await ctx.pipelineAi().catch(() => null) : null;
        const users = await ctx.users();
        let sorted = 0;
        for (const chat of v.chats) {
          // IB-1 slice 3: Sort again never overrides the guard: messages it held back stay held.
          const waiting = (await v.convs.placesByRole([chat.chatId], "unsorted")).filter((p) => unsortedLine(p.reason, "").does !== "held");
          if (!waiting.length) continue;
          const ms = (await mapSeq(waiting, (p) => v.teams.message(p.chatId, p.messageId))).filter((m): m is NonNullable<typeof m> => !!m);
          const r = await runPipeline({
            teams: ctx.requests.teams, convs: v.store, users, homeTenant: await ctx.homeTenant(), now: stamp, clientName: cfg.clientSettings[chat.clientKey]?.name ?? chat.clientKey, ai, zone: userZone(cfg), ackPhrases: cfg.asks.ackPhrases, chatCap: cfg.org?.rules.chatAiDailyCap ?? CHAT_DAILY_AI_CALLS, ...groupingRules(cfg, chat.clientKey),
            items: await ctx.openItems(cfg, chat.clientKey).catch(() => null), author: async (uid) => (same(uid, v.me) ? { zone: userZone(cfg), promisePhrases: cfg.asks.promisePhrases } : null),
          }, chat, ms);
          sorted += r.work + r.chatter;
        }
        ctx.log({ source: "plan", op: "conversations_sorted", count: sorted });
        return respond();
      }
      case "conversations.search": {
        const o = only(input, ["id"], ["query"]);
        const c = o && (await conv(o.id));
        if (!o || !c || (o.query !== undefined && (typeof o.query !== "string" || o.query.length > 200))) return bad("conversations.search takes { id, query? }");
        const items = await linkable(ctx, cfg, c.clientKey);
        if (!items) return { ok: true, data: { available: false, items: [] } };
        const hits = matching(items, String(o.query ?? ""));
        return { ok: true, data: { available: true, items: hits.map((i) => ({ id: i.id, title: i.title, type: i.type, state: i.state, url: i.url, tier: i.tier ?? null })) } };
      }
      case "conversations.draft": {
        // The committer opens "Create the DevOps item?": the draft (made once, then kept; Regenerate makes it again).
        const o = only(input, ["id"], ["commitmentId", "regenerate"]);
        const c = o && (await conv(o.id));
        if (!o || !c || !v) return bad("No such conversation", 404);
        const k = o.commitmentId !== undefined ? await mine(o.commitmentId) : null;
        if (o.commitmentId !== undefined && !k) return bad("No such commitment", 404);
        const r = await draftFor(ctx, v, cfg, c, o.regenerate === true, k);
        const items = (await linkable(ctx, cfg, c.clientKey)) ?? [];
        // CV-5: parents are the client's open features and epics in scope (WT-1 says which types go under each).
        const feats = items.filter((i) => i.tier === "feature" || i.tier === "epic");
        const features = feats.map((i) => ({ id: i.id, title: i.title, type: i.type }));
        // WT-1: only the valid child types under each parent, the most common first (and with no parent, the level's).
        const model = ctx.processModel ? await ctx.processModel(cfg, c.clientKey).catch(() => null) : null;
        const types: Record<string, ReturnType<typeof typeChoices>> = { none: typeChoices(model, { parentType: null, level: r.draft.level }) };
        for (const f of feats) types[String(f.id)] = typeChoices(model, { parentType: f.type, level: r.draft.level });
        return { ok: true, data: { draft: r.draft, notSorted: r.notSorted, features, types, internalChat: v.byId.get(c.chatId)?.kind === "delivery", canCreate: (await ctx.writeClients().catch((): string[] => [])).includes(c.clientKey) } };
      }
      case "suggestions.skip": {
        const o = only(input, ["id"]);
        const id = o && posInt(o.id);
        const s = id && v ? await v.convs.suggestion(id) : null;
        if (!s || !v || !same(s.forUser, v.me)) return bad("No such suggestion", 404);
        await v.convs.settleSuggestion(s.id, "skipped");
        if (s.kind === "comment") await v.store.updateConversation(s.conversationId, { itemChange: null });
        return respond();
      }
    }
    // My promises.
    if (!v) return promisesNow();
    switch (action) {
      case "my_promises.list":
        if (!only(input, [])) return bad("my_promises.list takes {}");
        return promisesNow();
      case "my_promises.today": {
        const o = only(input, ["id", "on"]);
        const k = o && (await mine(o.id));
        if (!o || !k || typeof o.on !== "boolean") return bad("my_promises.today takes { id, on }");
        await v.convs.updateCommitment(k.id, { onToday: o.on ? localToday(stamp, userZone(cfg)) : null });
        return promisesNow();
      }
      case "my_promises.start_draft": {
        // CV-2: "Create the DevOps item?" for a promise the rules found with no conversation: one is made from the
        // promise's own messages and the ones just before it in that chat (45 minutes, not in another conversation),
        // so the draft has the context, then the usual draft flow runs on it.
        const o = only(input, ["id"]);
        const k = o && (await mine(o.id));
        if (!o || !k) return bad("my_promises.start_draft takes { id }");
        if (k.state !== "open") return bad("This promise is already handled", 409);
        if (k.conversationId) return { ok: true, data: { conversationId: k.conversationId } };
        const chat = v.byId.get(k.chatId)!;
        const home = await ctx.homeTenant();
        const own = (await mapSeq(k.messageIds, (id) => v.teams.message(k.chatId, id))).filter((m): m is NonNullable<typeof m> => !!m).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        if (!own.length) return bad("This promise's messages are no longer stored, so there's nothing to draft from. Link an item instead", 410);
        const firstAt = own[0]!.createdAt;
        const near = [];
        for (const m of await v.teams.messagesBefore(k.chatId, firstAt, 12)) {
          if ((Date.parse(firstAt) - Date.parse(m.createdAt)) / 60_000 > 45) continue;
          const place = await v.convs.placeOf(k.chatId, m.messageId);
          if (place?.conversationId || place?.role === "chatter" || place?.role === "ack") continue;
          near.push(m);
        }
        const ms = [...near, ...own];
        const batch = ms.map((m) => batchOf(m, chat, home));
        const lastAt = ms.at(-1)!.createdAt;
        const c = await v.store.addConversation({
          chatId: k.chatId, clientKey: k.clientKey, title: oneLine(k.what, 80) || "A promise", summary: oneLine(`You said you'd ${k.what.replace(/^./, (x) => x.toLowerCase())}${k.toName ? ` (to ${first(k.toName)})` : ""}.`, 200),
          participants: withParticipants([], batch.map(participantOf)), firstAt: ms[0]!.createdAt, lastAt, lastWorkAt: lastAt,
        });
        await v.store.place(ms.map((m) => ({ chatId: k.chatId, messageId: m.messageId, conversationId: c.id, role: "work" as const, reason: null, placedBy: "person" as const, at: m.createdAt })));
        await v.store.updateCommitment(k.id, { conversationId: c.id });
        await refreshStatus({ convs: v.store, teams: ctx.requests!.teams, homeTenant: home }, c.id);
        ctx.log({ source: "plan", op: "promise_draft_started", count: ms.length });
        return { ok: true, data: { conversationId: c.id } };
      }
      case "my_promises.due": {
        // IB-1: a promise is never read-only. Its due day (or none), wherever it stands: open, linked or created.
        const o = only(input, ["id", "due"]);
        const k = o && (await mine(o.id));
        if (!o || !k) return bad("my_promises.due takes { id, due }");
        const due = o.due === null || o.due === "" ? null : typeof o.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.due) && Temporal.PlainDate.from(o.due) ? o.due : undefined;
        if (due === undefined) return bad("due is a date like 2026-11-06, or null");
        if (k.state === "done" || k.state === "not_needed") return bad("This promise is closed. Open it again first", 409);
        // A stated time was for the old day; the new due is a day.
        await v.convs.updateCommitment(k.id, { dueDate: due, dueAt: null });
        ctx.log({ source: "plan", op: "promise_due" });
        return promisesNow();
      }
      case "my_promises.who": {
        // IB-1: whom the promise is to (a person from the picker, or a name, or nobody); never me.
        const o = only(input, ["id", "who"], ["whoRef"]);
        const k = o && (await mine(o.id));
        if (!o || !k || (o.who !== null && (typeof o.who !== "string" || o.who.trim().length > 200))) return bad("my_promises.who takes { id, who, whoRef? }");
        const whoRef = o.whoRef === undefined || o.whoRef === null ? null : personRef(o.whoRef);
        if (o.whoRef !== undefined && o.whoRef !== null && !whoRef) return bad("whoRef is a person from the picker, or null");
        if (k.state === "done" || k.state === "not_needed") return bad("This promise is closed. Open it again first", 409);
        const name = typeof o.who === "string" && o.who.trim() ? o.who.trim() : null;
        const owner = { id: v.me, names: [k.whoName, v.byId.get(k.chatId)?.members?.find((m) => same(m.userId, v.me))?.displayName] };
        const kept = whoNotOwner({ who: name, whoRef: name ? whoRef : null }, null, owner);
        const toId = kept.whoRef?.kind === "cooptimizer" ? kept.whoRef.id : kept.whoRef?.kind === "external" ? kept.whoRef.memberId : null;
        await v.convs.updateCommitment(k.id, { toName: kept.who, toId });
        ctx.log({ source: "plan", op: "promise_who" });
        return promisesNow();
      }
      case "my_promises.close": {
        // IB-1: Close the loop on a chat promise: done, with how I told them (optional) and a note. Nothing is sent.
        const o = only(input, ["id"], ["how", "note"]);
        const k = o && (await mine(o.id));
        if (!o || !k) return bad("my_promises.close takes { id, how?, note? }");
        const how = o.how === undefined || o.how === null ? null : (CLOSE_HOW as readonly unknown[]).includes(o.how) ? (o.how as CloseHow) : undefined;
        const note = o.note === undefined || o.note === null || o.note === "" ? null : typeof o.note === "string" && o.note.trim().length <= 500 ? o.note.trim() : undefined;
        if (how === undefined || note === undefined) return bad("how is teams, email, devops or call; note is text of at most 500 characters");
        if (k.state === "done" || k.state === "not_needed") return bad("This promise is already closed", 409);
        await v.convs.updateCommitment(k.id, { state: "done", closeHow: how, closeNote: note });
        if (k.conversationId !== null) await refreshStatus({ convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() }, k.conversationId);
        ctx.log({ source: "plan", op: "promise_resolved", kind: "closed" });
        return promisesNow();
      }
      case "my_promises.search": {
        // CV-3 (Q-CV2-4): likely items for Link existing…, with or without a conversation, by rules only. The words
        // come from the promise and its messages, and its conversation's messages or else the ones just before it in
        // that chat (45 minutes, at most 12). One client's open items (openItems reads DV-1's store when it runs).
        const o = only(input, ["id"], ["query"]);
        const k = o && (await mine(o.id));
        if (!o || !k || (o.query !== undefined && (typeof o.query !== "string" || o.query.length > 200))) return bad("my_promises.search takes { id, query? }");
        const items = await linkable(ctx, cfg, k.clientKey);
        if (!items) return { ok: true, data: { available: false, items: [] } };
        const own = (await mapSeq(k.messageIds, (id) => v.teams.message(k.chatId, id))).filter((m): m is NonNullable<typeof m> => !!m).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const c = k.conversationId !== null ? await v.convs.conversation(k.conversationId) : null;
        const around: string[] = [];
        if (c) {
          const places = (await v.convs.placesIn([c.id])).filter((p) => p.role === "work").slice(-12);
          for (const p of places) {
            const m = await v.teams.message(p.chatId, p.messageId);
            if (m) around.push(m.text);
          }
          around.push(c.title);
        } else if (own[0]) {
          const firstAt = own[0].createdAt;
          for (const m of await v.teams.messagesBefore(k.chatId, firstAt, 12)) if ((Date.parse(firstAt) - Date.parse(m.createdAt)) / 60_000 <= 45) around.push(m.text);
        }
        const email = ctx.devopsEmail ? await ctx.devopsEmail(k.clientKey).catch(() => null) : null;
        const hits = likelyItems({ texts: [k.what, ...own.map((m) => m.text), ...around], items, myEmail: email, suggestedId: c?.likelyItem ?? null, query: typeof o.query === "string" ? o.query : "" });
        return { ok: true, data: { available: true, items: hits } };
      }
      case "my_promises.link": {
        const o = only(input, ["id", "itemId"]);
        const k = o && (await mine(o.id));
        const itemId = o && posInt(o.itemId);
        if (!o || !k || !itemId) return bad("my_promises.link takes { id, itemId }");
        if (k.state !== "open") return bad("This promise is already handled", 409);
        if (k.itemId) return bad(`This promise is already linked to #${k.itemId}. Unlink it first`, 409);
        const items = await linkable(ctx, cfg, k.clientKey);
        if (!items) return bad(`DevOps couldn't be read for ${cfg.clientSettings[k.clientKey]?.name ?? k.clientKey}. Try again in a moment`, 503);
        const hit = items.find((i) => i.id === itemId);
        if (!hit) return bad("That isn't one of this client's open items in scope", 404);
        // CV-5: linking keeps the promise open and actionable (due, who, follow-up, done); it only records the item.
        await v.convs.updateCommitment(k.id, { itemId: hit.id, itemUrl: hit.url, itemTitle: hit.title });
        const c = k.conversationId !== null ? await v.convs.conversation(k.conversationId) : null;
        if (c && !c.itemId) {
          await v.convs.updateConversation(c.id, { item: { id: hit.id, url: hit.url, title: hit.title }, changeNote: `Linked to #${hit.id}` }, { bump: true });
          await refreshStatus({ convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() }, c.id);
        }
        ctx.log({ source: "plan", op: "promise_linked" });
        return promisesNow();
      }
      case "my_promises.unlink": {
        // CV-5: Undo of Link to item on my promise (FocusTime only), and of its conversation's link when it came with it.
        const o = only(input, ["id"]);
        const k = o && (await mine(o.id));
        if (!o || !k) return bad("my_promises.unlink takes { id }");
        if (!k.itemId) return promisesNow();
        const id = k.itemId;
        if (k.state === "created" || (await createdHere(ctx, id, { conversationId: null, commitmentId: k.id }))) return bad(`#${id} was created in DevOps from this promise. Undo it from Settings > Data > Audit log`, 409, "created");
        await v.convs.updateCommitment(k.id, { state: k.state === "linked" ? "open" : k.state, itemId: null, itemUrl: null, itemTitle: null });
        const c = k.conversationId !== null ? await v.convs.conversation(k.conversationId) : null;
        if (c?.itemId === id && !(await createdHere(ctx, id, { conversationId: c.id, commitmentId: null }))) {
          await v.convs.updateConversation(c.id, { item: null, changeNote: `Unlinked from #${id}` }, { bump: true });
          await refreshStatus({ convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() }, c.id);
        }
        ctx.log({ source: "plan", op: "promise_unlinked" });
        return promisesNow();
      }
      case "my_promises.done":
      case "my_promises.not_needed": {
        const o = only(input, ["id"]);
        const k = o && (await mine(o.id));
        if (!k) return bad("No such promise", 404);
        await v.convs.updateCommitment(k.id, { state: action === "my_promises.done" ? "done" : "not_needed" });
        if (k.conversationId !== null) await refreshStatus({ convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() }, k.conversationId);
        ctx.log({ source: "plan", op: "promise_resolved", kind: action === "my_promises.done" ? "done" : "not_needed" });
        return promisesNow();
      }
      case "my_promises.reopen": {
        const o = only(input, ["id"]);
        const k = o && (await mine(o.id));
        if (!k) return bad("No such promise", 404);
        if (k.state === "created") return bad(`#${k.itemId} was created in DevOps. Undo it from Settings > Data > Audit log`, 409);
        if (k.state === "followup") return bad("This promise is a follow-up now: change it in the Inbox", 409);
        await v.convs.updateCommitment(k.id, { state: "open", closeHow: null, closeNote: null, ...(k.state === "linked" ? { itemId: null, itemUrl: null, itemTitle: null } : {}) });
        if (k.conversationId !== null) await refreshStatus({ convs: v.store, teams: ctx.requests!.teams, homeTenant: await ctx.homeTenant() }, k.conversationId);
        return promisesNow();
      }
    }
    return bad("unknown action");
  } catch (e) {
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
