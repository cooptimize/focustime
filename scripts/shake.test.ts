// FT-1: the shake command's own rules (scripts/shake.ts): its options, where the copies go, which CPUs, and what counts
// as a copy passing. Running it for real (it builds the UI and starts browsers) is shown in docs/ux/ft1/step0.md.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ciZone, copyPaths, countCopies, cpuList, parseArgs } from "./shake.ts";

describe("npm run shake (FT-1)", () => {
  it("takes one browser test file and the defaults: 8 copies at once on 3 cores, 5 times", () => {
    expect(parseArgs(["e2e/shell/guide.test.ts"])).toEqual({ file: "e2e/shell/guide.test.ts", copies: 8, runs: 5, cores: 3, test: null });
    expect(parseArgs(["./e2e/code/search-inside.test.ts", "--copies", "6", "--runs", "2", "--cores", "4", "--test", "a release"])).toEqual({ file: "e2e/code/search-inside.test.ts", copies: 6, runs: 2, cores: 4, test: "a release" });
  });

  it("refuses what isn't one browser test file, a copy, an unknown option or a count under 1", () => {
    expect(() => parseArgs([])).toThrow(/which browser test file/);
    expect(() => parseArgs(["scripts/guards.test.ts"])).toThrow(/isn't a browser test file/);
    expect(() => parseArgs(["e2e/a.test.ts", "e2e/b.test.ts"])).toThrow(/one file at a time/);
    expect(() => parseArgs(["e2e/shell/guide.shake-3.test.ts"])).toThrow(/that is a copy/);
    expect(() => parseArgs(["e2e/a.test.ts", "--fast"])).toThrow(/unknown option --fast/);
    expect(() => parseArgs(["e2e/a.test.ts", "--copies", "0"])).toThrow(/whole number/);
    expect(() => parseArgs(["e2e/a.test.ts", "--runs", "1.5"])).toThrow(/whole number/);
    expect(() => parseArgs(["e2e/a.test.ts", "--cores"])).toThrow(/needs a value/);
  });

  it("puts the copies beside the file, so its imports work, under a name .gitignore leaves out", () => {
    expect(copyPaths("e2e/shell/guide.test.ts", 3)).toEqual(["e2e/shell/guide.shake-1.test.ts", "e2e/shell/guide.shake-2.test.ts", "e2e/shell/guide.shake-3.test.ts"]);
  });

  it("holds the run to the first cores, never more than the machine has", () => {
    expect(cpuList(3, 20)).toBe("0-2");
    expect(cpuList(8, 4)).toBe("0-3");
    expect(cpuList(1, 20)).toBe("0-0");
  });

  it("counts a copy passed only when its file passed and every test in it that ran passed", () => {
    const copies = copyPaths("e2e/x/y.test.ts", 4);
    const report = {
      testResults: [
        { name: `/repo/${copies[0]}`, status: "passed", assertionResults: [{ status: "passed", title: "a" }, { status: "skipped", title: "b" }] },
        { name: `/repo/${copies[1]}`, status: "failed", assertionResults: [{ status: "passed", title: "a" }, { status: "failed", title: "b", failureMessages: ["AssertionError: expected 1 to be 2\n  at line 9"] }] },
        { name: `/repo/${copies[2]}`, status: "failed", message: "Hook timed out in 120000ms\nmore", assertionResults: [] },
      ],
    };
    const r = countCopies(report, copies);
    expect(r.passed).toBe(1);
    expect(r.failed).toEqual([
      { copy: copies[1], tests: ["b: AssertionError: expected 1 to be 2"] },
      { copy: copies[2], tests: ["the file failed: Hook timed out in 120000ms"] },
      { copy: copies[3], tests: ["didn't run"] },
    ]);
  });

  it("never counts a copy where nothing ran as passed", () => {
    const [c] = copyPaths("e2e/x/y.test.ts", 1);
    expect(countCopies({ testResults: [{ name: c!, status: "passed", assertionResults: [{ status: "skipped", title: "a" }] }] }, [c!]).passed).toBe(0);
  });

  it("runs in CI's time zone, read from ci.yml, and in the machine's when it names none", () => {
    expect(ciZone(readFileSync(join(import.meta.dirname, "..", ".github/workflows/ci.yml"), "utf8")).TZ).toMatch(/^\w+\/\w+/);
    expect(ciZone("jobs:\n  a:\n    env:\n      CI: 1\n")).toEqual({});
  });
});
