// AP-2 on the shared store: AI sorts requests, and Promises, through the real pipeline (the poll job reading the chats,
// the rules, the ai/ service with a fake provider, the shared store and the person's plan store, and the Requests and
// Promises tabs). Sorting maps to cards; "none" hides the card (with Show it anyway); an item id that wasn't offered is
// rejected; a low confidence shows no "Looks like"; AI off, over budget, a guard refusal and a provider error each
// leave the card with "Not sorted: <reason>", never retried in a loop; the context is that client's only (5 earlier
// messages at most, no email addresses); urgent requests show for Today and a notification; promises with and without
// AI, the follow-up prefill, and closing by follow-up or item. The sort runs under the token owner's AI (here the one
// follower, Sam), and a promise under its author's.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { AiPersonSettings, ProviderCall, ProviderReply } from "../ai/types.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import type { IncomingMessage, PromisesData, RequestsData } from "../plan/asks.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { aChatMember, aClassifyAnswer, aClientEntry, aMessage, anAiApp, anAiPerson, aPromiseAnswer, HOME_TENANT } from "../test/builders/index.ts";
import type { WorkItem } from "../week/types.ts";
import { IDENTITY_KEY } from "./account.ts";
import { requestAction, urgentRequests, type RequestAction, type RequestContext } from "./request-actions.ts";
import { pollCycle, type PollDeps } from "./request-poll.ts";

const IN_HOURS = "2026-11-04T15:00:00Z";
const ME = "00000000-0000-4000-8000-0000000000aa";
const FAB = { chatId: "19:fabrikam-team@thread.v2", displayName: "Fabrikam team", webUrl: null };
const NW = { chatId: "19:northwind-team@thread.v2", displayName: "Northwind team", webUrl: null };
const NW_SECRET = "Northwind's Bluebird budget is 40k";

type Msg = IncomingMessage & { modifiedAt: string };
/** The message a request is about (not the earlier ones that go with it). */
const about = (c: ProviderCall) => (JSON.parse(c.input) as { message: { text: string } }).message.text;
const item = (id: number, title: string, o: Partial<WorkItem> = {}): WorkItem => ({ id, title, type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order: 1, parentId: null, changedAt: IN_HOURS, url: `https://dev.azure.com/contoso/_workitems/edit/${id}`, ...o });

