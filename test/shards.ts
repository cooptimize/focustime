// BT-1: the browser shards are filled by each file's measured time, not by a hash of its name (vitest's default), so
// the slowest shard is near the others. The times are a small checked-in table (test/shard-times.json) that
// `node scripts/shard-times.ts <ci run id>` refreshes from a ci run's six shard logs.
//
//   Longest first, each file to the shard with the least time so far (ties: the lower shard number). A file the table
//   doesn't name is still run: it counts as the table's median, and the run says to refresh the table. A name in the
//   table that no file has any more is ignored. Every shard job computes the same split from the same file list.
import { readFileSync } from "node:fs";

export type ShardTimes = { source?: string; files: Record<string, number> };

/** The table's median time, the stand-in for a file it doesn't name (30 s when it is empty). */
export function standIn(times: Record<string, number>): number {
  const v = Object.values(times).filter((t) => Number.isFinite(t) && t > 0).sort((a, b) => a - b);
  if (!v.length) return 30;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** Each file's time from the table, or the stand-in. */
export function timeOf(file: string, times: Record<string, number>, fallback = standIn(times)): number {
  const t = times[file];
  return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : fallback;
}

/** The files the table doesn't name. */
export const missingFrom = (files: readonly string[], times: Record<string, number>): string[] => files.filter((f) => !(typeof times[f] === "number" && times[f]! > 0)).sort();

/** Splits the files into `count` shards (index 0 is shard 1). Every file is in exactly one. */
export function assignShards(files: readonly string[], times: Record<string, number>, count: number): string[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`shard count must be a positive whole number, got ${count}`);
  const fallback = standIn(times);
  const unique = [...new Set(files)];
  const order = unique.map((f) => ({ f, t: timeOf(f, times, fallback) })).sort((a, b) => b.t - a.t || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));
  const shards: string[][] = Array.from({ length: count }, () => []);
  const load = new Array<number>(count).fill(0);
  for (const { f, t } of order) {
    let best = 0;
    for (let i = 1; i < count; i++) if (load[i]! < load[best]!) best = i;
    shards[best]!.push(f);
    load[best]! += t;
  }
  return shards;
}

/** Each shard's summed time, for the report and the balance check. */
export const shardLoads = (shards: string[][], times: Record<string, number>): number[] => {
  const fallback = standIn(times);
  return shards.map((s) => s.reduce((sum, f) => sum + timeOf(f, times, fallback), 0));
};

export const SHARD_TIMES = new URL("./shard-times.json", import.meta.url);

/** The checked-in table; an unreadable or malformed one is an empty table (every file then counts the same). */
export function readShardTimes(path: URL | string = SHARD_TIMES): ShardTimes {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as ShardTimes;
    return raw && typeof raw.files === "object" && raw.files ? raw : { files: {} };
  } catch {
    return { files: {} };
  }
}
