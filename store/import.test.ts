// A3: the export JSON as the migration format: a SQLite store's export loads into either store (SQL Server's
// baseline reads what SQLite's 26 migrations wrote), ids kept, links within a table kept, idempotent, with a dry run;
// and refused when it isn't one, is another version, holds secrets or would take someone else's ids.
import { expect, it } from "vitest";
import { addUsers, forEachDriver, sqliteDb } from "../test/db.ts";
import { fill, FILL_NOW } from "../test/fill.ts";
import { createAccountStore } from "./accounts.ts";
import { countRows, importUser, ImportRefused } from "./import.ts";
import { MIGRATIONS } from "./plan-store.ts";
import { USER_TABLES } from "./scope.ts";
import type { Conn } from "./sql/conn.ts";
import { BASELINE_VERSION } from "./sql/baseline.ts";
import { SQLSERVER_MIGRATIONS } from "./sql/migrate.ts";
import { exportUser, NOT_EXPORTED, PARENTS_FIRST, USER_SCHEMA_VERSION } from "./user-data.ts";

const now = () => Temporal.Instant.from(FILL_NOW);

/** A SQLite store with one person who has something in every table, and their export. */
async function source() {
  const src = sqliteDb();
  await addUsers(src.conn, "ana");
  await fill(src.conn, "ana");
  const user = (await createAccountStore(src.conn, now).users.get("ana"))!;
  const json = JSON.parse(JSON.stringify(await exportUser(src.conn, user, now()))) as { tables: Record<string, Record<string, unknown>[]> } & Record<string, unknown>;
  return { src, json };
}

/** A stamp as the instant it names (SQLite keeps the text it was given; SQL Server the UTC instant, shown in a zone). */
const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)(\[[^\]]+\])?$/;
const instants = (row: unknown) => JSON.stringify(row, (_k, v: unknown) => (typeof v === "string" && STAMP.test(v) ? Temporal.Instant.from(v.replace(/\[.*\]$/, "")).toString() : v));

/** One person's export tables in a fixed order, to compare across stores. */
const tablesOf = async (conn: Conn, id: string) => {
  const user = (await createAccountStore(conn, now).users.get(id))!;
  const t = (JSON.parse(JSON.stringify(await exportUser(conn, user, now()))) as { tables: Record<string, unknown[]> }).tables;
  return Object.fromEntries(Object.entries(t).map(([k, rows]) => [k, rows.map(instants).sort()]));
};

it("the export's schema version is SQLite's newest numbered one plus IB-1's inbox_marks, AS-2's assistant_turns.pending_json and AH-5's ahead_state_changes; SQL Server's user tables match it at migration 29 (D438)", () => {
  expect(USER_SCHEMA_VERSION).toBe(MIGRATIONS.length + 3);
  expect(BASELINE_VERSION).toBe(26);
  expect(SQLSERVER_MIGRATIONS.find((m) => m.version === 29)?.name).toMatch(/week_features/);
});

it("PARENTS_FIRST lists every exported user table once, after every table it references", async () => {
  const db = sqliteDb();
  expect([...PARENTS_FIRST].sort()).toEqual([...USER_TABLES].sort());
  for (const [i, t] of PARENTS_FIRST.entries()) {
    const refs = (await db.conn.all(`SELECT "table" AS ref FROM pragma_foreign_key_list('${t}')`)).map((r) => r.ref as string);
    for (const r of refs) if (r !== t && r !== "users") expect(PARENTS_FIRST.indexOf(r), `${t} references ${r}`).toBeLessThan(i);
  }
  void NOT_EXPORTED;
});

