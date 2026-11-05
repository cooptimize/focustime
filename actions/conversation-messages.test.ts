// CV-2: Show messages from the server: the latest 20 with "Show earlier" for the page before, a quoted message looked
// up in the store whatever its age (else the "earlier message" marker), reactions as counts from the stored message
// (replaced when it is read again), and a photo email only for a Cooptimizer. Fictional names.
import { describe, expect, it } from "vitest";
import type { ConversationMessages } from "../plan/conversation-views.ts";
import { BLAKE, CHAT, EVAN, LENA, world } from "../test/conversations.ts";
import { OUTSIDER, people } from "../test/conversation-people.ts";

describe("Show messages", () => {
  it("pages the latest 20, then the 20 before, then the rest", async () => {
    const w = world();
    const ms = [];
    for (let i = 0; i < 45; i++) ms.push(await w.say(CHAT, i % 2 ? EVAN : BLAKE, `2026-11-04T${String(10 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 9).padStart(2, "0")}:00Z`, `Message ${i}`));
    const c = await w.convs.addConversation({ chatId: CHAT.chatId, clientKey: "contoso", title: "Long one", summary: "Long.", participants: [], firstAt: ms[0]!.createdAt, lastAt: ms.at(-1)!.createdAt, lastWorkAt: ms.at(-1)!.createdAt });
    await w.convs.place(ms.map((m) => ({ chatId: CHAT.chatId, messageId: m.messageId, conversationId: c.id, role: "work" as const, reason: null, placedBy: "ai" as const, at: m.createdAt })));
    const lena = (await people(w)).as(LENA);
    const p1 = await lena.run<ConversationMessages>("conversations.messages", { id: c.id });
    expect(p1.messages.map((m) => m.text)).toEqual(ms.slice(25).map((m) => m.text));
    expect(p1).toMatchObject({ total: 45, earlier: ms[25]!.messageId });
    const p2 = await lena.run<ConversationMessages>("conversations.messages", { id: c.id, before: p1.earlier });
    expect(p2.messages.map((m) => m.text)).toEqual(ms.slice(5, 25).map((m) => m.text));
    const p3 = await lena.run<ConversationMessages>("conversations.messages", { id: c.id, before: p2.earlier });
    expect(p3.messages.map((m) => m.text)).toEqual(ms.slice(0, 5).map((m) => m.text));
    expect(p3.earlier).toBeNull();
    // Aliases group by person, never an id.
    expect(new Set(p1.messages.map((m) => m.authorKey))).toEqual(new Set(["p1", "p2"]));
    expect(JSON.stringify(p1)).not.toContain(EVAN.userId!);
  });

  it("quotes the replied message from the store whatever its age, else marks an earlier one; reactions as counts; photo emails only for Cooptimizers", async () => {
    const w = world();
    const old = await w.say(CHAT, BLAKE, "2026-10-20T15:00:00Z", "The October totals are off by 7.7k lb\nMore detail here", { reactions: [{ emoji: "👍", count: 3 }] });
    const reply = await w.say(CHAT, EVAN, "2026-11-04T21:00:00Z", "I'll check the filter", { replyToId: old.messageId, reactions: [{ emoji: "❤️", count: 1 }] });
    const lost = await w.say(CHAT, BLAKE, "2026-11-04T21:05:00Z", "Following up", { replyToId: "1699999999999" });
    const c = await w.convs.addConversation({ chatId: CHAT.chatId, clientKey: "contoso", title: "Totals", summary: "x", participants: [], firstAt: reply.createdAt, lastAt: lost.createdAt, lastWorkAt: lost.createdAt });
    await w.convs.place([reply, lost].map((m) => ({ chatId: CHAT.chatId, messageId: m.messageId, conversationId: c.id, role: "work" as const, reason: null, placedBy: "ai" as const, at: m.createdAt })));
    const r = await (await people(w)).as(LENA).run<ConversationMessages>("conversations.messages", { id: c.id });
    expect(r.messages[0]).toMatchObject({ quote: { author: "Blake Novak", text: "The October totals are off by 7.7k lb" }, reactions: [{ emoji: "❤️", count: 1 }], email: EVAN.email, external: false });
    expect(r.messages[1]).toMatchObject({ quote: { author: null, text: null }, email: null, external: true });
    // Read again with new reactions: they replace the stored ones.
    await w.teams.saveMessages([{ ...reply, modifiedAt: "2026-11-04T21:30:00Z", reactions: [{ emoji: "❤️", count: 2 }, { emoji: "👍", count: 1 }] }]);
    const again = await (await people(w)).as(LENA).run<ConversationMessages>("conversations.messages", { id: c.id });
    expect(again.messages[0]!.reactions).toEqual([{ emoji: "❤️", count: 2 }, { emoji: "👍", count: 1 }]);
  });

  it("isn't there for someone outside the chat", async () => {
    const w = world();
    const m = await w.say(CHAT, BLAKE, "2026-11-04T21:00:00Z", "Hello");
    const c = await w.convs.addConversation({ chatId: CHAT.chatId, clientKey: "contoso", title: "Hello", summary: "x", participants: [], firstAt: m.createdAt, lastAt: m.createdAt, lastWorkAt: m.createdAt });
    expect((await (await people(w)).as(OUTSIDER).fail("conversations.messages", { id: c.id })).status).toBe(404);
  });
});
