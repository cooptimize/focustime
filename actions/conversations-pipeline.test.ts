// CV-1: the conversations pipeline on the shared store (SQLite in memory), a fake provider behind the real ai/ service
// (switches, guards, the app's cap, the request log), and messages from the shared builders. Names are fictional (the
// repo's names rule): the two worked examples from the step keep their shape with other names.
import { describe, expect, it } from "vitest";
import type { ProviderCall } from "../ai/types.ts";
import { aClientChat, aClientEntry, aChatMember, aCommitmentAnswer, aConversationUpdate, anUpdateAnswer, aWorkItem, CLIENT_TENANT } from "../test/builders/index.ts";
import { BLAKE, CHAT, allianceAnswer, EVAN, LENA, SAM, world, ZONE } from "../test/conversations.ts";
import type { TeamsMessage } from "../plan/requests.ts";
import { CLIENT_REFUSED, LEGACY_CLIENT_REFUSED, statusLine, unsortedText } from "../plan/conversations.ts";
import { legacyRefused, parkedBySwitch } from "./conversations-pipeline.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";


describe("the Alliance-shaped example", () => {
  it("is one conversation with a living summary, Evan committed, thanks as wind-down, and the original messages kept", async () => {
    const w = world({ respond: allianceAnswer });
    const table = `<p><at id="0">Evan</at> we see about a 7.7k lb gap between the Movement Dashboard and the BOM report for project 4417001.</p><table><tr><td>MD</td><td>12,400 lb</td></tr><tr><td>BOM</td><td>4,700 lb</td></tr></table><img src="https://graph.microsoft.com/v1.0/chats/x/messages/1/hostedContents/a/$value"><img src="https://graph.microsoft.com/v1.0/chats/x/messages/1/hostedContents/b/$value">`;
    const first = [
      await w.say(CHAT, BLAKE, "2026-11-04T19:02:00Z", "Evan we see about a 7.7k lb gap between the Movement Dashboard and the BOM report for project 4417001.", { html: table, hasImage: true, mentions: [{ id: EVAN.userId!, name: "Evan Ford", at: 0 }] }),
      await w.say(CHAT, EVAN, "2026-11-04T19:10:00Z", "Looking into it with Lena now"),
      await w.say(CHAT, LENA, "2026-11-04T19:40:00Z", "Bridging:", { html: `<p>Bridging:</p><img src="https://graph.microsoft.com/v1.0/chats/x/messages/3/hostedContents/c/$value">`, hasImage: true }),
    ];
    await w.run(CHAT, first);
    const second = [
      await w.say(CHAT, EVAN, "2026-11-04T19:55:00Z", "We need to make a change on how we are handling BOMs for bridging on top of a measure change. I will get this into the development queue so we can fix it."),
      await w.say(CHAT, LENA, "2026-11-04T19:57:00Z", "Thanks Evan"),
      await w.say(CHAT, BLAKE, "2026-11-04T19:58:00Z", "Thank you!"),
    ];
    const r = await w.run(CHAT, second);
    expect(r.acks).toBe(2);
    const [c, ...more] = await w.convs.conversations([CHAT.chatId]);
    expect(more).toEqual([]);
    expect(c!.summary).toMatch(/7\.7k lb/);
    expect(c!.summary).toMatch(/bridging/i);
    expect(c!.status).toBe("committed");
    expect(c!.ownerId).toBe(EVAN.userId);
    expect(c!.windDown).toBe(true);
    expect(c!.participants.map((p) => p.name).sort()).toEqual(["Blake Novak", "Evan Ford", "Lena Hart"]);
    const [k] = await w.convs.commitmentsIn([c!.id]);
    expect(k).toMatchObject({ whoId: EVAN.userId, what: "Add the BOM bridging fix to the dev queue", impliesItem: true, state: "open" });
    // Two requests, one per batch (one per chat and cycle); the thanks never went to the AI.
    expect(w.calls).toHaveLength(2);
    expect(w.calls[1]!.input).not.toMatch(/Thanks Evan|Thank you/);
    // Names go as display names, never addresses; message ids as aliases.
    for (const call of w.calls) {
      expect(call.input).not.toMatch(/@contoso\.example|@fabrikam\.example/);
      expect(call.input).not.toContain(first[0]!.messageId);
    }
    // Logged against the app's cap, in the app's request log.
    expect((await w.convs.appAiLog.recent(5)).map((e) => [e.task, e.outcome, e.cap])).toEqual([["conversations.update", "ok", "app"], ["conversations.update", "ok", "app"]]);
  });
});