// A few hundred rows, two statements each, in one transaction: slower on SQL Server under the full suite (about 3 s
// alone, up to 31 s with the whole suite on one machine), so each test gets 60 s on both drivers.
await forEachDriver("import an export", ({ driver, open }) => {
  it("loads a SQLite store's export: every row, the same ids and links, under the given id", async () => {
    const { src, json } = await source();
    const db = (await open()).conn;
    const r = await importUser(db, "oid-ana", json, { dryRun: false, now });
    expect(r.userCreated).toBe(true);
    for (const t of r.tables) expect(t, t.table).toMatchObject({ inFile: json.tables[t.table]!.length, present: 0, added: json.tables[t.table]!.length });
    expect(await tablesOf(db, "oid-ana")).toEqual(await tablesOf(src.conn, "ana"));
    // The links within a table came through (the fill makes at least one of each).
    for (const q of ["picks WHERE carried_from IS NOT NULL", "devops_write_log WHERE undone_by IS NOT NULL", "write_log WHERE undo_of IS NOT NULL"]) {
      const [t, cond] = q.split(" WHERE ") as [string, string];
      const n = async (c: Conn, id: string) => Number((await c.get(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ? AND ${cond}`, [id]))!.n);
      expect(await n(src.conn, "ana"), q).toBeGreaterThan(0);
      expect(await n(db, "oid-ana"), q).toBe(await n(src.conn, "ana"));
    }
    // Every count matches, except secrets: never exported (sealed with the old store's key; set again after the move).
    // Push subscriptions neither (sealed too, and tied to one browser: the device turns push on again).
    // TB-1, TB-1b: the Teams bot's chat, cards and handled ids neither (Teams' plumbing, rebuilt by the person's next message).
    const { user_secrets: kept, push_devices: devices, teams_bot_chats: chats, teams_bot_cards: cards, teams_bot_seen: seen, teams_rhythm: rhythm, ...rest } = await countRows(src.conn, "ana");
    expect(kept).toBe(1);
    expect(devices).toBe(1);
    expect([chats, cards, seen]).toEqual([1, 1, 1]);
    expect(await countRows(db, "oid-ana")).toEqual({ ...rest, user_secrets: 0, push_devices: 0, teams_bot_chats: 0, teams_bot_cards: 0, teams_bot_seen: 0, teams_rhythm: 0 });
    // New rows after an import get new ids (SQL Server's identities move past the imported ones).
    await addUsers(db, "ben");
    await fill(db, "ben");
    expect(driver).toBeTruthy();
  });

  it("keeps a time as given, offset and the longest zone names included", async () => {
    const { json } = await source();
    const db = (await open()).conn;
    const zoned = "2026-11-02T10:29:04-03:00[America/Argentina/ComodRivadavia]";
    const f = json.tables.follow_ups!;
    f[0] = { ...f[0], ref_at: zoned };
    await importUser(db, "oid-ana", json, { dryRun: false, now });
    expect((await db.get("SELECT ref_at FROM follow_ups WHERE user_id = 'oid-ana' AND id = ?", [f[0]!.id as number]))!.ref_at).toBe(zoned);
  });

  it("is idempotent: a second run adds nothing", async () => {
    const { json } = await source();
    const db = (await open()).conn;
    await importUser(db, "oid-ana", json, { dryRun: false, now });
    const before = await countRows(db, "oid-ana");
    const r = await importUser(db, "oid-ana", json, { dryRun: false, now });
    expect(r.userCreated).toBe(false);
    for (const t of r.tables) expect(t, t.table).toMatchObject({ present: t.inFile, added: 0 });
    expect(await countRows(db, "oid-ana")).toEqual(before);
  });

  it("a dry run counts and writes nothing", async () => {
    const { json } = await source();
    const db = (await open()).conn;
    const r = await importUser(db, "oid-ana", json, { dryRun: true, now });
    expect(r.dryRun).toBe(true);
    expect(r.userCreated).toBe(true);
    expect(r.tables.reduce((n, t) => n + t.added, 0)).toBeGreaterThan(50);
    expect(await db.get("SELECT id FROM users WHERE id = 'oid-ana'")).toBeUndefined();
    expect(Object.values(await countRows(db, "oid-ana")).every((n) => n === 0)).toBe(true);
  });

  it("an export from before E2 (schema 27, estimates in blocks) loads with each estimate in hours, 1 block = 4h", async () => {
    const { json } = await source();
    const feats = json.tables.week_features!.filter((r) => r.level === "feature");
    expect(feats.length).toBeGreaterThan(0);
    const blocks = [0.5, 1.5, 3];
    const old = {
      ...json,
      schemaVersion: 27,
      tables: {
        ...json.tables,
        week_features: json.tables.week_features!.map((r) => {
          const { estimate: _e, ...rest } = r;
          const i = feats.indexOf(r);
          return { ...rest, blocks: r.level === "feature" ? (blocks[i % blocks.length] ?? null) : null };
        }),
      },
    };
    const db = (await open()).conn;
    const r = await importUser(db, "oid-ana", old, { dryRun: false, now });
    expect(r.estimatesConverted).toBe(feats.length);
    const got = await db.all("SELECT id, estimate FROM week_features WHERE user_id = 'oid-ana' AND level = 'feature' ORDER BY id");
    const want = feats.map((f, i) => ({ id: f.id, estimate: ([2, 6, 12][i % 3]!) * 60 })).sort((a, b) => Number(a.id) - Number(b.id));
    expect(got.map((g) => ({ id: Number(g.id), estimate: Number(g.estimate) }))).toEqual(want.map((w) => ({ id: Number(w.id), estimate: w.estimate })));
    // A current export converts nothing.
    const db2 = (await open()).conn;
    expect((await importUser(db2, "oid-ana", json, { dryRun: true, now })).estimatesConverted).toBe(0);
  });

  it("refuses what isn't a current export, secrets, and someone else's ids, writing nothing", async () => {
    const { json } = await source();
    const db = (await open()).conn;
    const refused = (j: unknown, id = "oid-ana") => expect(importUser(db, id, j, { dryRun: false, now })).rejects.toBeInstanceOf(ImportRefused);
    await refused({ ...json, format: "something-else" });
    await refused({ ...json, schemaVersion: 25 });
    await refused({ ...json, tables: { ...json.tables, user_secrets: [] } });
    await refused({ ...json, tables: { ...json.tables, captures: [{ id: 1, nope: 1 }] } });
    await refused(json, "not an id!");
    expect(await db.get("SELECT id FROM users WHERE id = 'oid-ana'")).toBeUndefined();
    await importUser(db, "oid-ana", json, { dryRun: false, now });
    // The same file for someone else would take ana's ids: refused, and nothing of theirs (not even a users row) is left.
    await refused(json, "oid-ben");
    expect(await db.get("SELECT id FROM users WHERE id = 'oid-ben'")).toBeUndefined();
    expect(Object.values(await countRows(db, "oid-ben")).every((n) => n === 0)).toBe(true);
  });
}, { timeout: 60_000 });
