// CV-3 (Q-CV2-2): rules-only grouping for clients with AI off (or not set up), behind the client Rule "Group messages
// without AI". A reply, an @mention of someone in it, someone @mentioned in it posting within 45 minutes, or the same
// author within 45 minutes joins an open conversation of the same chat; a Request (AP-1's rules) starts one; anything
// else waits unsorted. Never across chats or clients; decided before any AI call. The Alliance-shaped example is the
// CSC-shaped worked example with fictional names.
import { describe, expect, it } from "vitest";
import { aClientChat } from "../test/builders/index.ts";
import { allianceAnswer, BLAKE, CHAT, EVAN, LENA, SAM, world } from "../test/conversations.ts";

const ON = { groupWithoutAi: true };
const DAY = "2026-11-04";

async function alliance(w: ReturnType<typeof world>, more = ON) {
  const m1 = await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "Evan we see about a 7.7k lb gap between the Movement Dashboard and the BOM report for project 4417001.", { mentions: [{ id: EVAN.userId!, name: "Evan Ford", at: 0 }] });
  const m2 = await w.say(CHAT, EVAN, "2026-11-04T19:10:00Z", "Looking into it with Lena now");
  const m3 = await w.say(CHAT, LENA, "2026-11-04T19:40:00Z", "Bridging:", { hasImage: true });
  await w.run(CHAT, [m1, m2, m3], more);
  const m4 = await w.say(CHAT, EVAN, "2026-11-04T19:55:00Z", "We need to make a change on how we are handling BOMs for bridging on top of a measure change. I will get this into the development queue so we can fix it.");
  const m5 = await w.say(CHAT, LENA, "2026-11-04T19:57:00Z", "Thanks Evan");
  const m6 = await w.say(CHAT, BLAKE, "2026-11-04T19:58:00Z", "Thank you!");
  const second = await w.run(CHAT, [m4, m5, m6], more);
  return { m1, m2, m3, m4, m5, m6, second };
}

