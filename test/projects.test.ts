// BT-1: the SQL Server files, run in their own project under their own limit (vite.config.ts, test/workers.ts), are
// found by what they import, so a new store test is counted with no list to keep. Every file that can reach SQL Server
// through test/db.ts is in the set, and nothing under e2e/ is.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { sqlTestFiles } from "./projects.ts";

const ROOT = join(import.meta.dirname, "..");
const all = (readdirSync(ROOT, { recursive: true }) as string[])
  .map((f) => f.split(sep).join("/"))
  .filter((f) => f.endsWith(".test.ts") && !/(^|\/)(node_modules|\.git)\//.test(f) && !f.startsWith("e2e/"));

describe("the SQL Server files (BT-1)", () => {
  const sql = sqlTestFiles(ROOT);

  it("include the store isolation test and the store tests that run on both drivers", () => {
    expect(sql).toContain("store/isolation.test.ts");
    expect(sql).toContain("store/plan-store.test.ts");
    expect(sql.length).toBeGreaterThan(30);
  });

  it("include every file that uses SQL Server's helpers", () => {
    const users = all.filter((f) => /\b(forEachDriver|sqlServerDb|emptySqlServer)\(/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(users.filter((f) => !sql.includes(f))).toEqual([]);
  });

  it("include no browser file, and are paths from the root", () => {
    expect(sql.filter((f) => f.startsWith("e2e/") || f.startsWith("/") || f !== relative(ROOT, join(ROOT, f)))).toEqual([]);
  });
});
