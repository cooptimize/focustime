// FT-1: shakes a browser test before it merges. Runs copies of one e2e file at once, on a few cores only, a given
// number of times, and says how many copies passed. A test that waits on the clock instead of on the thing itself
// passes alone and fails here, as it would one CI run in ten.
//
//   npm run shake -- e2e/shell/opening-and-brand.test.ts                 8 copies at once on 3 cores, 5 times (40 copies)
//   npm run shake -- <file> --copies 6 --cores 4 --runs 3 --test "a release"
//
// The copies sit beside the file (`<name>.shake-<n>.test.ts`, so its imports work unchanged) only while it runs, and
// are removed at the end, on Ctrl+C too. The UI is built once, as CI's run builds it (test/e2e-build.ts), into a temp
// folder removed at the end. Each run is vitest's browser project as CI runs it (CI=1, CI's time zone from ci.yml), held to
// the first `--cores` CPUs with taskset. Passing: every copy of every run. Exit code 0 only then.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

export type ShakeArgs = { file: string; copies: number; runs: number; cores: number; test: string | null };

export function parseArgs(argv: readonly string[]): ShakeArgs {
  const out: ShakeArgs = { file: "", copies: 8, runs: 5, cores: 3, test: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    const num = () => {
      const n = Number(val());
      if (!Number.isInteger(n) || n < 1) throw new Error(`${a} needs a whole number of 1 or more`);
      return n;
    };
    if (a === "--copies") out.copies = num();
    else if (a === "--runs") out.runs = num();
    else if (a === "--cores") out.cores = num();
    else if (a === "--test") out.test = val();
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else if (out.file) throw new Error("one file at a time");
    else out.file = a;
  }
  if (!out.file) throw new Error("which browser test file? (e2e/<screen>/<name>.test.ts)");
  if (!/^e2e\/.+\.test\.ts$/.test(out.file.replace(/^\.\//, ""))) throw new Error(`${out.file} isn't a browser test file (e2e/**/*.test.ts)`);
  if (/\.shake-\d+\.test\.ts$/.test(out.file)) throw new Error("that is a copy; give the file itself");
  out.file = out.file.replace(/^\.\//, "");
  return out;
}

/** The copies' paths, beside the file. */
export const copyPaths = (file: string, copies: number): string[] => Array.from({ length: copies }, (_, i) => join(dirname(file), basename(file, ".test.ts") + `.shake-${i + 1}.test.ts`));

/** The CPUs to hold the run to: the first `cores`, never more than the machine has. */
export const cpuList = (cores: number, machine = availableParallelism()): string => `0-${Math.min(cores, machine) - 1}`;

/** The time zone CI's jobs run in (`TZ:` in ci.yml), so a run here sees the same clock; none found, the machine's. */
export const ciZone = (workflow: string): { TZ?: string } => {
  const m = /^\s*TZ:\s*["']?([\w/+-]+)["']?\s*$/m.exec(workflow);
  return m ? { TZ: m[1]! } : {};
};

type Report = { testResults?: { name: string; status: string; message?: string; assertionResults?: { status: string; title: string; failureMessages?: string[] }[] }[] };

/** Per copy: passed only when every test in it that ran passed (and at least one ran). */
export function countCopies(report: Report, copies: readonly string[]): { passed: number; failed: { copy: string; tests: string[] }[] } {
  let passed = 0;
  const failed: { copy: string; tests: string[] }[] = [];
  for (const c of copies) {
    const r = report.testResults?.find((t) => t.name.endsWith(c));
    const ran = (r?.assertionResults ?? []).filter((a) => a.status === "passed" || a.status === "failed");
    const bad = ran.filter((a) => a.status === "failed");
    if (r && r.status === "passed" && ran.length && !bad.length) passed++;
    else failed.push({ copy: c, tests: bad.length ? bad.map((a) => `${a.title}: ${(a.failureMessages?.[0] ?? "").split("\n")[0]!.slice(0, 400)}`) : [r ? `the file ${r.status}${r.message ? `: ${r.message.split("\n")[0]!.slice(0, 400)}` : ""}` : "didn't run"] });
  }
  return { passed, failed };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(import.meta.dirname, "..");
  if (!existsSync(join(root, args.file))) throw new Error(`no such file: ${args.file}`);
  const copies = copyPaths(args.file, args.copies);
  const work = mkdtempSync(join(tmpdir(), "focustime-shake-"));
  const cleanup = () => {
    for (const c of copies) rmSync(join(root, c), { force: true });
    rmSync(work, { recursive: true, force: true });
  };
  const onSignal = () => (cleanup(), process.exit(130));
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const env = { ...process.env, CI: "1", ...ciZone(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8")), TMPDIR: work, FOCUSTIME_TEST_WORKERS: String(args.copies) };
  let total = 0;
  let passed = 0;
  try {
    // The UI once for every run, as test/e2e-build.ts makes it.
    const dist = join(work, "dist");
    const built = spawnSync(process.execPath, ["--input-type=module", "-e", `import { build } from "vite"; await build({ root: ${JSON.stringify(root)}, configFile: ${JSON.stringify(join(root, "vite.config.ts"))}, logLevel: "error", build: { outDir: ${JSON.stringify(dist)}, emptyOutDir: true } });`], { cwd: root, env: { ...env, NODE_ENV: "test" }, stdio: "inherit" });
    if (built.status !== 0) throw new Error("the UI didn't build");
    for (const c of copies) copyFileSync(join(root, args.file), join(root, c));
    const taskset = spawnSync("taskset", ["--version"]).status === 0;
    process.stdout.write(`Shaking ${args.file}${args.test ? ` (tests matching "${args.test}")` : ""}: ${args.copies} copies at once${taskset ? ` on ${Math.min(args.cores, availableParallelism())} cores` : " (no taskset: on every core)"}, ${args.runs} times.\n`);
    for (let run = 1; run <= args.runs; run++) {
      const out = join(work, `run-${run}.json`);
      const vitest = [join(root, "node_modules/vitest/vitest.mjs"), "run", "--project", "browser", ...copies, "--reporter=dot", "--reporter=json", `--outputFile.json=${out}`, ...(args.test ? ["-t", args.test] : [])];
      const cmd = taskset ? ["taskset", ["-c", cpuList(args.cores), process.execPath, ...vitest]] as const : [process.execPath, vitest] as const;
      spawnSync(cmd[0], [...cmd[1]], { cwd: root, env: { ...env, FOCUSTIME_E2E_DIST: dist }, stdio: ["ignore", "ignore", "inherit"] });
      const report: Report = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
      const r = countCopies(report, copies);
      total += copies.length;
      passed += r.passed;
      process.stdout.write(`Run ${run}: ${r.passed} of ${copies.length} passed\n`);
      for (const f of r.failed) process.stdout.write(`  ${relative(root, join(root, f.copy))}: ${f.tests.join("; ")}\n`);
    }
  } finally {
    cleanup();
  }
  process.stdout.write(`${passed} of ${total} passed${passed === total ? "" : `: ${total - passed} failed`}.\n`);
  return passed === total ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main();
  } catch (e) {
    process.stderr.write(`shake: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  }
}
