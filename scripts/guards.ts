// HK-1: the repo guards, one script run the same way by CI, `npm run guards` and the guard tests. One file list
// everywhere: tracked files plus untracked files that aren't ignored (`git ls-files --cached --others
// --exclude-standard`), read from the working tree. Before HK-1 the client-name guard read only tracked files and ran
// only inside the full test suite, so a new file or the inner loop (`vitest related`) never saw it.
//
// Three guards:
// - names (A1, D418): no real client, project, person or company address, and no desktop or workstation name, outside
//   the history (docs/decisions.md and docs/decisions/, docs/azure/) and, for desktop words, the developer loop's README. Case-insensitive.
//   The words are base64 so this file never matches its own search.
// - process names (WT-1): no hard-coded work item type, state or category name acting as code in ui/, actions/ or
//   plan/ outside plan/process.ts. Case-sensitive (it matches code, not prose).
// - words (TD-1): no "pick" in the to-do sense in text people read (scripts/words-guard.ts); "pick" is only the code name.
// - old names (NM-1): no name on the Guide's Renamed list (ui/guide/retired.ts) and no control written as a character
//   (⋯ ‹ › × or a lone +) in text people read; the same scan as words. Old names stay only in the Renamed list, a
//   setting's `old` names, a command's `aka` and search `keywords`.
// - pointers (NM-2): every "Settings ›", "Admin ›", "More ›", "Inbox ›" and "Backlog ›" in text people read (and the
//   Guide and the Technical docs) names a place the screens draw (ui/places.ts).
// - files (CI-3): no image or video under docs/ux (a step's screenshots live on its shots/<step> branch, never on
//   main), and no file over 300 KB outside the few that need the size (LARGE_OK, each with its reason). Every file is
//   checked, not only text files, from the same list. PV-1: no archive under docs/ either (a zip held pictures of a
//   real session that the image check couldn't see inside). FT-1: no archive anywhere in the repository, and no Office
//   file (docx, xlsx, pptx and the like: zips inside, which can hold pictures), with no file allowed either way.
// - step docs (DOC-1): the two indexes, docs/decisions.md and docs/open-questions.md, hold one line per step and no
//   step heading or table row: a step writes its own docs/decisions/<step>.md and docs/open-questions/<step>.md.
//
// Usage: node scripts/guards.ts [--root <dir>]; exits 1 and lists file:line for each hit.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { namesHits, namesScanned, pointerHits, pointersScanned, wordsHits, wordsScanned } from "./words-guard.ts";

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
const HISTORY = (f: string) => f === "docs/decisions.md" || f.startsWith("docs/decisions/") || f.startsWith("docs/azure/");
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

/** Every file in the one list: tracked plus untracked-not-ignored, of any kind. */
export function allFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(out.split("\0"))].filter((f) => f && !f.startsWith("node_modules/")).sort();
}

/** The one file list: tracked plus untracked-not-ignored, text files only, that exist on disk. */
export function guardFiles(root: string): string[] {
  return allFiles(root).filter((f) => TEXT.test(f) && f !== "package-lock.json");
}

// CI-3's files guard.
export const IMAGE_OR_VIDEO = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|ico|svg|heic|mp4|webm|mov|mkv|avi|m4v)$/i;
/** PV-1, FT-1: archives, refused anywhere in the repository: what is inside one can't be checked. */
export const ARCHIVE = /\.(zip|7z|rar|tar|tgz|gz|bz2|xz|zst|jar)$/i;
/** FT-1: Office documents (Word, Excel, PowerPoint, Visio, OpenDocument): zips inside, which can hold pictures. */
export const OFFICE = /\.(docx|docm|dotx|dotm|xlsx|xlsm|xlsb|xltx|xltm|pptx|pptm|potx|potm|ppsx|ppsm|vsdx|odt|ods|odp|odg)$/i;
export const LARGE_BYTES = 300 * 1024;
/** Files (or folders, ending in "/") that may be over 300 KB, and why. */
export const LARGE_OK: Record<string, string> = {
  "docs/decisions/d19-to-d666.md": "the decision log's numbered table from before step headings (D19 to D666), moved whole by DOC-1's split and never added to",
  "ui/styles.css": "the app's one stylesheet",
  "docs/demo/": "the demo walkthrough's pictures (scripts/demo-walkthrough.mjs writes them, docs/demo.md shows them)",
};
const largeOk = (f: string) => Object.keys(LARGE_OK).some((k) => (k.endsWith("/") ? f.startsWith(k) : f === k));
export type FileHit = { file: string; why: "image" | "archive" | "office" | "large"; bytes: number };
/** Images or videos under docs/ux, archives and Office files anywhere, and files over 300 KB outside LARGE_OK. Files listed but not on disk are skipped. */
export function fileHits(root: string, files: string[] = allFiles(root)): FileHit[] {
  const hits: FileHit[] = [];
  for (const f of files) {
    let bytes: number;
    try {
      bytes = statSync(resolve(root, f)).size;
    } catch {
      continue;
    }
    if (f.startsWith("docs/ux/") && IMAGE_OR_VIDEO.test(f)) hits.push({ file: f, why: "image", bytes });
    else if (ARCHIVE.test(f)) hits.push({ file: f, why: "archive", bytes });
    else if (OFFICE.test(f)) hits.push({ file: f, why: "office", bytes });
    else if (bytes > LARGE_BYTES && !largeOk(f)) hits.push({ file: f, why: "large", bytes });
  }
  return hits;
}

