# CI-3: CI and checkouts before the change

Measured on Nov 15, 2026 at `7c92f7aa` (origin/main), from GitHub's own job and step times (`gh api repos/<repo>/actions/runs/<id>/jobs`). The runs are the last ten passing `ci` runs on main (event push) and the last ten passing `ci` runs on pull requests. Times are in seconds; "slowest" is the slowest of the ten (sixty for the browser shards).

## Each job and its main steps

### On main (push)

Runs 43777256271, 43718479606, 43712146418, 43703370106, 43680500008, 43672029117, 43658549099, 43642157983, 43628029526, 43620202871.

From the first job's start to the last job's end: median 491 s, slowest 555 s. Runner time, all jobs added up: median 2716 s (about 45 minutes).

| Job | Median | Slowest | Main steps, median (slowest) |
|---|---|---|---|
| Unit and store tests (SQLite and SQL Server) | 406 | 485 | checkout 17 (22), setup-node 6 (7), start SQL Server 18 (20), npm ci 4 (6), typecheck 6 (9), the tests 346 (433), UI build 1 (2) |
| Browser tests n/6 (Chromium and WebKit), each of six | 345 | 528 | checkout 17 (34), setup-node 5 (8), npm ci 4 (6), browser cache 2 (4), WebKit packages restore 1 (6), WebKit packages 27 (58), the tests 279 (457) |
| image | 74 | 82 | checkout 18 (23), image build and smoke test 53 (65) |
| infra | 37 | 42 | checkout 19 (20), Bicep build 15 (20) |
| test | 22 | 32 | checkout 18 (25) |

### On pull requests

Runs 43775999578, 43714141679, 43703662067, 43692513360, 43689713152, 43689233369, 43678924267, 43671264470, 43656545205, 43640502534.

From the first job's start to the last job's end: median 509 s, slowest 1435 s (that run waited for runners). Runner time, all jobs added up: median 2759 s.

| Job | Median | Slowest | Main steps, median (slowest) |
|---|---|---|---|
| Unit and store tests (SQLite and SQL Server) | 361 | 480 | checkout 17 (20), setup-node 5 (6), start SQL Server 17 (20), npm ci 3 (6), typecheck 6 (8), the tests 303 (421), UI build 1 (2) |
| Browser tests n/6 (Chromium and WebKit), each of six | 369 | 499 | checkout 18 (44), setup-node 6 (7), npm ci 4 (6), browser cache 2 (4), WebKit packages restore 2 (4), WebKit packages 24 (42), the tests 302 (446) |
| image | 73 | 92 | checkout 18 (22), image build and smoke test 53 (67) |
| infra | 37 | 44 | checkout 19 (26), Bicep build 14 (19) |
| test | 23 | 29 | checkout 18 (23) |

What stands out:

- Every job spends 17 to 19 s on checkout, ten jobs a run: about 3 minutes of runner time for files no job reads (the images under `docs/ux`).
- Every browser shard spends about 25 s on WebKit's system packages (up to 58 s), six times a run, for one test file (`e2e/safari.test.ts`).
- The Playwright browser cache hit in all 120 shard runs (the "Install WebKit" step was skipped every time).
- The tests themselves are most of the unit job and of each shard.

## From a merge to dev deployed

The last ten `deploy-dev` runs on main (43777256199, 43718479603, 43712146378, 43703370168, 43680500000, 43672029237, 43658549135, 43642157972, 43628029597, 43620202905): from the push to the end of the run, 290, 290, 304, 306, 311, 320, 324, 328, 329 and 333 s (median about 315 s). All ten reused their pull request's CI (the tree matched), so each ran the typecheck and then the deploy job (234 to 272 s, which builds the image, migrates, deploys the Bicep and runs the smoke test). Alongside each, `ci` ran in full again on main (the push run above).

## A checkout, a clone and a worktree

On the developer machine, over the network to GitHub for the clones:

| What | Time | Size |
|---|---|---|
| Fresh full clone (`git clone`) | 25 s | 900 MB: 470 MB `.git`, 430 MB of files |
| Shallow checkout as CI does it (`git fetch --depth=1` of one commit, then checkout) | 29 s | 808 MB: 378 MB `.git`, 430 MB of files |
| `git worktree add` from the main checkout | 1.3 s | 430 MB of files |
| `npm ci` in the new worktree (npm's cache warm) | 1.6 s | 250 MB `node_modules` |

Of the 430 MB of files, `docs/ux` is 391 MB: 3,059 PNG files, a 16 MB zip of screenshots and 77 text files.
