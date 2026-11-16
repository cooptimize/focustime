// GD-2 Part 2 and Part 5: a message naming another client in a client-facing chat is held (no AI, its match and
// why kept), and the "mentions <client>" tag on a conversation in an internal chat, shown to whoever can see it.
// Fictional names.
import { describe, expect, it } from "vitest";
import type { ConversationsData } from "../plan/conversation-views.ts";
import { CLIENT_REFUSED, HELD_MENTION, HELD_REASONS, HELD_STAYS, LEGACY_CLIENT_REFUSED, unsortedLine } from "../plan/conversations.ts";
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

describe("GD-2: a held message (RM-1: the held-back list and its actions are gone; holding is unchanged)", () => {
  it("is held, not sent to AI, with the matched name and why kept on its place; the count reaches members of its chat only", async () => {
    const w = world({ directory, allowed: ["contoso"], respond: everyWork });
    const open = await w.say(CHAT, BLAKE, "2026-11-04T14:00:00Z", "Can someone look at the export totals before Friday?");
    await w.run(CHAT, [open]);
    const calls = w.calls.length;
    const m = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Same issue WTG had last month with the export");
    expect(await w.run(CHAT, [m])).toMatchObject({ held: 1 });
    expect(w.calls).toHaveLength(calls);
    const place = (await w.convs.placeOf(CHAT.chatId, m.messageId))!;
    expect(place).toMatchObject({ role: "unsorted", conversationId: null });
    expect(HELD_REASONS.has(place.reason ?? "")).toBe(true);
    expect(place.matched).toEqual([{ key: "wingtip", word: "WTG" }]);
    const p = await people(w, { more: { boundary } });
    expect((await p.as(EVAN).run<ConversationsData>("conversations.list")).heldCount).toBe(1);
    expect((await p.as(OUTSIDER).run<ConversationsData>("conversations.list")).heldCount ?? 0).toBe(0);
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

