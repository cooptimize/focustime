import { describe, expect, it } from "vitest";
import { aChat, aChatMember, CLIENT_TENANT, HOME_TENANT } from "../test/builders/index.ts";
import { chatName, filterChats, flagMembers, isExternal, kindOf, kindWarning, membersStale, memberLine, suggestKind, teamsLink, type ChatMember } from "./chats.ts";

describe("external members, by tenantId and the guest role (T-2, AP-1)", () => {
  it.each([
    ["internal: the home tenant", HOME_TENANT, false, false],
    ["internal: the home tenant in capitals", HOME_TENANT.toUpperCase(), false, false],
    ["federated external: a client's own tenant", CLIENT_TENANT, false, true],
    ["guest: a B2B guest account in the home tenant", HOME_TENANT, true, true],
    ["guest: a guest from a client's tenant", CLIENT_TENANT, true, true],
    ["no tenant (can't be shown to be ours)", null, false, true],
    ["an empty tenant", "", false, true],
  ] as const)("%s", (_why, tenantId, guest, external) => {
    expect(isExternal({ tenantId, ...(guest ? { guest } : {}) }, HOME_TENANT)).toBe(external);
  });

  it("never by name or address: a Cooptimize-looking address in another tenant is external, and the reverse", () => {
    expect(isExternal(aChatMember({ email: "ana@cooptimize.example", tenantId: CLIENT_TENANT }), HOME_TENANT)).toBe(true);
    expect(isExternal(aChatMember({ email: "guest@fabrikam.example", displayName: "Fabrikam Guest", tenantId: HOME_TENANT }), HOME_TENANT)).toBe(false);
  });

  it("refuses a home tenant that isn't a tenant id", () => {
    expect(() => isExternal({ tenantId: CLIENT_TENANT }, "cooptimize.org")).toThrow();
  });

  it("flags and orders: ours first, then external, each by name", () => {
    const ms = flagMembers([aChatMember({ displayName: "Zed", external: true }), aChatMember({ displayName: "Bo" }), aChatMember({ displayName: "Al", external: true }), aChatMember({ displayName: "Cy" })], HOME_TENANT);
    expect(ms.map((m) => [m.displayName, m.external])).toEqual([["Bo", false], ["Cy", false], ["Al", true], ["Zed", true]]);
  });

  it("counts members and external ones in one line", () => {
    expect(memberLine([aChatMember(), aChatMember({ external: true }), aChatMember({ tenantId: null })], HOME_TENANT)).toBe("3 members · 2 external");
    expect(memberLine([aChatMember()], HOME_TENANT)).toBe("1 member");
    expect(memberLine([aChatMember()], HOME_TENANT, true)).toBe("1+ members");
  });
});

describe("the chat picker's list (T-2)", () => {
  const fabrikam = aChat({ topic: "Fabrikam Delivery Team (Cooptimize)", lastUpdated: "2026-10-01T10:00:00Z", lastRead: "2026-11-02T09:00:00Z" });
  const northwind = aChat({ topic: "Northwind Delivery Team (Cooptimize)", lastUpdated: "2026-10-30T10:00:00Z" });
  const untitled = aChat({ topic: null, members: [aChatMember({ displayName: "Ana Lopez" }), aChatMember({ displayName: "Ben Ito", external: true })], lastUpdated: "2026-09-01T00:00:00Z" });

  it.each([
    ["no search: all, most recently active first", "", [fabrikam, northwind, untitled]],
    ["a word of the topic, any case", "NORTHWIND", [northwind]],
    ["every word must match", "delivery fabrikam", [fabrikam]],
    ["a member's name finds an untitled chat", "ben", [untitled]],
    ["nothing matches", "contoso", []],
  ] as const)("%s", (_why, q, want) => {
    expect(filterChats([untitled, northwind, fabrikam], q).map((c) => c.id)).toEqual(want.map((c) => c.id));
  });

  it("leaves out a chat another client already has", () => {
    expect(filterChats([fabrikam, northwind], "", new Set([fabrikam.id])).map((c) => c.id)).toEqual([northwind.id]);
  });

  it("names an untitled chat by its members", () => {
    expect(chatName(untitled)).toBe("Ana, Ben");
    expect(chatName({ topic: null, members: [1, 2, 3, 4, 5].map((i) => aChatMember({ displayName: `P${i} X` })), moreMembers: false })).toBe("P1, P2, P3 +2");
    expect(chatName({ topic: "  ", members: [], moreMembers: false })).toBe("Group chat");
  });
});

