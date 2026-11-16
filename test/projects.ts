// BT-1: which test files use SQL Server, for their own vitest project and worker limit (test/workers.ts). A file uses
// it when it imports test/db.ts (forEachDriver, sqlServerDb, emptySqlServer): every store test that runs against SQL
// Server does. Read from the files themselves each run, so a new store test is counted without a list to keep.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP = new Set(["node_modules", ".git", "e2e", "dist", "screenshots"]);
const IMPORTS_DB = /from\s+["'](?:\.\.\/)+test\/db\.ts["']|from\s+["']\.\/db\.ts["']/;

/** Every *.test.ts outside e2e/ that imports test/db.ts, as paths relative to the root ("store/isolation.test.ts"). */
export function sqlTestFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(join(dir, e.name));
      } else if (e.name.endsWith(".test.ts")) {
        const p = join(dir, e.name);
        if (IMPORTS_DB.test(readFileSync(p, "utf8"))) out.push(relative(root, p).split(sep).join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}
