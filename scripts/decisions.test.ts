// HK-7: the decision log keeps one row per number. Every numbered row (`| D123 | …`) is unique, and the last section
// numbered in HK-7 has no row without a number. Sections still in a branch may stay unnumbered until they merge.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = readFileSync(new URL("../docs/decisions.md", import.meta.url), "utf8");
const rows = [...text.matchAll(/^\| (D\d+) \|/gm)].map((m) => m[1]!);

describe("docs/decisions.md", () => {
  it("no number is on two rows", () => {
    const seen = new Set<string>();
    const twice = rows.filter((d) => (seen.has(d) ? true : (seen.add(d), false)));
    expect(twice).toEqual([]);
  });

  it("everything merged up to GD-2 is numbered, D1023 to D1171 among them", () => {
    const upToGd2 = text.slice(0, text.indexOf("## HK-7"));
    const unnumbered = upToGd2.split("\n").filter((l) => /^\| (Done|Open|Dropped|Superseded) \|/.test(l) || /^- (DOC-1|MB-1b|CL-1|HK-6|LP-1|AH-5|AH-6|AH-7|WK-3|UI-10|GD-2)\b/.test(l));
    expect(unnumbered).toEqual([]);
    for (const n of [1023, 1050, 1069, 1102, 1152, 1171]) expect(rows).toContain(`D${n}`);
  });
});
