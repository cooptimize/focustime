// T-2 and AP-1: reading Teams group chats from Graph. A member's guest role is kept (it makes them external); only the
// listed fields survive parsing; logs carry the op, status and count, never a chat id, a topic or a person.
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { CLIENT_TENANT, HOME_TENANT } from "../../test/builders/index.ts";
import { chatOf, createChatsClient, memberOf } from "./chats.ts";

const member = (o: Record<string, unknown> = {}) => ({ "@odata.type": "#microsoft.graph.aadUserConversationMember", id: "m1", roles: [], displayName: "Dana Client", userId: "00000000-0000-4000-8000-000000000001", email: "dana@fabrikam.example", tenantId: CLIENT_TENANT, visibleHistoryStartDateTime: "0001-01-01T00:00:00Z", ...o });

describe("Graph chat members (T-2, AP-1)", () => {
  it.each([
    ["no roles", [], undefined],
    ["owner", ["owner"], undefined],
    ["guest", ["guest"], true],
    ["Guest in capitals", ["Guest"], true],
  ])("roles %s", (_why, roles, guest) => {
    expect(memberOf(member({ roles }))?.guest).toBe(guest);
  });

  it("keeps only userId, displayName, email, tenantId and the guest flag", () => {
    expect(memberOf(member({ roles: ["guest"], tenantId: HOME_TENANT }))).toEqual({ userId: "00000000-0000-4000-8000-000000000001", displayName: "Dana Client", email: "dana@fabrikam.example", tenantId: HOME_TENANT, guest: true });
  });

  it("a chat keeps no message preview, and only group chats are kept", () => {
    const c = chatOf({ id: "19:abc@thread.v2", chatType: "group", topic: "Fabrikam team", webUrl: "https://teams.microsoft.com/l/chat/x", lastMessagePreview: { body: { content: "secret text" } }, members: [member()] });
    expect(JSON.stringify(c)).not.toContain("secret text");
    expect(chatOf({ id: "19:abc@unq.gbl.spaces", chatType: "oneOnOne" })).toBeNull();
  });

  it("logs the op, status and count only: no chat id, topic or person", async () => {
    const logs: LogRecord[] = [];
    const body = { value: [{ id: "19:fabrikam-secret@thread.v2", chatType: "group", topic: "Fabrikam secret topic", members: [member()] }] };
    const client = createChatsClient({ fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch, token: async () => "t", invalidate: () => {}, log: (r) => logs.push(r) });
    expect((await client.groupChats()).length).toBe(1);
    await client.members("19:fabrikam-secret@thread.v2");
    const text = JSON.stringify(logs);
    expect(logs.map((l) => l.op)).toEqual(["chats_list", "chat_members"]);
    for (const s of ["fabrikam-secret", "secret topic", "Dana", "dana@"]) expect(text).not.toContain(s);
  });
});
