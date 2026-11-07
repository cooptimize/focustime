// CV-3b: a follow-up's Who, and a promise's "to whom", never resolve to their own author or owner. My reply to my own
// message, my own @mention and me being the last speaker leave it to the asker or empty; a normal promise still gets
// the right person; the one-time repair clears what was already saved (nothing deleted). Fictional names.
import { describe, expect, it } from "vitest";
import { isOwner, whoNotOwner } from "../plan/follow-who.ts";
import { promiseFrom } from "../plan/asks-ai.ts";
import { aChatMember, aClientChat, aPromiseAnswer, aTeamsMessage } from "../test/builders/index.ts";
import { BLAKE, CHAT, EVAN, SAM, world } from "../test/conversations.ts";
import { addUsers, forEachDriver } from "../test/db.ts";
import { createAdminStore } from "../store/admin-store.ts";
import { createConversationStore } from "../store/conversation-store.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { whoRepair } from "../server/who-repair.ts";
import { backfillPromises } from "./conversation-backfill.ts";

const me = { id: SAM.userId!, names: ["Sam Tester"] };

describe("the owner is never Who", () => {
  it("by person or by name; the fallback is the asker, then no one", () => {
    expect(isOwner({ who: "sam tester " }, me)).toBe(true);
    expect(isOwner({ who: "Sam", whoRef: { kind: "cooptimizer", id: SAM.userId!.toUpperCase(), name: "Sam" } }, me)).toBe(true);
    expect(isOwner({ who: "Evan Ford" }, me)).toBe(false);
    expect(whoNotOwner({ who: "Sam Tester", whoRef: null }, { who: "Evan Ford", whoRef: null }, me)).toEqual({ who: "Evan Ford", whoRef: null });
    expect(whoNotOwner({ who: "Sam Tester", whoRef: null }, { who: "Sam Tester", whoRef: null }, me)).toEqual({ who: null, whoRef: null });
    expect(whoNotOwner({ who: "Blake Novak", whoRef: null }, null, me)).toEqual({ who: "Blake Novak", whoRef: null });
  });

  it("an AI answer naming the author is dropped; another name is kept", () => {
    const o = { messageDay: "2026-11-04", offeredIds: [], names: ["Evan Ford", "Sam Tester"], authorNames: ["Sam Tester"] };
    expect(promiseFrom(aPromiseAnswer({ to_whom: "Sam Tester" }), o)?.toWhom).toBeNull();
    expect(promiseFrom(aPromiseAnswer({ to_whom: "Sam" }), o)?.toWhom).toBeNull();
    expect(promiseFrom(aPromiseAnswer({ to_whom: "Sam Tester, Evan" }), o)?.toWhom).toBe("Evan");
    expect(promiseFrom(aPromiseAnswer({ to_whom: "Evan Ford" }), o)?.toWhom).toBe("Evan Ford");
  });
});

