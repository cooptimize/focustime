// Shared polling (D514 to D518): the app tables for client chats, Teams messages and Requests, on both drivers. One row
// per message whoever reads it; an edit (a newer lastModifiedDateTime) updates the stored body; Request state is shared;
// the migration collapses per-user rows (the latest action wins); unmatched messages expire after 14 days, Requests'
// and promises' messages stay.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { ChatMember } from "../plan/chats.ts";
import type { TeamsMessage } from "../plan/requests.ts";
import { addUsers, emptySqlServer, forEachDriver, onSqlServer } from "../test/db.ts";
import { NAMED_MIGRATIONS } from "./migrations/index.ts";
import { openPlanDb } from "./plan-store.ts";
import { migrateSqlServer } from "./sql/migrate.ts";
import { sqliteConn } from "./sql/sqlite.ts";
import type { Conn } from "./sql/conn.ts";
import { createTeamsStore } from "./teams-store.ts";

const NOW = "2026-11-20T15:00:00Z";
const CHAT = "19:fabrikam@thread.v2";
const CHAT2 = "19:fabrikam-team@thread.v2";
const ANA = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const CY = "00000000-0000-4000-8000-0000000000c3";
const members: ChatMember[] = [{ userId: ANA, displayName: "Ana", email: null, tenantId: "home" }, { userId: BEN, displayName: "Ben", email: null, tenantId: "home" }];
let n = 0;
const msg = (o: Partial<TeamsMessage> = {}): TeamsMessage => ({
  chatId: CHAT, messageId: String(1_730_000_000_000 + ++n), clientKey: "fabrikam", senderId: "c-dana", senderName: "Dana Client", senderTenant: "client",
  createdAt: "2026-11-20T14:00:00Z", modifiedAt: "2026-11-20T14:00:00Z", html: "<p>Can you check the export?</p>", text: "Can you check the export?",
  hasImage: false, hasFile: false, replyToId: null, mentions: [{ id: ANA, name: "Ana" }], fetchedAt: NOW, ...o,
});

