// A3: the SQL Server migration runner. The baseline (store/sql/baseline.ts) is version 26, SQLite's 26 migrations
// folded into one schema; later changes are appended to SQLSERVER_MIGRATIONS (27: the scheduler's next-due time, an
// app table SQLite doesn't need: there it is kept in memory). Each migration runs in its own
// transaction and is recorded in schema_version in the same transaction, so a failure leaves the database at the
// version before it, and a re-run skips what is recorded (idempotent).

import type { Logger } from "../../log/logger.ts";
import { BASELINE, BASELINE_VERSION } from "./baseline.ts";
import type { SqlServerConn } from "./sqlserver.ts";

export type SqlServerMigration = { version: number; name: string; sql: string };

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
];

export const SQLSERVER_VERSION = SQLSERVER_MIGRATIONS[SQLSERVER_MIGRATIONS.length - 1]!.version;

const VERSION_TABLE = `IF OBJECT_ID(N'schema_version', N'U') IS NULL
  CREATE TABLE schema_version (version int NOT NULL PRIMARY KEY, name nvarchar(200) NOT NULL, applied_at datetime2(7) NOT NULL)`;

/** The applied version (0 on an empty database). */
export async function sqlServerVersion(conn: SqlServerConn): Promise<number> {
  await conn.batch(VERSION_TABLE);
  const r = await conn.get("SELECT COALESCE(MAX(version), 0) AS v FROM schema_version");
  return Number(r?.v ?? 0);
}

/**
 * Brings the database to the newest version. Returns the versions applied. A database newer than this build is
 * refused (an older server against a newer schema could lose columns it doesn't know).
 */
export async function migrateSqlServer(conn: SqlServerConn, o: { log?: Logger; migrations?: readonly SqlServerMigration[] } = {}): Promise<number[]> {
  const list = o.migrations ?? SQLSERVER_MIGRATIONS;
  const newest = list[list.length - 1]!.version;
  const at = await sqlServerVersion(conn);
  if (at > newest) throw new Error(`The database is at schema version ${at}, newer than this build (${newest})`);
  const applied: number[] = [];
  for (const m of list) {
    if (m.version <= at) continue;
    await conn.tx(async () => {
      // A second server migrating at the same moment waits here, then sees the row and skips.
      const done = await conn.get("SELECT version FROM schema_version WITH (UPDLOCK, HOLDLOCK) WHERE version = ?", [m.version]);
      if (done) return;
      await conn.batch(m.sql);
      await conn.run("INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, SYSUTCDATETIME())", [m.version, m.name]);
      applied.push(m.version);
    });
    o.log?.({ source: "database", op: "migrate", count: m.version });
  }
  if (applied.length) await conn.refreshCatalog();
  return applied;
}
