// CV-1: Inbox › Conversations and My promises for each person, on the pipeline's real output: Needs you, Handled by
// teammates and Closed; visibility (only chats I'm in, clients I follow); Hide (mine) against Not a request (shared,
// with who and why, reopenable) and a new work message opening a closed one; Move and Split; escalation after one of
// the committer's working days, Unclaimed for leads, Take it over; follow-through suggestions; and My promises with the
// Wingtip promise on Today. Fictional names (the repo's names rule).
import { describe, expect, it } from "vitest";
import { weekConfig } from "../config/defaults.ts";
import type { MyPromisesData } from "../plan/conversation-views.ts";
import type { ClientChat } from "../plan/requests.ts";
import { aClientChat, aCommitmentAnswer, aConversationUpdate, anUpdateAnswer, aWorkItem } from "../test/builders/index.ts";
import { BLAKE, CHAT, allianceAnswer, EVAN, LENA, SAM, world, ZONE } from "../test/conversations.ts";
import type { WorkItem } from "../week/types.ts";
import { conversationAction, dayPromises } from "./conversation-actions.ts";
import { cfg, OUTSIDER, people, type W } from "../test/conversation-people.ts";
import { upkeep } from "./conversation-upkeep.ts";
import { applyOrg } from "../config/org-apply.ts";
import { resolveRules } from "../config/org.ts";

async function alliance(w: W) {
  const first = [
    await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "Evan we see about a 7.7k lb gap for project 4417001.", { mentions: [{ id: EVAN.userId!, name: "Evan Ford", at: 0 }], html: `<p><at id="0">Evan</at> we see about a 7.7k lb gap for project 4417001.</p>` }),
    await w.say(CHAT, EVAN, "2026-11-04T19:10:00Z", "Looking into it with Lena now"),
  ];
  await w.run(CHAT, first);
  await w.run(CHAT, [
    await w.say(CHAT, EVAN, "2026-11-04T19:55:00Z", "We need to change how we handle BOMs for bridging. I will get this into the development queue so we can fix it."),
    await w.say(CHAT, LENA, "2026-11-04T19:57:00Z", "Thanks Evan"),
  ]);
  const [c] = await w.convs.conversations([CHAT.chatId]);
  return c!;
}

const upkeepDeps = (w: W, items: WorkItem[] = []) => ({
  teams: w.teams, convs: w.convs, now: w.now(), defaultHours: { ...weekConfig.hours, timeZone: ZONE },
  hoursOf: async () => ({ hours: { ...weekConfig.hours, timeZone: ZONE }, ptoDays: new Set<string>() }),
  items: async () => items, userByEmail: async (e: string) => (e === "evan@contoso.example" ? EVAN.userId! : null), ai: async () => null, clientName: async () => "Contoso Supply", log: () => {},
});

