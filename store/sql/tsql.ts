// A3: the plan store's SQL, written once, as SQL Server runs it. The store's statements use the common subset of SQLite
// and T-SQL; the few SQLite forms in it are rewritten here:
//   ?  and $uid                          -> @p1, @p2, ... and @uid
//   INSERT ... ON CONFLICT (k) DO ...     -> MERGE ... WITH (HOLDLOCK) (an upsert, or insert-if-missing)
//   ... LIMIT n                           -> SELECT TOP (n) ...
//   key, open, identity (T-SQL keywords as columns) -> [key], [open], [identity]
//   a || b                                -> a + b
// and an INSERT into a table with an identity id reports it (SCOPE_IDENTITY), as SQLite's lastInsertRowid does.
// Anything else the store writes must already be valid T-SQL (IS DISTINCT FROM, CASE, COALESCE, LOWER, COUNT, ...);
// store/sql/tsql.test.ts covers each rewrite; the store tests run every statement on SQL Server (test/db.ts).

/** What the translator knows about the schema (read from the database's catalog at open, store/sql/sqlserver.ts). */
export type TableInfo = {
  /** Column name -> SQL Server type name (datetime2, date, bit, int, nvarchar, ...). */
  columns: Map<string, string>;
  /** The primary key's columns, in order. */
  key: readonly string[];
  /** Whether the table has an identity column (its new id is returned after an insert). */
  identity: boolean;
};
export type Catalog = ReadonlyMap<string, TableInfo>;

/** The translated statement, and for each parameter (by position) the column it is compared with or written to. */
export type Translated = { sql: string; targets: (string | null)[]; table: string | null; returnsId: boolean };

const RESERVED = new Set(["key", "open", "identity"]);
/** A catalog type name as a CAST target. */
const SIZED: Record<string, string> = { nvarchar: "nvarchar(max)", varchar: "varchar(max)", datetime2: "datetime2(7)", char: "char(64)" };

type Tok = { t: "str" | "word" | "param" | "uid" | "punct" | "space"; v: string };

function tokenize(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out.push({ t: "str", v: sql.slice(i, j + 1) });
      i = j + 1;
    } else if (c === "[") {
      // An already bracketed name passes through as written (never bracketed twice).
      const j = sql.indexOf("]", i);
      out.push({ t: "str", v: sql.slice(i, j < 0 ? sql.length : j + 1) });
      i = j < 0 ? sql.length : j + 1;
    } else if (c === "?") {
      out.push({ t: "param", v: "?" });
      i++;
    } else if (c === "$" && sql.startsWith("$uid", i)) {
      out.push({ t: "uid", v: "$uid" });
      i += 4;
    } else if (/\s/.test(c)) {
      let j = i;
      while (j < sql.length && /\s/.test(sql[j]!)) j++;
      out.push({ t: "space", v: " " });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < sql.length && /[\w.]/.test(sql[j]!)) j++;
      out.push({ t: "word", v: sql.slice(i, j) });
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < sql.length && /[0-9.]/.test(sql[j]!)) j++;
      out.push({ t: "word", v: sql.slice(i, j) });
      i = j;
    } else {
      const two = sql.slice(i, i + 2);
      if (["<=", ">=", "<>", "!=", "||"].includes(two)) {
        // SQLite's string concatenation is T-SQL's +.
        out.push({ t: "punct", v: two === "||" ? "+" : two });
        i += 2;
      } else {
        out.push({ t: "punct", v: c });
        i++;
      }
    }
  }
  return out;
}

const text = (ts: readonly Tok[]) => ts.map((t) => t.v).join("").trim();
const isWord = (t: Tok | undefined, w: string) => !!t && t.t === "word" && t.v.toUpperCase() === w;
const solid = (ts: readonly Tok[]) => ts.filter((t) => t.t !== "space");

/** Splits tokens at top-level commas. */
function splitCommas(ts: readonly Tok[]): Tok[][] {
  const out: Tok[][] = [[]];
  let depth = 0;
  for (const t of ts) {
    if (t.v === "(") depth++;
    if (t.v === ")") depth--;
    if (t.v === "," && depth === 0) out.push([]);
    else out[out.length - 1]!.push(t);
  }
  return out;
}

/** Index of the bracket closing the one at i. */
function closeOf(ts: readonly Tok[], i: number): number {
  let depth = 0;
  for (let j = i; j < ts.length; j++) {
    if (ts[j]!.v === "(") depth++;
    if (ts[j]!.v === ")" && --depth === 0) return j;
  }
  throw new Error("Unbalanced brackets in a statement");
}

const bare = (col: string) => col.split(".").pop()!.toLowerCase();

