import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { sqlTestFiles } from "./test/projects.ts";
import { TimedSequencer } from "./test/sequencer.ts";
import { sqlWorkers, testWorkers, thisMachine, unitWorkers } from "./test/workers.ts";
import { techDocsPlugin } from "./scripts/tech-docs.ts";
import { firstDownload } from "./scripts/split-chunks.ts";

// HK-5, BT-1: how many files run at once, from this machine (test/workers.ts), one limit per kind of file, said once at
// the start of a run: unit files on every idle core, SQL Server files capped for the shared container, browser files
// (a demo server and a Chromium each) as HK-5 set them.
const machine = thisMachine();
const workers = { unit: unitWorkers(machine), sql: sqlWorkers(machine), browser: testWorkers(machine) };
if (process.env.VITEST && !process.env.VITEST_WORKER_ID && !process.env.FOCUSTIME_TEST_WORKERS_SAID) (process.env.FOCUSTIME_TEST_WORKERS_SAID = "1"), process.stderr.write(`test workers: unit ${workers.unit}, SQL Server ${workers.sql}, browser ${workers.browser} (test/workers.ts; FOCUSTIME_TEST_WORKERS sets all three)\n`);
const SQL_FILES = sqlTestFiles(import.meta.dirname);
const UNIT_DIRS = ["week", "plan", "store", "ui", "sources", "fixtures", "config", "host", "server", "actions", "links", "log", "ai", "assistant", "test", "scripts"];

// Local only: bind to loopback, fixed port, no LAN exposure.
// Vite's default allowedHosts check rejects requests whose Host header is not localhost.
const split = firstDownload();

export default defineConfig({
  // DOC-1: docs/technical/*.md as `virtual:tech-docs`, imported only by the lazily loaded Technical docs panel.
  plugins: [react(), techDocsPlugin(), split.plugin],
  // PF-1: the first download is one script (`main`): everything ui/main.tsx imports statically. A screen that loads
  // when first opened (ui/screens.ts) is its own file; what two or more of those screens share, and the first
  // download doesn't hold, is one more file (`shared`), so no screen's code is downloaded twice.
  build: { rolldownOptions: { output: { codeSplitting: { groups: split.groups, includeDependenciesRecursively: false } } } },
  server: { host: "127.0.0.1", port: 5317, strictPort: true },
  preview: { host: "127.0.0.1", port: 5318, strictPort: true },
  test: {
    environment: "node",
    maxWorkers: Math.max(workers.unit, workers.sql, workers.browser),
    setupFiles: ["test/no-promise-expect.ts"],
    globalSetup: ["test/tmp-dir.ts", "test/e2e-build.ts"],
    // BT-1: --shard fills each shard by measured time (test/shard-times.json, test/shards.ts), and browser files
    // start longest first.
    sequence: { sequencer: TimedSequencer },
    // BT-1: one project per kind of file, each with its own limit. Projects with different limits run one after the
    // other (vitest's groupOrder): the SQL Server files first, then the other unit files, then the browser files. When
    // the SQL Server and unit limits are equal they run as one group, mixed, which packs best.
    projects: [
      { extends: true, test: { name: "sql", include: SQL_FILES, maxWorkers: workers.sql, sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: "unit", include: UNIT_DIRS.map((d) => `${d}/**/*.test.ts`), exclude: [...configDefaults.exclude, ...SQL_FILES], maxWorkers: workers.unit, sequence: { groupOrder: workers.unit === workers.sql ? 0 : 1 } } },
      { extends: true, test: { name: "browser", include: ["e2e/**/*.test.ts"], maxWorkers: workers.browser, sequence: { groupOrder: 2 } } },
    ],
  },
});