describe("my promise (the Wingtip-shaped example)", () => {
  const WT = aClientChat({ chatId: "19:wingtip-delivery@thread.v2", clientKey: "wingtip", kind: "delivery", displayName: "Wingtip Delivery Team (Cooptimize)", members: [EVAN, SAM] });
  const promiseAnswer = (c: ProviderCall) => {
    const input = JSON.parse(c.input) as { people: { ref: string; name: string }[]; messages: { ref: string; from: string; text: string; group: string | null }[] };
    const ref = (n: string) => input.people.find((p) => p.name === n)!.ref;
    const mine = input.messages.filter((m) => m.from === ref("Sam Tester"));
    return JSON.stringify(anUpdateAnswer({
      messages: input.messages.map((m) => ({ ref: m.ref, kind: /kids/.test(m.text) ? "chatter" : "work", conversation: /kids/.test(m.text) ? null : "n1", confident_new_topic: false })),
      conversations: [aConversationUpdate({
        title: "Rerun the Salesforce data from CRM_Silver",
        summary: "Evan asked to rerun the Salesforce data from CRM_Silver.\nSam will do it tonight.",
        // The AI returns two (one a status statement) for one group: they merge into one.
        commitments: [
          aCommitmentAnswer({ who: ref("Sam Tester"), what: "Rerun the Salesforce data from CRM_Silver", due: null, to: ref("Evan Ford"), messages: [mine[0]!.ref] }),
          aCommitmentAnswer({ who: ref("Sam Tester"), what: "Come back online", due: "2026-11-04T19:30", messages: [mine[1]!.ref], status_only: true }),
        ],
      })],
    }));
  };
  it("is one promise to Evan, due today 7:30 PM, with no separate 'come back online'", async () => {
    const w = world({ respond: promiseAnswer, allowed: ["wingtip"] });
    const batch = [
      await w.say(WT, EVAN, "2026-11-04T23:20:00Z", "Can we rerun the Salesforce data from CRM_Silver today?"),
      await w.say(WT, SAM, "2026-11-04T23:38:00Z", "Absolutely. I'll get this done tonight."),
      await w.say(WT, SAM, "2026-11-04T23:39:00Z", "I have to run kids around for a little bit but I'll be back online around 7:30 PM my time."),
    ];
    await w.run(WT, batch);
    const all = await w.convs.commitmentsInChat(WT.chatId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ whoId: SAM.userId, toId: EVAN.userId, toName: "Evan Ford", what: "Rerun the Salesforce data from CRM_Silver", dueDate: "2026-11-04" });
    // 7:30 PM in Sam's zone (Chicago), from the status statement.
    expect(Temporal.Instant.from(all[0]!.dueAt!).toZonedDateTimeISO(ZONE).toPlainTime().toString({ smallestUnit: "minute" })).toBe("19:30");
    expect(all[0]!.messageIds).toEqual([batch[1]!.messageId, batch[2]!.messageId]);
  });
  it("without AI: still one promise, its due from the status statement, to the person answered", async () => {
    const w = world({ allowed: [] });
    const batch = [
      await w.say(WT, EVAN, "2026-11-04T23:20:00Z", "Can we rerun the Salesforce data from CRM_Silver today?"),
      await w.say(WT, SAM, "2026-11-04T23:38:00Z", "Absolutely. I'll get this done tonight."),
      await w.say(WT, SAM, "2026-11-04T23:39:00Z", "I have to run kids around for a little bit but I'll be back online around 7:30 PM my time."),
    ];
    const r = await w.run(WT, batch);
    expect(r.aiOutcome).toBe("client_off");
    const all = await w.convs.commitmentsInChat(WT.chatId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ toId: EVAN.userId, what: "I'll get this done tonight.", dueDate: "2026-11-04" });
    expect(Temporal.Instant.from(all[0]!.dueAt!).toZonedDateTimeISO(ZONE).toPlainTime().toString({ smallestUnit: "minute" })).toBe("19:30");
  });
});