await forEachDriver("the shared Teams store", ({ open }) => {
  const store = async () => {
    const db = await open();
    await addUsers(db.conn, ANA, BEN, CY);
    const teams = createTeamsStore(db.conn, () => Temporal.Instant.from(NOW));
    await teams.addChat({ chatId: CHAT, clientKey: "fabrikam", kind: "customer", displayName: "Fabrikam chat", webUrl: null, members, by: ANA });
    return { db, teams };
  };

  it("a registered chat: who registered it, reading from then on, and the change logged", async () => {
    const { teams } = await store();
    const c = await teams.chat(CHAT);
    expect(c).toMatchObject({ clientKey: "fabrikam", kind: "customer", registeredBy: ANA, readSince: NOW, members, pollState: null });
    expect(await teams.changes()).toEqual([expect.objectContaining({ byUser: ANA, clientKey: "fabrikam", chatId: CHAT, change: "added" })]);
    await expect(teams.addChat({ chatId: CHAT, clientKey: "northwind", kind: "delivery", displayName: "x", webUrl: null, members, by: BEN })).rejects.toThrow(/already registered for another client/);
  });

  it("each message is stored once, whoever reads it; the same message again is neither added nor changed", async () => {
    const { teams } = await store();
    const m = msg();
    expect((await teams.saveMessages([m])).added.map((x) => x.messageId)).toEqual([m.messageId]);
    expect(await teams.saveMessages([m])).toEqual({ added: [], updated: 0 });
    expect(await teams.message(CHAT, m.messageId)).toMatchObject({ text: "Can you check the export?", html: "<p>Can you check the export?</p>", senderName: "Dana Client", mentions: [{ id: ANA, name: "Ana" }] });
  });

  it("an edit (newer lastModifiedDateTime) updates the stored body and text, and isn't a new message", async () => {
    const { teams } = await store();
    const m = msg();
    await teams.saveMessages([m]);
    const edited = { ...m, modifiedAt: "2026-11-20T14:30:00Z", html: "<p>Can you check the March export?</p>", text: "Can you check the March export?" };
    expect(await teams.saveMessages([edited])).toEqual({ added: [], updated: 1 });
    expect(await teams.message(CHAT, m.messageId)).toMatchObject({ text: "Can you check the March export?", html: "<p>Can you check the March export?</p>", modifiedAt: "2026-11-20T14:30:00Z" });
    // An older copy never overwrites a newer one.
    expect(await teams.saveMessages([m])).toEqual({ added: [], updated: 0 });
  });

  it("CV-4: an image row keeps only its type, size and description (never bytes), follows the body, and only a member of the chat reaches it", async () => {
    const { teams, db } = await store();
    const img = (h: string) => `<img src="https://graph.microsoft.com/v1.0/chats/${CHAT}/messages/1/hostedContents/${h}/$value">`;
    const m = msg({ html: `<p>Look</p>${img("aWQ9MQ==")}${img("aWQ9Mg==")}`, hasImage: true });
    await teams.saveMessages([m]);
    const [a, b] = await teams.images(CHAT, [m.messageId]);
    expect([a!.state, b!.state, a!.position, b!.position]).toEqual(["pending", "pending", 0, 1]);
    expect(await teams.imageSource(a!.id)).toEqual({ chatId: CHAT, messageId: m.messageId, hostedId: "aWQ9MQ==" });
    await teams.setImage(a!.id, { state: "ok", contentType: "image/png", byteSize: 70_000 });
    await teams.setImage(b!.id, { state: "skipped", reason: "not a PNG, JPEG or GIF" });
    await teams.setImageDescription(a!.id, `  Refresh failed:\n timeout on the sales model ${"x".repeat(200)}`);
    expect(await teams.image(a!.id)).toMatchObject({ state: "ok", contentType: "image/png", byteSize: 70_000 });
    expect((await teams.image(a!.id))!.description).toHaveLength(120);
    expect((await teams.image(a!.id))!.description!.startsWith("Refresh failed: timeout on the sales model")).toBe(true);
    expect(await db.conn.all("SELECT id FROM teams_message_images WHERE bytes IS NOT NULL", [])).toEqual([]);
    // Only a member of the chat sees it through their view.
    expect(await teams.viewer(ANA).image(a!.id)).toMatchObject({ id: a!.id, byteSize: 70_000 });
    expect(await teams.viewer(CY).image(a!.id)).toBeNull();
    expect(await teams.viewer(CY).images(CHAT, [m.messageId])).toEqual([]);
    // The second image edited out: its row goes; the message expiring takes the rest.
    await teams.saveMessages([{ ...m, modifiedAt: "2026-11-20T15:00:00Z", html: `<p>Look</p>${img("aWQ9MQ==")}` }]);
    expect((await teams.images(CHAT, [m.messageId])).map((x) => x.id)).toEqual([a!.id]);
    await teams.expire("2026-12-31T00:00:00Z");
    expect(await teams.image(a!.id)).toBeNull();
  });

  it("a Request's state is shared: one person resolves it, everyone sees it", async () => {
    const { teams } = await store();
    const m = msg();
    await teams.saveMessages([m]);
    expect(await teams.addRequest({ chatId: CHAT, messageId: m.messageId, clientKey: "fabrikam", rule: "question", ruleDetail: null, at: m.createdAt })).toBe(true);
    expect(await teams.addRequest({ chatId: CHAT, messageId: m.messageId, clientKey: "fabrikam", rule: "question", ruleDetail: null, at: m.createdAt })).toBe(false);
    await teams.resolveRequest(CHAT, m.messageId, { status: "handled", note: "Answered in Teams", by: BEN });
    expect(await teams.request(CHAT, m.messageId)).toMatchObject({ status: "handled", note: "Answered in Teams", resolvedBy: BEN, resolvedAt: NOW });
    expect((await teams.requests([CHAT])).map((r) => r.status)).toEqual(["handled"]);
  });

  it("expiry: an unmatched message older than 14 days goes; one that became a Request stays", async () => {
    const { teams } = await store();
    const old = msg({ createdAt: "2026-11-01T10:00:00Z", modifiedAt: "2026-11-01T10:00:00Z" });
    const asked = msg({ createdAt: "2026-11-01T11:00:00Z", modifiedAt: "2026-11-01T11:00:00Z" });
    const recent = msg({ createdAt: "2026-11-15T10:00:00Z", modifiedAt: "2026-11-15T10:00:00Z" });
    await teams.saveMessages([old, asked, recent]);
    await teams.addRequest({ chatId: CHAT, messageId: asked.messageId, clientKey: "fabrikam", rule: "question", ruleDetail: null, at: asked.createdAt });
    expect(await teams.expire("2026-11-06T15:00:00Z")).toBe(1);
    expect(await teams.message(CHAT, old.messageId)).toBeNull();
    expect(await teams.message(CHAT, asked.messageId)).not.toBeNull();
    expect(await teams.message(CHAT, recent.messageId)).not.toBeNull();
  });

  it("Delete stored messages for a client: the messages behind a Request or a promise stay", async () => {
    const { db, teams } = await store();
    const [plain, asked, promised] = [msg(), msg(), msg({ senderId: ANA, senderName: "Ana", senderTenant: "home" })];
    await teams.saveMessages([plain, asked, promised]);
    await teams.addRequest({ chatId: CHAT, messageId: asked.messageId, clientKey: "fabrikam", rule: "question", ruleDetail: null, at: asked.createdAt });
    await db.conn.run(
      "INSERT INTO promises (user_id, chat_id, message_id, client_key, what, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
      [ANA, CHAT, promised.messageId, "fabrikam", "Send the totals", "2026-11-20 15:00:00", "2026-11-20 15:00:00"],
    );
    expect(await teams.purgeClient("fabrikam")).toBe(1);
    expect(await teams.message(CHAT, plain.messageId)).toBeNull();
    expect(await teams.message(CHAT, asked.messageId)).not.toBeNull();
    expect(await teams.message(CHAT, promised.messageId)).not.toBeNull();
  });

  it("shared storage, not shared visibility: someone not in the chat's member list gets nothing from it (D521)", async () => {
    const { teams } = await store();
    const m = msg();
    await teams.saveMessages([msg({ createdAt: "2026-11-20T13:00:00Z" }), m]);
    await teams.addRequest({ chatId: CHAT, messageId: m.messageId, clientKey: "fabrikam", rule: "question", ruleDetail: null, at: m.createdAt });
    // Cy follows Fabrikam (that's for actions to check) but isn't in this chat.
    const cy = teams.viewer(CY);
    expect(await cy.chats()).toEqual([]);
    expect(await cy.chat(CHAT)).toBeNull();
    expect(await cy.requests()).toEqual([]);
    expect(await cy.requests([CHAT])).toEqual([]);
    expect(await cy.request(CHAT, m.messageId)).toBeNull();
    expect(await cy.message(CHAT, m.messageId)).toBeNull();
    expect(await cy.messagesBefore(CHAT, "2026-11-30T00:00:00Z", 5)).toEqual([]);
    await expect(cy.resolveRequest(CHAT, m.messageId, { status: "dismissed" })).rejects.toThrow("No such request");
    await expect(cy.setShown(CHAT, m.messageId, true)).rejects.toThrow("No such request");
    await expect(cy.setSort(CHAT, m.messageId, "off", null)).rejects.toThrow("No such request");
    await expect(cy.setKind(CHAT, "delivery")).rejects.toThrow("isn't registered");
    await expect(cy.removeChat(CHAT)).rejects.toThrow("isn't registered");
    expect(await cy.purgeClient("fabrikam")).toBe(0);
    await expect(cy.addChat({ chatId: "19:other@thread.v2", clientKey: "fabrikam", kind: "delivery", displayName: "Other", webUrl: null, members })).rejects.toThrow("aren't in that chat");
    // Ben is in it: he sees it, and what he does is his.
    const ben = teams.viewer(BEN);
    expect((await ben.chats()).map((c) => c.chatId)).toEqual([CHAT]);
    expect((await ben.messagesBefore(CHAT, m.createdAt, 5)).length).toBe(1);
    expect((await ben.resolveRequest(CHAT, m.messageId, { status: "handled" })).resolvedBy).toBe(BEN);
    expect((await teams.request(CHAT, m.messageId))?.status).toBe("handled");
  });

  it("leaving a chat ends seeing it, at the next member read", async () => {
    const { teams } = await store();
    const m = msg();
    await teams.saveMessages([m]);
    expect(await teams.viewer(BEN).message(CHAT, m.messageId)).not.toBeNull();
    await teams.setMembers(CHAT, members.filter((x) => x.userId !== BEN), NOW);
    expect(await teams.viewer(BEN).message(CHAT, m.messageId)).toBeNull();
    expect(await teams.viewer(ANA).message(CHAT, m.messageId)).not.toBeNull();
  });

  it("reading a chat on and off: logged with who; turning it on reads from then on (D523)", async () => {
    const { teams } = await store();
    expect((await teams.chat(CHAT))?.readOn).toBe(true);
    await teams.setReading(CHAT, false, BEN);
    expect((await teams.chat(CHAT))?.readOn).toBe(false);
    await teams.recordPoll(CHAT, { polledAt: NOW, seenAt: "2026-11-20T14:00:00Z", fetchedAt: NOW, retryAt: null, failures: 0, state: "ok", note: null, tokenUser: ANA });
    await teams.setReading(CHAT, true, ANA);
    expect(await teams.chat(CHAT)).toMatchObject({ readOn: true, readSince: NOW, seenAt: null });
    expect((await teams.changes()).map((c) => [c.change, c.byUser])).toEqual([["added", ANA], ["reading_off", BEN], ["reading_on", ANA]]);
  });

  it("the poll state: via another person, then needs reconnecting with the last successful fetch kept", async () => {
    const { teams } = await store();
    await teams.recordPoll(CHAT, { polledAt: NOW, fetchedAt: NOW, seenAt: "2026-11-20T14:59:00Z", retryAt: null, failures: 0, state: "via", note: null, tokenUser: BEN });
    expect(await teams.chat(CHAT)).toMatchObject({ pollState: "via", tokenUser: BEN, fetchedAt: NOW, seenAt: "2026-11-20T14:59:00Z" });
    await teams.recordPoll(CHAT, { polledAt: "2026-11-20T15:05:00Z", retryAt: null, failures: 1, state: "reconnect", note: null, tokenUser: null });
    expect(await teams.chat(CHAT)).toMatchObject({ pollState: "reconnect", tokenUser: null, fetchedAt: NOW, seenAt: "2026-11-20T14:59:00Z", polledAt: "2026-11-20T15:05:00Z" });
  });

  it("removing a chat deletes its Requests and messages and logs who did it", async () => {
    const { teams } = await store();
    const m = msg();
    await teams.saveMessages([m]);
    await teams.addRequest({ chatId: CHAT, messageId: m.messageId, clientKey: "fabrikam", rule: "question", ruleDetail: null, at: m.createdAt });
    await teams.removeChat(CHAT, BEN);
    expect(await teams.chat(CHAT)).toBeNull();
    expect(await teams.request(CHAT, m.messageId)).toBeNull();
    expect(await teams.message(CHAT, m.messageId)).toBeNull();
    expect((await teams.changes()).map((c) => [c.change, c.byUser])).toEqual([["added", ANA], ["removed", BEN]]);
  });

  it("CW-1: a call is one row per call id: a start, then its end; open calls, expiry, purge and removal", async () => {
    const { teams } = await store();
    const start = { chatId: CHAT, callId: "call-1", kind: "started" as const, at: "2026-11-20T14:10:00.000Z", startedAt: "2026-11-20T14:10:00.000Z", initiatorId: ANA, initiatorTenant: "home" };
    expect(await teams.saveCalls(CHAT, [start, start])).toBe(1);
    expect(await teams.openCalls([CHAT], "2026-11-20T04:00:00Z")).toEqual([{ chatId: CHAT, callId: "call-1", startedAt: "2026-11-20T14:10:00Z", endedAt: null, startedBy: ANA, startedByTenant: "home" }]);
    expect(await teams.saveCalls(CHAT, [{ ...start, kind: "ended", at: "2026-11-20T15:00:00.000Z", startedAt: "2026-11-20T14:10:00.000Z" }])).toBe(1);
    expect(await teams.openCalls([CHAT], "2026-11-20T04:00:00Z")).toEqual([]);
    // An end seen before its start (the start missed): one row, ended; a later start doesn't reopen it.
    await teams.saveCalls(CHAT, [{ ...start, callId: "call-2", kind: "ended", at: "2026-11-20T14:50:00.000Z", startedAt: "2026-11-20T14:20:00.000Z" }, { ...start, callId: "call-2" }]);
    expect(await teams.openCalls([CHAT], "2026-11-20T04:00:00Z")).toEqual([]);
    // Another chat's events, or an unregistered chat's, aren't recorded under this one.
    expect(await teams.saveCalls(CHAT, [{ ...start, chatId: CHAT2, callId: "call-3" }])).toBe(0);
    expect(await teams.saveCalls(CHAT2, [{ ...start, chatId: CHAT2, callId: "call-3" }])).toBe(0);
    await teams.saveCalls(CHAT, [{ ...start, callId: "call-4" }]);
    expect(await teams.expireCalls("2026-11-20T14:00:00Z")).toBe(0);
    expect(await teams.expireCalls("2026-11-20T14:15:00Z")).toBe(2);
    await teams.saveCalls(CHAT, [{ ...start, callId: "call-5" }]);
    await teams.purgeChats([CHAT]);
    expect(await teams.openCalls([CHAT], "2026-11-20T04:00:00Z")).toEqual([]);
    await teams.saveCalls(CHAT, [{ ...start, callId: "call-6" }]);
    await teams.removeChat(CHAT, ANA);
    expect(await teams.openCalls([CHAT], "2026-11-20T04:00:00Z")).toEqual([]);
  });
});

