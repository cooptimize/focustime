// CV-1: the shared conversation store on both drivers: conversations, places, commitments, suggestions, the per-chat
// AI count, the app's AI log, counts for Admin › Status, and the viewer's gate (only chats I'm in now, D521).
import { expect, it } from "vitest";
import { aChatMember, aClientChat, aTeamsMessage } from "../test/builders/index.ts";
import { forEachDriver } from "../test/db.ts";
import { createConversationStore } from "./conversation-store.ts";
import { createTeamsStore } from "./teams-store.ts";

const clock = () => Temporal.Instant.from("2026-11-04T15:00:00Z");
const ME = aChatMember({ displayName: "Sam Tester" });
const OTHER = aChatMember({ displayName: "Not In It" });
const CLIENT = aChatMember({ displayName: "Dana Client", external: true });
const CHAT = aClientChat({ members: [ME, CLIENT] });

await forEachDriver("conversations (CV-1)", ({ open }) => {
  async function setup() {
    const db = (await open()).conn;
    const teams = createTeamsStore(db, clock);
    const convs = createConversationStore(db, clock, teams);
    await teams.addChat({ chatId: CHAT.chatId, clientKey: CHAT.clientKey, kind: "customer", displayName: CHAT.displayName, webUrl: null, members: CHAT.members, by: ME.userId! });
    const m = aTeamsMessage({ chatId: CHAT.chatId, senderId: CLIENT.userId, createdAt: "2026-11-04T14:00:00Z" });
    await teams.saveMessages([m]);
    return { db, teams, convs, m };
  }

  it("round-trips a conversation, its places, a commitment and a suggestion; Updated bumps the version", async () => {
    const { convs, m } = await setup();
    const c = await convs.addConversation({ chatId: CHAT.chatId, clientKey: "fabrikam", title: "Weekly totals", summary: "Asked about totals.", participants: [{ id: CLIENT.userId!, name: "Dana Client", external: true }], firstAt: m.createdAt, lastAt: m.createdAt, lastWorkAt: m.createdAt });
    await convs.place([{ chatId: CHAT.chatId, messageId: m.messageId, conversationId: c.id, role: "work", reason: null, placedBy: "ai", at: m.createdAt }]);
    expect((await convs.placesIn([c.id])).map((p) => p.messageId)).toEqual([m.messageId]);
    const u = await convs.updateConversation(c.id, { summary: "Asked about totals.\nSam is on it.", ownerId: ME.userId!, itemChange: { kind: "root_cause", note: "Bridging", at: m.createdAt, scope: false } }, { bump: true });
    expect(u).toMatchObject({ version: 2, ownerId: ME.userId, itemChange: { kind: "root_cause", note: "Bridging" } });
    const k = await convs.addCommitment({ conversationId: c.id, chatId: CHAT.chatId, clientKey: "fabrikam", whoId: ME.userId!, whoName: "Sam Tester", toId: CLIENT.userId!, toName: "Dana Client", what: "Check the totals", dueAt: "2026-11-05T01:30:00Z", dueDate: "2026-11-04", impliesItem: true, messageIds: [m.messageId], reason: null });
    const k2 = await convs.updateCommitment(k.id, { draft: { title: "Totals", asked: "a", checkFirst: ["b"], likelyChange: "c", openQuestions: [], level: "bug", parentId: null, likelyItem: null, byAi: false }, state: "linked", itemId: 42 });
    expect(k2).toMatchObject({ state: "linked", itemId: 42, draft: { title: "Totals" }, impliesItem: true });
    expect((await convs.openItemCommitments()).length).toBe(0);
    const s = await convs.addSuggestion({ conversationId: c.id, itemId: 42, kind: "comment", forUser: ME.userId!, body: "Root cause: bridging.", before: null, after: null, internal: [], day: "2026-11-04" });
    expect(await convs.suggestedOn(42, "2026-11-04")).toBe(true);
    await convs.settleSuggestion(s.id, "posted", 7);
    expect(await convs.suggestion(s.id)).toMatchObject({ state: "posted", writeId: 7 });
    expect(await convs.countAiCall(CHAT.chatId, "2026-11-04")).toBe(1);
    expect(await convs.countAiCall(CHAT.chatId, "2026-11-04")).toBe(2);
    await convs.appAiLog.add({ at: "2026-11-04T14:30:00Z", task: "conversations.update", clientKey: "fabrikam", model: "m", inputTokens: 3000, outputTokens: 600, costMicros: 600, latencyMs: 1200, outcome: "ok", detail: null });
    expect(await convs.appAiLog.spentMicros("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).toBe(600);
    const counts = await convs.counts("2026-11-04");
    expect(counts.conversationsByStatus.new).toBe(1);
    expect(counts.messagesByRole.work).toBe(1);
    expect(counts.commitmentsByState.linked).toBe(1);
    expect(counts.aiCallsToday).toEqual([{ chatName: CHAT.displayName, clientKey: "fabrikam", calls: 2 }]);
  });

  it("a person not in the chat sees nothing and changes nothing", async () => {
    const { convs, m } = await setup();
    const c = await convs.addConversation({ chatId: CHAT.chatId, clientKey: "fabrikam", title: "Weekly totals", summary: "", participants: [], firstAt: m.createdAt, lastAt: m.createdAt, lastWorkAt: m.createdAt });
    const outsider = convs.viewer(OTHER.userId!);
    expect(await outsider.conversations([CHAT.chatId])).toEqual([]);
    expect(await outsider.conversation(c.id)).toBeNull();
    await expect(outsider.updateConversation(c.id, { title: "x" })).rejects.toThrow("No such conversation");
    await expect(outsider.place([{ chatId: CHAT.chatId, messageId: m.messageId, conversationId: c.id, role: "work", reason: null, placedBy: "person", at: m.createdAt }])).rejects.toThrow("No such conversation");
    expect((await convs.viewer(ME.userId!).conversations([CHAT.chatId])).map((x) => x.id)).toEqual([c.id]);
  });

  it("work messages outlive the 14 days; chatter goes with its place", async () => {
    const { teams, convs, m } = await setup();
    const chatter = aTeamsMessage({ chatId: CHAT.chatId, senderId: CLIENT.userId, createdAt: "2026-11-04T14:01:00Z" });
    await teams.saveMessages([chatter]);
    await convs.place([
      { chatId: CHAT.chatId, messageId: m.messageId, conversationId: null, role: "work", reason: null, placedBy: "rule", at: m.createdAt },
      { chatId: CHAT.chatId, messageId: chatter.messageId, conversationId: null, role: "chatter", reason: "emoji", placedBy: "rule", at: chatter.createdAt },
    ]);
    await teams.expire("2026-11-30T00:00:00Z");
    expect(await teams.message(CHAT.chatId, m.messageId)).not.toBeNull();
    expect(await teams.message(CHAT.chatId, chatter.messageId)).toBeNull();
    expect(await convs.placeOf(CHAT.chatId, chatter.messageId)).toBeNull();
  });

  it("CV-2: merges one into another and undoes it, on this driver", async () => {
    const { teams, convs, m } = await setup();
    const m2 = aTeamsMessage({ chatId: CHAT.chatId, senderId: ME.userId, createdAt: "2026-11-04T14:20:00Z" });
    await teams.saveMessages([m2]);
    const at = (x: typeof m) => ({ firstAt: x.createdAt, lastAt: x.createdAt, lastWorkAt: x.createdAt });
    const a = await convs.addConversation({ chatId: CHAT.chatId, clientKey: "fabrikam", title: "Totals", summary: "One.", participants: [{ id: CLIENT.userId!, name: "Dana Client", external: true }], ...at(m) });
    const b = await convs.addConversation({ chatId: CHAT.chatId, clientKey: "fabrikam", title: "Filter", summary: "Two.", participants: [{ id: ME.userId!, name: "Sam Tester", external: false }], ...at(m2), item: { id: 42, url: null, title: "Fix" } });
    await convs.place([{ chatId: CHAT.chatId, messageId: m.messageId, conversationId: a.id, role: "work", reason: null, placedBy: "ai", at: m.createdAt }, { chatId: CHAT.chatId, messageId: m2.messageId, conversationId: b.id, role: "work", reason: null, placedBy: "ai", at: m2.createdAt }]);
    const k = await convs.addCommitment({ conversationId: b.id, chatId: CHAT.chatId, clientKey: "fabrikam", whoId: ME.userId!, whoName: "Sam Tester", toId: null, toName: null, what: "Fix it", dueAt: null, dueDate: null, impliesItem: false, messageIds: [m2.messageId], reason: null });
    const r = await convs.viewer(ME.userId!).merge(b.id, a.id, { title: "Totals", summary: "One.\nTwo." });
    expect(r.moved).toEqual({ messageIds: [m2.messageId], commitmentIds: [k.id], suggestionIds: [] });
    const into = (await convs.conversation(a.id))!;
    expect(into).toMatchObject({ summary: "One.\nTwo.", itemId: 42, lastAt: m2.createdAt, version: 2, changeNote: 'Merged with "Filter"' });
    expect(into.participants).toHaveLength(2);
    expect((await convs.conversations([CHAT.chatId])).map((c) => c.id)).toEqual([a.id]);
    // Someone not in the chat can't merge or undo.
    await expect(convs.viewer(OTHER.userId!).unmerge(r.id)).rejects.toThrow(/No such conversation/);
    await convs.viewer(ME.userId!).unmerge(r.id);
    expect((await convs.conversation(a.id))).toMatchObject({ summary: "One.", itemId: null, lastAt: m.createdAt, mergedInto: null });
    expect((await convs.conversation(b.id))).toMatchObject({ mergedInto: null, itemId: 42 });
    expect((await convs.placesIn([b.id])).map((p) => p.messageId)).toEqual([m2.messageId]);
    expect((await convs.commitment(k.id))!.conversationId).toBe(b.id);
    expect((await convs.mergeRecord(r.id))!.undoneAt).not.toBeNull();
  });
});
