// RB-3: nothing the lookup reads reaches an AI or the assistant. The names and a file's pages or measures live only in
// the box's memory (ui/WhereLookup.tsx); the assistant has no action that reads code; and a pick is only the box's text,
// which travels as that box's text did before (a draft's stored answers never go to an AI: actions/draft-prepare.ts
// sends the capture's own words).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../assistant/allowlist.ts";

const root = resolve(import.meta.dirname, "..");
const src = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("RB-3: the lookup never reaches an AI or the assistant", () => {
  it("the assistant has no action that reads code, and no tool for the lookup", () => {
    const actions = Object.values(TOOLS).flatMap((t) => [...t.actions]);
    expect(actions.filter((a) => a.startsWith("code."))).toEqual([]);
    expect(JSON.stringify(TOOLS)).not.toMatch(/where_lookup|whereLookup|code\.kinds|code\.file/);
  });
  it("the box reaches the server only through code.kinds and code.inner, never ai/ or the assistant", () => {
    const box = src("ui/WhereLookup.tsx");
    // RB-3b: the second level is code.inner (one row per listing), no longer code.file.
    expect([...box.matchAll(/call<[^>]*>\("([^"]+)"/g)].map((m) => m[1])).toEqual(["code.kinds", "code.inner"]);
    expect(box).not.toMatch(/from "\.\.\/ai\/|from "\.\.\/assistant\/|Assistant|localStorage|sessionStorage|indexedDB|caches\./);
    expect(src("plan/where-lookup.ts")).not.toMatch(/from "\.\.\/ai\/|localStorage|sessionStorage/);
    // RB-3b: the picks' memory and the second level's parsers never reach an AI or the browser's storage either.
    for (const f of ["plan/where-inner.ts", "plan/where-picks.ts", "ui/WherePicks.tsx"]) expect(src(f)).not.toMatch(/from "\.\.\/ai\/|from "\.\.\/assistant\/|localStorage|sessionStorage|indexedDB|caches\./);
  });
  it("the draft's AI step reads the capture's words, never a draft's answers", () => {
    expect(src("actions/draft-prepare.ts")).not.toMatch(/answers|\.brief\b|keptOf/);
  });
});
