// A3: the SQL Server driver (Azure SQL in the hosted app, a local SQL Server container for development and tests), on
// the mssql package. The connection comes from the app config ([database]) only: the app's managed identity
// (DefaultAzureCredential, a token per connection, never stored) or, for the local container, a SQL login whose
// password is the host secret sql-password. Nothing here logs a connection string, a token or a password.
//
// - Statements: the store's SQL, translated (store/sql/tsql.ts). Parameters are typed from the catalog: a value for a
//   datetime2 column goes in as UTC (the store's stamps carry their zone), a date as a date.
// - Results: datetime2 values come back as the store wrote them (a zoned stamp in the person's zone, or an instant for
//   the columns that hold instants), dates as YYYY-MM-DD, bits as 0 and 1: the store's mappers don't change.
// - Transactions: carried through async calls (AsyncLocalStorage); one request at a time inside one.
// - Retries: transient errors (the Azure SQL list, a deadlock, a dropped connection) are retried after 5 s, then with
//   the wait doubling, for up to 60 s in all (Microsoft's guidance). A paused serverless database answers the first
//   login with 40613 while it resumes: the status is "waking" until a statement goes through, and the UI says
//   "Waking up the database".
// - Idle: the pool keeps no connection open for more than 30 s without use, so a serverless database with no one
//   signed in has no sessions and can pause.
import { AsyncLocalStorage } from "node:async_hooks";
import mssql from "mssql";
import type * as M from "mssql";
import type { Logger } from "../../log/logger.ts";
import type { Conn, Param, Row, RunResult, StatementContext } from "./conn.ts";
import { toTsql, type Catalog, type TableInfo } from "./tsql.ts";

export type SqlServerSettings = { server: string; port: number; database: string; auth: "entra" | "sql"; user: string | null; managedIdentityClientId: string | null; encrypt: boolean; trustServerCertificate: boolean };
/** The app config's [database] (server/appconfig.ts reads it): SQL Server, or the local SQLite file. */
export type DatabaseSettings = { driver: "sqlite" } | ({ driver: "sqlserver" } & SqlServerSettings);

/** What the UI shows about the database (A3: "Waking up the database" while a paused one resumes). */
export type DbStatus = "ok" | "waking" | "unavailable";

/** Transient errors (Azure SQL's documented list, plus a deadlock victim), by error number. */
export const TRANSIENT_NUMBERS: ReadonlySet<number> = new Set([926, 4060, 40197, 40501, 40613, 49918, 49919, 49920, 4221, 615, 1205]);
/** Driver codes for a connection that failed or dropped (retried like the numbers above). */
const TRANSIENT_CODES = new Set(["ESOCKET", "ECONNRESET", "ECONNCLOSED", "ETIMEOUT", "ENOTOPEN"]);
/** The waits between attempts: 5 s first, then doubling, 60 s in all at most. */
export const RETRY_WAITS_MS: readonly number[] = [5_000, 10_000, 20_000, 25_000];

const numberOf = (e: unknown): number | null => {
  for (let x: unknown = e, n = 0; x && typeof x === "object" && n < 4; n++) {
    const v = (x as { number?: unknown }).number;
    if (typeof v === "number") return v;
    x = (x as { originalError?: unknown; cause?: unknown }).originalError ?? (x as { cause?: unknown }).cause;
  }
  return null;
};
const codeOf = (e: unknown): string | null => {
  for (let x: unknown = e, n = 0; x && typeof x === "object" && n < 4; n++) {
    const v = (x as { code?: unknown }).code;
    if (typeof v === "string" && TRANSIENT_CODES.has(v)) return v;
    x = (x as { originalError?: unknown; cause?: unknown }).originalError ?? (x as { cause?: unknown }).cause;
  }
  return null;
};

/** Whether an error is worth retrying, and whether it means the database is resuming (or unreachable for now). */
export function transient(e: unknown): { retry: boolean; waking: boolean } {
  const n = numberOf(e);
  if (n !== null && TRANSIENT_NUMBERS.has(n)) return { retry: true, waking: n === 40613 || n === 4060 };
  if (codeOf(e)) return { retry: true, waking: true };
  return { retry: false, waking: false };
}

