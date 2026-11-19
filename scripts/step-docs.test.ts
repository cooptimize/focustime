// DOC-1: the proof that splitting the decision log and the open questions lost, added and changed nothing. Each old
// file is rebuilt from its index and its step files on disk, in the old order the split recorded
// (scripts/step-docs.base.json), and must hash to the file as it was at BASE, byte for byte. The only change the split
// makes inside moved text is a relative link one folder deeper, which the rebuild undoes. A later step may add its own
// file and index line, or add sections after the old ones in a file; neither is part of the old text.
//
// Where git has BASE (a developer's clone; not CI's shallow checkout) the old files are also read from git: the
// rebuild is compared line by line, the record is checked against them, and the script is run twice.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BASE, baseJson, LOGS, oldLog, splitAll } from "./split-step-docs.ts";
import { type BaseRecord, codeOf, counts, deepen, EARLY_FILE, fileOf, indexTarget, numberedRows, rebuild, sha256, shallow, splitFiles } from "./step-docs.ts";
import { LARGE_BYTES, LARGE_OK } from "./guards.ts";

const root = resolve(import.meta.dirname, "..");
const docs = (p: string) => readFileSync(join(root, "docs", p), "utf8");
const record = JSON.parse(readFileSync(join(root, "scripts/step-docs.base.json"), "utf8")) as { from: string } & Record<(typeof LOGS)[number], BaseRecord>;
const hasBase = (() => {
  try {
    execFileSync("git", ["cat-file", "-e", `${BASE}:docs/decisions.md`], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe.each(LOGS)("docs/%s.md split into one file per step (DOC-1)", (log) => {
  const rec = record[log];
  const after = rebuild(docs, log, rec.order);

  it("rebuilds to the old file byte for byte: the same hash and size", () => {
    expect(after.sections.filter((s) => s.heading.startsWith("(missing")).map((s) => s.heading)).toEqual([]);
    expect(after.sections.map((s) => s.file)).toEqual(rec.order);
    expect(Buffer.byteLength(after.text, "utf8")).toBe(rec.bytes);
    expect(sha256(after.text)).toBe(rec.sha256);
  });

  it("keeps STEP 0.3's counts", () => expect(counts(after.text, log)).toEqual(rec.counts));

  it("every index line names a file that is there, once, and every file in the folder has its line", () => {
    const named = docs(`${log}.md`).split("\n").map((l) => indexTarget(l, log)).filter((f): f is string => !!f);
    const files = readdirSync(join(root, "docs", log)).filter((f) => f.endsWith(".md") && f !== "README.md").map((f) => f.replace(/\.md$/, ""));
    expect([...named].sort()).toEqual([...files].sort());
    expect(new Set(named).size).toBe(named.length);
  });

  it("no file in the folder is over the guards' limit, except the one left whole and listed in LARGE_OK", () => {
    const big = readdirSync(join(root, "docs", log)).filter((f) => statSync(join(root, "docs", log, f)).size > LARGE_BYTES).map((f) => `docs/${log}/${f}`);
    expect(big).toEqual(log === "decisions" ? [`docs/decisions/${EARLY_FILE}.md`] : []);
    for (const f of big) expect(LARGE_OK[f], f).toBeTruthy();
    expect(LARGE_OK[`docs/${log}.md`]).toBeUndefined();
  });

  describe.skipIf(!hasBase)("against git at BASE", () => {
    const old = hasBase ? oldLog(log) : "";

    it("row for row: every line of the old file is in the rebuild, as often, in the same place", () => {
      const a = old.split("\n");
      const b = after.text.split("\n");
      const firstDiff = a.findIndex((l, i) => l !== b[i]);
      expect(firstDiff, firstDiff >= 0 ? `line ${firstDiff + 1}: ${a[firstDiff]?.slice(0, 80)}` : "").toBe(-1);
      expect(b.length).toBe(a.length);
    });

    it("the record is the old file's", () => expect(baseJson()).toBe(readFileSync(join(root, "scripts/step-docs.base.json"), "utf8")));

    it("the script run twice writes the same files, and each file on disk starts with them", () => {
      const a = splitAll();
      const b = splitAll();
      expect([...a.keys()]).toEqual([...b.keys()]);
      for (const [p, t] of a) expect(b.get(p), p).toBe(t);
      for (const [p, t] of a) {
        if (!p.startsWith(log)) continue;
        const disk = docs(p);
        if (p === `${log}.md`) {
          const lines = t.trimEnd().split("\n");
          expect(disk.split("\n").slice(0, lines.length), p).toEqual(lines);
        } else expect(disk.startsWith(t), p).toBe(true);
      }
    });

    it("writes the same files into a folder of its own choosing", () => {
      const dir = mkdtempSync(join(tmpdir(), "doc1-"));
      temps.push(dir);
      execFileSync("node", [join(root, "scripts/split-step-docs.ts"), "--out", dir], { cwd: root });
      for (const [p, t] of splitFiles(old, log)) expect(readFileSync(join(dir, p), "utf8"), p).toBe(t);
    });
  });
});

describe("decision numbers after the split (DOC-1)", () => {
  it("every number in use before is in use once, on the same row's words", () => {
    const rows = numberedRows(rebuild(docs, "decisions", record.decisions.order).text);
    const twice = [...rows].filter(([, r]) => r.length > 1).map(([d]) => d);
    expect(twice).toEqual([]);
    expect(rows.size).toBe(record.decisions.counts.numbered);
    if (hasBase) for (const [d, r] of numberedRows(oldLog("decisions"))) expect(rows.get(d), d).toEqual(r);
  });
});

describe("how a heading is filed (DOC-1)", () => {
  it.each([
    ["MC-6: Calls polish after the redesign (Nov 18)", "mc-6"],
    ["MC-2c: Calls started in a client's chat (Nov 18)", "mc-2c"],
    ["RB-3b: The lookup", "rb-3b"],
    ["UI-3", "ui-3"],
    ["AI-F1", "ai-f1"],
    ["UI-B", "ui-b"],
    ["Draft Stories (DS-1, Nov 4)", "ds-1"],
    ["Costs (HK-2, Nov 5)", "hk-2"],
    ["Costs (Nov 4)", "costs"],
    ["Shared polling (Nov 4)", "shared-polling"],
    ["Step 13.5 (Nov 1)", "step-13.5"],
    ["Part 0: a shared owner and state per conversation (Nov 9)", "part-0"],
    ["Part 0 (shared owner)", "part-0"],
  ])("%s → %s.md", (heading, file) => expect(fileOf(heading)).toBe(file));

  it("has a code only where the heading names one", () => {
    expect(codeOf("Shared polling (Nov 4)")).toBeNull();
    expect(codeOf("CX-0: the FocusTime and Coop comment contract v1")).toBe("CX-0");
  });

  it("moves a relative link one folder deeper and back, and leaves web links alone", () => {
    const s = "[contract](technical/coop-contract.md) [docs](https://example.com/x) [here](#a)";
    expect(deepen(s)).toBe("[contract](../technical/coop-contract.md) [docs](https://example.com/x) [here](#a)");
    expect(shallow(deepen(s))).toBe(s);
  });

  it("was split from the commit DOC-1 started from", () => expect(record.from).toBe(BASE));
});