// The migration: per-user rows from before shared polling, for two people on one chat.
// Everything before the shared store (a later one may change its tables, as CV-2 adds teams_messages.reactions_json).
const BEFORE = NAMED_MIGRATIONS.filter((m) => m.name < "20261104T2100_shared_requests");
async function seedPerUser(run: (sql: string, params: unknown[]) => Promise<unknown>) {
  for (const [who, created] of [[ANA, "2026-11-02T10:00:00Z"], [BEN, "2026-11-03T10:00:00Z"]] as const) {
    // Ana registered it first but never had its members cached; Ben's row has them.
    await run("INSERT INTO delivery_chats (user_id, chat_id, client_key, display_name, web_url, is_primary, position, members_json, members_fetched_at, created_at, updated_at, chat_kind, asks_on, asks_since, asks_seen_at, asks_polled_at, asks_failures) VALUES (?, ?, 'fabrikam', 'Fabrikam chat', NULL, 0, 0, ?, ?, ?, ?, 'customer', ?, ?, ?, ?, 0)", [who, CHAT, who === BEN ? JSON.stringify(members) : null, who === BEN ? "2026-11-04T08:00:00Z" : null, created, created, who === BEN ? 1 : 0, created, who === ANA ? "2026-11-04T10:00:00Z" : "2026-11-04T11:00:00Z", "2026-11-04T11:05:00Z"]);
    await run("INSERT INTO chat_messages (user_id, chat_id, message_id, client_key, author_id, author_tenant, created_at, body_text, has_image, has_file, reply_to_id) VALUES (?, ?, '1730000000001', 'fabrikam', 'c-dana', 'client', '2026-11-04T09:00:00Z', 'Can you check the export?', 0, 0, NULL)", [who, CHAT]);
  }
  // A second chat Ana added for its names and members (T-2) but never switched on for asks.
  await run("INSERT INTO delivery_chats (user_id, chat_id, client_key, display_name, web_url, is_primary, position, members_json, members_fetched_at, created_at, updated_at, chat_kind, asks_on, asks_failures) VALUES (?, ?, 'fabrikam', 'Fabrikam team', NULL, 0, 1, ?, '2026-11-02T10:00:00Z', '2026-11-02T10:00:00Z', '2026-11-02T10:00:00Z', 'delivery', 0, 0)", [ANA, CHAT2, JSON.stringify(members)]);
  // Ana's own reply, stored only in her rows, and her promise on it (AP-2), answering Dana's message.
  await run("INSERT INTO chat_messages (user_id, chat_id, message_id, client_key, author_id, author_tenant, created_at, body_text, has_image, has_file, reply_to_id) VALUES (?, ?, '1730000000002', 'fabrikam', ?, 'home', '2026-11-04T09:30:00Z', 'I will send the fixed export by Friday', 0, 0, NULL)", [ANA, CHAT, ANA]);
  await run("INSERT INTO promises (user_id, chat_id, message_id, client_key, phrase, what, due, to_whom, answers_message_id, ai_status, status, created_at, updated_at) VALUES (?, ?, '1730000000002', 'fabrikam', 'I will', 'Send the fixed export', '2026-11-06', 'Dana Client', '1730000000001', 'sorted', 'open', '2026-11-04 09:31:00', '2026-11-04 09:31:00')", [ANA, CHAT]);
  // Ana handled it on the 4th; Ben dismissed it later on the 5th: Ben's is the latest action. Ana's AI sort is the only one.
  await run("INSERT INTO asks (user_id, chat_id, message_id, client_key, ask_rule, rule_detail, status, note, resolved_at, created_at, updated_at, ai_status, ai_at, ai_kind, ai_urgency, ai_title, ai_reason) VALUES (?, ?, '1730000000001', 'fabrikam', 'question', NULL, 'handled', 'Answered', '2026-11-04T12:00:00Z', '2026-11-04T09:00:00Z', '2026-11-04T12:00:00Z', 'sorted', '2026-11-04T09:01:00Z', 'question', 'backlog', 'Check the export', 'It asks a question.')", [ANA, CHAT]);
  await run("INSERT INTO asks (user_id, chat_id, message_id, client_key, ask_rule, rule_detail, status, note, resolved_at, created_at, updated_at) VALUES (?, ?, '1730000000001', 'fabrikam', 'question', NULL, 'dismissed', NULL, '2026-11-05T08:00:00Z', '2026-11-04T09:00:00Z', '2026-11-05T08:00:00Z')", [BEN, CHAT]);
}
async function checkMigrated(conn: Conn) {
  const teams = createTeamsStore(conn, () => Temporal.Instant.from(NOW));
  const chats = await teams.chats();
  expect(chats).toHaveLength(2);
  // D523: reading stays on only where someone had switched it on (Ben did; Ana hadn't): the other is registered, off.
  expect(chats.map((c) => [c.chatId, c.readOn])).toEqual([[CHAT, true], [CHAT2, false]]);
  expect(chats[0]).toMatchObject({ chatId: CHAT, clientKey: "fabrikam", kind: "customer", registeredBy: ANA, readSince: "2026-11-02T10:00:00Z", seenAt: "2026-11-04T11:00:00Z" });
  // The newest member list anyone had, so the people in the chat see it at once.
  expect(chats[0]!.members?.map((m) => m.userId)).toEqual([ANA, BEN]);
  const msgs = await teams.messagesBefore(CHAT, "2026-11-30T00:00:00Z", 10);
  expect(msgs.map((m) => [m.messageId, m.senderId])).toEqual([["1730000000001", "c-dana"], ["1730000000002", ANA]]);
  expect((await teams.viewer(BEN).requests()).map((r) => r.messageId)).toEqual(["1730000000001"]);
  // Ana's promise stays hers, as it was, and its message and the one it answers are in the shared store.
  const promises = await conn.all("SELECT user_id, message_id, answers_message_id, what, status FROM promises", []);
  expect(promises).toEqual([{ user_id: ANA, message_id: "1730000000002", answers_message_id: "1730000000001", what: "Send the fixed export", status: "open" }]);
  expect((await teams.viewer(ANA).message(CHAT, "1730000000002"))?.text).toBe("I will send the fixed export by Friday");
  // A promise's message never expires or is purged with the client.
  expect(await teams.expire("2026-12-31T00:00:00Z")).toBe(0);
  // One shared state: the latest action (Ben's dismiss), with the AI sort kept from Ana's.
  expect(await teams.requests([CHAT])).toEqual([expect.objectContaining({ status: "dismissed", resolvedBy: BEN, sortStatus: "sorted", sortedBy: ANA, sort: expect.objectContaining({ kind: "question", title: "Check the export" }) })]);
}

