// DX-1: Settings › Data › Diagnostics, one read-only action (`diagnostics.check`). Answers QF-1's two open questions
// (Q-QF1-1, Q-QF1-3) inside the app with counts, for the signed-in person's own chats only: every read goes through
// the conversation store's viewer and the chats Inbox shows me (member now, client followed; D521). Message text is
// read in memory only to ask "does a message of mine read like a promise" (the pipeline's own promise phrases) and is
// never returned, logged or kept. No admin view, no write, nothing logged beyond the usual request line.
import type { ActionResponse } from "./types.ts";
import type { AppConfig } from "../config/schema.ts";
import { userZone } from "../week/zone.ts";
import { localToday } from "../week/dates.ts";
import { promisePhrase } from "../plan/conversations.ts";
import { parseKey, viewsOf } from "../plan/inbox-items.ts";
import {
  chatOutcomes, extractionReason, extractionRetry, isPromiseGap, promiseReason, zeroReasons, zeroStatuses,
  type Diagnostics, type ExtractionRow, type PromiseRow,
} from "../plan/diagnostics.ts";
import { inboxFacts, seen, type ConversationContext } from "./conversation-actions.ts";

export const DIAGNOSTICS_ACTIONS = ["diagnostics.check"] as const;
export type DiagnosticsAction = (typeof DIAGNOSTICS_ACTIONS)[number];

/** The window the chatter check and the promise-phrase scan look at (chatter itself is kept 14 days). */
export const DIAGNOSTICS_DAYS = 14;
/** At most this many stored messages per chat are looked at (a busy chat's 14 days stay well under it). */
const PER_CHAT = 5000;

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && lower(a) === lower(b);

export async function diagnosticsAction(ctx: ConversationContext, action: DiagnosticsAction, input: unknown): Promise<ActionResponse> {
  if (action !== "diagnostics.check") return { ok: false, status: 400, error: "Unknown action" };
  if (input !== undefined && input !== null && (typeof input !== "object" || Array.isArray(input) || Object.keys(input).length)) return { ok: false, status: 400, error: "diagnostics.check takes {}" };
  const cfg = await ctx.config();
  if (!cfg) return { ok: false, status: 503, error: "Settings couldn't be read" };
  return { ok: true, data: await diagnostics(ctx, cfg) };
}

export async function diagnostics(ctx: ConversationContext, cfg: AppConfig): Promise<Diagnostics> {
  const now = ctx.now();
  const since = new Date(Date.parse(now) - DIAGNOSTICS_DAYS * 24 * 3600_000).toISOString();
  const empty: Diagnostics = { at: now, days: DIAGNOSTICS_DAYS, promises: { byStatus: zeroStatuses(), committed: 0, byReason: zeroReasons(), rows: [], extraction: { checked: 0, byReason: {}, rows: [] } }, chats: [] };
  const v = await seen(ctx);
  if (!v) return empty;
  const clientName = (k: string) => cfg.clientSettings[k]?.name ?? k;
  const users = await ctx.users().catch(() => []);
  const meName = users.find((u) => same(u.id, v.me))?.name ?? "";
  const otherUserIds = new Set(users.filter((u) => !same(u.id, v.me)).map((u) => lower(u.id)));
  const chatIds = v.chats.map((c) => c.chatId);

  // 1. Promises check (Q-QF1-1): my conversations by status, and each committed one's reason.
  const convs = await v.convs.conversations(chatIds);
  const byStatus = zeroStatuses();
  for (const c of convs) byStatus[c.status]++;
  const committed = convs.filter((c) => c.status === "committed");
  const commitments = await v.convs.commitmentsIn(committed.map((c) => c.id));
  // What Promises and Needs you show for me now: the Inbox's own facts and marks (plan/inbox-items' viewsOf).
  const zone = userZone(cfg);
  const facts = await inboxFacts(ctx, cfg).catch(() => []);
  const marks = ctx.plan ? await ctx.plan.inboxMarks().catch(() => new Map()) : new Map();
  const today = localToday(now, zone);
  const shownIds = new Set<number>();
  for (const f of facts) {
    const k = parseKey(f.key);
    if (f.kind !== "promise" || k?.source !== "chatPromise") continue;
    const views = viewsOf(f, marks.get(f.key), today, now);
    if (views.includes("promises") || views.includes("needs_you")) shownIds.add(k.id);
  }
  const byReason = zeroReasons();
  const rows: PromiseRow[] = [];
  for (const c of committed) {
    const r = promiseReason(commitments.filter((k) => k.conversationId === c.id), { id: v.me, name: meName }, { otherUserIds, shownIds });
    byReason[r]++;
    if (isPromiseGap(r)) rows.push({ conversationId: c.id, clientName: clientName(c.clientKey), title: c.title, reason: r });
  }

  // 1b. My own promise-sounding messages in the window with no commitment of mine (why extraction didn't make one).
  const phrases = cfg.asks.promisePhrases;
  const extraction: Diagnostics["promises"]["extraction"] = { checked: 0, byReason: {}, rows: [] };
  const chats: Diagnostics["chats"] = [];
  for (const chat of v.chats) {
    const stored = (await v.teams.messagesBefore(chat.chatId, now, PER_CHAT)).filter((m) => Date.parse(m.createdAt) >= Date.parse(since));
    const places = await v.convs.placesSince([chat.chatId], since);
    const placeOf = new Map(places.map((p) => [p.messageId, p]));
    const inChat = await v.convs.commitmentsIn((await v.convs.conversations([chat.chatId])).map((c) => c.id));
    const loose = (await v.convs.commitmentsBy([chat.chatId])).filter((k) => k.conversationId === null);
    const all = [...inChat, ...loose];
    for (const m of stored) {
      if (!same(m.senderId, v.me) || !promisePhrase(m.text, phrases)) continue;
      extraction.checked++;
      const holding = all.filter((k) => k.messageIds.includes(m.messageId));
      if (holding.some((k) => same(k.whoId, v.me))) continue;
      const reason = extractionReason(placeOf.get(m.messageId) ?? null, holding[0] ? { whoId: holding[0].whoId } : null);
      extraction.byReason[reason] = (extraction.byReason[reason] ?? 0) + 1;
      const conv = placeOf.get(m.messageId)?.conversationId;
      const title = (conv !== null && conv !== undefined ? convs.find((c) => c.id === conv)?.title : null) ?? chat.displayName;
      const row: ExtractionRow = { clientName: clientName(chat.clientKey), title, reason, retry: extractionRetry(reason) };
      if (!extraction.rows.some((x) => x.title === row.title && x.reason === row.reason)) extraction.rows.push(row);
    }
    // 2. Chatter filter check (Q-QF1-3): each stored message's outcome, and my own marks.
    const { outcomes, marks: mine } = chatOutcomes(stored.map((m) => m.messageId), places, since, v.me);
    chats.push({ chatName: chat.displayName, clientName: clientName(chat.clientKey), kind: chat.kind, social: !!chat.social, total: stored.length, outcomes, marks: mine });
  }

  return { at: now, days: DIAGNOSTICS_DAYS, promises: { byStatus, committed: committed.length, byReason, rows, extraction }, chats };
}
