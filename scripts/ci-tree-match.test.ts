// CI-3: deploy-dev's reuse check (scripts/ci-tree-match.sh, D456) after a docs-only merge. A docs-only pull request's ci
// run passes with the browser shards, the webkit job and the image skipped, and its test job records no tested tree
// (ci.yml): it didn't test the code under the docs. So the reuse check finds no artifact and answers tested=false, and
// deploy-dev runs all of ci.yml, where a push never skips. A run that ran everything is reused by the same rule as
// before: only when the merged commit's tree is exactly the tree it tested.
// A throwaway repo and a fake `gh` on PATH stand in for GitHub; nothing leaves this machine.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "ci-tree-match.sh");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A fake gh: the PR, its head, a passing run and its tested-tree artifact come from FAKE_* variables. */
const FAKE_GH = `#!/usr/bin/env bash
case "$1 $2" in
  "api repos/contoso/focustime/commits/"*) echo "$FAKE_PR" ;;
  "api repos/contoso/focustime/pulls/"*) echo "$FAKE_HEAD" ;;
  "api repos/contoso/focustime/actions/"*) echo "$FAKE_RUN" ;;
  "run download")
    [[ -n $FAKE_TREE ]] || exit 1
    while [[ $# -gt 0 ]]; do [[ $1 == -D ]] && dir=$2; shift; done
    echo "$FAKE_TREE" > "$dir/tested-tree.txt" ;;
  *) exit 1 ;;
esac
`;