/** Runs `f`, retrying transient errors on the waits above; `status` hears "waking" while it waits, "ok" after. */
export async function withRetry<T>(f: () => Promise<T>, o: { sleep: (ms: number) => Promise<void>; status: (s: DbStatus) => void; log?: Logger; waits?: readonly number[] }): Promise<T> {
  const waits = o.waits ?? RETRY_WAITS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await f();
      if (attempt > 0) o.log?.({ source: "database", op: "retry", kind: "recovered", count: attempt });
      o.status("ok");
      return out;
    } catch (e) {
      const t = transient(e);
      if (!t.retry || attempt >= waits.length) {
        if (t.retry) o.status("unavailable");
        throw e;
      }
      if (t.waking) o.status("waking");
      o.log?.({ source: "database", op: "retry", kind: String(numberOf(e) ?? codeOf(e) ?? "transient"), count: attempt + 1 });
      await o.sleep(waits[attempt]!);
    }
  }
}

/** Formats of the datetime2 columns that hold instants (every other datetime2 column holds a zoned stamp). */
const INSTANT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  delivery_chats: ["members_fetched_at", "asks_since", "asks_seen_at", "asks_polled_at", "asks_retry_at"],
  chat_messages: ["created_at"],
  ai_requests: ["at"],
  devops_item_clients: ["seen_at"],
  asks: ["resolved_at", "created_at", "updated_at", "ai_at"],
  promises: ["resolved_at", "created_at", "updated_at"],
  focus_log: ["started_at", "ended_at"],
  timeboxes: ["removed_at"],
  user_settings: ["updated_at"],
  user_secrets: ["updated_at"],
};
/** App tables (no person, no zone): every datetime2 is an instant. */
const APP_TABLES = new Set(["users", "sessions", "auth_requests", "deletions", "schema_version", "scheduler_state", "app_keys", "ai_app_spend"]);

const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)(\[[^\]]+\])?$/;

/** A stamp as UTC text SQL Server reads into datetime2 (7 digits; Temporal keeps the nanoseconds). */
export function utcText(stamp: string): string {
  return Temporal.Instant.from(stamp).toString({ timeZone: "UTC", fractionalSecondDigits: 7 }).slice(0, 27);
}

/** A datetime2 read back (UTC, with tedious's sub-millisecond part) as an instant. */
function instantOf(d: Date): Temporal.Instant {
  const extra = Math.round(((d as Date & { nanosecondsDelta?: number }).nanosecondsDelta ?? 0) * 1e9);
  return Temporal.Instant.fromEpochNanoseconds(BigInt(d.getTime()) * 1_000_000n + BigInt(extra));
}

