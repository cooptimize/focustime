// CI-3: scripts/shots-branch.ts puts a folder of images on shots/<step> and nothing else: the branch holds only those
// images, and the working tree, the index, HEAD, main and the local branches are as they were. A throwaway repo with a
// bare repo as its remote, so nothing leaves this machine.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repoFromUrl, shotsBranch } from "./shots-branch.ts";

const SCRIPT = join(import.meta.dirname, "shots-branch.ts");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function setup() {
  const base = mkdtempSync(join(tmpdir(), "shots-"));
  dirs.push(base);
  const remote = join(base, "remote.git");
  const work = join(base, "work");
  const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", work]);
  git(work, "config", "user.email", "dev@example.com");
  git(work, "config", "user.name", "Dev");
  writeFileSync(join(work, ".gitignore"), "screenshots/\n");
  writeFileSync(join(work, "app.ts"), "export const a = 1;\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "first");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "-q", "origin", "main");
  git(work, "switch", "-q", "-c", "feat/zz1");
  writeFileSync(join(work, "app.ts"), "export const a = 2;\n"); // an uncommitted change on the working branch
  mkdirSync(join(work, "screenshots/zz1/phone"), { recursive: true });
  writeFileSync(join(work, "screenshots/zz1/day-dark.png"), PNG);
  writeFileSync(join(work, "screenshots/zz1/phone/day light.png"), PNG);
  const state = () => ({ head: git(work, "rev-parse", "HEAD"), branch: git(work, "branch", "--show-current"), status: git(work, "status", "--porcelain"), branches: git(work, "branch", "--list"), main: git(remote, "rev-parse", "main"), index: git(work, "ls-files", "-s") });
  return { work, remote, git, state };
}

describe("shots-branch (CI-3)", () => {
  it("makes shots/<step> with only the images given, pushes it, and changes nothing else", () => {
    const { work, remote, git, state } = setup();
    const before = state();
    const r = spawnSync(process.execPath, [SCRIPT, "screenshots/zz1", "zz1", "--repo", "contoso/focustime"], { cwd: work, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const commit = git(remote, "rev-parse", "shots/zz1");
    expect(git(remote, "ls-tree", "-r", "--name-only", commit).split("\n")).toEqual(["day-dark.png", "phone/day light.png"]);
    expect(git(remote, "rev-list", "--count", commit)).toBe("1");
    expect(r.stdout.trim().split("\n")).toEqual([`![day-dark.png](https://raw.githubusercontent.com/contoso/focustime/${commit}/day-dark.png)`, `![phone/day light.png](https://raw.githubusercontent.com/contoso/focustime/${commit}/phone/day%20light.png)`]);
    expect(state()).toEqual(before);
  });

  it("updates the branch with a commit on its tip that holds only the new images", () => {
    const { work, remote, git, state } = setup();
    const first = shotsBranch({ folder: "screenshots/zz1", step: "zz1", cwd: work, repo: "contoso/focustime" });
    rmSync(join(work, "screenshots/zz1/phone"), { recursive: true });
    writeFileSync(join(work, "screenshots/zz1/week.png"), PNG);
    const before = state();
    const second = shotsBranch({ folder: "screenshots/zz1", step: "zz1", cwd: work, repo: "contoso/focustime" });
    expect(git(remote, "rev-parse", "shots/zz1")).toBe(second.commit);
    expect(git(remote, "rev-parse", `${second.commit}^`)).toBe(first.commit);
    expect(git(remote, "ls-tree", "-r", "--name-only", second.commit).split("\n")).toEqual(["day-dark.png", "week.png"]);
    expect(state()).toEqual(before);
  });

  it("refuses a folder with anything but images, a bad step name and the archive, before writing anything", () => {
    const { work, remote, git } = setup();
    writeFileSync(join(work, "screenshots/zz1/notes.md"), "# notes\n");
    expect(() => shotsBranch({ folder: "screenshots/zz1", step: "zz1", cwd: work, repo: "contoso/focustime" })).toThrow(/only images.*notes\.md/);
    rmSync(join(work, "screenshots/zz1/notes.md"));
    for (const step of ["archive", "ZZ1", "zz1..x", "../main", ""]) expect(() => shotsBranch({ folder: "screenshots/zz1", step, cwd: work, repo: "contoso/focustime" }), step).toThrow(/step must be/);
    expect(git(remote, "branch", "--list")).toBe("* main");
  });

  it("reads owner and name from a GitHub remote", () => {
    expect(repoFromUrl("https://github.com/contoso/focustime.git")).toBe("contoso/focustime");
    expect(repoFromUrl("git@github.com:contoso/focustime.git")).toBe("contoso/focustime");
    expect(repoFromUrl("/tmp/remote.git")).toBe(null);
  });
});
