// WT-1: no hard-coded work item type or state names outside the process module (plan/process.ts) and fixtures. Code
// in ui/, actions/ and plan/ decides by level and state category through plan/process.ts, never by comparing names.
// Words in sentences ("Needs stories", the Guide's legend) are copy, not code, and aren't matched.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const TYPES = ["Epic", "Feature", "User Story", "Story", "Product Backlog Item", "Requirement", "Task", "Bug", "Issue", "Domain", "Recurring", "Ongoing"];
/** "Done" is left out: it is also the planning modes' button. */
const STATES = ["New", "Active", "Closed", "Resolved", "Removed", "To Do", "In Progress", "Approved"];
const CATEGORIES = ["Proposed", "InProgress", "Resolved", "Completed", "Removed"];
const q = (names: string[]) => `["'\`](?:${names.map((n) => n.replace(/ /g, "\\s")).join("|")})["'\`]`;
const ALL = q([...new Set([...TYPES, ...STATES, ...CATEGORIES])]);
/** Code shapes that act on a name: a comparison, a fallback, a ternary branch, a set member, or a type/state field. */
const CODE = [
  new RegExp(`(?:===|!==|==|!=)\\s*${ALL}`),
  new RegExp(`${ALL}\\s*(?:===|!==|==|!=)`),
  new RegExp(`(?:\\?\\?|\\|\\|)\\s*\\(?\\s*${ALL}`),
  new RegExp(`(?:[Cc]ategory|[Ss]tate|[Tt]ype|tier)\\b[^?]*\\?\\s*${ALL}\\s*:`),
  new RegExp(`\\b(?:has|includes|add)\\(\\s*${ALL}\\s*\\)`),
  new RegExp(`\\b(?:type|itemType|storyType|state|stateCategory|category|level)\\s*:\\s*${ALL}`),
  new RegExp(`new Set\\(\\[\\s*${ALL}`),
  new RegExp(`\\{\\s*["']?(?:${TYPES.join("|").replace(/ /g, "\\s")})["']?\\s*:\\s*["']`),
];
const OWNERS = new Set(["plan/process.ts"]);
/** The old helpers that named types; they must not come back. */
const GONE = /\b(typeTag|storyWord|FEATURE_WORD|OPEN_CATEGORIES|DONE_CATEGORIES)\b/;

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(join(ROOT, p)).isDirectory()) return files(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !/fakes\.ts$/.test(n) ? [p] : [];
  });
}

describe("no hard-coded type or state names (WT-1)", () => {
  const scanned = ["ui", "actions", "plan"].flatMap(files).filter((f) => !OWNERS.has(f));
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
    const hits: string[] = [];
    for (const f of scanned) {
      readFileSync(join(ROOT, f), "utf8").split("\n").forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        if (CODE.some((re) => re.test(code)) || GONE.test(code)) hits.push(`${relative(ROOT, join(ROOT, f))}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
