// BT-1: the browser shards filled by measured time. Every browser file is in exactly one shard whatever the table
// holds (current, stale, empty, naming files that are gone), the split is the same in every shard job, and with the
// checked-in table the slowest shard is within about 10% of the middle one.
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assignShards, missingFrom, readShardTimes, shardLoads, standIn } from "./shards.ts";

const ROOT = new URL("..", import.meta.url);
/** What a browser shard runs: every e2e test file but the screenshot scripts and the WebKit job's file (ci.yml). */
const browserFiles = () =>
  (readdirSync(new URL("e2e/", ROOT), { recursive: true }) as string[])
    .map((f) => `e2e/${f.split("\\").join("/")}`)
    .filter((f) => f.endsWith(".test.ts") && !f.startsWith("e2e/shot-scripts/") && !f.endsWith("/safari.test.ts"))
    .sort();
const SHARDS = 6;

function expectEachOnce(files: string[], shards: string[][]) {
  const seen = shards.flat();
  expect(seen.length).toBe(files.length);
  expect(new Set(seen).size).toBe(files.length);
  expect([...seen].sort()).toEqual([...files].sort());
}

describe("browser shards by measured time", () => {
  const files = browserFiles();
  const table = readShardTimes().files;

  it("finds the browser files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("puts every browser file in exactly one shard with the checked-in table", () => {
    expectEachOnce(files, assignShards(files, table, SHARDS));
  });

  it("still does with a stale table (half the files missing), an empty one, and one naming files that are gone", () => {
    const stale = Object.fromEntries(Object.entries(table).filter((_, i) => i % 2 === 0));
    const gone = { ...table, "e2e/gone/old.test.ts": 400, "e2e/renamed.test.ts": 90 };
    for (const t of [stale, {}, gone]) expectEachOnce(files, assignShards(files, t, SHARDS));
    // A file the table doesn't name is listed for the refresh message, and counts as the median.
    expect(missingFrom(files, stale).length).toBeGreaterThan(0);
    expect(standIn({})).toBe(30);
  });

  it("splits the same way every time, whatever order the files come in", () => {
    const a = assignShards(files, table, SHARDS);
    const b = assignShards([...files].reverse(), table, SHARDS);
    expect(b).toEqual(a);
  });

  it("keeps the slowest shard within about 10% of the middle one, by the table", () => {
    const missing = missingFrom(files, table);
    // A table missing many files can't promise the balance: refresh it (node scripts/shard-times.ts <ci run id>).
    expect(missing.length, `refresh test/shard-times.json; missing: ${missing.join(", ")}`).toBeLessThanOrEqual(Math.ceil(files.length / 10));
    const loads = shardLoads(assignShards(files, table, SHARDS), table).sort((x, y) => x - y);
    const middle = (loads[2]! + loads[3]!) / 2;
    expect(loads.at(-1)! / middle).toBeLessThan(1.1);
  });

  it("refuses a shard count that isn't a positive whole number", () => {
    expect(() => assignShards(files, table, 0)).toThrow(/positive whole number/);
  });
});
