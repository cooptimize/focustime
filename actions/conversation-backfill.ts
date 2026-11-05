// CV-1: the add-only migration of what AP-1 and AP-2 kept (D468: the old tables stay, nothing is dropped or renamed).
// Done in code, idempotent, so it runs on SQLite and SQL Server alike and can run again: each Request becomes (part
// of) a conversation, marked with the Request it came from (conversations.from_chat_id, from_message_id), keeping its
// state, item link and resolution; requests in the same chat with the same state within 45 minutes of each other share
// one. Each person's promises move to the shared commitments the first time they open Conversations or My promises:
// one commitment per group of their consecutive messages (merged), "to" fixed to the person they answered or
// mentioned (never themselves), and a follow-up made from one gets that Who. The old promise rows are marked moved.
import { askTitle } from "../plan/asks.ts";
import { impliesItemByRule } from "./conversations-pipeline.ts";
import type { StoredPromise } from "../plan/asks-ai.ts";
import { isExternal } from "../plan/chats.ts";
import { messageGroups, NEAR_MINUTES, oneLine, type CommitmentState, type ConversationStatus, type Participant } from "../plan/conversations.ts";
import type { ClientChat, Request } from "../plan/requests.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import type { PlanStore } from "../store/plan-store.ts";
import type { TeamsStore } from "../store/teams-store.ts";

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

const STATUS_OF: Record<Request["status"], ConversationStatus> = { open: "new", created: "tracked", linked: "tracked", handled: "resolved", dismissed: "closed" };

/** Requests → conversations, for every registered chat. Returns how many conversations it made. */
export async function backfillRequests(teams: TeamsStore, convs: ConversationStore, homeTenant: string | null): Promise<number> {
  let made = 0;
  for (const chat of await teams.chats()) {
    const rs = (await teams.requests([chat.chatId])).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let group: Request[] = [];
    const flush = async () => {
      if (group.length && (await mergeGroup(teams, convs, chat, group, homeTenant))) made++;
      group = [];
    };
    for (const r of rs) {
      const prev = group.at(-1);
      const near = prev && Date.parse(r.createdAt) - Date.parse(prev.createdAt) <= NEAR_MINUTES * 60_000 && prev.status === r.status && (prev.itemId ?? null) === (r.itemId ?? null);
      if (!near) await flush();
      group.push(r);
    }
    await flush();
  }
  return made;
}

async function mergeGroup(teams: TeamsStore, convs: ConversationStore, chat: ClientChat, group: Request[], home: string | null): Promise<boolean> {
  // Already moved (any of its requests): place the rest in that conversation.
  let conv = null;
  for (const r of group) conv ??= await convs.fromRequest(r.chatId, r.messageId);
  const first = group[0]!;
  const last = group.at(-1)!;
  const participants: Participant[] = [];
  const texts: string[] = [];
  for (const r of group) {
    const m = await teams.message(r.chatId, r.messageId);
    if (m?.text) texts.push(m.text);
    if (m?.senderId && !participants.some((p) => same(p.id, m.senderId))) {
      const member = chat.members?.find((x) => same(x.userId, m.senderId));
      participants.push({ id: m.senderId, name: m.senderName ?? member?.displayName ?? "Someone", external: home ? isExternal({ tenantId: m.senderTenant ?? member?.tenantId ?? null }, home) : false });
    }
  }
  const created = !conv;
  if (!conv) {
    const status = STATUS_OF[last.status];
    const title = first.sort?.title ?? askTitle(texts[0] ?? "A request");
    const closed = last.status === "handled" || last.status === "dismissed" ? { by: last.resolvedBy, at: last.resolvedAt ?? last.createdAt, reason: last.note } : null;
    conv = await convs.addConversation({
      chatId: chat.chatId, clientKey: chat.clientKey, title: oneLine(title, 120) || "A request", summary: oneLine(first.sort?.description ?? texts.join(" "), 600), participants,
      firstAt: first.createdAt, lastAt: last.createdAt, lastWorkAt: last.createdAt, status,
      item: last.itemId ? { id: last.itemId, url: last.itemUrl, title: last.itemTitle } : null, closed, from: { chatId: first.chatId, messageId: first.messageId }, changeNote: null,
    });
  }
  const places = [];
  for (const r of group) {
    if (await convs.placeOf(r.chatId, r.messageId)) continue;
    places.push({ chatId: r.chatId, messageId: r.messageId, conversationId: conv.id, role: "work" as const, reason: null, placedBy: "rule" as const, at: r.createdAt });
  }
  if (places.length) await convs.place(places);
  return created;
}

const PROMISE_STATE: Record<StoredPromise["status"], CommitmentState> = { open: "open", followup: "followup", linked: "linked", done: "done", dismissed: "not_needed" };

/**
 * One person's promises → commitments (merged per group of their consecutive messages). Idempotent: a moved promise
 * isn't listed again (promises() leaves out moved rows), and a group already made is found by its first message.
 */