function repo() {
  const d = mkdtempSync(join(tmpdir(), "tree-match-"));
  dirs.push(d);
  const bin = join(d, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  const work = join(d, "work");
  const git = (...a: string[]) => execFileSync("git", a, { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const write = (p: string, s: string) => (mkdirSync(join(work, dirname(p)), { recursive: true }), writeFileSync(join(work, p), s));
  execFileSync("git", ["init", "-q", "-b", "main", work]);
  git("config", "user.email", "dev@example.com");
  git("config", "user.name", "Dev");
  write("ui/app.ts", "1\n");
  write("docs/ux/zz1/notes.md", "before\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return { bin, work, git, write };
}

/** The script's answer, read from $GITHUB_OUTPUT as deploy-dev's reuse job reads it. */
const match = (bin: string, cwd: string, sha: string, fake: Record<string, string>) => {
  const out = join(dirname(bin), `output-${Math.random().toString(36).slice(2)}`);
  writeFileSync(out, "");
  const r = spawnSync("bash", [SCRIPT, "contoso/focustime", sha], { cwd, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: out, ...fake } });
  expect(r.status, r.stderr).toBe(0);
  return readFileSync(out, "utf8").trim().split("\n").join(" ");
};

describe("deploy-dev's reuse after a docs-only merge (CI-3)", () => {
  /** A pull request changing only a doc, tested by its ci run as GitHub's merge into main, then merged. */
  function docsOnlyMerge(opts: { mainMovesAfterTheRun?: boolean } = {}) {
    const r = repo();
    r.git("switch", "-q", "-c", "docs-pr");
    r.write("docs/ux/zz1/notes.md", "after\n");
    r.git("commit", "-qam", "docs only");
    const head = r.git("rev-parse", "HEAD");
    // What the PR's ci run tested: the merge of the PR into main as main was then.
    r.git("switch", "-q", "main");
    r.git("merge", "-q", "--no-ff", "-m", "GitHub's test merge", "docs-pr");
    const testedTree = r.git("rev-parse", "HEAD^{tree}");
    r.git("reset", "-q", "--hard", "HEAD^");
    if (opts.mainMovesAfterTheRun) {
      r.write("ui/app.ts", "2\n");
      r.git("commit", "-qam", "another pull request reached main");
    }
    r.git("merge", "-q", "--no-ff", "-m", "Merge pull request #7", "docs-pr");
    return { ...r, head, testedTree, merged: r.git("rev-parse", "HEAD") };
  }

  it("runs everything after a docs-only merge: its passing run recorded no tested tree", () => {
    const m = docsOnlyMerge();
    expect(match(m.bin, m.work, m.merged, { FAKE_PR: "7", FAKE_HEAD: m.head, FAKE_RUN: "101", FAKE_TREE: "" })).toBe("tested=false pr=7");
  });

  it("still reuses a run that ran everything when it tested exactly the merged tree", () => {
    const m = docsOnlyMerge();
    expect(match(m.bin, m.work, m.merged, { FAKE_PR: "7", FAKE_HEAD: m.head, FAKE_RUN: "101", FAKE_TREE: m.testedTree })).toBe("tested=true pr=7");
  });

  it("runs everything when main moved after the run, so the merged tree was never tested", () => {
    const m = docsOnlyMerge({ mainMovesAfterTheRun: true });
    expect(match(m.bin, m.work, m.merged, { FAKE_PR: "7", FAKE_HEAD: m.head, FAKE_RUN: "101", FAKE_TREE: m.testedTree })).toBe("tested=false pr=7");
  });

  it("runs everything with no passing run, no artifact or no pull request", () => {
    const m = docsOnlyMerge();
    expect(match(m.bin, m.work, m.merged, { FAKE_PR: "7", FAKE_HEAD: m.head, FAKE_RUN: "", FAKE_TREE: m.testedTree })).toBe("tested=false pr=7");
    expect(match(m.bin, m.work, m.merged, { FAKE_PR: "7", FAKE_HEAD: m.head, FAKE_RUN: "101", FAKE_TREE: "" })).toBe("tested=false pr=7");
    expect(match(m.bin, m.work, m.merged, { FAKE_PR: "", FAKE_HEAD: "", FAKE_RUN: "", FAKE_TREE: "" })).toBe("tested=false pr=none");
  });

  // BT-1 F: what runs on a push to main, as the two workflows decide it: ci's own push run answers code=main (no
  // test), and deploy-dev either reuses the pull request's run (same tree) or calls ci.yml, where the answer is code=true
  // and everything runs. So a tested tree is deployed with no second full run anywhere, and an untested one is fully
  // tested once, before the deploy (scripts/ci-workflow.test.ts checks the jobs follow these answers).
  const CHANGES = join(import.meta.dirname, "ci-changes.sh");
  const ciAnswer = (cwd: string, workflow: string) => spawnSync("bash", [CHANGES, "push", workflow], { cwd, encoding: "utf8" }).stdout.trim();
  function onPushToMain(m: ReturnType<typeof docsOnlyMerge>, fake: Record<string, string>) {
    const own = ciAnswer(m.work, "ci");
    const reuse = match(m.bin, m.work, m.merged, fake);
    const called = reuse.startsWith("tested=true") ? null : ciAnswer(m.work, "deploy-dev");
    return { own, reuse, called, fullRuns: [own, called].filter((a) => a === "code=true").length };
  }

  it("deploys a merged tree a pull request's run already tested with no second full run anywhere", () => {
    const m = docsOnlyMerge();
    expect(onPushToMain(m, { FAKE_PR: "7", FAKE_HEAD: m.head, FAKE_RUN: "101", FAKE_TREE: m.testedTree })).toEqual({ own: "code=main", reuse: "tested=true pr=7", called: null, fullRuns: 0 });
  });

  it("tests an untested tree fully, once, before deploying it (main moved, a docs-only run, a direct push)", () => {
    const moved = docsOnlyMerge({ mainMovesAfterTheRun: true });
    const docs = docsOnlyMerge();
    for (const [m, fake] of [
      [moved, { FAKE_PR: "7", FAKE_HEAD: moved.head, FAKE_RUN: "101", FAKE_TREE: moved.testedTree }],
      [docs, { FAKE_PR: "7", FAKE_HEAD: docs.head, FAKE_RUN: "101", FAKE_TREE: "" }],
      [docs, { FAKE_PR: "", FAKE_HEAD: "", FAKE_RUN: "", FAKE_TREE: "" }],
    ] as const)
      expect(onPushToMain(m, fake)).toMatchObject({ own: "code=main", called: "code=true", fullRuns: 1 });
  });

  it("the image leaves out docs/ except docs/technical, so docs-only changes can't change it", () => {
    const ignore = readFileSync(join(import.meta.dirname, "../.dockerignore"), "utf8").split("\n");
    expect(ignore).toContain("docs");
    expect(ignore.filter((l) => l.startsWith("!docs"))).toEqual(["!docs/technical"]);
  });
});
