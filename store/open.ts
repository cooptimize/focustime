// A3: opens the plan store's database from the app config's [database] (never per person). SQL Server is the store
// (Azure SQL with the app's managed identity, or the local container with a SQL login whose password is the host
// secret sql-password); SQLite is the local file, kept as the fallback and for the demo.

import type { Logger } from "../log/logger.ts";
import type { StoreFiles } from "../host/types.ts";
import { openPlanDb, sqliteBackup } from "./plan-store.ts";
import type { Conn } from "./sql/conn.ts";
import { sqliteConn } from "./sql/sqlite.ts";
import { sqlServerConn, type DatabaseSettings, type DbStatus, type SqlServerConn } from "./sql/sqlserver.ts";
import { migrateSqlServer } from "./sql/migrate.ts";

/** The config can't open a store (a message for the console; it never holds a password or token). */
export class StoreConfigError extends Error {}

export type OpenedStore = {
  conn: Conn;
  /** SQLite only: a copy of the file (Reset local plan). */
  backup?: (to: string) => Promise<void>;
  /** SQL Server only: the database's state as the UI shows it ("waking" while a paused database resumes). */
  status?: () => DbStatus;
  onStatus?: (f: (s: DbStatus) => void) => () => void;
  close(): Promise<void>;
};

export type OpenStoreOptions = {
  sqlitePath: string;
  now: () => Temporal.ZonedDateTime;
  log?: Logger;
  files?: StoreFiles;
  /** The SQL login's password, read when a connection opens (auth "sql"). */
  password?: () => Promise<string>;
  /** Tests: a TokenCredential, shorter retry waits and pool idle time. */
  credential?: unknown;
  waits?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  idleMs?: number;
};

export async function openStore(settings: DatabaseSettings, o: OpenStoreOptions): Promise<OpenedStore> {
  if (settings.driver === "sqlite") {
    const raw = openPlanDb({ path: o.sqlitePath, now: o.now, ...(o.log ? { log: o.log } : {}), ...(o.files ? { files: o.files } : {}) });
    const conn = sqliteConn(raw);
    return { conn, backup: sqliteBackup(raw, o.files), close: () => conn.close() };
  }
  if (settings.auth === "sql" && !o.password) throw new StoreConfigError("The [database] SQL login needs the sql-password secret (focustime-secrets set sql-password)");
  let conn: SqlServerConn;
  try {
    conn = await sqlServerConn({
      settings,
      ...(o.password ? { password: o.password } : {}),
      ...(o.credential ? { credential: o.credential } : {}),
      ...(o.log ? { log: o.log } : {}),
      ...(o.waits ? { waits: o.waits } : {}),
      ...(o.sleep ? { sleep: o.sleep } : {}),
      ...(o.idleMs !== undefined ? { idleMs: o.idleMs } : {}),
    });
  } catch (e) {
    // The driver's messages name the server and the login, never the password or a token.
    throw new StoreConfigError(`FocusTime couldn't connect to ${settings.server}:${settings.port}/${settings.database}: ${e instanceof Error ? e.message : String(e)}`);
  }
  await migrateSqlServer(conn, o.log ? { log: o.log } : {});
  return { conn, status: () => conn.status(), onStatus: (f) => conn.onStatus(f), close: () => conn.close() };
}
