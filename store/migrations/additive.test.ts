// D466: migrations only add (tables, columns, indexes). A rename or a drop ships in a later release than the code that
// stops using it, and its file says why with a "safe-drop: <reason>" comment, so rolling back to the previous revision
// is always safe against the current database. The numbered lists are frozen: every new change is a timestamped file.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../plan-store.ts";
import { SQLSERVER_VERSION } from "../sql/migrate.ts";
import { NAMED_MIGRATIONS } from "./index.ts";
import { NAME } from "./named.ts";

const DIR = import.meta.dirname;
/** Statements that take something away or rename it, in either dialect. */
const TAKES_AWAY = /\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|VIEW|TRIGGER|PROCEDURE|SCHEMA)\b|\bALTER\s+TABLE\s+\S+\s+DROP\b|\bRENAME\s+(TO|COLUMN)\b|\bsp_rename\b|\bTRUNCATE\s+TABLE\b/i;
const SAFE_DROP = /safe-drop:\s*\S/;

/** What a migration file does that isn't additive, unless it says why it is safe. */
export function notAdditive(source: string, sql: readonly string[]): string[] {
  if (SAFE_DROP.test(source)) return [];
  return sql.flatMap((s) => s.split(";").map((x) => x.trim()).filter((x) => TAKES_AWAY.test(x)).map((x) => x.replace(/\s+/g, " ").slice(0, 80)));
}

describe("migrations only add (D466)", () => {
  it("flags a drop or a rename, and lets one through only with a safe-drop reason", () => {
    expect(notAdditive("", ["CREATE TABLE a (x int)", "CREATE INDEX a_x ON a (x)", "ALTER TABLE a ADD y int"])).toEqual([]);
    expect(notAdditive("", ["ALTER TABLE a DROP COLUMN y"])).toHaveLength(1);
    expect(notAdditive("", ["DROP TABLE a"])).toHaveLength(1);
    expect(notAdditive("", ["ALTER TABLE a RENAME COLUMN x TO z"])).toHaveLength(1);
    expect(notAdditive("", ["EXEC sp_rename 'a.x', 'z', 'COLUMN'"])).toHaveLength(1);
    expect(notAdditive("// safe-drop: nothing reads a.y since #40 (two releases ago)", ["ALTER TABLE a DROP COLUMN y"])).toEqual([]);
    expect(notAdditive("// safe-drop:", ["DROP TABLE a"])).toHaveLength(1);
  });

  it("every timestamped migration only adds", () => {
    const files = readdirSync(DIR).filter((f) => NAME.test(f.replace(/\.ts$/, "")));
    expect(files.length).toBe(NAMED_MIGRATIONS.length);
    const problems = files.flatMap((f) => {
      const m = NAMED_MIGRATIONS.find((x) => `${x.name}.ts` === f);
      if (!m) return [`${f}: not listed in index.ts`];
      return notAdditive(readFileSync(join(DIR, f), "utf8"), [m.sqlite, m.sqlserver]).map((s) => `${f}: ${s}`);
    });
    expect(problems).toEqual([]);
  });

  it("the numbered migrations are frozen: a new change is a timestamped file", () => {
    expect(MIGRATIONS.length).toBe(28);
    expect(SQLSERVER_VERSION).toBe(30);
  });
});
