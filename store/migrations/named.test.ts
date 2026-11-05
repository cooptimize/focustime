// Timestamped migrations (S1, D458): after the numbered ones, in name order, recorded by full name; a shared prefix fails
// here (so CI stops it); an empty database and one already at the newest numbered migration both end up the same.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { emptySqlServer, onSqlServer } from "../../test/db.ts";
import { localStoreFiles } from "../../host/local/files.ts";
import { MIGRATIONS, openPlanDb } from "../plan-store.ts";
import { migrateSqlServer, SQLSERVER_MIGRATIONS, SQLSERVER_VERSION, sqlServerVersion } from "../sql/migrate.ts";
import { NAMED_MIGRATIONS } from "./index.ts";
import { BRANCH_BUILT, inOrder, namedProblems, newerThanBuild, pending, prefixOf, renamedByBranch, type NamedMigration } from "./named.ts";

const now = () => Temporal.ZonedDateTime.from("2026-11-03T12:00:00-05:00[America/New_York]");
const table = (name: string, t: string): NamedMigration => ({ name, sqlite: `CREATE TABLE ${t} (id INTEGER);`, sqlserver: `CREATE TABLE ${t} (id int);` });
const later = table("20261104T0900_t_later", "t_later");
const earlier = table("20261103T0800_t_earlier", "t_earlier");

describe("the list", () => {
  it("every shipped migration has a good name and its own prefix", () => {
    expect(namedProblems(NAMED_MIGRATIONS)).toEqual([]);
    expect(NAMED_MIGRATIONS.map((m) => prefixOf(m.name))).toContain("20261103T1700");
  });
  it("two migrations with one prefix fail", () => {
    const twin = table("20261103T1700_other_thing", "x");
    expect(namedProblems([...NAMED_MIGRATIONS, twin])).toEqual(["20261103T1700_other_thing and 20261103T1700_setup_state share the prefix 20261103T1700"]);
    expect(() => inOrder([...NAMED_MIGRATIONS, twin])).toThrow(/share the prefix/);
  });
  it("a name without a UTC timestamp fails", () => {
    expect(namedProblems([{ name: "31_setup_state" }, { name: "20261303T1700_x" }, { name: "20261103T1700-Bad" }])).toHaveLength(3);
  });
  it("applies in name order whatever the list order, skipping what is recorded", () => {
    expect(pending([later, earlier], new Set()).map((m) => m.name)).toEqual([earlier.name, later.name]);
    expect(pending([later, earlier], new Set([earlier.name])).map((m) => m.name)).toEqual([later.name]);
  });
  it("runs on a database with a newer migration this build doesn't know (D468: migrations only add, so a rollback is safe)", () => {
    expect(pending([earlier], new Set(["20271231T2359_future"]))).toEqual([earlier]);
    expect(newerThanBuild([earlier], new Set([earlier.name, "20271231T2359_future"]))).toEqual(["20271231T2359_future"]);
    // An unknown one older than this build's newest isn't "newer": another branch's, not ours to judge.
    expect(pending([later], new Set(["20261101T0000_elsewhere"]))).toEqual([later]);
    expect(newerThanBuild([later], new Set(["20261101T0000_elsewhere"]))).toEqual([]);
  });
});

