// AS-1: the image removes ui/, e2e/, test/ and docs/ after the build (Dockerfile), so nothing the server loads may
// import from them; a missed one crashes the hosted app at start (the CI image smoke test caught one). This walks the
// server's imports from server/main.ts (types erased at runtime are skipped) and checks none lands there.
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const NOT_SHIPPED = ["ui", "e2e", "test", "docs"];

it("nothing the server loads imports ui/, e2e/, test/ or docs/", () => {
  const seen = new Set<string>();
  const bad: string[] = [];
  const todo = [resolve(ROOT, "server/main.ts")];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:^|\n)\s*(import|export)(\s+type)?[^"';]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      if (m[2]) continue;
      const spec = m[3] ?? m[4]!;
      if (!spec.startsWith(".")) continue;
      const to = resolve(f, "..", spec);
      const top = relative(ROOT, to).split(/[\\/]/)[0]!;
      if (NOT_SHIPPED.includes(top)) bad.push(`${relative(ROOT, f)} → ${spec}`);
      else if (existsSync(to) && /\.tsx?$/.test(to)) todo.push(to);
    }
  }
  expect(seen.size).toBeGreaterThan(50);
  expect(bad).toEqual([]);
});
