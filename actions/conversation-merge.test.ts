// CV-2: Merge into… by hand (one, or several picked), Undo, Split still working after, and Inbox deep links to one
// conversation (selected, a merged one followed to where it went, an unknown one as a plain note). Fictional names.
import { describe, expect, it } from "vitest";
import type { ConversationsData } from "../plan/conversation-views.ts";
import { aClientChat, HOME_TENANT } from "../test/builders/index.ts";
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

describe("Merge into…", () => {
  it("moves messages, commitments and suggestions into the target; the summary is joined without AI; Undo puts it all back", async () => {
    const w = world();
    const { a, b, k } = await twoTopics(w);
    const s = await w.convs.addSuggestion({ conversationId: b.c.id, itemId: 4101, kind: "comment", forUser: EVAN.userId!, body: "x", before: null, after: null, internal: [], day: "2026-11-04" });
    const evan = (await people(w)).as(EVAN);
    const r = await evan.run<ConversationsData & { merges: number[] }>("conversations.merge", { ids: [b.c.id], into: a.c.id });
    expect(r.merges).toHaveLength(1);
    const listed = [...r.needsYou, ...r.teammates, ...r.closed];
    expect(listed.map((c) => c.id)).toEqual([a.c.id]);
    const into = listed[0]!;
    expect(into.summary).toBe("October totals differ from the dashboard.\nLeo thinks the October filter is wrong.");
    expect(into.title).toBe("Shipments report totals differ");
    expect(into.statusLine).toBe("Evan committed");
    expect(into.participants.map((p) => p.name).sort()).toEqual(["Blake Novak", "Lena Hart"]);
    expect((await w.convs.placesIn([a.c.id])).map((p) => p.messageId)).toEqual([...a.ms, ...b.ms].map((m) => m.messageId));
    expect((await w.convs.commitment(k.id))!.conversationId).toBe(a.c.id);
    expect((await w.convs.suggestion(s.id))!.conversationId).toBe(a.c.id);
    // Kept for Undo, never listed, never offered to the pipeline.
    expect((await w.convs.conversation(b.c.id))!.mergedInto).toBe(a.c.id);
    expect((await w.convs.conversations([CHAT.chatId])).map((c) => c.id)).toEqual([a.c.id]);

    const back = await evan.run("conversations.unmerge", { merges: r.merges });
    expect([...back.needsYou, ...back.teammates, ...back.closed].map((c) => c.id).sort()).toEqual([a.c.id, b.c.id].sort());
    expect((await w.convs.placesIn([b.c.id])).map((p) => p.messageId)).toEqual(b.ms.map((m) => m.messageId));
    expect((await w.convs.placesIn([a.c.id])).map((p) => p.messageId)).toEqual(a.ms.map((m) => m.messageId));
    expect((await w.convs.commitment(k.id))!.conversationId).toBe(b.c.id);
    expect((await w.convs.suggestion(s.id))!.conversationId).toBe(b.c.id);
    const a2 = (await w.convs.conversation(a.c.id))!;
    expect(a2.summary).toBe("October totals differ from the dashboard.");
    expect(a2.participants.map((p) => p.name)).toEqual(["Blake Novak"]);
    expect(a2.status).toBe("new");
    expect((await w.convs.conversation(b.c.id))!.status).toBe("committed");
    // Once only.
    expect((await evan.fail("conversations.unmerge", { merges: r.merges })).error).toMatch(/already undone/);
  });

  it("writes the summary with AI when it may (the person's own cap), and falls back to the joined one when the answer is unusable", async () => {
    const w = world();
    const { a, b } = await twoTopics(w);
    const answers = [JSON.stringify({ title: "October totals and the filter", summary: "Totals differ for October.\nThe filter looks wrong.\nEvan will fix it." }), JSON.stringify({ title: "", summary: "" })];
    const asked: string[] = [];
    const ai = { run: async (_t: unknown, input: string) => (asked.push(input), { ok: true as const, value: JSON.parse(answers.shift()!) }) } as unknown as import("../ai/service.ts").AiService;
    const evan = (await people(w, { ai })).as(EVAN);
    const r = await evan.run<ConversationsData>("conversations.merge", { ids: [b.c.id], into: a.c.id });
    expect(r.needsYou.concat(r.teammates)[0]).toMatchObject({ title: "October totals and the filter", summary: "Totals differ for October.\nThe filter looks wrong.\nEvan will fix it." });
    expect(asked[0]).toContain("October filter looks off");
    expect(asked[0]).not.toMatch(/@contoso\.example|@fabrikam\.example/);
  });

  it("merges several picked ones into one, and one Undo brings them all back", async () => {
    const w = world();
    const { a, b } = await twoTopics(w);
    const c = await conversation(w, "A third one", "Another line.", [[EVAN, "2026-11-04T22:40:00Z", "And one more thing about October"]]);
    const evan = (await people(w)).as(EVAN);
    const r = await evan.run<ConversationsData & { merges: number[] }>("conversations.merge", { ids: [b.c.id, c.c.id], into: a.c.id });
    expect(r.merges).toHaveLength(2);
    expect((await w.convs.conversations([CHAT.chatId])).map((x) => x.id)).toEqual([a.c.id]);
    expect((await w.convs.placesIn([a.c.id]))).toHaveLength(4);
    expect((await w.convs.conversation(a.c.id))!.summary.split("\n")).toHaveLength(3);
    await evan.run("conversations.unmerge", { merges: r.merges });
    expect((await w.convs.conversations([CHAT.chatId])).map((x) => x.id).sort()).toEqual([a.c.id, b.c.id, c.c.id].sort());
    expect((await w.convs.conversation(a.c.id))!.summary).toBe("October totals differ from the dashboard.");
  });

  it("refuses another chat, the same one, and anyone who isn't in the chat", async () => {
    const w = world();
    const { a, b } = await twoTopics(w);
    const other = aClientChat({ chatId: "19:contoso-other@thread.v2", clientKey: "contoso", displayName: "Contoso other", members: [EVAN, LENA] });
    const o = await conversation(w, "Elsewhere", "Not here.", [[EVAN, "2026-11-04T22:00:00Z", "Something in another chat"]], other);
    const p = await people(w);
    expect((await p.as(EVAN).fail("conversations.merge", { ids: [o.c.id], into: a.c.id })).error).toMatch(/same chat/);
    expect((await p.as(EVAN).fail("conversations.merge", { ids: [a.c.id], into: a.c.id })).error).toMatch(/another conversation/);
    expect((await p.as(OUTSIDER).fail("conversations.merge", { ids: [b.c.id], into: a.c.id })).status).toBe(404);
    expect((await w.convs.conversations([CHAT.chatId])).map((x) => x.id).sort()).toEqual([a.c.id, b.c.id].sort());
  });

  it("keeps Split: a moved message can still be split off into a new conversation after a merge", async () => {
    const w = world();
    const { a, b } = await twoTopics(w);
    const evan = (await people(w)).as(EVAN);
    await evan.run("conversations.merge", { ids: [b.c.id], into: a.c.id });
    await evan.run("conversations.move", { chatId: CHAT.chatId, messageId: b.ms[0]!.messageId, to: "new" });
    const list = await w.convs.conversations([CHAT.chatId]);
    expect(list).toHaveLength(2);
    const split = list.find((c) => c.id !== a.c.id)!;
    expect((await w.convs.placesIn([split.id])).map((p) => p.messageId)).toEqual([b.ms[0]!.messageId]);
  });

  it("the pipeline joins a new reply to a merged-in message to the target", async () => {
    const w = world({ allowed: [] });
    const { a, b } = await twoTopics(w);
    await (await people(w)).as(EVAN).run("conversations.merge", { ids: [b.c.id], into: a.c.id });
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
    await lena.run("conversations.merge", { ids: [b.c.id], into: a.c.id });
    expect((await lena.run("conversations.list", { select: b.c.id })).selected).toMatchObject({ id: a.c.id, found: true });
    expect((await lena.run("conversations.list", { select: 999 })).selected).toEqual({ id: 999, found: false, where: null });
    // Someone not in the chat: not found, nothing about it.
    expect((await p.as(OUTSIDER).run("conversations.list", { select: a.c.id })).selected).toEqual({ id: a.c.id, found: false, where: null });
  });
});