/** Shows a stored time the way the store wrote it. */
export function showTime(d: Date, table: string | null, column: string, zone: string | undefined): string {
  const i = instantOf(d);
  const instant = !zone || !table || APP_TABLES.has(table) || INSTANT_COLUMNS[table]?.includes(column);
  if (instant) return i.toString();
  const z = i.toZonedDateTimeISO(zone);
  return z.toString({ smallestUnit: z.nanosecond || z.microsecond || z.millisecond ? undefined : "second" });
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const dateText = (d: Date) => `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

type Decl = { declaration?: string };
function decode(rs: M.IRecordSet<Row> | undefined, table: string | null, zone: string | undefined): Row[] {
  if (!rs) return [];
  const kinds: [string, string][] = Object.values(rs.columns ?? {}).map((c) => [c.name, (c.type as Decl).declaration ?? ""]);
  const special = kinds.filter(([, k]) => k === "datetime2" || k === "date" || k === "bit" || k === "bigint");
  if (!special.length) return [...rs];
  return rs.map((r) => {
    const o: Row = { ...r };
    for (const [name, kind] of special) {
      const v = o[name];
      if (v === null || v === undefined) continue;
      if (kind === "datetime2" && v instanceof Date) o[name] = showTime(v, table, name, zone);
      else if (kind === "date" && v instanceof Date) o[name] = dateText(v);
      else if (kind === "bit") o[name] = v ? 1 : 0;
      else if (kind === "bigint" && typeof v === "string") o[name] = Number(v);
    }
    return o;
  });
}

/** The parameter's SQL type and value, from the column it goes to. */
function bind(req: M.Request, name: string, v: Param, colType: string | undefined): void {
  if (v === null) {
    req.input(name, colType === "datetime2" ? mssql.DateTime2(7) : colType === "int" ? mssql.Int : colType === "bit" ? mssql.Bit : mssql.NVarChar(4000), null);
  } else if (typeof v === "boolean") req.input(name, mssql.Bit, v);
  else if (typeof v === "number") req.input(name, Number.isInteger(v) ? (Math.abs(v) <= 2_147_483_647 ? mssql.Int : mssql.BigInt) : mssql.Float, v);
  // A stamp goes to a datetime2 as UTC; so does one whose column the statement doesn't name (COALESCE(x, ?), ...):
  // SQL Server can't read a zone name. A stamp for a text column (a timebox's start) stays the text it is.
  else if ((colType === "datetime2" || colType === undefined) && STAMP.test(v)) req.input(name, mssql.VarChar(27), utcText(v));
  else req.input(name, mssql.NVarChar(v.length > 4000 ? mssql.MAX : 4000), v);
}

/** Reads the tables, their column types, keys and identity columns (once, after the migrations). */
async function readCatalog(pool: M.ConnectionPool): Promise<Map<string, TableInfo>> {
  const cols = await new mssql.Request(pool).query<{ t: string; c: string; ty: string; id: number }>(
    "SELECT LOWER(t.name) AS t, LOWER(c.name) AS c, LOWER(ty.name) AS ty, CAST(c.is_identity AS int) AS id FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id",
  );
  const keys = await new mssql.Request(pool).query<{ t: string; c: string; k: number }>(
    "SELECT LOWER(t.name) AS t, LOWER(c.name) AS c, ic.key_ordinal AS k FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id JOIN sys.tables t ON t.object_id = i.object_id WHERE i.is_primary_key = 1 ORDER BY t.name, ic.key_ordinal",
  );
  const out = new Map<string, TableInfo>();
  for (const r of cols.recordset) {
    let t = out.get(r.t);
    if (!t) out.set(r.t, (t = { columns: new Map(), key: [], identity: false }));
    t.columns.set(r.c, r.ty);
    if (r.id) t.identity = true;
  }
  for (const r of keys.recordset) (out.get(r.t)!.key as string[]).push(r.c);
  return out;
}

export type SqlServerConn = Conn & {
  /** The database's state as the UI shows it. */
  status(): DbStatus;
  onStatus(f: (s: DbStatus) => void): () => void;
  /** Re-reads the catalog (after a migration). */
  refreshCatalog(): Promise<void>;
  /** A plain batch (migrations): no translation, no parameters. */
  batch(sql: string): Promise<void>;
};

export type SqlServerOptions = {
  settings: SqlServerSettings;
  /** The SQL login's password (auth "sql"): read when a connection opens, never kept. */
  password?: () => Promise<string>;
  /** Entra (auth "entra"): a TokenCredential; DefaultAzureCredential when absent. */
  credential?: unknown;
  log?: Logger;
  sleep?: (ms: number) => Promise<void>;
  /** Retry waits (tests shorten them). */
  waits?: readonly number[];
  /** Pool idle timeout (tests shorten it). */
  idleMs?: number;
};

async function poolConfig(o: SqlServerOptions): Promise<M.config> {
  const s = o.settings;
  const base: M.config = {
    server: s.server,
    port: s.port,
    database: s.database,
    pool: { max: 10, min: 0, idleTimeoutMillis: o.idleMs ?? 30_000 },
    options: { encrypt: s.encrypt, trustServerCertificate: s.trustServerCertificate, useUTC: true, appName: "FocusTime" },
    connectionTimeout: 30_000,
    requestTimeout: 30_000,
  };
  if (s.auth === "sql") {
    if (!o.password || !s.user) throw new Error("A SQL login needs a user and the sql-password secret");
    return { ...base, user: s.user, password: await o.password() };
  }
  let credential = o.credential;
  if (!credential) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    credential = new DefaultAzureCredential(s.managedIdentityClientId ? { managedIdentityClientId: s.managedIdentityClientId } : {});
  }
  return { ...base, authentication: { type: "token-credential", options: { credential } } };
}

/** Opens a pool on the database (connecting with the retry rule) and reads its catalog. */
export async function sqlServerConn(o: SqlServerOptions): Promise<SqlServerConn> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let state: DbStatus = "ok";
  const listeners = new Set<(s: DbStatus) => void>();
  const setStatus = (s: DbStatus) => {
    if (s === state) return;
    state = s;
    for (const f of listeners) f(s);
  };
  const retry = <T>(f: () => Promise<T>) => withRetry(f, { sleep, status: setStatus, ...(o.log ? { log: o.log } : {}), ...(o.waits ? { waits: o.waits } : {}) });
  let pool: M.ConnectionPool | null = null;
  const connect = async () => {
    if (pool?.connected) return pool;
    const p = new mssql.ConnectionPool(await poolConfig(o));
    p.on("error", () => o.log?.({ source: "database", op: "pool", kind: "error" }));
    await p.connect();
    pool = p;
    return p;
  };
  await retry(connect);
  let catalog: Catalog = await readCatalog(pool!);
  const inside = new AsyncLocalStorage<M.Transaction>();
  let statements = 0;

  const exec = async (sql: string, params: readonly Param[], ctx: StatementContext | undefined) => {
    const t = toTsql(sql, catalog);
    const info = t.table ? catalog.get(t.table) : undefined;
    const once = async () => {
      const tx = inside.getStore();
      const req = new mssql.Request(tx ?? (await connect()));
      params.forEach((v, i) => bind(req, `p${i + 1}`, v, t.targets[i] ? info?.columns.get(t.targets[i]!) : undefined));
      if (ctx?.uid !== undefined) req.input("uid", mssql.NVarChar(128), ctx.uid);
      statements++;
      // A SET lasts only for the request it is sent in, so IDENTITY_INSERT goes with the insert.
      const text = ctx?.keepIds && t.table && info?.identity ? `SET IDENTITY_INSERT ${t.table} ON; ${t.sql}${t.sql.trimEnd().endsWith(";") ? "" : ";"} SET IDENTITY_INSERT ${t.table} OFF;` : t.sql;
      return { t, r: await req.query<Row>(text) };
    };
    // Inside a transaction the whole transaction is retried (by tx), not one statement.
    return inside.getStore() ? once() : retry(once);
  };

  const conn: SqlServerConn = {
    dialect: "sqlserver",
    async all(sql, params = [], ctx) {
      const { t, r } = await exec(sql, params, ctx);
      return decode(r.recordset, ctx?.table ?? t.table, ctx?.zone);
    },
    async get(sql, params = [], ctx) {
      return (await conn.all(sql, params, ctx))[0];
    },
    async run(sql, params = [], ctx): Promise<RunResult> {
      const { t, r } = await exec(sql, params, ctx);
      const changes = r.rowsAffected.slice(0, 1).reduce((a, b) => a + b, 0);
      const id = t.returnsId ? (r.recordsets.at(-1)?.[0] as { id?: number | null } | undefined)?.id ?? null : null;
      return { changes, lastId: id };
    },
    tx<T>(fn: () => Promise<T>): Promise<T> {
      if (inside.getStore()) return fn();
      return retry(async () => {
        const tx = new mssql.Transaction(await connect());
        await tx.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED);
        statements++;
        try {
          const out = await inside.run(tx, fn);
          await tx.commit();
          return out;
        } catch (e) {
          await tx.rollback().catch(() => undefined);
          throw e;
        }
      });
    },
    inTx: () => !!inside.getStore(),
    get statements() {
      return statements;
    },
    status: () => state,
    onStatus(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    async refreshCatalog() {
      catalog = await readCatalog(await connect());
    },
    async batch(sql) {
      statements++;
      const tx = inside.getStore();
      await new mssql.Request(tx ?? (await connect())).batch(sql);
    },
    async close() {
      const p = pool;
      pool = null;
      await p?.close();
    },
  };
  return conn;
}