describe("rules-only grouping with AI off", () => {
  it("the Alliance example: Blake's request starts it, Evan (mentioned) and his commitment join, thanks wind it down; no AI call", async () => {
    const w = world({ allowed: [] });
    const { m1, m2, m3, m4, m5, m6, second } = await alliance(w);
    const [c, ...more] = await w.convs.conversations([CHAT.chatId]);
    expect(more).toEqual([]);
    expect(c).toMatchObject({ title: "Evan we see about a 7.7k lb gap between the Movement Dashboard and the BOM…", summary: "", status: "committed", windDown: true });
    const places = await w.convs.placesIn([c!.id]);
    expect(places.filter((p) => p.role === "work").map((p) => p.messageId)).toEqual([m1.messageId, m2.messageId, m4.messageId]);
    expect(places.filter((p) => p.role === "ack").map((p) => p.messageId)).toEqual([m5.messageId, m6.messageId]);
    expect(places.every((p) => p.placedBy === "rule")).toBe(true);
    // Lena's image matches no rule: unsorted with the reason, as before.
    expect(await w.convs.placeOf(CHAT.chatId, m3.messageId)).toMatchObject({ role: "unsorted", reason: "client_off" });
    // Evan's promise (a FocusTime user) is in it.
    expect((await w.convs.commitmentsIn([c!.id])).map((k) => k.whoId)).toEqual([EVAN.userId]);
    expect(second).toMatchObject({ aiCalls: 0, aiOutcome: null });
    expect(w.calls).toEqual([]);
    expect(await w.convs.aiCalls(CHAT.chatId, DAY)).toBe(0);
  });

  it("a reply joins whatever its age; an @mention of someone in it joins; the same author joins within 45 minutes only", async () => {
    const w = world({ allowed: [] });
    const ask = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Can you check the refresh? It failed in prod");
    await w.run(CHAT, [ask], ON);
    const conv = (await w.convs.conversations([CHAT.chatId]))[0]!;
    const reply = await w.say(CHAT, SAM, "2026-11-04T18:00:00Z", "Restarted the gateway", { replyToId: ask.messageId });
    const mention = await w.say(CHAT, LENA, "2026-11-04T19:30:00Z", "Blake is it still failing", { mentions: [{ id: BLAKE.userId!, name: "Blake Novak", at: 0 }] });
    const near = await w.say(CHAT, LENA, "2026-11-04T20:10:00Z", "The logs look clean now");
    const far = await w.say(CHAT, LENA, "2026-11-04T21:30:00Z", "New dataset lands Monday");
    await w.run(CHAT, [reply, mention, near, far], ON);
    for (const m of [reply, mention, near]) expect((await w.convs.placeOf(CHAT.chatId, m.messageId))?.conversationId).toBe(conv.id);
    expect(await w.convs.placeOf(CHAT.chatId, far.messageId)).toMatchObject({ role: "unsorted", conversationId: null });
  });

  it("a request takes its author's unsorted messages from the 45 minutes before; its title is its first message, shortened", async () => {
    const w = world({ allowed: [] });
    const text = await w.say(CHAT, BLAKE, "2026-11-04T21:13:00Z", "The totals on the shipments report don't match the dashboard for October.");
    await w.run(CHAT, [text], ON);
    expect(await w.convs.placeOf(CHAT.chatId, text.messageId)).toMatchObject({ role: "unsorted" });
    const img = await w.say(CHAT, BLAKE, "2026-11-04T21:14:00Z", "", { hasImage: true });
    const r = await w.run(CHAT, [img], ON);
    expect(r).toMatchObject({ conversations: 1, work: 1 });
    const c = (await w.convs.conversations([CHAT.chatId]))[0]!;
    expect(c.title).toBe("The totals on the shipments report don't match the dashboard for October.");
    expect((await w.convs.placesIn([c.id])).map((p) => p.messageId)).toEqual([text.messageId, img.messageId]);
  });

  it("never across chats, so never across clients", async () => {
    const w = world({ allowed: [] });
    const FAB = aClientChat({ chatId: "19:fabrikam-ops@thread.v2", clientKey: "fabrikam", displayName: "Fabrikam Ops", members: [EVAN, LENA, BLAKE] });
    const ask = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "@Evan can you check the refresh", { mentions: [{ id: EVAN.userId!, name: "Evan Ford", at: 0 }] });
    await w.run(CHAT, [ask], ON);
    // The same author, a mentioned person and a mention of a participant, minutes later, in another client's chat.
    const same = await w.say(FAB, BLAKE, "2026-11-04T15:05:00Z", "Also the export is slow");
    const mentioned = await w.say(FAB, EVAN, "2026-11-04T15:06:00Z", "On it");
    const mention = await w.say(FAB, LENA, "2026-11-04T15:07:00Z", "Blake which export", { mentions: [{ id: BLAKE.userId!, name: "Blake Novak", at: 0 }] });
    await w.run(FAB, [same, mentioned, mention], ON);
    const contoso = (await w.convs.conversations([CHAT.chatId]))[0]!;
    expect((await w.convs.placesIn([contoso.id])).map((p) => p.messageId)).toEqual([ask.messageId]);
    for (const m of [same, mentioned, mention]) expect((await w.convs.placeOf(FAB.chatId, m.messageId))?.conversationId ?? null).not.toBe(contoso.id);
    expect((await w.convs.conversations([FAB.chatId])).every((c) => c.clientKey === "fabrikam")).toBe(true);
  });

  it("with the Rule off everything waits unsorted, as before", async () => {
    const w = world({ allowed: [] });
    const { m1, m2, m4 } = await alliance(w, { groupWithoutAi: false });
    expect(await w.convs.conversations([CHAT.chatId])).toEqual([]);
    for (const m of [m1, m2]) expect(await w.convs.placeOf(CHAT.chatId, m.messageId)).toMatchObject({ role: "unsorted", reason: "client_off" });
    // Evan's own promise still comes by rule, with no conversation.
    expect((await w.convs.commitmentsInChat(CHAT.chatId)).map((k) => [k.whoId, k.conversationId, k.messageIds.includes(m4.messageId)])).toEqual([[EVAN.userId, null, true]]);
  });

  it("no provider key counts as off; clients with AI on, a cap or a provider error are unchanged", async () => {
    const none = world({ allowed: [] });
    const m = await none.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Can you check the refresh?");
    await none.run(CHAT, [m], { ...ON, ai: null });
    expect(await none.convs.placeOf(CHAT.chatId, m.messageId)).toMatchObject({ role: "work" });

    const on = world({ respond: allianceAnswer });
    await alliance(on);
    expect(on.calls).toHaveLength(2);
    expect((await on.convs.conversations([CHAT.chatId]))[0]!.summary).toMatch(/7\.7k lb/);

    const zero = world({ appCapUsd: 0 });
    const z = await zero.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Can you check the refresh?");
    expect((await zero.run(CHAT, [z], ON)).aiOutcome).toBe("zero_budget");
    expect(await zero.convs.placeOf(CHAT.chatId, z.messageId)).toMatchObject({ role: "unsorted", reason: "zero_budget" });

    const down = world({ respond: () => ({ ok: false, kind: "provider", status: 500 }) });
    const p = await down.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Can you check the refresh?");
    await down.run(CHAT, [p], ON);
    expect(await down.convs.placeOf(CHAT.chatId, p.messageId)).toMatchObject({ role: "unsorted", reason: "provider" });
  });
});
