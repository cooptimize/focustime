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
    expect(J.changes).toMatch(/bash scripts\/ci-changes\.sh "\$\{\{ github\.event_name \}\}" >> "\$GITHUB_OUTPUT"/);
    expect(J.changes).toMatch(/fetch-depth: 2/);
    expect(J.changes).toMatch(/code: \$\{\{ steps\.changes\.outputs\.code \}\}/);
  });

  it("skips only the browser shards, the webkit job and the image, step by step, so each still reports by its name", () => {
    for (const job of ["browser", "webkit", "image"]) {
      expect(J[job], job).toMatch(/^ {4}needs: changes$/m);
      expect(J[job], job).not.toMatch(/^ {4}if:/m);
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

  it("always runs the unit job, infra and the gate", () => {
    for (const job of ["unit", "infra"]) expect(J[job], job).not.toMatch(/needs\.changes|^ {4}if:/m);
    expect(J.test).not.toMatch(/^ {4}if:/m);
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
