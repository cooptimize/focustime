// Per-user scoping (A2): the one place the plan store adds the signed-in person to its SQL. Every statement the store
// prepares passes through scopeSql, which ties each user table it names to `user_id = $uid`:
//   - INSERT: user_id is the first column, $uid its value; an ON CONFLICT target gets user_id first (every natural key
//     and unique key is (user_id, ...) since migration 24).
//   - UPDATE and DELETE: `WHERE user_id = $uid AND (<the statement's own condition>)`, or a new WHERE.
//   - SELECT: the same on the FROM table (by its alias), and `AND <alias>.user_id = $uid` on every JOIN's ON.
// The store binds $uid from the session's user when it runs a statement; nothing else can supply it, and a statement
// the rewriter doesn't understand throws instead of running unscoped. store/scope.test.ts checks the rewrite and
// store/isolation.test.ts checks two people side by side across every table.

/** The plan store's per-user tables (inventory section 3). store/isolation.test.ts fails on a table missing here. */
export const USER_TABLES: readonly string[] = [
  "account_state", "ai_requests", "asks", "azure_write_log", "borrowed", "breakdown_marks", "captures", "chat_messages", "day_plans", "dedupe_log",
  "delivery_chats", "delivery_snapshots", "devops_identities", "devops_write_log", "draft_stories", "flex_sessions", "focus_log",
  "follow_ups", "invites", "kv", "markers", "notices", "outlook_events", "picks", "push_devices", "resume_notes", "roadmap_dates", "setup_state",
  "teams_status_log", "timeboxes", "unavailable", "user_secrets", "user_settings", "week_drafts", "week_feature_slots", "week_features",
  "week_plans", "week_quiet", "write_log",
];
const USER = new Set(USER_TABLES);

export class ScopeError extends Error {}

import type { Conn, Param, Row, RunResult, StatementContext } from "./sql/conn.ts";

/** Words that end a WHERE (or a FROM clause with no WHERE) at the top level of a statement. */
const CLAUSE_END = /\b(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|RETURNING|UNION|ON\s+CONFLICT)\b/i;

/** Index of the first top-level (paren depth 0) match of `re` in s from `from`, outside quotes; -1 when none. */
function topLevel(s: string, re: RegExp, from = 0): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0) {
      const m = re.exec(s.slice(i));
      if (m && m.index === 0 && (i === 0 || /\W/.test(s[i - 1]!))) return i;
    }
  }
  return -1;
}

const word = (w: string) => new RegExp(`^${w}\\b`, "i");

/** Adds `<col> = $uid` to the statement's top-level WHERE (wrapping the existing condition), or a new WHERE. */
function addWhere(sql: string, col: string, from: number): string {
  const where = topLevel(sql, word("WHERE"), from);
  const end = topLevel(sql, CLAUSE_END, where >= 0 ? where : from);
  const stop = end >= 0 ? end : sql.length;
  if (where >= 0) {
    const cond = sql.slice(where + 5, stop).trim();
    return `${sql.slice(0, where)}WHERE ${col} = $uid AND (${cond})${end >= 0 ? ` ${sql.slice(end)}` : ""}`;
  }
  const head = sql.slice(0, stop).trimEnd();
  return `${head} WHERE ${col} = $uid${end >= 0 ? ` ${sql.slice(end)}` : ""}`;
}

function scopeInsert(sql: string): string {
  const m = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(/i.exec(sql);
  if (!m) throw new ScopeError("Unscoped INSERT form");
  const table = m[1]!;
  if (!USER.has(table)) return sql;
  if (/\buser_id\b/i.test(m[2]!)) throw new ScopeError("The store sets user_id, not the statement");
  let out = sql.replace(m[0], m[0].replace(/\(\s*([^)]*)\)\s*VALUES\s*\($/i, (_x, cols: string) => `(user_id, ${cols.trim()}) VALUES ($uid, `));
  out = out.replace(/ON\s+CONFLICT\s*\(([^)]*)\)/i, (_x, cols: string) => `ON CONFLICT (user_id, ${cols.trim()})`);
  return out;
}

function scopeUpdateDelete(sql: string): string {
  const m = /^\s*(?:UPDATE\s+(\w+)\s+SET\b|DELETE\s+FROM\s+(\w+)\b)/i.exec(sql);
  if (!m) throw new ScopeError("Unscoped statement form");
  const table = (m[1] ?? m[2])!;
  if (!USER.has(table)) return sql;
  return addWhere(sql, "user_id", m[0].length);
}