describe("to whom, from the chat (rules)", () => {
  it("my reply to my own message goes to the asker before it, not me", async () => {
    const w = world({ allowed: [] });
    const ask = await w.say(CHAT, EVAN, "2026-11-04T20:50:00Z", "Can someone rerun the export?");
    const first = await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "Looking at the export now");
    const mine = await w.say(CHAT, SAM, "2026-11-04T21:05:00Z", "I'll rerun it tonight", { replyToId: first.messageId });
    await w.run(CHAT, [ask, first, mine]);
    const k = (await w.convs.commitmentsInChat(CHAT.chatId)).find((x) => x.messageIds.includes(mine.messageId))!;
    expect(k).toMatchObject({ whoId: SAM.userId, toId: EVAN.userId, toName: "Evan Ford" });
  });

  it("my own @mention is skipped; with no one else it stays empty", async () => {
    const w = world({ allowed: [] });
    const mine = await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "Note to self: I'll rerun the export", { mentions: [{ id: SAM.userId!, name: "Sam Tester" }] });
    await w.run(CHAT, [mine]);
    expect((await w.convs.commitmentsInChat(CHAT.chatId))[0]).toMatchObject({ toId: null, toName: null });
  });

  it("when the last speaker is me, it's the last other person, or no one", async () => {
    const w = world({ allowed: [] });
    const a = await w.say(CHAT, SAM, "2026-11-04T20:55:00Z", "Pulling the numbers");
    const b = await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll rerun the Salesforce data tonight");
    await w.run(CHAT, [a, b]);
    expect((await w.convs.commitmentsInChat(CHAT.chatId))[0]).toMatchObject({ toId: null, toName: null });
  });

  it("a normal promise still gets the person I answered", async () => {
    const w = world({ allowed: [] });
    const ask = await w.say(CHAT, BLAKE, "2026-11-04T20:50:00Z", "Can you send the totals?");
    const mine = await w.say(CHAT, SAM, "2026-11-04T21:00:00Z", "I'll send them tomorrow", { replyToId: ask.messageId });
    await w.run(CHAT, [ask, mine]);
    expect((await w.convs.commitmentsInChat(CHAT.chatId))[0]).toMatchObject({ toId: BLAKE.userId, toName: "Blake Novak" });
  });
});

const ME = aChatMember({ displayName: "Sam Tester" });
const ASKER = aChatMember({ displayName: "Evan Ford" });
const BCHAT = aClientChat({ chatId: "19:fabrikam-who@thread.v2", clientKey: "fabrikam", members: [ME, ASKER] });
const clock = () => Temporal.Instant.from("2026-11-05T22:00:00Z");

