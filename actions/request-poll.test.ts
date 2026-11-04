// Shared polling, the job (D514 to D517): one cycle polls each registered chat once inside the union of its followers'
// working hours, stores each message once whoever follows the chat, runs the candidate rules so Requests appear without
// anyone opening FocusTime, and falls back to another follower's token when the registering person's fails ("polling
// via"), or marks the chat "needs reconnecting" without stopping the others. Each cycle is logged with counts and the
// token's owner by name; never a chat, a message or a token.
import { describe, expect, it } from "vitest";
import { parseConfig, type AppConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import type { IncomingMessage } from "../plan/asks.ts";
import type { ChatMember } from "../plan/chats.ts";
import { HttpError } from "../sources/calendar/http.ts";
import type { ChatMessagesClient } from "../sources/graph/chats.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { aMessage, CLIENT_TENANT, HOME_TENANT } from "../test/builders/index.ts";
import { pollCycle, requestsNextDue, type PollDeps, type PollPerson } from "./request-poll.ts";

const IN_HOURS = "2026-11-04T15:00:00Z"; // a Wednesday, 10:00 in New York
const NIGHT = "2026-11-05T03:00:00Z";
const ANA = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const DANA = "00000000-0000-4000-9000-0000000000d1";
const FAB = "19:fabrikam@thread.v2";
const NW = "19:northwind@thread.v2";

const cfgText = STARTER_TOML.replace('my_email = ""', 'my_email = "ana@example.com"'); // working hours 9 to 5 in New York, Monday to Friday
const parsed = parseConfig(cfgText);
if (!parsed.ok) throw new Error(`starter config: ${JSON.stringify(parsed.errors)}`);
const CFG: AppConfig = parsed.config;

const member = (userId: string, displayName: string, tenantId = HOME_TENANT): ChatMember => ({ userId, displayName, email: null, tenantId });
const MEMBERS = [member(ANA, "Ana Registrar"), member(BEN, "Ben Colleague"), member(DANA, "Dana Client", CLIENT_TENANT)];

type Msg = IncomingMessage & { modifiedAt: string; html?: string; authorName?: string | null; mentions?: { id: string; name: string | null }[] };

/** A fake Graph: each chat's messages, and per person whether their token works. Counts reads per chat. */
function fakeGraph() {
  const messages = new Map<string, Msg[]>();
  const reads = new Map<string, number>();
  const broken = new Map<string, Error>();
  const clientFor = (uid: string): ChatMessagesClient => ({
    async messagesSince(chatId, _clientKey, since) {
      const e = broken.get(uid);
      if (e) throw e;
      reads.set(chatId, (reads.get(chatId) ?? 0) + 1);
      const fresh = (messages.get(chatId) ?? []).filter((m) => Date.parse(m.modifiedAt) > Date.parse(since));
      return { messages: fresh, newest: fresh.map((m) => m.modifiedAt).sort().at(-1) ?? null };
    },
  });
  const say = (chatId: string, o: Partial<Msg> = {}) => {
    const m: Msg = { ...aMessage({ chatId, clientKey: chatId === FAB ? "fabrikam" : "northwind", authorId: DANA, authorTenant: CLIENT_TENANT, createdAt: "2026-11-04T14:50:00Z", text: "Can you check why the export fails?", ...o }), modifiedAt: o.modifiedAt ?? o.createdAt ?? "2026-11-04T14:50:00Z", authorName: "Dana Client", ...o };
    (messages.get(chatId) ?? messages.set(chatId, []).get(chatId)!).push(m);
    return m;
  };
  return { messages, reads, broken, clientFor, say };
}

async function setup(o: { now?: string } = {}) {
  let now = o.now ?? IN_HOURS;
  const db = sqliteDb();
  await addUsers(db.conn, ANA, BEN);
  const teams = createTeamsStore(db.conn, () => Temporal.Instant.from(now));
  const graph = fakeGraph();
  const logs: LogRecord[] = [];
  const names: Record<string, string> = { [ANA]: "Ana Registrar", [BEN]: "Ben Colleague" };
  const person = async (uid: string): Promise<PollPerson | null> =>
    names[uid] ? { name: names[uid], config: CFG, chatMessages: graph.clientFor(uid), ai: null, plan: null, openItems: async () => [] } : null;
  const deps: PollDeps = {
    teams,
    users: async () => Object.entries(names).map(([id, name]) => ({ id, name, deleted: false })),
    person,
    homeTenant: async () => HOME_TENANT,
    now: () => now,
    log: (r) => void logs.push(r),
  };
  const register = async (chatId: string, clientKey: string, by = ANA) => {
    await teams.addChat({ chatId, clientKey, kind: "customer", displayName: `${clientKey} chat`, webUrl: null, members: MEMBERS, by });
    // Reading starts at registration: messages after it count.
    await teams.recordPoll(chatId, { polledAt: null, retryAt: null, failures: 0, state: null, note: null, tokenUser: null });
  };
  return { teams, graph, logs, deps, register, later: (minutes: number) => void (now = Temporal.Instant.from(now).add({ minutes }).toString()), setNow: (t: string) => void (now = t) };
}

describe("one poll cycle", () => {
  it("two people follow the same chat: one read, each message stored once, the Request made by the job", async () => {
    const s = await setup({ now: "2026-11-04T14:00:00Z" });
    await s.register(FAB, "fabrikam");
    s.setNow(IN_HOURS);
    const m = s.graph.say(FAB);
    s.graph.say(FAB, { text: "thanks!" });
    const r = await pollCycle(s.deps);
    expect(s.graph.reads.get(FAB)).toBe(1);
    expect(r).toMatchObject({ polled: 1, messages: 2, candidates: 1, failures: 0 });
    expect((await s.teams.messagesBefore(FAB, "2026-12-01T00:00:00Z", 10)).map((x) => x.messageId)).toHaveLength(2);
    expect(await s.teams.requests([FAB])).toEqual([expect.objectContaining({ messageId: m.messageId, status: "open", rule: "question" })]);
    expect(await s.teams.message(FAB, m.messageId)).toMatchObject({ senderName: "Dana Client", fetchedAt: IN_HOURS });
  });

  it("a chat with no member list yet (migrated): read with the registrant's token, members first, then everyone in it sees it", async () => {
    const s = await setup({ now: "2026-11-04T14:00:00Z" });
    await s.teams.addChat({ chatId: FAB, clientKey: "fabrikam", kind: "customer", displayName: "Fabrikam chat", webUrl: null, members: null, by: ANA });
    expect(await s.teams.viewer(BEN).chats()).toEqual([]);
    const person = s.deps.person;
    s.deps.person = async (uid) => {
      const p = await person(uid);
      return p && { ...p, chats: { members: async () => MEMBERS } };
    };
    s.setNow(IN_HOURS);
    const m = s.graph.say(FAB);
    expect(await pollCycle(s.deps)).toMatchObject({ polled: 1, candidates: 1 });
    expect(await s.teams.chat(FAB)).toMatchObject({ tokenUser: ANA, membersFetchedAt: IN_HOURS });
    expect((await s.teams.viewer(BEN).requests()).map((r) => r.messageId)).toEqual([m.messageId]);
  });

  it("a chat with reading off isn't read and wakes nobody; turned on, it reads from that moment (D523)", async () => {
    const s = await setup({ now: "2026-11-04T14:00:00Z" });
    await s.register(FAB, "fabrikam");
    await s.teams.setReading(FAB, false, ANA);
    s.setNow(IN_HOURS);
    s.graph.say(FAB, { createdAt: "2026-11-04T14:55:00Z" });
    expect(await pollCycle(s.deps)).toMatchObject({ polled: 0 });
    expect(await pollCycle(s.deps, { force: true, chatIds: [FAB] })).toMatchObject({ polled: 0 });
    expect(s.graph.reads.get(FAB)).toBeUndefined();
    expect(await requestsNextDue(s.deps)).toBeNull();
    await s.teams.setReading(FAB, true, ANA);
    s.later(1);
    const after = s.graph.say(FAB, { createdAt: "2026-11-04T15:00:30Z" });
    expect(await pollCycle(s.deps)).toMatchObject({ polled: 1, messages: 1 });
    expect((await s.teams.requests([FAB])).map((r) => r.messageId)).toEqual([after.messageId]);
  });

  it("a message already stored isn't stored again; an edit updates its body", async () => {
    const s = await setup({ now: "2026-11-04T14:00:00Z" });
    await s.register(FAB, "fabrikam");
    s.setNow(IN_HOURS);
    const m = s.graph.say(FAB);
    await pollCycle(s.deps);
    // Graph's filter is on lastModifiedDateTime: the next read asks for messages changed after the newest seen.
    s.later(5);
    expect(await pollCycle(s.deps)).toMatchObject({ polled: 1, messages: 0, updated: 0, candidates: 0 });
    // The same message, edited: stored text follows, no second Request.
    s.graph.messages.set(FAB, [{ ...s.graph.messages.get(FAB)![0]!, modifiedAt: "2026-11-04T15:03:00Z", text: "Can you check why the March export fails?" }]);
    s.later(5);
    expect(await pollCycle(s.deps)).toMatchObject({ messages: 0, updated: 1, candidates: 0 });
    expect(await s.teams.message(FAB, m.messageId)).toMatchObject({ text: "Can you check why the March export fails?" });
    expect(await s.teams.requests([FAB])).toHaveLength(1);
  });

  it("nothing from before the chat was registered (no backfill)", async () => {
    const s = await setup();
    s.graph.say(FAB, { createdAt: "2026-11-04T14:00:00Z", modifiedAt: "2026-11-04T14:00:00Z" });
    await s.register(FAB, "fabrikam");
    expect(await pollCycle(s.deps)).toMatchObject({ messages: 0, candidates: 0 });
  });

  it("the registering person's token fails, another follower's works: the poll succeeds, the chat is polled via them", async () => {
    const s = await setup({ now: "2026-11-04T14:00:00Z" });
    await s.register(FAB, "fabrikam");
    s.setNow(IN_HOURS);
    s.graph.broken.set(ANA, new AuthFailure("expired", "refresh failed"));
    s.graph.say(FAB);
    const r = await pollCycle(s.deps);
    expect(r).toMatchObject({ polled: 1, messages: 1, failures: 0 });
    expect(await s.teams.chat(FAB)).toMatchObject({ pollState: "via", tokenUser: BEN, fetchedAt: IN_HOURS });
    // Once Ana's sign-in works again, her token is used and "via" clears.
    s.graph.broken.delete(ANA);
    s.later(5);
    await pollCycle(s.deps);
    expect(await s.teams.chat(FAB)).toMatchObject({ pollState: "ok", tokenUser: ANA });
  });

  it("every token fails: needs reconnecting with the last fetch kept, nothing escapes, other chats still poll", async () => {
    const s = await setup({ now: "2026-11-04T14:00:00Z" });
    await s.register(FAB, "fabrikam");
    await s.register(NW, "northwind", BEN);
    s.setNow(IN_HOURS);
    await pollCycle(s.deps);
    const lastGood = (await s.teams.chat(FAB))!.fetchedAt;
    // Fabrikam: Ana's token is refused there (403) and Ben's sign-in has expired, so nobody can read it. Northwind
    // (registered by Ben) is still read, with Ana's token.
    s.graph.broken.set(BEN, new AuthFailure("expired", "refresh failed"));
    const ana = s.graph.clientFor(ANA);
    s.deps.person = async (uid) =>
      uid === ANA ? { name: "Ana Registrar", config: CFG, ai: null, plan: null, openItems: async () => [], chatMessages: { messagesSince: (c, k, since) => (c === FAB ? Promise.reject(new HttpError(403, null)) : ana.messagesSince(c, k, since)) } }
      : uid === BEN ? { name: "Ben Colleague", config: CFG, ai: null, plan: null, openItems: async () => [], chatMessages: s.graph.clientFor(BEN) } : null;
    s.graph.say(NW);
    s.later(5);
    const r = await pollCycle(s.deps);
    expect(r).toMatchObject({ polled: 1, failures: 1, messages: 1 });
    expect(await s.teams.chat(FAB)).toMatchObject({ pollState: "reconnect", tokenUser: null, fetchedAt: lastGood });
    expect(await s.teams.chat(NW)).toMatchObject({ pollState: "via", tokenUser: ANA });
  });

  it("a throttle isn't a token problem: wait out Retry-After, don't try other people", async () => {
    const s = await setup({ now: "2026-11-04T14:00:00Z" });
    await s.register(FAB, "fabrikam");
    s.setNow(IN_HOURS);
    s.graph.broken.set(ANA, new HttpError(429, 120));
    const r = await pollCycle(s.deps);
    expect(r).toMatchObject({ polled: 0, failures: 1 });
    expect(s.graph.reads.get(FAB)).toBeUndefined();
    expect(await s.teams.chat(FAB)).toMatchObject({ pollState: "retry", retryAt: "2026-11-04T15:02:00Z" });
  });

  it("outside everyone's working hours nothing is polled; Refresh polls anyway", async () => {
    const s = await setup({ now: "2026-11-04T14:00:00Z" });
    await s.register(FAB, "fabrikam");
    s.setNow(NIGHT);
    s.graph.say(FAB, { createdAt: "2026-11-05T02:00:00Z", modifiedAt: "2026-11-05T02:00:00Z" });
    expect(await pollCycle(s.deps)).toMatchObject({ polled: 0 });
    expect(s.graph.reads.get(FAB)).toBeUndefined();
    expect(await pollCycle(s.deps, { force: true, chatIds: [FAB] })).toMatchObject({ polled: 1, messages: 1 });
  });

  it("one cycle polls each chat once, and logs counts and the token's owner by name only", async () => {
    const s = await setup({ now: "2026-11-04T14:00:00Z" });
    await s.register(FAB, "fabrikam");
    await s.register(NW, "northwind", BEN);
    s.setNow(IN_HOURS);
    s.graph.say(FAB);
    s.graph.say(NW, { text: "Please add the region field" });
    await pollCycle(s.deps);
    expect([s.graph.reads.get(FAB), s.graph.reads.get(NW)]).toEqual([1, 1]);
    const cycle = s.logs.find((l) => l.op === "requests_poll");
    expect(cycle).toMatchObject({ source: "plan", count: 2 });
    expect(s.logs.filter((l) => l.op === "requests_poll_messages")[0]).toMatchObject({ count: 2 });
    expect(s.logs.filter((l) => l.op === "requests_poll_candidates")[0]).toMatchObject({ count: 2 });
    expect(s.logs.filter((l) => l.op === "requests_poll_token").map((l) => l.kind).sort()).toEqual(["Ana Registrar", "Ben Colleague"]);
    const text = JSON.stringify(s.logs);
    expect(text).not.toContain(FAB);
    expect(text).not.toContain("export");
    expect(text).not.toContain("region");
  });
});
