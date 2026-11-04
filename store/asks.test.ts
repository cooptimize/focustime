// AP-1: Asks in the plan store, on SQLite and SQL Server: Read for asks on and off (from now), the read state, only
// the listed message fields, an ask once per message, resolutions and Undo, the 14-day cleanup that keeps asks, a
// client's purge, and one person's rows never another's.
import { expect, it } from "vitest";
import { aMessage } from "../test/builders/index.ts";
import { addUsers, forEachDriver } from "../test/db.ts";
import type { StoredMessage } from "../plan/asks.ts";
import { planStoreOn } from "./plan-store.ts";

const now = () => Temporal.Instant.from("2026-11-04T15:00:00Z").toZonedDateTimeISO("America/New_York");
const CHAT = { chatId: "19:fabrikam@thread.v2", displayName: "Fabrikam team", webUrl: null };
const stored = (o: Partial<StoredMessage>): StoredMessage => {
  const { mentionedUserIds: _m, ...m } = aMessage(o);
  return m;
};

await forEachDriver("asks (AP-1)", ({ open }) => {
  async function setup() {
    const db = (await open()).conn;
    await addUsers(db, "ana", "ben");
    const ana = planStoreOn(db, { userId: "ana", now });
    const ben = planStoreOn(db, { userId: "ben", now });
    await ana.addDeliveryChat("fabrikam", "customer", CHAT);
    return { db, ana, ben };
  }

  it("Read for asks: off by default; on starts from now; reads are recorded; off keeps the place", async () => {
    const { ana } = await setup();
    expect((await ana.deliveryChats())[0]!.asks).toMatchObject({ on: false, since: null });
    await ana.setAsksOn(CHAT.chatId, true, "2026-11-04T15:00:00Z");
    expect((await ana.deliveryChats())[0]!.asks).toEqual({ on: true, since: "2026-11-04T15:00:00Z", seenAt: "2026-11-04T15:00:00Z", polledAt: null, retryAt: null, failures: 0, status: null });
    await ana.recordAsksRead(CHAT.chatId, { polledAt: "2026-11-04T15:05:00Z", seenAt: "2026-11-04T15:04:00Z", retryAt: "2026-11-04T15:06:00Z", failures: 1, status: "Teams is busy" });
    expect((await ana.deliveryChats())[0]!.asks).toMatchObject({ seenAt: "2026-11-04T15:04:00Z", polledAt: "2026-11-04T15:05:00Z", retryAt: "2026-11-04T15:06:00Z", failures: 1, status: "Teams is busy" });
    await ana.setAsksOn(CHAT.chatId, false, "2026-11-04T16:00:00Z");
    expect((await ana.deliveryChats())[0]!.asks).toMatchObject({ on: false, status: null, failures: 0 });
    await expect(ana.setAsksOn("19:other@thread.v2", true, "2026-11-04T16:00:00Z")).rejects.toThrow(/isn't registered/);
  });

  it("keeps only the listed fields; a message is stored once; context is the earlier ones, oldest first", async () => {
    const { db, ana } = await setup();
    const ms = [1, 2, 3].map((i) => stored({ chatId: CHAT.chatId, messageId: `17000000000${i}`, createdAt: `2026-11-04T15:0${i}:00Z`, text: `message ${i}`, hasImage: i === 3 }));
    expect(await ana.addChatMessages(ms)).toBe(3);
    expect(await ana.addChatMessages(ms)).toBe(0);
    const cols = Object.keys((await db.get("SELECT * FROM chat_messages")) as object).sort();
    expect(cols).toEqual(["author_id", "author_tenant", "body_text", "chat_id", "client_key", "created_at", "has_file", "has_image", "message_id", "reply_to_id", "user_id"]);
    expect(await ana.chatMessage(CHAT.chatId, "170000000003")).toEqual(ms[2]);
    expect((await ana.messagesBefore(CHAT.chatId, "2026-11-04T15:03:00Z", 5)).map((m) => m.text)).toEqual(["message 1", "message 2"]);
  });

  it("an ask once per message; resolving, a second resolution refused, Undo opens it again", async () => {
    const { ana } = await setup();
    const m = stored({ chatId: CHAT.chatId, messageId: "170000000001" });
    await ana.addChatMessages([m]);
    expect(await ana.addAsk({ chatId: m.chatId, messageId: m.messageId, clientKey: "fabrikam", rule: "phrase", ruleDetail: "please", at: m.createdAt })).toBe(true);
    expect(await ana.addAsk({ chatId: m.chatId, messageId: m.messageId, clientKey: "fabrikam", rule: "phrase", ruleDetail: "please", at: m.createdAt })).toBe(false);
    const created = await ana.resolveAsk(m.chatId, m.messageId, { status: "created", itemId: 42, itemUrl: "https://dev.azure.com/x/_workitems/edit/42", itemTitle: "Fix it", writeId: 7 });
    expect([created.status, created.itemId, created.writeId]).toEqual(["created", 42, 7]);
    await expect(ana.resolveAsk(m.chatId, m.messageId, { status: "handled" })).rejects.toThrow(/Already in DevOps as #42/);
    expect((await ana.resolveAsk(m.chatId, m.messageId, { status: "open" })).status).toBe("open");
    expect((await ana.resolveAsk(m.chatId, m.messageId, { status: "handled", note: "answered on a call" })).note).toBe("answered on a call");
  });

  it("the daily cleanup deletes unmatched messages after 14 days and keeps the ones that became asks", async () => {
    const { ana } = await setup();
    const old = stored({ chatId: CHAT.chatId, messageId: "170000000001", createdAt: "2026-10-20T15:00:00Z" });
    const asked = stored({ chatId: CHAT.chatId, messageId: "170000000002", createdAt: "2026-10-20T16:00:00Z" });
    const recent = stored({ chatId: CHAT.chatId, messageId: "170000000003", createdAt: "2026-11-01T15:00:00Z" });
    await ana.addChatMessages([old, asked, recent]);
    await ana.addAsk({ chatId: CHAT.chatId, messageId: asked.messageId, clientKey: "fabrikam", rule: "question", ruleDetail: null, at: asked.createdAt });
    await ana.resolveAsk(CHAT.chatId, asked.messageId, { status: "dismissed" });
    expect(await ana.purgeChatText({ olderThan: "2026-10-21T15:00:00Z" })).toBe(1);
    expect(await ana.chatMessage(CHAT.chatId, old.messageId)).toBeNull();
    expect(await ana.chatMessage(CHAT.chatId, asked.messageId)).not.toBeNull();
    expect(await ana.chatMessage(CHAT.chatId, recent.messageId)).not.toBeNull();
  });

  it("purging a client removes its text and asks; removing the chat does too", async () => {
    const { ana } = await setup();
    await ana.addChatMessages([stored({ chatId: CHAT.chatId, messageId: "170000000001" })]);
    await ana.addAsk({ chatId: CHAT.chatId, messageId: "170000000001", clientKey: "fabrikam", rule: "question", ruleDetail: null, at: "2026-11-04T15:00:00Z" });
    expect(await ana.purgeChatText({ clientKey: "fabrikam" })).toBe(1);
    expect(await ana.asks()).toEqual([]);
    await ana.addChatMessages([stored({ chatId: CHAT.chatId, messageId: "170000000002" })]);
    await ana.removeDeliveryChat(CHAT.chatId);
    expect(await ana.chatMessage(CHAT.chatId, "170000000002")).toBeNull();
  });

  it("is per person: another person's messages and asks are theirs alone", async () => {
    const { ana, ben } = await setup();
    await ben.addDeliveryChat("fabrikam", "customer", CHAT);
    await ana.addChatMessages([stored({ chatId: CHAT.chatId, messageId: "170000000001", text: "ana's" })]);
    await ana.addAsk({ chatId: CHAT.chatId, messageId: "170000000001", clientKey: "fabrikam", rule: "question", ruleDetail: null, at: "2026-11-04T15:00:00Z" });
    expect(await ben.chatMessage(CHAT.chatId, "170000000001")).toBeNull();
    expect(await ben.asks()).toEqual([]);
    expect(await ben.addChatMessages([stored({ chatId: CHAT.chatId, messageId: "170000000001", text: "ben's" })])).toBe(1);
    expect((await ana.chatMessage(CHAT.chatId, "170000000001"))!.text).toBe("ana's");
  });
});
