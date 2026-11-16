# BT-1: every test, before and after

Collected on Nov 16 from `origin/main` at `69bb0bce` and from this branch. Unit and store tests: `vitest list --json`. Browser tests: `vitest run e2e/ -t <a name nothing has>`, which reports every test as skipped by its full name (`vitest list` leaves out tests under `describe.skipIf`). The full browser lists are `browser-tests-before.txt` and `browser-tests-after.txt`. The full unit list (about 4,550 names, 600 KB) is over the repository's size guard, so here are its count per file and every name that differs; regenerate it with `npx vitest list --json=<file>`.

| | Before | After |
|---|---|---|
| Unit and store tests | 4548 | 4573 |
| Browser tests | 615 | 611 |

## Unit and store tests whose names differ

Only BT-1's own tests differ. `test/workers.test.ts` was rewritten (HK-5's cases kept under "browser workers", the same inputs and answers); `scripts/ci-workflow.test.ts`'s "always runs the unit job, infra and the gate" became "… on a pull request" with a new test for main's own push (F).

- Before only: `scripts/ci-workflow.test.ts` › ci.yml runs the same tests (CI-3) > always runs the unit job, infra and the gate
- Before only: `test/workers.test.ts` › test workers > FOCUSTIME_TEST_WORKERS sets it; anything but a positive whole number is ignored
- Before only: `test/workers.test.ts` › test workers > is capped by free memory, and is always at least one
- Before only: `test/workers.test.ts` › test workers > on CI ignores the load average (npm ci and apt just ran; the runner is ours alone)
- Before only: `test/workers.test.ts` › test workers > takes 60% of the idle CPUs, leaves out what is already busy, never more than CPUs − 1
- Before only: `test/workers.test.ts` › test workers > { cpus: 2, load1: 0, freeBytes: 8 * GB, ci: false }
- Before only: `test/workers.test.ts` › test workers > { cpus: 20, load1: .3, freeBytes: 20 * GB, ci: false }
- Before only: `test/workers.test.ts` › test workers > { cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false }
- Before only: `test/workers.test.ts` › test workers > { cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false, override: "3" }
- Before only: `test/workers.test.ts` › test workers > { cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false, override: "lots" }
- Before only: `test/workers.test.ts` › test workers > { cpus: 20, load1: 0, freeBytes: 6 * GB, ci: false }
- Before only: `test/workers.test.ts` › test workers > { cpus: 20, load1: 14, freeBytes: 20 * GB, ci: false }
- Before only: `test/workers.test.ts` › test workers > { cpus: 20, load1: 40, freeBytes: 1 * GB, ci: false }
- Before only: `test/workers.test.ts` › test workers > { cpus: 4, load1: 3.5, freeBytes: 14 * GB, ci: true }
- After only: `scripts/ci-changes.test.ts` › which changes skip the heavy jobs (CI-3) > answers main only for ci's own push run, and true when deploy-dev calls ci on the same push
- After only: `scripts/ci-tree-match.test.ts` › deploy-dev's reuse after a docs-only merge (CI-3) > deploys a merged tree a pull request's run already tested with no second full run anywhere
- After only: `scripts/ci-tree-match.test.ts` › deploy-dev's reuse after a docs-only merge (CI-3) > tests an untested tree fully, once, before deploying it (main moved, a docs-only run, a direct push)
- After only: `scripts/ci-workflow.test.ts` › ci.yml runs the same tests (CI-3) > always runs the unit job, infra and the gate on a pull request
- After only: `scripts/ci-workflow.test.ts` › ci.yml runs the same tests (CI-3) > leaves deploy-dev's guarantee as it was: an untested tree gets all of ci.yml before the deploy
- After only: `scripts/ci-workflow.test.ts` › ci.yml runs the same tests (CI-3) > on ci's own push to main runs no test step, and fills the WebKit caches
- After only: `scripts/shard-times.test.ts` › the shard table's refresh > reads each browser file's time from a ci log, colors and all, and nothing else
- After only: `scripts/shard-times.test.ts` › the shard table's refresh > takes the median over runs, keeps an old time no log has, and drops a file that is gone
- After only: `test/projects.test.ts` › the SQL Server files (BT-1) > include every file that uses SQL Server's helpers
- After only: `test/projects.test.ts` › the SQL Server files (BT-1) > include no browser file, and are paths from the root
- After only: `test/projects.test.ts` › the SQL Server files (BT-1) > include the store isolation test and the store tests that run on both drivers
- After only: `test/shards.test.ts` › browser shards by measured time > finds the browser files
- After only: `test/shards.test.ts` › browser shards by measured time > keeps the slowest shard within about 10% of the middle one, by the table
- After only: `test/shards.test.ts` › browser shards by measured time > puts every browser file in exactly one shard with the checked-in table
- After only: `test/shards.test.ts` › browser shards by measured time > refuses a shard count that isn't a positive whole number
- After only: `test/shards.test.ts` › browser shards by measured time > splits the same way every time, whatever order the files come in
- After only: `test/shards.test.ts` › browser shards by measured time > still does with a stale table (half the files missing), an empty one, and one naming files that are gone
- After only: `test/workers.test.ts` › SQL Server workers (BT-1): the store isolation test stays well inside its time > FOCUSTIME_TEST_WORKERS sets it too
- After only: `test/workers.test.ts` › SQL Server workers (BT-1): the store isolation test stays well inside its time > is at most ${SQL_MAX} from one suite, so two sessions at once put at most 12 on the container (HK-5: 12 kept isolation at 63 s)
- After only: `test/workers.test.ts` › SQL Server workers (BT-1): the store isolation test stays well inside its time > on CI's four cores is four, the unit count, so both run as one group
- After only: `test/workers.test.ts` › SQL Server workers (BT-1): the store isolation test stays well inside its time > on a private repository's two-core runner is two, and the unit count is two
- After only: `test/workers.test.ts` › SQL Server workers (BT-1): the store isolation test stays well inside its time > two
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > FOCUSTIME_TEST_WORKERS sets it; anything but a positive whole number is ignored
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > is capped by free memory, and is always at least one
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > on CI ignores the load average (npm ci and apt just ran; the runner is ours alone)
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > takes 60% of the idle CPUs, leaves out what is already busy, never more than CPUs − 1
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > { cpus: 2, load1: 0, freeBytes: 8 * GB, ci: false }
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > { cpus: 20, load1: .3, freeBytes: 20 * GB, ci: false }
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > { cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false }
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > { cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false, override: "3" }
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > { cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false, override: "lots" }
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > { cpus: 20, load1: 0, freeBytes: 6 * GB, ci: false }
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > { cpus: 20, load1: 14, freeBytes: 20 * GB, ci: false }
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > { cpus: 20, load1: 40, freeBytes: 1 * GB, ci: false }
- After only: `test/workers.test.ts` › browser workers (HK-5's rule) > { cpus: 4, load1: 3.5, freeBytes: 14 * GB, ci: true }
- After only: `test/workers.test.ts` › unit workers (BT-1): every core the machine has to give > FOCUSTIME_TEST_WORKERS sets it too
- After only: `test/workers.test.ts` › unit workers (BT-1): every core the machine has to give > is capped by free memory (half a GB each beyond 2 GB), and is always at least one
- After only: `test/workers.test.ts` › unit workers (BT-1): every core the machine has to give > on a laptop takes the idle CPUs: a second session's suite takes its share first
- After only: `test/workers.test.ts` › unit workers (BT-1): every core the machine has to give > uses every CPU on CI's runner, whatever its load average

## Browser tests whose names differ (old paths mapped to new)

- Before only: `e2e/shell/tab-order.test.ts` › RF-1: tab order, Status's dot, the top of Day Tuesday: the amber day the tabs read Day · Week · Backlog · Status · Inbox; 4 opens Status and 5 the Inbox
- Before only: `e2e/shell/tabs-and-addresses.test.ts` › Navigation: tabs, modes and addresses (browser, demo mode) six tabs in order (Day · Week · Backlog · Status · Inbox · Code), no Plan or Team tab, no ritual chips, no context line; 1–6 switch them
- Before only: `e2e/week/add-work.test.ts` › Add work: the moved Plan scenarios (browser, demo) + in Assigned to you and in Promises: each lands on the block and says so (More in <client> is in e2e/wd2.test.ts)
- Before only: `e2e/week/board-shots.test.ts` › UI-B screenshots in the gap before the day, at 1920
- Before only: `e2e/week/board-shots.test.ts` › UI-B screenshots mid-block: the Board, the list, Today and Plan today at 1920, 1366 and Larger
- Before only: `e2e/week/board-shots.test.ts` › UI-B screenshots phone
- Before only: `e2e/week/now-mark-catch-up.test.ts` › NM-1: no now mark on a cell that isn't a block a block under way still has its mark, and only that block
- After only: `e2e/shell/tabs-and-addresses.test.ts` › Navigation: tabs, modes and addresses (browser, demo mode) six tabs in order (Day · Week · Backlog · Status · Inbox · Code), no Plan or Team tab, no ritual chips, no context line; 1–6 and T switch them
- After only: `e2e/week/add-work.test.ts` › Add work: the moved Plan scenarios (browser, demo) + in Assigned to you and in Promises: each lands on the block and says so (More in <client> is in e2e/day/block-panel-day.test.ts)
- After only: `e2e/week/suggest-unfinished.test.ts` › Unfinished picks suggested in the next block (UI-B, SG-1) on a 390 px phone with a 17 px root font, Today and Week are no wider than the screen

Every "before only" browser test is a row in `removed.md`, or (the add-work test) a name that held an old file path and now holds the new one; tab-order's merged test is the same test with T added.

## Unit and store tests per file (files whose count changed)

| File | Before | After |
|---|---|---|
| `scripts/ci-changes.test.ts` | 8 | 9 |
| `scripts/ci-tree-match.test.ts` | 5 | 7 |
| `scripts/ci-workflow.test.ts` | 10 | 12 |
| `scripts/shard-times.test.ts` | 0 | 2 |
| `test/projects.test.ts` | 0 | 3 |
| `test/shards.test.ts` | 0 | 6 |
| `test/workers.test.ts` | 13 | 22 |

Every other unit file (451) has the same tests by name before and after.