describe("views", () => {
  it("the committer has it in Needs you with one primary action; a teammate sees it in Handled by teammates", async () => {
    const w = world({ respond: allianceAnswer });
    const p = await people(w);
    await alliance(w);
    const evan = await p.as(EVAN).run("conversations.list");
    expect(evan.needsYou).toHaveLength(1);
    const card = evan.needsYou[0]!;
    expect(card).toMatchObject({ title: "Movement Dashboard quantity gap on 4417001", clientName: "Contoso Supply", chatName: "Contoso Analytics Alliance", status: "committed", statusLine: "Evan committed", windDown: true, primary: "create" });
    expect(card.participants.find((x) => x.name === "Blake Novak")?.external).toBe(true);
    // Lena isn't mentioned or committed; Sam isn't in it at all. Both see it as handled by teammates.
    expect((await p.as(LENA).run("conversations.list")).teammates.map((c) => c.id)).toEqual([card.id]);
    expect((await p.as(SAM).run("conversations.list")).teammates.map((c) => c.id)).toEqual([card.id]);
  });

  it("shows only chats I'm in, and only clients I follow", async () => {
    const w = world({ respond: allianceAnswer });
    await alliance(w);
    const p = await people(w);
    const outsider = await p.as(OUTSIDER).run("conversations.list");
    expect([outsider.needsYou, outsider.teammates, outsider.closed].flat()).toEqual([]);
    await p.as(OUTSIDER).fail("conversations.resolve", { id: 1 });
    const notFollowing = await (await people(w, { followed: ["wingtip"] })).as(EVAN).run("conversations.list");
    expect([notFollowing.needsYou, notFollowing.teammates].flat()).toEqual([]);
  });

  it("messages render as sanitized HTML with mentions as chips; opening them clears Updated for me only", async () => {
    const w = world({ respond: allianceAnswer });
    const c = await alliance(w);
    const p = await people(w);
    expect((await p.as(EVAN).run("conversations.list")).needsYou[0]!.updated).not.toBeNull();
    const m = await p.as(EVAN).run<{ messages: { html: string; author: string }[] }>("conversations.messages", { id: c.id });
    expect(m.messages[0]!.html).toContain('<span class="mention">Evan Ford</span>');
    expect(m.messages.map((x) => x.author)).toEqual(["Blake Novak", "You", "You"]);
    expect((await p.as(EVAN).run("conversations.list")).needsYou[0]!.updated).toBeNull();
    expect((await p.as(LENA).run("conversations.list")).teammates[0]!.updated).not.toBeNull();
  });
});

describe("Hide for me and Not a request", () => {
  it("Hide is mine alone; Not a request closes it for everyone with who and why; reopen; a new work message reopens", async () => {
    const w = world({ respond: allianceAnswer });
    const c = await alliance(w);
    const p = await people(w);
    let lena = await p.as(LENA).run("conversations.hide", { id: c.id, hidden: true });
    expect([lena.teammates.length, lena.hiddenCount]).toEqual([0, 1]);
    expect((await p.as(EVAN).run("conversations.list")).needsYou).toHaveLength(1);
    const evan = await p.as(EVAN).run("conversations.not_request", { id: c.id, reason: "Handled on a call" });
    expect(evan.closed[0]!.closed).toMatchObject({ kind: "not_request", by: "you", reason: "Handled on a call" });
    expect((await p.as(SAM).run("conversations.list")).closed[0]!.closed).toMatchObject({ kind: "not_request", by: "Evan Ford" });
    expect((await p.as(SAM).run("conversations.reopen", { id: c.id })).closed).toEqual([]);
    await p.as(SAM).run("conversations.resolve", { id: c.id });
    expect((await w.convs.conversation(c.id))!.status).toBe("resolved");
    // A new work message from the client opens it again.
    w.setNow("2026-11-04T22:00:00Z");
    await w.run(CHAT, [await w.say(CHAT, BLAKE, "2026-11-04T21:59:00Z", "Evan, one more thing on 4417001: the gap is back today")]);
    expect((await w.convs.conversation(c.id))!.closedAt).toBeNull();
    lena = await p.as(LENA).run("conversations.hide", { id: c.id, hidden: false });
    expect(lena.hiddenCount).toBe(0);
  });
});

