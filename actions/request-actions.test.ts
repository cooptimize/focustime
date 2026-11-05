// Inbox › Requests on the shared store (D515, D516): each person sees the Requests of chats they are a member of and
// whose client they follow; a resolution is shared (one person resolves, everyone sees it, with their name); Refresh
// polls my visible chats through the job and shows the fetch time; Show context reads the shared messages; purge is
// for someone who sees the client's chats and keeps Requests. Never another client's text, never in a log.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import type { IncomingMessage, RequestsData } from "../plan/asks.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { aChatMember, aMessage, CLIENT_TENANT, HOME_TENANT } from "../test/builders/index.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import type { WorkItem } from "../week/types.ts";
import { requestAction, type RequestAction, type RequestContext } from "./request-actions.ts";
import { pollCycle, type PollDeps } from "./request-poll.ts";

const ANA = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const CY = "00000000-0000-4000-8000-0000000000c3";
const DANA = "00000000-0000-4000-9000-0000000000d1";
const FAB = "19:fabrikam@thread.v2";
const NW = "19:northwind@thread.v2";
const parsed = parseConfig(STARTER_TOML.replace('my_email = ""', 'my_email = "ana@example.com"'));
if (!parsed.ok) throw new Error("starter config");
const cfg = parsed;

async function setup() {
  let now = "2026-11-04T14:00:00Z";
  const db = sqliteDb();
  await addUsers(db.conn, ANA, BEN, CY);
  const teams = createTeamsStore(db.conn, () => Temporal.Instant.from(now));
  const dana = aChatMember({ userId: DANA, displayName: "Dana Client", external: true });
  const member = (id: string, name: string) => aChatMember({ userId: id, displayName: name });
  await teams.addChat({ chatId: FAB, clientKey: "fabrikam", kind: "customer", displayName: "Fabrikam chat", webUrl: null, members: [member(ANA, "Ana"), member(BEN, "Ben"), dana], by: ANA });
  // Cy follows Fabrikam too but isn't in its chat; only Cy is in the Northwind chat.
  await teams.addChat({ chatId: NW, clientKey: "northwind", kind: "customer", displayName: "Northwind chat", webUrl: null, members: [member(CY, "Cy"), dana], by: CY });
  now = "2026-11-04T15:00:00Z";
  const said = new Map<string, (IncomingMessage & { modifiedAt: string })[]>();
  const say = (chatId: string, o: Partial<IncomingMessage> = {}) => {
    const m = aMessage({ chatId, clientKey: chatId === FAB ? "fabrikam" : "northwind", authorId: DANA, authorTenant: CLIENT_TENANT, createdAt: "2026-11-04T14:30:00Z", text: "Can you check the export?", ...o });
    (said.get(chatId) ?? said.set(chatId, []).get(chatId)!).push({ ...m, modifiedAt: m.createdAt });
    return m;
  };
  const items: WorkItem[] = [{ id: 501, title: "Export fix", type: "Bug", state: "Active", stateCategory: "InProgress", level: "story", order: 1, parentId: null, changedAt: now, url: "https://dev.azure.com/contoso/_workitems/edit/501" }];
  const logs: LogRecord[] = [];
  const names: Record<string, string> = { [ANA]: "Ana", [BEN]: "Ben", [CY]: "Cy" };
  const deps: PollDeps = {
    teams,
    users: async () => Object.entries(names).map(([id, name]) => ({ id, name, deleted: false })),
    person: async (uid) => ({
      name: names[uid]!, config: cfg.config, plan: null, ai: null, openItems: async () => items,
      chatMessages: { messagesSince: async (c, _k, since) => {
        const fresh = (said.get(c) ?? []).filter((m) => Date.parse(m.modifiedAt) > Date.parse(since));
        return { messages: fresh, newest: fresh.map((m) => m.modifiedAt).sort().at(-1) ?? null };
      } },
    }),
    homeTenant: async () => HOME_TENANT,
    now: () => now,
    log: (r) => void logs.push(r),
  };
  const ctxOf = (me: string, followed = new Set(["fabrikam", "northwind"])): RequestContext => ({
    requests: { teams, refresh: (chatIds) => pollCycle(deps, { force: true, chatIds }) },
    me: async () => me,
    followed: async () => followed,
    config: async () => cfg.config,
    homeTenant: async () => HOME_TENANT,
    openItems: async () => items,
    writeClients: async () => [],
    now: () => now,
    log: (r) => void logs.push(r),
  });
  const run = async <T = RequestsData>(me: string, action: RequestAction, input: unknown = {}, followed?: Set<string>): Promise<T> => {
    const r = await requestAction(ctxOf(me, followed), action, input);
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  const refused = async (me: string, action: RequestAction, input: unknown) => {
    const r = await requestAction(ctxOf(me), action, input);
    return r.ok ? null : r.status;
  };
  return { teams, say, run, refused, logs, deps, later: (m: number) => void (now = Temporal.Instant.from(now).add({ minutes: m }).toString()) };
}

describe("Inbox › Requests on the shared store", () => {
  it("Refresh polls the chats I see through the job and shows when they were fetched", async () => {
    const s = await setup();
    s.say(FAB);
    const d = await s.run(ANA, "requests.refresh");
    expect(d.requests.map((r) => [r.clientKey, r.author, r.text])).toEqual([["fabrikam", "Dana Client", "Can you check the export?"]]);
    expect(d.chats.map((c) => [c.chatId, c.fetchedAt, c.state])).toEqual([[FAB, "2026-11-04T15:00:00Z", "ok"]]);
    expect([d.lastPoll, d.lastFetch, d.pollMinutes]).toEqual(["2026-11-04T15:00:00Z", "2026-11-04T15:00:00Z", 5]);
  });

  it("only members who follow the client see a chat's requests", async () => {
    const s = await setup();
    s.say(FAB);
    s.say(NW, { text: "Can you send the Northwind plan?" });
    await pollCycle(s.deps);
    expect((await s.run(BEN, "requests.list")).requests.map((r) => r.clientKey)).toEqual(["fabrikam"]);
    expect((await s.run(CY, "requests.list")).requests.map((r) => r.clientKey)).toEqual(["northwind"]);
    expect((await s.run(BEN, "requests.list", {}, new Set(["northwind"]))).requests).toEqual([]);
  });

  it("a resolution is shared: Ben dismisses it, Ana sees it dismissed by Ben; Ana's Undo opens it for both", async () => {
    const s = await setup();
    const m = s.say(FAB);
    await pollCycle(s.deps);
    await s.run(BEN, "requests.resolve", { chatId: FAB, messageId: m.messageId, status: "dismissed" });
    expect((await s.run(ANA, "requests.list")).requests[0]).toMatchObject({ status: "dismissed", resolvedBy: "Ben" });
    expect((await s.run(BEN, "requests.list")).requests[0]).toMatchObject({ resolvedBy: "you" });
    await s.run(ANA, "requests.reopen", { chatId: FAB, messageId: m.messageId });
    expect((await s.run(BEN, "requests.list")).requests[0]).toMatchObject({ status: "open", resolvedBy: null });
    expect((await s.teams.request(FAB, m.messageId))?.resolvedBy).toBeNull();
  });

  it("Link takes an open item of the client; someone who doesn't see the chat can't resolve, search or show it", async () => {
    const s = await setup();
    const m = s.say(FAB);
    await pollCycle(s.deps);
    const d = await s.run(ANA, "requests.resolve", { chatId: FAB, messageId: m.messageId, status: "linked", itemId: 501 });
    expect(d.requests[0]).toMatchObject({ status: "linked", item: { id: 501, title: "Export fix" }, resolvedBy: "you" });
    const k = { chatId: FAB, messageId: m.messageId };
    expect(await s.refused(CY, "requests.resolve", { ...k, status: "handled" })).toBe(404);
    expect(await s.refused(CY, "requests.reopen", k)).toBe(404);
    expect(await s.refused(CY, "requests.context", k)).toBe(404);
    expect(await s.refused(CY, "requests.search", k)).toBe(404);
    expect(await s.refused(CY, "requests.show", { ...k, shown: true })).toBe(404);
  });

  it("Show context: the 5 messages before, from the shared store, with names; mine as You", async () => {
    const s = await setup();
    for (let i = 0; i < 6; i++) s.say(FAB, { createdAt: `2026-11-04T14:1${i}:00Z`, text: `note ${i}`, ...(i === 5 ? { authorId: ANA, authorTenant: HOME_TENANT } : {}) });
    const m = s.say(FAB, { createdAt: "2026-11-04T14:30:00Z" });
    await pollCycle(s.deps);
    const c = await s.run<{ messages: { author: string; mine: boolean; text: string }[] }>(BEN, "requests.context", { chatId: FAB, messageId: m.messageId });
    expect(c.messages.map((x) => x.text)).toEqual(["note 1", "note 2", "note 3", "note 4", "note 5"]);
    expect(c.messages.at(-1)).toMatchObject({ author: "Ana", mine: false });
    const mine = await s.run<{ messages: { author: string; mine: boolean }[] }>(ANA, "requests.context", { chatId: FAB, messageId: m.messageId });
    expect(mine.messages.at(-1)).toMatchObject({ author: "You", mine: true });
  });

  it("Delete stored messages: for someone who sees the client's chats; requests stay", async () => {
    const s = await setup();
    s.say(FAB, { text: "thanks" });
    const m = s.say(FAB, { createdAt: "2026-11-04T14:40:00Z" });
    await pollCycle(s.deps);
    expect(await s.refused(CY, "requests.purge", { clientKey: "fabrikam" })).toBe(404);
    const d = await s.run<RequestsData & { purged: number }>(ANA, "requests.purge", { clientKey: "fabrikam" });
    expect(d.purged).toBe(1);
    expect(d.requests.map((r) => r.messageId)).toEqual([m.messageId]);
  });

  it("no chat id or message text in a log line", async () => {
    const s = await setup();
    const m = s.say(FAB, { text: "Can you fix the ZEBRA totals?" });
    await s.run(ANA, "requests.refresh");
    await s.run(ANA, "requests.resolve", { chatId: FAB, messageId: m.messageId, status: "handled", note: "QUOKKA" });
    const text = JSON.stringify(s.logs);
    for (const secret of ["ZEBRA", "QUOKKA", FAB, m.messageId]) expect(text).not.toContain(secret);
  });
});