describe("chatter", () => {
  it("weather, sports, a GIF and thanks alone make no conversation; the AI's chatter is filtered with a visible place", async () => {
    const w = world({
      respond: (c) => {
        const input = JSON.parse(c.input) as { messages: { ref: string }[] };
        return JSON.stringify({ messages: input.messages.map((m) => ({ ref: m.ref, kind: "chatter", conversation: null, confident_new_topic: false })), conversations: [] });
      },
    });
    const batch = [
      await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Snow already up here, can you believe it"),
      await w.say(CHAT, EVAN, "2026-11-04T15:01:00Z", "Did you catch the game last night?"),
      await w.say(CHAT, LENA, "2026-11-04T15:02:00Z", "", { html: `<img itemtype="http://schema.skype.com/Giphy" src="https://media.giphy.com/x.gif">` }),
      await w.say(CHAT, BLAKE, "2026-11-04T15:03:00Z", "thanks!"),
    ];
    const r = await w.run(CHAT, batch);
    expect(await w.convs.conversations([CHAT.chatId])).toEqual([]);
    expect(r).toMatchObject({ chatter: 4, work: 0 });
    expect((await w.convs.placesByRole([CHAT.chatId], "chatter")).length).toBe(4);
    // Only the two worded ones went to the AI.
    expect(JSON.parse(w.calls[0]!.input).messages).toHaveLength(2);
  });
});

describe("grouping hints and checks", () => {
  const seed = async (w: ReturnType<typeof world>) => {
    const m = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "The refresh failed in prod");
    await w.run(CHAT, [m]);
    return { conv: (await w.convs.conversations([CHAT.chatId]))[0]!, m };
  };
  it("a reply joins even when the AI calls it a new topic it isn't sure of; a confident new topic splits", async () => {
    let confident = false;
    const w = world({
      respond: (c) => {
        const input = JSON.parse(c.input) as { messages: { ref: string }[]; open_conversations: { ref: string }[] };
        if (!input.open_conversations.length) return JSON.stringify(anUpdateAnswer({ conversations: [aConversationUpdate({ title: "Prod refresh failed" })] }));
        return JSON.stringify(anUpdateAnswer({ messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: "n1", confident_new_topic: confident })), conversations: [aConversationUpdate({ title: "Something else" })] }));
      },
    });
    const { conv, m } = await seed(w);
    const reply = await w.say(CHAT, EVAN, "2026-11-04T15:20:00Z", "Restarting the gateway", { replyToId: m.messageId });
    await w.run(CHAT, [reply]);
    expect((await w.convs.placeOf(CHAT.chatId, reply.messageId))?.conversationId).toBe(conv.id);
    confident = true;
    const other = await w.say(CHAT, EVAN, "2026-11-04T15:25:00Z", "Separately, the March export is ready", { replyToId: m.messageId });
    await w.run(CHAT, [other]);
    const placed = await w.convs.placeOf(CHAT.chatId, other.messageId);
    expect(placed?.conversationId).not.toBe(conv.id);
  });
  it("an @mention of a participant joins while AI is unavailable; anything else waits unsorted with the reason", async () => {
    const w = world({ respond: (c) => (JSON.parse(c.input).open_conversations.length ? { ok: false, kind: "provider", status: 500 } : JSON.stringify(anUpdateAnswer())) });
    const { conv } = await seed(w);
    const mention = await w.say(CHAT, LENA, "2026-11-04T16:30:00Z", "Blake is it still failing?", { mentions: [{ id: BLAKE.userId!, name: "Blake Novak", at: 0 }] });
    const loose = await w.say(CHAT, LENA, "2026-11-04T18:30:00Z", "New dataset lands Monday");
    const r = await w.run(CHAT, [mention, loose]);
    expect(r).toMatchObject({ work: 1, unsorted: 1, aiOutcome: "provider" });
    expect((await w.convs.placeOf(CHAT.chatId, mention.messageId))?.conversationId).toBe(conv.id);
    expect(await w.convs.placeOf(CHAT.chatId, loose.messageId)).toMatchObject({ role: "unsorted", reason: "provider" });
  });
  it("rejects an answer with a conversation, message or item id that wasn't offered", async () => {
    for (const bad of [
      anUpdateAnswer({ messages: [{ ref: "m1", kind: "work", conversation: "c9", confident_new_topic: false }] }),
      anUpdateAnswer({ messages: [{ ref: "m7", kind: "work", conversation: "n1", confident_new_topic: false }] }),
      anUpdateAnswer({ conversations: [aConversationUpdate({ likely_item: 999 })] }),
    ]) {
      const w = world({ respond: () => JSON.stringify(bad) });
      const m = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "The refresh failed in prod");
      const r = await w.run(CHAT, [m]);
      expect(r.aiOutcome).toBe("unknown_ref");
      expect(await w.convs.conversations([CHAT.chatId])).toEqual([]);
      expect(await w.convs.placeOf(CHAT.chatId, m.messageId)).toMatchObject({ role: "unsorted", reason: "unknown_ref" });
    }
  });
});

