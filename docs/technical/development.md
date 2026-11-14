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
| `npm run guards` | The repo guards (`scripts/guards.ts`): real names, desktop words, type and state names as code, "pick" in text people read |
| `npm run check` | The typecheck and the guards |
| `npm test` | The full suite: unit, store (SQLite and SQL Server) and browser tests. Run `npm run db:up` first, or the SQL Server tests are skipped (`FOCUSTIME_TEST_SQL=required` makes them fail instead, `off` skips them) |
| `npm run test:zones` | The suite under four US time zones, one after another |
| `npm run docs:check` | These pages' checks (`scripts/tech-docs.test.ts`) |
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

## Tests and CI

- **The inner loop:** `npx vitest related <files>` or `npx vitest --changed`, plus `npm run typecheck`. Run the full suite once before the pull request; CI runs it again.
- **Browser tests** (`e2e/`) each start their own demo server with a pinned clock (`e2e/harness.ts`), in Chromium and, for the Safari checks, WebKit. One e2e per feature for its main path; edge cases are unit tests.
- **A full local browser run:** `npx vitest run e2e/`. Each file gets its own demo server, free port and temp folder, the UI is built once per run, and the run's temp folder is removed at the end. `test/workers.ts` picks the worker count from free CPU and memory; `FOCUSTIME_TEST_WORKERS=<n>` overrides it, and `FOCUSTIME_TEST_WORKERS=2` with `taskset -c 0-3` is close to a CI shard. Runs in different worktrees can overlap.
- **Stopping servers by hand:** stop your own server by its process id, never by a pattern such as `pkill -f server/main.ts`: on a shared machine it also stops other sessions' test servers and the local service. If a run fails with `ERR_CONNECTION_REFUSED` or "The demo server on port N stopped during the test", look for that first.
- **Test data** comes from the builders in `test/builders`, never hand-written fixtures. A test that starts a server takes its port from `test/ports.ts`.
- **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to `main`: the typecheck, the guards, the unit and store tests with a SQL Server container, a UI build, the browser tests in six shards, the Bicep build and the image build with a demo start. There are no retries.
- **A flaky test** is a cause to find, never a retry: rerun it once, and if it fails again, run that file several times at once on fewer cores to reproduce it ([docs/architecture.md, Testing](../architecture.md#testing-hk-5)).

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

- Record a decision in [docs/decisions.md](../decisions.md) under the step's heading, unnumbered. Numbers are assigned when the step merges, in merge order, so two parallel pull requests never take the same number. Never renumber an existing decision.
- Record what a person needs to decide in [docs/open-questions.md](../open-questions.md) under the step.
- Update [docs/architecture.md](../architecture.md) when files change, and these pages when what they say changes.

## Adding an external write safely

1. **Code.** A named action in `actions/registry.ts`, implemented through the write framework (`actions/timebox-actions.ts` for Outlook, `actions/devops-write-actions.ts` for DevOps): validated input, a preview held on the server, confirm by preview id, the write (DevOps: `test /rev` first), read back, an audit log row, and an undo that refuses when the target changed since. Unit tests for the refusals; one e2e for the main path in the demo, whose writes are simulated (`server/demo.ts`).
2. **Rules.** Add it to the hard rules in [CLAUDE.md](../../CLAUDE.md) and get the step authorized: every external write is named there.
3. **Docs.** The write's row in [Integrations](integrations.md) and in [Security](security.md#external-writes-and-the-audit-log), in the same pull request.
4. **The assistant.** A write the assistant may propose goes into `assistant/allowlist.ts` as a proposal.

## Adding a Graph permission safely

1. **Code.** The scope in `sources/oauth/oauth.ts` (on its own token kind when it needs its own consent) and its row in `plan/permissions.ts` (why, admin consent or not, `later` when each person consents for themselves). Settings › Accounts and calendars › Microsoft permissions shows it from there.
2. **Setup script.** Add it to `GRAPH_SCOPES` in `infra/scripts/app-registration.sh` only if it should be granted for the tenant. Read [Never do a full run of app-registration.sh](operations.md#never-do-a-full-run-of-app-registrationsh) first: the grant step deletes people's own consents. Admin consent for the tenant is a Cooptimize IT task; say so in the pull request.
3. **Docs.** Its row in [Integrations](integrations.md#microsoft-entra-id-and-microsoft-graph), and in [Security](security.md) when it changes what FocusTime can reach. `npm run docs:check` fails until Integrations lists it.
4. **Rules.** A permission that reads something new (another person's data, messages, files) needs the step's authorization and a hard rule in [CLAUDE.md](../../CLAUDE.md) saying what is kept, shown and never logged.

History: the test setup and its flaky-test fixes are recorded in [docs/decisions.md](../decisions.md).
