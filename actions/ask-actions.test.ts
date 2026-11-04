// AP-1: Asks: reading the chats switched on (only newer messages, from switch-on, only in working hours and not on
// PTO days, stopping when switched off, backing off on 429, one failing chat not stopping the others), the
// resolutions (link, handled, dismiss, each undoable and idempotent), a client's text only on its own asks, and no chat
// text in any log line.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import type { AsksData, ContextMessage, IncomingMessage } from "../plan/asks.ts";
import { HttpError } from "../sources/calendar/http.ts";
import type { ScopeProbe, TokenKind } from "../sources/oauth/oauth.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { aChatMember, aMessage, HOME_TENANT } from "../test/builders/index.ts";
import type { WorkItem } from "../week/types.ts";
import { IDENTITY_KEY, type MicrosoftAccount } from "./account.ts";
import { askAction, pollAsks, type AskAction, type AskContext } from "./ask-actions.ts";

// Wednesday 10:00 in New York (the starter's zone and working hours).
const IN_HOURS = "2026-11-04T15:00:00Z";
const ME = "00000000-0000-4000-8000-0000000000aa";
const FAB = { chatId: "19:fabrikam-team@thread.v2", displayName: "Fabrikam team", webUrl: null };
const NW = { chatId: "19:northwind-team@thread.v2", displayName: "Northwind team", webUrl: null };
const SECRET = "Can you send the totals for project Bluebird?";

type Msg = IncomingMessage & { modifiedAt: string };
function fakeTeams() {
  const chats = new Map<string, Msg[]>();
  const calls: { chatId: string; since: string }[] = [];
  const failures = new Map<string, Error>();
  return {
    calls,
    say: (m: Partial<IncomingMessage>) => {
      const msg = aMessage(m);
      (chats.get(msg.chatId) ?? chats.set(msg.chatId, []).get(msg.chatId)!).push({ ...msg, modifiedAt: msg.createdAt });
      return msg;
    },
    fail: (chatId: string, e: Error | null) => void (e ? failures.set(chatId, e) : failures.delete(chatId)),
    client: {
      messagesSince: async (chatId: string, _clientKey: string, since: string) => {
        calls.push({ chatId, since });
        const f = failures.get(chatId);
        if (f) throw f;
        const messages = (chats.get(chatId) ?? []).filter((m) => Date.parse(m.modifiedAt) > Date.parse(since));
        const newest = messages.map((m) => m.modifiedAt).sort().at(-1) ?? null;
        return { messages, newest };
      },
    },
  };
}

