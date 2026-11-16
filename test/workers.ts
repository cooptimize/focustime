// How many test files run at once, from this machine's CPUs, its free memory and what else is running on it. Three
// limits, one per kind of file (BT-1; HK-5 had one for all), each its own vitest project in vite.config.ts:
//
//   browser files (e2e/): each a demo server and a Chromium (about 1 GB). HK-5's rule, unchanged:
//             60% of the CPUs not already busy, at most one per GB of free memory beyond 2 GB, between 1 and CPUs − 1.
//   SQL Server files (those that import test/db.ts): they share the one SQL Server container. HK-5 measured on 20
//             cores: 19 at once took the store isolation test to 73 to 107 s of its 120 s and failed it when a second
//             session ran its suite too; 12 at once kept it at 63 s. So 60% of the idle CPUs, at most 6: two sessions
//             at once put at most 12 on the container. On CI's runner (ours alone) every CPU: 4 kept isolation at 42 s
//             (docs/ux/bt1/before.md, STEP 0.4).
//   every other file: no browser, no app, no SQL Server: every CPU not already busy, at most one per 0.5 GB free
//             beyond 2 GB, between 1 and CPUs. On CI's four cores the unit job went from 296 s at 2 at once to 201 s
//             at 4 (STEP 0.4).
//
// "Busy" is the 1-minute load average: a second session's suite on the same laptop takes its share first. Not on CI,
// whose runner is ours alone and whose load average is high from npm ci and apt.
//
// FOCUSTIME_TEST_WORKERS=<n> sets all three (a shard on a busy machine, or a bisect with 1).
import { availableParallelism, freemem, loadavg } from "node:os";

export type Machine = { cpus: number; load1: number; freeBytes: number; ci: boolean; override?: string | undefined };

const GB = 1024 ** 3;
/** Each running browser file's share: a vitest worker, its demo server and Chromium (about 1 GB). */
const PER_BROWSER_BYTES = GB;
/** Each running unit or store file's share: a vitest worker. */
const PER_UNIT_BYTES = GB / 2;
const RESERVE_BYTES = 2 * GB;
const CPU_SHARE = 0.6;
/** At most this many SQL Server files at once from one suite (two suites: 12, which HK-5 measured as safe). */
export const SQL_MAX = 6;

const override = (m: Machine) => {
  const set = m.override ? Number(m.override) : NaN;
  return Number.isInteger(set) && set > 0 ? set : null;
};
const idle = (m: Machine) => Math.max(1, m.cpus - (m.ci ? 0 : Math.max(0, m.load1)));
const byMemory = (m: Machine, each: number) => Math.floor((m.freeBytes - RESERVE_BYTES) / each);

/** Browser files (HK-5's rule). */
export function testWorkers(m: Machine): number {
  return override(m) ?? Math.max(1, Math.min(Math.floor(idle(m) * CPU_SHARE), byMemory(m, PER_BROWSER_BYTES), m.cpus - 1));
}

/** Files that start neither a browser nor the app and don't use SQL Server. */
export function unitWorkers(m: Machine): number {
  return override(m) ?? Math.max(1, Math.min(Math.floor(idle(m)), byMemory(m, PER_UNIT_BYTES), m.cpus));
}

/**
 * Files that use SQL Server. On CI, half the runner's CPUs (2 of 4, as before BT-1): the container runs on the same
 * runner, and at 4 at once the store isolation test's slowest case took 89 s of its 120 s there (run 43880638572)
 * against about 50 s at 2. Elsewhere 60% of the idle CPUs, at most SQL_MAX.
 */
export function sqlWorkers(m: Machine): number {
  return override(m) ?? Math.max(1, Math.min(SQL_MAX, m.ci ? Math.floor(m.cpus / 2) : Math.floor(idle(m) * CPU_SHARE), byMemory(m, PER_UNIT_BYTES), m.cpus));
}

export const thisMachine = (): Machine => ({ cpus: availableParallelism(), load1: loadavg()[0] ?? 0, freeBytes: freemem(), ci: !!process.env.CI, override: process.env.FOCUSTIME_TEST_WORKERS });
