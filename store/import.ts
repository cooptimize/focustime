// A3: loads one person's export (Settings > Data > Export my data, or focustime export-local) into a store, for one
// user id: the developer's move from the local SQLite store to SQL Server (A5), and anyone moving between environments.
//
// - Idempotent on ids: a row whose key is already there for this person is left as it is; running it twice adds
//   nothing the second time. A row whose id belongs to someone else is refused (ids are kept as they were, so two
//   stores' ids can meet; remapping them is not done here).
// - All or nothing: one transaction; parents first (store/user-data.ts PARENTS_FIRST), and the links within a table
//   (a pick carried from another, an undo of a write) filled in after every row is there.
// - The person's users row is made from the export when it isn't there yet (their id is the one given).
// - Never a secret: an export has none, and user_secrets is refused if a file has it.
// - Dry run: the same checks and counts, nothing written.
import type { Conn, Param, Row } from "./sql/conn.ts";
import { EXPORT_FORMAT, NOT_EXPORTED, PARENTS_FIRST, USER_SCHEMA_VERSION } from "./user-data.ts";

export class ImportRefused extends Error {}

export type TableCount = { table: string; inFile: number; present: number; added: number };
export type ImportReport = { dryRun: boolean; userCreated: boolean; tables: TableCount[] };

/** Links inside one table, filled in after its rows are in (the referenced row may come later in the file). */
const SELF_LINKS: Readonly<Record<string, readonly string[]>> = {
  picks: ["carried_from"],
  devops_write_log: ["undo_of", "undone_by"],
  write_log: ["undo_of", "undone_by"],
};

type Export = { format: string; schemaVersion: number; you?: Record<string, unknown>; tables: Record<string, Row[]> };

function parse(json: unknown): Export {
  const e = json as Partial<Export> | null;
  if (!e || typeof e !== "object" || e.format !== EXPORT_FORMAT) throw new ImportRefused(`Not a FocusTime export (format ${String(e?.format)})`);
  if (e.schemaVersion !== USER_SCHEMA_VERSION) throw new ImportRefused(`This export is schema version ${String(e.schemaVersion)}; this FocusTime reads ${USER_SCHEMA_VERSION}`);
  if (!e.tables || typeof e.tables !== "object") throw new ImportRefused("The export has no tables");
  for (const t of Object.keys(e.tables)) {
    if (NOT_EXPORTED.includes(t)) throw new ImportRefused(`The export has ${t}; secrets are never imported`);
    if (!PARENTS_FIRST.includes(t)) throw new ImportRefused(`Unknown table in the export: ${t}`);
    if (!Array.isArray(e.tables[t])) throw new ImportRefused(`${t} is not a list of rows`);
  }
  return e as Export;
}

/** A table's columns and primary key, from the database's own catalog. */
async function shape(conn: Conn, table: string): Promise<{ columns: Set<string>; key: string[]; identity: boolean }> {
  if (conn.dialect === "sqlite") {
    const cols = (await conn.all("SELECT name, pk FROM pragma_table_info(?)", [table])) as { name: string; pk: number }[];
    const key = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    return { columns: new Set(cols.map((c) => c.name)), key, identity: key.length === 1 && key[0] === "id" };
  }
  const cols = await conn.all("SELECT LOWER(c.name) AS name, c.is_identity AS ident FROM sys.columns c WHERE c.object_id = OBJECT_ID(?)", [table]);
  const key = await conn.all(
    "SELECT LOWER(COL_NAME(ic.object_id, ic.column_id)) AS name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id WHERE i.object_id = OBJECT_ID(?) AND i.is_primary_key = 1 ORDER BY ic.key_ordinal",
    [table],
  );
  return { columns: new Set(cols.map((c) => c.name as string)), key: key.map((k) => k.name as string), identity: cols.some((c) => !!c.ident) };
}

const value = (v: unknown): Param => (v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : (v as Param));

export async function importUser(conn: Conn, userId: string, json: unknown, o: { dryRun: boolean; now: () => Temporal.Instant }): Promise<ImportReport> {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new ImportRefused("The user id must be the person's Entra object id");
  const e = parse(json);
  const run = async (): Promise<ImportReport> => {
    const report: ImportReport = { dryRun: o.dryRun, userCreated: false, tables: [] };
    // The users row: theirs, or made from the export.
    if (!(await conn.get("SELECT id FROM users WHERE id = ?", [userId]))) {
      const y = e.you ?? {};
      const at = o.now().toString();
      if (!o.dryRun)
        await conn.run("INSERT INTO users (id, tenant_id, upn, display_name, email, time_zone, created_at, last_sign_in_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
          userId,
          String(y.tenantId ?? ""),
          String(y.upn ?? ""),
          String(y.displayName ?? ""),
          (y.email as string | null) ?? null,
          (y.timeZone as string | null) ?? null,
          (y.createdAt as string | undefined) ?? at,
          (y.lastSignInAt as string | undefined) ?? at,
        ]);
      report.userCreated = true;
    }
    const links: { table: string; key: string[]; row: Row }[] = [];
    for (const table of PARENTS_FIRST) {
      const rows = e.tables[table];
      if (!rows) continue;
      const s = await shape(conn, table);
      const count: TableCount = { table, inFile: rows.length, present: 0, added: 0 };
      const self = SELF_LINKS[table] ?? [];
      for (const row of rows) {
        const cols = Object.keys(row);
        for (const c of cols) if (c === "user_id" || !s.columns.has(c)) throw new ImportRefused(`${table}: unknown column ${c}`);
        for (const k of s.key) if (k !== "user_id" && !(k in row)) throw new ImportRefused(`${table}: a row without its ${k}`);
        // Already there? By key: an id is global, a natural key is this person's.
        const keyCols = s.key.filter((k) => k !== "user_id");
        const where = keyCols.map((k) => `${k} = ?`).join(" AND ");
        const global = !s.key.includes("user_id");
        const found = (await conn.get(`SELECT user_id FROM ${table} WHERE ${where}${global ? "" : " AND user_id = ?"}`, [...keyCols.map((k) => value(row[k])), ...(global ? [] : [userId])])) as { user_id: string } | undefined;
        if (found && found.user_id !== userId) throw new ImportRefused(`${table} ${keyCols.map((k) => String(row[k])).join("/")} belongs to someone else in this database; nothing was imported`);
        if (found) {
          count.present++;
          continue;
        }
        count.added++;
        if (o.dryRun) continue;
        const put = cols.map((c) => (self.includes(c) ? null : value(row[c])));
        await conn.run(`INSERT INTO ${table} (user_id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`, [userId, ...put], { keepIds: true });
        if (self.some((c) => row[c] !== null && row[c] !== undefined)) links.push({ table, key: keyCols, row });
      }
      report.tables.push(count);
    }
    for (const l of links) {
      const cols = (SELF_LINKS[l.table] ?? []).filter((c) => l.row[c] !== null && l.row[c] !== undefined);
      await conn.run(`UPDATE ${l.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE user_id = ? AND ${l.key.map((k) => `${k} = ?`).join(" AND ")}`, [
        ...cols.map((c) => value(l.row[c])),
        userId,
        ...l.key.map((k) => value(l.row[k])),
      ]);
    }
    return report;
  };
  return o.dryRun ? run() : conn.tx(run);
}

/** Rows per user table for one person (the counts compared before a switch). */
export async function countRows(conn: Conn, userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of PARENTS_FIRST) out[t] = Number((await conn.get(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, [userId]))?.n ?? 0);
  return out;
}
