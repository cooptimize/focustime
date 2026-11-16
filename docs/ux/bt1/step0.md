# BT-1: STEP 0

Measured and read on Nov 16, 2026, from `origin/main` at `69bb0bce` (PF-1 merged).

## 0.1 An earlier BT-1

None: no branch `chore/bt1-tests`, no worktree, no pull request with BT-1 in its title. Started fresh.

## 0.2 Other open pull requests

None open touches `.github/workflows/`, `vite.config.ts`, `test/` or `e2e/` (checked with `gh pr list --state open` and each one's files). No browser test files to carry into the new folders from another branch at the start; the merge of `origin/main` before pushing is checked again.

The latest `ci` run on main (43866488225, the push of PF-1's merge) failed in shard 5: `e2e/rb2-code.test.ts` › "inside a client the search starts on This client, and All clients widens it" timed out waiting for a locator (30 s). The same tree passed on the pull request's run (43852601451). A flaky test, not a broken one; it is in the open questions.

## 0.3 CI as it is

`before.md`: the ten runs (five pull request runs and five pushes to main), each job and its main steps, the unit job's 40 slowest files, and every browser file's time with how much of it its printed tests account for.

The browser files' start, measured on this machine held to four cores (`taskset -c 8-11`), with the UI built as the test run builds it and as a release (`docs/ux/bt1/start-cost.md` has the raw numbers):

| What | Test-mode build, ms | Release build, ms |
|---|---|---|
| Start the demo server and Chromium (once per file) | 1,007 | 1,011 |
| A fresh person (`freshPage`): new page | 84 | 83 |
| the sign-in page | 80 | 79 |
| Try the demo, until the button answers | 178 | 150 |
| the demo session made and the app's first screen (`.demo-tag`) | 813 | 813 |
| the opening gone | 9 | 9 |
| the other screens fetched in the background | 55 (3 to 178) | 5 (3 to 16) |
| **A fresh person in all** | **about 1,300** | **about 1,250** |

The browser run starts about 130 servers (one per file, a few per clock) and signs in about 400 fresh people (`freshPage` as written; loops make more). On CI's slower cores a fresh person is about 2 to 3 s (the tests that do little else take that long), so signing in is roughly 1,000 of the 3,500 s the browser files add up to. The making of a demo session (`buildDemo` and `seedDemo` in `server/main.ts`) is most of it; that is app code, so BT-1 avoids it where a test can share a person (B) rather than making it faster.

The 30 slowest browser files are almost all their tests: the printed tests account for 85 to 100% of each file's time (`before.md`). Their tests are long because each measures a screen at several sizes, themes or text sizes (`ps1`, `rs1`, `wk1`, `wk5`, `ahead`'s Grid), or walks a whole flow (`guide-tour`'s 23 tours, `vm2`'s clock ticks, `pf1`'s cold starts).

## 0.4 The unit job's tests on four cores

The unit job's command (`vitest run --exclude 'e2e/**'`, CI=1, TZ America/Chicago) held to four cores with `taskset -c 0-3`, `FOCUSTIME_TEST_WORKERS` set to 2, 3 and 4, with SQL Server (the local test container) and without it (`FOCUSTIME_TEST_SQL=off`, so the SQL Server half of every store test is skipped). Wall time from vitest's own report; "file time" is every file's time added up.

| SQL Server | At once | Wall, s | File time, s | SQL Server files' time, s | `store/isolation.test.ts`, s |
|---|---|---|---|---|---|
| with | 2 | 296 | 501 | 334 | 35.0 |
| with | 3 | 242 | 624 | 423 | 39.7 |
| with | 4 | 201 | 685 | 452 | 41.6 |
| without | 2 | 159 | 244 | 74 | 1.7 |
| without | 3 | 142 | 322 | 105 | 2.4 |
| without | 4 | 125 | 380 | 116 | 2.7 |

Every run passed but `test/shards.test.ts` in the last five: BT-1's own new test, written while they ran and before its table existed; it isn't part of the suite measured. The 48 SQL Server files are the files that import `test/db.ts`. The last two runs without SQL Server read this branch's first `vite.config.ts` with projects (`FOCUSTIME_TEST_WORKERS` sets every project's limit, so they ran as one group, as before).

Without SQL Server the suite scales less well (159 to 125 s): about 30 s of each run is vitest finding, transforming and importing files before and between them, which more workers don't shorten.

Where the time goes when it doesn't scale: the files' own times grow as more run at once (501 s of file time at 2, 685 s at 4): the four cores are shared by the workers, vitest's main process and, with SQL Server, the container itself. The SQL Server files are two thirds of the work (334 of 501 s at 2 at once), and the slowest of them (`store/isolation.test.ts`, 35 to 42 s) is the floor under any worker count. Still, four at once is the fastest on four cores, and the isolation test stays near 40 s, a third of its 120 s.

## 0.5 Every browser file

`files.md`: one row per file, its screen and new place, how it starts, its tests, whether they change stored data, whether they need their own clock or settings, and whether they could share one start.

What it shows: 118 of the 133 files already start the app once for the file. The other 15 start once per describe because they need a clock, server settings or a real session of their own (12), or start inside each test because each test is its own clock (`nl1-now-mark`, `nm1-now-mark`, and `uib-shots`, which CI never runs). So "one start per file" is already true wherever a file can have it; what B can still save is the per-test sign-in, for files whose tests only read.

## 0.6 Candidates: checks another test already makes

From the 30 slowest files and the groups that cover one screen. Candidates, not removals: the removals, each with its proof, are in `removed.md`.

| Check | Where | Also made by | Level | Outcome |
|---|---|---|---|---|
| A block under way at Wednesday 10:03 has its now mark, and only that block, on Week's cards | `nm1-now-mark` "a block under way still has its mark" | `nl1-now-mark` "at 10:03 AM", the same clock, screen and exact list of marked blocks | browser | removed (C) |
| Six tabs read Day · Week · Backlog · Status · Inbox · Code | `rf1` test 1 | `nav` test 1 (the same exact list) | browser | removed, with T merged into `nav` (C) |
| 4 opens Status and 5 the Inbox | `rf1` test 1 | `nav` test 1 (1 to 6, each with its address) | browser | removed (C) |
| T opens Day | `rf1` test 1 | nobody: `t` elsewhere timeboxes a focused row | browser | moved into `nav` test 1's key loop (C) |
| Tabs present and 1 to 5 open their addresses | `navigation` test 1's first block | `nav` test 1 (exact order, 1 to 6) | browser | removed (C) |
| `#/week/team` has no sideways scroll on the phone; no real name on it | `mb1`, `demo-names` | RM-1 removed the Team view; the address opens Week, checked by `sends` and `wd1`; Week is in both loops already | browser | removed (C3) |
| Before the day's first block, no now mark on today | `uib-shots` (never run in CI) | `nl1-now-mark` "at 6:30 AM" (Week, Day, Cards and Timeline, the phone) | browser | removed with the screenshots' move (C2) |
| Today and Week no wider than a 390 px phone with a 17 px root font, Wednesday 1:30 PM | `uib-shots` (never run in CI) | nobody at that size and font (`mb1` checks 360 at Larger and 21 px) | browser | made a CI test in `week/suggest-unfinished` (C2) |
| The six tabs' list | `rb6-code` test 1 | `nav` test 1 | browser | kept: one line inside a test whose other checks are its own; removing it saves nothing |
| The top bar is one row at 1280 | `rb6-code` "1280, 1366 and 1920, at every text size" and `rs1` "1024, 1280 and 1440" | each other at 1280 only | browser | kept: different sizes and text sizes, and `rs1` also checks the words and the focus ring |
| × and Esc close About and focus goes back | `close-button` test 1 | `ui8` "every screen ⋯ opens has the × … Esc closes" checks Esc closes and the × place, not where focus goes | browser | kept: not the same check |
| A tick opens Wrap it up | `fn1`, `wd2` "Day today: ticking…", `cf1` | each on a different screen or state (the story card, the panel, a day nobody confirmed) | browser | kept: different cases |
| Layout measured at each size, theme and text size | `ps1`, `rs1`, `wk1`, `wk5`, `bl1`, `ahead` "the Grid at every window size" | none: each measures its own screen and property | browser | kept: browser-only (layout), and nothing else measures them |
| Every tour walked with the keyboard, writing nothing | `guide-tour` | none | browser | kept; B shares its person (two sign-ins per test saved) |

## 0.7 What depends on a job's or a check's name, or on `ci` running on main

- **Branch rules**: none can be seen. `gh api repos/cooptimize/focustime/branches/main/protection` answers "Branch not protected", and the repository's rulesets (`/rulesets` and `/rules/branches/main`) are empty. A rule that the token can't read could still exist, so the job names stay as they are.
- **deploy-dev's reuse** (`scripts/ci-tree-match.sh`, D456): reads only `ci.yml`'s passing runs with `event=pull_request` on the pull request's last commit, and their artifact `tested-tree`, made by the job `test`. Nothing reads `ci`'s own runs on main.
- **deploy-dev's call of `ci.yml`**: when the reuse check answers false, deploy-dev runs all of `ci.yml` as a called workflow (there `github.workflow` is `deploy-dev`, as `ci.yml`'s concurrency comment says).
- **The recorded tested tree**: written only by the `test` job, only on a run that ran everything (CI-3).
- **Caches saved from main**: WebKit's system packages (`apt-webkit2-…`, saved only off pull requests, by the webkit job), the Playwright WebKit browser (`playwright-webkit-…`, the webkit job), and npm's (`actions/setup-node` with `cache: npm`, saved by any job that misses; deploy-dev's `typecheck` and `deploy` jobs set it up on main on every merge). A pull request can restore main's caches, not another pull request's.
- **Badges**: none (no README badge or doc link to `ci`'s status).

## 0.8 The test runner's documentation

Vitest 5.0.5 is installed; vitest.dev shows 5.1.0.

- Sharding: <https://vitest.dev/guide/improving-performance#sharding> ("Vitest splits your test files, not your test cases") and <https://vitest.dev/guide/cli#shard> (equal parts by count). How files are assigned isn't documented; the installed `BaseSequencer.shard` sorts them by a hash of each path and cuts equal counts (`node_modules/vitest/dist/chunks/index.1TqnEahn.js`).
- A custom split: <https://vitest.dev/config/sequence#sequence-sequencer>: "A custom class that defines methods for sharding and sorting … You can extend `BaseSequencer` from `vitest/node`"; "Sharding is happening before sorting, and only if `--shard` option is provided."
- Tests related to a change: <https://vitest.dev/guide/cli#vitest-related> ("Run only tests that cover a list of source files. Works with static imports … but not the dynamic ones") and <https://vitest.dev/config/changed#changed> ("If no value is provided, it will run tests against uncommitted changes (including staged and unstaged)"; changes to a project's config or setup files rerun all of it).
- How many files at once: <https://vitest.dev/config/maxworkers#maxworkers> ("if watch is disabled, uses all available parallelism"), <https://vitest.dev/guide/parallelism#file-parallelism>.
- Projects and their order: <https://vitest.dev/guide/projects> and <https://vitest.dev/config/sequence#sequence-grouporder> ("Projects with the same group order number will run together, and groups are run from lowest to highest"). The pages don't say a project may set its own `maxWorkers`; the installed code does: `groupSpecs` takes each group's `maxWorkers` from its projects and refuses two projects with different `maxWorkers` in one group ("Provide unique 'sequence.groupOrder' for them"), and the pool runs one group after another with that group's limit.