describe("Open in Teams (T-2)", () => {
  it("uses Graph's webUrl when it is a Teams link, else the documented chat deep link", () => {
    expect(teamsLink({ chatId: "19:abc@thread.v2", webUrl: "https://teams.microsoft.com/l/chat/19%3Aabc%40thread.v2/0?tenantId=x" })).toBe("https://teams.microsoft.com/l/chat/19%3Aabc%40thread.v2/0?tenantId=x");
    expect(teamsLink({ chatId: "19:abc@thread.v2", webUrl: null })).toBe("https://teams.microsoft.com/l/chat/19%3Aabc%40thread.v2/conversations");
    expect(teamsLink({ chatId: "19:abc@thread.v2", webUrl: "javascript:alert(1)" })).toBe("https://teams.microsoft.com/l/chat/19%3Aabc%40thread.v2/conversations");
    expect(() => teamsLink({ chatId: "not a chat", webUrl: null })).toThrow();
  });
});

describe("T-2.1: the two kinds of client chat, by tenant", () => {
  const ours = aChatMember();
  const theirs = aChatMember({ external: true });
  const noTenant = aChatMember({ tenantId: null });

  it.each([
    ["only Cooptimize people", [ours, ours], "delivery"],
    ["one person from the client", [ours, theirs], "customer"],
    ["a guest with no tenant", [ours, noTenant], "customer"],
    ["nobody listed", [], "delivery"],
  ] as const)("suggests the kind from the members: %s", (_, members, kind) => {
    expect(suggestKind(members, HOME_TENANT)).toBe(kind);
  });

  it.each([
    ["delivery", [ours, theirs], "1 person from outside Cooptimize is in this internal chat"],
    ["delivery", [ours, theirs, noTenant], "2 people from outside Cooptimize are in this internal chat"],
    ["delivery", [ours], null],
    ["customer", [ours, theirs], null],
    ["customer", [ours], "No one from outside Cooptimize is in this chat"],
    ["customer", null, null],
  ] as const)("warns when the members don't fit: %s %#", (kind, members, warning) => {
    expect(kindWarning(kind, members, HOME_TENANT)).toBe(warning);
  });

  it.each([
    ["the stored kind wins", "customer", [ours], "customer"],
    ["no stored kind: an outsider suggests customer", null, [ours, theirs], "customer"],
    ["no stored kind: only ours suggests delivery", null, [ours], "delivery"],
    ["no stored kind and no members yet: delivery", null, null, "delivery"],
  ] as const)("a chat's kind: %s", (_why, kind, members, want) => {
    expect(kindOf({ kind, members: members as ChatMember[] | null }, HOME_TENANT)).toBe(want);
  });

  it.each([
    ["never read", null, true],
    ["read an hour ago", "2026-11-04T14:00:00Z", false],
    ["read 23 hours ago", "2026-11-03T16:00:00Z", false],
    ["read a day ago", "2026-11-03T15:00:00Z", true],
  ] as const)("members are read again once a day: %s", (_why, at, stale) => {
    expect(membersStale({ membersFetchedAt: at }, "2026-11-04T15:00:00Z")).toBe(stale);
  });

  it("the picker puts the chats that suggest the slot's kind first", () => {
    const internal = aChat({ topic: "Team", members: [ours], lastUpdated: "2026-10-01T00:00:00Z" });
    const withClient = aChat({ topic: "Collab", members: [ours, theirs], lastUpdated: "2026-10-30T00:00:00Z" });
    expect(filterChats([withClient, internal], "", new Set(), { kind: "delivery", homeTenant: HOME_TENANT }).map((c) => c.topic)).toEqual(["Team", "Collab"]);
    expect(filterChats([withClient, internal], "", new Set(), { kind: "customer", homeTenant: HOME_TENANT }).map((c) => c.topic)).toEqual(["Collab", "Team"]);
  });
});
