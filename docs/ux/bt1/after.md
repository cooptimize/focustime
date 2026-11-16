# BT-1: CI after

The pull request's own `ci` runs (Nov 16), measured as `before.md` was: a run's wall time is its first job's start to its last job's end, runner time is every job's time added up, the "middle shard" is the median of the six. Before: the medians of ten runs (`before.md`).

## The runs

| Run | Tree | Whole run, s | Runner time, s | Unit job, s | Slowest shard, s | Middle shard, s | Slowest over middle | Result |
|---|---|---|---|---|---|---|---|---|
| **Before (median of ten)** | | **506** | **2,460** | **355** | **416** | **314** | 1.19 to 1.86 | |
| 43880638572 | f33df798, SQL Server files at 4 | 409 | 2,582 | 333 | 395 | 362 | 1.09 | passed |
| 43882543516 | 0a034de9, SQL Server files back at 2 | 403 | 2,559 | 315 | 377 | 341 | 1.11 | passed |
| 43885253766 attempt 1 | fab70ee9 (main merged, PF-2) | 378 | 2,514 | 358 | 370 | 330 | 1.12 | one flaky browser test (below) |
| 43885253766 attempt 2 | the same; only the failed shard rerun | | | | | | | passed |
| 43885253766 attempt 3 | the same, every job rerun | 440 | 2,526 | 303 | 413 | 336 | 1.23 | passed |
| 43885253766 attempt 4 | the same, every job rerun | 371 | 2,402 | 358 | 329 | 292 | 1.12 | passed |

The last three full runs on the final tree (fab70ee9 plus documentation): a whole run of 371 to 440 s (median 403 s, against 506 s), the slowest shard 329 to 413 s (against 416 s), and the slowest shard 1.10 to 1.23 times the middle one (against 1.19 to 1.86).

## What changed where

- **The shards (E)** are where most of the wall time came from: the slowest shard is no longer a third longer than the others. Each shard's real file time follows its runner: in run 43880638572 each shard's files ran 0.88 to 1.28 times their table time, all of a shard's files together, so the rest of the spread is the runners themselves.
- **The unit job (A)**: the unit test step took 264 to 315 s (median 289 s) against a median 312 s before. On this machine's four cores the same suite went from 296 s to 202 s with everything at 4, but on CI four SQL Server files at once crowded the container on the same runner: the store isolation test's slowest case took 89 s of its 120 s (run 43880638572). CI keeps SQL Server files at 2, as before, and runs them first, then the other unit files at 4. The isolation test's slowest case went back to 48 s.
- **Runner time** is about the same (2,402 to 2,582 s, against 2,460). The browser files themselves ran 6 to 10% slower than the ten-run medians on these days' runners: main's own run of Nov 16 (43866488225) was 6% slower on the same files, and this branch's unchanged files 7 to 10%, so at most a few percent of it could be the new order (longest files first). The guide tours, where B shares one signed-in person, went from 190 s to 172 s on this machine but took 277 and 281 s on CI (222 s before): sharing the person saves its sign-ins, but on CI the file now starts first in its shard beside another of the longest files (longest first), and its time follows that. B's saving doesn't show in CI's numbers.
- **A merge to main (F)** is tested once, not twice: `ci`'s own run on the push to main now runs only What changed, infra and the WebKit job's cache steps, instead of every test again (about 2,460 s of runner time). Not seen yet: it shows on the first merge after this one.

## The flaky failure

Attempt 1 failed in shard 4: `e2e/shell/opening-and-brand.test.ts` › "no words on screen before 8 seconds…", `expected 2 to be greater than 2` (the loader's animation sampled sixteen times saw only two opacities). BT-1 changed only that file's import path; it passed in the two runs before, on the rerun, and in eight copies at once on three cores on main's tree and on this branch alike. It is in the open questions with a way to make the sampler steadier.

## Tests

Every test by name before and after: `tests.md`, `browser-tests-before.txt`, `browser-tests-after.txt`. Unit and store tests: 4,548 before, 4,573 after (BT-1's own tests; the merge of PF-2 adds its own on top). Browser tests: 615 before, 611 after (the removals in `removed.md`).
