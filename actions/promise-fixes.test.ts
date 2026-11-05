// CV-2: My promises fixes. "To whom" comes from an @mention named by the chat's cached members (not only people who
// posted that hour) and from the replied message looked up in the store whatever its age. The DevOps phrases are
// wider ("put it in the queue", "log a ticket", "add a story", "track it", "I'll take it on" with a backlog
// reference). A rules-only promise's "Create the DevOps item?" works: a conversation is made from its own messages and
// the ones just before. "Make it a follow-up" keeps the person it was made to, and the follow-up is amber "Was due"
// past its due, never red. Fictional names.
import { describe, expect, it } from "vitest";
import { promiseDueState, wasDueText } from "../plan/due.ts";
import type { MyPromisesData } from "../plan/conversation-views.ts";
import { BLAKE, CHAT, EVAN, LENA, SAM, world } from "../test/conversations.ts";
import { OUTSIDER, people } from "../test/conversation-people.ts";
import { impliesItemByRule } from "./conversations-pipeline.ts";
import { followUpView } from "./followup-rules.ts";
import { aWorkItem } from "../test/builders/index.ts";
import type { WorkItem } from "../week/types.ts";

describe("to whom", () => {
  it("an @mention of someone who hasn't posted is named from the chat's members", async () => {
    const w = world({ allowed: [] });
    const m = await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll send the totals tonight", { mentions: [{ id: LENA.userId!, name: null }] });
    await w.run(CHAT, [m]);
    expect((await w.convs.commitmentsInChat(CHAT.chatId))[0]).toMatchObject({ toId: LENA.userId, toName: "Lena Hart" });
  });

  it("a reply to a message from weeks ago is answered to its author, from the store", async () => {
    const w = world({ allowed: [] });
    const old = await w.say(CHAT, BLAKE, "2026-10-12T15:00:00Z", "Could someone check the October filter?");
    const reply = await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll check it tomorrow", { replyToId: old.messageId });
    await w.run(CHAT, [reply]);
    expect((await w.convs.commitmentsInChat(CHAT.chatId))[0]).toMatchObject({ toId: BLAKE.userId, toName: "Blake Novak" });
  });
});

describe("DevOps phrases", () => {
  it.each([
    ["I'll put it in the queue today", true],
    ["I'll log a ticket for this", true],
    ["I'll add a story under the dashboard feature", true],
    ["I'll track it", true],
    ["I'll take it on, it's #4102 on the backlog", true],
    ["I'll add it to the dev queue", true],
    // CV-5: an ask or promise that describes work offers an item (the shape that didn't, not its real text).
    ["Add the report cleanup to the backlog and take it on", true],
    ["I'll pick it up from the board this sprint", true],
    ["I'll take it on", false],
    ["I'll send it tonight", false],
    ["I'll check the queue length on the server", false],
  ])("%s", (text, implies) => expect(impliesItemByRule(text)).toBe(implies));

  it("a rules-only promise with one of them asks to create the item", async () => {
    const w = world({ allowed: [] });
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll log a ticket for the filter")]);
    expect((await w.convs.commitmentsInChat(CHAT.chatId))[0]).toMatchObject({ impliesItem: true, conversationId: null });
  });
});

