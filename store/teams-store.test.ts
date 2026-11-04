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
const ANA = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
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
    await addUsers(db.conn, ANA, BEN);
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
});

// The migration: per-user rows from before shared polling, for two people on one chat.
const BEFORE = NAMED_MIGRATIONS.filter((m) => m.name !== "20261104T2100_shared_requests");
async function seedPerUser(run: (sql: string, params: unknown[]) => Promise<unknown>) {
  for (const [who, created] of [[ANA, "2026-11-02T10:00:00Z"], [BEN, "2026-11-03T10:00:00Z"]] as const) {
    await run("INSERT INTO delivery_chats (user_id, chat_id, client_key, display_name, web_url, is_primary, position, members_json, members_fetched_at, created_at, updated_at, chat_kind, asks_on, asks_since, asks_seen_at, asks_polled_at, asks_failures) VALUES (?, ?, 'fabrikam', 'Fabrikam chat', NULL, 0, 0, NULL, NULL, ?, ?, 'customer', 1, ?, ?, ?, 0)", [who, CHAT, created, created, created, who === ANA ? "2026-11-04T10:00:00Z" : "2026-11-04T11:00:00Z", "2026-11-04T11:05:00Z"]);
    await run("INSERT INTO chat_messages (user_id, chat_id, message_id, client_key, author_id, author_tenant, created_at, body_text, has_image, has_file, reply_to_id) VALUES (?, ?, '1730000000001', 'fabrikam', 'c-dana', 'client', '2026-11-04T09:00:00Z', 'Can you check the export?', 0, 0, NULL)", [who, CHAT]);
  }
  // Ana handled it on the 4th; Ben dismissed it later on the 5th: Ben's is the latest action. Ana's AI sort is the only one.
  await run("INSERT INTO asks (user_id, chat_id, message_id, client_key, ask_rule, rule_detail, status, note, resolved_at, created_at, updated_at, ai_status, ai_at, ai_kind, ai_urgency, ai_title, ai_reason) VALUES (?, ?, '1730000000001', 'fabrikam', 'question', NULL, 'handled', 'Answered', '2026-11-04T12:00:00Z', '2026-11-04T09:00:00Z', '2026-11-04T12:00:00Z', 'sorted', '2026-11-04T09:01:00Z', 'question', 'backlog', 'Check the export', 'It asks a question.')", [ANA, CHAT]);
  await run("INSERT INTO asks (user_id, chat_id, message_id, client_key, ask_rule, rule_detail, status, note, resolved_at, created_at, updated_at) VALUES (?, ?, '1730000000001', 'fabrikam', 'question', NULL, 'dismissed', NULL, '2026-11-05T08:00:00Z', '2026-11-04T09:00:00Z', '2026-11-05T08:00:00Z')", [BEN, CHAT]);
}
async function checkMigrated(conn: Conn) {
  const teams = createTeamsStore(conn, () => Temporal.Instant.from(NOW));
  const chats = await teams.chats();
  expect(chats).toHaveLength(1);
  expect(chats[0]).toMatchObject({ chatId: CHAT, clientKey: "fabrikam", kind: "customer", registeredBy: ANA, readSince: "2026-11-02T10:00:00Z", seenAt: "2026-11-04T11:00:00Z" });
  const msgs = await teams.messagesBefore(CHAT, "2026-11-30T00:00:00Z", 10);
  expect(msgs.map((m) => m.messageId)).toEqual(["1730000000001"]);
  // One shared state: the latest action (Ben's dismiss), with the AI sort kept from Ana's.
  expect(await teams.requests([CHAT])).toEqual([expect.objectContaining({ status: "dismissed", resolvedBy: BEN, sortStatus: "sorted", sortedBy: ANA, sort: expect.objectContaining({ kind: "question", title: "Check the export" }) })]);
}

it("migration [sqlite]: per-user Handled and Dismissed for one message collapse to the latest action", async () => {
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
  it("per-user Handled and Dismissed for one message collapse to the latest action", async () => {
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
