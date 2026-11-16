// PF-1: the limit on the app's first download (the unit job). A real build is measured (scripts/first-download.ts)
// against the record in test/first-download.json: the script and the styles the first screen needs, gzipped, must be
// within their limits, and no screen that loads when first opened (ui/screens.ts) may be in the first download. A
// failure names the modules that arrived or grew and the chain of imports that pulled a screen back in.
// To raise the limit on purpose: node scripts/first-download.ts --write, and say why in the pull request.
import { beforeAll, describe, expect, it } from "vitest";
import { check, grew, measure, onDemand, readRecord, type Record_, type Report } from "./first-download.ts";

describe("the first download's limit (PF-1)", () => {
  let r: Report;
  const record = readRecord()!;
  beforeAll(async () => {
    r = await measure();
  }, 120_000);

  it("this build is within its limits and holds no screen that loads on demand", () => {
    expect(record, "test/first-download.json is missing: node scripts/first-download.ts --write").not.toBeNull();
    expect(check(r, record).join("\n\n")).toBe("");
  });

  it("the first download is the page, its three small scripts, the main script and two stylesheets", () => {
    const names = r.first.map((f) => f.file.replace(/-[A-Za-z0-9_-]{8}\.(js|css)$/, ".$1")).sort();
    expect(names).toEqual(["assets/boot.js", "assets/index.css", "assets/index.js", "assets/main.css", "assets/main.js", "assets/rolldown-runtime.js", "index.html", "prefs.js"]);
  });

  it("every screen in ui/screens.ts is its own file, and no module is in two files", () => {
    const lazy = onDemand();
    expect(lazy.length).toBeGreaterThanOrEqual(16);
    const files = lazy.map((m) => r.chunkOf[m]);
    for (const [i, m] of lazy.entries()) expect(files[i], `${m} has a file`).toBeTruthy();
    expect(new Set(files).size, "one file per screen").toBe(lazy.length);
    for (const f of files) expect(r.first.map((x) => x.file)).not.toContain(f);
    // The limit is a little above what was measured, never far above.
    expect(record.limit.script).toBeLessThanOrEqual(Math.ceil(record.measured.script * 1.05));
    expect(record.limit.styles).toBeLessThanOrEqual(Math.ceil(record.measured.styles * 1.05));
  });

  it("the check fails when a screen's code is pulled back into the first download, and names it", () => {
    // What the build reports when Day imports Backlog's grid again: the screen and what it brings are in main.
    const modules = { ...r.modules, "ui/ahead/Ahead.tsx": 60_000, "ui/ahead/Grid.tsx": 90_000, "ui/Day.tsx": (r.modules["ui/Day.tsx"] ?? 0) + 150 };
    const why = (m: string) => (m.startsWith("ui/ahead/") ? ["ui/main.tsx", "ui/App.tsx", "ui/Day.tsx", m] : r.why(m));
    const bad = check({ script: { raw: r.script.raw + 70_000, gzip: record.limit.script + 20_000 }, styles: r.styles, modules, why }, record);
    expect(bad).toHaveLength(2);
    expect(bad[0]).toContain("ui/ahead/Ahead.tsx loads when first opened");
    expect(bad[0]).toContain("ui/main.tsx → ui/App.tsx → ui/Day.tsx → ui/ahead/Ahead.tsx");
    expect(bad[1]).toMatch(/over its limit of/);
    expect(bad[1]).toMatch(/new: ui\/ahead\/Grid\.tsx \+90\.0 kB \(through ui\/App\.tsx → ui\/Day\.tsx\)/);
    expect(bad[1]).toMatch(/new: ui\/ahead\/Ahead\.tsx \+60\.0 kB/);
    // A small change in a module already there isn't named (under 0.2 kB).
    expect(bad[1]).not.toContain("ui/Day.tsx +");
  });

  it("names what grew: new modules and larger ones, the largest change first", () => {
    const then = { "a.ts": 1000, "b.ts": 5000, "gone.ts": 300 };
    expect(grew({ "a.ts": 1100, "b.ts": 9000, "c.ts": 2500 }, then)).toEqual([
      { module: "b.ts", by: 4000, isNew: false },
      { module: "c.ts", by: 2500, isNew: true },
    ]);
    const within: Record_ = { limit: { script: 10, styles: 10 }, measured: { script: 9, styles: 9 }, modules: {} };
    expect(check({ script: { raw: 20, gzip: 10 }, styles: { raw: 20, gzip: 10 }, modules: {}, why: () => [] }, within, [])).toEqual([]);
    expect(check({ script: { raw: 20, gzip: 10 }, styles: { raw: 20, gzip: 11 }, modules: {}, why: () => [] }, within, [])[0]).toMatch(/styles are .* over their limit/);
  });
});