describe("SQLite", () => {
  const names = (db: DatabaseSync) => (db.prepare("SELECT name FROM schema_migration_names ORDER BY rowid").all() as { name: string }[]).map((r) => r.name);
  const versions = (db: DatabaseSync) => (db.prepare("SELECT COUNT(*) AS n, MAX(version) AS v FROM schema_migrations").get() as { n: number; v: number });

  it("an empty database: every numbered migration, then the named ones in name order", () => {
    const db = openPlanDb({ path: ":memory:", now, named: [...NAMED_MIGRATIONS, later, earlier] });
    expect(versions(db)).toEqual({ n: MIGRATIONS.length, v: MIGRATIONS.length });
    expect(names(db)).toEqual(inOrder([...NAMED_MIGRATIONS, later, earlier]).map((m) => m.name));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'setup_state'").get()).toBeTruthy();
  });

  it("a database at the newest numbered migration gets only the named ones, with a backup first", () => {
    const dir = mkdtempSync(join(tmpdir(), "focustime-named-"));
    const path = join(dir, "plan.db");
    openPlanDb({ path, now, files: localStoreFiles, named: [] }).close();
    const db = openPlanDb({ path, now, files: localStoreFiles });
    expect(versions(db).v).toBe(MIGRATIONS.length);
    expect(names(db)).toEqual(NAMED_MIGRATIONS.map((m) => m.name).sort());
    expect(readdirSync(dir).filter((f) => f.startsWith("plan.db.bak-"))).toHaveLength(1);
    db.close();
    // Opening again applies nothing and makes no second backup.
    openPlanDb({ path, now, files: localStoreFiles }).close();
    expect(readdirSync(dir).filter((f) => f.startsWith("plan.db.bak-"))).toHaveLength(1);
  });

  it("setup_state: everyone who already has settings counts as set up (each step done); nobody else gets a row", () => {
    const path = join(mkdtempSync(join(tmpdir(), "focustime-named-")), "plan.db");
    const before = openPlanDb({ path, now, named: [] });
    before.prepare("INSERT INTO user_settings (user_id, section, position, body, updated_at) VALUES ('old', 'hours', 1, 'x', 'x'), ('old', 'ui', 2, 'x', 'x')").run();
    before.close();
    const db = openPlanDb({ path, now });
    expect(db.prepare("SELECT user_id, step, status FROM setup_state ORDER BY step").all().map((r) => `${r.user_id} ${r.step} ${r.status}`)).toEqual(["old blocks done", "old calendars done", "old clients done", "old day done"]);
    db.close();
  });

  it("a failing named migration leaves nothing half done", () => {
    const dir = mkdtempSync(join(tmpdir(), "focustime-named-"));
    const path = join(dir, "plan.db");
    openPlanDb({ path, now }).close();
    const bad: NamedMigration = { name: "20261105T1200_bad", sqlite: "CREATE TABLE half_done (id INTEGER); SELECT * FROM no_such_table;", sqlserver: "" };
    expect(() => openPlanDb({ path, now, named: [...NAMED_MIGRATIONS, bad] })).toThrow();
    const db = new DatabaseSync(path);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined();
    expect(names(db)).not.toContain(bad.name);
    db.close();
  });
});

await onSqlServer("SQL Server timestamped migrations (S1)", () => {
  it("an empty database: the numbered migrations, then the named ones in name order", async () => {
    const db = await emptySqlServer();
    try {
      const all = [...NAMED_MIGRATIONS, later, earlier];
      expect(await migrateSqlServer(db.conn, { named: all })).toEqual([...SQLSERVER_MIGRATIONS.map((m) => m.version), ...inOrder(all).map((m) => m.name)]);
      expect(await sqlServerVersion(db.conn)).toBe(SQLSERVER_VERSION);
      expect((await db.conn.all("SELECT name FROM schema_migration_names ORDER BY name")).map((r) => r.name)).toEqual(inOrder(all).map((m) => m.name));
      expect(await migrateSqlServer(db.conn, { named: all })).toEqual([]);
    } finally {
      await db.drop();
    }
  });

  it("a database already at the newest numbered migration gets only the named ones; people with settings count as set up", async () => {
    const db = await emptySqlServer();
    try {
      await migrateSqlServer(db.conn, { named: [] });
      const at = "2026-11-02T14:00:00Z";
      await db.conn.run("INSERT INTO users (id, tenant_id, upn, display_name, email, time_zone, created_at, last_sign_in_at) VALUES ('old', 't', 'o@example.com', 'O', NULL, NULL, ?, ?)", [at, at]);
      await db.conn.run("INSERT INTO user_settings (user_id, section, position, body, updated_at) VALUES ('old', 'hours', 1, 'x', ?)", [at]);
      expect(await migrateSqlServer(db.conn)).toEqual(NAMED_MIGRATIONS.map((m) => m.name).sort());
      expect((await db.conn.all("SELECT step FROM setup_state WHERE user_id = 'old' AND status = 'done' ORDER BY step")).map((r) => r.step)).toEqual(["blocks", "calendars", "clients", "day"]);
    } finally {
      await db.drop();
    }
  });
});

describe("a database a branch build migrated (HK-3)", () => {
  it("names the recorded copy of a build migration under another timestamp", () => {
    const list = [{ name: "20261105T1300_devops_takes" }, { name: "20261106T0900_week_carry" }];
    expect(renamedByBranch(list, new Set(["20261104T2200_devops_takes", "20261106T0900_week_carry"]))).toEqual([{ recorded: "20261104T2200_devops_takes", build: "20261105T1300_devops_takes" }]);
    // Both recorded (the build's own already applied too), or only the build's: nothing to say.
    expect(renamedByBranch(list, new Set(["20261104T2200_devops_takes", "20261105T1300_devops_takes"]))).toEqual([]);
    expect(renamedByBranch(list, new Set(["20261105T1300_devops_takes"]))).toEqual([]);
    expect(BRANCH_BUILT).toBe("This database was migrated by a branch build: run npm run db:reset");
  });
});
