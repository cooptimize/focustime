// A3: the SQL Server migration runner. The baseline (store/sql/baseline.ts) is version 26, SQLite's 26 migrations
// folded into one schema; later changes are appended to SQLSERVER_MIGRATIONS (27: the scheduler's next-due time, an
// app table SQLite doesn't need: there it is kept in memory). Each migration runs in its own
// transaction and is recorded in schema_version in the same transaction, so a failure leaves the database at the
// version before it, and a re-run skips what is recorded (idempotent).

import type { Logger } from "../../log/logger.ts";
import { NAMED_MIGRATIONS } from "../migrations/index.ts";
import { BRANCH_BUILT, NAMES_TABLE, newerThanBuild, pending, renamedByBranch, type NamedMigration } from "../migrations/named.ts";
import { BASELINE, BASELINE_VERSION } from "./baseline.ts";
import type { SqlServerConn } from "./sqlserver.ts";

export type SqlServerMigration = {
  version: number;
  name: string;
  sql: string;
  /** A count (SELECT ... AS n) taken in the migration's transaction before it runs, logged as `op` (never the values). */
  count?: { op: string; sql: string };
};

export const SQLSERVER_MIGRATIONS: readonly SqlServerMigration[] = [
  { version: BASELINE_VERSION, name: "baseline (SQLite migrations 1 to 26)", sql: BASELINE },
  // The idle rule's one stored next-due time (server/scheduler.ts). An app table: no person's data.
  {
    version: 27,
    name: "scheduler_state",
    sql: "CREATE TABLE scheduler_state (id int NOT NULL PRIMARY KEY CHECK (id = 1), next_due datetime2(7) NOT NULL, updated_at datetime2(7) NOT NULL);",
  },
  // A4: the hosted app's data key, wrapped by the Key Vault key ft-data-key (host/azure/datakey.ts). An app table.
  {
    version: 28,
    name: "app_keys",
    sql: "CREATE TABLE app_keys (name nvarchar(64) NOT NULL PRIMARY KEY, value nvarchar(max) NOT NULL, created_at datetime2(7) NOT NULL);",
  },
  // E1 (D438): a feature's estimate in half blocks, 0.5 to 20 (whole blocks stay valid; nothing to convert). The user
  // tables' version 27, as SQLite's migration 27.
  {
    version: 29,
    name: "week_features.blocks in half blocks",
    sql: `ALTER TABLE week_features DROP CONSTRAINT week_features_blocks;
ALTER TABLE week_features ALTER COLUMN blocks decimal(3,1) NULL;
ALTER TABLE week_features ADD CONSTRAINT week_features_blocks CHECK (blocks IS NULL OR (blocks BETWEEN 0.5 AND 20 AND blocks * 2 = FLOOR(blocks * 2) AND level = 'feature'));`,
  },
  // E2 (D446): estimates in hours. A feature's estimate becomes minutes (whole hours, 1h to 80h), converted from blocks
  // (E1's half blocks, step 16.4's whole blocks) at 1 block = 4h to the nearest hour; blocks goes. A pick's size may be
  // empty (not sized yet). The user tables' version 28, as SQLite's migration 28. Statements naming the new column run
  // through EXEC so the batch compiles before it exists.
  {
    version: 30,
    name: "estimates in hours; picks may be unsized",
    count: { op: "convert_estimates", sql: "SELECT COUNT(*) AS n FROM week_features WHERE level = 'feature' AND blocks IS NOT NULL" },
    sql: `ALTER TABLE week_features ADD estimate int NULL;
EXEC(N'UPDATE week_features SET estimate = 60 * (CASE WHEN ROUND(blocks * 4, 0) < 1 THEN 1 WHEN ROUND(blocks * 4, 0) > 80 THEN 80 ELSE CAST(ROUND(blocks * 4, 0) AS int) END) WHERE level = ''feature'' AND blocks IS NOT NULL');
ALTER TABLE week_features DROP CONSTRAINT week_features_blocks;
ALTER TABLE week_features DROP COLUMN blocks;
EXEC(N'ALTER TABLE week_features ADD CONSTRAINT week_features_estimate CHECK (estimate IS NULL OR (estimate BETWEEN 60 AND 4800 AND estimate % 60 = 0 AND level = ''feature''))');
DECLARE @ck sysname = (SELECT cc.name FROM sys.check_constraints cc JOIN sys.columns c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id WHERE cc.parent_object_id = OBJECT_ID(N'picks') AND c.name = N'size');
DECLARE @drop nvarchar(400) = N'ALTER TABLE picks DROP CONSTRAINT ' + QUOTENAME(@ck);
IF @ck IS NOT NULL EXEC sp_executesql @drop;
ALTER TABLE picks ALTER COLUMN size nvarchar(1) NULL;
ALTER TABLE picks ADD CONSTRAINT picks_size CHECK (size IS NULL OR size IN ('S','M','L'));`,
  },
];

