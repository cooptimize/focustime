// CV-1 migration on both drivers (add-only, D468): AP-1's requests group into conversations keeping their state,
// links and resolutions; AP-2's promises merge per group of my messages into commitments, "to" fixed to the person I
// answered, a follow-up made from one gets that Who; the old rows stay (marked moved), and running it again changes
// nothing.
import { expect, it } from "vitest";
import { aChatMember, aClientChat, aTeamsMessage, HOME_TENANT } from "../test/builders/index.ts";
import { addUsers, forEachDriver } from "../test/db.ts";
import { createConversationStore } from "../store/conversation-store.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { backfillPromises, backfillRequests } from "./conversation-backfill.ts";

const NOW = "2026-11-04T22:00:00Z";
const clock = () => Temporal.Instant.from(NOW);
const SAM = aChatMember({ displayName: "Sam Tester" });
const EVAN = aChatMember({ displayName: "Evan Ford" });
const DANA = aChatMember({ displayName: "Dana Client", external: true });
const CHAT = aClientChat({ chatId: "19:fabrikam-backfill@thread.v2", clientKey: "fabrikam", members: [SAM, EVAN, DANA] });

await forEachDriver("CV-1 backfill", ({ open }) => {
  async function setup() {
    const db = (await open()).conn;
    await addUsers(db, SAM.userId!);
    const teams = createTeamsStore(db, clock);
    const convs = createConversationStore(db, clock, teams);
    const plan = planStoreOn(db, { now: () => clock().toZonedDateTimeISO("America/Chicago"), userId: SAM.userId! });
    await teams.addChat({ chatId: CHAT.chatId, clientKey: CHAT.clientKey, kind: "customer", displayName: CHAT.displayName, webUrl: null, members: CHAT.members, by: SAM.userId! });
    const say = async (from: typeof SAM, at: string, text: string, more: Partial<Parameters<typeof aTeamsMessage>[0]> = {}) => {
      const m = aTeamsMessage({ chatId: CHAT.chatId, clientKey: CHAT.clientKey, senderId: from.userId, senderName: from.displayName, senderTenant: from.tenantId, createdAt: at, modifiedAt: at, text, ...more });
      await teams.saveMessages([m]);
      return m;
    };
    return { db, teams, convs, plan, say };
  }

  it("requests become conversations with their state, link and resolution; near ones with the same state share one", async () => {
    const s = await setup();
    const a = await s.say(DANA, "2026-11-04T14:00:00Z", "The totals are wrong");
    const b = await s.say(DANA, "2026-11-04T14:10:00Z", "Also the export fails");
    const c = await s.say(DANA, "2026-11-04T18:00:00Z", "Can you add a weekly view?");
    const d = await s.say(DANA, "2026-11-04T19:00:00Z", "Never mind the logo");
    for (const m of [a, b, c, d]) await s.teams.addRequest({ chatId: CHAT.chatId, messageId: m.messageId, clientKey: "fabrikam", rule: "question", ruleDetail: null, at: m.createdAt });
    await s.teams.resolveRequest(CHAT.chatId, c.messageId, { status: "linked", by: SAM.userId!, itemId: 501, itemUrl: "https://dev.azure.com/fabrikam/_workitems/edit/501", itemTitle: "Weekly view" });
    await s.teams.resolveRequest(CHAT.chatId, d.messageId, { status: "dismissed", by: SAM.userId!, note: "Not needed" });
    expect(await backfillRequests(s.teams, s.convs, HOME_TENANT)).toBe(3);
    const all = (await s.convs.conversations([CHAT.chatId])).sort((x, y) => x.firstAt.localeCompare(y.firstAt));
    expect(all.map((x) => x.status)).toEqual(["new", "tracked", "closed"]);
    expect((await s.convs.placesIn([all[0]!.id])).map((p) => p.messageId).sort()).toEqual([a.messageId, b.messageId].sort());
    expect(all[1]).toMatchObject({ itemId: 501, itemTitle: "Weekly view" });
    expect(all[2]).toMatchObject({ closedBy: SAM.userId, closeReason: "Not needed" });
    expect(all[0]!.participants).toEqual([{ id: DANA.userId, name: "Dana Client", external: true }]);
    // Again: nothing new.
    expect(await backfillRequests(s.teams, s.convs, HOME_TENANT)).toBe(0);
    expect(await s.convs.conversations([CHAT.chatId])).toHaveLength(3);
    // The old rows stay.
    expect(await s.teams.requests([CHAT.chatId])).toHaveLength(4);
  });

  it("my promises merge per group into one commitment, to the person I answered; the follow-up's Who is fixed", async () => {
    const s = await setup();
    const ask = await s.say(EVAN, "2026-11-04T23:20:00Z", "Can we rerun the data today?");
    const p1 = await s.say(SAM, "2026-11-04T23:38:00Z", "Absolutely. I'll get this done tonight.", { replyToId: ask.messageId });
    const p2 = await s.say(SAM, "2026-11-04T23:39:00Z", "I'll be back online around 7:30 PM.");
    const draft = { what: "Rerun the data", due: "2026-11-04", toWhom: null, answers: null, reason: null };
    await s.plan.addPromise({ chatId: CHAT.chatId, messageId: p1.messageId, clientKey: "fabrikam", phrase: "i'll", at: p1.createdAt, draft, aiStatus: null });
    await s.plan.addPromise({ chatId: CHAT.chatId, messageId: p2.messageId, clientKey: "fabrikam", phrase: "i'll", at: p2.createdAt, draft: { ...draft, what: "Come back online" }, aiStatus: null });
    const f = await s.plan.addFollowUp({ who: "Sam Tester", what: "Rerun the data", due: "2026-11-04", clientKey: "fabrikam", channel: "teams" });
    await s.plan.resolvePromise(CHAT.chatId, p1.messageId, { status: "followup", followUpId: f.id });
    const chats = [await s.teams.chat(CHAT.chatId)].filter((c): c is NonNullable<typeof c> => !!c);
    expect(await backfillPromises({ plan: s.plan, teams: s.teams, convs: s.convs, me: SAM.userId!, meName: "Sam Tester", chats })).toBe(2);
    const ks = await s.convs.commitmentsInChat(CHAT.chatId);
    expect(ks).toHaveLength(1);
    expect(ks[0]).toMatchObject({ whoId: SAM.userId, toId: EVAN.userId, toName: "Evan Ford", state: "followup", followUpId: f.id, what: "Rerun the data", dueDate: "2026-11-04" });
    expect(ks[0]!.messageIds.sort()).toEqual([p1.messageId, p2.messageId].sort());
    expect((await s.plan.getFollowUp(f.id))!.who).toBe("Evan Ford");
    // Moved: not listed again, and a second run does nothing.
    expect(await s.plan.promises()).toEqual([]);
    expect(await backfillPromises({ plan: s.plan, teams: s.teams, convs: s.convs, me: SAM.userId!, meName: "Sam Tester", chats })).toBe(0);
    expect(await s.convs.commitmentsInChat(CHAT.chatId)).toHaveLength(1);
  });
});