function scopeSelect(sql: string): string {
  if (/\(\s*SELECT\b/i.test(sql)) throw new ScopeError("Subqueries aren't scoped; write them as joins");
  const from = topLevel(sql, word("FROM"));
  if (from < 0) return sql;
  const m = /^FROM\s+(\w+)(?:\s+(?!WHERE\b|ORDER\b|GROUP\b|LIMIT\b|LEFT\b|JOIN\b|INNER\b)(\w+))?/i.exec(sql.slice(from));
  if (!m) throw new ScopeError("Unscoped FROM form");
  const table = m[1]!;
  const alias = m[2] ?? table;
  let out = sql;
  // Each JOIN: the joined table's rows must be this person's too.
  const joins = [...out.matchAll(/\bJOIN\s+(\w+)(?:\s+(?!ON\b)(\w+))?\s+ON\b/gi)];
  for (const j of joins.reverse()) {
    if (!USER.has(j[1]!)) continue;
    const ja = j[2] ?? j[1]!;
    const onAt = j.index! + j[0].length;
    const next = topLevel(out, /\b(LEFT\s+JOIN|JOIN|INNER\s+JOIN|WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT)\b/i, onAt);
    const stop = next >= 0 ? next : out.length;
    out = `${out.slice(0, onAt)} (${out.slice(onAt, stop).trim()}) AND ${ja}.user_id = $uid ${out.slice(stop)}`;
  }
  if (!USER.has(table)) {
    if (joins.length) throw new ScopeError("A join from an app table into a user table");
    return out;
  }
  return addWhere(out, `${alias}.user_id`, from + m[0].length);
}

const cache = new Map<string, string>();

/** The statement with every user table it names tied to $uid. Statements on app tables come back unchanged. */
export function scopeSql(sql: string): string {
  const hit = cache.get(sql);
  if (hit !== undefined) return hit;
  const s = sql.trim();
  let out: string;
  if (/^INSERT\b/i.test(s)) out = scopeInsert(s);
  else if (/^(UPDATE|DELETE)\b/i.test(s)) out = scopeUpdateDelete(s);
  else if (/^SELECT\b/i.test(s)) out = scopeSelect(s);
    else throw new ScopeError("Unscoped statement form");
  // Belt and braces: a statement naming a user table must carry $uid once per table reference.
  const refs = [...out.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].filter((m) => USER.has(m[1]!)).length;
  const binds = (out.match(/\$uid\b/g) ?? []).length;
  if (refs > binds) throw new ScopeError("A user table without the user filter");
  cache.set(sql, out);
  return out;
}

/** The table a scoped SELECT reads from (its FROM), for the SQL Server driver's decoding of dates; null otherwise. */
export function readTable(sql: string): string | null {
  const s = sql.trim();
  if (!/^SELECT\b/i.test(s)) return null;
  const from = topLevel(s, word("FROM"));
  return from < 0 ? null : (/^FROM\s+(\w+)/i.exec(s.slice(from))?.[1] ?? null);
}

/** The part of a database the plan store uses, tied to one person. Positional parameters only. */
export type ScopedDb = {
  get(sql: string, ...params: Param[]): Promise<Row | undefined>;
  all(sql: string, ...params: Param[]): Promise<Row[]>;
  run(sql: string, ...params: Param[]): Promise<RunResult>;
  /** One transaction (joined when one is open already). */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  readonly conn: Conn;
};

/**
 * The database as one person sees it: every statement scoped (scopeSql) and $uid bound to `userId`, which comes from
 * the server's session (or a demo or test person), never from a request. `zone` is the person's time zone (the SQL
 * Server driver shows stored times in it, the way the store wrote them).
 */
export function scopedDb(conn: Conn, userId: string, zone?: () => string): ScopedDb {
  if (!userId) throw new ScopeError("A plan store needs a person");
  const ctx = (sql: string, scoped: string): StatementContext => {
    const c: StatementContext = { table: readTable(sql) };
    if (scoped.includes("$uid")) c.uid = userId;
    if (zone) c.zone = zone();
    return c;
  };
  const check = (p: Param[]) => {
    for (const v of p) if (v !== null && typeof v === "object") throw new ScopeError("Named parameters aren't allowed here");
    return p;
  };
  return {
    get(sql, ...p) {
      const scoped = scopeSql(sql);
      return conn.get(scoped, check(p), ctx(sql, scoped));
    },
    all(sql, ...p) {
      const scoped = scopeSql(sql);
      return conn.all(scoped, check(p), ctx(sql, scoped));
    },
    run(sql, ...p) {
      const scoped = scopeSql(sql);
      return conn.run(scoped, check(p), ctx(sql, scoped));
    },
    tx: (fn) => conn.tx(fn),
    conn,
  };
}
