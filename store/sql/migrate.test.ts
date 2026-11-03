// A3: the SQL Server migration runner: an empty database to the current version, a re-run that does nothing, an
// older database brought forward, a failing migration that leaves the version before it, and a newer database refused.
import { expect, it } from "vitest";
import { emptySqlServer, onSqlServer } from "../../test/db.ts";
import { BASELINE_VERSION } from "./baseline.ts";
import { NAMED_MIGRATIONS } from "../migrations/index.ts";
import { migrateSqlServer, SQLSERVER_MIGRATIONS, SQLSERVER_VERSION, sqlServerVersion } from "./migrate.ts";

await onSqlServer("SQL Server migrations (A3)", () => {
  it("an empty database to the current version, then a re-run that applies nothing", async () => {
    const db = await emptySqlServer();
    try {
      expect(await sqlServerVersion(db.conn)).toBe(0);
      expect(await migrateSqlServer(db.conn)).toEqual([...SQLSERVER_MIGRATIONS.map((m) => m.version), ...NAMED_MIGRATIONS.map((m) => m.name).sort()]);
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
      expect(await migrateSqlServer(db.conn, { named: [] })).toEqual(SQLSERVER_MIGRATIONS.slice(1).map((m) => m.version));
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

  it("E2 (version 30): feature estimates in blocks become minutes at 1 block = 4h, counted in the log; picks may be unsized", async () => {
    const db = await emptySqlServer();
    try {
      await migrateSqlServer(db.conn, { migrations: SQLSERVER_MIGRATIONS.filter((m) => m.version < 30) });
      const at = "2026-11-06T20:00:00Z";
      await db.conn.run("INSERT INTO users (id, tenant_id, upn, display_name, email, time_zone, created_at, last_sign_in_at) VALUES ('u1', 't', 'u@example.com', 'U', NULL, NULL, ?, ?)", [at, at]);
      const add = (id: number, level: string, blocks: number | null, size: string | null) =>
        db.conn.run("INSERT INTO week_features (user_id, week_start, client_key, item_id, level, tier, title, blocks, size, created_at, updated_at) VALUES ('u1', '2026-11-09', 'Contoso', ?, ?, 'must', 'T', ?, ?, ?, ?)", [id, level, blocks, size, at, at]);
      await add(1, "feature", 0.5, null); // E1: half a block
      await add(2, "feature", 1.5, null); // E1
      await add(3, "feature", 3, null); // step 16.4: whole blocks
      await add(4, "feature", null, null); // no estimate: stays empty (4h by default)
      await add(5, "story", null, "M");
      const log: { op: string; count?: number }[] = [];
      expect(await migrateSqlServer(db.conn, { log: (r) => void log.push(r), named: [] })).toEqual([30]);
      expect(log).toContainEqual(expect.objectContaining({ op: "convert_estimates", count: 3 }));
      const rows = await db.conn.all("SELECT item_id, estimate, size FROM week_features ORDER BY item_id");
      expect(rows.map((r) => [r.item_id, r.estimate, r.size])).toEqual([[1, 120], [2, 360], [3, 720], [4, null], [5, null, "M"]].map((x) => (x.length === 2 ? [...x, null] : x)));
      expect((await db.conn.all("SELECT LOWER(name) AS name FROM sys.columns WHERE object_id = OBJECT_ID(N'week_features')")).map((r) => r.name)).not.toContain("blocks");
      await expect(db.conn.run("UPDATE week_features SET estimate = 90 WHERE item_id = 1")).rejects.toThrow();
      // A pick with no size is allowed now; anything but S, M or L still isn't.
      await db.conn.run("INSERT INTO day_plans (user_id, date, created_at, updated_at) VALUES ('u1', '2026-11-09', ?, ?)", [at, at]);
      const pick = (size: string | null) => db.conn.run("INSERT INTO picks (user_id, date, half, client_key, kind, title, size, status, position, created_at, updated_at) VALUES ('u1', '2026-11-09', 'AM', 'Contoso', 'intention', 'T', ?, 'planned', 1, ?, ?)", [size, at, at]);
      await pick(null);
      await pick("L");
      await expect(pick("X")).rejects.toThrow();
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
