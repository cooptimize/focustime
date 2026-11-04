// T-2 and shared polling (D515): the client chat actions. chats.add checks the client and takes the chat's name and
// link from Teams, not the request; a chat that isn't one of my group chats is refused; Chat.Read must be allowed;
// members are read on add and on refresh; a refused permission says so with the scope's name and stops reading; a
// chat I left keeps its cached members with a note. A chat is registered once, for everyone: it shows to members who
// follow the client, and every add, label and removal is logged with who did it.
import { describe, expect, it } from "vitest";
import { aChat, aChatMember, HOME_TENANT } from "../test/builders/index.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { HttpError } from "../sources/calendar/http.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import type { ChatsClient } from "../sources/graph/chats.ts";
import type { ChatsData } from "../plan/chats.ts";
import type { MicrosoftAccount } from "./account.ts";
import { chatAction, type ChatContext } from "./chat-actions.ts";

const now = () => Temporal.Instant.from("2026-11-04T15:00:00Z").toZonedDateTimeISO("America/New_York");

const ANA = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const ana = () => aChatMember({ userId: ANA, displayName: "Ana" });

async function setup(chats: Partial<ChatsClient> = {}, o: { messages?: "granted" | "needs_consent"; admin?: boolean } = {}) {
  const db = sqliteDb().conn;
  await addUsers(db, ANA, BEN);
  const teams = createTeamsStore(db, () => now().toInstant());
  const mine = [aChat({ id: "19:northwind@thread.v2", topic: "Northwind Delivery Team (Cooptimize)", webUrl: "https://teams.microsoft.com/l/chat/x" }), aChat({ id: "19:other@thread.v2", topic: null })];
  const members = [ana(), aChatMember({ displayName: "Dana", external: true })];
  const client: ChatsClient = { groupChats: async () => mine, members: async () => members, ...chats };
  const ctx: ChatContext = {
    teams,
    me: async () => ANA,
    isAdmin: async () => o.admin ?? true,
    account: { chats: client, probe: async (kind: string) => ({ kind, state: o.messages ?? "granted", granted: [] }) } as unknown as MicrosoftAccount,
    homeTenant: async () => HOME_TENANT,
    clientKeys: async () => new Set(["northwind", "harbor"]),
    now: () => "2026-11-04T15:00:00Z",
  };
  return { ctx, teams, db };
}

const data = (r: Awaited<ReturnType<typeof chatAction>>) => {
  if (!r.ok) throw new Error(r.error);
  return r.data as ChatsData;
};

