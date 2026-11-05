// SW-1: "Needs help from…" is "Ask to collaborate" everywhere a person reads it; the command menu still finds it by
// the old words. Behavior is unchanged (the collaboration finder, collab.* actions).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS, type ActionSpec } from "../actions/registry.ts";
import { filterCommands, type MenuItem } from "./menu.ts";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("Ask to collaborate (SW-1)", () => {
  it("no Needs help from label is left in the UI", () => {
    const dir = import.meta.dirname;
    const files = readdirSync(dir).filter((f) => /\.(tsx?)$/.test(f) && !f.endsWith(".test.ts")).map((f) => join(dir, f));
    expect(files.flatMap((f) => (/Needs help from/.test(code(f)) ? [f] : []))).toEqual([]);
  });
  it("the command menu finds Ask to collaborate by its old name", () => {
    const items = (ACTIONS as readonly ActionSpec[]).map<MenuItem>((a) => ({ id: a.name, action: a.name, group: a.group, label: a.title, ...(a.aka ? { aka: a.aka } : {}) }));
    expect(filterCommands(items, "needs help from").map((i) => i.label)).toContain("Ask to collaborate");
  });
});
