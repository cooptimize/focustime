// CV-1: the conversations pipeline on the shared store (SQLite in memory), a fake provider behind the real ai/ service
// (switches, guards, the app's cap, the request log), and messages from the shared builders. Names are fictional (the
// repo's names rule): the two worked examples from the step keep their shape with other names.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
import type { UpdateAnswer } from "../plan/conversations.ts";
import type { ClientChat, TeamsMessage } from "../plan/requests.ts";
import { createConversationStore } from "../store/conversation-store.ts";
import { openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { aChatMember, aClientChat, aCommitmentAnswer, aConversationUpdate, anAiApp, anAiPerson, anUpdateAnswer, aTeamsMessage, aWorkItem, CLIENT_TENANT, HOME_TENANT } from "../test/builders/index.ts";
import { runPipeline, type PipelineDeps } from "./conversations-pipeline.ts";

const NOW = "2026-11-04T21:00:00Z";
const ZONE = "America/Chicago";
const EVAN = aChatMember({ displayName: "Evan Ford" });
const LENA = aChatMember({ displayName: "Lena Hart" });
const SAM = aChatMember({ displayName: "Sam Tester" });
const BLAKE = aChatMember({ displayName: "Blake Novak", external: true });
const CHAT = aClientChat({ chatId: "19:contoso-alliance@thread.v2", clientKey: "contoso", displayName: "Contoso Analytics Alliance", members: [EVAN, LENA, SAM, BLAKE] });

function world(o: { respond?: (c: ProviderCall) => string | { ok: false; kind: "provider"; status: number }; appCapUsd?: number; allowed?: string[]; use?: boolean } = {}) {
  let now = NOW;
  const clock = () => Temporal.Instant.from(now);
  const conn = sqliteConn(openPlanDb({ path: ":memory:", now: () => clock().toZonedDateTimeISO("UTC") }));
  const teams = createTeamsStore(conn, clock);
  const convs = createConversationStore(conn, clock, teams);
  const calls: ProviderCall[] = [];
  const provider = stubProvider({ respond: (c) => (calls.push(c), o.respond ? o.respond(c) : JSON.stringify(anUpdateAnswer())) });
  const ai = createAi({
    provider: async () => provider,
    app: anAiApp({ provider: "openai", appCapUsd: o.appCapUsd ?? 100 }),
    person: async () => anAiPerson({ use: o.use ?? true, allowedClients: o.allowed ?? ["contoso", "fabrikam"] }),
    guard: async () => ({ directory: [], homeDomains: ["contoso.example"], forbidden: [] }),
    log: convs.appAiLog,
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => now,
    cap: "app",
  });
  const users = [EVAN, LENA, SAM].map((m) => ({ id: m.userId!, name: m.displayName!, deleted: false }));
  const deps = (chat: ClientChat, more: Partial<PipelineDeps> = {}): PipelineDeps => ({
    teams, convs, users, homeTenant: HOME_TENANT, now, clientName: chat.clientKey === "contoso" ? "Contoso Supply" : "Fabrikam", ai, zone: ZONE, ackPhrases: [], items: [aWorkItem({ id: 4101, title: "Movement dashboard refresh" })],
    author: async () => ({ zone: ZONE, promisePhrases: ["i'll", "i will", "tonight"] }), ...more,
  });
  const say = async (chat: ClientChat, from: typeof EVAN, at: string, text: string, more: Partial<TeamsMessage> = {}) => {
    const m = aTeamsMessage({ chatId: chat.chatId, clientKey: chat.clientKey, senderId: from.userId, senderName: from.displayName, senderTenant: from.tenantId, createdAt: at, modifiedAt: at, fetchedAt: at, text, ...more });
    if (!(await teams.chat(chat.chatId))) await teams.addChat({ chatId: chat.chatId, clientKey: chat.clientKey, kind: chat.kind, displayName: chat.displayName, webUrl: null, members: chat.members, by: EVAN.userId! });
    await teams.saveMessages([m]);
    return m;
  };
  return { teams, convs, calls, deps, say, setNow: (t: string) => void (now = t), run: (chat: ClientChat, batch: TeamsMessage[], more: Partial<PipelineDeps> = {}) => runPipeline(deps(chat, more), chat, batch) };
}

/** The fake provider's answer for the CSC-shaped example, read from the request's own input (refs only). */
function cscAnswer(c: ProviderCall): string {
  const input = JSON.parse(c.input) as { people: { ref: string; name: string }[]; open_conversations: { ref: string }[]; messages: { ref: string; from: string; text: string }[] };
  const ref = (name: string) => input.people.find((p) => p.name === name)!.ref;
  const conv = input.open_conversations[0]?.ref ?? "n1";
  const commit = input.messages.find((m) => /development queue/.test(m.text));
  const a: UpdateAnswer = {
    messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: conv, confident_new_topic: false })),
    conversations: [
      aConversationUpdate({
        ref: conv,
        title: "Movement Dashboard quantity gap on 4417001",
        summary: commit ? "Movement Dashboard quantity gap on 4417001 (~7.7k lb vs the BOM report).\nCause looks like BOM bridging.\nEvan is adding it to the dev queue." : "Movement Dashboard quantity gap on 4417001 (~7.7k lb vs the BOM report).\nEvan and Lena are looking into it.",
        owner: ref("Evan Ford"),
        change: commit ? "Evan will add the fix to the dev queue" : "New question from Blake",
        commitments: commit ? [aCommitmentAnswer({ who: commit.from, what: "Add the BOM bridging fix to the dev queue", implies_item: true, messages: [commit.ref] })] : [],
      }),
    ],
  };
  return JSON.stringify(a);
}

describe("the CSC-shaped example", () => {
  it("is one conversation with a living summary, Evan committed, thanks as wind-down, and the original messages kept", async () => {
    const w = world({ respond: cscAnswer });
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

describe("my promise (the W&C-shaped example)", () => {
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
