// QF-1 (part 8): Not work-related is one click on a conversation: its messages move to Chatter and it closes for
// everyone on the chat (out of Needs you and Done); Undo brings them back and opens it again. No rule is learned:
// the next message like it is sorted as before.
import { describe, expect, it } from "vitest";
import type { ConversationsData } from "../plan/conversation-views.ts";
import { cfg, people } from "../test/conversation-people.ts";
import { allianceAnswer, CHAT, EVAN, LENA, world } from "../test/conversations.ts";
import { conversationAction, inboxFacts } from "./conversation-actions.ts";

async function setUp() {
  const w = world({ respond: allianceAnswer });
  const m1 = await w.say(CHAT, LENA, "2026-11-04T19:00:00Z", "Evan we see about a 7.7k lb gap between the Movement Dashboard and the BOM report for project 4417001.");
  const m2 = await w.say(CHAT, EVAN, "2026-11-04T19:10:00Z", "Looking into it now");
  await w.run(CHAT, [m1, m2]);
  const [c] = await w.convs.conversations([CHAT.chatId]);
  return { w, c: c!, ids: [m1.messageId, m2.messageId], p: await people(w) };
}

describe("Not work-related", () => {
  it("moves its messages to Chatter and closes it for everyone; Undo puts it back", async () => {
    const { w, c, ids, p } = await setUp();
    expect((await conversationAction(p.as(EVAN).ctx, "conversations.not_work", { id: c.id })).ok).toBe(true);
    const after = await p.as(LENA).run<ConversationsData>("conversations.list");
    expect([...after.needsYou, ...after.inProgress].map((x) => x.id)).not.toContain(c.id);
    expect(after.chatter.flatMap((g) => g.messages.map((m) => m.messageId)).sort()).toEqual([...ids].sort());
    expect((await inboxFacts(p.as(LENA).ctx, cfg)).some((f) => f.key === `v${c.id}`)).toBe(false);
    expect(await w.convs.conversation(c.id)).toMatchObject({ status: "closed", closeReason: "Not work-related" });

    expect((await conversationAction(p.as(EVAN).ctx, "conversations.not_work_undo", { id: c.id })).ok).toBe(true);
    const back = await w.convs.conversation(c.id);
    expect(back?.closedAt).toBeNull();
    expect((await w.convs.placesIn([c.id])).filter((x) => x.role === "work").map((x) => x.messageId).sort()).toEqual([...ids].sort());
    const again = await p.as(LENA).run<ConversationsData>("conversations.list");
    expect(again.chatter.flatMap((g) => g.messages)).toEqual([]);
  });

  it("learns nothing: a message like it afterwards is sorted as before", async () => {
    const { w, c, p } = await setUp();
    await conversationAction(p.as(EVAN).ctx, "conversations.not_work", { id: c.id });
    const before = w.calls.length;
    const m3 = await w.say(CHAT, LENA, "2026-11-04T20:00:00Z", "Evan the BOM report gap is back for project 4417002.");
    await w.run(CHAT, [m3]);
    expect(w.calls.length).toBe(before + 1);
    expect((await w.convs.placeOf(CHAT.chatId, m3.messageId))?.role).toBe("work");
  });

  it("only for someone who sees the conversation", async () => {
    const { c, p } = await setUp();
    const { OUTSIDER } = await import("../test/conversation-people.ts");
    expect((await conversationAction(p.as(OUTSIDER).ctx, "conversations.not_work", { id: c.id })).ok).toBe(false);
  });
});
