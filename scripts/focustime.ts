#!/usr/bin/env node
// A3: the focustime command (developer and operator tasks; the app itself starts with the service).
//
//   focustime export-local [--out <file>] [--user <id>]
//       The local SQLite store (plan.db) as one person's export JSON (the same as Settings > Data > Export my data).
//       Opened read-only, never migrated. Without --out, the JSON goes to stdout.
//   focustime import --file <export.json> --user <oid> [--dry-run]
//       Loads an export into the SQL Server database named by the app config's [database] (or FOCUSTIME_DB_*), for
//       that person: ids kept, rows already there left as they are, all in one transaction. --dry-run prints the
//       counts and writes nothing.
//   focustime counts --user <oid> [--sqlite]
//       Rows per table for one person: the SQL Server database (or, with --sqlite, plan.db read-only).
//   focustime migrate
//       Brings the SQL Server database to this build's schema version (npm run db:migrate).
//
// The SQL login's password comes from the keyring (sql-password) or FOCUSTIME_SQL_PASSWORD, never from the command
// line; it is never printed.
import { statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { getSecret } from "../host/local/keyring.ts";
import { localPaths } from "../host/local/paths.ts";
import { readAppSettings } from "../server/appconfig.ts";
import { exportLocal } from "../store/export-local.ts";
import { countRows, importUser } from "../store/import.ts";
import { openStore } from "../store/open.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";

const USAGE = `Usage:
  focustime export-local [--out <file>] [--user <id>]
  focustime import --file <export.json> --user <oid> [--dry-run]
  focustime counts --user <oid> [--sqlite]
  focustime migrate`;

const fail = (msg: string): never => {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
};

const [cmd, ...rest] = process.argv.slice(2);
const { values: a } = parseArgs({
  args: rest,
  options: { out: { type: "string" }, user: { type: "string" }, file: { type: "string" }, "dry-run": { type: "boolean" }, sqlite: { type: "boolean" } },
  strict: true,
});
const paths = localPaths();
const now = () => Temporal.Now.instant();

/** The SQL Server database from the app config; SQLite is refused (that is plan.db, which this never writes). */
async function sqlServer() {
  const text = await readFile(join(dirname(paths.config), "app.toml"), "utf8").catch(() => null);
  const r = readAppSettings(process.env, text, "http://localhost:4817");
  if (!r.ok) return fail(r.errors.join("\n"));
  const db = r.settings.database;
  if (db.driver !== "sqlserver") return fail("The app config's [database] is the SQLite file. Name the SQL Server database ([database] in app.toml, or FOCUSTIME_DB_DRIVER=sqlserver and the other FOCUSTIME_DB_* settings).");
  const password = async () => process.env.FOCUSTIME_SQL_PASSWORD || (await getSecret("sql-password"));
  return openStore(db, { sqlitePath: paths.planDb, now: () => Temporal.Now.zonedDateTimeISO(), password, log: () => {} });
}

/**
 * plan.db, read-only. With no write-ahead log waiting (the service stopped), as immutable: SQLite then makes no -wal or
 * -shm file beside it, so the folder is left exactly as it was. Otherwise read-only as usual (which reads the log).
 */
function openLocal(): DatabaseSync {
  let wal = 0;
  try {
    wal = statSync(`${paths.planDb}-wal`).size;
  } catch {
    wal = 0;
  }
  try {
    if (wal > 0) {
      process.stderr.write("The store has unsaved changes in its log (is the focustime service running?). Reading it as is; stop the service for an exact copy.\n");
      return new DatabaseSync(paths.planDb, { readOnly: true });
    }
    const url = pathToFileURL(paths.planDb);
    url.search = "?mode=ro&immutable=1";
    return new DatabaseSync(url, { readOnly: true });
  } catch {
    return fail(`Can't open ${paths.planDb} to read`);
  }
}

const table = (rows: Record<string, string | number>[]) => {
  const keys = Object.keys(rows[0] ?? {});
  const w = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k]).length)));
  const line = (vals: string[]) => vals.map((v, i) => (i === 0 ? v.padEnd(w[i]!) : v.padStart(w[i]!))).join("  ");
  return [line(keys), ...rows.map((r) => line(keys.map((k) => String(r[k]))))].join("\n");
};

switch (cmd) {
  case "export-local": {
    const { userId, json } = await exportLocal(openLocal(), { ...(a.user ? { userId: a.user } : {}), now: now() }).catch((e: Error) => fail(e.message));
    const text = JSON.stringify(json, null, 2) + "\n";
    if (a.out) {
      await writeFile(a.out, text, { mode: 0o600 });
      process.stderr.write(`Exported ${userId}'s plan to ${a.out}\n`);
    } else process.stdout.write(text);
    break;
  }
  case "import": {
    if (!a.file || !a.user) fail(USAGE);
    const json = JSON.parse(await readFile(a.file!, "utf8")) as unknown;
    const store = await sqlServer();
    try {
      const r = await importUser(store.conn, a.user!, json, { dryRun: !!a["dry-run"], now });
      process.stdout.write(`${r.dryRun ? "Dry run: nothing written.\n" : ""}${r.userCreated ? "The person is new to this database.\n" : ""}`);
      process.stdout.write(table(r.tables.map((t) => ({ table: t.table, "in file": t.inFile, "already there": t.present, [r.dryRun ? "would add" : "added"]: t.added }))) + "\n");
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      await store.close();
    }
    break;
  }
  case "counts": {
    if (!a.user) fail(USAGE);
    if (a.sqlite) {
      const raw = openLocal();
      const c = await countRows(sqliteConn(raw), a.user!);
      raw.close();
      process.stdout.write(table(Object.entries(c).map(([t, n]) => ({ table: t, rows: n }))) + "\n");
    } else {
      const store = await sqlServer();
      const c = await countRows(store.conn, a.user!);
      await store.close();
      process.stdout.write(table(Object.entries(c).map(([t, n]) => ({ table: t, rows: n }))) + "\n");
    }
    break;
  }
  case "migrate": {
    // Opening the store migrates it (store/open.ts).
    const store = await sqlServer();
    const v = await store.conn.get("SELECT MAX(version) AS v FROM schema_version");
    await store.close();
    process.stdout.write(`The database is at schema version ${String(v?.v)}\n`);
    break;
  }
  default:
    fail(USAGE);
}
