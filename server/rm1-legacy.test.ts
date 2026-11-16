// RM-1: someone who used the removed features keeps their rows, and every tab still loads. Their week's Nothing this
// week and Mark as being broken down rows, the carry hint, a hidden and a snoozed Inbox item, a hidden conversation
// and the Inbox timeline's last look are planted as the removed actions wrote them (nothing writes them any more);
// then every tab's, Settings' and Admin's read runs in demo mode with no error, Export carries the rows and Delete
// my data takes them. Fictional data only (the demo's).
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import { DEMO_PERSON } from "../sources/demo/azure.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { exportUser, hardDeleteUser } from "../store/user-data.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { createDemoContext, seedDemo } from "./demo.ts";

const NOW = "2026-11-04T14:30:00Z"; // Wednesday 9:30 AM in New York
const MON = "2026-11-02";

async function legacy() {
  const db = sqliteDb();
  await addUsers(db.conn, DEMO_PERSON.oid);
  const plan = planStoreOn(db.conn, { now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York"), userId: DEMO_PERSON.oid });
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} }, plan });
  await seedDemo(ctx);
  const me = DEMO_PERSON.oid;
  // WD-1's Nothing this week and Mark as being broken down, U6's local order, UI-B's carry hint.
  await db.conn.run("INSERT INTO week_quiet (user_id, week_start, client_key, marked_at) VALUES (?, ?, 'Northwind', ?)", [me, MON, NOW]);
  await db.conn.run("INSERT INTO breakdown_marks (user_id, client_key, item_id, marked_at) VALUES (?, 'Northwind', 1110, ?)", [me, NOW]);
  await plan.markOnce("carry_hint", "once");
  // IB-1's Hide for me and Snooze on two promises, IB-2's last look, CV-1's Hide for me on a conversation.
  const f = await plan.addFollowUp({ who: "Dana", what: "Send the export columns", due: "2026-11-03", clientKey: "Northwind" });
  const g = await plan.addFollowUp({ who: "Dana", what: "Answer about the cutover", due: "2026-11-03", clientKey: "Northwind" });
  await plan.markInbox([`f${f.id}`], { hidden: true });
  await plan.markInbox([`f${g.id}`], { snoozedUntil: "2026-11-05T14:00:00Z" });
  await plan.setState("inbox_last_looked", "2026-11-03T21:00:00Z");
  await db.conn.run("INSERT INTO conversation_views (user_id, conversation_id, seen_version, hidden, hidden_at) VALUES (?, 1, 0, 1, ?)", [me, NOW]);
  return { ctx, plan, db, f, g };
}

const ok = async <T = Record<string, unknown>>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await dispatch(ctx, { action, input });
  if (!r.ok) throw new Error(`${action}: ${r.error}`);
  return r.data as T;
};

describe("RM-1: a person with rows from every removed feature", () => {
  it("opens every tab, Settings and Admin with no error, and the old marks still apply", async () => {
    const { ctx, f, g } = await legacy();
    for (const [action, input] of [
      ["week.load", { weekStart: MON }], ["weekplan.load", { weekStart: MON }], ["planday.start", { date: "2026-11-04" }], ["suggest.load", {}], ["closeout.load", { date: "2026-11-04" }],
      ["roadmap.load", {}], ["ahead.load", {}], ["status.load", {}], ["inbox.list", {}], ["inbox.today", {}], ["conversations.suggestions", {}], ["conversations.list", {}],
      ["my_promises.list", {}], ["capture.load", {}], ["followups.list", {}], ["send.today", {}], ["meeting.list", { clientKey: "Northwind" }], ["settings.load", {}], ...["clients", "ai", "conversations", "people", "setup", "organization", "standards", "status", "audit"].map((section) => ["admin.load", { section }] as const), ["assistant.today", {}],
    ] as const) await ok(ctx, action, input);
    const week = await ok<{ quiet: string[]; marks: { itemId: number }[] }>(ctx, "weekplan.load", { weekStart: MON });
    expect(week.quiet).toEqual(["Northwind"]);
    expect(week.marks.map((m) => m.itemId)).toEqual([1110]);
    const carry = await ok(ctx, "planday.carry", {});
    expect(carry).not.toHaveProperty("hint");
    const inbox = await ok<{ items: { key: string; views: string[] }[]; lastLooked: string | null }>(ctx, "inbox.list", {});
    for (const k of [`f${f.id}`, `f${g.id}`]) expect(inbox.items.find((i) => i.key === k)?.views ?? []).toEqual([]);
    expect(inbox.lastLooked).toBe("2026-11-03T21:00:00Z");
  });

  it("Export carries the rows and Delete my data takes them", async () => {
    const { db } = await legacy();
    const me = DEMO_PERSON.oid;
    const user = { id: me, tenantId: DEMO_PERSON.tid, upn: "demo@example.com", displayName: "Demo", email: null, timeZone: "America/New_York", createdAt: NOW, lastSignInAt: NOW, deletedAt: null };
    const at = Temporal.Instant.from(NOW);
    const tables = ((await exportUser(db.conn, user, at)) as { tables: Record<string, unknown[]> }).tables;
    const legacyTables = ["week_quiet", "breakdown_marks", "markers", "inbox_marks", "kv_state", "conversation_views"].filter((t) => t in tables);
    expect(legacyTables).toEqual(expect.arrayContaining(["week_quiet", "breakdown_marks", "inbox_marks", "conversation_views"]));
    for (const t of legacyTables) expect(tables[t]!.length, t).toBeGreaterThan(0);
    await hardDeleteUser(db.conn, me, at);
    const count = async (t: string) => Number((await db.conn.get(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, [me]))?.n ?? 0);
    for (const t of legacyTables) expect(await count(t), t).toBe(0);
  });
});
