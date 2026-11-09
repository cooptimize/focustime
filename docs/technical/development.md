# Development

For engineers changing FocusTime, people and Claude Code alike. Checked against `13cd461` on Nov 7, 2026; local browser runs against `fix/tx1-loose-ends` on Nov 8.

Read first: [CLAUDE.md](../../CLAUDE.md) (the rules), [docs/spec.md](../spec.md) (the slices so far), [docs/decisions.md](../decisions.md), and the rest of these pages.

## Local setup

- **Node 26** or newer (`package.json` `engines`). FocusTime runs TypeScript directly on Node; there is no compile step for the server.
- `npm ci`, then `npm run db:up` for the local SQL Server container (`scripts/db.ts`; its password is the host secret `sql-password` in the developer's keyring, never in a file).
- `npm run dev` runs the server with Vite inside it (no hot reload). Without Microsoft sign-in set up, use **Try the demo**: fictional data in memory, nothing fetched.
- The developer loop (a user service and a launcher on one machine) is described in [system/README.md](../../system/README.md). It isn't part of the product.
- Every command is in [docs/architecture.md, Running it](../architecture.md#running-it).

## One step, one worktree, one PR

- Work on a branch in its own worktree: `git worktree add ~/Code/focustime-wt/<name> -b <branch> origin/main`. `~/Code/focustime` stays on `main`. Never run builds, migrations or servers against another checkout's database or build folder.
- One pull request per step, small commits, `origin/main` merged in just before opening it. Parallel sessions keep to their own scope.
- **Claude Code never merges** a pull request, never deploys prod and never pushes to `main`. A person reviews and merges.
- Never commit secrets or real personal or client data. Tests use fakes (`@example` addresses, `contoso` and `fabrikam` orgs); screenshots come from the demo only. `npm run guards` checks for real names and desktop words.

## Tests and CI

| Command | What it runs |
|---|---|
| `npx vitest related <files>` or `npx vitest --changed` | The inner loop: tests related to what you changed |
| `npm run typecheck` | Both TypeScript projects (the UI, and the server with scripts and tests) |
| `npm run guards` | The repo guards: real names, desktop words, type and state names as code, "pick" in text people read |
| `npm run docs:check` | The technical docs' checks (links, Checked lines, Graph permissions, diagrams, secret shapes) |
| `npm test` | The full suite: unit, store (SQLite and SQL Server) and browser tests |

- **Browser tests** (`e2e/`) each start their own demo server with a pinned clock (`e2e/harness.ts`), in Chromium and, for the Safari checks, WebKit. One e2e per feature for its main path; edge cases are unit tests.
- **A full local browser run:** `npx vitest run e2e/` (about 5 minutes on 20 cores; `npm test` adds the unit and store tests in the same time). Each file gets its own demo server, free port and temp folder, the UI is built once per run, and the run's temp folder is removed at the end. `test/workers.ts` picks the worker count from free CPU and memory; `FOCUSTIME_TEST_WORKERS=<n>` overrides it, and `FOCUSTIME_TEST_WORKERS=2` with `taskset -c 0-3` is close to a CI shard. Runs in different worktrees can overlap.
- **Stopping servers by hand:** stop your own server by its process id, never by a pattern such as `pkill -f server/main.ts`: on a shared machine it also stops other sessions' test servers and the local service. If a run fails with `ERR_CONNECTION_REFUSED` or "The demo server on port N stopped during the test", look for that first.
- **Test data** comes from the builders in `test/builders`, never hand-written fixtures. A test that starts a server takes its port from `test/ports.ts`.
- **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to `main`: the typecheck, the guards, the unit and store tests with SQL Server, a UI build, the browser tests in six shards, the Bicep build and the image build. There are no retries.
- **Known flaky tests.** HK-5 found and fixed the causes it could reproduce (D932 to D939: an Ahead test that raced the demo's staged change, the feedback dialog's focus, the admin poller's clock, the Inbox count). A flake is a cause to find, never a retry: rerun it once, and if it fails again, run that file several times at once on fewer cores to reproduce it ([docs/architecture.md, Testing](../architecture.md#testing-hk-5)).

## Decisions and open questions

- Record a decision in [docs/decisions.md](../decisions.md) under the step's heading, unnumbered. Numbers are assigned when the step merges, in merge order, so two parallel PRs never take the same number. Never renumber an existing decision.
- Record what a person needs to decide in [docs/open-questions.md](../open-questions.md) under the step.
- Update [docs/architecture.md](../architecture.md) when files change, and these pages when what they say changes.

## Adding an external write safely

1. **Code.** A named action in `actions/registry.ts`, implemented through the write framework (`actions/timebox-actions.ts` for Outlook, `actions/devops-write-actions.ts` for DevOps): validated input, a preview held on the server, confirm by preview id, the write (DevOps: `test /rev` first), read back, an audit log row, and an undo that refuses when the target changed since. Unit tests for the refusals; one e2e for the main path in the demo, whose writes are simulated (`server/demo.ts`).
2. **Rules.** Add it to the hard rules in [CLAUDE.md](../../CLAUDE.md) and get the step authorized: every external write is named there.
3. **Docs.** The write's row in [Integrations](integrations.md) and in [Security](security.md#external-writes-and-the-audit-log), in the same PR.
4. **The assistant.** A write the assistant may propose goes into `assistant/allowlist.ts` as a proposal, never a read.

## Adding a Graph permission safely

1. **Code.** The scope in `sources/oauth/oauth.ts` (on its own token kind when it needs its own consent) and its row in `plan/permissions.ts` (why, admin consent or not, `later` when each person consents for themselves). Settings › Connections shows it from there.
2. **Setup script.** Add it to `GRAPH_SCOPES` in `infra/scripts/app-registration.sh` only if it should be granted for the tenant. Read [Never do a full run of app-registration.sh](operations.md#never-do-a-full-run-of-app-registrationsh) first: the grant step deletes people's own consents. Admin consent for the tenant is a Cooptimize IT task; say so in the PR.
3. **Docs.** Its row in [Integrations](integrations.md#microsoft-entra-id-and-microsoft-graph), and in [Security](security.md) when it changes what FocusTime can reach. `npm run docs:check` fails until Integrations lists it.
4. **Rules.** A permission that reads something new (another person's data, messages, files) needs the step's authorization and a hard rule in [CLAUDE.md](../../CLAUDE.md) saying what is kept, shown and never logged.
