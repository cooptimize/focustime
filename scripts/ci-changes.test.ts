// CI-3: scripts/ci-changes.sh decides whether a ci run may skip the browser shards, the WebKit job and the image. It
// may only for a pull request whose every changed file is under docs/ and outside docs/technical/; anything else, or
// anything it can't tell, runs everything.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "ci-changes.sh");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const classify = (paths: string[]) => spawnSync("bash", [SCRIPT, "--classify"], { input: paths.join("\n") + "\n", encoding: "utf8" });
const code = (paths: string[]) => classify(paths).stdout.trim();

describe("which changes skip the heavy jobs (CI-3)", () => {
  it("skips them for docs outside docs/technical only", () => {
    expect(code(["docs/ux/zz1/notes.md"])).toBe("code=false");
    expect(code(["docs/decisions.md", "docs/open-questions.md", "docs/decisions/mc-6.md", "docs/open-questions/mc-6.md", "docs/ux/README.md", "docs/azure/runbook.md", "docs/demo/script.md"])).toBe("code=false");
  });

  it.each([
    ["docs/technical", ["docs/technical/operations.md"]],
    ["a technical diagram", ["docs/technical/diagrams/flow.svg"]],
    ["a test", ["e2e/day/today.test.ts"]],
    ["a unit test", ["plan/fit.test.ts"]],
    ["a script", ["scripts/guards.ts"]],
    ["a workflow", [".github/workflows/ci.yml"]],
    ["a source file", ["ui/Today.tsx"]],
    ["the image's recipe", ["Dockerfile"]],
    ["what the image leaves out", [".dockerignore"]],
    ["packages", ["package-lock.json"]],
    ["a top-level note the image copies", ["CLAUDE.md"]],
    ["README", ["README.md"]],
    ["infra", ["infra/main.bicep"]],
    ["a docs file and a source file", ["docs/ux/zz1/notes.md", "server/main.ts"]],
    ["a folder named like docs", ["docs-old/x.md"]],
    ["nothing", []],
  ])("runs everything for %s", (_, paths) => expect(code(paths)).toBe("code=true"));

  it("says which path made it code", () => expect(classify(["docs/ux/a.md", "ui/a.tsx"]).stderr).toContain("code: ui/a.tsx"));

  it("runs everything for any event but a pull request", () => {
    for (const event of ["push", "workflow_dispatch", ""]) expect(spawnSync("bash", [SCRIPT, event], { encoding: "utf8" }).stdout.trim()).toBe("code=true");
  });

  // BT-1: ci's own run on a push to main saves the caches only; deploy-dev's call of ci (the workflow is deploy-dev)
  // runs everything, as does any other workflow name or none.
  it("answers main only for ci's own push run, and true when deploy-dev calls ci on the same push", () => {
    const run = (...a: string[]) => spawnSync("bash", [SCRIPT, ...a], { encoding: "utf8" }).stdout.trim();
    expect(run("push", "ci")).toBe("code=main");
    for (const [event, workflow] of [["push", "deploy-dev"], ["push", ""], ["push", "CI"], ["workflow_dispatch", "ci"], ["pull_request", "ci"]]) expect(run(event!, workflow!), `${event} ${workflow}`).not.toBe("code=main");
    expect(run("push", "deploy-dev")).toBe("code=true");
    // ci.yml passes "called" for any call of it (its workflow_call input), so this holds even if GitHub named it ci.
    expect(run("push", "called")).toBe("code=true");
  });

  /** A repo whose HEAD is a merge of a branch changing `paths` into main, as GitHub's refs/pull/N/merge is. */
  function merged(paths: string[], opts: { rename?: [string, string] } = {}): string {
    const d = mkdtempSync(join(tmpdir(), "ci-changes-"));
    dirs.push(d);
    const git = (...a: string[]) => execFileSync("git", a, { cwd: d, stdio: "ignore" });
    const write = (p: string, s: string) => (mkdirSync(join(d, dirname(p)), { recursive: true }), writeFileSync(join(d, p), s));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "dev@example.com");
    git("config", "user.name", "Dev");
    write("ui/app.ts", "1\n");
    write("docs/ux/old.md", "old\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git("switch", "-q", "-c", "pr");
    for (const p of paths) write(p, "changed\n");
    if (opts.rename) git("mv", opts.rename[0], opts.rename[1]);
    git("add", "-A");
    git("commit", "-q", "-m", "pr");
    git("switch", "-q", "main");
    write("ui/other.ts", "main moved\n"); // main moved meanwhile: only the pull request's own changes count
    git("add", "-A");
    git("commit", "-q", "-m", "main moved");
    git("merge", "-q", "--no-ff", "-m", "merge", "pr");
    return d;
  }
  const inRepo = (d: string) => spawnSync("bash", [SCRIPT, "pull_request"], { cwd: d, encoding: "utf8" }).stdout.trim();

  it("compares GitHub's merge commit with main: a docs-only pull request skips", () => expect(inRepo(merged(["docs/ux/zz1/notes.md"]))).toBe("code=false"));
  it("a pull request touching docs/technical runs everything", () => expect(inRepo(merged(["docs/technical/data.md"]))).toBe("code=true"));
  it("a rename out of docs counts both paths", () => expect(inRepo(merged([], { rename: ["docs/ux/old.md", "ui/old.md"] }))).toBe("code=true"));
  it("a commit that isn't a merge runs everything", () => {
    const d = merged(["docs/ux/zz1/notes.md"]);
    execFileSync("git", ["reset", "-q", "--hard", "HEAD^2"], { cwd: d });
    expect(inRepo(d)).toBe("code=true");
  });
});
