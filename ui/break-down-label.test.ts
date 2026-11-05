// ADM-2: Settings and Admin say "Break down" (BD-1's name), never "Draft stories"; the settings keys keep their old
// names (draft_stories, draftStories, draft_months), and the command menu still finds Break down by the old words.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS, type ActionSpec } from "../actions/registry.ts";
import { LEVEL_SPECS } from "../config/org.ts";
import { filterCommands, type MenuItem } from "./menu.ts";

/** A file's text without its comments (what a person can read on screen is in strings and JSX text). */
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("Break down in Settings and Admin", () => {
  it("no Draft stories label is left", () => {
    const dir = join(import.meta.dirname, "settings");
    const files = [join(import.meta.dirname, "Settings.tsx"), ...readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => join(dir, f))];
    const left = files.flatMap((f) => (/Draft stories/i.test(code(f)) ? [f] : []));
    expect(left).toEqual([]);
    expect(LEVEL_SPECS.draft_stories.label).toBe("Break down offered");
  });
  it("the command menu finds Break down by its old name", () => {
    const items = (ACTIONS as readonly ActionSpec[]).map<MenuItem>((a) => ({ id: a.name, action: a.name, group: a.group, label: a.title, ...(a.aka ? { aka: a.aka } : {}) }));
    expect(filterCommands(items, "draft stories").map((i) => i.label)).toContain("Break down with AI");
  });
});