async function setup(o: { pto?: boolean; consent?: boolean } = {}) {
  let now = IN_HOURS;
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(now).toZonedDateTimeISO("America/New_York") });
  const cfg = parseConfig(STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"'));
  if (!cfg.ok) throw new Error("starter config");
  await plan.setAccountState(IDENTITY_KEY, { oid: ME, tid: HOME_TENANT, name: "Sam Tester", username: "sam@contoso.example", email: "sam@contoso.example", signedInAt: IN_HOURS, systemUserId: null, systemUserEmail: null });
  const client = aChatMember({ external: true, displayName: "Dana Client" });
  const colleague = aChatMember({ displayName: "Lee Colleague" });
  for (const [key, chat] of [["fabrikam", FAB], ["northwind", NW]] as const) {
    await plan.addDeliveryChat(key, "customer", chat);
    await plan.setDeliveryChatMembers(chat.chatId, [client, colleague, aChatMember({ userId: ME, displayName: "Sam Tester" })], IN_HOURS);
  }
  const teams = fakeTeams();
  const logs: LogRecord[] = [];
  const consent = { allowed: o.consent ?? true };
  const items: Record<string, WorkItem[]> = {
    fabrikam: [{ id: 501, title: "Monthly totals report", type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order: 1, parentId: null, changedAt: IN_HOURS, url: "https://dev.azure.com/fabrikam/_workitems/edit/501" }],
    northwind: [{ id: 777, title: "Northwind import", type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order: 1, parentId: null, changedAt: IN_HOURS, url: "https://dev.azure.com/northwind/_workitems/edit/777" }],
  };
  const account = {
    chatMessages: teams.client,
    probe: async (kind: TokenKind): Promise<ScopeProbe> => ({ kind, state: consent.allowed ? "granted" : "consent", granted: [] }),
  } as unknown as MicrosoftAccount;
  const ctx: AskContext = {
    plan,
    account,
    config: async () => cfg.config,
    homeTenant: async () => HOME_TENANT,
    pto: async () => !!o.pto,
    openItems: async (_c, k) => items[k] ?? [],
    writeClients: async () => [],
    now: () => now,
    log: (r) => void logs.push(r),
  };
  const run = async <T = AsksData>(action: AskAction, input: unknown): Promise<T> => {
    const r = await askAction(ctx, action, input);
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  const at = (iso: string) => void (now = iso);
  const later = (minutes: number) => at(Temporal.Instant.from(now).add({ minutes }).toString());
  return { plan, ctx, run, teams, logs, client, colleague, consent, at, later };
}
type S = Awaited<ReturnType<typeof setup>>;
const switchOn = (s: S, chat = FAB) => s.run("asks.switch", { chatId: chat.chatId, on: true });

describe("reading the chats (AP-1)", () => {
  it("nothing is read until Read for asks is switched on, and the first read starts from then (no backfill)", async () => {
    const s = await setup();
    s.teams.say({ chatId: FAB.chatId, authorId: s.client.userId, createdAt: "2026-11-04T14:00:00Z", text: "Old question?" });
    expect(await pollAsks(s.ctx, { force: false })).toEqual({ read: 0, added: 0, failed: 0 });
    expect(s.teams.calls).toEqual([]);
    await switchOn(s);
    s.later(1);
    await pollAsks(s.ctx, { force: false });
    expect(s.teams.calls).toEqual([{ chatId: FAB.chatId, since: IN_HOURS }]);
    expect(await s.plan.asks()).toEqual([]);
  });

  it("asks for only messages newer than the last one seen, and stores each once", async () => {
    const s = await setup();
    await switchOn(s);
    s.teams.say({ chatId: FAB.chatId, clientKey: "fabrikam", authorId: s.client.userId, createdAt: "2026-11-04T15:01:00Z", text: SECRET });
    s.later(5);
    expect(await pollAsks(s.ctx, { force: false })).toEqual({ read: 1, added: 1, failed: 0 });
    s.later(5);
    expect(await pollAsks(s.ctx, { force: false })).toEqual({ read: 1, added: 0, failed: 0 });
    expect(s.teams.calls.map((c) => c.since)).toEqual([IN_HOURS, "2026-11-04T15:01:00Z"]);
    expect((await s.plan.asks()).map((a) => a.rule)).toEqual(["question"]);
  });

  it("waits the interval between reads; Refresh reads at once", async () => {
    const s = await setup();
    await switchOn(s);
    s.later(5);
    await pollAsks(s.ctx, { force: false });
    s.later(2);
    expect((await pollAsks(s.ctx, { force: false })).read).toBe(0);
    await s.run("asks.refresh", {});
    expect(s.teams.calls).toHaveLength(2);
  });

  it.each([
    ["outside working hours (22:00)", "2026-11-05T03:00:00Z", false],
    ["on a Saturday", "2026-11-07T15:00:00Z", false],
    ["on a PTO day", IN_HOURS, true],
  ])("reads nothing %s", async (_why, when, pto) => {
    const s = await setup({ pto });
    await switchOn(s);
    s.at(when);
    s.later(10);
    expect(await pollAsks(s.ctx, { force: false })).toEqual({ read: 0, added: 0, failed: 0 });
    expect(s.teams.calls).toEqual([]);
  });

  it("switching off stops the reads", async () => {
    const s = await setup();
    await switchOn(s);
    s.later(5);
    await pollAsks(s.ctx, { force: false });
    await s.run("asks.switch", { chatId: FAB.chatId, on: false });
    s.later(30);
    await pollAsks(s.ctx, { force: false });
    await s.run("asks.refresh", {});
    expect(s.teams.calls).toHaveLength(1);
  });

  it("a 429 waits out Retry-After and says so on that chat; the other chat is still read", async () => {
    const s = await setup();
    await switchOn(s);
    await switchOn(s, NW);
    s.teams.fail(FAB.chatId, new HttpError(429, 120));
    s.teams.say({ chatId: NW.chatId, clientKey: "northwind", authorId: s.client.userId, createdAt: "2026-11-04T15:02:00Z", text: "Please add the new field" });
    s.later(5);
    expect(await pollAsks(s.ctx, { force: false })).toEqual({ read: 1, added: 1, failed: 1 });
    const fab = (await s.plan.deliveryChats()).find((c) => c.chatId === FAB.chatId)!.asks!;
    expect(fab).toMatchObject({ retryAt: "2026-11-04T15:07:00Z", failures: 1 });
    expect(fab.status).toMatch(/slow down\. Reading again at 10:07/);
    // Not before Retry-After, even on Refresh; after it, read again and healthy.
    s.teams.fail(FAB.chatId, null);
    s.later(1);
    await s.run("asks.refresh", {});
    expect(s.teams.calls.filter((c) => c.chatId === FAB.chatId)).toHaveLength(1);
    s.later(5);
    await pollAsks(s.ctx, { force: false });
    expect((await s.plan.deliveryChats()).find((c) => c.chatId === FAB.chatId)!.asks).toMatchObject({ failures: 0, status: null, retryAt: null });
  });

  it("a 429 without Retry-After doubles from a minute", async () => {
    const s = await setup();
    await switchOn(s);
    s.teams.fail(FAB.chatId, new HttpError(429));
    s.later(5);
    await pollAsks(s.ctx, { force: false });
    expect((await s.plan.deliveryChats())[0]!.asks!.retryAt).toBe("2026-11-04T15:06:00Z");
    // Within the interval a timed read doesn't come; a Refresh after the wait does, and the next wait doubles.
    s.later(1);
    await pollAsks(s.ctx, { force: true });
    expect((await s.plan.deliveryChats())[0]!.asks!.retryAt).toBe("2026-11-04T15:08:00Z");
  });

  it("switching on needs Chat.Read: without it nothing is switched on and the UI is told to ask Microsoft", async () => {
    const s = await setup({ consent: false });
    const r = await askAction(s.ctx, "asks.switch", { chatId: FAB.chatId, on: true });
    expect(r).toMatchObject({ ok: false, code: "consent" });
    expect((await s.plan.deliveryChats())[0]!.asks!.on).toBe(false);
  });

  it("my own messages and my colleagues' are stored for context but are never asks", async () => {
    const s = await setup();
    await switchOn(s);
    s.teams.say({ chatId: FAB.chatId, authorId: ME, authorTenant: HOME_TENANT, createdAt: "2026-11-04T15:01:00Z", text: "Can you check this?" });
    s.teams.say({ chatId: FAB.chatId, authorId: s.colleague.userId, authorTenant: HOME_TENANT, createdAt: "2026-11-04T15:02:00Z", text: "Could you look?" });
    s.teams.say({ chatId: FAB.chatId, authorId: s.client.userId, createdAt: "2026-11-04T15:03:00Z", text: "thanks!" });
    s.later(5);
    expect(await pollAsks(s.ctx, { force: false })).toMatchObject({ added: 0 });
  });
});

describe("the Asks tab (AP-1)", () => {
  async function withAsk() {
    const s = await setup();
    await switchOn(s);
    await switchOn(s, NW);
    s.teams.say({ chatId: FAB.chatId, clientKey: "fabrikam", authorId: s.colleague.userId, authorTenant: HOME_TENANT, createdAt: "2026-11-04T15:01:00Z", text: "Before the ask" });
    const m = s.teams.say({ chatId: FAB.chatId, clientKey: "fabrikam", authorId: s.client.userId, createdAt: "2026-11-04T15:02:00Z", text: SECRET, hasImage: true });
    s.teams.say({ chatId: NW.chatId, clientKey: "northwind", authorId: s.client.userId, createdAt: "2026-11-04T15:03:00Z", text: "Northwind needs a fix?" });
    s.later(5);
    await pollAsks(s.ctx, { force: false });
    return { ...s, m, ids: { chatId: FAB.chatId, messageId: m.messageId } };
  }

  it("lists open asks newest first with author, external flag, attachment and the rule; the open count", async () => {
    const s = await withAsk();
    const d = await s.run("asks.list", {});
    expect(d.open).toBe(2);
    expect(d.asks.map((a) => a.clientKey)).toEqual(["northwind", "fabrikam"]);
    expect(d.asks[1]).toMatchObject({ author: "Dana Client", external: true, hasImage: true, matched: "asks a question", text: SECRET, status: "open", chatName: "Fabrikam team" });
    expect(d.asks[1]!.link).toMatch(/^https:\/\/teams\.microsoft\.com\/l\/message\//);
  });

  it("Show context: the messages before it in the same chat only", async () => {
    const s = await withAsk();
    const r = await s.run<{ messages: ContextMessage[] }>("asks.context", s.ids);
    expect(r.messages.map((m) => [m.author, m.text])).toEqual([["Lee Colleague", "Before the ask"]]);
    expect(JSON.stringify(r)).not.toContain("Northwind needs a fix");
  });

  it("Handled with a note, Dismiss, then Undo opens it again; the same resolution twice changes nothing", async () => {
    const s = await withAsk();
    let d = await s.run("asks.resolve", { ...s.ids, status: "handled", note: "Answered in the chat" });
    expect(d.open).toBe(1);
    expect(d.asks.find((a) => a.messageId === s.m.messageId)).toMatchObject({ status: "handled", note: "Answered in the chat" });
    d = await s.run("asks.resolve", { ...s.ids, status: "handled", note: "Answered in the chat" });
    expect(d.open).toBe(1);
    await expect(s.run("asks.resolve", { ...s.ids, status: "dismissed" })).rejects.toThrow(/already resolved/);
    d = await s.run("asks.reopen", s.ids);
    expect(d.open).toBe(2);
    d = await s.run("asks.resolve", { ...s.ids, status: "dismissed" });
    expect(d.asks.find((a) => a.messageId === s.m.messageId)!.status).toBe("dismissed");
  });

  it("Link: only to that client's open items; stores the link, never writes", async () => {
    const s = await withAsk();
    const hits = await s.run<{ items: { id: number }[] }>("asks.search", { ...s.ids, query: "totals" });
    expect(hits.items.map((i) => i.id)).toEqual([501]);
    expect((await s.run<{ items: { id: number }[] }>("asks.search", { ...s.ids, query: "northwind" })).items).toEqual([]);
    await expect(s.run("asks.resolve", { ...s.ids, status: "linked", itemId: 777 })).rejects.toThrow(/isn't one of this client's open items/);
    const d = await s.run("asks.resolve", { ...s.ids, status: "linked", itemId: 501 });
    expect(d.asks.find((a) => a.messageId === s.m.messageId)).toMatchObject({ status: "linked", item: { id: 501, title: "Monthly totals report" } });
  });

  it("a resolved ask leaves the tab after a day; its text is kept with the resolution", async () => {
    const s = await withAsk();
    await s.run("asks.resolve", { ...s.ids, status: "handled" });
    s.later(25 * 60);
    expect((await s.run("asks.list", {})).asks.map((a) => a.clientKey)).toEqual(["northwind"]);
    expect((await s.plan.chatMessage(s.ids.chatId, s.ids.messageId))?.text).toBe(SECRET);
  });

  it("Delete stored messages for a client forgets its text and asks, not another client's", async () => {
    const s = await withAsk();
    await s.run("asks.purge", { clientKey: "fabrikam" });
    const d = await s.run("asks.list", {});
    expect(d.asks.map((a) => a.clientKey)).toEqual(["northwind"]);
    expect(await s.plan.chatMessage(s.ids.chatId, s.ids.messageId)).toBeNull();
  });

  it("no chat text, chat id or person in any log line", async () => {
    const s = await withAsk();
    await s.run("asks.context", s.ids);
    await s.run("asks.resolve", { ...s.ids, status: "handled", note: "Called Dana about Bluebird" });
    await s.run("asks.reopen", s.ids);
    s.teams.fail(FAB.chatId, new HttpError(503, 30));
    await s.run("asks.refresh", {});
    await s.run("asks.purge", { clientKey: "fabrikam" });
    const text = JSON.stringify(s.logs);
    expect(s.logs.length).toBeGreaterThan(3);
    for (const x of ["Bluebird", "totals", "Northwind needs", "Dana", "Lee", "fabrikam-team", "northwind-team", s.m.messageId, s.client.userId!, "@thread"]) expect(text).not.toContain(x);
  });
});
