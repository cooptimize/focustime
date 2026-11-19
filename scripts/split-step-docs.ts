// DOC-1: splits docs/decisions.md and docs/open-questions.md, as they were at one commit, into one file per step
// under docs/decisions/ and docs/open-questions/, and turns the two files into indexes (scripts/step-docs.ts says how).
// It reads the old files from git, never from the working tree, so running it again gives the same files byte for byte.
// It also writes scripts/step-docs.base.json: each old file's hash, size, the file each section went to and counts, so the proof
// (scripts/step-docs.test.ts) can rebuild and check the old text where git doesn't have this commit (CI's shallow checkout).
//
// Usage: node scripts/split-step-docs.ts [--from <commit>] [--out <dir>]
//   --from   the commit whose two files are split (BASE: main when DOC-1 started)
//   --out    where to write (the repository's docs/ by default); a temp folder for the proof
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { baseRecord, type Log, splitFiles } from "./step-docs.ts";

/** The commit DOC-1's branch started from. Merging a later main means running this again with that main. */
export const BASE = "3cb39ae3";
export const LOGS: Log[] = ["decisions", "open-questions"];

const root = resolve(import.meta.dirname, "..");

/** One log's text as it was at `from`. */
export function oldLog(log: Log, from = BASE): string {
  return execFileSync("git", ["show", `${from}:docs/${log}.md`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Every file the split writes, as path under docs/ → text. */
export function splitAll(from = BASE): Map<string, string> {
  const all = new Map<string, string>();
  for (const log of LOGS) for (const [p, t] of splitFiles(oldLog(log, from), log)) all.set(p, t);
  return all;
}

/** The record of both old logs, as JSON text. */
export const baseJson = (from = BASE) => `${JSON.stringify({ from, ...Object.fromEntries(LOGS.map((l) => [l, baseRecord(oldLog(l, from), l)])) }, null, 2)}\n`;
export const BASE_JSON = join(root, "scripts/step-docs.base.json");

if (import.meta.main) {
  const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const out = resolve(arg("--out") ?? join(root, "docs"));
  const files = splitAll(arg("--from") ?? BASE);
  for (const [p, t] of files) {
    mkdirSync(dirname(join(out, p)), { recursive: true });
    writeFileSync(join(out, p), t);
  }
  const record = arg("--out") ? join(out, "step-docs.base.json") : BASE_JSON;
  writeFileSync(record, baseJson(arg("--from") ?? BASE));
  console.log(`split-step-docs: ${files.size} files into ${out}, the record in ${record}`);
}