/** Names the parameters and quotes the T-SQL keywords the store uses as column names. */
function rename(ts: Tok[]): { toks: Tok[]; count: number } {
  let n = 0;
  const toks = ts.map((t): Tok => {
    if (t.t === "param") return { t: "word", v: `@p${++n}` };
    if (t.t === "uid") return { t: "word", v: "@uid" };
    if (t.t === "word") {
      const parts = t.v.split(".");
      const last = parts[parts.length - 1]!;
      if (RESERVED.has(last.toLowerCase())) return { t: "word", v: [...parts.slice(0, -1), `[${last}]`].join(".") };
    }
    return t;
  });
  return { toks, count: n };
}

/** For each `?`, the column it is compared with or written to (null when the statement doesn't say). */
function paramTargets(ts: readonly Tok[]): (string | null)[] {
  const out: (string | null)[] = [];
  const s = ts;
  // INSERT INTO t (cols) VALUES (vals): each value that is a lone ? goes to its column.
  const firstSolid = solid(s);
  const insertCols = new Map<number, string>();
  if (isWord(firstSolid[0], "INSERT")) {
    const open1 = s.findIndex((t) => t.v === "(");
    const close1 = closeOf(s, open1);
    const cols = splitCommas(s.slice(open1 + 1, close1)).map((c) => text(c));
    const vIdx = s.findIndex((t, i) => i > close1 && isWord(t, "VALUES"));
    const open2 = s.findIndex((t, i) => i > vIdx && t.v === "(");
    const close2 = closeOf(s, open2);
    let pos = open2 + 1;
    splitCommas(s.slice(open2 + 1, close2)).forEach((item, k) => {
      const ps = item.map((t, j) => ({ t, j })).filter((x) => x.t.t === "param");
      if (ps.length === 1 && solid(item).length === 1) insertCols.set(pos + ps[0]!.j, cols[k]!);
      pos += item.length + 1;
    });
  }
  for (let i = 0; i < s.length; i++) {
    if (s[i]!.t !== "param") continue;
    if (insertCols.has(i)) {
      out.push(bare(insertCols.get(i)!));
      continue;
    }
    // <col> <op> ?  (=, <>, <, <=, >, >=, IS DISTINCT FROM, IS NOT DISTINCT FROM)
    const before = solid(s.slice(0, i)).slice(-5);
    const b = before.map((t) => t.v.toUpperCase());
    let col: string | null = null;
    const opAt = b.length - 1;
    if (["=", "<>", "!=", "<", "<=", ">", ">="].includes(b[opAt] ?? "") && before[opAt - 1]?.t === "word") col = before[opAt - 1]!.v;
    else if (b.slice(-3).join(" ") === "IS DISTINCT FROM" && before[opAt - 3]?.t === "word") col = before[opAt - 3]!.v;
    else if (b.slice(-4).join(" ") === "IS NOT DISTINCT FROM" && before[opAt - 4]?.t === "word") col = before[opAt - 4]!.v;
    else if (b[opAt] === "," || b[opAt] === "(") {
      // col IN (?, ?, ...)
      let j = i - 1;
      let depth = 0;
      while (j >= 0) {
        const v = s[j]!.v;
        if (v === ")") depth++;
        if (v === "(") {
          if (depth === 0) break;
          depth--;
        }
        j--;
      }
      const pre = solid(s.slice(0, j)).slice(-2);
      if (isWord(pre[1], "IN") && pre[0]?.t === "word") col = pre[0].v;
    }
    out.push(col && /^[A-Za-z_][\w.]*$/.test(col) && !/^(AND|OR|NOT|WHERE|SET|ON)$/i.test(col) ? bare(col) : null);
  }
  return out;
}

/** The table a statement writes to or reads from first. */
function tableOf(ts: readonly Tok[]): string | null {
  const s = solid(ts);
  const kw = (w: string) => s.findIndex((t) => isWord(t, w));
  if (isWord(s[0], "INSERT")) return s[kw("INTO") + 1]?.v ?? null;
  if (isWord(s[0], "UPDATE")) return s[1]?.v ?? null;
  if (isWord(s[0], "DELETE")) return s[kw("FROM") + 1]?.v ?? null;
  if (isWord(s[0], "SELECT")) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i]!.v === "(") depth++;
      if (s[i]!.v === ")") depth--;
      if (depth === 0 && isWord(s[i], "FROM")) return s[i + 1]?.v ?? null;
    }
  }
  return null;
}

