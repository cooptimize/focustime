// no-demo-leak: one source of truth per session. A real session gets its clients from Dataverse and its items from
// DevOps; a demo session gets only demo data. The demo is wired in one place: server/main.ts builds a demo session's
// context from server/demo.ts, which alone reads sources/demo/. Nothing else that runs (the server from
// server/main.ts, the page from ui/boot.ts) may import the demo, the fixtures, or a test fake.
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importsOf } from "./imports.ts";

const ROOT = resolve(import.meta.dirname, "..");
const ENTRIES = ["server/main.ts", "ui/boot.ts"];
/** Demo data, fixtures and fakes: never in a real session. */
const FORBIDDEN = /^(fixtures\/|sources\/demo\/|server\/demo\.ts$|host\/fakes\.ts$|test\/|e2e\/)|(^|\/)[a-z-]*fakes?\.ts$|\/fixtures\/|\.test\.tsx?$/;
/** The demo wiring: the only edges allowed into it. */
const WIRING: [RegExp, RegExp][] = [
  [/^server\/main\.ts$/, /^server\/demo\.ts$/],
  [/^server\/demo\.ts$/, /^sources\/demo\//],
  [/^sources\/demo\//, /^sources\/demo\//],
];
/** Development-only pages (left out of production builds behind import.meta.env.DEV): not walked. */
const DEV_ONLY = new Set(["ui/StyleGuide.tsx"]);

const resolveSpec = (from: string, spec: string): string | null => {
  const target = resolve(dirname(from), spec);
  for (const t of [target, `${target}.ts`, `${target}.tsx`]) if (existsSync(t) && !t.endsWith("/")) return t;
  return null;
};

/** Every runtime edge into demo data, a fixture or a fake that isn't the demo wiring, as "importer -> target". */
export function leaks(entries = ENTRIES, read = (f: string) => readFileSync(f, "utf8")): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const rel = relative(ROOT, file);
    for (const spec of importsOf(read(file))) {
      if (!spec.startsWith(".")) continue;
      const target = resolveSpec(file, spec);
      if (!target) continue;
      const r = relative(ROOT, target);
      if (DEV_ONLY.has(r)) continue;
      if (FORBIDDEN.test(r) && !WIRING.some(([a, b]) => a.test(rel) && b.test(r))) out.add(`${rel} -> ${r}`);
      if (/\.tsx?$/.test(r)) visit(target);
    }
  };
  for (const e of entries) visit(resolve(ROOT, e));
  return [...out].sort();
}

describe("no demo data, fixtures or fakes outside the demo wiring (no-demo-leak)", () => {
  it("nothing the server or the page runs imports them, except server/main.ts -> server/demo.ts -> sources/demo/", () => {
    expect(leaks()).toEqual([]);
  });
  it("the walk reaches the whole app (both entries, the actions, the sources)", () => {
    const seen: string[] = [];
    leaks(ENTRIES, (f) => (seen.push(relative(ROOT, f)), readFileSync(f, "utf8")));
    expect(seen).toEqual(expect.arrayContaining(["server/main.ts", "ui/boot.ts", "ui/main.tsx", "ui/App.tsx", "actions/dispatch.ts", "server/demo.ts", "ui/Settings.tsx"]));
    expect(seen.length).toBeGreaterThan(200);
  });
  it("catches a leak: any other file importing a fixture, the demo data or a fake", () => {
    const files: Record<string, string> = {
      [resolve(ROOT, "x/entry.ts")]: 'import "../ui/App.tsx";',
    };
    const real = (f: string) => files[f] ?? readFileSync(f, "utf8");
    expect(leaks(["x/entry.ts"], real)).toEqual([]);
    files[resolve(ROOT, "x/entry.ts")] = 'import { SAMPLE_WEEK } from "../fixtures/sample-week.ts";\nimport { DEMO_CONFIG } from "../sources/demo/data.ts";\nimport { memoryConfig } from "../host/fakes.ts";';
    expect(leaks(["x/entry.ts"], real)).toEqual(["x/entry.ts -> fixtures/sample-week.ts", "x/entry.ts -> host/fakes.ts", "x/entry.ts -> sources/demo/data.ts"]);
  });
  it("the style guide (fixture data) loads only in development builds", () => {
    const main = readFileSync(resolve(ROOT, "ui/main.tsx"), "utf8");
    expect(main).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\("\.\/StyleGuide\.tsx"\)/);
    expect(main).not.toMatch(/^import .*StyleGuide/m);
  });
  it("the product's starter settings name no clients", async () => {
    const { starterToml } = await import("../config/starter.ts");
    const { parseConfig } = await import("../config/schema.ts");
    const p = parseConfig(starterToml("UTC").replace('my_email = ""', 'my_email = "me@example.com"'));
    expect(p.ok && Object.keys(p.config.clientSettings)).toEqual([]);
  });
});