/** DOC-1: the two indexes. */
export const STEP_INDEXES = ["docs/decisions.md", "docs/open-questions.md"];
/** Lines an index may not hold: a step heading or a table row (a decision). Each as its 1-based line number. */
export function stepIndexHits(f: string, text: string): number[] {
  if (!STEP_INDEXES.includes(f)) return [];
  return text.split("\n").flatMap((l, i) => (/^#{2,6} /.test(l) || /^\|/.test(l) ? [i + 1] : []));
}

export type Hit = { guard: "names" | "desktop" | "process" | "words" | "old names" | "pointers" | "files" | "step docs"; at: string };

export function runGuards(root: string): { files: number; hits: Hit[] } {
  const every = allFiles(root);
  const files = every.filter((f) => TEXT.test(f) && f !== "package-lock.json");
  const hits: Hit[] = fileHits(root, every).map((h) => ({ guard: "files", at: `${h.file}: ${h.why === "image" ? "an image or video under docs/ux" : h.why === "archive" ? "an archive" : h.why === "office" ? "an Office file" : `${Math.round(h.bytes / 1024)} KB`}` }));
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
    for (const n of stepIndexHits(f, text)) hits.push({ guard: "step docs", at: `${f}:${n}: ${lines[n - 1]!.trim().slice(0, 120)}` });
    if (wordsScanned(f)) for (const n of wordsHits(f, text)) hits.push({ guard: "words", at: `${f}:${n}: ${lines[n - 1]!.trim().slice(0, 120)}` });
    if (namesScanned(f)) for (const h of namesHits(f, text)) hits.push({ guard: "old names", at: `${f}:${h.line}: ${h.says.join(", ")}: ${lines[h.line - 1]!.trim().slice(0, 120)}` });
    if (pointersScanned(f)) for (const h of pointerHits(f, text)) hits.push({ guard: "pointers", at: `${f}:${h.line}: ${h.says.join(", ")}: ${lines[h.line - 1]!.trim().slice(0, 120)}` });
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
  "old names": "text people read uses a name FocusTime no longer has, or writes a control as a character: use the screen's name today and the control's name (NM-1; ui/guide/retired.ts says where each old name lives now)",
  pointers: "a pointer names a place that isn't there: use the name the screen draws (NM-2; ui/places.ts lists them)",
  "step docs": "a step heading or a decision row in an index: a step writes its decisions in docs/decisions/<step>.md and its open questions in docs/open-questions/<step>.md, and adds one line to each index (docs/decisions/README.md, DOC-1)",
  files: "an image or video under docs/ux, an archive or an Office file anywhere, or a file over 300 KB: a step's screenshots go on its shots/<step> branch (scripts/shots-branch.ts), never on main, and never in an archive or an Office file (PV-1, FT-1); a file that must be large is added to LARGE_OK in scripts/guards.ts with its reason (CI-3)",
};

if (import.meta.main) {
  const i = process.argv.indexOf("--root");
  const root = resolve(i >= 0 ? process.argv[i + 1]! : resolve(import.meta.dirname, ".."));
  const { files, hits } = runGuards(root);
  if (!hits.length) {
    console.log(`guards: ${files} files, no hits`);
  } else {
    for (const g of ["names", "desktop", "process", "words", "old names", "pointers", "step docs", "files"] as const) {
      const mine = hits.filter((h) => h.guard === g);
      if (!mine.length) continue;
      console.error(`guards: ${mine.length} ${g} hit(s): ${WHY[g]}`);
      for (const h of mine) console.error(`  ${h.at}`);
    }
    process.exitCode = 1;
  }
}