function upsert(ts: Tok[], catalog: Catalog): Tok[] {
  // INSERT INTO t (cols) VALUES (vals) ON CONFLICT [(keys)] DO NOTHING | DO UPDATE SET ...
  const open1 = ts.findIndex((t) => t.v === "(");
  const table = solid(ts.slice(0, open1)).pop()!.v;
  const close1 = closeOf(ts, open1);
  const cols = splitCommas(ts.slice(open1 + 1, close1)).map((c) => text(c));
  const vIdx = ts.findIndex((t, i) => i > close1 && isWord(t, "VALUES"));
  const open2 = ts.findIndex((t, i) => i > vIdx && t.v === "(");
  const close2 = closeOf(ts, open2);
  const vals = splitCommas(ts.slice(open2 + 1, close2)).map((c) => text(c));
  const rest = ts.slice(close2 + 1);
  const r = solid(rest);
  if (!isWord(r[0], "ON") || !isWord(r[1], "CONFLICT")) throw new Error("Not an upsert");
  let k = 2;
  let keys: string[];
  if (r[k]?.v === "(") {
    const end = r.findIndex((t, i) => i > k && t.v === ")");
    keys = splitCommas(r.slice(k + 1, end)).map((c) => text(c));
    k = end + 1;
  } else {
    const info = catalog.get(table.toLowerCase());
    if (!info?.key.length) throw new Error(`No key to merge ${table} on`);
    keys = [...info.key];
  }
  if (!isWord(r[k], "DO")) throw new Error("Upsert without DO");
  const doNothing = isWord(r[k + 1], "NOTHING");
  const setAt = rest.findIndex((t) => isWord(t, "SET"));
  const assigns = doNothing ? "" : text(rest.slice(setAt + 1)).replace(/;$/, "");
  // A literal (NULL, 0, 'x') in the source gets its column's type: an untyped NULL is an int to SQL Server, and an int
  // doesn't go into a datetime2 column. Parameters are typed when they are bound.
  const info = catalog.get(table.toLowerCase());
  const typed = (v: string, c: string) => {
    if (v.startsWith("@")) return v;
    const ty = info?.columns.get(bare(c));
    return ty ? `CAST(${v} AS ${SIZED[ty] ?? ty})` : v;
  };
  const src = cols.map((c, i) => `${typed(vals[i]!, c)} AS ${c}`).join(", ");
  // The target keeps its own name (no alias), so an update may refer to it: SET note = resume_notes.note + ...
  const on = keys.map((c) => `${table}.${c} = excluded.${c}`).join(" AND ");
  const sql =
    `MERGE INTO ${table} WITH (HOLDLOCK) USING (SELECT ${src}) AS excluded ON ${on}` +
    (doNothing ? "" : ` WHEN MATCHED THEN UPDATE SET ${assigns}`) +
    ` WHEN NOT MATCHED THEN INSERT (${cols.join(", ")}) VALUES (${cols.map((c) => `excluded.${c}`).join(", ")});`;
  return tokenize(sql);
}

function limit(ts: Tok[]): Tok[] {
  const s = ts;
  // a top-level LIMIT x at the end
  let depth = 0;
  let at = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i]!.v === "(") depth++;
    if (s[i]!.v === ")") depth--;
    if (depth === 0 && isWord(s[i], "LIMIT")) at = i;
  }
  if (at < 0) return ts;
  const n = text(s.slice(at + 1));
  const head = s.slice(0, at);
  const sel = head.findIndex((t) => isWord(t, "SELECT"));
  const afterSel = solid(head.slice(sel + 1))[0];
  const insertAt = isWord(afterSel, "DISTINCT") ? head.indexOf(afterSel!) + 1 : sel + 1;
  return [...head.slice(0, insertAt), { t: "space", v: " " }, ...tokenize(`TOP (${n})`), { t: "space", v: " " }, ...head.slice(insertAt)];
}

/** The SQL Server form of a store statement. */
export function toTsql(sql: string, catalog: Catalog): Translated {
  const raw = tokenize(sql.trim().replace(/;\s*$/, ""));
  const targets = paramTargets(raw);
  const table = tableOf(raw)?.toLowerCase() ?? null;
  let { toks } = rename(raw);
  const s = solid(toks);
  const isInsert = isWord(s[0], "INSERT");
  if (isInsert && s.some((t, i) => isWord(t, "ON") && isWord(s[i + 1], "CONFLICT"))) toks = upsert(toks, catalog);
  if (isWord(s[0], "SELECT")) toks = limit(toks);
  const returnsId = isInsert && !!(table && catalog.get(table)?.identity);
  let out = text(toks);
  if (returnsId) out += `${out.endsWith(";") ? "" : ";"} SELECT CAST(SCOPE_IDENTITY() AS int) AS id;`;
  return { sql: out, targets, table, returnsId };
}
