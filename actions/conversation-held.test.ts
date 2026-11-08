// GD-2 Part 2 and Part 5: the held-back list (only my chats, the matched name, the message as Teams shows it, why),
// Sort for <client> by hand into a conversation (new or open; no AI), Not work-related (to Chatter), Leave held; and the
// "mentions <client>" tag on a conversation in an internal chat, shown to whoever can see it. Fictional names.
import { describe, expect, it } from "vitest";
import type { ConversationsData, HeldData } from "../plan/conversation-views.ts";
import { HELD_LINE } from "../plan/boundary.ts";
import { CLIENT_REFUSED, HELD_MENTION, HELD_STAYS, LEGACY_CLIENT_REFUSED, unsortedLine } from "../plan/conversations.ts";
import { aClientChat, aClientEntry, aConversationUpdate, anUpdateAnswer } from "../test/builders/index.ts";
import { BLAKE, CHAT, EVAN, LENA, SAM, world } from "../test/conversations.ts";
import { OUTSIDER, people } from "../test/conversation-people.ts";
import type { ProviderCall } from "../ai/types.ts";

const directory = [aClientEntry({ key: "contoso", names: ["Contoso Supply"], projects: [], itemIds: [] }), aClientEntry({ key: "wingtip", names: ["Wingtip"], aliases: ["WTG"], projects: [], itemIds: [] })];
const boundary = async (clientKey: string) => ({ internal: false, directory: directory.filter(() => clientKey !== "internal") });
const everyWork = (c: ProviderCall) => {
  const input = JSON.parse(c.input) as { messages: { ref: string }[] };
  return JSON.stringify(anUpdateAnswer({ messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: "n1", confident_new_topic: false })), conversations: [aConversationUpdate({ ref: "n1", title: "Export totals" })] }));
};

describe("GD-2: the held-back list", () => {
  it("lists the held message for members of its chat, with the matched name and why; nobody else sees it", async () => {
    const w = world({ directory, allowed: ["contoso"], respond: everyWork });
    const m = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Same issue WTG had last month with the export");
    expect(await w.run(CHAT, [m])).toMatchObject({ held: 1 });
    const p = await people(w, { more: { boundary } });
    const held = await p.as(EVAN).run<HeldData>("conversations.held");
    expect(held.messages).toHaveLength(1);
    expect(held.messages[0]).toMatchObject({ chatName: CHAT.displayName, clientName: "Contoso Supply", author: expect.stringContaining("Blake"), matched: ["WTG"], reason: "Mentions WTG", why: HELD_LINE, text: "Same issue WTG had last month with the export" });
    expect(held.messages[0]!.html).toContain('Same issue <mark class="held-match">WTG</mark>');
    expect((await p.as(EVAN).run<ConversationsData>("conversations.list")).heldCount).toBe(1);
    // Not a member of the chat: nothing listed, nothing named.
    expect((await p.as(OUTSIDER).run<HeldData>("conversations.held")).messages).toEqual([]);
  });

  it("Sort for Contoso by hand puts it in a new or an open conversation without AI, with the tag; Not work-related sends one to Chatter", async () => {
    const w = world({ directory, allowed: ["contoso"], respond: everyWork });
    const open = await w.say(CHAT, BLAKE, "2026-11-04T14:00:00Z", "Can someone look at the export totals before Friday?");
    await w.run(CHAT, [open]);
    const [conv] = await w.convs.conversations([CHAT.chatId]);
    const calls = w.calls.length;
    const a = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Same issue Wingtip had last month");
    const b = await w.say(CHAT, BLAKE, "2026-11-04T15:05:00Z", "Wingtip's lunch was great");
    const c = await w.say(CHAT, BLAKE, "2026-11-04T15:10:00Z", "Wingtip asked the same thing");
    expect(await w.run(CHAT, [a, b, c])).toMatchObject({ held: 3 });
    expect(w.calls).toHaveLength(calls);
    const p = await people(w, { more: { boundary } });
    const held = await p.as(EVAN).run<HeldData>("conversations.held");
    expect(held.conversations[CHAT.chatId]?.map((x) => x.id)).toEqual([conv!.id]);
    // Into the open conversation.
    await p.as(EVAN).run("conversations.move", { chatId: CHAT.chatId, messageId: a.messageId, to: conv!.id });
    expect((await w.convs.placeOf(CHAT.chatId, a.messageId))).toMatchObject({ role: "work", conversationId: conv!.id });
    // Not work-related: Chatter, placed by a person.
    await p.as(EVAN).run("conversations.held_not_work", { chatId: CHAT.chatId, messageId: b.messageId });
    expect(await w.convs.placeOf(CHAT.chatId, b.messageId)).toMatchObject({ role: "chatter", placedBy: "person" });
    // Into a new one.
    await p.as(EVAN).run("conversations.move", { chatId: CHAT.chatId, messageId: c.messageId, to: "new" });
    expect(await w.convs.conversations([CHAT.chatId])).toHaveLength(2);
    // No AI for any of it; nothing left held.
    expect(w.calls).toHaveLength(calls);
    expect((await p.as(EVAN).run<HeldData>("conversations.held")).messages).toEqual([]);
    // The conversation it went into carries the tag.
    const list = await p.as(EVAN).run<ConversationsData>("conversations.list");
    const card = [...list.needsYou, ...list.teammates, ...list.inProgress, ...list.closed].find((x) => x.id === conv!.id);
    expect(card?.mentions).toEqual(["Wingtip"]);
    // Leave held is no action: a held message stays until it is sorted or the chat's retention purges it.
    expect((await p.as(EVAN).fail("conversations.held_not_work", { chatId: CHAT.chatId, messageId: open.messageId })).status).toBe(404);
  });
});