await forEachDriver("CV-3b Who", ({ open }) => {
  async function setup() {
    const db = (await open()).conn;
    await addUsers(db, ME.userId!);
    const teams = createTeamsStore(db, clock);
    const convs = createConversationStore(db, clock, teams);
    const plan = planStoreOn(db, { now: () => clock().toZonedDateTimeISO("America/Chicago"), userId: ME.userId! });
    await teams.addChat({ chatId: BCHAT.chatId, clientKey: BCHAT.clientKey, kind: "customer", displayName: BCHAT.displayName, webUrl: null, members: BCHAT.members, by: ME.userId! });
    const say = async (from: typeof ME, at: string, text: string, more: Partial<Parameters<typeof aTeamsMessage>[0]> = {}) => {
      const m = aTeamsMessage({ chatId: BCHAT.chatId, clientKey: BCHAT.clientKey, senderId: from.userId, senderName: from.displayName, senderTenant: from.tenantId, createdAt: at, modifiedAt: at, text, ...more });
      await teams.saveMessages([m]);
      return m;
    };
    return { db, teams, convs, plan, say };
  }

  it("a moved promise with no reply or mention goes to the last other speaker; with none, a Who of me is cleared", async () => {
    const s = await setup();
    await s.say(ASKER, "2026-11-04T22:30:00Z", "Is the Salesforce data current?");
    const p1 = await s.say(ME, "2026-11-04T22:40:00Z", "I'll rerun the Salesforce data tonight");
    const p2 = await s.say(ME, "2026-11-05T09:00:00Z", "I'll send the notes after lunch");
    const draft = { what: "Rerun the data", due: null, toWhom: "Sam Tester", answers: null, reason: null };
    for (const p of [p1, p2]) await s.plan.addPromise({ chatId: BCHAT.chatId, messageId: p.messageId, clientKey: "fabrikam", phrase: "i'll", at: p.createdAt, draft, aiStatus: null });
    const f1 = await s.plan.addFollowUp({ who: "Sam Tester", what: "Rerun the data", due: null, clientKey: "fabrikam", channel: "teams" });
    const f2 = await s.plan.addFollowUp({ who: "Sam Tester", what: "Send the notes", due: null, clientKey: "fabrikam", channel: "teams" });
    await s.plan.resolvePromise(BCHAT.chatId, p1.messageId, { status: "followup", followUpId: f1.id });
    await s.plan.resolvePromise(BCHAT.chatId, p2.messageId, { status: "followup", followUpId: f2.id });
    const chats = [await s.teams.chat(BCHAT.chatId)].filter((c): c is NonNullable<typeof c> => !!c);
    await backfillPromises({ plan: s.plan, teams: s.teams, convs: s.convs, me: ME.userId!, meName: "Sam Tester", chats });
    expect((await s.plan.getFollowUp(f1.id))!.who).toBe("Evan Ford");
    expect((await s.plan.getFollowUp(f2.id))!).toMatchObject({ who: null, whoRef: null });
  });

  it("the one-time repair clears Who and to-whom that name their owner, deletes nothing, and runs once", async () => {
    const s = await setup();
    const admin = createAdminStore(s.db, clock);
    const mine = await s.plan.addFollowUp({ who: "Sam Tester", what: "Rerun the data", due: null, clientKey: "fabrikam" });
    const byRef = await s.plan.addFollowUp({ who: "Sam", whoRef: { kind: "cooptimizer", id: ME.userId!.toLowerCase(), name: "Sam" }, what: "Check totals", due: null });
    const closed = await s.plan.addFollowUp({ who: "Sam Tester", what: "Old one", due: null });
    await s.plan.closeFollowUp(closed.id, null);
    const other = await s.plan.addFollowUp({ who: "Evan Ford", what: "Send notes", due: null });
    const m = await s.say(ME, "2026-11-05T09:00:00Z", "I'll send it");
    await s.plan.addPromise({ chatId: BCHAT.chatId, messageId: m.messageId, clientKey: "fabrikam", phrase: "i'll", at: m.createdAt, draft: { what: "Send it", due: null, toWhom: "Sam Tester, Evan Ford", answers: null, reason: null }, aiStatus: null });
    const self = await s.convs.addCommitment({ conversationId: null, chatId: BCHAT.chatId, clientKey: "fabrikam", whoId: ME.userId!, whoName: "Sam Tester", toId: ME.userId!, toName: "Sam Tester", what: "Rerun", dueAt: null, dueDate: null, impliesItem: false, messageIds: [m.messageId], reason: null });
    const fine = await s.convs.addCommitment({ conversationId: null, chatId: BCHAT.chatId, clientKey: "fabrikam", whoId: ME.userId!, whoName: "Sam Tester", toId: ASKER.userId!, toName: "Evan Ford", what: "Send", dueAt: null, dueDate: null, impliesItem: false, messageIds: [], reason: null });
    const logs: unknown[] = [];
    const run = () => whoRepair({ store: admin, log: (r) => logs.push(r), people: async () => [{ owner: { id: ME.userId!, names: ["Sam Tester"] }, clear: (o) => s.plan.clearOwnWho(o) }], commitments: () => s.convs.clearSelfTo() });
    expect(await run()).toEqual({ ran: true, followUps: 3, promises: 1, commitments: 1 });
    for (const id of [mine.id, byRef.id, closed.id]) expect((await s.plan.getFollowUp(id))!).toMatchObject({ who: null, whoRef: null });
    expect((await s.plan.getFollowUp(other.id))!.who).toBe("Evan Ford");
    expect((await s.plan.getFollowUp(closed.id))!.closedAt).not.toBeNull();
    expect((await s.plan.promise(BCHAT.chatId, m.messageId))!.toWhom).toBe("Evan Ford");
    expect(await s.convs.commitment(self.id)).toMatchObject({ toId: null, toName: null, whoId: ME.userId });
    expect(await s.convs.commitment(fine.id)).toMatchObject({ toName: "Evan Ford" });
    expect(JSON.stringify(logs)).not.toMatch(/Sam|Evan|Rerun/);
    expect(await run()).toEqual({ ran: false, followUps: 0, promises: 0, commitments: 0 });
  });
});