it("migration [sqlite]: carries chats, messages, Requests with their AI sort and the latest action, and leaves promises as they are", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "ft-shared-")), "plan.db");
  const now = () => Temporal.Instant.from(NOW).toZonedDateTimeISO("UTC");
  const before = openPlanDb({ path, now, named: BEFORE });
  const conn0 = sqliteConn(before);
  await addUsers(conn0, ANA, BEN);
  await seedPerUser((sql, p) => conn0.run(sql, p as never));
  before.close();
  await checkMigrated(sqliteConn(openPlanDb({ path, now })));
});

await onSqlServer("migration", () => {
  it("carries chats, messages, Requests with their AI sort and the latest action, and leaves promises as they are", async () => {
    const { conn, drop } = await emptySqlServer();
    try {
      await migrateSqlServer(conn, { named: BEFORE });
      await addUsers(conn, ANA, BEN);
      await seedPerUser((sql, p) => conn.run(sql, p as never));
      await migrateSqlServer(conn);
      await checkMigrated(conn);
    } finally {
      await drop();
    }
  });
});

// CV-4: images_no_bytes clears the bytes CV-2 kept (the row, its type and size stay; it goes back to pending) and logs
// only how many. Seeded on a database migrated up to the migration before it.
const BEFORE_NO_BYTES = NAMED_MIGRATIONS.filter((m) => m.name < "20261107T1400_images_no_bytes");
async function seedImages(run: (sql: string, params: unknown[]) => Promise<unknown>) {
  await run("INSERT INTO teams_message_images (chat_id, message_id, position, hosted_id, state, reason, content_type, byte_size, bytes, attempts, fetched_at, created_at) VALUES (?, '1', 0, 'aWQ9MQ==', 'ok', NULL, 'image/png', 3, ?, 1, '2026-11-06T10:00:00Z', '2026-11-06T10:00:00Z')", [CHAT, Buffer.from([1, 2, 3])]);
  await run("INSERT INTO teams_message_images (chat_id, message_id, position, hosted_id, state, reason, content_type, byte_size, bytes, attempts, fetched_at, created_at) VALUES (?, '1', 1, 'aWQ9Mg==', 'skipped', 'too big', NULL, NULL, NULL, 1, '2026-11-06T10:00:00Z', '2026-11-06T10:00:00Z')", [CHAT]);
}
async function checkNoBytes(conn: Conn, logs: { op?: string; count?: number }[]) {
  const rows = await conn.all("SELECT position, state, content_type, byte_size, attempts, description, CASE WHEN bytes IS NULL THEN 0 ELSE 1 END AS has_bytes FROM teams_message_images ORDER BY position", []);
  expect(rows.map((r) => ({ ...r, attempts: Number(r.attempts), byte_size: r.byte_size === null ? null : Number(r.byte_size), has_bytes: Number(r.has_bytes) }))).toEqual([
    { position: 0, state: "pending", content_type: "image/png", byte_size: 3, attempts: 0, description: null, has_bytes: 0 },
    { position: 1, state: "skipped", content_type: null, byte_size: null, attempts: 1, description: null, has_bytes: 0 },
  ]);
  expect(logs.filter((l) => l.op === "images_bytes_cleared")).toEqual([{ source: "database", op: "images_bytes_cleared", count: 1 }]);
}

it("CV-4 migration [sqlite]: clears stored image bytes, keeps the rows' metadata, logs the count", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "ft-nobytes-")), "plan.db");
  const now = () => Temporal.Instant.from(NOW).toZonedDateTimeISO("UTC");
  const before = openPlanDb({ path, now, named: BEFORE_NO_BYTES });
  await seedImages((sql, p) => sqliteConn(before).run(sql, p as never));
  before.close();
  const logs: { op?: string; count?: number }[] = [];
  await checkNoBytes(sqliteConn(openPlanDb({ path, now, log: (r) => logs.push(r) })), logs);
});

await onSqlServer("CV-4 migration", () => {
  it("clears stored image bytes, keeps the rows' metadata, logs the count", async () => {
    const { conn, drop } = await emptySqlServer();
    try {
      await migrateSqlServer(conn, { named: BEFORE_NO_BYTES });
      await seedImages((sql, p) => conn.run(sql, p as never));
      const logs: { op?: string; count?: number }[] = [];
      await migrateSqlServer(conn, { log: (r) => logs.push(r) });
      await checkNoBytes(conn, logs);
    } finally {
      await drop();
    }
  });
});
