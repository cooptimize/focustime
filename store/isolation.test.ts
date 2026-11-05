// A2: two people on one plan store cannot see or change each other's rows, in every table. The table list drives the
// test: a table in the database that isn't in USER_TABLES (and isn't an app table) fails it, and so does a user table
// the workload below doesn't fill (so a new table needs a line here, and its scoping is then checked like the rest).
import { expect, it } from "vitest";
import { openPlanDb, planStoreOn, type PlanStore } from "./plan-store.ts";
import type { Conn } from "./sql/conn.ts";
import { sqliteConn } from "./sql/sqlite.ts";
import { forEachDriver, type TestDb } from "../test/db.ts";
import { fill, KEYS } from "../test/fill.ts";
import { scopeSql, ScopeError, USER_TABLES } from "./scope.ts";
import { createUserSecrets } from "./user-secrets.ts";
import { DEMO_TZ } from "../sources/demo/data.ts";

/** Tables that are the app's, not one person's (each keyed by its own id or holding user_id itself). */
const APP_TABLES = ["schema_migrations", "schema_version", "schema_migration_names", "scheduler_state", "app_keys", "ai_app_spend", "users", "sessions", "auth_requests", "deletions", "client_chats", "teams_messages", "requests", "client_chat_changes", "conversations", "conversation_messages", "commitments", "conversation_suggestions", "chat_ai_days", "app_ai_requests", "org_settings", "admin_audit", "people_directory", "client_leads", "people_clients", "people_overrides", "admin_seen", "devops_takes", "directory_accounts", "devops_items", "devops_changes", "devops_poll", "conversation_merges", "teams_message_images", "sends", "week_commitments", "client_priorities", "look_asks"];

const NOW = "2026-11-02T14:30:00Z";
const zoned = () => Temporal.Instant.from(NOW).toZonedDateTimeISO(DEMO_TZ);
const MON = "2026-11-02";


/** Every row of one person, per table (raw, so nothing is filtered by what is being tested), in a fixed order. */
async function rowsOf(db: Conn, userId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of USER_TABLES) out[t] = (await db.all(`SELECT * FROM ${t} WHERE user_id = ?`, [userId])).map((r) => JSON.stringify(r)).sort();
  return out;
}

/** What a person's store shows: every read that takes no argument or a week's dates. */
async function view(p: PlanStore): Promise<unknown> {
  const ex = (await p.exportJson()) as Record<string, unknown>;
  delete ex.exportedAt;
  return {
    ex,
    inbox: await p.inbox(),
    drafts: await p.allDrafts(),
    follow: await p.allFollowUps(),
    week: await p.weekPlan(MON),
    weekDrafts: await p.weekDrafts(MON),
    quiet: await p.weekQuiet(MON),
    picks: await p.picksBetween(MON, "2026-11-08"),
    boxes: await p.timeboxesBetween(MON, "2026-11-08"),
    flex: await p.flexBetween(MON, "2026-11-08"),
    unavailable: await p.unavailableBetween(MON, "2026-11-08"),
    marks: await p.breakdownMarks(),
    timer: await p.getState("timer"),
    identity: await p.accountState("ms_identity"),
    focused: await p.focusedSeconds((await p.picksFor(MON)).map((x) => x.id)),
    marked: await p.marked("reminder", MON),
    snapshots: await p.snapshotsFrom(MON),
    own: await p.ownEvents(),
    invites: await p.invitesFrom(MON),
    carry: await p.carryDecisions(MON),
    watches: await p.weekWatches(MON),
  };
}

/** A users row (SQL Server's per-person tables reference it; SQLite's don't, and a row there does no harm). */
const addUser = (db: Conn, id: string) =>
  db.run("INSERT INTO users (id, tenant_id, upn, display_name, email, time_zone, created_at, last_sign_in_at) VALUES (?, 't', ?, ?, NULL, NULL, ?, ?)", [id, `${id}@example.com`, id, NOW, NOW]);

/** A table's shape, from either catalog: its columns (in order), its indexes' first columns, its references to users. */
type Shape = { cols: { name: string; notNull: boolean }[]; pk: string[]; indexes: { name: string; first: string }[]; refsUsers: boolean };
async function shapeOf(d: TestDb, t: string): Promise<Shape> {
  if (d.driver === "sqlite") {
    const db = d.raw!;
    const cols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; pk: number }[];
    const indexes = (db.prepare(`PRAGMA index_list(${t})`).all() as { name: string }[]).map((ix) => ({ name: ix.name, first: (db.prepare(`PRAGMA index_info(${ix.name})`).all() as { name: string }[])[0]?.name ?? "" }));
    const fks = db.prepare(`PRAGMA foreign_key_list(${t})`).all() as { table: string }[];
    return { cols: cols.map((c) => ({ name: c.name, notNull: c.notnull === 1 })), pk: cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name), indexes, refsUsers: fks.some((f) => f.table === "users") };
  }
  const cols = await d.conn.all("SELECT c.name, c.is_nullable AS n FROM sys.columns c WHERE c.object_id = OBJECT_ID(?) ORDER BY c.column_id", [t]);
  const ix = await d.conn.all(
    "SELECT i.name, i.is_primary_key AS pk, COL_NAME(ic.object_id, ic.column_id) AS col, ic.key_ordinal AS k FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id WHERE i.object_id = OBJECT_ID(?) AND ic.key_ordinal > 0 ORDER BY i.name, ic.key_ordinal",
    [t],
  );
  const refs = await d.conn.get("SELECT COUNT(*) AS n FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID(?) AND referenced_object_id = OBJECT_ID('users')", [t]);
  const names = [...new Set(ix.map((r) => r.name as string))];
  return {
    cols: cols.map((c) => ({ name: c.name as string, notNull: !c.n })),
    pk: ix.filter((r) => r.pk).map((r) => r.col as string),
    // The primary key is checked on its own (below); the other indexes start with user_id.
    indexes: names.filter((n) => !ix.find((r) => r.name === n)!.pk).map((n) => ({ name: n, first: ix.find((r) => r.name === n && r.k === 1)!.col as string })),
    refsUsers: Number(refs?.n) > 0,
  };
}