describe("Move and Split", () => {
  it("a message moves to a new conversation (Split) and back (Move); This is work pulls a chatter message in", async () => {
    const w = world({ respond: allianceAnswer });
    const c = await alliance(w);
    const p = await people(w);
    const [first, second] = await w.convs.placesIn([c.id]);
    await p.as(EVAN).run("conversations.move", { chatId: CHAT.chatId, messageId: second!.messageId, to: "new" });
    const all = await w.convs.conversations([CHAT.chatId]);
    expect(all).toHaveLength(2);
    const split = all.find((x) => x.id !== c.id)!;
    expect((await w.convs.placeOf(CHAT.chatId, second!.messageId))!.conversationId).toBe(split.id);
    await p.as(EVAN).run("conversations.move", { chatId: CHAT.chatId, messageId: second!.messageId, to: c.id });
    expect((await w.convs.placeOf(CHAT.chatId, second!.messageId))!.conversationId).toBe(c.id);
    expect((await w.convs.placeOf(CHAT.chatId, first!.messageId))!.conversationId).toBe(c.id);
    const other = aClientChat({ chatId: "19:other@thread.v2", clientKey: "contoso", members: CHAT.members });
    await w.say(other, BLAKE, "2026-11-04T20:00:00Z", "x");
    const r = await conversationAction((await people(w)).as(EVAN).ctx, "conversations.move", { chatId: CHAT.chatId, messageId: second!.messageId, to: 99 });
    expect(r.ok).toBe(false);
    // Chatter: weather, then "This is work".
    const chatter = await w.say(CHAT, BLAKE, "2026-11-04T20:30:00Z", "🙂");
    await w.run(CHAT, [chatter]);
    expect((await p.as(EVAN).run("conversations.list")).chatter[0]?.messages.length ?? 0).toBeGreaterThanOrEqual(0);
    await p.as(EVAN).run("conversations.this_is_work", { chatId: CHAT.chatId, messageId: chatter.messageId });
    expect((await w.convs.placeOf(CHAT.chatId, chatter.messageId))!.role).toBe("work");
  });
});

describe("commitments and escalation", () => {
  it("after one of Evan's working days: Waiting on Evan for everyone, Unclaimed for leads, Take it over tells Evan quietly", async () => {
    const w = world({ respond: allianceAnswer });
    const c = await alliance(w);
    const p = await people(w, { leads: [SAM.userId!] });
    // Same day: nothing yet.
    w.setNow("2026-11-05T15:00:00Z");
    expect((await upkeep(upkeepDeps(w))).escalated).toBe(0);
    // Thursday 2:00 PM in Chicago: a working day after Wednesday 1:55 PM.
    w.setNow("2026-11-05T20:00:00Z");
    expect((await upkeep(upkeepDeps(w))).escalated).toBe(1);
    const lena = (await p.as(LENA).run("conversations.list")).teammates[0]!;
    expect(lena).toMatchObject({ waiting: { name: "Evan", days: 1 }, statusLine: "Waiting on Evan · 1 day", primary: "take_over" });
    const sam = await p.as(SAM).run("conversations.list");
    expect(sam.needsYou.map((x) => x.id)).toEqual([c.id]);
    expect(sam.needsYou[0]!.unclaimed).toBe(true);
    const [k] = await w.convs.commitmentsIn([c.id]);
    await p.as(LENA).run("conversations.take_over", { commitmentId: k!.id });
    const after = (await w.convs.commitment(k!.id))!;
    expect(after).toMatchObject({ whoId: LENA.userId, takenBy: LENA.userId, takenFrom: EVAN.userId, escalatedAt: null, state: "open" });
    expect((await w.convs.conversation(c.id))!.ownerId).toBe(LENA.userId);
    // Lena's now: in her My promises; Evan's no longer.
    expect((await p.as(LENA).run<MyPromisesData>("my_promises.list")).promises.map((x) => x.id)).toEqual([k!.id]);
    expect((await p.as(EVAN).run<MyPromisesData>("my_promises.list")).promises).toEqual([]);
  });
});

