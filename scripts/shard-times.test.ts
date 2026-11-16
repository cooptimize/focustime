// BT-1: the shard table's refresh reads each browser file's time from vitest's lines in a ci log, takes the median
// over several runs, keeps the old time for a file no log has, and drops files that no longer exist.
import { describe, expect, it } from "vitest";
import { mergeTimes, timesFromLog } from "./shard-times.ts";

const line = (job: string, file: string, ms: number) => `${job}\tUNKNOWN STEP\t2026-11-16T10:52:33.2709505Z  ^[[32m✓^[[39m ${file} ^[[2m(^[[22m^[[2m4 tests^[[22m^[[2m)^[[22m^[[33m ${ms}^[[2mms^[[22m^[[39m`;

describe("the shard table's refresh", () => {
  it("reads each browser file's time from a ci log, colors and all, and nothing else", () => {
    const log = [
      line("Browser tests 1/6 (Chromium and WebKit)", "e2e/day/today.test.ts", 19704),
      line("Browser tests 2/6 (Chromium and WebKit)", "e2e/week/board.test.ts", 41130),
      // With the projects, vitest names the project before the path (copied from ci run 43880638572).
      "Browser tests 2/6 (Chromium and WebKit)\tUNKNOWN STEP\t2026-11-16T13:58:49.9172275Z  ^[[32m✓^[[39m ^[[30m^[[46m browser ^[[49m^[[39m e2e/week/room-for-today.test.ts ^[[2m(^[[22m^[[2m8 tests^[[22m^[[2m)^[[22m^[[33m 101923^[[2mms^[[22m^[[39m",
      // A test's own line and a unit file's line are not a browser file's time.
      "Browser tests 2/6\tUNKNOWN STEP\t2026-11-16T10:55:20Z      ✓ + in Assigned to you lands on the block 3480ms",
      line("Unit and store tests (SQLite and SQL Server)", "store/isolation.test.ts", 55000),
    ].join("\n");
    expect(timesFromLog(log)).toEqual({ "e2e/day/today.test.ts": 19.704, "e2e/week/board.test.ts": 41.13, "e2e/week/room-for-today.test.ts": 101.923 });
  });

  it("takes the median over runs, keeps an old time no log has, and drops a file that is gone", () => {
    const merged = mergeTimes([{ "e2e/a.test.ts": 10 }, { "e2e/a.test.ts": 30 }, { "e2e/a.test.ts": 20, "e2e/b.test.ts": 5 }], { "e2e/c.test.ts": 7, "e2e/gone.test.ts": 9 }, (f) => f !== "e2e/gone.test.ts");
    expect(merged).toEqual({ "e2e/a.test.ts": 20, "e2e/b.test.ts": 5, "e2e/c.test.ts": 7 });
  });
});
