// HK-1: the guards find a planted name the same way whoever runs them. A throwaway git repo gets a real client name
// in a tracked file and in an untracked one, and a type name used as code in ui/; `npm run guards`'s command (the
// script, as CI runs it) and the function the guard tests call both fail on all of them. Ignored files are skipped.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGuards } from "./guards.ts";

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

  it("fails on a type name used as code in ui/, tracked or not", () => {
    const d = repo();
    writeFileSync(join(d, "ui/kind.ts"), 'export const isFeature = (t: { type: string }) => t.type === "Feature";\n');
    const r = cli(d);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/1 process hit.*\n\s+ui\/kind\.ts:1/);
  });
});
