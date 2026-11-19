// HK-7: the decision log keeps one row per number. Every numbered row (`| D123 | …`) is unique, and every section
// numbered in HK-7 (through CW-1) has no row without a number. DOC-1 (Nov 19): the log is one file per step under
// docs/decisions/ with docs/decisions.md as its index, and numbering ended: a decision after the split is named by its
// step and row ("MC-6.3"), so no file holds a number above the last one given (D1199).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type BaseRecord, rebuild } from "./step-docs.ts";

const docs = (p: string) => readFileSync(new URL(`../docs/${p}`, import.meta.url), "utf8");
const base = JSON.parse(readFileSync(new URL("./step-docs.base.json", import.meta.url), "utf8")) as { decisions: BaseRecord };
/** The log as it stood when DOC-1 split it, rebuilt from the step files. */
const text = rebuild(docs, "decisions", base.decisions.order).text;
/** Every file of the log as it is now, later steps' files and sections included. */
const all = readdirSync(new URL("../docs/decisions/", import.meta.url)).filter((f) => f.endsWith(".md")).map((f) => docs(`decisions/${f}`)).join("\n") + docs("decisions.md");
const rows = [...all.matchAll(/^\| (D\d+) \|/gm)].map((m) => m[1]!);

describe("the decision log (docs/decisions.md and docs/decisions/)", () => {
  it("no number is on two rows", () => {
    const seen = new Set<string>();
    const twice = rows.filter((d) => (seen.has(d) ? true : (seen.add(d), false)));
    expect(twice).toEqual([]);
  });

  it("everything merged up to CW-1 is numbered, D1023 to D1185 among them", () => {
    const upToGd2 = text.slice(0, text.indexOf("## HK-7"));
    const unnumbered = upToGd2.split("\n").filter((l) => /^\| (Done|Open|Dropped|Superseded) \|/.test(l) || /^- (DOC-1|MB-1b|CL-1|HK-6|LP-1|AH-5|AH-6|AH-7|WK-3|UI-10|GD-2|CW-1)\b/.test(l));
    expect(unnumbered).toEqual([]);
    for (const n of [1023, 1050, 1069, 1102, 1152, 1171, 1172, 1185]) expect(rows).toContain(`D${n}`);
  });

  it("gives no new number after DOC-1: none above D1199", () => {
    expect(rows.filter((d) => Number(d.slice(1)) > base.decisions.counts.highest!)).toEqual([]);
    expect(base.decisions.counts.highest).toBe(1199);
  });
});
