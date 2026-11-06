// HK-1: the repo guards, one script run the same way by CI, `npm run guards` and the guard tests. One file list
// everywhere: tracked files plus untracked files that aren't ignored (`git ls-files --cached --others
// --exclude-standard`), read from the working tree. Before HK-1 the client-name guard read only tracked files and ran
// only inside the full test suite, so a new file or the inner loop (`vitest related`) never saw it.
//
// Three guards:
// - names (A1, D418): no real client, project, person or company address, and no desktop or workstation name, outside
//   the history (docs/decisions.md, docs/azure/) and, for desktop words, the developer loop's README. Case-insensitive.
//   The words are base64 so this file never matches its own search.
// - process names (WT-1): no hard-coded work item type, state or category name acting as code in ui/, actions/ or
//   plan/ outside plan/process.ts. Case-sensitive (it matches code, not prose).
// - words (TD-1): no "pick" in the to-do sense in text people read (scripts/words-guard.ts); "pick" is only the code name.
//
// Usage: node scripts/guards.ts [--root <dir>]; exits 1 and lists file:line for each hit.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { wordsHits, wordsScanned } from "./words-guard.ts";

const word = (b64: string) => Buffer.from(b64, "base64").toString("utf8");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Real clients and projects (inventory section 5, D286's originals), the owner, and company addresses. */
const REAL = [
  ...["VyZD", "VCZT", "V0MgUHJvamVjdA==", "V0MlMjBQcm9qZWN0"].map((b) => esc(word(b))),
  ...["V29vZGFyZA==", "UXVpZGRpdHk=", "Q1ND", "dGFubmVy", "c3BhdWxkaW5n"].map((b) => `\\b${esc(word(b))}\\b`),
  `[A-Za-z0-9._%+-]+@${esc(word("Y29vcHRpbWl6ZS5vcmc="))}`,
];
/** The developer's desktop and workstation. */
const DESKTOP = ["b21hcmNoeQ==", "aHlwcmxhbmQ=", "cmVtbWluYQ==", "bW9vbmxpZ2h0"].map((b) => esc(word(b))).concat(`\\b${esc(word("dG1zLQ=="))}`);

export const realRe = new RegExp(REAL.join("|"), "i");
export const desktopRe = new RegExp(DESKTOP.join("|"), "i");
const HISTORY = (f: string) => f === "docs/decisions.md" || f.startsWith("docs/azure/");
const TEXT = /\.(ts|tsx|mjs|js|json|md|css|html|toml|sh|service|desktop|txt|svg|yml|yaml|bicep|bicepparam)$|(^|\/)[^.]+$/;

// WT-1's shapes.
const TYPES = ["Epic", "Feature", "User Story", "Story", "Product Backlog Item", "Requirement", "Task", "Bug", "Issue", "Domain", "Recurring", "Ongoing"];
/** "Done" is left out: it is also the planning modes' button. */
const STATES = ["New", "Active", "Closed", "Resolved", "Removed", "To Do", "In Progress", "Approved"];
const CATEGORIES = ["Proposed", "InProgress", "Resolved", "Completed", "Removed"];
const q = (names: string[]) => `["'\`](?:${names.map((n) => n.replace(/ /g, "\\s")).join("|")})["'\`]`;
const ALL = q([...new Set([...TYPES, ...STATES, ...CATEGORIES])]);
/** Code shapes that act on a name: a comparison, a fallback, a ternary branch, a set member, or a type/state field. */
export const PROCESS_CODE = [
  new RegExp(`(?:===|!==|==|!=)\\s*${ALL}`),
  new RegExp(`${ALL}\\s*(?:===|!==|==|!=)`),
  new RegExp(`(?:\\?\\?|\\|\\|)\\s*\\(?\\s*${ALL}`),
  new RegExp(`(?:[Cc]ategory|[Ss]tate|[Tt]ype|tier)\\b[^?]*\\?\\s*${ALL}\\s*:`),
  new RegExp(`\\b(?:has|includes|add)\\(\\s*${ALL}\\s*\\)`),
  new RegExp(`\\b(?:type|itemType|storyType|state|stateCategory|category|level)\\s*:\\s*${ALL}`),
  new RegExp(`new Set\\(\\[\\s*${ALL}`),
  new RegExp(`\\{\\s*["']?(?:${TYPES.join("|").replace(/ /g, "\\s")})["']?\\s*:\\s*["']`),
];
/** The old helpers that named types; they must not come back. */
export const PROCESS_GONE = /\b(typeTag|storyWord|FEATURE_WORD|OPEN_CATEGORIES|DONE_CATEGORIES)\b/;
const PROCESS_OWNERS = new Set(["plan/process.ts"]);
export const processScanned = (f: string) => /^(ui|actions|plan)\//.test(f) && /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !/fakes\.ts$/.test(f) && !PROCESS_OWNERS.has(f);
/** A line as the process guard sees it: comments dropped. */
export const processHit = (line: string) => {
  const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
  return PROCESS_CODE.some((re) => re.test(code)) || PROCESS_GONE.test(code);
};

/** The one file list: tracked plus untracked-not-ignored, text files only, that exist on disk. */
export function guardFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(out.split("\0"))].filter((f) => f && TEXT.test(f) && f !== "package-lock.json" && !f.startsWith("node_modules/")).sort();
}

export type Hit = { guard: "names" | "desktop" | "process" | "words"; at: string };

export function runGuards(root: string): { files: number; hits: Hit[] } {
  const files = guardFiles(root);
  const hits: Hit[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(resolve(root, f), "utf8");
    } catch {
      continue; // listed but not on disk (a delete not yet committed)
    }
    const history = HISTORY(f);
    const desktopOk = history || f === "system/README.md";
    const proc = processScanned(f);
    const lines = text.split("\n");
    if (wordsScanned(f)) for (const n of wordsHits(f, text)) hits.push({ guard: "words", at: `${f}:${n}: ${lines[n - 1]!.trim().slice(0, 120)}` });
    lines.forEach((line, i) => {
      const at = `${f}:${i + 1}`;
      if (!history && realRe.test(line)) hits.push({ guard: "names", at });
      if (!desktopOk && desktopRe.test(line)) hits.push({ guard: "desktop", at });
      if (proc && processHit(line)) hits.push({ guard: "process", at: `${at}: ${line.trim().slice(0, 120)}` });
    });
  }
  return { files: files.length, hits };
}

const WHY: Record<Hit["guard"], string> = {
  names: "a real client, project, person or company address (use fictional names: contoso, fabrikam, @example)",
  desktop: "a desktop or workstation name (only the history and system/README.md may name it)",
  process: "a work item type, state or category name used as code (decide through plan/process.ts)",
  words: 'text people read says "pick" for a planned piece of work: say "to-do" (TD-1; code names keep pick)',
};

if (import.meta.main) {
  const i = process.argv.indexOf("--root");
  const root = resolve(i >= 0 ? process.argv[i + 1]! : resolve(import.meta.dirname, ".."));
  const { files, hits } = runGuards(root);
  if (!hits.length) {
    console.log(`guards: ${files} files, no hits`);
  } else {
    for (const g of ["names", "desktop", "process", "words"] as const) {
      const mine = hits.filter((h) => h.guard === g);
      if (!mine.length) continue;
      console.error(`guards: ${mine.length} ${g} hit(s): ${WHY[g]}`);
      for (const h of mine) console.error(`  ${h.at}`);
    }
    process.exitCode = 1;
  }
}