describe("Create the DevOps item? for a promise with no conversation", () => {
  it("makes one from its messages and the ones just before (45 minutes, not placed elsewhere), then the draft works", async () => {
    const w = world({ allowed: [] });
    const far = await w.say(CHAT, BLAKE, "2026-11-04T19:30:00Z", "Unrelated, an hour before");
    const other = await w.say(CHAT, EVAN, "2026-11-04T20:40:00Z", "Something already in a conversation");
    const elsewhere = await w.convs.addConversation({ chatId: CHAT.chatId, clientKey: "contoso", title: "Other", summary: "x", participants: [], firstAt: other.createdAt, lastAt: other.createdAt, lastWorkAt: other.createdAt });
    await w.convs.place([{ chatId: CHAT.chatId, messageId: other.messageId, conversationId: elsewhere.id, role: "work", reason: null, placedBy: "ai", at: other.createdAt }]);
    const ask = await w.say(CHAT, BLAKE, "2026-11-04T20:45:00Z", "The October filter drops the last day of the month");
    const mine = await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll log a ticket for the filter", { replyToId: ask.messageId });
    await w.run(CHAT, [ask, mine]);
    const k = (await w.convs.commitmentsInChat(CHAT.chatId))[0]!;
    expect(k.conversationId).toBeNull();
    const sam = (await people(w)).as(SAM);
    const list = await sam.run<MyPromisesData>("my_promises.list");
    expect(list.promises[0]).toMatchObject({ needsItem: true, conversationId: null });

    const r = await sam.run<{ conversationId: number }>("my_promises.start_draft", { id: k.id });
    const c = (await w.convs.conversation(r.conversationId))!;
    expect(c).toMatchObject({ chatId: CHAT.chatId, clientKey: "contoso", title: "I'll log a ticket for the filter" });
    expect((await w.convs.placesIn([c.id])).map((p) => p.messageId)).toEqual([ask.messageId, mine.messageId]);
    expect((await w.convs.placeOf(CHAT.chatId, far.messageId))?.conversationId ?? null).toBeNull();
    expect((await w.convs.commitment(k.id))!.conversationId).toBe(c.id);
    // Asked again: the same one.
    expect((await sam.run<{ conversationId: number }>("my_promises.start_draft", { id: k.id })).conversationId).toBe(c.id);
    // The usual draft flow runs on it. CV-5: without AI the form is empty for me to fill in, and nothing is kept.
    const d = await sam.run<{ draft: { title: string; byAi: boolean } }>("conversations.draft", { id: c.id, commitmentId: k.id });
    expect(d.draft).toMatchObject({ title: "", byAi: false });
    expect((await w.convs.commitment(k.id))!.draft).toBeNull();
  });

  it("is only for my own open promise", async () => {
    const w = world({ allowed: [] });
    await w.run(CHAT, [await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll log a ticket for the filter")]);
    const k = (await w.convs.commitmentsInChat(CHAT.chatId))[0]!;
    const p = await people(w);
    expect((await p.as(EVAN).fail("my_promises.start_draft", { id: k.id })).status).toBe(400);
    expect((await p.as(OUTSIDER).fail("my_promises.start_draft", { id: k.id })).status).toBe(400);
    await p.as(SAM).run("my_promises.done", { id: k.id });
    expect((await p.as(SAM).fail("my_promises.start_draft", { id: k.id })).status).toBe(409);
  });
});

describe("Make it a follow-up", () => {
  it("keeps the person it was made to, names the promise, and is amber 'Was due' past its due", async () => {
    const w = world({ allowed: [] });
    const ask = await w.say(CHAT, BLAKE, "2026-11-03T15:00:00Z", "Can you send the totals?");
    await w.run(CHAT, [ask, await w.say(CHAT, SAM, "2026-11-03T15:05:00Z", "I'll send them tomorrow", { replyToId: ask.messageId })]);
    const k = (await w.convs.commitmentsInChat(CHAT.chatId))[0]!;
    expect(k.dueDate).toBe("2026-11-04");
    w.setNow("2026-11-05T15:00:00Z");
    const sam = (await people(w)).as(SAM);
    const card = (await sam.run<MyPromisesData>("my_promises.list")).promises[0]!;
    expect(card.toRef).toEqual({ kind: "external", memberId: BLAKE.userId!.toLowerCase(), name: "Blake Novak" });
    expect(card.overdue).toBe(true);
    const r = await sam.run<{ followUpId: number }>("my_promises.followup", { id: k.id, due: "2026-11-04" });
    const f = (await sam.ctx.plan!.getFollowUp(r.followUpId))!;
    expect(f).toMatchObject({ who: "Blake Novak", whoRef: card.toRef, sourceKind: "promise", sourceId: k.id });
    const v = await followUpView(sam.ctx.plan!, f, "2026-11-05", (x) => x);
    expect(v.dueState).toEqual({ level: "was_due", text: "Was due Wed, Nov 4", days: -1 });
  });

  it("a follow-up that isn't a promise's stays Overdue (red); was-due words for a promise", () => {
    expect(promiseDueState("2026-11-06", "2026-11-05")?.level).toBe("tomorrow");
    expect(wasDueText({ dueAt: "2026-11-05T15:00:00Z", dueDate: "2026-11-05" }, "2026-11-05", "America/Chicago")).toBe("Was due 9:00 AM");
    expect(wasDueText({ dueAt: "2026-11-03T15:00:00Z", dueDate: "2026-11-03" }, "2026-11-05", "America/Chicago")).toBe("Was due Tue, Nov 3");
    expect(wasDueText({ dueAt: null, dueDate: "2026-11-02" }, "2026-11-05", "America/Chicago")).toBe("Was due Mon, Nov 2");
  });
});

describe("CV-3: Link existing… suggests likely items (Q-CV2-4)", () => {
  it("for a promise with no conversation: from its words and the messages before it, mine first, with reasons, one client only", async () => {
    const w = world({ allowed: [] });
    const ask = await w.say(CHAT, BLAKE, "2026-11-04T20:45:00Z", "The October filter drops the last day of the month");
    const mine = await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll log a ticket for the filter", { replyToId: ask.messageId });
    await w.run(CHAT, [ask, mine]);
    const k = (await w.convs.commitmentsInChat(CHAT.chatId))[0]!;
    expect(k.conversationId).toBeNull();
    const asked: string[] = [];
    const byClient: Record<string, WorkItem[]> = {
      contoso: [
        aWorkItem({ id: 4201, title: "Month end filter", assignedTo: null, assignedToMe: false }),
        aWorkItem({ id: 4202, title: "October filter last day", assignedTo: null, assignedToMe: false }),
        aWorkItem({ id: 4203, title: "Filter panel styling", assignedToMe: true }),
        aWorkItem({ id: 4204, title: "Vendor login", assignedTo: null, assignedToMe: false }),
      ],
      wingtip: [aWorkItem({ id: 9901, title: "October filter last day of the month" })],
    };
    const sam = (await people(w, { more: { openItems: async (_cfg, key) => (asked.push(key), byClient[key] ?? []) } })).as(SAM);
    const r = await sam.run<{ available: boolean; items: { id: number; reason: string }[] }>("my_promises.search", { id: k.id });
    expect(asked).toEqual(["contoso"]);
    expect(r.items.map((x) => [x.id, x.reason])).toEqual([
      [4203, "Assigned to you · matches filter"],
      [4202, "Matches filter, october, last"],
      [4201, "Matches filter, month"],
    ]);
    // Typing still searches, with no conversation (it used to show nothing).
    expect((await sam.run<{ items: { id: number }[] }>("my_promises.search", { id: k.id, query: "vendor" })).items.map((x) => x.id)).toEqual([4204]);
    // Only my own promise.
    expect((await (await people(w)).as(EVAN).fail("my_promises.search", { id: k.id })).status).toBe(400);
  });
});