describe("throttles and budgets", () => {
  it("a $0 app cap says it is set to $0; AI off for the client and the chat's daily cap wait unsorted", async () => {
    const zero = world({ appCapUsd: 0 });
    const m = await zero.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "The refresh failed in prod");
    expect((await zero.run(CHAT, [m])).aiOutcome).toBe("zero_budget");
    expect(await zero.convs.placeOf(CHAT.chatId, m.messageId)).toMatchObject({ role: "unsorted", reason: "zero_budget" });
    const off = world({ allowed: [] });
    const m2 = await off.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "The refresh failed in prod");
    expect((await off.run(CHAT, [m2])).aiOutcome).toBe("client_off");
    const capped = world();
    const m3 = await capped.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "The refresh failed in prod");
    const r = await capped.run(CHAT, [m3], { chatCap: 0 });
    expect(r).toMatchObject({ unsorted: 1, aiCalls: 0 });
    expect(capped.calls).toEqual([]);
  });
});

describe("one client per request", () => {
  it("never puts one client's messages, people or items into another client's request", async () => {
    const FAB = aClientChat({ chatId: "19:fabrikam@thread.v2", clientKey: "fabrikam", members: [SAM, aChatMember({ displayName: "Dana Client", tenantId: CLIENT_TENANT })] });
    const w = world();
    const a = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Contoso secret dashboard numbers look off");
    await w.run(CHAT, [a], { items: [aWorkItem({ id: 5001, title: "Contoso-only item" })] });
    const b = await w.say(FAB, FAB.members![1]!, "2026-11-04T15:05:00Z", "Fabrikam export question");
    await w.run(FAB, [b], { items: [aWorkItem({ id: 6001, title: "Fabrikam item" })], clientName: "Fabrikam" });
    const fab = w.calls.find((c) => c.input.includes("Fabrikam export question"))!;
    expect(fab.input).not.toMatch(/Contoso|Blake|5001/);
    const con = w.calls.find((c) => c.input.includes("dashboard numbers"))!;
    expect(con.input).not.toMatch(/Fabrikam|Dana|6001/);
  });
});