export const SQLSERVER_VERSION = SQLSERVER_MIGRATIONS[SQLSERVER_MIGRATIONS.length - 1]!.version;

const VERSION_TABLE = `IF OBJECT_ID(N'schema_version', N'U') IS NULL
  CREATE TABLE schema_version (version int NOT NULL PRIMARY KEY, name nvarchar(200) NOT NULL, applied_at datetime2(7) NOT NULL)`;

const NAMES = `IF OBJECT_ID(N'${NAMES_TABLE}', N'U') IS NULL
  CREATE TABLE ${NAMES_TABLE} (name nvarchar(200) NOT NULL PRIMARY KEY, applied_at datetime2(7) NOT NULL)`;

/** The timestamped migrations applied, by full name (S1, D458). */
export async function appliedNames(conn: SqlServerConn): Promise<Set<string>> {
  await conn.batch(NAMES);
  return new Set(((await conn.all(`SELECT name FROM ${NAMES_TABLE}`)) as { name: string }[]).map((r) => r.name));
}

/** The applied version (0 on an empty database). */
export async function sqlServerVersion(conn: SqlServerConn): Promise<number> {
  await conn.batch(VERSION_TABLE);
  const r = await conn.get("SELECT COALESCE(MAX(version), 0) AS v FROM schema_version");
  return Number(r?.v ?? 0);
}

/**
 * Brings the database to the newest version: the numbered migrations, then the timestamped ones in name order (D458).
 * Returns what it applied (versions, then names). A database newer than this build is refused (an older server against
 * a newer schema could lose columns it doesn't know).
 */
export async function migrateSqlServer(conn: SqlServerConn, o: { log?: Logger; migrations?: readonly SqlServerMigration[]; named?: readonly NamedMigration[] } = {}): Promise<(number | string)[]> {
  const list = o.migrations ?? SQLSERVER_MIGRATIONS;
  const newest = list[list.length - 1]!.version;
  const at = await sqlServerVersion(conn);
  if (at > newest) throw new Error(`The database is at schema version ${at}, newer than this build (${newest})`);
  const applied: (number | string)[] = [];
  for (const m of list) {
    if (m.version <= at) continue;
    await conn.tx(async () => {
      // A second server migrating at the same moment waits here, then sees the row and skips.
      const done = await conn.get("SELECT version FROM schema_version WITH (UPDLOCK, HOLDLOCK) WHERE version = ?", [m.version]);
      if (done) return;
      const n = m.count ? Number((await conn.get(m.count.sql))?.n ?? 0) : null;
      await conn.batch(m.sql);
      if (m.count && n !== null) o.log?.({ source: "database", op: m.count.op, count: n });
      await conn.run("INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, SYSUTCDATETIME())", [m.version, m.name]);
      applied.push(m.version);
    });
    o.log?.({ source: "database", op: "migrate", count: m.version });
  }
  // Timestamped migrations only on a database at the newest numbered version (a test can stop the numbered list early).
  if (!o.migrations || newest === SQLSERVER_VERSION) {
    const recorded = await appliedNames(conn);
    const newer = newerThanBuild(o.named ?? NAMED_MIGRATIONS, recorded);
    // D468: a newer database is fine (migrations only add): an older revision after a rollback runs on it.
    if (newer.length) o.log?.({ source: "database", op: "newer_schema", count: newer.length });
    // HK-3: a branch build's copy of a migration recorded under another timestamp: the build's own would fail on it.
    const renamed = renamedByBranch(o.named ?? NAMED_MIGRATIONS, recorded);
    for (const m of pending(o.named ?? NAMED_MIGRATIONS, recorded)) {
      await conn
        .tx(async () => {
          const done = await conn.get(`SELECT name FROM ${NAMES_TABLE} WITH (UPDLOCK, HOLDLOCK) WHERE name = ?`, [m.name]);
          if (done) return;
          await conn.batch(m.sqlserver);
          await conn.run(`INSERT INTO ${NAMES_TABLE} (name, applied_at) VALUES (?, SYSUTCDATETIME())`, [m.name]);
          applied.push(m.name);
        })
        .catch((e: unknown) => {
          if (!renamed.length) throw e;
          o.log?.({ source: "database", op: "branch_built", count: renamed.length });
          throw new Error(`${BRANCH_BUILT} (${renamed.map((r) => `${r.recorded} is ${r.build} here`).join(", ")})`);
        });
      o.log?.({ source: "database", op: "migrate_named", count: applied.length });
    }
  }
  if (applied.length) await conn.refreshCatalog();
  return applied;
}
