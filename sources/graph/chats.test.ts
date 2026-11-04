// T-2 and AP-1: reading Teams group chats from Graph. A member's guest role is kept (it makes them external); only the
// listed fields survive parsing; logs carry the op, status and count, never a chat id, a topic or a person.
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { CLIENT_TENANT, HOME_TENANT } from "../../test/builders/index.ts";
import { HttpError } from "../calendar/http.ts";
import { chatOf, createChatsClient, memberOf, messageOf, retryAfterOf } from "./chats.ts";

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

const CHAT = "19:fabrikam-secret@thread.v2";
const gmsg = (o: Record<string, unknown> = {}) => ({
  id: "1730000000001", messageType: "message", createdDateTime: "2026-11-04T15:01:00.123Z", lastModifiedDateTime: "2026-11-04T15:01:00.123Z", deletedDateTime: null,
  replyToId: null, chatId: CHAT, importance: "normal", subject: null, etag: "1730000000001", webUrl: null,
  from: { user: { id: "00000000-0000-4000-8000-000000000001", displayName: "Dana Client", tenantId: CLIENT_TENANT, userIdentityType: "aadUser" } },
  body: { contentType: "html", content: "<p>Can you <b>check</b> the totals?</p><p>Thanks &amp; regards</p>" },
  attachments: [], mentions: [], reactions: [{ reactionType: "like", user: { user: { id: "x", displayName: "Someone" } } }],
  ...o,
});

describe("Graph chat messages (AP-1)", () => {
  it("keeps only the shared store's fields (D514): the sender's name and the raw body, no reactions, subjects or URLs", () => {
    const m = messageOf(gmsg({ mentions: [{ id: 0, mentionText: "Ana", mentioned: { user: { id: "00000000-0000-4000-8000-0000000000a1", displayName: "Ana Registrar" } } }] }), CHAT, "fabrikam")!;
    expect(Object.keys(m).sort()).toEqual(["authorId", "authorName", "authorTenant", "chatId", "clientKey", "createdAt", "hasFile", "hasImage", "html", "mentionedUserIds", "mentions", "messageId", "modifiedAt", "replyToId", "text"]);
    expect(m.text).toBe("Can you check the totals?\nThanks & regards");
    expect(m).toMatchObject({ authorName: "Dana Client", html: "<p>Can you <b>check</b> the totals?</p><p>Thanks &amp; regards</p>", mentions: [{ id: "00000000-0000-4000-8000-0000000000a1", name: "Ana Registrar" }] });
    expect(JSON.stringify(m)).not.toContain("Someone");
    expect(JSON.stringify(m)).not.toContain("like");
  });

  it.each([
    ["a system event", { messageType: "systemEventMessage" }],
    ["a deleted message", { deletedDateTime: "2026-11-04T15:02:00Z" }],
    ["no id", { id: undefined }],
  ])("skips %s", (_why, o) => {
    expect(messageOf(gmsg(o), CHAT, "fabrikam")).toBeNull();
  });

  it.each([
    ["an inline image", { body: { contentType: "html", content: '<p>see</p><img src="https://graph.microsoft.com/x">' } }, true, false],
    ["a shared file", { attachments: [{ contentType: "reference", name: "report.xlsx" }] }, false, true],
    ["a card", { attachments: [{ contentType: "application/vnd.microsoft.card.adaptive" }] }, false, false],
    ["a quoted reply", { attachments: [{ contentType: "messageReference" }] }, false, false],
  ])("%s", (_why, o, image, file) => {
    expect(messageOf(gmsg(o), CHAT, "fabrikam")).toMatchObject({ hasImage: image, hasFile: file });
  });

  it("reads the mentioned user ids", () => {
    expect(messageOf(gmsg({ mentions: [{ id: 0, mentionText: "Sam", mentioned: { user: { id: "00000000-0000-4000-8000-0000000000aa", displayName: "Sam" } } }] }), CHAT, "fabrikam")?.mentionedUserIds).toEqual(["00000000-0000-4000-8000-0000000000aa"]);
  });

  it("asks for messages changed after the last one seen, newest first, and reports the newest change", async () => {
    const urls: string[] = [];
    const body = { value: [gmsg({ id: "2", createdDateTime: "2026-11-04T15:03:00Z", lastModifiedDateTime: "2026-11-04T15:04:00Z" }), gmsg()] };
    const client = createChatsClient({ fetch: (async (u: string) => (urls.push(String(u)), new Response(JSON.stringify(body), { status: 200 }))) as typeof fetch, token: async () => "t", invalidate: () => {}, log: () => {} });
    const r = await client.messagesSince(CHAT, "fabrikam", "2026-11-04T15:00:00Z");
    expect(decodeURIComponent(urls[0]!)).toBe(`https://graph.microsoft.com/v1.0/chats/${CHAT}/messages?$top=50&$orderby=lastModifiedDateTime desc&$filter=lastModifiedDateTime gt 2026-11-04T15:00:00.000Z`);
    expect(r.newest).toBe("2026-11-04T15:04:00.000Z");
    expect(r.messages.map((m) => m.messageId)).toEqual(["1730000000001", "2"]);
  });

  it("a 429 carries Retry-After (seconds or a date)", async () => {
    const client = createChatsClient({ fetch: (async () => new Response("slow down", { status: 429, headers: { "retry-after": "30" } })) as typeof fetch, token: async () => "t", invalidate: () => {}, log: () => {} });
    await expect(client.messagesSince(CHAT, "fabrikam", "2026-11-04T15:00:00Z")).rejects.toMatchObject({ status: 429, retryAfter: 30 });
    expect(retryAfterOf("Wed, 04 Nov 2026 15:01:00 GMT", Date.parse("2026-11-04T15:00:00Z"))).toBe(60);
    expect(new HttpError(429).retryAfter).toBeNull();
  });

  it("logs the op, status and count only: never the text, the chat or a person", async () => {
    const logs: LogRecord[] = [];
    const client = createChatsClient({ fetch: (async () => new Response(JSON.stringify({ value: [gmsg()] }), { status: 200 })) as typeof fetch, token: async () => "t", invalidate: () => {}, log: (r) => logs.push(r) });
    await client.messagesSince(CHAT, "fabrikam", "2026-11-04T15:00:00Z");
    expect(logs).toEqual([expect.objectContaining({ op: "chat_messages", status: 200, count: 1 })]);
    for (const x of ["totals", "fabrikam-secret", "Dana", "1730000000001", "00000000-0000-4000-8000-000000000001"]) expect(JSON.stringify(logs)).not.toContain(x);
  });
});