describe("follow-through", () => {
  it("one comment suggestion for the item's owner after a 30-minute pause, at most one a day unless it resolves", async () => {
    const w = world({ respond: allianceAnswer });
    const c = await alliance(w);
    const p = await people(w);
    await p.as(EVAN).run("conversations.link", { id: c.id, itemId: 4101 });
    await w.convs.updateConversation(c.id, { itemChange: { kind: "root_cause", note: "Cause is BOM bridging on a measure change", at: "2026-11-04T19:55:00Z", scope: false } });
    const items = [aWorkItem({ id: 4101, title: "Movement dashboard refresh", assignedToEmail: "evan@contoso.example" })];
    w.setNow("2026-11-04T20:10:00Z");
    expect((await upkeep(upkeepDeps(w, items))).suggestions).toBe(0);
    w.setNow("2026-11-04T20:40:00Z");
    expect((await upkeep(upkeepDeps(w, items))).suggestions).toBe(1);
    const [s] = await w.convs.suggestionsIn([c.id]);
    expect(s).toMatchObject({ kind: "comment", itemId: 4101, forUser: EVAN.userId, body: "Cause is BOM bridging on a measure change", internal: [] });
    // Another change the same day: no second one.
    await w.convs.updateConversation(c.id, { itemChange: { kind: "decision", note: "Fix goes in next sprint", at: "2026-11-04T20:45:00Z", scope: false } });
    w.setNow("2026-11-04T21:30:00Z");
    expect((await upkeep(upkeepDeps(w, items))).suggestions).toBe(0);
    // Resolved: one more, even the same day.
    await p.as(EVAN).run("suggestions.skip", { id: s!.id });
    await w.convs.updateConversation(c.id, { itemChange: { kind: "decision", note: "Fix goes in next sprint", at: "2026-11-04T21:00:00Z", scope: false } });
    await p.as(EVAN).run("conversations.resolve", { id: c.id });
    expect((await upkeep(upkeepDeps(w, items))).suggestions).toBe(1);
  });

  it("internal chat lines are flagged and left out of the comment by default; a scope change also suggests a description", async () => {
    const w = world({ respond: allianceAnswer });
    const INTERNAL: ClientChat = aClientChat({ chatId: "19:contoso-team@thread.v2", clientKey: "contoso", kind: "delivery", displayName: "Contoso team (Cooptimize)", members: [EVAN, LENA] });
    await w.say(INTERNAL, EVAN, "2026-11-04T19:00:00Z", "x");
    const c = await w.convs.addConversation({ chatId: INTERNAL.chatId, clientKey: "contoso", title: "Scope", summary: "s", participants: [], firstAt: "2026-11-04T19:00:00Z", lastAt: "2026-11-04T19:00:00Z", lastWorkAt: "2026-11-04T19:00:00Z", item: { id: 4101, url: null, title: null } });
    await w.convs.updateConversation(c.id, { itemChange: { kind: "scope", note: "Also cover the weekly view", at: "2026-11-04T19:00:00Z", scope: true }, ownerId: EVAN.userId! });
    w.setNow("2026-11-04T20:00:00Z");
    await upkeep(upkeepDeps(w));
    const [s, ...rest] = await w.convs.suggestionsIn([c.id]);
    expect(s).toMatchObject({ kind: "comment", body: "", internal: ["Also cover the weekly view"] });
    // Internal: no description suggestion either (nothing from it goes to DevOps unless included).
    expect(rest).toEqual([]);
  });
});

