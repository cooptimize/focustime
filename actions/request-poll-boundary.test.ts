// GD-2 Part 1 through the shared poll: the chat's audience comes from its members at poll time. A chat whose members
// are all Cooptimizers has its old holds (GD-1's whole-batch refusals, and GD-2's own mention holds) sorted once,
// through the normal pipeline; a chat with someone outside Cooptimize keeps a real mention held. Fictional names.
import { describe, expect, it } from "vitest";
import type { ProviderCall } from "../ai/types.ts";
import { aClientChat, aClientEntry, aConversationUpdate, anUpdateAnswer, HOME_TENANT } from "../test/builders/index.ts";
import { BLAKE, CHAT, EVAN, SAM, world } from "../test/conversations.ts";
import { cfg } from "../test/conversation-people.ts";
import { addUsers } from "../test/db.ts";
import { HELD_MENTION, LEGACY_CLIENT_REFUSED } from "../plan/conversations.ts";
import type { ChatMessagesClient } from "../sources/graph/chats.ts";
import { pollCycle, type PollDeps } from "./request-poll.ts";

const directory = [aClientEntry({ key: "contoso", names: ["Contoso Supply"], projects: [], itemIds: [] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam"], projects: [], itemIds: [] })];
const TEAM = aClientChat({ chatId: "19:contoso-team@thread.v2", clientKey: "contoso", kind: "delivery", displayName: "Contoso team", members: [EVAN, SAM] });

async function setup() {
  // Every message sent is work in one conversation (read from the request's own refs).
  const respond = (c: ProviderCall) => {
    const input = JSON.parse(c.input) as { messages: { ref: string }[] };
    return JSON.stringify(anUpdateAnswer({ messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: "n1", confident_new_topic: false })), conversations: [aConversationUpdate({ ref: "n1" })] }));
  };
  const w = world({ directory, allowed: ["contoso"], respond });
  await addUsers(w.conn, EVAN.userId!, SAM.userId!);
  const quiet: ChatMessagesClient = { messagesSince: async () => ({ messages: [], newest: null }) };
  const deps: PollDeps = {
    teams: w.teams,
    conversations: w.convs,
    users: async () => [{ id: EVAN.userId!, name: "Evan Ford", deleted: false }],
    person: async () => ({ name: "Evan Ford", config: cfg, chatMessages: quiet, ai: null, pipelineAi: async () => w.ai, plan: null, openItems: async () => [], boundary: async () => ({ internal: false, directory }) }),
    homeTenant: async () => HOME_TENANT,
    audienceRules: async (home) => ({ homeTenant: home, automation: [], domains: [] }),
    now: w.now,
    log: () => {},
  };
  const hold = async (chat: typeof CHAT, text: string, reason: string) => {
    const m = await w.say(chat, chat === CHAT ? BLAKE : EVAN, "2026-11-04T15:00:00Z", text);
    await w.teams.recordPoll(chat.chatId, { polledAt: null, retryAt: null, failures: 0, state: null, note: null, tokenUser: null });
    await w.convs.place([{ chatId: m.chatId, messageId: m.messageId, conversationId: null, role: "unsorted", reason, placedBy: "rule", at: m.createdAt }]);
    return m;
  };
  const reasonOf = async (chatId: string, messageId: string) => (await w.convs.placeOf(chatId, messageId))?.reason ?? "sorted";
  return { w, deps, hold, reasonOf, poll: () => pollCycle(deps, { force: true }) };
}

describe("GD-2: the poll sorts by audience", () => {
  it("an all-Cooptimizer chat's old holds are sorted once; a client-facing chat's real mention stays held", async () => {
    const s = await setup();
    const a = await s.hold(TEAM, "Same issue Fabrikam had last month, can someone check the export?", LEGACY_CLIENT_REFUSED);
    const b = await s.hold(TEAM, "Fabrikam's totals look right, ours don't", HELD_MENTION);
    const c = await s.hold(CHAT, "Same issue Fabrikam had last month", LEGACY_CLIENT_REFUSED);
    const r1 = await s.poll();
    expect(r1.aiCalls).toBe(1);
    expect(await s.reasonOf(TEAM.chatId, a.messageId)).toBe("sorted");
    expect(await s.reasonOf(TEAM.chatId, b.messageId)).toBe("sorted");
    expect(await s.reasonOf(CHAT.chatId, c.messageId)).toBe(HELD_MENTION);
    // The internal chat's AI request kept the mention (words travel there).
    expect(s.w.calls.some((x) => x.input.includes("Fabrikam's totals"))).toBe(true);
    const calls = s.w.calls.length;
    // Once: the next poll sends nothing again.
    await s.poll();
    expect(s.w.calls).toHaveLength(calls);
    expect(await s.reasonOf(CHAT.chatId, c.messageId)).toBe(HELD_MENTION);
  });
});
