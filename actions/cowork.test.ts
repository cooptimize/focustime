// CW-1: co-working calls end to end on fake Graph data. The poll's one read of a registered chat brings its call
// started and ended events with its messages (the real Graph client on a fake fetch); they are recorded apart and never
// become messages, conversations, promises or chatter, and never reach the AI. chats.calls shows a live call only to
// someone in that chat who follows its client, with who started it, and clears it on the end event or after the limit.
import { describe, expect, it } from "vitest";
import { parseConfig, type AppConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { CoworkData } from "../plan/cowork.ts";
import { createChatsClient } from "../sources/graph/chats.ts";
import { aCallEventMessage, aChatMember, HOME_TENANT } from "../test/builders/index.ts";
import { BLAKE, CHAT, EVAN, LENA, SAM, world } from "../test/conversations.ts";
import { chatAction, type ChatContext } from "./chat-actions.ts";
import { pollCycle, type PollDeps } from "./request-poll.ts";

const parsed = parseConfig(STARTER_TOML.replace('my_email = ""', 'my_email = "evan@contoso.example"'));
if (!parsed.ok) throw new Error("starter config");
const CFG: AppConfig = parsed.config;

const REGISTERED = "2026-11-04T14:00:00Z";
const STARTED = "2026-11-04T14:12:00Z"; // 8:12 in Chicago
const POLL = "2026-11-04T14:20:00Z"; // a Wednesday, inside working hours
const CALL = "9c848c0e-f906-4dfc-b22e-c68a785a587c";

/** A person's message as Graph returns it (a client asking something), fictional. */
const graphMessage = (id: string, at: string, text: string) => ({
  id, messageType: "message", createdDateTime: at, lastModifiedDateTime: at, deletedDateTime: null, chatId: CHAT.chatId,
  from: { user: { id: BLAKE.userId, displayName: BLAKE.displayName, tenantId: BLAKE.tenantId, userIdentityType: "aadUser" } },
  body: { contentType: "html", content: `<p>${text}</p>` }, attachments: [], mentions: [], reactions: [],
});

/** The real Graph client on a fake fetch that answers each read with whatever `pages` holds now. */
function fakeGraph(pages: { value: unknown[] }) {
  const urls: string[] = [];
  const client = createChatsClient({ fetch: (async (u: string) => (urls.push(String(u)), new Response(JSON.stringify(pages), { status: 200 }))) as typeof fetch, token: async () => "t", invalidate: () => {}, log: () => {} });
  return { client, urls };
}

async function setup() {
  const w = world();
  const pages: { value: unknown[] } = { value: [] };
  const g = fakeGraph(pages);
  w.setNow(REGISTERED);
  await w.teams.addChat({ chatId: CHAT.chatId, clientKey: CHAT.clientKey, kind: "delivery", displayName: CHAT.displayName, webUrl: null, members: CHAT.members, by: EVAN.userId! });
  let now = POLL;
  const deps: PollDeps = {
    teams: w.teams,
    conversations: w.convs,
    users: async () => w.users,
    person: async (uid) => (w.users.some((u) => u.id === uid) ? { name: "Evan Ford", config: CFG, chatMessages: g.client, ai: null, pipelineAi: async () => w.ai, plan: null, openItems: async () => [] } : null),
    homeTenant: async () => HOME_TENANT,
    now: () => now,
    log: () => {},
  };
  const calls = async (o: { me?: string; follows?: string[]; at?: string } = {}) => {
    const ctx: ChatContext = { teams: w.teams, me: async () => o.me ?? LENA.userId!, account: null, homeTenant: async () => HOME_TENANT, clientKeys: async () => new Set(o.follows ?? ["contoso"]), now: () => o.at ?? now };
    const r = await chatAction(ctx, "chats.calls", {});
    if (!r.ok) throw new Error(r.error);
    return r.data as CoworkData;
  };
  return { w, pages, g, deps, calls, poll: (at: string) => ((now = at), pollCycle(deps, { force: true })) };
}

describe("CW-1: a co-working call in a registered delivery chat", () => {
  it("call started shows 'live' with when and who started it; call ended clears it", async () => {
    const s = await setup();
    s.pages.value = [aCallEventMessage({ at: STARTED, initiator: EVAN.userId!, callId: CALL })];
    expect(await s.poll(POLL)).toMatchObject({ polled: 1, calls: 1, messages: 0 });
    // One read of the chat, the same request as for messages: nothing new is asked of Graph.
    expect(s.g.urls).toHaveLength(1);
    expect(decodeURIComponent(s.g.urls[0]!)).toContain(`/chats/${CHAT.chatId}/messages?$top=50&$orderby=lastModifiedDateTime desc&$filter=lastModifiedDateTime gt`);
    const live = (await s.calls()).chats[0]!;
    expect(live).toEqual({ clientKey: "contoso", chatId: CHAT.chatId, name: CHAT.displayName, link: "https://teams.microsoft.com/l/chat/19%3Acontoso-alliance%40thread.v2/conversations", live: { startedAt: "2026-11-04T14:12:00Z", by: "Evan Ford", byOutside: false } });

    s.pages.value = [aCallEventMessage({ kind: "ended", at: "2026-11-04T15:40:00Z", callId: CALL, duration: "PT1H28M", participants: ["Evan Ford", "Lena Hart"] })];
    await s.poll("2026-11-04T15:45:00Z");
    expect((await s.calls()).chats[0]!.live).toBeNull();
    // Only the call's id, times and starter are kept: never the participants.
    expect(JSON.stringify(await s.w.conn.all("SELECT * FROM chat_calls"))).not.toContain("Lena");
  });

  it(`a call with no end event clears after the limit (10 hours)`, async () => {
    const s = await setup();
    s.pages.value = [aCallEventMessage({ at: STARTED, initiator: EVAN.userId! })];
    await s.poll(POLL);
    expect((await s.calls({ at: "2026-11-05T00:11:00Z" })).chats[0]!.live).not.toBeNull();
    expect((await s.calls({ at: "2026-11-05T00:12:00Z" })).chats[0]!.live).toBeNull();
  });

  it("someone outside Cooptimize who starts it is never named", async () => {
    const s = await setup();
    s.pages.value = [aCallEventMessage({ at: STARTED, initiator: BLAKE.userId!, tenant: BLAKE.tenantId })];
    await s.poll(POLL);
    expect((await s.calls()).chats[0]!.live).toEqual({ startedAt: "2026-11-04T14:12:00Z", by: null, byOutside: true });
    expect(JSON.stringify(await s.calls())).not.toContain(BLAKE.displayName!);
  });

  it("call events never become messages, conversations, promises or chatter, and never go to the AI", async () => {
    const s = await setup();
    s.pages.value = [
      aCallEventMessage({ at: STARTED, initiator: EVAN.userId!, messageType: "systemEventMessage" }),
      graphMessage("1730000000901", "2026-11-04T14:15:00Z", "Can you check why the movement export fails?"),
      aCallEventMessage({ kind: "ended", at: "2026-11-04T14:18:00Z", duration: "PT6M" }),
    ];
    const r = await s.poll(POLL);
    expect(r).toMatchObject({ messages: 1, calls: 2 });
    expect((await s.w.conn.all("SELECT message_id FROM teams_messages")).map((x) => x.message_id)).toEqual(["1730000000901"]);
    const places = await s.w.conn.all("SELECT message_id FROM conversation_messages");
    expect(places.every((x) => x.message_id === "1730000000901")).toBe(true);
    expect(await s.w.conn.all("SELECT id FROM commitments")).toEqual([]);
    // The AI saw the one message, and nothing of the calls.
    expect(s.w.calls.length).toBeGreaterThan(0);
    const sent = s.w.calls.map((c) => c.input).join("\n");
    expect(sent).toContain("movement export");
    for (const x of [CALL, "callStarted", "callEnded", "systemEventMessage", "PT6M"]) expect(sent).not.toContain(x);
  });

  it("an unregistered chat's call events are ignored", async () => {
    const s = await setup();
    expect(await s.w.teams.saveCalls("19:unregistered@thread.v2", [{ chatId: "19:unregistered@thread.v2", callId: "x", kind: "started", at: STARTED, startedAt: STARTED, initiatorId: null, initiatorTenant: null }])).toBe(0);
    expect(await s.w.conn.all("SELECT chat_id FROM chat_calls")).toEqual([]);
  });

  it("only someone in the chat who follows its client sees it; reading off shows no live call but Start a call stays", async () => {
    const s = await setup();
    s.pages.value = [aCallEventMessage({ at: STARTED, initiator: EVAN.userId! })];
    await s.poll(POLL);
    expect((await s.calls({ me: SAM.userId! })).chats.map((c) => !!c.live)).toEqual([true]);
    expect((await s.calls({ me: aChatMember().userId! })).chats).toEqual([]);
    expect((await s.calls({ me: SAM.userId!, follows: ["fabrikam"] })).chats).toEqual([]);
    await s.w.teams.setReading(CHAT.chatId, false, EVAN.userId!);
    expect((await s.calls()).chats).toEqual([expect.objectContaining({ chatId: CHAT.chatId, live: null })]);
  });

  it("a call started before the chat was registered isn't read; removing the chat forgets its calls", async () => {
    const s = await setup();
    s.pages.value = [aCallEventMessage({ at: "2026-11-04T13:00:00Z", initiator: EVAN.userId! })];
    await s.poll(POLL);
    expect((await s.calls()).chats[0]!.live).toBeNull();
    s.pages.value = [aCallEventMessage({ at: STARTED, callId: "second", initiator: EVAN.userId! })];
    await s.poll("2026-11-04T14:30:00Z");
    expect(await s.w.conn.all("SELECT call_id FROM chat_calls")).toEqual([{ call_id: "second" }]);
    await s.w.teams.removeChat(CHAT.chatId, EVAN.userId!);
    expect(await s.w.conn.all("SELECT call_id FROM chat_calls")).toEqual([]);
  });
});
