// DOC-1 (Nov 19): the decision log and the open questions, one file per step. Every step used to append to
// docs/decisions.md and docs/open-questions.md, so steps built side by side conflicted there. This module splits each
// file into a folder of step files plus an index, and rebuilds the old text from them (the proof that nothing was lost,
// added or changed). Pure: callers read and write the files.
//
// A section is a "## " heading and every line up to the next one. A step's file is named by its code in lower case
// (MC-6 → mc-6.md); a step under more than one heading gets one file with its sections in the order they appeared. A
// heading with no step code is named by its own words (Shared polling → shared-polling.md). What sits before the first
// heading stays in the index, except the decision log's numbered table (D19 to D666), which is too large for an index
// and goes whole into its own file.
import { createHash } from "node:crypto";

export type Log = "decisions" | "open-questions";
export type Section = { heading: string; text: string; file: string };
export type Split = { preamble: string; early: string; sections: Section[] };

/** The base name of the file the decision log's table before the first heading goes into. */
export const EARLY_FILE = "d19-to-d666";
const EARLY_LINE = "- [D19 to D666, before the first step heading](decisions/d19-to-d666.md)";

/** A heading's step code: "MC-6: Calls…" → MC-6, "Draft Stories (DS-1, Nov 4)" → DS-1, "Step 13.5 (Nov 1)" → Step 13.5. */
export function codeOf(heading: string): string | null {
  const lead = /^([A-Z][A-Z0-9]*-[A-Z]?\d+[a-z]?)(?=$|[\s:(])/.exec(heading);
  if (lead) return lead[1]!;
  const inner = /\(([A-Z][A-Z0-9]*-[A-Z]?\d+[a-z]?)[,)]/.exec(heading);
  if (inner) return inner[1]!;
  const step = /^(Step \d+(?:\.\d+)?)\b/.exec(heading);
  if (step) return step[1]!;
  const part = /^(Part \d+)\b/.exec(heading);
  return part ? part[1]! : null;
}

/** The file a heading is filed under, without ".md". */
export function fileOf(heading: string): string {
  const code = codeOf(heading);
  const name = code ?? heading.replace(/\s*\([^)]*\)\s*$/, "");
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");
}

/** A log's text as its preamble and its sections, each section byte for byte as it stood. */
export function parse(text: string, log: Log): Split {
  const at = [...text.matchAll(/^## (.+)$/gm)];
  const head = at.length ? text.slice(0, at[0]!.index) : text;
  let preamble = head;
  let early = "";
  if (log === "decisions") {
    // The decision log's table, from its header row to the first heading, leaves the index.
    const t = head.indexOf("\n| ID |");
    if (t >= 0) {
      preamble = head.slice(0, t + 1);
      early = head.slice(t + 1);
    }
  }
  const sections = at.map((m, i) => {
    const end = i + 1 < at.length ? at[i + 1]!.index : text.length;
    return { heading: m[1]!, text: text.slice(m.index, end), file: fileOf(m[1]!) };
  });
  return { preamble, early, sections };
}

/** A relative link in moved text, one folder deeper now: "](technical/x.md)" → "](../technical/x.md)". */
export const deepen = (s: string) => s.replace(/\]\((?!https?:|#|\/|mailto:)([^)]+)\)/g, "](../$1)");
/** The reverse, for the proof. */
export const shallow = (s: string) => s.replace(/\]\(\.\.\/((?!\.\.\/)[^)]+)\)/g, "]($1)");

/** The index line for one file. */
const lineFor = (log: Log, heading: string, file: string) => `- [${heading}](${log}/${file}.md)`;

/** The files a split writes: the index and every step file, as path → text (paths under docs/). */
export function splitFiles(text: string, log: Log): Map<string, string> {
  const { preamble, early, sections } = parse(text, log);
  const out = new Map<string, string>();
  const order: string[] = [];
  const first = new Map<string, string>();
  for (const s of sections) {
    if (!first.has(s.file)) {
      first.set(s.file, s.heading);
      order.push(s.file);
    }
    out.set(`${log}/${s.file}.md`, (out.get(`${log}/${s.file}.md`) ?? "") + deepen(s.text));
  }
  const lines = [...(early ? [EARLY_LINE] : []), ...order.map((f) => lineFor(log, first.get(f)!, f))];
  if (early) out.set(`${log}/${EARLY_FILE}.md`, deepen(early));
  out.set(`${log}.md`, `${preamble}${lines.join("\n")}\n`);
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** An index line's target file, without ".md", or null when the line isn't one. */
export function indexTarget(line: string, log: Log): string | null {
  const m = new RegExp(`^- \\[.+\\]\\(${log}/([a-z0-9.-]+)\\.md\\)$`).exec(line);
  return m ? m[1]! : null;
}

/** What the split records about an old log, so the proof needs no git: its hash, its size, the file each of its sections went to, in order, and its counts. No heading or row words: the hash covers them. */
export type BaseRecord = { sha256: string; bytes: number; order: string[]; counts: ReturnType<typeof counts> };

export function baseRecord(text: string, log: Log): BaseRecord {
  return { sha256: sha256(text), bytes: Buffer.byteLength(text, "utf8"), order: parse(text, log).sections.map((s) => s.file), counts: counts(text, log) };
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * The old log rebuilt from the files as they are on disk: the index's preamble (and, for the decision log, the table
 * before the first heading), then the sections in the old order, each taken in turn from the start of its file. A later
 * step may add its own file and index line, or sections after the old ones in a file; neither is read. Links go back
 * one folder (shallow), the only change the split makes inside moved text.
 */
export function rebuild(read: (path: string) => string, log: Log, order: BaseRecord["order"]): { text: string; sections: Section[] } {
  const index = read(`${log}.md`).split("\n");
  const firstLine = index.findIndex((l) => indexTarget(l, log) !== null);
  const preamble = index.slice(0, firstLine).join("\n") + "\n";
  const early = log === "decisions" && index.some((l) => indexTarget(l, log) === EARLY_FILE) ? shallow(read(`${log}/${EARLY_FILE}.md`)) : "";
  const queue = new Map<string, Section[]>();
  const sections = order.map((file) => {
    if (!queue.has(file)) queue.set(file, parse(shallow(read(`${log}/${file}.md`)), log).sections);
    return queue.get(file)!.shift() ?? { heading: `(missing from ${file})`, text: "", file };
  });
  return { text: preamble + early + sections.map((s) => s.text).join(""), sections };
}

/** Every numbered decision row (`| D123 | …`), as number → its line. */
export function numberedRows(text: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const m of text.matchAll(/^\| (D\d+) \|.*$/gm)) rows.set(m[1]!, [...(rows.get(m[1]!) ?? []), m[0]]);
  return rows;
}

/** STEP 0.3's counts for one log. */
export function counts(text: string, log: Log) {
  const p = parse(text, log);
  const nums = [...text.matchAll(/^\| D(\d+) \|/gm)].map((m) => Number(m[1]));
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    headings: p.sections.length,
    files: new Set(p.sections.map((s) => s.file)).size,
    decisionRows: (text.match(/^\| (D\d+|-) \|/gm) ?? []).length,
    numbered: nums.length,
    highest: nums.length ? Math.max(...nums) : null,
    questions: (text.match(/^\s*- /gm) ?? []).length,
  };
}