describe("client chat actions (T-2, shared polling)", () => {
  it("adds with the name from Teams, reads members, flags the external one", async () => {
    const { ctx } = await setup();
    const d = data(await chatAction(ctx, "chats.add", { clientKey: "northwind", kind: "customer", chatId: "19:northwind@thread.v2" }));
    expect(d.chats).toHaveLength(1);
    const c = d.chats[0]!;
    expect([c.displayName, c.kind, c.warning, c.link, c.memberCount, c.externalCount]).toEqual(["Northwind Delivery Team (Cooptimize)", "customer", null, "https://teams.microsoft.com/l/chat/x", 2, 1]);
    expect(c.members!.find((m) => m.displayName === "Dana")!.external).toBe(true);
  });

  it.each([
    [{ clientKey: "contoso", kind: "delivery", chatId: "19:northwind@thread.v2" }, 404, "That isn't one of your clients"],
    [{ clientKey: "northwind", kind: "delivery", chatId: "19:notmine@thread.v2" }, 404, "That isn't one of your Teams group chats"],
    [{ clientKey: "northwind", kind: "delivery", chatId: "not a chat id" }, 400, "chats.add takes"],
    [{ clientKey: "northwind", kind: "primary", chatId: "19:northwind@thread.v2" }, 400, "chats.add takes"],
    [{ clientKey: "northwind", kind: "delivery", chatId: "19:northwind@thread.v2", displayName: "spoofed" }, 400, "chats.add takes"],
  ])("refuses %j", async (input, status, error) => {
    const { ctx, teams } = await setup();
    const r = await chatAction(ctx, "chats.add", input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(status);
      expect(r.error).toContain(error);
    }
    expect(await teams.chats()).toEqual([]);
  });

  it("only an admin adds, relabels or removes chats (D522); anyone else sees them read-only", async () => {
    const { ctx, teams } = await setup({}, { admin: false });
    await teams.addChat({ chatId: "19:northwind@thread.v2", clientKey: "northwind", kind: "customer", displayName: "Northwind chat", webUrl: null, members: [ana()], by: BEN });
    for (const [action, input] of [
      ["chats.list", {}],
      ["chats.add", { clientKey: "harbor", chatId: "19:other@thread.v2" }],
      ["chats.kind", { chatId: "19:northwind@thread.v2", kind: "delivery" }],
      ["chats.remove", { chatId: "19:northwind@thread.v2" }],
    ] as const) {
      const r = await chatAction(ctx, action, input);
      expect(r.ok ? null : [r.status, r.error]).toEqual([403, "Only a FocusTime admin adds or changes client chats"]);
    }
    const d = data(await chatAction(ctx, "chats.registered", {}));
    expect([d.admin, d.chats.map((c) => [c.chatId, c.kind])]).toEqual([false, [["19:northwind@thread.v2", "customer"]]]);
    expect((await teams.changes()).map((c) => c.change)).toEqual(["added"]);
  });

  it("a chat already on another client is refused", async () => {
    const { ctx } = await setup();
    data(await chatAction(ctx, "chats.add", { clientKey: "northwind", kind: "customer", chatId: "19:northwind@thread.v2" }));
    const r = await chatAction(ctx, "chats.add", { clientKey: "harbor", kind: "customer", chatId: "19:northwind@thread.v2" });
    expect(r.ok ? null : r.status).toBe(409);
  });

  it("the picker says which of my chats are registered, and nothing about chats I'm not in", async () => {
    const { ctx, teams } = await setup();
    await teams.addChat({ chatId: "19:secret@thread.v2", clientKey: "harbor", kind: "delivery", displayName: "Not mine", webUrl: null, members: [aChatMember({ userId: BEN, displayName: "Ben" })], by: BEN });
    data(await chatAction(ctx, "chats.add", { clientKey: "northwind", chatId: "19:northwind@thread.v2" }));
    const r = await chatAction(ctx, "chats.list", {});
    expect(r.ok && (r.data as { taken: Record<string, string> }).taken).toEqual({ "19:northwind@thread.v2": "northwind" });
  });

  it("Teams' member list is the gate: a chat whose members don't include me can't be added by me", async () => {
    const { ctx, teams } = await setup({ members: async () => [aChatMember({ userId: BEN, displayName: "Ben" })] });
    const r = await chatAction(ctx, "chats.add", { clientKey: "northwind", chatId: "19:northwind@thread.v2" });
    expect(r.ok ? null : r.status).toBe(409);
    expect(await teams.chats()).toEqual([]);
  });

  it("refresh: a refused permission names Chat.ReadBasic and keeps the cached members; a chat I left says so", async () => {
    let fail: Error | null = null;
    const { ctx } = await setup({ members: async () => { if (fail) throw fail; return [ana()]; } });
    data(await chatAction(ctx, "chats.add", { clientKey: "northwind", kind: "customer", chatId: "19:northwind@thread.v2" }));
    fail = new AuthFailure("consent", "x");
    const d = data(await chatAction(ctx, "chats.refresh", {}));
    expect([d.available, d.reason]).toEqual([false, "consent"]);
    expect(d.chats[0]!.error).toContain("Chat.ReadBasic");
    expect(d.chats[0]!.memberCount).toBe(1);
    fail = new HttpError(404);
    expect(data(await chatAction(ctx, "chats.refresh", { clientKey: "northwind" })).chats[0]!.error).toMatch(/aren't in this chat/);
  });

  it("the internal chat with someone from the client says so", async () => {
    const { ctx } = await setup();
    const d = data(await chatAction(ctx, "chats.add", { clientKey: "northwind", kind: "delivery", chatId: "19:northwind@thread.v2" }));
    expect([d.chats[0]!.kind, d.chats[0]!.warning]).toEqual(["delivery", "1 person from outside Cooptimize is in this internal chat"]);
  });

  it("a client takes several chats; with no kind given, the members suggest it; the label can change", async () => {
    const { ctx } = await setup({ groupChats: async () => [aChat({ id: "19:a@thread.v2", topic: "Team", members: [ana()] }), aChat({ id: "19:b@thread.v2", topic: "Collab", members: [ana(), aChatMember({ external: true })] })], members: async (id) => (id === "19:a@thread.v2" ? [ana()] : [ana(), aChatMember({ external: true })]) });
    data(await chatAction(ctx, "chats.add", { clientKey: "northwind", chatId: "19:a@thread.v2" }));
    const d = data(await chatAction(ctx, "chats.add", { clientKey: "northwind", chatId: "19:b@thread.v2" }));
    expect(d.chats.map((c) => [c.chatId, c.kind])).toEqual([["19:a@thread.v2", "delivery"], ["19:b@thread.v2", "customer"]]);
    const k = data(await chatAction(ctx, "chats.kind", { chatId: "19:a@thread.v2", kind: "customer" }));
    expect(k.chats.map((c) => c.kind)).toEqual(["customer", "customer"]);
    expect((await chatAction(ctx, "chats.kind", { chatId: "19:a@thread.v2", kind: "primary" })).ok).toBe(false);
  });

  it("opening Clients reads members once a day; Refresh reads them now", async () => {
    let reads = 0;
    let nowIso = "2026-11-04T15:00:00Z";
    const { ctx } = await setup({ members: async () => (reads++, [ana()]) });
    const c = { ...ctx, now: () => nowIso };
    data(await chatAction(c, "chats.add", { clientKey: "northwind", chatId: "19:northwind@thread.v2" }));
    expect(reads).toBe(1);
    nowIso = "2026-11-05T09:00:00Z";
    data(await chatAction(c, "chats.registered", { refresh: true }));
    expect(reads).toBe(1);
    data(await chatAction(c, "chats.refresh", {}));
    expect(reads).toBe(2);
    nowIso = "2026-11-06T09:00:01Z";
    data(await chatAction(c, "chats.registered", { refresh: true }));
    expect(reads).toBe(3);
  });

  it("a guest in the chat counts as external", async () => {
    const { ctx } = await setup({ members: async () => [ana(), aChatMember({ guest: true })] });
    const d = data(await chatAction(ctx, "chats.add", { clientKey: "northwind", chatId: "19:northwind@thread.v2" }));
    expect([d.chats[0]!.externalCount, d.chats[0]!.members!.filter((m) => m.external).length]).toEqual([1, 1]);
  });

  it("adding needs Chat.Read (the job reads the chat with my sign-in): not allowed yet, nothing is registered", async () => {
    const { ctx, teams } = await setup({}, { messages: "needs_consent" });
    const r = await chatAction(ctx, "chats.add", { clientKey: "northwind", chatId: "19:northwind@thread.v2" });
    expect(r.ok ? null : [r.status, (r as { code?: string }).code]).toEqual([409, "consent"]);
    expect(await teams.chats()).toEqual([]);
  });

  it("registered once for everyone: a member who follows the client sees it; not a member, or not following, doesn't", async () => {
    const { ctx, teams } = await setup({ members: async () => [ana(), aChatMember({ userId: BEN, displayName: "Ben" })] });
    data(await chatAction(ctx, "chats.add", { clientKey: "northwind", chatId: "19:northwind@thread.v2" }));
    const ben = { ...ctx, me: async () => BEN };
    expect(data(await chatAction(ben, "chats.registered", {})).chats.map((c) => [c.chatId, c.registeredBy])).toEqual([["19:northwind@thread.v2", "Ana"]]);
    expect(data(await chatAction({ ...ben, clientKeys: async () => new Set(["harbor"]) }, "chats.registered", {})).chats).toEqual([]);
    expect(data(await chatAction({ ...ctx, me: async () => "00000000-0000-4000-8000-0000000000c3" }, "chats.registered", {})).chats).toEqual([]);
    // Ben relabels it and removes it; each change is logged with who did it.
    data(await chatAction(ben, "chats.kind", { chatId: "19:northwind@thread.v2", kind: "delivery" }));
    data(await chatAction(ben, "chats.remove", { chatId: "19:northwind@thread.v2" }));
    expect((await teams.changes()).map((c) => [c.byUser, c.change])).toEqual([[ANA, "added"], [BEN, "kind"], [BEN, "removed"]]);
  });

  it("someone who doesn't see a chat can't relabel or remove it", async () => {
    const { ctx } = await setup();
    data(await chatAction(ctx, "chats.add", { clientKey: "northwind", chatId: "19:northwind@thread.v2" }));
    const cy = { ...ctx, me: async () => "00000000-0000-4000-8000-0000000000c3" };
    expect((await chatAction(cy, "chats.remove", { chatId: "19:northwind@thread.v2" })).ok).toBe(false);
    expect((await chatAction(cy, "chats.kind", { chatId: "19:northwind@thread.v2", kind: "delivery" })).ok).toBe(false);
  });

  it("the card says how it's read: polling via another follower, or needs reconnecting with the last fetch", async () => {
    const { ctx, teams } = await setup({ members: async () => [ana(), aChatMember({ userId: BEN, displayName: "Ben" })] });
    data(await chatAction(ctx, "chats.add", { clientKey: "northwind", chatId: "19:northwind@thread.v2" }));
    await teams.recordPoll("19:northwind@thread.v2", { polledAt: "2026-11-04T15:05:00Z", fetchedAt: "2026-11-04T15:05:00Z", retryAt: null, failures: 0, state: "via", note: null, tokenUser: BEN });
    expect(data(await chatAction(ctx, "chats.registered", {})).chats[0]!.poll).toMatchObject({ state: "via", via: "Ben", fetchedAt: "2026-11-04T15:05:00Z" });
    await teams.recordPoll("19:northwind@thread.v2", { polledAt: "2026-11-04T15:10:00Z", retryAt: null, failures: 1, state: "reconnect", note: null, tokenUser: null });
    expect(data(await chatAction(ctx, "chats.registered", {})).chats[0]!.poll).toMatchObject({ state: "reconnect", via: null, fetchedAt: "2026-11-04T15:05:00Z" });
  });

  it("signed out: the picker says so and nothing is read", async () => {
    const { ctx } = await setup();
    const r = await chatAction({ ...ctx, account: null }, "chats.list", {});
    expect(r.ok && r.data).toMatchObject({ available: false, reason: "signed_out", chats: [] });
  });
});
