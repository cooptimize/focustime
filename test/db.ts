// A3: the databases store tests run on. SQLite always (in memory); SQL Server when the local container answers
// (npm run db:up) or CI provides one. Without one, the SQL Server tests are skipped and say so (once per file, on
// stderr, and as the skipped describe's name), never silently. Test-only.
//
// SQL Server: one database per test file (focustime_test_<pid>_<n>), migrated once; each open() empties every table
// (identities back to 1) so a test starts from an empty store, as an in-memory SQLite one does. Dropped at the end.
//
// Settings: FOCUSTIME_TEST_SQL_SERVER (default localhost), FOCUSTIME_TEST_SQL_PORT (14330, the compose file's),
// FOCUSTIME_TEST_SQL_USER (sa) and the password from FOCUSTIME_TEST_SQL_PASSWORD (CI), else this machine's keyring
// entry sql-password (what npm run db:up made). FOCUSTIME_TEST_SQL=off skips them; =required fails without a server.
import { execFile } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, describe } from "vitest";
import { openPlanDb } from "../store/plan-store.ts";
import type { Conn, Dialect } from "../store/sql/conn.ts";
import { migrateSqlServer } from "../store/sql/migrate.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { sqlServerConn, type SqlServerConn, type SqlServerSettings } from "../store/sql/sqlserver.ts";

export type TestDb = {
  driver: Dialect;
  conn: Conn;
  /** SQLite only: the raw database (tests of SQLite's own migrations and files). */
  raw: DatabaseSync | null;
  /** The store's tables (lower case, sorted). */
  tables(): Promise<string[]>;
};

const env = process.env;
const NOW = () => Temporal.Now.zonedDateTimeISO("UTC");

export const testSqlSettings = (database: string): SqlServerSettings => ({
  server: env.FOCUSTIME_TEST_SQL_SERVER ?? "localhost",
  port: Number(env.FOCUSTIME_TEST_SQL_PORT ?? 14330),
  database,
  auth: "sql",
  user: env.FOCUSTIME_TEST_SQL_USER ?? "sa",
  managedIdentityClientId: null,
  encrypt: true,
  trustServerCertificate: true,
});

/** The local container's password: CI's environment, else the keyring entry db:up made (never printed). */
export function testSqlPassword(): Promise<string | null> {
  if (env.FOCUSTIME_TEST_SQL_PASSWORD) return Promise.resolve(env.FOCUSTIME_TEST_SQL_PASSWORD);
  return new Promise((resolve) => {
    execFile("secret-tool", ["lookup", "service", "focustime", "account", "sql-password"], { timeout: 5_000, encoding: "utf8" }, (e, out) => resolve(e || !out ? null : out.replace(/\n$/, "")));
  });
}

/** Whether a SQL Server answers, and why not (for the skip message). */
async function probe(): Promise<{ ok: true; password: string } | { ok: false; why: string }> {
  if (env.FOCUSTIME_TEST_SQL === "off") return { ok: false, why: "FOCUSTIME_TEST_SQL=off" };
  const password = await testSqlPassword();
  const s = testSqlSettings("master");
  if (!password) return { ok: false, why: `no password (set FOCUSTIME_TEST_SQL_PASSWORD, or run npm run db:up)` };
  try {
    const c = await sqlServerConn({ settings: s, password: async () => password, waits: [] });
    await c.close();
    return { ok: true, password };
  } catch (e) {
    return { ok: false, why: `no SQL Server at ${s.server}:${s.port} (${(e as { code?: string }).code ?? "error"}; start it with npm run db:up)` };
  }
}

/** A SQL Server test's time limit: a round trip per statement, and the whole suite's files at once on one server. */
const SQL_TIMEOUT_MS = 30_000;

let probed: ReturnType<typeof probe> | null = null;
const available = () => (probed ??= probe());
let told = false;

