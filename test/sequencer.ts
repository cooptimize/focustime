// BT-1: vitest's sequencer with the browser shards filled by measured time (test/shards.ts) instead of by a hash of
// each file's path, and each run's browser files started longest first, so the last file to start isn't a long one.
// Everything else is vitest's own (its order for unit and store files, its shard range for anything else).
import { relative, sep } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import { assignShards, missingFrom, readShardTimes, standIn, timeOf } from "./shards.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const rel = (s: TestSpecification) => relative(ROOT, s.moduleId).split(sep).join("/");
const isBrowserFile = (s: TestSpecification) => rel(s).startsWith("e2e/");

export class TimedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return files;
    const { files: times } = readShardTimes();
    const names = files.map(rel);
    const split = assignShards(names, times, shard.count);
    const mine = new Set(split[shard.index - 1] ?? []);
    const missing = missingFrom(names.filter((n) => n.startsWith("e2e/")), times);
    if (missing.length) process.stderr.write(`shards: ${missing.length} browser file(s) not in test/shard-times.json, each counted as ${Math.round(standIn(times))} s; refresh the table with node scripts/shard-times.ts <ci run id>: ${missing.join(", ")}\n`);
    return files.filter((s) => mine.has(rel(s)));
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const { files: times } = readShardTimes();
    const fallback = standIn(times);
    // The browser files keep their places among the others, reordered longest first among themselves.
    const at = sorted.flatMap((s, i) => (isBrowserFile(s) ? [i] : []));
    const browser = at.map((i) => sorted[i]!).sort((a, b) => timeOf(rel(b), times, fallback) - timeOf(rel(a), times, fallback) || (rel(a) < rel(b) ? -1 : 1));
    at.forEach((i, k) => (sorted[i] = browser[k]!));
    return sorted;
  }
}
