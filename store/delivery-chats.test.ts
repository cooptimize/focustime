// T-2: delivery chats in the plan store, on SQLite and SQL Server: registered per person and client, the first is the
// primary, one chat belongs to one client, and the cached members round-trip with the time they were read.
import { expect, it } from "vitest";
import { aChatMember } from "../test/builders/index.ts";
import { addUsers, forEachDriver } from "../test/db.ts";
import { planStoreOn } from "./plan-store.ts";

const now = () => Temporal.Instant.from("2026-11-04T15:00:00Z").toZonedDateTimeISO("America/New_York");
const Q = { chatId: "19:fabrikam@thread.v2", displayName: "Fabrikam Delivery Team (Cooptimize)", webUrl: "https://teams.microsoft.com/l/chat/19%3Afabrikam%40thread.v2/0?tenantId=t" };
const Q2 = { chatId: "19:fabrikam-leads@thread.v2", displayName: "Fabrikam leads", webUrl: null };
const N = { chatId: "19:northwind@thread.v2", displayName: "Northwind Delivery Team (Cooptimize)", webUrl: null };

await forEachDriver("delivery chats (T-2)", ({ open }) => {
  async function setup() {
    const db = (await open()).conn;
    await addUsers(db, "ana", "ben");
    return { ana: planStoreOn(db, { userId: "ana", now }), ben: planStoreOn(db, { userId: "ben", now }) };
  }

  it("round-trips chats and their members; the first is the primary; reading again gives the same", async () => {
    const { ana } = await setup();
    await ana.addDeliveryChat("fabrikam", Q);
    await ana.addDeliveryChat("fabrikam", Q2);
    await ana.addDeliveryChat("northwind", N);
    const members = [aChatMember({ displayName: "Ana Lopez" }), aChatMember({ displayName: "Client Person", external: true }), aChatMember({ tenantId: null, email: null })];
    await ana.setDeliveryChatMembers(Q.chatId, members, "2026-11-04T15:00:00Z", "Fabrikam Delivery (renamed)");
    const got = await ana.deliveryChats();
    expect(got.map((c) => [c.clientKey, c.chatId, c.primary])).toEqual([
      ["fabrikam", Q.chatId, true],
      ["fabrikam", Q2.chatId, false],
      ["northwind", N.chatId, true],
    ]);
    const q = got.find((c) => c.chatId === Q.chatId)!;
    expect(q.displayName).toBe("Fabrikam Delivery (renamed)");
    expect(q.webUrl).toBe(Q.webUrl);
    expect(q.members).toEqual(members);
    expect(q.membersFetchedAt).toBe("2026-11-04T15:00:00Z");
    expect(got.find((c) => c.chatId === Q2.chatId)!.members).toBeNull();
    expect(await ana.deliveryChats()).toEqual(got);
  });

  it("one chat, one client; the same client again changes nothing", async () => {
    const { ana } = await setup();
    await ana.addDeliveryChat("fabrikam", Q);
    await expect(ana.addDeliveryChat("northwind", Q)).rejects.toThrow(/another client/);
    await ana.addDeliveryChat("fabrikam", Q);
    expect((await ana.deliveryChats()).length).toBe(1);
  });

  it("Clear: removing the primary makes the next one primary; Make primary moves it", async () => {
    const { ana } = await setup();
    await ana.addDeliveryChat("fabrikam", Q);
    await ana.addDeliveryChat("fabrikam", Q2);
    await ana.setPrimaryDeliveryChat(Q2.chatId);
    expect((await ana.deliveryChats()).filter((c) => c.primary).map((c) => c.chatId)).toEqual([Q2.chatId]);
    await ana.removeDeliveryChat(Q2.chatId);
    expect((await ana.deliveryChats()).map((c) => [c.chatId, c.primary])).toEqual([[Q.chatId, true]]);
    await ana.removeDeliveryChat(Q.chatId);
    expect(await ana.deliveryChats()).toEqual([]);
  });

  it("is per person: another person's registration of the same chat is theirs alone", async () => {
    const { ana, ben } = await setup();
    await ana.addDeliveryChat("fabrikam", Q);
    await ben.addDeliveryChat("northwind", Q);
    expect((await ana.deliveryChats()).map((c) => c.clientKey)).toEqual(["fabrikam"]);
    expect((await ben.deliveryChats()).map((c) => c.clientKey)).toEqual(["northwind"]);
    await ben.removeDeliveryChat(Q.chatId);
    expect((await ana.deliveryChats()).length).toBe(1);
  });

  it("refuses what isn't a chat id or a client", async () => {
    const { ana } = await setup();
    await expect(ana.addDeliveryChat("fabrikam", { ...Q, chatId: "not-a-chat" })).rejects.toThrow();
    await expect(ana.addDeliveryChat("", Q)).rejects.toThrow();
    await expect(ana.setPrimaryDeliveryChat(Q.chatId)).rejects.toThrow(/isn't registered/);
  });
});
