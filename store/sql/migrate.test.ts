// A3: the SQL Server migration runner: an empty database to the current version, a re-run that does nothing, an
// older database brought forward, a failing migration that leaves the version before it, and a newer database refused.
import { expect, it } from "vitest";
import { emptySqlServer, onSqlServer } from "../../test/db.ts";
import { BASELINE_VERSION } from "./baseline.ts";
import { migrateSqlServer, SQLSERVER_MIGRATIONS, SQLSERVER_VERSION, sqlServerVersion } from "./migrate.ts";

await onSqlServer("SQL Server migrations (A3)", () => {
  it("an empty database to the current version, then a re-run that applies nothing", async () => {
    const db = await emptySqlServer();
    try {
      expect(await sqlServerVersion(db.conn)).toBe(0);
      expect(await migrateSqlServer(db.conn)).toEqual(SQLSERVER_MIGRATIONS.map((m) => m.version));
      expect(await sqlServerVersion(db.conn)).toBe(SQLSERVER_VERSION);
      const tables = (await db.conn.all("SELECT LOWER(name) AS name FROM sys.tables")).map((r) => r.name);
      expect(tables).toEqual(expect.arrayContaining(["users", "picks", "day_plans", "user_secrets", "scheduler_state", "schema_version"]));
      expect(await migrateSqlServer(db.conn)).toEqual([]);
      expect((await db.conn.all("SELECT version FROM schema_version ORDER BY version")).map((r) => r.version)).toEqual(SQLSERVER_MIGRATIONS.map((m) => m.version));
    } finally {
      await db.drop();
    }
  });

  it("a database at the baseline gets only what came after it", async () => {
    const db = await emptySqlServer();
    try {
      expect(await migrateSqlServer(db.conn, { migrations: SQLSERVER_MIGRATIONS.slice(0, 1) })).toEqual([BASELINE_VERSION]);
      expect(await migrateSqlServer(db.conn)).toEqual(SQLSERVER_MIGRATIONS.slice(1).map((m) => m.version));
    } finally {
      await db.drop();
    }
  });

  it("a failing migration leaves the database at the version before it, nothing half done", async () => {
    const db = await emptySqlServer();
    try {
      await migrateSqlServer(db.conn);
      const bad = [...SQLSERVER_MIGRATIONS, { version: SQLSERVER_VERSION + 1, name: "bad", sql: "CREATE TABLE half_done (id int); SELECT * FROM no_such_table;" }];
      await expect(migrateSqlServer(db.conn, { migrations: bad })).rejects.toThrow();
      expect(await sqlServerVersion(db.conn)).toBe(SQLSERVER_VERSION);
      expect(await db.conn.get("SELECT OBJECT_ID(N'half_done') AS id")).toEqual({ id: null });
    } finally {
      await db.drop();
    }
  });

  it("refuses a database newer than this build", async () => {
    const db = await emptySqlServer();
    try {
      await migrateSqlServer(db.conn);
      await db.conn.run("INSERT INTO schema_version (version, name, applied_at) VALUES (?, 'later', SYSUTCDATETIME())", [SQLSERVER_VERSION + 5]);
      await expect(migrateSqlServer(db.conn)).rejects.toThrow(/newer than this build/);
    } finally {
      await db.drop();
    }
  });
});
