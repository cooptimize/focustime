// CV-2: an old merge is still followed (the pipeline joins a reply to the target), and deep links to one conversation
// (selected, a merged one followed to where it went, an unknown one as a plain note). Merge, Undo and Split went in
// RM-1. Fictional names.
import { describe, expect, it } from "vitest";
import { HOME_TENANT } from "../test/builders/index.ts";
import { CHAT, BLAKE, EVAN, LENA, world } from "../test/conversations.ts";
import { OUTSIDER, people, type W } from "../test/conversation-people.ts";

/** A conversation of the chat with these messages placed in it (and the people who wrote them). */
async function conversation(w: W, title: string, summary: string, said: [typeof EVAN, string, string][], chat = CHAT) {
  const ms = [];
  for (const [who, at, text] of said) ms.push(await w.say(chat, who, at, text));
  const c = await w.convs.addConversation({ chatId: chat.chatId, clientKey: chat.clientKey, title, summary, participants: said.map(([who]) => ({ id: who.userId!, name: who.displayName!, external: who.tenantId !== HOME_TENANT })).filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i), firstAt: ms[0]!.createdAt, lastAt: ms.at(-1)!.createdAt, lastWorkAt: ms.at(-1)!.createdAt });
  await w.convs.place(ms.map((m) => ({ chatId: chat.chatId, messageId: m.messageId, conversationId: c.id, role: "work" as const, reason: null, placedBy: "ai" as const, at: m.createdAt })));
  return { c, ms };
}

async function twoTopics(w: W) {
  const a = await conversation(w, "Shipments report totals differ", "October totals differ from the dashboard.", [[BLAKE, "2026-11-04T21:13:00Z", "The totals on the shipments report don't match the dashboard for October."], [BLAKE, "2026-11-04T21:14:00Z", "Here's what I see"]]);
  const b = await conversation(w, "October filter looks off", "Leo thinks the October filter is wrong.", [[LENA, "2026-11-04T22:13:00Z", "Looking at it now, the October filter looks off."]]);
  const k = await w.convs.addCommitment({ conversationId: b.c.id, chatId: CHAT.chatId, clientKey: "contoso", whoId: EVAN.userId!, whoName: "Evan Ford", toId: BLAKE.userId!, toName: "Blake Novak", what: "Fix the October filter", dueAt: null, dueDate: null, impliesItem: true, messageIds: [b.ms[0]!.messageId], reason: null });
  return { a, b, k };
}

/** A merge as the removed conversations.merge left one: its messages moved into the target, the merged one marked. */
async function merged(w: W, fromId: number, intoId: number) {
  await w.conn.run("UPDATE conversation_messages SET conversation_id = ? WHERE conversation_id = ?", [intoId, fromId]);
  await w.conn.run("UPDATE commitments SET conversation_id = ? WHERE conversation_id = ?", [intoId, fromId]);
  await w.conn.run("UPDATE conversations SET merged_into = ?, version = version + 1 WHERE id = ?", [intoId, fromId]);
}

describe("an old merge (RM-1: nothing merges any more; old ones are still followed)", () => {
  it("the pipeline joins a new reply to a merged-in message to the target", async () => {
    const w = world({ allowed: [] });
    const { a, b } = await twoTopics(w);
    await merged(w, b.c.id, a.c.id);
    const reply = await w.say(CHAT, EVAN, "2026-11-04T22:50:00Z", "Found it, the filter used the wrong year", { replyToId: b.ms[0]!.messageId });
    await w.run(CHAT, [reply]);
    expect((await w.convs.placeOf(CHAT.chatId, reply.messageId))!.conversationId).toBe(a.c.id);
  });
});

describe("deep links to one conversation", () => {
  it("selects it, says where it is, follows a merge, and says plainly when it isn't here", async () => {
    const w = world();
    const { a, b } = await twoTopics(w);
    const p = await people(w);
    const lena = p.as(LENA);
    expect((await lena.run("conversations.list", { select: b.c.id })).selected).toEqual({ id: b.c.id, found: true, where: "needs" });
    expect((await lena.run("conversations.list", { select: a.c.id })).selected).toMatchObject({ id: a.c.id, found: true });
    await merged(w, b.c.id, a.c.id);
    expect((await lena.run("conversations.list", { select: b.c.id })).selected).toMatchObject({ id: a.c.id, found: true });
    expect((await lena.run("conversations.list", { select: 999 })).selected).toEqual({ id: 999, found: false, where: null });
    // Someone not in the chat: not found, nothing about it.
    expect((await p.as(OUTSIDER).run("conversations.list", { select: a.c.id })).selected).toEqual({ id: a.c.id, found: false, where: null });
  });
});
