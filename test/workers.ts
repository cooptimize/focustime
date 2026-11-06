// HK-5: how many test files run at once, from this machine's CPUs, its free memory and what else is running on it.
// Vitest's default (every CPU but one) put 19 files at once on a 20-core laptop: each browser file is a demo server
// and a Chromium, and every store file shares the one SQL Server container, so the store isolation test ran 73 to 107 s
// of its 120 s and failed when a second session ran its suite too. Measured on 20 cores (one suite, idle machine): 19
// workers 117 to 140 s with isolation near its limit; 12 workers 132 s with isolation at 63 s; 8 workers 164 s.
//
//   workers = 60% of the CPUs not already busy (the 1-minute load average; not on CI, whose runner is ours alone and
//             whose load average is high from npm ci and apt), at most one per GB of free memory beyond 2 GB,
//             between 1 and CPUs − 1.
//
// FOCUSTIME_TEST_WORKERS=<n> sets it (a shard on a busy machine, or a bisect with 1).
import { availableParallelism, freemem, loadavg } from "node:os";

export type Machine = { cpus: number; load1: number; freeBytes: number; ci: boolean; override?: string | undefined };

const GB = 1024 ** 3;
/** Each running test file's share: a vitest worker, and for a browser file its demo server and Chromium (about 1 GB). */
const PER_WORKER_BYTES = GB;
const RESERVE_BYTES = 2 * GB;
const CPU_SHARE = 0.6;

export function testWorkers(m: Machine): number {
  const set = m.override ? Number(m.override) : NaN;
  if (Number.isInteger(set) && set > 0) return set;
  const busy = m.ci ? 0 : Math.max(0, m.load1);
  const byCpu = Math.floor(Math.max(1, m.cpus - busy) * CPU_SHARE);
  const byMemory = Math.floor((m.freeBytes - RESERVE_BYTES) / PER_WORKER_BYTES);
  return Math.max(1, Math.min(byCpu, byMemory, m.cpus - 1));
}

export const thisMachine = (): Machine => ({ cpus: availableParallelism(), load1: loadavg()[0] ?? 0, freeBytes: freemem(), ci: !!process.env.CI, override: process.env.FOCUSTIME_TEST_WORKERS });
