// BT-1: refreshes test/shard-times.json, the browser files' measured times the shards are filled from (test/shards.ts),
// from one or more ci runs' browser shard logs (the median when several). Read-only on GitHub: `gh run view --log`.
//
//   node scripts/shard-times.ts <run id> [<run id> ...]     reads the runs and writes the table
//   node scripts/shard-times.ts --from-log <file> [...]      the same from saved logs (the tests use this)
//
// Only files that exist now are written; a file in no log keeps its old time, so a run that failed early doesn't
// empty the table.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readShardTimes, SHARD_TIMES } from "../test/shards.ts";

const ANSI = /(\x1b|\^\[)\[[0-9;]*m/g;
// A file's line in vitest's default reporter: "✓ e2e/day/today.test.ts (4 tests) 19704ms".
// "✓ e2e/…" before BT-1's projects, "✓  browser  e2e/…" with them (vitest names the project).
const FILE_LINE = /[✓❯×]\s+(?:[a-z]+\s+)?(e2e\/[\w./-]+\.test\.ts) \(\d+ tests?[^)]*\)\s+(\d+)ms/;

/** Each browser file's time in seconds from one log, as vitest printed it. */
export function timesFromLog(log: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of log.split("\n")) {
    const m = FILE_LINE.exec(raw.replace(ANSI, ""));
    if (m) out[m[1]!] = Number(m[2]) / 1000;
  }
  return out;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The new table: the median of each file over the logs, old times kept for files no log has, gone files dropped. */
export function mergeTimes(logs: Record<string, number>[], old: Record<string, number>, exists: (file: string) => boolean): Record<string, number> {
  const all = new Map<string, number[]>();
  for (const l of logs) for (const [f, t] of Object.entries(l)) all.set(f, [...(all.get(f) ?? []), t]);
  const files = new Set([...Object.keys(old), ...all.keys()]);
  const out: Record<string, number> = {};
  for (const f of [...files].sort()) {
    if (!exists(f)) continue;
    const seen = all.get(f);
    const t = seen ? median(seen) : old[f];
    if (t && t > 0) out[f] = Math.round(t * 10) / 10;
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const fromLog = args[0] === "--from-log";
  const ids = fromLog ? args.slice(1) : args;
  if (!ids.length) {
    process.stderr.write("usage: node scripts/shard-times.ts <ci run id> [...] | --from-log <file> [...]\n");
    process.exit(2);
  }
  const logs = ids.map((id) => timesFromLog(fromLog ? readFileSync(id, "utf8") : execFileSync("gh", ["run", "view", id, "--log"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })));
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = mergeTimes(logs, readShardTimes().files, (f) => existsSync(join(root, f)));
  writeFileSync(SHARD_TIMES, `${JSON.stringify({ source: fromLog ? "saved logs" : `ci runs ${ids.join(", ")}`, files }, null, 1)}\n`);
  process.stdout.write(`test/shard-times.json: ${Object.keys(files).length} files from ${ids.length} run(s)\n`);
}