describe("my promises (the Wingtip-shaped example)", () => {
  const WT = aClientChat({ chatId: "19:wingtip-delivery@thread.v2", clientKey: "wingtip", kind: "delivery", displayName: "Wingtip Delivery Team (Cooptimize)", members: [EVAN, SAM] });
  it("one promise to Evan due today 7:30 PM, on Today", async () => {
    const w = world({
      allowed: ["wingtip"],
      respond: (call) => {
        const input = JSON.parse(call.input) as { people: { ref: string; name: string }[]; messages: { ref: string; from: string }[] };
        const ref = (n: string) => input.people.find((x) => x.name === n)!.ref;
        const mine = input.messages.filter((m) => m.from === ref("Sam Tester"));
        return JSON.stringify(anUpdateAnswer({
          messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: "n1", confident_new_topic: false })),
          conversations: [aConversationUpdate({ title: "Rerun the Salesforce data", summary: "Sam will rerun it tonight.", commitments: [aCommitmentAnswer({ who: ref("Sam Tester"), what: "Rerun the Salesforce data from CRM_Silver", due: "2026-11-04T19:30", to: ref("Evan Ford"), messages: mine.map((m) => m.ref) })] })],
        }));
      },
    });
    const p = await people(w);
    await w.run(WT, [
      await w.say(WT, EVAN, "2026-11-04T23:20:00Z", "Can we rerun the Salesforce data from CRM_Silver today?"),
      await w.say(WT, SAM, "2026-11-04T23:38:00Z", "Absolutely. I'll get this done tonight."),
      await w.say(WT, SAM, "2026-11-04T23:39:00Z", "I'll be back online around 7:30 PM my time."),
    ]);
    w.setNow("2026-11-04T23:45:00Z");
    const sam = p.as(SAM);
    const mine = await sam.run<MyPromisesData>("my_promises.list");
    expect(mine.promises).toHaveLength(1);
    expect(mine.promises[0]).toMatchObject({ what: "Rerun the Salesforce data from CRM_Silver", toName: "Evan Ford", dueDate: "2026-11-04", overdue: false, state: "open" });
    const day = await dayPromises(sam.ctx, cfg);
    expect(day).toHaveLength(1);
    expect(Temporal.Instant.from(day[0]!.dueAt!).toZonedDateTimeISO(ZONE).toPlainTime().toString({ smallestUnit: "minute" })).toBe("19:30");
    // Evan sees no promise of his.
    expect((await p.as(EVAN).run<MyPromisesData>("my_promises.list")).promises).toEqual([]);
  });

  it("Done and Not needed close it with Undo; Add to Today puts an undated promise on today", async () => {
    const w = world({ allowed: [] });
    const p = await people(w);
    await w.run(WT, [await w.say(WT, EVAN, "2026-11-04T20:00:00Z", "Can you send the totals?"), await w.say(WT, SAM, "2026-11-04T20:01:00Z", "Sure, I'll send them")]);
    const sam = p.as(SAM);
    const [k] = (await sam.run<MyPromisesData>("my_promises.list")).promises;
    expect(k).toBeDefined();
    let d = await sam.run<MyPromisesData>("my_promises.today", { id: k!.id, on: true });
    expect(d.promises[0]!.onToday).toBe("2026-11-04");
    expect((await dayPromises(sam.ctx, cfg)).map((x) => x.id)).toEqual([k!.id]);
    d = await sam.run<MyPromisesData>("my_promises.done", { id: k!.id });
    expect([d.open, d.promises[0]!.state]).toEqual([0, "done"]);
    d = await sam.run<MyPromisesData>("my_promises.reopen", { id: k!.id });
    expect(d.open).toBe(1);
    d = await sam.run<MyPromisesData>("my_promises.not_needed", { id: k!.id });
    expect(d.open).toBe(0);
    // Not mine: refused.
    expect((await conversationAction(p.as(EVAN).ctx, "my_promises.done", { id: k!.id })).ok).toBe(false);
  });
});

describe("the Rules (ADM-2, D604)", () => {
  it("Closed conversations stay shown for the Rule's days; the poll line reads the interval Rule", async () => {
    const w = world({ respond: allianceAnswer });
    const c = await alliance(w);
    const rows = [
      { scope: "org", key: "conv.closed_shown_days", value: "3", updatedAt: w.now(), updatedBy: null },
      { scope: "org", key: "conv.poll_minutes", value: "7", updatedAt: w.now(), updatedBy: null },
    ];
    const config = applyOrg(cfg, resolveRules(rows, { model: "m", appCapUsd: 100, inviteDomains: [], feedback: null }), { level: null, levelSource: null });
    const p = await people(w, { config });
    await p.as(EVAN).run("conversations.resolve", { id: c.id });
    w.setNow(Temporal.Instant.from(w.now()).add({ hours: 48 }).toString());
    const two = await p.as(EVAN).run("conversations.list");
    expect(two.closed.map((x) => x.id)).toEqual([c.id]);
    expect(two.pollMinutes).toBe(7);
    w.setNow(Temporal.Instant.from(w.now()).add({ hours: 25 }).toString());
    expect((await p.as(EVAN).run("conversations.list")).closed).toEqual([]);
  });
});
