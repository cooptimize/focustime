// WT-1: no hard-coded work item type or state names outside the process module (plan/process.ts) and fixtures. Code
// in ui/, actions/ and plan/ decides by level and state category through plan/process.ts, never by comparing names.
// Words in sentences ("Needs stories", the Guide's legend) are copy, not code, and aren't matched. The guard is
// scripts/guards.ts (HK-1); this file checks its shapes and runs it on the repo.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guardFiles, PROCESS_CODE as CODE, PROCESS_GONE as GONE, processScanned, runGuards } from "../scripts/guards.ts";

const ROOT = join(import.meta.dirname, "..");

describe("no hard-coded type or state names (WT-1)", () => {
  const scanned = guardFiles(ROOT).filter(processScanned);
  it("scans the folders", () => expect(scanned.length).toBeGreaterThan(50));
  it("catches the shapes that were here before WT-1", () => {
    const old = [
      'if (parent.type !== "Feature") return no(',
      'const known: Record<string, string> = { "User Story": "Story", Bug: "Bug" };',
      'type: c.type ?? (tier === "epic" ? "Epic" : "Feature"), state: c.state, stateCategory: "InProgress",',
      'return hit ? hit.stateCategory === "Completed" : null;',
      'const DONE = new Set(["Resolved", "Completed"]);',
      'itemType: "Feature", url: null,',
      'export const storyWord = (type: string) => type;',
    ];
    for (const line of old) expect(CODE.some((re) => re.test(line)) || GONE.test(line), line).toBe(true);
    expect(CODE.some((re) => re.test('{p.op === "delete" ? "Removed" : "Now"}'))).toBe(false);
  });
  it("ui/, actions/ and plan/ decide by level and category, never by a name", () => {
    expect(runGuards(ROOT).hits.filter((h) => h.guard === "process").map((h) => h.at)).toEqual([]);
  });
});