export const sqliteDb = (): TestDb => {
  const raw = openPlanDb({ path: ":memory:", now: NOW });
  const conn = sqliteConn(raw);
  return {
    driver: "sqlite",
    conn,
    raw,
    tables: async () => (await conn.all("SELECT LOWER(name) AS name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => r.name as string),
  };
};

/** One SQL Server database for this test file, made on first use. */
let shared: Promise<{ admin: SqlServerConn; conn: SqlServerConn; name: string }> | null = null;
let serial = 0;
async function sqlServerDb(): Promise<TestDb> {
  const a = await available();
  if (!a.ok) throw new Error(`SQL Server isn't available: ${a.why}`);
  shared ??= (async () => {
    const name = `focustime_test_${process.pid}_${++serial}_${Date.now().toString(36)}`;
    const admin = await sqlServerConn({ settings: testSqlSettings("master"), password: async () => a.password, waits: [] });
    await admin.batch(`CREATE DATABASE [${name}]; ALTER DATABASE [${name}] SET READ_COMMITTED_SNAPSHOT ON;`);
    const conn = await sqlServerConn({ settings: testSqlSettings(name), password: async () => a.password, waits: [] });
    await migrateSqlServer(conn);
    return { admin, conn, name };
  })();
  const { conn } = await shared;
  await emptyAll(conn);
  return {
    driver: "sqlserver",
    conn,
    raw: null,
    tables: async () => (await conn.all("SELECT LOWER(name) AS name FROM sys.tables ORDER BY name")).map((r) => r.name as string),
  };
}

/** Every row out of every table but schema_version, identities back to 1. */
export async function emptyAll(conn: SqlServerConn): Promise<void> {
  const tables = (await conn.all("SELECT name, OBJECTPROPERTY(object_id, 'TableHasIdentity') AS ident FROM sys.tables WHERE name <> 'schema_version'")) as { name: string; ident: number }[];
  const off = tables.map((t) => `ALTER TABLE [${t.name}] NOCHECK CONSTRAINT ALL;`).join("\n");
  const del = tables.map((t) => `DELETE FROM [${t.name}];`).join("\n");
  // A table that never had a row starts at its seed; one that had rows starts at the reseed value plus one.
  const reseed = tables
    .filter((t) => t.ident)
    .map((t) => `IF EXISTS (SELECT 1 FROM sys.identity_columns WHERE object_id = OBJECT_ID(N'${t.name}') AND last_value IS NOT NULL) DBCC CHECKIDENT ('${t.name}', RESEED, 0) WITH NO_INFOMSGS;`)
    .join("\n");
  const on = tables.map((t) => `ALTER TABLE [${t.name}] WITH CHECK CHECK CONSTRAINT ALL;`).join("\n");
  await conn.batch(`${off}\n${del}\n${reseed}\n${on}`);
}

afterAll(async () => {
  if (!shared) return;
  const { admin, conn, name } = await shared;
  await conn.close();
  await admin.batch(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}];`).catch(() => undefined);
  await admin.close();
});

export type DriverCase = { driver: Dialect; open: () => Promise<TestDb> };

/**
 * Runs a describe block once per driver: SQLite, and SQL Server when one answers (else a skipped block whose name
 * says why, and a line on stderr). FOCUSTIME_TEST_SQL=required turns the skip into a failure (CI). `o.timeout` is each
 * test's limit on both drivers (SQL Server's is at least SQL_TIMEOUT_MS). HK-1: a `vi.setConfig` inside the body never
 * reached SQL Server's tests, whose describe option (30 s) wins over it.
 */
export async function forEachDriver(name: string, body: (d: DriverCase) => void, o: { timeout?: number } = {}): Promise<void> {
  describe(`${name} [sqlite]`, o.timeout ? { timeout: o.timeout } : {}, () => body({ driver: "sqlite", open: async () => sqliteDb() }));
  const a = await available();
  if (a.ok) {
    describe(`${name} [sqlserver]`, { timeout: Math.max(SQL_TIMEOUT_MS, o.timeout ?? 0) }, () => body({ driver: "sqlserver", open: sqlServerDb }));
    return;
  }
  if (env.FOCUSTIME_TEST_SQL === "required") throw new Error(`SQL Server is required for the store tests: ${a.why}`);
  if (!told) {
    told = true;
    process.stderr.write(`\nSQL Server store tests SKIPPED: ${a.why}\n`);
  }
  describe.skip(`${name} [sqlserver] SKIPPED: ${a.why}`, () => body({ driver: "sqlserver", open: sqlServerDb }));
}


/** users rows for people a test uses (SQL Server's per-person tables reference users; harmless on SQLite). */
export async function addUsers(conn: Conn, ...ids: string[]): Promise<void> {
  const at = "2026-11-02T14:30:00Z";
  for (const id of ids)
    await conn.run("INSERT INTO users (id, tenant_id, upn, display_name, email, time_zone, created_at, last_sign_in_at) VALUES (?, 't', ?, ?, NULL, NULL, ?, ?)", [id, `${id}@example.com`, id, at, at]);
}

/** An empty SQL Server database of its own (no migration run), and its drop. For the migration tests. */
export async function emptySqlServer(): Promise<{ conn: SqlServerConn; drop: () => Promise<void> }> {
  const a = await available();
  if (!a.ok) throw new Error(`SQL Server isn't available: ${a.why}`);
  const name = `focustime_test_${process.pid}_${++serial}_${Date.now().toString(36)}`;
  const admin = await sqlServerConn({ settings: testSqlSettings("master"), password: async () => a.password, waits: [] });
  await admin.batch(`CREATE DATABASE [${name}];`);
  const conn = await sqlServerConn({ settings: testSqlSettings(name), password: async () => a.password, waits: [] });
  return {
    conn,
    drop: async () => {
      await conn.close();
      await admin.batch(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}];`).catch(() => undefined);
      await admin.close();
    },
  };
}

/** A describe block that needs SQL Server: run, or skipped with the reason (failing under FOCUSTIME_TEST_SQL=required). */
export async function onSqlServer(name: string, body: () => void): Promise<void> {
  const a = await available();
  if (a.ok) return void describe(`${name} [sqlserver]`, { timeout: SQL_TIMEOUT_MS }, body);
  if (env.FOCUSTIME_TEST_SQL === "required") throw new Error(`SQL Server is required for the store tests: ${a.why}`);
  describe.skip(`${name} [sqlserver] SKIPPED: ${a.why}`, body);
}
