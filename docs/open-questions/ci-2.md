## CI-2

- The offline path needs the cache to be written on the same runner image. On the first run after GitHub rolls out a new `ubuntu-latest` image (about weekly), every shard takes the online path once; an outage on that day would still fail them. Accept, or also allow the offline path from the previous image's cache when WebKit starts (the launch is the check)?
- A new Playwright version also takes the online path once (its package list may differ). Same question; read as "accept" for now.
- The proof runs on pull requests that change the script or the CI workflows, and by hand (from main only, as GitHub allows). Should it also run weekly, so a new runner image that breaks the offline path shows before an outage does?
- `docs/architecture.md`'s scripts line doesn't list `ci-webkit-deps.sh`: this step was limited to `.github/`, `scripts/` and the named docs while QT-1 works in `docs/`. Add it in a later docs pass.
- The other step outages can still stop are `npm ci` (npm's registry) and Install WebKit on a browser cache miss (Playwright's CDN). Neither failed on Nov 11. Worth the same treatment?
- Each install-deps attempt is cut off at 3 minutes (3 attempts, about 10 minutes at worst), because the browser jobs time out at 20 minutes and the tests take up to 6.5. A mirror slow enough to need more (AP-2 saw 8 to 17 minutes) now fails in the step instead of timing the job out. The review suggested one overall deadline instead; kept per attempt so each retry starts fresh. Fine?
- `e2e/wd2.test.ts` now sets the address again until the page shows. Other browser tests set `location.hash` once after a reload the same way. Give the harness one `goTo` for all of them (a later step), or leave each until it flakes?

