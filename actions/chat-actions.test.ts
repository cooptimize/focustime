// T-2: the delivery chat actions. chats.add checks the client and takes the chat's name and link from Teams, not the
// request; a chat that isn't one of my group chats is refused; members are read on add and on refresh; a refused
// permission says so with the scope's name and stops reading; a chat I left keeps its cached members with a note.
import { describe, expect, it } from "vitest";
import { aChat, aChatMember, HOME_TENANT } from "../test/builders/index.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { HttpError } from "../sources/calendar/http.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { planStoreOn } from "../store/plan-store.ts";
import type { ChatsClient } from "../sources/graph/chats.ts";
import type { ChatsData } from "../plan/chats.ts";
import type { MicrosoftAccount } from "./account.ts";
import { chatAction, type ChatContext } from "./chat-actions.ts";

const now = () => Temporal.Instant.from("2026-11-04T15:00:00Z").toZonedDateTimeISO("America/New_York");

async function setup(chats: Partial<ChatsClient> = {}) {
  const db = sqliteDb().conn;
  await addUsers(db, "ana");
  const plan = planStoreOn(db, { userId: "ana", now });
  const mine = [aChat({ id: "19:northwind@thread.v2", topic: "Northwind Delivery Team (Cooptimize)", webUrl: "https://teams.microsoft.com/l/chat/x" }), aChat({ id: "19:other@thread.v2", topic: null })];
  const members = [aChatMember({ displayName: "Ana" }), aChatMember({ displayName: "Dana", external: true })];
  const client: ChatsClient = { groupChats: async () => mine, members: async () => members, ...chats };
  const ctx: ChatContext = {
    plan,
    account: { chats: client } as unknown as MicrosoftAccount,
    homeTenant: async () => HOME_TENANT,
    clientKeys: async () => new Set(["northwind", "harbor"]),
    now: () => "2026-11-04T15:00:00Z",
  };
  return { ctx, plan, db };
}

const data = (r: Awaited<ReturnType<typeof chatAction>>) => {
  if (!r.ok) throw new Error(r.error);
  return r.data as ChatsData;
};

describe("delivery chat actions (T-2)", () => {
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
    [{ clientKey: "northwind", chatId: "19:northwind@thread.v2" }, 400, "chats.add takes"],
    [{ clientKey: "northwind", kind: "primary", chatId: "19:northwind@thread.v2" }, 400, "chats.add takes"],
    [{ clientKey: "northwind", kind: "delivery", chatId: "19:northwind@thread.v2", displayName: "spoofed" }, 400, "chats.add takes"],
  ])("refuses %j", async (input, status, error) => {
    const { ctx, plan } = await setup();
    const r = await chatAction(ctx, "chats.add", input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(status);
      expect(r.error).toContain(error);
    }
    expect(await plan.deliveryChats()).toEqual([]);
  });

  it("a chat already on another client is refused", async () => {
    const { ctx } = await setup();
    data(await chatAction(ctx, "chats.add", { clientKey: "northwind", kind: "customer", chatId: "19:northwind@thread.v2" }));
    const r = await chatAction(ctx, "chats.add", { clientKey: "harbor", kind: "customer", chatId: "19:northwind@thread.v2" });
    expect(r.ok ? null : r.status).toBe(409);
  });

  it("refresh: a refused permission names Chat.ReadBasic and keeps the cached members; a chat I left says so", async () => {
    let fail: Error | null = null;
    const { ctx } = await setup({ members: async () => { if (fail) throw fail; return [aChatMember()]; } });
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

  it("a row from before T-2.1 takes the kind its members suggest, and makes way when that slot is set", async () => {
    const { ctx, db } = await setup();
    data(await chatAction(ctx, "chats.add", { clientKey: "northwind", kind: "delivery", chatId: "19:northwind@thread.v2" }));
    await db.run("UPDATE delivery_chats SET chat_kind = NULL");
    // One external member: it shows as the customer chat.
    expect(data(await chatAction(ctx, "chats.registered", {})).chats.map((c) => [c.chatId, c.kind])).toEqual([["19:northwind@thread.v2", "customer"]]);
    const after = data(await chatAction(ctx, "chats.add", { clientKey: "northwind", kind: "customer", chatId: "19:other@thread.v2" }));
    expect(after.chats.map((c) => [c.chatId, c.kind])).toEqual([["19:other@thread.v2", "customer"]]);
  });

  it("signed out: the picker says so and nothing is read", async () => {
    const { ctx } = await setup();
    const r = await chatAction({ ...ctx, account: null }, "chats.list", {});
    expect(r.ok && r.data).toMatchObject({ available: false, reason: "signed_out", chats: [] });
  });
});
