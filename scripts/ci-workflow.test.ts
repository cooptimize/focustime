// CI-3: ci.yml runs every test it ran before on a code change. Read as text (no YAML parser in the repo): each job's
// block under `jobs:` is the lines from its key to the next job's key.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const CI = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** Each job's text, by its key. */
function jobs(yml: string): Record<string, string> {
  const body = yml.slice(yml.indexOf("\njobs:\n") + 7);
  const out: Record<string, string> = {};
  let key: string | null = null;
  for (const line of body.split("\n")) {
    const m = line.match(/^ {2}([a-z][\w-]*):\s*$/);
    if (m) key = m[1]!;
    else if (key && !/^ {2}#/.test(line)) out[key] = (out[key] ?? "") + line + "\n";
  }
  return out;
}
const J = jobs(CI);
const DEPLOY = readFileSync(join(ROOT, ".github/workflows/deploy-dev.yml"), "utf8");
const D = jobs(DEPLOY);
const runs = (job: string) => [...J[job]!.matchAll(/npx vitest run ([^\n]*)/g)].map((m) => m[1]!);

/** Browser test files that start WebKit, in any screen's folder (BT-1). */
const webkitUsers = (readdirSync(join(ROOT, "e2e"), { recursive: true }) as string[])
  .map((f) => f.split("\\").join("/"))
  .filter((f) => f.endsWith(".test.ts"))
  .filter((f) => /startDemo\(\s*["']webkit["']|webkit\.launch\(/.test(readFileSync(join(ROOT, "e2e", f), "utf8")))
  .map((f) => `e2e/${f}`);

describe("ci.yml runs the same tests (CI-3)", () => {
  it("keeps the jobs and the names that deploy-dev and any branch rule may depend on", () => {
    expect(Object.keys(J)).toEqual(expect.arrayContaining(["unit", "browser", "webkit", "test", "infra", "image"]));
    expect(J.unit).toMatch(/^ {4}name: Unit and store tests \(SQLite and SQL Server\)$/m);
    expect(J.browser).toMatch(/^ {4}name: Browser tests \$\{\{ matrix\.shard \}\}\/6 \(Chromium and WebKit\)$/m);
    expect(J.browser).toMatch(/shard: \[1, 2, 3, 4, 5, 6\]/);
    expect(J.test).not.toMatch(/^ {4}name:/m);
    expect(J.test).toMatch(/name: tested-tree/);
    expect(J.test).toMatch(/needs: \[changes, unit, browser, webkit\]/);
  });

  it("runs the unit and store half on every file outside e2e/", () => expect(runs("unit")).toEqual(["--exclude 'e2e/**' --reporter=default"]));

  it("runs every browser file in the shards except the WebKit ones, and those in the webkit job", () => {
    expect(webkitUsers).toEqual(["e2e/shell/safari.test.ts"]);
    const excluded = [...runs("browser")[0]!.matchAll(/--exclude (\S+)/g)].map((m) => m[1]);
    expect(runs("browser")).toHaveLength(1);
    expect(runs("browser")[0]).toMatch(/^e2e\/ --shard=\$\{\{ matrix\.shard \}\}\/6 /);
    expect(excluded).toEqual(webkitUsers);
    expect(runs("webkit")).toEqual([`${webkitUsers.join(" ")} --reporter=default`]);
  });

  it("sets up WebKit only in the webkit job", () => {
    for (const [key, text] of Object.entries(J)) {
      const webkitSetup = /playwright-core install|ci-webkit-deps\.sh|apt-webkit|FOCUSTIME_TEST_WEBKIT|ms-playwright/.test(text);
      expect(webkitSetup, key).toBe(key === "webkit");
    }
  });

  // C: a docs-only pull request skips the heavy jobs' steps; everything else runs as before.
  const RUN_IF = "if: needs.changes.outputs.code != 'false'";
  /** Each step of a job: its text from "      - " to the next. */
  const steps = (job: string) => J[job]!.split(/\n(?= {6}- )/).filter((x) => /^ {6}- /.test(x));

  it("decides once, in the changes job, from the event and the pull request's own changes", () => {
    expect(J.changes).toMatch(/bash scripts\/ci-changes\.sh "\$\{\{ github\.event_name \}\}" "\$\{\{ github\.workflow \}\}" >> "\$GITHUB_OUTPUT"/);
    expect(J.changes).toMatch(/fetch-depth: 2/);
    expect(J.changes).toMatch(/code: \$\{\{ steps\.changes\.outputs\.code \}\}/);
  });

  const OFF_ON_MAIN = "if: needs.changes.outputs.code != 'main'";
  it("skips only the browser shards, the webkit job and the image, step by step, so each still reports by its name", () => {
    for (const job of ["browser", "webkit", "image"]) {
      expect(J[job], job).toMatch(/^ {4}needs: changes$/m);
      // BT-1: the shards and the image don't start at all on ci's own push to main; the webkit job fills its caches.
      const jobIf = J[job]!.split("\n").filter((l) => /^ {4}if:/.test(l));
      expect(jobIf, job).toEqual(job === "webkit" ? [] : [`    ${OFF_ON_MAIN}`]);
      for (const step of steps(job)) {
        if (/name: Docs only, nothing to run here/.test(step)) expect(step).toMatch(/if: needs\.changes\.outputs\.code == 'false'\n/);
        else expect(step.split("\n").find((l) => /^ {8}if: /.test(l)), step.split("\n")[0]).toMatch(new RegExp(`^ {8}${RUN_IF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( && .+)?$`));
      }
    }
  });

  it("never skips on an empty or missing answer: only an explicit code=false skips", () => {
    expect(CI).not.toMatch(/needs\.changes\.outputs\.code == 'true'/);
    expect(CI).not.toMatch(/needs\.changes\.outputs\.code != 'true'/);
  });

  it("always runs the unit job, infra and the gate on a pull request", () => {
    expect(J.infra).not.toMatch(/needs\.changes|^ {4}if:/m);
    // BT-1: the unit job and the gate are off only on ci's own push to main; with no answer from What changed (empty
    // output) the unit job still runs.
    expect(J.unit!.split("\n").filter((l) => /^ {4}if:/.test(l))).toEqual(["    if: ${{ !cancelled() && needs.changes.outputs.code != 'main' }}"]);
    expect(J.test!.split("\n").filter((l) => /^ {4}if:/.test(l))).toEqual([`    ${OFF_ON_MAIN}`]);
  });

  // BT-1 F: a merge isn't tested twice. ci's own push to main runs no test; every tree on main is still tested once
  // before deploy-dev deploys it: by the pull request's run (the reuse check), or by deploy-dev calling ci.yml, where
  // the workflow is deploy-dev and the answer is code=true (scripts/ci-changes.test.ts).
  it("on ci's own push to main runs no test step, and fills the WebKit caches", () => {
    for (const [key, text] of Object.entries(J)) {
      if (!/npx vitest run|docker build|npm run (typecheck|guards)/.test(text)) continue;
      const jobOff = text.split("\n").some((l) => l.startsWith("    if:") && l.includes("!= 'main'"));
      const stepsOff = steps(key).filter((st) => /npx vitest run|docker build/.test(st)).every((st) => /if: .*!= 'main'/.test(st));
      expect(jobOff || stepsOff, key).toBe(true);
    }
    const cacheSteps = steps("webkit").filter((st) => /actions\/cache|Install WebKit|ci-webkit-deps/.test(st));
    expect(cacheSteps.length).toBeGreaterThanOrEqual(4);
    for (const st of cacheSteps) expect(st, st.split("\n")[0]).not.toMatch(/!= 'main'/);
  });

  it("leaves deploy-dev's guarantee as it was: an untested tree gets all of ci.yml before the deploy", () => {
    expect(DEPLOY).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
    expect(D.reuse).toMatch(/bash scripts\/ci-tree-match\.sh "\$\{\{ github\.repository \}\}" "\$\{\{ github\.sha \}\}"/);
    expect(D.ci).toMatch(/if: needs\.reuse\.outputs\.tested != 'true'\n {4}uses: \.\/\.github\/workflows\/ci\.yml/);
    expect(D.typecheck).toMatch(/if: needs\.reuse\.outputs\.tested == 'true'/);
    expect(D.deploy).toMatch(/needs: \[reuse, ci, typecheck\]/);
    expect(D.deploy).toMatch(/needs\.ci\.result == 'success' \|\| needs\.typecheck\.result == 'success'/);
    // ci-tree-match only reuses a pull_request run: ci's own push run (which tests nothing) can never be reused.
    expect(readFileSync(join(ROOT, "scripts/ci-tree-match.sh"), "utf8")).toMatch(/event=pull_request/);
  });

  // The review's finding: a docs-only run must never hand deploy-dev a tree to reuse, or code that failed main's own
  // run could be deployed under a docs-only merge.
  it("records the tested tree only on a run that ran everything", () => {
    for (const step of steps("test")) expect(step.split("\n").find((l) => /^ {8}if: /.test(l)), step.split("\n")[0]).toBe(`        ${RUN_IF}`);
  });

  // D: the screenshot scripts run only on purpose (npm run shots), never in the suite.
  it("keeps the screenshot scripts out of the suite", () => {
    const scripts = readdirSync(join(ROOT, "e2e/shot-scripts"));
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((f) => /\.test\.tsx?$/.test(f))).toEqual([]);
    expect(readFileSync(join(ROOT, "vite.config.ts"), "utf8")).toMatch(/"e2e\/\*\*\/\*\.test\.ts"/);
  });
});