await forEachDriver("per-user scoping (A2)", (d) => {
  it("covers every table: each is a user table with user_id first in its keys, or an app table", async () => {
    const db = await d.open();
    const tables = await db.tables();
    for (const t of tables) {
      if (APP_TABLES.includes(t)) continue;
      expect(USER_TABLES, `table ${t} is neither a user table nor an app table`).toContain(t);
      const s = await shapeOf(db, t);
      expect(s.cols[0], t).toEqual({ name: "user_id", notNull: true });
      // A natural primary key starts with user_id; an integer id is its own (global) key.
      if (s.pk.length > 1 || (s.pk.length === 1 && s.pk[0] !== "id")) expect(s.pk[0], t).toBe("user_id");
      for (const ix of s.indexes) expect(ix.first, `${t} index ${ix.name}`).toBe("user_id");
      // A3: on SQL Server every person's row references their users row.
      if (d.driver === "sqlserver") expect(s.refsUsers, `${t} references users`).toBe(true);
    }
    for (const t of USER_TABLES) expect(tables, t).toContain(t);
  });

  it("two people: neither sees the other's rows, and nothing one does changes the other's, in every table", async () => {
    const db = (await d.open()).conn;
    for (const id of ["user-a", "user-b"]) await addUser(db, id);
    const a = await fill(db, "user-a");
    const before = await rowsOf(db, "user-a");
    // The workload must reach every table, or the table isn't tested.
    for (const t of USER_TABLES) expect(before[t]!.length, `nothing in ${t} for user-a: add it to fill()`).toBeGreaterThan(0);
    const aView = await view(a);

    // B starts empty: nothing of A's shows.
    const b = planStoreOn(db, { userId: "user-b", now: zoned });
    const empty = (await view(b));
    // The same as a store on a database of its own (SQLite in memory: also checks the drivers agree).
    const fresh = planStoreOn(sqliteConn(openPlanDb({ path: ":memory:", now: zoned })), { userId: "user-b", now: zoned });
    expect(empty).toEqual(await view(fresh));

    // B does everything A did, then aims every id-taking change at A's ids, then resets.
    await fill(db, "user-b");
    const ids = [...new Set(Object.values(before).flatMap((rows) => rows.map((r) => (JSON.parse(r as string) as { id?: unknown }).id)).filter((v): v is number => typeof v === "number"))];
    const bAny = b as unknown as Record<string, (...x: unknown[]) => unknown>;
    const skip = new Set(["close", "reset", "exportJson", "schemaVersion"]);
    let tried = 0;
    for (const [name, fn] of Object.entries(bAny)) {
      if (typeof fn !== "function" || skip.has(name)) continue;
      for (const id of ids) {
        for (const args of [[id], [id, true], [id, null], [id, { date: MON, half: "AM" }], [id, MON, "AM", true], [id, "done"], [id, "must"]]) {
          tried++;
          try {
            await fn.apply(b, args);
          } catch {
            // Refused or not found: what we want.
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(1000);
    await b.reset();
    const bSecrets = createUserSecrets({ db, userId: "user-b", keys: KEYS, now: () => Temporal.Instant.from(NOW) });
    await bSecrets.delete("devops-write-pat:cooptimize");
    await bSecrets.clear();
    expect(await rowsOf(db, "user-a")).toEqual(before);
    expect((await view(a))).toEqual(aView);
    // And A's reset leaves B's rows alone.
    await fill(db, "user-b");
    const bRows = await rowsOf(db, "user-b");
    await a.reset();
    expect(await rowsOf(db, "user-b")).toEqual(bRows);
  }, 120_000);

  it("a store needs a person, and the person can't come from a statement", async () => {
    const db = (await d.open()).conn;
    expect(() => planStoreOn(db, { userId: "", now: zoned })).toThrow(ScopeError);
    expect(() => scopeSql("INSERT INTO kv (user_id, key, value) VALUES (?, ?, ?)")).toThrow(ScopeError);
  });
});