type SetupOptions = { person?: Partial<AiPersonSettings>; answer?: (c: ProviderCall) => string | ProviderReply; spent?: number };
async function setup(o: SetupOptions = {}) {
  let now = "2026-11-04T14:00:00Z";
  const zoned = () => Temporal.Instant.from(now).toZonedDateTimeISO("America/New_York");
  const db = sqliteDb();
  await addUsers(db.conn, ME);
  const plan = planStoreOn(db.conn, { now: zoned, userId: ME });
  const teams = createTeamsStore(db.conn, () => Temporal.Instant.from(now));
  const cfg = parseConfig(`${STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"')}\n[clients.fabrikam]\nname = "Fabrikam"\n\n[clients.northwind]\nname = "Northwind"\n`);
  if (!cfg.ok) throw new Error("starter config");
  await plan.setAccountState(IDENTITY_KEY, { oid: ME, tid: HOME_TENANT, name: "Sam Tester", username: "sam@contoso.example", email: "sam@contoso.example", signedInAt: IN_HOURS, systemUserId: null, systemUserEmail: null });
  const client = aChatMember({ external: true, displayName: "Dana Client" });
  const colleague = aChatMember({ displayName: "Lee Colleague" });
  // Registered an hour before (reading starts then).
  for (const [key, chat] of [["fabrikam", FAB], ["northwind", NW]] as const)
    await teams.addChat({ chatId: chat.chatId, clientKey: key, kind: "customer", displayName: chat.displayName, webUrl: null, members: [client, colleague, aChatMember({ userId: ME, displayName: "Sam Tester" })], by: ME });
  now = IN_HOURS;
  const chats = new Map<string, Msg[]>();
  const say = (m: Partial<IncomingMessage>) => {
    const msg = aMessage({ authorId: client.userId, createdAt: "2026-11-04T15:01:00Z", ...m });
    (chats.get(msg.chatId) ?? chats.set(msg.chatId, []).get(msg.chatId)!).push({ ...msg, modifiedAt: msg.createdAt });
    return msg;
  };
  const items: Record<string, WorkItem[]> = {
    fabrikam: [item(501, "Monthly totals report"), item(502, "Export to Excel"), item(503, "Old done thing", { stateCategory: "Completed", state: "Closed" })],
    northwind: [item(777, "Bluebird import")],
  };
  const calls: ProviderCall[] = [];
  const answer = o.answer ?? (() => JSON.stringify(aClassifyAnswer()));
  const logs: LogRecord[] = [];
  const person: AiPersonSettings = anAiPerson(o.person);
  const ai = createAi({
    provider: async () => stubProvider({ respond: (c) => (calls.push(c), answer(c)) }),
    app: anAiApp(),
    person: async () => person,
    guard: async () => ({ directory: [aClientEntry({ key: "fabrikam", names: ["Fabrikam"], projects: [], itemIds: [501, 502] }), aClientEntry({ key: "northwind", names: ["Northwind"], projects: [], itemIds: [777] })], homeDomains: ["cooptimize.example"], forbidden: [] }),
    log: { add: (e) => plan.addAiRequest(e), spentMicros: async (a, b) => (await plan.aiSpentMicros(a, b)) + (o.spent ?? 0), recent: (n) => plan.aiRequests(n) },
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => now,
    sleep: async () => {},
    logger: (r) => void logs.push(r),
  });
  const done = new Set<number>();
  const openItems = async (_c: unknown, k: string) => (items[k] ?? []).filter((i) => i.stateCategory !== "Completed");
  const deps: PollDeps = {
    teams,
    users: async () => [{ id: ME, name: "Sam Tester", deleted: false }],
    person: async (uid) => (uid === ME ? {
      name: "Sam Tester", config: cfg.config, plan, ai: async () => ai, openItems,
      chatMessages: { messagesSince: async (chatId: string, _k: string, since: string) => {
        const messages = (chats.get(chatId) ?? []).filter((m) => Date.parse(m.modifiedAt) > Date.parse(since));
        return { messages, newest: messages.map((m) => m.modifiedAt).sort().at(-1) ?? null };
      } },
    } : null),
    homeTenant: async () => HOME_TENANT,
    now: () => now,
    log: (r) => void logs.push(r),
  };
  const ctx: RequestContext = {
    plan,
    requests: { teams, refresh: (chatIds) => pollCycle(deps, { force: true, chatIds }) },
    me: async () => ME,
    followed: async () => new Set(["fabrikam", "northwind"]),
    config: async () => cfg.config,
    homeTenant: async () => HOME_TENANT,
    openItems,
    writeClients: async () => [],
    now: () => now,
    log: (r) => void logs.push(r),
    ai: async () => ai,
    itemDone: (_c, _k, id) => (done.has(id) ? true : null),
  };
  const run = async <T = RequestsData>(action: RequestAction, input: unknown): Promise<T> => {
    const r = await requestAction(ctx, action, input);
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  const later = (minutes: number) => void (now = Temporal.Instant.from(now).add({ minutes }).toString());
  const poll = async () => (later(5), pollCycle(deps));
  return { plan, teams, ctx, run, say, calls, logs, poll, later, person, done, client, colleague };
}

describe("sorting a request (asks.classify)", () => {
  it("one request per candidate, never for other messages; the sort shows as labels, a draft and the reason", async () => {
    const s = await setup();
    s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:01:00Z", text: "Thanks!" });
    s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:02:00Z", text: "The totals report still shows last month, can you fix it?" });
    const r = await s.poll();
    expect(r).toMatchObject({ candidates: 1 });
    expect(s.calls).toHaveLength(1);
    const d = await s.run("requests.list", {});
    expect(d.requests[0]).toMatchObject({ sort: { kind: "bug", urgency: "this_week", itemType: "bug", title: "Totals report shows last month", reason: "It describes something that is wrong in a report." }, notSorted: null, likely: null });
  });

  it('"Looks like #501" from confidence 0.6, with its title; lower shows nothing', async () => {
    const s = await setup({ answer: (c) => JSON.stringify(aClassifyAnswer({ likely_existing_item: { id: 501, confidence: about(c).includes("first") ? 0.6 : 0.59 } })) });
    s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:01:00Z", text: "first: totals wrong?" });
    s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:02:00Z", text: "second: totals wrong?" });
    await s.poll();
    const d = await s.run("requests.list", {});
    const by = (t: string) => d.requests.find((a) => a.text.startsWith(t))!;
    expect(by("first").likely).toEqual({ id: 501, title: "Monthly totals report", url: "https://dev.azure.com/contoso/_workitems/edit/501" });
    expect(by("second").likely).toBeNull();
  });

  it("an item id that wasn't in the list is rejected: Not sorted", async () => {
    const s = await setup({ answer: () => JSON.stringify(aClassifyAnswer({ likely_existing_item: { id: 777, confidence: 0.95 } })) });
    s.say({ chatId: FAB.chatId, text: "Is the import done?" });
    await s.poll();
    const a = (await s.run("requests.list", {})).requests[0]!;
    expect(a).toMatchObject({ sort: null, likely: null, notSorted: "the AI's answer wasn't usable" });
  });

  it('"none" hides the card and keeps it under Hidden by AI; Show it anyway brings it back', async () => {
    const s = await setup({ answer: () => JSON.stringify(aClassifyAnswer({ kind: "none", item_type: null, urgency: "backlog", reason: "A status update with no request." })) });
    const m = s.say({ chatId: FAB.chatId, text: "FYI the deploy went fine, can you believe it?" });
    await s.poll();
    let d = await s.run("requests.list", {});
    expect([d.open, d.requests.length, d.hidden.length]).toEqual([0, 0, 1]);
    expect(d.hidden[0]!.sort?.reason).toBe("A status update with no request.");
    d = await s.run("requests.show", { chatId: FAB.chatId, messageId: m.messageId, shown: true });
    expect([d.open, d.hidden.length]).toEqual([1, 0]);
  });

  it('a hidden "none" request goes under the 14-day rule with its message; one shown anyway is kept', async () => {
    const s = await setup({ answer: () => JSON.stringify(aClassifyAnswer({ kind: "none", item_type: null })) });
    const a = s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:01:00Z", text: "Nice work, can you believe it?" });
    const b = s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:02:00Z", text: "Great, can we keep this?" });
    await s.poll();
    await s.run("requests.show", { chatId: FAB.chatId, messageId: b.messageId, shown: true });
    await s.teams.expire("2026-11-30T00:00:00Z");
    expect((await s.teams.requests([FAB.chatId])).map((x) => x.messageId)).toEqual([b.messageId]);
    expect(await s.teams.message(FAB.chatId, a.messageId)).toBeNull();
    expect(await s.teams.message(FAB.chatId, b.messageId)).not.toBeNull();
  });

  const providerError: SetupOptions = { answer: () => ({ ok: false, kind: "provider", status: 400 }) };
  const unusable: SetupOptions = { answer: () => "{\"kind\":\"maybe\"}" };
  it.each([
    ["Use AI off", { person: { use: false } }, "AI is off", false],
    ["Allow AI off for the client", { person: { allowedClients: [] } }, "AI isn't allowed for Fabrikam", false],
    ["over budget", { spent: 10_000_000 }, "AI budget reached for this month", false],
    ["a provider error", providerError, "the AI service couldn't answer", true],
    ["an unusable answer", unusable, "the AI's answer wasn't usable", true],
  ] as const)("%s: the card with Not sorted, one attempt only", async (_why, o, reason, called) => {
    const s = await setup(o as SetupOptions);
    s.say({ chatId: FAB.chatId, text: "Can you add a filter?" });
    await s.poll();
    await s.poll();
    const a = (await s.run("requests.list", {})).requests[0]!;
    expect(a).toMatchObject({ status: "open", matched: "asks a question", sort: null, notSorted: reason });
    expect(s.calls.length).toBe(called ? 1 : 0);
  });

  it("a guard refusal (another client's name in the request) is Not sorted and nothing is sent", async () => {
    const s = await setup();
    s.say({ chatId: FAB.chatId, text: "Can you do what you did for Northwind?" });
    await s.poll();
    expect((await s.run("requests.list", {})).requests[0]!.notSorted).toBe("it mentions another client");
    expect(s.calls).toHaveLength(0);
  });

  it("Sort again: one more request, by hand", async () => {
    let fail = true;
    const s = await setup({ answer: (): string | ProviderReply => (fail ? { ok: false, kind: "provider", status: 500 } : JSON.stringify(aClassifyAnswer({ urgency: "now" }))) });
    const m = s.say({ chatId: FAB.chatId, text: "Can you look?" });
    await s.poll();
    await s.poll();
    expect(s.calls).toHaveLength(1); // one request, never again by itself
    fail = false;
    const d = await s.run("requests.sort_again", { chatId: FAB.chatId, messageId: m.messageId });
    expect(d.requests[0]).toMatchObject({ notSorted: null, sort: { urgency: "now" } });
  });

  it("the context: that client's chat and items only, at most 5 earlier messages, authors as client or Cooptimize, no email addresses", async () => {
    const s = await setup();
    s.say({ chatId: NW.chatId, createdAt: "2026-11-04T14:00:00Z", text: NW_SECRET });
    for (let i = 0; i < 7; i++) s.say({ chatId: FAB.chatId, createdAt: `2026-11-04T15:0${i}:00Z`, text: `note ${i} from dana@fabrikam.example`, authorId: i % 2 ? s.colleague.userId : s.client.userId, ...(i % 2 ? { authorTenant: HOME_TENANT } : {}) });
    await s.poll();
    s.calls.length = 0;
    s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:20:00Z", text: "Can you check the totals?" });
    await s.poll();
    const sent = JSON.parse(s.calls.at(-1)!.input) as { client: string; open_items: { id: number }[]; earlier_messages: { from: string; text: string }[] };
    expect(sent.client).toBe("Fabrikam");
    expect(sent.open_items.map((i) => i.id).sort()).toEqual([501, 502]);
    expect(sent.earlier_messages).toHaveLength(5);
    expect(new Set(sent.earlier_messages.map((m) => m.from))).toEqual(new Set(["client", "Cooptimize"]));
    const all = s.calls.map((c) => c.instructions + c.input).join("\n");
    expect(all).not.toContain("Bluebird");
    expect(all).not.toContain("777");
    expect(all).not.toMatch(/@/);
  });

  it("no message text in any log line or AI log row", async () => {
    const s = await setup();
    s.say({ chatId: FAB.chatId, text: "Can you fix the ZEBRA-QUOKKA totals?" });
    await s.poll();
    expect(JSON.stringify(s.logs)).not.toContain("ZEBRA");
    expect(JSON.stringify(await s.plan.aiRequests(10))).not.toContain("ZEBRA");
    expect((await s.plan.aiRequests(10)).map((r) => [r.task, r.clientKey, r.outcome])).toEqual([["asks.classify", "fabrikam", "ok"]]);
  });
});

describe("urgent requests", () => {
  it('urgency "now" shows for Today and a notification, in the chats I see; others and "none" don\'t', async () => {
    const s = await setup({ answer: (c) => JSON.stringify(aClassifyAnswer(about(c).includes("down") ? { kind: "incident", urgency: "now", title: "Portal down" } : about(c).includes("hello") ? { kind: "none", urgency: "now" } : {})) });
    const m = s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:01:00Z", text: "The portal is down, can you look?" });
    s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:02:00Z", text: "Can you add a column?" });
    s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:03:00Z", text: "hello, can you hear me?" });
    await s.poll();
    const now = (await urgentRequests(s.teams, ME, new Set(["fabrikam"]))).filter((a) => a.sort?.urgency === "now");
    expect(now.map((a) => [a.messageId, a.sort?.title, a.sortedBy])).toEqual([[m.messageId, "Portal down", ME]]);
    expect(await urgentRequests(s.teams, "someone-else", null)).toEqual([]);
  });
});

describe("promises (promises.extract)", () => {
  const promiseAnswer = (o: Parameters<typeof aPromiseAnswer>[0] = {}) => (c: ProviderCall) => JSON.stringify(c.schemaName === "promises_extract" ? aPromiseAnswer(o) : aClassifyAnswer());

  it("my message with commitment phrasing becomes a promise card with what, due, to whom and the request it answers", async () => {
    const s = await setup({ answer: (c) => promiseAnswer({ due_hint: "2026-11-05", to_whom: "Dana", answers_message_id: JSON.parse(c.input).earlier_messages?.[0]?.id ?? null })(c) });
    const ask = s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:01:00Z", text: "Can you send the corrected totals?" });
    s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:02:00Z", authorId: ME, authorTenant: HOME_TENANT, text: "I'll send them tomorrow" });
    s.say({ chatId: FAB.chatId, createdAt: "2026-11-04T15:03:00Z", authorId: s.colleague.userId, authorTenant: HOME_TENANT, text: "I'll help" });
    expect((await s.poll()).promises).toBe(1);
    const d = await s.run<PromisesData>("promises.list", {});
    expect(d.open).toBe(1);
    expect(d.promises[0]).toMatchObject({ what: "Send the corrected totals", due: "2026-11-05", toWhom: "Dana", answers: { messageId: ask.messageId, title: "Can you send the corrected totals?" }, notSorted: null });
    expect((await s.run("requests.list", {})).requests[0]!.promised).toBe("Send the corrected totals");
  });

  it("AI says it isn't a promise: no card", async () => {
    const s = await setup({ answer: promiseAnswer({ is_promise: false }) });
    s.say({ chatId: FAB.chatId, authorId: ME, authorTenant: HOME_TENANT, text: "I can't believe it" });
    expect((await s.poll()).promises).toBe(0);
  });

  it("without AI (Allow AI off): the rule's match alone, the first line, no due date", async () => {
    const s = await setup({ person: { allowedClients: [] } });
    s.say({ chatId: FAB.chatId, authorId: ME, authorTenant: HOME_TENANT, text: "Let me check with the team\nmore later" });
    await s.poll();
    const p = (await s.run<PromisesData>("promises.list", {})).promises[0]!;
    expect(p).toMatchObject({ what: "Let me check with the team", due: null, toWhom: null, notSorted: "AI isn't allowed for Fabrikam" });
  });

  it("Make it a follow-up: who, what, Teams and the due date prefilled; the promise closes when the follow-up is done", async () => {
    const s = await setup({ answer: promiseAnswer({ due_hint: "2026-11-06", to_whom: "Dana" }) });
    const m = s.say({ chatId: FAB.chatId, authorId: ME, authorTenant: HOME_TENANT, text: "I'll send it by Friday" });
    await s.poll();
    const r = await s.run<PromisesData & { followUpId: number }>("promises.followup", { chatId: FAB.chatId, messageId: m.messageId });
    const f = (await s.plan.getFollowUp(r.followUpId))!;
    expect(f).toMatchObject({ who: "Dana", what: "Send the corrected totals", channel: "teams", due: "2026-11-06", clientKey: "fabrikam" });
    expect(r.promises[0]!.status).toBe("followup");
    await s.plan.closeFollowUp(f.id, null);
    expect((await s.run<PromisesData>("promises.list", {})).promises[0]!.status).toBe("done");
  });

  it("Link: closes when the item is done in DevOps", async () => {
    const s = await setup({ answer: promiseAnswer() });
    const m = s.say({ chatId: FAB.chatId, authorId: ME, authorTenant: HOME_TENANT, text: "I will fix the export" });
    await s.poll();
    let d = await s.run<PromisesData>("promises.link", { chatId: FAB.chatId, messageId: m.messageId, itemId: 502 });
    expect(d.promises[0]).toMatchObject({ status: "linked", item: { id: 502, title: "Export to Excel" } });
    s.done.add(502);
    d = await s.run<PromisesData>("promises.list", {});
    expect(d.promises[0]!.status).toBe("done");
  });

  it("Done and Dismiss, each with Undo", async () => {
    const s = await setup({ answer: promiseAnswer() });
    const m = s.say({ chatId: FAB.chatId, authorId: ME, authorTenant: HOME_TENANT, text: "I'll look tonight" });
    await s.poll();
    for (const status of ["done", "dismissed"] as const) {
      expect((await s.run<PromisesData>("promises.resolve", { chatId: FAB.chatId, messageId: m.messageId, status })).open).toBe(0);
      expect((await s.run<PromisesData>("promises.reopen", { chatId: FAB.chatId, messageId: m.messageId })).open).toBe(1);
    }
  });
});