export async function backfillPromises(o: { plan: PlanStore; teams: TeamsStore; convs: ConversationStore; me: string; meName: string; chats: readonly ClientChat[] }): Promise<number> {
  const open = await o.plan.promises();
  if (!open.length) return 0;
  let moved = 0;
  for (const chat of o.chats) {
    const mine = open.filter((p) => p.chatId === chat.chatId);
    if (!mine.length) continue;
    const msgs = (await Promise.all(mine.map((p) => o.teams.message(p.chatId, p.messageId)))).map((m, i) => ({ p: mine[i]!, m }));
    const groups = messageGroups(msgs.map(({ p, m }) => ({ messageId: p.messageId, senderId: o.me, createdAt: m?.createdAt ?? p.createdAt, replyToId: m?.replyToId ?? null })));
    const byGroup = new Map<string, typeof msgs>();
    for (const x of msgs) {
      const g = groups.get(x.p.messageId) ?? x.p.messageId;
      byGroup.set(g, [...(byGroup.get(g) ?? []), x]);
    }
    for (const xs of byGroup.values()) {
      xs.sort((a, b) => a.p.createdAt.localeCompare(b.p.createdAt));
      const firstKey = `${chat.chatId}:${xs[0]!.p.messageId}`;
      let k = await o.convs.fromPromise(firstKey);
      // The one to keep: the most advanced state, else the latest what and due.
      const rank: Record<StoredPromise["status"], number> = { linked: 4, followup: 3, done: 2, dismissed: 1, open: 0 };
      const best = [...xs].sort((a, b) => rank[b.p.status] - rank[a.p.status] || b.p.createdAt.localeCompare(a.p.createdAt))[0]!.p;
      const to = await toOf(o.teams, chat, xs.map((x) => x.m), o.me);
      if (!k) {
        const placed = await o.convs.placeOf(chat.chatId, xs[0]!.p.messageId);
        k = await o.convs.addCommitment({
          conversationId: placed?.conversationId ?? null, chatId: chat.chatId, clientKey: chat.clientKey, whoId: o.me, whoName: o.meName, toId: to?.id ?? null, toName: to?.name ?? null,
          what: oneLine(best.what, 200) || "A promise", dueAt: null, dueDate: best.due, impliesItem: impliesItemByRule([best.what, ...xs.map((x) => x.m?.text ?? "")].join("\n")), messageIds: xs.map((x) => x.p.messageId), reason: best.reason, state: PROMISE_STATE[best.status], fromPromise: firstKey, createdAt: xs[0]!.p.createdAt,
        });
        if (best.followUpId !== null || best.itemId !== null) k = await o.convs.updateCommitment(k.id, { ...(best.followUpId !== null ? { followUpId: best.followUpId } : {}), ...(best.itemId !== null ? { itemId: best.itemId, itemUrl: best.itemUrl, itemTitle: best.itemTitle } : {}) });
      }
      // A follow-up made from it gets the right Who (the person I answered, never me).
      // CV-3b: with no one found, a Who that is me is cleared (never left as me).
      if (best.followUpId !== null) {
        const f = await o.plan.getFollowUp(best.followUpId);
        const isMe = !!f && (same(f.who, o.meName) || (f.whoRef?.kind === "cooptimizer" && same(f.whoRef.id, o.me)));
        if (f && !f.closedAt && to?.name && (!f.who || isMe)) await o.plan.editFollowUp(f.id, { who: to.name, whoRef: null });
        else if (f && !f.closedAt && isMe) await o.plan.editFollowUp(f.id, { who: null, whoRef: null });
      }
      for (const x of xs) await o.plan.markPromiseMoved(x.p.chatId, x.p.messageId, k.id);
      moved += xs.length;
    }
  }
  return moved;
}

/** "To": the person whose message I replied to, else the first person I mentioned, never me. */
async function toOf(teams: TeamsStore, chat: ClientChat, ms: readonly (Awaited<ReturnType<TeamsStore["message"]>> | null)[], me: string): Promise<{ id: string | null; name: string } | null> {
  for (const m of ms) {
    if (!m?.replyToId) continue;
    const r = await teams.message(chat.chatId, m.replyToId);
    if (r?.senderId && !same(r.senderId, me)) return { id: r.senderId, name: r.senderName ?? chat.members?.find((x) => same(x.userId, r.senderId))?.displayName ?? "Someone" };
  }
  for (const m of ms) {
    const at = m?.mentions.find((x) => !same(x.id, me));
    if (at?.name) return { id: at.id ?? null, name: at.name };
  }
  // CV-3b: else the last other person who wrote in the hour before (the asker), as the pipeline does; never me.
  const first = ms.map((m) => m?.createdAt).filter((t): t is string => !!t).sort()[0];
  if (!first) return null;
  const prior = (await teams.messagesBefore(chat.chatId, first, 20).catch(() => []))
    .filter((x) => x.senderId && !same(x.senderId, me) && Date.parse(x.createdAt) < Date.parse(first) && (Date.parse(first) - Date.parse(x.createdAt)) / 60_000 <= 60)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  return prior?.senderId ? { id: prior.senderId, name: prior.senderName ?? chat.members?.find((x) => same(x.userId, prior.senderId))?.displayName ?? "Someone" } : null;
}