describe("GD-3: why it's held and the bulk actions", () => {
  it("a held message with no recorded match says Reason unknown and is logged as a count", async () => {
    const w = world({ directory, allowed: ["contoso"], respond: everyWork });
    const m = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Image attached");
    await w.convs.place([{ chatId: m.chatId, messageId: m.messageId, conversationId: null, role: "unsorted", reason: "other_client", placedBy: "rule", at: m.createdAt }]);
    const logs: unknown[] = [];
    const p = await people(w, { more: { boundary, log: (r) => void logs.push(r) } });
    const held = await p.as(EVAN).run<HeldData>("conversations.held");
    expect(held.messages[0]).toMatchObject({ reason: "Reason unknown", matched: [] });
    expect(held.messages[0]!.html).not.toContain("<mark");
    expect(logs).toContainEqual(expect.objectContaining({ op: "held_reason_unknown", count: 1 }));
  });

  const heldThree = async () => {
    const w = world({ directory, allowed: ["contoso"], respond: everyWork });
    const ms = [await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Same issue Wingtip had"), await w.say(CHAT, BLAKE, "2026-11-04T15:05:00Z", "WTG asked too"), await w.say(CHAT, BLAKE, "2026-11-04T15:10:00Z", "Wingtip again")];
    await w.run(CHAT, ms);
    return { w, p: await people(w, { more: { boundary } }), ms };
  };

  it("the client's count is on the list, and Sort all makes one conversation in the chat, with the tag and no AI", async () => {
    const { w, p, ms } = await heldThree();
    const calls = w.calls.length;
    expect((await p.as(EVAN).run<HeldData>("conversations.held")).clients).toEqual([{ clientKey: "contoso", clientName: "Contoso Supply", count: 3 }]);
    await p.as(EVAN).run("conversations.held_bulk", { clientKey: "contoso", mode: "sort", count: 3 });
    const all = await w.convs.conversations([CHAT.chatId]);
    expect(all).toHaveLength(1);
    expect(all[0]!.mentions).toEqual(["wingtip"]);
    for (const m of ms) expect(await w.convs.placeOf(CHAT.chatId, m.messageId)).toMatchObject({ role: "work", conversationId: all[0]!.id, placedBy: "person", matched: null });
    expect(w.calls).toHaveLength(calls);
    expect((await p.as(EVAN).run<HeldData>("conversations.held")).clients).toEqual([]);
  });

  it("Mark all sends them to Chatter; a count that no longer matches what the confirm showed is refused", async () => {
    const { w, p, ms } = await heldThree();
    expect((await p.as(EVAN).fail("conversations.held_bulk", { clientKey: "contoso", mode: "not_work", count: 2 })).status).toBe(409);
    expect((await w.convs.placeOf(CHAT.chatId, ms[0]!.messageId))?.role).toBe("unsorted");
    await p.as(EVAN).run("conversations.held_bulk", { clientKey: "contoso", mode: "not_work", count: 3 });
    for (const m of ms) expect(await w.convs.placeOf(CHAT.chatId, m.messageId)).toMatchObject({ role: "chatter", placedBy: "person" });
  });

  it("someone who can't see the chat can't act on it", async () => {
    const { w, p, ms } = await heldThree();
    expect((await p.as(OUTSIDER).run<HeldData>("conversations.held")).clients).toEqual([]);
    await p.as(OUTSIDER).fail("conversations.held_bulk", { clientKey: "contoso", mode: "not_work", count: 3 });
    expect((await w.convs.placeOf(CHAT.chatId, ms[0]!.messageId))?.role).toBe("unsorted");
  });

  it("the wording says how long they stay held, and the old promise is gone", () => {
    for (const r of [CLIENT_REFUSED, LEGACY_CLIENT_REFUSED, HELD_MENTION]) {
      expect(unsortedLine(r, "Contoso").fix).toContain(HELD_STAYS);
      expect(unsortedLine(r, "Contoso").fix).not.toMatch(/checked again/);
    }
  });
});

describe("GD-2: the mentions tag", () => {
  it("a conversation in an all-Cooptimizer chat that names another client shows \"mentions Wingtip\" to the chat's members", async () => {
    const w = world({ directory, allowed: ["contoso"], respond: everyWork });
    const team = aClientChat({ chatId: "19:contoso-team@thread.v2", clientKey: "contoso", kind: "delivery", displayName: "Contoso team", members: [EVAN, LENA, SAM] });
    const m = await w.say(team, EVAN, "2026-11-04T15:00:00Z", "Same issue Wingtip had last month, can someone check the export?");
    expect(await w.run(team, [m])).toMatchObject({ held: 0, conversations: 1 });
    const p = await people(w, { more: { boundary } });
    const list = await p.as(SAM).run<ConversationsData>("conversations.list");
    const all = [...list.needsYou, ...list.teammates, ...list.inProgress, ...list.closed];
    expect(all.find((x) => x.chatId === team.chatId)?.mentions).toEqual(["Wingtip"]);
    // Someone outside the chat sees neither the conversation nor the tag.
    const out = await p.as(OUTSIDER).run<ConversationsData>("conversations.list");
    expect([...out.needsYou, ...out.teammates, ...out.inProgress, ...out.closed].some((x) => x.chatId === team.chatId)).toBe(false);
  });
});

describe("HK-7: a client named after an ordinary word", () => {
  it("in a client-facing chat, \"Summit\" holds the message and \"the summit\" doesn't (Match only as written)", async () => {
    const dir = [aClientEntry({ key: "contoso", names: ["Contoso Supply"], projects: [], itemIds: [] }), aClientEntry({ key: "Summit", names: ["Summit"], projects: [], itemIds: [], exactCase: true })];
    const w = world({ directory: dir, allowed: ["contoso"], respond: everyWork });
    const word = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "The team summit moved the export review to Friday");
    expect(await w.run(CHAT, [word])).toMatchObject({ held: 0 });
    const name = await w.say(CHAT, BLAKE, "2026-11-04T15:05:00Z", "Summit had the same export issue last month");
    expect(await w.run(CHAT, [name])).toMatchObject({ held: 1 });
  });
});