describe("the split-topic sequence (CV-2: the split on dev came from the CV-1 backfill of old requests)", () => {
  // Nov 4, Central time: a client question 3:13 PM, an image 3:14, a Cooptimizer 4:13 (59 minutes later), a commitment
  // 4:35. Read live, one batch per 5-minute poll, with a provider that does what the instructions say (join the hinted
  // or open conversation): one conversation, "<Name> committed". No history is regrouped.
  const ASKER = aChatMember({ displayName: "Brett Nolan", external: true });
  const LOOKER = aChatMember({ displayName: "Leo Hale" });
  const DOER = aChatMember({ displayName: "Erin Fox" });
  const SPLIT = aClientChat({ chatId: "19:contoso-split@thread.v2", clientKey: "contoso", displayName: "Contoso Analytics Alliance", members: [ASKER, LOOKER, DOER] });
  const follows = (c: ProviderCall) => {
    const i = JSON.parse(c.input) as { open_conversations: { ref: string }[]; messages: { ref: string; text: string; from: string; hint: { conversation: string } | null }[] };
    const conv = i.open_conversations[0]?.ref ?? "n1";
    const commit = i.messages.find((m) => /backlog/.test(m.text));
    return JSON.stringify(anUpdateAnswer({
      messages: i.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: m.hint?.conversation ?? conv, confident_new_topic: false })),
      conversations: [aConversationUpdate({ ref: conv, title: "Shipments report totals differ", summary: "October totals differ from the dashboard.", commitments: commit ? [aCommitmentAnswer({ who: commit.from, what: "Fix the October totals", implies_item: true, messages: [commit.ref] })] : [] })],
    }));
  };
  it("groups into one conversation with the commitment", async () => {
    const w = world({ respond: follows });
    const img = `<p></p><img src="https://graph.microsoft.com/v1.0/chats/x/messages/2/hostedContents/a/$value">`;
    const polls: [string, TeamsMessage[]][] = [
      ["2026-11-04T21:15:00Z", [await w.say(SPLIT, ASKER, "2026-11-04T21:13:00Z", "The totals on the shipments report don't match the dashboard for October."), await w.say(SPLIT, ASKER, "2026-11-04T21:14:00Z", "", { html: img, hasImage: true })]],
      ["2026-11-04T22:15:00Z", [await w.say(SPLIT, LOOKER, "2026-11-04T22:13:00Z", "Looking at it now, the October filter looks off.")]],
      ["2026-11-04T22:40:00Z", [await w.say(SPLIT, DOER, "2026-11-04T22:35:00Z", "I will add this to the backlog and get it fixed this week.")]],
    ];
    for (const [at, batch] of polls) {
      w.setNow(at);
      await w.run(SPLIT, batch);
    }
    const cs = await w.convs.conversations([SPLIT.chatId]);
    expect(cs).toHaveLength(1);
    expect((await w.convs.placesIn([cs[0]!.id])).filter((p) => p.role === "work")).toHaveLength(4);
    const ks = await w.convs.commitmentsIn([cs[0]!.id]);
    expect(ks.map((k) => k.whoName)).toEqual(["Erin Fox"]);
    expect(statusLine(cs[0]!, "Erin", null)).toBe("Erin committed");
  });
});

