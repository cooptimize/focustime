// HK-1: the guards find a planted name the same way whoever runs them. A throwaway git repo gets a real client name
// in a tracked file and in an untracked one, and a type name used as code in ui/; `npm run guards`'s command (the
// script, as CI runs it) and the function the guard tests call both fail on all of them. Ignored files are skipped.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ARCHIVE, LARGE_OK, OFFICE, runGuards, stepIndexHits } from "./guards.ts";

const SCRIPT = join(import.meta.dirname, "guards.ts");
const client = Buffer.from("VyZD", "base64").toString("utf8");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "guards-"));
  dirs.push(d);
  const git = (...a: string[]) => execFileSync("git", a, { cwd: d, stdio: "ignore" });
  git("init", "-q");
  mkdirSync(join(d, "ui"));
  writeFileSync(join(d, ".gitignore"), "ignored/\n");
  writeFileSync(join(d, "ui/clean.ts"), 'export const name = "Tailspin & Wingtip";\n');
  git("add", "-A");
  return d;
}
const cli = (root: string) => spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });

describe("one guard script (HK-1)", () => {
  it("passes a clean repo", () => {
    const d = repo();
    expect(runGuards(d).hits).toEqual([]);
    expect(cli(d).status).toBe(0);
  });

  it("fails on a planted name in a tracked file and in an untracked one, both ways", () => {
    const d = repo();
    writeFileSync(join(d, "ui/tracked.ts"), `export const a = "${client.toLowerCase()} delivery";\n`);
    execFileSync("git", ["add", "ui/tracked.ts"], { cwd: d });
    writeFileSync(join(d, "ui/untracked.ts"), `// for ${client}\n`);
    mkdirSync(join(d, "ignored"));
    writeFileSync(join(d, "ignored/x.ts"), `// ${client}\n`);
    expect(runGuards(d).hits.map((h) => h.at)).toEqual(["ui/tracked.ts:1", "ui/untracked.ts:1"]);
    const r = cli(d);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ui/tracked.ts:1");
    expect(r.stderr).toContain("ui/untracked.ts:1");
    expect(r.stderr).not.toContain("ignored/");
    expect(r.stderr).not.toContain(client);
  });

  it("fails on pick in the to-do sense in text people read (TD-1)", () => {
    const d = repo();
    writeFileSync(join(d, "ui/words.ts"), 'export const a = "Move pick";\nexport const b = { kind: "pick", action: "pick.move" };\n');
    const r = cli(d);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/1 words hit.*\n\s+ui\/words\.ts:1/);
  });

  it("fails on a retired name or a control written as a character in text people read (NM-1)", () => {
    const d = repo();
    writeFileSync(join(d, "ui/keys2.ts"), 'export const does = "Actions (⋯) for what has focus";\nexport const tip = "Back to Today";\nexport const ok = { label: "Day", aka: ["Today"] };\n');
    expect(runGuards(d).hits.map((h) => h.at.split(": ").slice(0, 2).join(": "))).toEqual(["ui/keys2.ts:1: a control as a character", "ui/keys2.ts:2: Today (the tab)"]);
  });

  it("fails on a type name used as code in ui/, tracked or not", () => {
    const d = repo();
    writeFileSync(join(d, "ui/kind.ts"), 'export const isFeature = (t: { type: string }) => t.type === "Feature";\n');
    const r = cli(d);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/1 process hit.*\n\s+ui\/kind\.ts:1/);
  });

  // CI-3: images leave main; a step's screenshots go on its shots/<step> branch.
  it("fails on an image or a video added under docs/ux, tracked or not, and names nothing else", () => {
    const d = repo();
    mkdirSync(join(d, "docs/ux/zz1"), { recursive: true });
    writeFileSync(join(d, "docs/ux/zz1/notes.md"), "# ZZ-1\n");
    writeFileSync(join(d, "docs/ux/zz1/after.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    execFileSync("git", ["add", "-A"], { cwd: d });
    writeFileSync(join(d, "docs/ux/zz1/walk.webm"), "x");
    const r = cli(d);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/2 files hit.*shots\/<step>/);
    expect(r.stderr).toContain("docs/ux/zz1/after.png: an image or video under docs/ux");
    expect(r.stderr).toContain("docs/ux/zz1/walk.webm");
    expect(r.stderr).not.toContain("notes.md");
  });

  // PV-1, FT-1: an archive anywhere in the repository fails, whatever its size, tracked or not.
  it("fails on an archive anywhere, under docs/ or outside it, small or large", () => {
    const d = repo();
    mkdirSync(join(d, "docs/ux/zz2"), { recursive: true });
    mkdirSync(join(d, "docs/demo"), { recursive: true });
    writeFileSync(join(d, "docs/ux/zz2/handoff.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    execFileSync("git", ["add", "-A"], { cwd: d });
    writeFileSync(join(d, "docs/demo/shots.tar.gz"), Buffer.alloc(301 * 1024, 1));
    mkdirSync(join(d, "assets"), { recursive: true });
    writeFileSync(join(d, "assets/kit.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    writeFileSync(join(d, "ui/backup.7z"), Buffer.from([0x37, 0x7a]));
    expect(runGuards(d).hits.filter((h) => h.guard === "files").map((h) => h.at)).toEqual(["assets/kit.zip: an archive", "docs/demo/shots.tar.gz: an archive", "docs/ux/zz2/handoff.zip: an archive", "ui/backup.7z: an archive"]);
    const r = cli(d);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/4 files hit.*never in an archive/);
  });

  // FT-1: an Office file is a zip inside and can hold pictures: refused anywhere, whatever its size.
  it("fails on an Office file anywhere, and not on a file that only has a similar name", () => {
    const d = repo();
    mkdirSync(join(d, "docs/plan"), { recursive: true });
    mkdirSync(join(d, "assets"), { recursive: true });
    for (const f of ["docs/plan/handoff.docx", "assets/numbers.XLSX", "deck.pptx", "assets/sheet.ods"]) writeFileSync(join(d, f), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    writeFileSync(join(d, "docs/plan/docx-notes.md"), "About a .docx file, in words.\n");
    expect(runGuards(d).hits.filter((h) => h.guard === "files").map((h) => h.at)).toEqual(["assets/numbers.XLSX: an Office file", "assets/sheet.ods: an Office file", "deck.pptx: an Office file", "docs/plan/handoff.docx: an Office file"]);
    const r = cli(d);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/4 files hit.*never in an archive or an Office file/);
  });

  it("allows no archive or Office file as a large file", () => {
    expect(Object.keys(LARGE_OK).filter((k) => ARCHIVE.test(k) || OFFICE.test(k))).toEqual([]);
  });

  it("fails on a file over 300 KB outside the folders that need large files, and passes one inside them", () => {
    const d = repo();
    const big = Buffer.alloc(301 * 1024, 1);
    mkdirSync(join(d, "assets"), { recursive: true });
    writeFileSync(join(d, "assets/huge.bin"), big);
    mkdirSync(join(d, "docs/demo"), { recursive: true });
    writeFileSync(join(d, "docs/demo/walk.gif"), big);
    writeFileSync(join(d, "ui/small.png"), Buffer.alloc(299 * 1024, 1));
    expect(runGuards(d).hits.map((h) => h.at)).toEqual(["assets/huge.bin: 301 KB"]);
    expect(cli(d).status).toBe(1);
  });

  it("fails on a step heading or a decision row added to an index, and passes the index without it (DOC-1)", () => {
    const d = repo();
    mkdirSync(join(d, "docs/decisions"), { recursive: true });
    const index = "# Decision log\n\n- [MC-6: Calls polish (Nov 18)](decisions/mc-6.md)\n";
    writeFileSync(join(d, "docs/decisions.md"), index);
    writeFileSync(join(d, "docs/decisions/mc-6.md"), "## MC-6: Calls polish (Nov 18)\n\n| # | Status | Decision |\n|---|---|---|\n| - | Done | A row. |\n");
    expect(runGuards(d).hits).toEqual([]);
    expect(cli(d).status).toBe(0);
    writeFileSync(join(d, "docs/decisions.md"), `${index}\n## ZZ-9: A made-up step (Nov 19)\n\n| # | Status | Decision |\n|---|---|---|\n| - | Done | A row. |\n`);
    expect(runGuards(d).hits.map((h) => h.at.split(":").slice(0, 2).join(":"))).toEqual(["docs/decisions.md:5", "docs/decisions.md:7", "docs/decisions.md:8", "docs/decisions.md:9"]);
    const r = cli(d);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/step docs hit.*docs\/decisions\/<step>\.md/);
    expect(stepIndexHits("docs/open-questions.md", "# Open questions\n## XY-1\n- Q.\n")).toEqual([2]);
    expect(stepIndexHits("docs/decisions/mc-6.md", "## MC-6\n| - | Done | x |\n")).toEqual([]);
  });

  it("names a reason for every file that may be large", () => {
    for (const [path, why] of Object.entries(LARGE_OK)) expect(why.length, path).toBeGreaterThan(20);
  });

  it("passes this repo: no image under docs/ux, no archive or Office file anywhere and no unexpected large file", () => {
    expect(runGuards(join(import.meta.dirname, "..")).hits.filter((h) => h.guard === "files")).toEqual([]);
  });
});
