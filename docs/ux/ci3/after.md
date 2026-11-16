# CI-3: CI and checkouts after the change

Measured on Nov 15, 2026 on this branch. Before: [before.md](before.md).

## CI

One run so far, this pull request's ci run 43788535051 (a code change, so everything ran); the before column is the median of ten pull request runs (`docs/ux/ci3/before.md`). A single run varies, mostly in the tests themselves.

| Job | Before, median s | After, s | Checkout before → after |
|---|---|---|---|
| What changed (new) | none | 4 | none → 1 |
| Unit and store tests | 361 | 414 (its tests 370 against a 303 median; the slowest of ten before was 421) | 17 → 3 |
| Browser tests n/6 | 369 median, 499 slowest | 305 median, 395 slowest | 18 → 3 |
| Browser tests WebKit (Safari), new | none | 72 (WebKit packages 20, the test 35) | none → 3 |
| WebKit packages, per run | 24 s in each of 6 shards, about 144 s | 20 s once | |
| image | 73 | 68 | 18 → 2 |
| infra | 37 | 19 | 19 → 3 |
| test | 23 | 13 | 18 → 8 |
| **Whole run, first job start to last job end** | **509** | **429** | |
| **Runner time, all jobs added up** | **2759** | **2545** | |

A docs-only pull request skips the six shards' tests (about 300 s each), the webkit job's and the image's, so its run is the unit job's length (about 6 to 7 minutes), with about 2,000 fewer runner seconds; after its merge deploy-dev runs all of CI, as before.

## A checkout, a clone and a worktree

| What | Before | After |
|---|---|---|
| Shallow checkout as CI does it (`git fetch --depth=1` of one commit, then checkout) | 29 s, 808 MB (378 MB `.git`, 430 MB files) | 2.7 s, 97 MB (40 MB `.git`, 57 MB files) |
| `git worktree add` | 1.3 s, 430 MB | 0.12 s, 57 MB |
| `npm ci` in the new worktree (warm cache) | 1.6 s | 1.5 s |
| Fresh full clone | 25 s, 900 MB | about 25 s, unchanged: the images stay in history |