// GD-1: an Internal chat's work names clients; a client's chat still may not name another.
describe("Cooptimize Internal and the client rule", () => {
  const directory = [aClientEntry({ key: "contoso", names: ["Contoso Supply"], projects: [], itemIds: [] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam"], projects: [], itemIds: [] })];
  const INT = aClientChat({ chatId: "19:internal-delivery@thread.v2", clientKey: INTERNAL_CLIENT, kind: "delivery", displayName: "Delivery Team (Cooptimize)", members: [EVAN, SAM] });

  it("an Internal chat naming two clients is sent and sorted", async () => {
    const w = world({ directory, allowed: [INTERNAL_CLIENT] });
    const m = await w.say(INT, EVAN, "2026-11-04T15:00:00Z", "Contoso Supply and Fabrikam both need the export fix this week");
    const r = await w.run(INT, [m], { items: [] });
    expect(w.calls).toHaveLength(1);
    expect(r).toMatchObject({ aiOutcome: "ok", unsorted: 0 });
  });

  it("a client chat naming another client waits unsorted with the new reason, and isn't retried as an old refusal", async () => {
    const w = world({ directory });
    const m = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Same issue Fabrikam had last month");
    const r = await w.run(CHAT, [m]);
    expect(w.calls).toHaveLength(0);
    expect(r).toMatchObject({ aiOutcome: CLIENT_REFUSED, unsorted: 1 });
    expect((await w.convs.placesByRole([CHAT.chatId], "unsorted")).map((p) => p.reason)).toEqual([CLIENT_REFUSED]);
    expect(unsortedText(CLIENT_REFUSED, "Contoso Supply")).toBe("it mentions another client");
    expect(await legacyRefused(w.convs, w.teams, CHAT.chatId)).toEqual([]);
  });

  it("messages refused before GD-1 are tried once more: an Internal chat's are sorted, a real mention stays refused", async () => {
    const w = world({ directory, allowed: [INTERNAL_CLIENT, "contoso"] });
    const a = await w.say(INT, EVAN, "2026-11-04T15:00:00Z", "Contoso Supply wants the export by Friday");
    const b = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Same issue Fabrikam had last month");
    await w.convs.place([a, b].map((m) => ({ chatId: m.chatId, messageId: m.messageId, conversationId: null, role: "unsorted" as const, reason: LEGACY_CLIENT_REFUSED, placedBy: "rule" as const, at: m.createdAt })));
    const internal = await legacyRefused(w.convs, w.teams, INT.chatId);
    expect(internal.map((m) => m.messageId)).toEqual([a.messageId]);
    expect(await w.run(INT, internal, { items: [] })).toMatchObject({ aiOutcome: "ok", unsorted: 0 });
    expect(await legacyRefused(w.convs, w.teams, INT.chatId)).toEqual([]);
    const client = await legacyRefused(w.convs, w.teams, CHAT.chatId);
    expect(await w.run(CHAT, client)).toMatchObject({ aiOutcome: CLIENT_REFUSED, unsorted: 1 });
    // Refused again: kept under the new reason, never tried again.
    expect(await legacyRefused(w.convs, w.teams, CHAT.chatId)).toEqual([]);
  });

  it("IB-1: messages a switch held back are picked once AI is available (a budget only with new messages); guard holds never", async () => {
    const w = world({ directory });
    const ms = await Promise.all(["off", "client_off", "over_budget", CLIENT_REFUSED, "rate_limited"].map((_, i) => w.say(CHAT, BLAKE, `2026-11-04T15:0${i}:00Z`, `Message ${i}`)));
    const reasons = ["off", "client_off", "over_budget", CLIENT_REFUSED, "rate_limited"];
    await w.convs.place(ms.map((m, i) => ({ chatId: m.chatId, messageId: m.messageId, conversationId: null, role: "unsorted" as const, reason: reasons[i]!, placedBy: "rule" as const, at: m.createdAt })));
    const ids = async (o: { available: boolean; withNew: boolean }) => (await parkedBySwitch(w.convs, w.teams, CHAT.chatId, o)).map((m) => m.messageId);
    expect(await ids({ available: false, withNew: true })).toEqual([]);
    expect(await ids({ available: true, withNew: false })).toEqual([ms[0]!.messageId, ms[1]!.messageId]);
    expect(await ids({ available: true, withNew: true })).toEqual([ms[0]!.messageId, ms[1]!.messageId, ms[2]!.messageId]);
  });

  it("IB-1: the unsorted line in plain words; Sort again only for what passes on its own; holds have no button", async () => {
    const { unsortedLine, unsortedSentence } = await import("../plan/conversations.ts");
    for (const k of ["rate_limited", "timeout", "quota", "invalid_output", "unknown_ref", "chat_cap"]) expect(unsortedLine(k, "Contoso").does, k).toBe("retry");
    for (const k of ["off", "client_off", "not_set_up", "zero_budget", "over_budget"]) {
      const l = unsortedLine(k, "Contoso");
      expect(l.does, k).toBe("switch");
      expect(l.fix, k).toMatch(/FocusTime admin/);
    }
    expect(unsortedLine("client_off", "Contoso")).toMatchObject({ text: "AI isn't allowed for Contoso", fix: expect.stringContaining("Admin › AI") });
    expect(unsortedLine(CLIENT_REFUSED, "Contoso")).toEqual({ text: "held back because they mention another client", does: "held", fix: null });
    expect(unsortedLine("refused_secret", "Contoso")).toMatchObject({ does: "held", text: expect.stringMatching(/^held back because they contain something that looks like a key/) });
    expect(unsortedLine("refused_email", "Contoso")).toMatchObject({ does: "held", text: "held back because they contain an email address" });
    // MB-1: one plain sentence, no colon for a hold; one message reads "it".
    expect(unsortedSentence(20, unsortedLine(CLIENT_REFUSED, "Contoso"))).toBe("20 messages held back because they mention another client.");
    expect(unsortedSentence(1, unsortedLine("refused_email", "Contoso"))).toBe("1 message held back because it contains an email address.");
    expect(unsortedSentence(3, unsortedLine("rate_limited", "Contoso"))).toBe("3 messages: the AI service was busy.");
    for (const k of ["off", CLIENT_REFUSED, "rate_limited"]) expect(unsortedLine(k, "Contoso").text, k).not.toMatch(/\u2014/);
  });

  it("IB-1: a Social chat skips the AI pass entirely: its messages are chatter, nothing is sent", async () => {
    const w = world({ directory });
    const social = { ...CHAT, social: true };
    const m = await w.say(CHAT, BLAKE, "2026-11-04T15:00:00Z", "Can someone look at the export totals before Friday?");
    const r = await w.run(social, [m]);
    expect(w.calls).toHaveLength(0);
    expect(r).toMatchObject({ chatter: 1, conversations: 0 });
    expect((await w.convs.placesByRole([CHAT.chatId], "chatter")).map((p) => p.reason)).toEqual(["social"]);
  });
});
