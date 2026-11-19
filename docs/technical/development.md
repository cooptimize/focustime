# Development

For engineers changing FocusTime, people and Claude Code alike. Checked against `2f4c0ea` on Nov 13, 2026.

Read first: [CLAUDE.md](../../CLAUDE.md) (the rules and the glossary), the rest of these pages, and [docs/decisions.md](../decisions.md) for why things are the way they are.

## Local setup

- **Node 26** or newer (`package.json` `engines`). FocusTime runs TypeScript directly on Node; there is no compile step for the server.
- **Linux** with a Secret Service keyring and `secret-tool` (the developer loop's host keeps secrets there), **Podman** with `podman-compose` (not Docker) for the database container, and a system **Chromium** (`/usr/bin/chromium`, `chromium-browser` or `google-chrome`) for the browser tests. For the Safari checks: `npx playwright-core install --with-deps webkit`.
- `npm ci`, then `npm run db:up` for the local SQL Server container (`scripts/db.ts`, `system/sqlserver/compose.yaml`, port 14330). The first time, it makes the container's password itself and keeps it as the host secret `sql-password` in the keyring, never in a file. `npm run db:down` stops it, `npm run db:reset` starts it empty.
- `npm run dev` runs the server with Vite inside it (no hot reload). With no app config it keeps its data in a SQLite file; to use the container, set `[database]` in `~/.config/focustime/app.toml` (or the `FOCUSTIME_DB_*` variables), as [system/README.md](../../system/README.md) shows. Without Microsoft sign-in set up, use **Try the demo**: fictional data in memory, nothing fetched.
- The developer loop (a user service and a launcher on one machine) is described in [system/README.md](../../system/README.md). It isn't part of the product.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | The server with Vite inside it, for the browser at the printed address |
| `npm run build` | The typecheck, then the UI build into `dist/` |
| `npm start`, `npm run serve` | The UI build (no typecheck) and serve; serve only |
| `npm run typecheck` | Both TypeScript projects (the UI, and the server with scripts and tests) |
| `npm run guards` | The repo guards (`scripts/guards.ts`): real names, desktop words, type and state names as code, "pick" in text people read, names FocusTime no longer uses (NM-1), and pointers ("Settings ›", "Admin ›", "More ›", "Inbox ›", "Backlog ›") that name a place the screens draw (NM-2, `ui/places.ts`) |
| `npm run check` | The typecheck and the guards |
| `npm test` | The full suite: unit, store (SQLite and SQL Server) and browser tests. Run `npm run db:up` first, or the SQL Server tests are skipped (`FOCUSTIME_TEST_SQL=required` makes them fail instead, `off` skips them) |
| `npm run test:zones` | The suite under four US time zones, one after another |
| `npm run docs:check` | These pages' checks (`scripts/tech-docs.test.ts`) |
| `npm run shake -- <e2e file>` | Runs copies of one browser test file at once on a few cores, several times, and says how many passed ([Shaking a browser test](#shaking-a-browser-test)) |
| `node scripts/first-download.ts` | Builds the UI and reports every file, what the first screen downloads and what its script is made of; `--why <module>` prints the imports that pull a module in, `--write` rewrites the limit's record |
| `node scripts/first-screen-times.ts` | Times opening the app and each tab in a browser on the demo, slowed and unslowed (needs `FOCUSTIME_E2E_DIST=<a built dist>`); `--first-visit` blocks the service worker so every file comes from the server, `--bytes` counts the bytes on the wire, files and data apart (PF-2) |
| `node scripts/data-sizes.ts` | Opens each place on the demo and lists every data read by action: calls, typical and largest size, and how it was sent (needs `FOCUSTIME_E2E_DIST`) |
| `npm run docs:diagrams` | Draws the Mermaid diagrams in these pages as SVG (`scripts/docs-diagrams.ts`); `-- --check` only checks |
| `npm run demo:check -- --url <site>` | Opens a demo session on a deployed site and checks the demo works (`scripts/demo-check.ts`); prints no cookie, token or body |
| `npm run screenshot` | Screenshots of the running local server (`scripts/screenshot.mjs`) |
| `npm run db:up`, `db:migrate`, `db:reset`, `db:down` | The local SQL Server container (`scripts/db.ts`) |
| `npm run focustime -- <command>` | The `focustime` command (`scripts/focustime.ts`): `migrate`, `export-local`, `import`, `counts` |

## One step, one worktree, one pull request

- Work on a branch in its own worktree: `git worktree add ~/Code/focustime-wt/<name> -b <branch> origin/main`. `~/Code/focustime` stays on `main`. Never run builds, migrations or servers against another checkout's database or build folder.
- One pull request per step, small commits, `origin/main` merged in just before opening it. Parallel sessions keep to their own scope.
- **Claude Code never merges** a pull request, never deploys prod and never pushes to `main`. A person reviews and merges.
- Never commit secrets or real personal or client data. Tests use fakes (`@example` addresses, `contoso` and `fabrikam` orgs); screenshots come from the demo only. `npm run guards` checks for real names and desktop words.

## Screenshots

A step's screenshots never go on `main` or on the step's branch (CI-3). Kept true by `npm run guards`, which fails on an image or video under `docs/ux`, on an archive anywhere under `docs/` (PV-1) and on any file over 300 KB outside the few named in `scripts/guards.ts` (`LARGE_OK`, each with its reason).

Pictures of a real session (real clients, people, meetings or chats) are never committed or pushed to any branch, `shots/` branches included, in any form, an archive among them.

1. **Take them** from the demo only, into `screenshots/<step>/` (ignored by git): a behavior test with `FOCUSTIME_SHOTS=screenshots/<step>` set, a screenshot script in `e2e/shot-scripts/` (`<STEP>_SHOTS=screenshots/<step> npm run shots -- e2e/shot-scripts/<step>-shots.ts`; each file's header names its variable), or a script in `scripts/` whose first argument is the folder. The screenshot scripts are not tests: `npm test` and CI never run them (`vitest.shots.config.ts` is their only config).
2. **Put them on their branch**: `node scripts/shots-branch.ts screenshots/<step> <step>` makes or updates `shots/<step>` with exactly those images (no other file, and nothing on the working branch or `main` changes), pushes it and prints one line per image.
3. **Show them in the pull request** by pasting those lines into its body. Each is the image's raw address pinned to the branch's commit (`https://raw.githubusercontent.com/<owner>/<repo>/<commit>/<file>`), so the pictures stay as they were whatever is pushed later.

The images from before CI-3 are on `shots/archive`, in their old `docs/ux/<step>/` folders; [docs/ux/README.md](../ux/README.md) gives its commit. A step's notes, tables and audits stay in `docs/ux/<step>/` as text.

## Tests and CI

- **The inner loop:** `npx vitest related --run <files>` (the tests that import those files, by static imports) or `npx vitest run --changed` (the tests touched by uncommitted changes), plus `npm run typecheck`. Only the unit tests related to a change: `npx vitest related --run --project unit --project sql <files>`. One screen's browser tests: `npx vitest run e2e/<screen>/` (for example `e2e/week/`). Run the full suite once before the pull request; CI runs it again.
- **Browser tests** (`e2e/`) each start their own demo server with a pinned clock (`e2e/harness.ts`), in Chromium and, for the Safari checks, WebKit. One e2e per feature for its main path; edge cases are unit tests. They sit in one folder per screen (BT-1): `day`, `week`, `backlog`, `inbox`, `code`, `status`, `settings`, `admin`, `shell` (the top bar, tabs, menus, the Guide, sign-in, anything on every screen) and `phone`; the helpers stay at `e2e/`'s top, and the screenshot scripts in `e2e/shot-scripts/`.
- **Adding a browser test:** put it in the folder of the screen it checks and name it for what it checks (`e2e/week/carry-over.test.ts`), with the step code in its first comment line. Start the app as `e2e/harness.ts` says, cheapest first: one `startDemo()` for the file and one `person(h)` shared through `pageAs(h, you)` when the tests only read; `freshPage(h)` per test when a test changes stored data another test reads; a describe with its own `startDemo` only for its own clock or server settings. It must pass alone and in any order (`--sequence.shuffle.tests`). A new file counts as the median time in the shards until the table is refreshed ([Operations](operations.md#workflows)).
- **A full local browser run:** `npx vitest run e2e/`. Each file gets its own demo server, free port and temp folder, the UI is built once per run, and the run's temp folder is removed at the end. `test/workers.ts` picks the worker count from free CPU and memory; `FOCUSTIME_TEST_WORKERS=<n>` overrides it, and `FOCUSTIME_TEST_WORKERS=2` with `taskset -c 0-3` is close to a CI shard. Runs in different worktrees can overlap.
- **Stopping servers by hand:** stop your own server by its process id, never by a pattern such as `pkill -f server/main.ts`: on a shared machine it also stops other sessions' test servers and the local service. If a run fails with `ERR_CONNECTION_REFUSED` or "The demo server on port N stopped during the test", look for that first.
- **Test data** comes from the builders in `test/builders`, never hand-written fixtures. A test that starts a server takes its port from `test/ports.ts`.
- **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to `main`; what it runs is under [What CI runs and when](#what-ci-runs-and-when). There are no retries.
- **A flaky test** is a cause to find, never a retry: rerun it once, and if it fails again, shake that file to reproduce it ([Shaking a browser test](#shaking-a-browser-test)).

### How tests stay apart

Any order and any number at once gives the same result:

- **Unit and store tests.** SQLite: a new in-memory database per test (`sqliteDb()` in `test/db.ts`). SQL Server: one database per test file (`focustime_test_<pid>_<n>_<time>`, migrated once, dropped at the end), with every table emptied and its identities reset at each test's `open()`. Every test file runs in its own process. A test that asserts on time passes its own clock (`now`) instead of reading the machine's.
- **Browser tests.** Each file's demo server has its own temp folder for config, data, cache and the launch file, its own port, and the clock pinned with `--clock` (Monday Nov 2, 2026 9:30 AM unless a file pins another). Each `freshPage` is a new browser context and a new demo session with its own in-memory store, so tests in a file never see each other's changes. `pageAs(h, you)` is a new browser context for a person signed in once (`person(h)`): the same demo store, so only for tests that read, or change only what no other test in the file looks at. `e2e/live.ts` does the same for a real session on fake sources, and a fake a test builds beside it takes the harness's clock too.
- **Waiting.** A test waits for the condition it means (a locator, `expect.poll` on what the screen shows), never a fixed sleep. A count or text read once is only for what is already settled, after a wait on that same thing. There are no retries in the config or on CI.
- **Workers.** `test/workers.ts` (read by `vite.config.ts`, and said at the start of a run as "test workers: unit N, SQL Server N, browser N") sets three limits, one per vitest project (BT-1). Browser files: 60% of the CPUs that aren't already busy (by the 1-minute load average, so a second session's suite takes what is left; not on CI, where the runner is the job's alone), at most one per GB of free memory beyond 2 GB, between 1 and CPUs − 1: 12 on a 20-core laptop and 2 on CI's 4-core runners, which is why the browser tests run in six shards there. Unit files (no browser, no SQL Server): every idle CPU, half a GB each: 4 on CI. SQL Server files (those that import `test/db.ts`, found each run by `test/projects.ts`): like the browser rule but at most 6, so two sessions at once put at most 12 on the shared container; on CI half the runner's CPUs (2), since the container runs on the same runner and the store isolation test needs its time. Projects with different limits run one after the other (SQL Server, then unit, then browser); equal limits run as one group. `FOCUSTIME_TEST_WORKERS=<n>` sets all three; `=1` runs one file at a time, to bisect a failure.
- **As CI runs it.** One browser shard: `npx vitest run e2e/ --shard=2/6 --exclude e2e/shell/safari.test.ts` (the same six shards as `ci.yml`; the UI is built first, in about a second); WebKit's file: `FOCUSTIME_TEST_WEBKIT=required npx vitest run e2e/shell/safari.test.ts`. The unit and store half: `npx vitest run --exclude 'e2e/**'`, with `npm run db:up` and `FOCUSTIME_TEST_SQL=required`. One test: `npx vitest run e2e/<file>.test.ts -t "<name>"`. To check a fix for a flake, shake the file (`npm run shake -- <file>`, above).

### Shaking a browser test

A browser test that waits on the clock instead of on the thing itself passes alone and fails one CI run in ten. `npm run shake` finds it before the merge (FT-1, `scripts/shake.ts`):

```
npm run shake -- e2e/shell/opening-and-brand.test.ts
npm run shake -- e2e/code/search-inside.test.ts --copies 6 --cores 4 --runs 3 --test "inside files"
```

- **When:** for every new or changed browser test, before the pull request, and for a test that failed on CI with no change to it.
- **What it does:** it builds the UI once, as a browser run does. It puts copies of the file beside it (`<name>.shake-<n>.test.ts`, left out by `.gitignore`) and runs them all at once in the browser project as CI runs it (`CI=1`, in the time zone `ci.yml` names). The run is held to the first few CPUs with `taskset`, and the whole thing repeats a few times. By default that is 8 copies on 3 cores, 5 times: 40 copies, a load heavier than a CI shard's. Each run says how many copies passed and the first line of every failure. The copies and the build are removed at the end, on Ctrl+C too.
- **Passing:** every copy of every run, 40 of 40 by default, and the command then exits 0. One failure is a cause to find, the same as on CI. Fix it by waiting for the thing itself: an event, a state the page reports, or the animation's own clock. A longer timeout, a retry or a skip is not a fix. A route a test sets goes in `freshPage`'s `before` and stays for the page's life, its answer changed through a variable: a route added to or removed from a page already open let a request through unseen under load (FT-1).
- **Its cost:** about as long as five runs of the file. Run it on a machine with nothing else heavy running, or the count says more about the machine than the test. While it runs, don't run that file's folder in another vitest: it would pick up the copies, and they go away under it.

### What CI runs and when

`.github/workflows/ci.yml`, kept true by `scripts/ci-workflow.test.ts` (it reads the workflow) and `scripts/ci-changes.test.ts`:

| Job | What it runs | When |
|---|---|---|
| What changed | `scripts/ci-changes.sh`: is this a pull request that changes only files under `docs/` outside `docs/technical/`, or `ci`'s own run on a push to `main`? | Always |
| Unit and store tests (SQLite and SQL Server) | The typecheck, the guards, every test outside `e2e/` (the docs checks among them) with a SQL Server container, the UI build | Always, except `ci`'s own run on a push to `main` |
| Browser tests N/6 (Chromium and WebKit) | A sixth of the browser files' measured time each (`test/shard-times.json`, `test/sequencer.ts`), except `e2e/shell/safari.test.ts`, in the system's Chromium, with no WebKit set up (the name is kept from before) | Skipped for a docs-only pull request and on `ci`'s own run on a push to `main` |
| Browser tests WebKit (Safari) | `e2e/shell/safari.test.ts`, with WebKit and its system packages from their caches | Skipped for a docs-only pull request; on `ci`'s own run on a push to `main` it only restores and saves the caches |
| image | The image build and a demo start | Skipped for a docs-only pull request and on `ci`'s own run on a push to `main` |
| infra | The Bicep build | Always |
| test | The gate: passes when all of the above passed, and records the tree it tested for deploy-dev, except on a docs-only run (deploy-dev then runs all of CI after the merge) | Always |

**A merge isn't tested twice (BT-1).** The pull request's run tested the tree that lands on `main`, and deploy-dev reuses its record of that tree (`scripts/ci-tree-match.sh`); when it finds none (a merge commit that changed the tree, a docs-only run, an untested push) deploy-dev runs all of `ci.yml` itself before deploying. So `ci`'s own run on a push to `main` answers `code=main` and skips the test jobs. A pull request that changes code still runs every test, with nothing sampled, optional or allowed to fail.

A skipped job still starts and passes under its own name, with one step saying it was docs only, so a required check is never left waiting. Anything else is code: a push to `main`, deploy-dev's call, `docs/technical/` (the app shows it), any file at the top of the repo (the image copies them), and any change the script can't read. The rule for what counts as docs is in the script's header; a file under `docs/` that a browser test or the image starts to read must make it code there first.

## Adding a screen that loads when first opened

The first download holds Day, Week, the top bar and the loader; how the rest is split is under [How the app is split into files](architecture.md#how-the-app-is-split-into-files). A new tab, overlay or dialog should load when it is first opened:

1. **Name it.** Add its name to `ui/screen-names.ts` and its `import()` to `LOADERS` in `ui/screens.ts`. Add it to `BACKGROUND` there if a key or a tab opens it and it should show at once.
2. **Say which places need it.** For a tab or an overlay with an address, add it to `locScreens` in `ui/nav.ts`. `ui/App.tsx` then draws that place only once the file is in, and keeps the screen before it until then.
3. **Draw it from the loader.** In `ui/App.tsx`, take the module with `screen("<name>")` for a place, or `useScreen("<name>", open)` for a dialog over the place, and draw nothing while it is null. Never import the screen's file statically from anything Day, Week or the top bar imports.
4. **Keep small things small.** If the first download needs a constant, a context or a hook from the screen's file, move that one thing to a small file of its own and import it from there (as `ui/capture-clients.ts` and `ui/newitem-ctx.ts` do).
5. **Styles.** A stylesheet the screen imports in its own file travels with it. Rules added to `ui/styles.css` are in the first download.
6. **Check it.** `node scripts/first-download.ts --why ui/<YourScreen>.tsx` should print "not in the first download". Add the screen to `SCREENS` in `e2e/shell/first-download.test.ts` (how it opens and where the focus lands).

### The first download's size

`scripts/first-download.test.ts` runs in the unit job. It builds the UI as a release does and fails when:

- the first download's script or styles, gzipped, are over the limit in `test/first-download.json`; the failure lists the modules that arrived or grew since the record was written, largest first, and for a new module the imports that brought it;
- a screen from `ui/screens.ts` is in the first download again; the failure prints the chain of imports from `ui/main.tsx` to it.

Reading the report (`node scripts/first-download.ts`):

- **Every file** is each file the build wrote, raw and gzipped (gzip level 9, as `vite build` prints).
- **The first download** is the page, the files it names, and every script and stylesheet the entry and `ui/main.tsx` import statically. Fonts are counted apart: they are fetched as text is drawn.
- **What the first download's script is made of** adds up each module's bytes before minifying, by screen folder and by package, so the shares are right and the totals are about twice the minified size.

When the first screen really needs more, raise the limit on purpose: `node scripts/first-download.ts --write` rewrites the record (the limit is 3% over what it measures), and the pull request says why. Otherwise find what pulled the code in (`--why`) and move it behind the loader.

## Dependencies

Every package in `package.json`, what FocusTime uses it for and its license. A new dependency needs the step's authorization (CLAUDE.md) and a row here; `npm run docs:check` fails until it has one.

### Runtime

| Package | Used for | License |
|---|---|---|
| `@azure/identity` | The app's managed identity: Azure SQL and Key Vault tokens, the Teams bot's credential (`server/main.ts`, `store/sql/sqlserver.ts`) | MIT |
| `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` | The UI's fonts, served with the app (`ui/fonts.css`) | OFL-1.1 |
| `@microsoft/teams.apps`, `@microsoft/teams.api` | The Teams bot: receiving and sending in a person's 1:1 chat (`server/teams/sdk.ts`) | MIT |
| `ical.js` | Reading calendars added by link (`sources/ics/parse.ts`) | MPL-2.0 |
| `lucide-react` | The UI's icons, through one module (`ui/icons.tsx`) | ISC |
| `mssql` | The SQL Server driver for the plan store (`store/sql/sqlserver.ts`) | MIT |
| `openid-client` | Microsoft sign-in, OpenID Connect (`server/auth/entra.ts`) | MIT |
| `pdfjs-dist` | Reading the text of a Pocket export's PDF, a call's transcript (PK-1), in a worker thread with no network (`server/pdf-text-worker.ts`). Its optional `@napi-rs/canvas` (a prebuilt binary for drawing pages) comes with it and is never used | Apache-2.0 |
| `prismjs` | Syntax colors in Code (`ui/code/`) | MIT |
| `react`, `react-dom` | The UI | MIT |
| `smol-toml` | Reading the app config and settings in TOML (`config/schema.ts`) | BSD-3-Clause |
| `temporal-polyfill` | Dates and times in browsers that lack Temporal (`ui/boot.ts`) | MIT |

`package.json`'s `overrides` pins `@azure/msal-node`, which the Teams SDK brings, to a patched version.

### Build and test

| Package | Used for | License |
|---|---|---|
| `typescript` | The typecheck | Apache-2.0 |
| `@types/node`, `@types/react`, `@types/react-dom` | Types for the typecheck | MIT |
| `vite`, `@vitejs/plugin-react` | Building the UI | MIT |
| `vitest` | Every test | MIT |
| `playwright-core` | Driving Chromium and WebKit in the browser tests and screenshots | Apache-2.0 |
| `marked` | Rendering these pages into the app at build time (`scripts/tech-docs.ts`) | MIT |
| `opentype.js` | Turning the brand lettering into outlines (`assets/brand/tools/outline.mjs`) | MIT |

## Decisions and open questions

- Record a step's decisions in its own file, `docs/decisions/<step>.md` (the step's code in lower case, like `mc-6.md`), under the step's heading, and what a person needs to decide in `docs/open-questions/<step>.md`. Add one line for the step to each index, [docs/decisions.md](../decisions.md) and [docs/open-questions.md](../open-questions.md); [docs/decisions/README.md](../decisions/README.md) shows how.
- A new decision has no global number: it is named by its step and its row ("MC-6.3"). Never renumber an existing decision: every number in use (up to D1199) stays on its row.
- Never edit another step's file, except to mark a question answered with the step that answered it.
- Update [docs/architecture.md](../architecture.md) when a folder or an entry point is added, moved or removed, and these pages when what they say changes.

## Adding an external write safely

1. **Code.** A named action in `actions/registry.ts`, implemented through the write framework (`actions/timebox-actions.ts` for Outlook, `actions/devops-write-actions.ts` for DevOps): validated input, a preview held on the server, confirm by preview id, the write (DevOps: `test /rev` first), read back, an audit log row, and an undo that refuses when the target changed since. Unit tests for the refusals; one e2e for the main path in the demo, whose writes are simulated (`server/demo.ts`).
2. **Rules.** Add it to the hard rules in [CLAUDE.md](../../CLAUDE.md) and get the step authorized: every external write is named there.
3. **Docs.** The write's row in [Integrations](integrations.md) and in [Security](security.md#external-writes-and-the-audit-log), in the same pull request.
4. **The assistant.** A write the assistant may propose goes into `assistant/allowlist.ts` as a proposal.

## Adding a Graph permission safely

1. **Code.** The scope in `sources/oauth/oauth.ts` (on its own token kind when it needs its own consent) and its row in `plan/permissions.ts` (why, admin consent or not, `later` when each person consents for themselves). Settings › Connections › Microsoft permissions shows it from there.
2. **Setup script.** Add it to `GRAPH_SCOPES` in `infra/scripts/app-registration.sh` only if it should be granted for the tenant. Read [Never do a full run of app-registration.sh](operations.md#never-do-a-full-run-of-app-registrationsh) first: the grant step deletes people's own consents. Admin consent for the tenant is a Cooptimize IT task; say so in the pull request.
3. **Docs.** Its row in [Integrations](integrations.md#microsoft-entra-id-and-microsoft-graph), and in [Security](security.md) when it changes what FocusTime can reach. `npm run docs:check` fails until Integrations lists it.
4. **Rules.** A permission that reads something new (another person's data, messages, files) needs the step's authorization and a hard rule in [CLAUDE.md](../../CLAUDE.md) saying what is kept, shown and never logged.

History: the test setup and its flaky-test fixes are recorded in [docs/decisions.md](../decisions.md).
