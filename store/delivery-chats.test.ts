// T-2 and T-2.1: client chats in the plan store, on SQLite and SQL Server: registered per person and client, at most one
// of each kind (Delivery team, Customer collaboration), one chat belongs to one client and one kind, and the cached
// members round-trip with the time they were read.
import { expect, it } from "vitest";
import { aChatMember } from "../test/builders/index.ts";
import { addUsers, forEachDriver } from "../test/db.ts";
import { planStoreOn } from "./plan-store.ts";

const now = () => Temporal.Instant.from("2026-11-04T15:00:00Z").toZonedDateTimeISO("America/New_York");
const Q = { chatId: "19:fabrikam@thread.v2", displayName: "Fabrikam Delivery Team (Cooptimize)", webUrl: "https://teams.microsoft.com/l/chat/19%3Afabrikam%40thread.v2/0?tenantId=t" };
const QC = { chatId: "19:fabrikam-collab@thread.v2", displayName: "Fabrikam Customer Collaboration", webUrl: null };
const Q3 = { chatId: "19:fabrikam-new@thread.v2", displayName: "Fabrikam team (new)", webUrl: null };
const N = { chatId: "19:northwind@thread.v2", displayName: "Northwind Delivery Team (Cooptimize)", webUrl: null };

await forEachDriver("client chats (T-2, T-2.1)", ({ open }) => {
  async function setup() {
    const db = (await open()).conn;
    await addUsers(db, "ana", "ben");
    return { db, ana: planStoreOn(db, { userId: "ana", now }), ben: planStoreOn(db, { userId: "ben", now }) };
  }

  it("round-trips both kinds and their members; reading again gives the same", async () => {
    const { ana } = await setup();
    await ana.setDeliveryChat("fabrikam", "delivery", Q);
    await ana.setDeliveryChat("fabrikam", "customer", QC);
    await ana.setDeliveryChat("northwind", "delivery", N);
    const members = [aChatMember({ displayName: "Ana Lopez" }), aChatMember({ displayName: "Client Person", external: true }), aChatMember({ tenantId: null, email: null })];
    await ana.setDeliveryChatMembers(QC.chatId, members, "2026-11-04T15:00:00Z", "Fabrikam Collaboration (renamed)");
    const got = await ana.deliveryChats();
    expect(got.map((c) => [c.clientKey, c.chatId, c.kind])).toEqual([
      ["fabrikam", Q.chatId, "delivery"],
      ["fabrikam", QC.chatId, "customer"],
      ["northwind", N.chatId, "delivery"],
    ]);
    const c = got.find((x) => x.chatId === QC.chatId)!;
    expect([c.displayName, c.members, c.membersFetchedAt]).toEqual(["Fabrikam Collaboration (renamed)", members, "2026-11-04T15:00:00Z"]);
    expect(got.find((x) => x.chatId === Q.chatId)!.webUrl).toBe(Q.webUrl);
    expect(got.find((x) => x.chatId === Q.chatId)!.members).toBeNull();
    expect(await ana.deliveryChats()).toEqual(got);
  });

  it("one of each kind: picking another chat for a kind replaces the one it had", async () => {
    const { ana } = await setup();
    await ana.setDeliveryChat("fabrikam", "delivery", Q);
    await ana.setDeliveryChat("fabrikam", "customer", QC);
    await ana.setDeliveryChat("fabrikam", "delivery", Q3);
    expect((await ana.deliveryChats()).map((c) => [c.chatId, c.kind])).toEqual([[QC.chatId, "customer"], [Q3.chatId, "delivery"]]);
  });

  it("one chat, one client and one kind; the same place again changes nothing", async () => {
    const { ana } = await setup();
    await ana.setDeliveryChat("fabrikam", "delivery", Q);
    await expect(ana.setDeliveryChat("northwind", "delivery", Q)).rejects.toThrow(/another client/);
    await expect(ana.setDeliveryChat("fabrikam", "customer", Q)).rejects.toThrow(/already this client's Delivery team chat/);
    await ana.setDeliveryChat("fabrikam", "delivery", Q);
    expect((await ana.deliveryChats()).length).toBe(1);
  });

  it("Clear forgets one chat and leaves the other kind", async () => {
    const { ana } = await setup();
    await ana.setDeliveryChat("fabrikam", "delivery", Q);
    await ana.setDeliveryChat("fabrikam", "customer", QC);
    await ana.removeDeliveryChat(Q.chatId);
    expect((await ana.deliveryChats()).map((c) => [c.chatId, c.kind])).toEqual([[QC.chatId, "customer"]]);
  });

  it("a row from before T-2.1 reads back without a kind", async () => {
    const { db, ana } = await setup();
    await ana.setDeliveryChat("fabrikam", "delivery", Q);
    await db.run("UPDATE delivery_chats SET chat_kind = NULL");
    expect((await ana.deliveryChats()).map((c) => c.kind)).toEqual([null]);
  });

  it("is per person: another person's registration of the same chat is theirs alone", async () => {
    const { ana, ben } = await setup();
    await ana.setDeliveryChat("fabrikam", "delivery", Q);
    await ben.setDeliveryChat("northwind", "customer", Q);
    expect((await ana.deliveryChats()).map((c) => [c.clientKey, c.kind])).toEqual([["fabrikam", "delivery"]]);
    expect((await ben.deliveryChats()).map((c) => [c.clientKey, c.kind])).toEqual([["northwind", "customer"]]);
    await ben.removeDeliveryChat(Q.chatId);
    expect((await ana.deliveryChats()).length).toBe(1);
  });

  it("refuses what isn't a chat id, a client or a kind", async () => {
    const { ana } = await setup();
    await expect(ana.setDeliveryChat("fabrikam", "delivery", { ...Q, chatId: "not-a-chat" })).rejects.toThrow();
    await expect(ana.setDeliveryChat("", "delivery", Q)).rejects.toThrow();
    await expect(ana.setDeliveryChat("fabrikam", "other" as never, Q)).rejects.toThrow(/kind/);
  });
});
