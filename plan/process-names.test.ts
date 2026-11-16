// WT-1: no hard-coded work item type or state names outside the process module (plan/process.ts) and fixtures. Code
// in ui/, actions/ and plan/ decides by level and state category through plan/process.ts, never by comparing names.
// Words in sentences ("Needs stories", the Guide's legend) are copy, not code, and aren't matched. The guard is
// scripts/guards.ts (HK-1); this file checks its shapes and runs its process check on the repo.
// CI-3: the scan reads only the files the process check covers, each once, line by line as runGuards does (it used to
// run every guard on every file and keep the process hits), and has room for a scan of the whole source on a busy
// runner: SCAN_MS. The other guards run in CI's Guards step and in scripts/guards.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guardFiles, PROCESS_CODE as CODE, PROCESS_GONE as GONE, processHit, processScanned } from "../scripts/guards.ts";

const ROOT = join(import.meta.dirname, "..");
/** About 450 files in under 0.1 s alone (1.1 s before CI-3); a full run on a busy 4-core runner is many times slower. */
const SCAN_MS = 30_000;

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
    const hits = scanned.flatMap((f) => readFileSync(join(ROOT, f), "utf8").split("\n").flatMap((line, i) => (processHit(line) ? [`${f}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])));
    expect(hits).toEqual([]);
  }, SCAN_MS);
});
