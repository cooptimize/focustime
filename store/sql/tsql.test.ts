// A3: the store's SQL as SQL Server runs it (store/sql/tsql.ts). The store tests run every statement on a real SQL
// Server when the container is up; these pin the rewrites themselves, without one.
import { describe, expect, it } from "vitest";
import { toTsql, type Catalog, type TableInfo } from "./tsql.ts";

const table = (columns: Record<string, string>, key: string[], identity = false): TableInfo => ({ columns: new Map(Object.entries(columns)), key, identity });
const CATALOG: Catalog = new Map([
  ["kv", table({ user_id: "nvarchar", key: "nvarchar", value: "nvarchar", updated_at: "datetime2" }, ["user_id", "key"])],
  ["day_plans", table({ user_id: "nvarchar", date: "date", committed_at: "datetime2", created_at: "datetime2", updated_at: "datetime2" }, ["user_id", "date"])],
  ["picks", table({ user_id: "nvarchar", id: "int", date: "date", half: "nvarchar", position: "int", status: "nvarchar", updated_at: "datetime2" }, ["id"], true)],
  ["week_quiet", table({ user_id: "nvarchar", week_start: "date", client_key: "nvarchar", marked_at: "datetime2" }, ["user_id", "week_start", "client_key"])],
  ["resume_notes", table({ user_id: "nvarchar", id: "int", client_key: "nvarchar", date: "date", note: "nvarchar", updated_at: "datetime2" }, ["id"], true)],
  ["delivery_snapshots", table({ user_id: "nvarchar", client_key: "nvarchar", item_id: "int", date: "date", done: "int", open: "int" }, ["user_id", "client_key", "item_id", "date"])],
]);

describe("the store's SQL on SQL Server (A3)", () => {
  it("names the parameters and the person", () => {
    const t = toTsql("SELECT * FROM picks WHERE picks.user_id = $uid AND (date = ? AND half = ?)", CATALOG);
    expect(t.sql).toBe("SELECT * FROM picks WHERE picks.user_id = @uid AND (date = @p1 AND half = @p2)");
    expect(t.targets).toEqual(["date", "half"]);
    expect(t.table).toBe("picks");
  });

  it("knows which column each parameter goes to (so a stamp is sent as UTC to a datetime2)", () => {
    expect(toTsql("UPDATE picks SET status = ?, updated_at = ? WHERE picks.user_id = $uid AND (id = ?)", CATALOG).targets).toEqual(["status", "updated_at", "id"]);
    expect(toTsql("INSERT INTO picks (user_id, date, half, position, status, updated_at) VALUES ($uid, ?, ?, ?, 'planned', ?)", CATALOG).targets).toEqual(["date", "half", "position", "updated_at"]);
    expect(toTsql("SELECT * FROM picks WHERE id IN (?, ?) AND updated_at IS DISTINCT FROM ?", CATALOG).targets).toEqual(["id", "id", "updated_at"]);
  });

  it("returns a new identity after an insert, as SQLite's last insert id", () => {
    const t = toTsql("INSERT INTO picks (user_id, date, half, position, status, updated_at) VALUES ($uid, ?, ?, ?, 'planned', ?)", CATALOG);
    expect(t.returnsId).toBe(true);
    expect(t.sql).toMatch(/; SELECT CAST\(SCOPE_IDENTITY\(\) AS int\) AS id;$/);
    expect(toTsql("INSERT INTO kv (user_id, key, value, updated_at) VALUES ($uid, ?, ?, ?)", CATALOG).returnsId).toBe(false);
  });

  it("brackets the keywords the store uses as column names", () => {
    expect(toTsql("SELECT value FROM kv WHERE kv.user_id = $uid AND (key = ?)", CATALOG).sql).toBe("SELECT value FROM kv WHERE kv.user_id = @uid AND ([key] = @p1)");
    expect(toTsql("SELECT done, open FROM delivery_snapshots", CATALOG).sql).toBe("SELECT done, [open] FROM delivery_snapshots");
    // Not inside a string.
    expect(toTsql("SELECT 1 FROM kv WHERE value = 'key'", CATALOG).sql).toBe("SELECT 1 FROM kv WHERE value = 'key'");
  });

  it("takes a name that is already bracketed as it is", () => {
    expect(toTsql("SELECT value FROM kv WHERE [key] = ?", CATALOG).sql).toBe("SELECT value FROM kv WHERE [key] = @p1");
    expect(toTsql("SELECT [value] FROM kv", CATALOG).sql).toBe("SELECT [value] FROM kv");
  });

  it("turns an upsert into a MERGE on the conflict key, holding the key range", () => {
    const t = toTsql("INSERT INTO kv (user_id, key, value, updated_at) VALUES ($uid, ?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", CATALOG);
    expect(t.sql).toBe(
      "MERGE INTO kv WITH (HOLDLOCK) USING (SELECT @uid AS user_id, @p1 AS [key], @p2 AS value, @p3 AS updated_at) AS excluded ON kv.user_id = excluded.user_id AND kv.[key] = excluded.[key] WHEN MATCHED THEN UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHEN NOT MATCHED THEN INSERT (user_id, [key], value, updated_at) VALUES (excluded.user_id, excluded.[key], excluded.value, excluded.updated_at);",
    );
    expect(t.targets).toEqual(["key", "value", "updated_at"]);
  });

  it("an insert-if-missing without a named key uses the primary key, and a literal NULL gets its column's type", () => {
    expect(toTsql("INSERT INTO week_quiet (user_id, week_start, client_key, marked_at) VALUES ($uid, ?, ?, ?) ON CONFLICT DO NOTHING", CATALOG).sql).toBe(
      "MERGE INTO week_quiet WITH (HOLDLOCK) USING (SELECT @uid AS user_id, @p1 AS week_start, @p2 AS client_key, @p3 AS marked_at) AS excluded ON week_quiet.user_id = excluded.user_id AND week_quiet.week_start = excluded.week_start AND week_quiet.client_key = excluded.client_key WHEN NOT MATCHED THEN INSERT (user_id, week_start, client_key, marked_at) VALUES (excluded.user_id, excluded.week_start, excluded.client_key, excluded.marked_at);",
    );
    expect(toTsql("INSERT INTO day_plans (user_id, date, committed_at, created_at, updated_at) VALUES ($uid, ?, NULL, ?, ?) ON CONFLICT(user_id, date) DO NOTHING", CATALOG).sql).toContain("CAST(NULL AS datetime2(7)) AS committed_at");
  });

  it("an update may refer to the row it replaces, and || is +", () => {
    const t = toTsql("INSERT INTO resume_notes (user_id, client_key, date, note, updated_at) VALUES ($uid, ?, ?, ?, ?) ON CONFLICT(user_id, client_key, date) DO UPDATE SET note = resume_notes.note || ' · ' || excluded.note", CATALOG);
    expect(t.sql).toContain("WHEN MATCHED THEN UPDATE SET note = resume_notes.note + ' · ' + excluded.note");
  });

  it("LIMIT becomes TOP", () => {
    expect(toTsql("SELECT 1 FROM kv WHERE user_id = ? LIMIT 1", CATALOG).sql).toBe("SELECT TOP (1)  1 FROM kv WHERE user_id = @p1");
    expect(toTsql("SELECT DISTINCT date FROM picks ORDER BY date DESC LIMIT ?", CATALOG).sql).toBe("SELECT DISTINCT TOP (@p1)  date FROM picks ORDER BY date DESC");
  });
});
