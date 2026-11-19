# FT-1, step 0: why three browser tests failed at random

Measured Nov 16, 2026 on `origin/main` at `5e222f43`, on a 20-core laptop, with the shake command this step adds (`npm run shake`, `scripts/shake.ts`): 8 copies of a file at once, held to 3 cores with `taskset`, as CI runs the browser project (`CI=1`, Chicago time). A CI shard runs 2 files on 4 cores, so this load is heavier than CI's and makes a one-in-ten failure show in a few runs. The traces are in `traces/` (demo data only: file names, times and events).

## 0.1 The three tests and one more

| Test | Before the fix | After the fix | Test or app |
|---|---|---|---|
| `e2e/shell/first-download.test.ts`, "a release…" | about half the copies failed: 4, 5, 2, 7, 6 and 4 of 8 passed | 16 of 16, then 16 of 16 again | test |
| `e2e/shell/opening-and-brand.test.ts`, "no words on screen before 8 seconds…" | 24 of 24 at 8 copies on 3 cores, but 10 of 24 at 12 copies on 2 cores (the line read at 8.7 s on the test's clock) | 12 of 12 at 12 copies on 2 cores | test |
| `e2e/code/search-inside.test.ts`, "inside files…" | 15 of 16 (counted 7 of 10 requests) | 24 of 24 | test |
| `e2e/code/by-kind-and-search.test.ts`, "inside a client the search starts on This client…" | 6 of 16 | 16 of 16 | test |

The fourth row is CI's time-out from BT-1's open question. That question named `search-inside` (was `rb4-code`), but the failing test is in `by-kind-and-search` (was `rb2-code`).

## 0.2 What each one waited on

- **first-download, the release.** The test added a route (`page.route`) to a page that was already open, and later removed it with `page.unroute`. Then the page loaded a screen with `import()`. Under load, that request sometimes went to the server unseen. A second CDP session on the same page (`traces/release-cdp/`) saw Chromium send it (`willBeSent`, 200, not from the disk cache, no service worker). Playwright reported no request, and the route never ran, so the screen came from the server's real file and the reload the test waited for never came. A probe with plain `fetch` on the same page missed 0 times in 160, so the miss is in how the page loads modules, not in routing as a whole. Skipping `about:blank` in `cold()` did not change it. Set before the page opens and kept for its life, with the answer changed through a variable, the route saw every request in every run.
- **opening-and-brand.** The test read the loader at fixed times on its own clock (`performance.now()` from the test's start). It read the 8 s line at 8.7 s, and the 8 blocks' pass at fixed points after the stage showed. Under load the page's frames come late, so 8.7 s on the test's clock can be 7.9 s on the loader's. The loader keeps its own clock: the time since the stage's `boot-show` animation started, which `markClock` in `ui/brand/boot.ts` reads too. The fix reads the words in every frame and files them by that clock, and it seeks the blocks' animations instead of waiting for them.
- **search-inside, inside files.** Its route was added to an open page, with the same miss as the release test, so a request to one client sometimes went past the count ("Asked 3 of 4"). It also read the progress line once, right after the last answer came back, before the page had drawn it.
- **by-kind-and-search, This client.** `#/code/Atlas` opens Atlas's only repo by itself, and Code empties the search box when it moves (`ui/code/Code.tsx`: the move at line 536, `setQ("")` at 505). The test typed before that move under load, so its words were cleared. It now waits for the repo's address first.

## 0.3 The traces

- `traces/trace-*.txt`: the release test with `page.on("request")` beside a timeline of keys, navigations and loads. "press 3" is followed by Playwright's request for `Ahead-*.js`, and the reload counter (`loads=`) shows each reload.
- `traces/release-cdp/cdp-*.txt`: the same with a CDP session beside it. In the failing runs, the `cdp willBeSent` and `cdp response 200` lines have no `pw request` line before them.

## 0.4 Is the app at fault?

No. In the one case where the release test's reading and the app's could differ, the app is right: a screen's file was replaced by a release after the app had already fetched it in the background (`prefetchScreens`, `html[data-screens=in]`). Opening that screen draws it at once from the module the page holds, which is the same build as the rest of the open app. There is no request, no line and no reload, and the release reaches the page at its next open or reload. A new test in `first-download.test.ts` keeps that.

`search-inside` and `by-kind-and-search` found no app fault either. Code emptying the box when it opens a client's only repo is app behavior worth a question, not a fault in what the tests guard (docs/open-questions/ft-1.md, FT-1).

## 0.5 Other files with the same habits

Files that add or remove a route on a page already open and then send requests from it:

| Folder | Files |
|---|---|
| admin | delivery-chats, invite-send |
| backlog | change-set, where-lookup |
| code | code-tab |
| day | progress-checkin, timeline, timeline-checklist (through `open()`) |
| settings | autosave, panel-shell (2) |
| shell | guide (line 221), tech-docs |
| week | story-card, loading |

These are safe, because a reload follows the route: register-client-call, today, guide (line 293), signin-needed, tab-order. Files that read an animation at fixed times: opening-and-brand's other tests (`t0+1300` for `markBox`, `t0+1000` for reduced motion) and `e2e/shot-scripts/br1-shots.ts`. `first-run-setup` uses a fake clock, not sampling. The sweep's results are in the open questions.

## After the fixes: the shake itself, and B3

The shake was checked on two throwaway browser tests, never committed:

| Test | Alone | `npm run shake -- <file> --runs 2` | Exit code |
|---|---|---|---|
| A sound one: a fresh page, then wait for the top bar | passes | 16 of 16 | 0 |
| One made flaky on purpose: the page's busy loop (about 200 ms alone) held to 400 ms on the wall clock | passes | 5 of 16 (705 to 2595 ms) | 1 |

Both times no copy (`*.shake-*.test.ts`) and no temp folder was left, after the failing run too. A run stopped with Ctrl+C removes them the same way (the same clean-up, on SIGINT).

B3, the three tests at 8 copies on 3 cores, 5 runs (40 copies each), on this branch:

| Test | Result |
|---|---|
| `e2e/code/search-inside.test.ts`, the whole file | 40 of 40 |
| `e2e/shell/first-download.test.ts`, the whole file | 39 of 40 at first, a wait the fix still left (the route told the old page by `load` events); after its fix 40 of 40, twice; after the review's fixes 40 of 40 |
| `e2e/shell/opening-and-brand.test.ts`, "no words on screen before 8 seconds…" (`--test`) | 39 of 40, then 38 of 40, then 39 of 40, each a wait the fix still left (the line's own animation, the parser stopping inside the stage, then inside the status line); after those fixes 40 of 40, twice. CI's third run then failed it once (the pass read before the loader's stylesheet applied); after that fix, see the pull request |

Each was broken on purpose again after the last change, and failed: the line at 1 s, the blocks at full opacity, the pass's animations removed, the waiting words not written and the ready words changed (`opening-and-brand`); no reload after a release, a reload loop (the once-only guard removed) and the line at once (`first-download`).
| `e2e/shell/opening-and-brand.test.ts`, the whole file | 0 of 40, in three tests FT-1 doesn't change (docs/open-questions/ft-1.md, FT-1) |
