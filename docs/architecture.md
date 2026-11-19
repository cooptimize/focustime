# Where things are

Why the code is the way it is, step by step, is in [decisions.md](decisions.md).

This page says where things are: one section per folder, in the order of CLAUDE.md's Folder map, then the docs and the files at the top of the repo. How FocusTime works (the parts, the screens, a request, an external write, the data, the integrations, security, operations) is in [technical/](technical/README.md), and this page doesn't repeat it. What a single file does is in its own header comment.

The screens people see are Day, Week, Backlog, Status, Inbox and Code, with the block panel, the story card, Settings, Admin, the Guide and the Technical docs. Several keep an older name in the code (Day is `today`, Backlog is `ahead`, a to-do is a `pick`): [Names in the code](technical/README.md#names-in-the-code) lists them all, and [The screens](technical/architecture.md#the-screens) gives each screen's files, reads and rules.

## `ui/`

The React app: everything the browser runs, with no server code.

- Entry points: `index.html` loads `ui/boot.ts`, which adds the Temporal polyfill only where the browser lacks it and then starts `ui/main.tsx`. `main.tsx` applies the theme, text size and reduce motion, then mounts `ui/App.tsx` behind the sign-in gate (`ui/Account.tsx`).
- Screens that load when first opened: `ui/screens.ts` is the one list (names in `ui/screen-names.ts`); Day, Week and the top bar are the first download, and `scripts/split-chunks.ts` cuts the build's files to match. A new screen is added there, never imported statically from what the first download holds (`docs/technical/development.md`).
- `App.tsx` holds the tabs, the top bar, the panels and the open week's shared state. `SiteTag.tsx` is the top bar's "Dev" or "Local", from `appenv.ts`, which asks `/version` only on a page the server marked as a test site. `ui/nav.ts` is the one model of where the window is (tab, date, half, open panel, filters) and of its address; every screen reads and changes the address through it.
- `ui/api.ts` is how the UI reads and changes things: a named action on the server, with the session's CSRF token on every call. The only other calls are the version (`/version`) and the assistant's voice, which have routes of their own.
- `ui/menu.ts` builds the command menu (Ctrl+K) from the action registry; `ui/keys.ts` and `ui/keyboard.ts` hold the keys and the rule that keys never fire while typing.
- `ui/StatusBar.tsx` is the line at the foot of the window (sources, DevOps freshness, hidden personal events). `ui/layout.ts` places timed events in lanes on the rails and timelines. `ui/viewport.ts` decides phone or desktop (under 600 px is the phone); `ui/Phone.tsx` and `ui/PhoneShell.tsx` are the phone's shell.
- `ui/styles.css` holds the tokens (colors, the type scale, spacing) and the shared styles; a subfolder with a look of its own keeps its CSS beside it. `ui/theme.ts` and `ui/textsize.ts` set the theme and the Text size.
- The screens' files sit at the top of `ui/` (`Day.tsx`, `WeekGrid.tsx`, `BlockPanel.tsx`, `Status.tsx`, `StoryCard.tsx` and the rest) or in a subfolder below.

Rules for `ui/`: the four sizes of the type scale only, never a literal font size (`docs/design/style-guide.md`); plain words, no em dashes (`docs/design/wording.md`); the product's words from CLAUDE.md's glossary, checked by `scripts/words-guard.ts`; the brand only where `docs/design/brand.md` allows it.

### `ui/ahead/`

Backlog: `Ahead.tsx` is the screen, `Grid.tsx` and `Gantt.tsx` its two views, `Toolbar.tsx` the filters, `Bulk.tsx` the bulk bar, `Editors.tsx` and `GridEdits.tsx` the editors that stage changes, `model.ts` the screen's model over `plan/`, and `prefs.ts` what it remembers per person. Nothing here writes to DevOps: edits go into the change set, and saving it is one `fields` write per item through `actions/`.

### `ui/brand/`

The week mark, the lockup, the loader and the opening. `boot.css` and `boot.ts` load from `index.html` before the app, so the loader shows from the first paint; `Opening.tsx` and `opening.ts` play it out; `geometry.ts` and `motion.ts` are the mark's shape and timing, and `motion.ts` also applies reduce motion. Where the brand may appear is in `docs/design/brand.md`.

### `ui/code/`

Code: `Code.tsx` is the screen (clients, repos, the tree, a file), `Names.tsx` the search across names, `SqlTree.tsx` a SQL project's objects by schema and kind, and `highlight.ts`, `languages.ts`, `prism-manual.ts` and `tmdl.ts` the syntax colors. It only reads; who may read which client's code is decided on the server (`actions/code-actions.ts`).

### `ui/docs/`

The Technical docs panel (`#/docs`). `TechDocs.tsx` shows the pages of `docs/technical/`, which `scripts/tech-docs.ts` reads, renders and sanitizes at build time into `virtual:tech-docs` (`virtual.d.ts`); `pages.ts` is their order and titles. Only signed-in Cooptimizers can open it (`docs.access`).

### `ui/guide/`

The in-app Guide. `content.ts` and `sections.ts` are its text, `tours.ts` and `tour/` the tours, `TryIt.tsx` and `sandbox.ts` the try-its on fictional data, `Search.tsx` its search, `retired.ts` the Renamed list of older names, and `GuideFrame.tsx` the panel it sits in. How to add a section, a tour or a try-it is in `docs/guide.md`.

### `ui/inbox/`

The Inbox: `InboxPage.tsx` is the screen with its three lists (From chats, Promises, Captures), `Detail.tsx` the detail pane, `ItemActions.tsx` each item's actions, `Suggestion.tsx` one suggestion from a chat, and `model.ts` and `data.ts` its model and reads.

### `ui/meetings/`

Calls, a tab (`#/calls`; the older `#/meetings` addresses land there): `Meetings.tsx` is the tab's page (`CallsPage`): one list by day of every call a person can see (registered calls' occurrences, the calls they reviewed or added, and their own calendar's last 14 days from `meeting.calls`; arranged by `plan/call-list.ts`) with filters and client chips, and beside it the chosen call's review (with its summary), a call's setup (`CallSetup`: the client, suggested by `plan/calls.ts`, and the source) or Add a call; two steps when narrow. `actions/call-press.ts` is the press the Graph gate asks for an unregistered call; `calls.ts` is the marks' model and the calls' addresses; `GapFields.tsx` is a new item's row in the New form's fields. Its DevOps writes go only through `ui/DevOpsWrite.tsx` (`one-door.test.ts`). The person's own Pocket recordings (`meeting.pocket_list`) are asked for as Calls opens, on Refresh and on Check Pocket, at most once in 5 minutes (`plan/pocket-recordings.ts` decides whose are kept with `whoseKept` and `plan/pocket-match.ts` matches them to calls); Set my Pocket address is `PocketAddress.tsx` (`meeting.pocket_address_add`, `_remove`), and a call's setup or page brings one in (`meeting.pocket_bring`, `meeting.pocket_add`, `actions/meeting-pocket.ts`). `CallsList.tsx` draws the list's rows (Needs you, a week's row, a repeat, a closed and a hidden row, the tick bar); `plan/call-list.ts` arranges them (Needs you, the weeks, the fold of calls with no transcript, Closed, Hidden) and `plan/call-filters.ts` names the filters; `meeting.calls_check` asks Teams whether a call has a transcript (`actions/call-exists.ts` opens the gate's `exists` purpose and holds the answers 15 minutes); `meeting.call_hide`, `call_unhide` and `call_hides` keep the hidden meetings (`call_hides`); `meeting.skip_all` and `unskip_all` close and reopen calls; `CallsToClose.tsx` is Close out's list and Week's Thursday line. `CallsList.tsx` draws the list's rows (Needs you cards, week rows, the tick bar), `Proposal.tsx` one proposal folded or open (`opensItself`), `GapFields.tsx` an open proposal's grid, and `calls.css` Calls' own styles, imported by `Meetings.tsx` so they load with Calls. The calls started in a client's registered chat come from `actions/chat-calls-port.ts` (what the poll kept in `chat_calls`, for someone in the chat who follows its client) as rows in `meeting.calls`; Review keeps one as `call_kind` "chat", and Get it from Teams reads it through `sources/graph/adhoc-calls.ts` (the token `call_transcripts`) behind `actions/chat-call-press.ts`; the demo's are `sources/demo/adhoc-calls.ts`.

The one DevOps preview: `ui/DevOpsWrite.tsx` is the only file in `ui/` that previews, confirms or retries a change to a client's DevOps (`ui/one-preview.test.ts`, with its named exceptions); `plan/preview-parts.ts` splits a screen's changes into one client and 10 at most per preview and holds the words they say; browser tests drive it with `e2e/one-preview.ts`. Registering a call is in Admin (`ui/settings/AdminMeetings.tsx`).

### `ui/plan/`

Four small planning components shared by Week's and Day's cards, the block panel and Backlog's Gantt: `AddPane.tsx` (the Add list), `Estimate.tsx` (the hours stepper), `FoldLine.tsx` (a folded group's line) and `PlanRow.tsx` (a row with its handle and size).

### `ui/settings/`

Settings and Admin. `registry.ts` is the one list of Settings' groups, sections, addresses and every setting's one name, help and kind; `autosave.tsx` saves a field as it changes. `parts.tsx` (its styles in `parts.css`, loaded with Settings) is the one set of parts every Settings section draws with (a page, a group, a row, a fold, a table, a button row, the saved mark, the team line and the controls by kind), shown on the style guide page by `PartsGuide.tsx`; `sections/` has one file per Settings section, drawn only through the parts (`sections.guard.test.ts`), with `sections/types.ts`, `shared.ts`, `fields.tsx` and `usePlan.ts` beside them; `hours-text.ts` reads working hours as typed. The other files are components a section or Admin uses (client chats, calendar links, the Pocket recorder, Diagnostics, client calls). `Admin.tsx` is Admin's own place (`#/admin`) on the same shell, drawn with the same parts; its pieces are in `ui/settings/admin/`: `places.ts` (the parts, tabs and every address, old ones too), `settings-list.ts` (the one list of Admin's settings: label, part, tab, stored key), `search.ts` (Search Admin), `shared.tsx`, `Tabs.tsx`, `admin.css`, and a file per part (`Clients.tsx` with `ClientFields.tsx`, `People.tsx`, `TeamDefaults.tsx`, `Health.tsx`, `Audit.tsx`), drawn only through the parts (`admin.guard.test.ts`). `ui/Settings.tsx` keeps the shell, the rail, search and routing, on the shared `ui/PanelShell.tsx`. `search.ts` is the one search (Settings' box, the command menu's Settings results through `menu-results.ts`, loaded on the menu's first open, and Search Admin's ranking), with the 100 searches in `search-cases.ts`; `SearchResults.tsx` draws the results, the "which client?" picker and nothing found; `landing.ts` hands a client's-page result from the menu to Settings; `help.tsx` holds the two-line help pieces (`HelpLine`, `More`, `splitHelp`, `useHelpMax`) so the first download needn't load the parts; `MostUsed.tsx` is the phone's first page; `row-labels.ts` names each table cell by its column so a table reads as rows on the phone (Settings and Admin). `ui/day-hours.ts` builds a one-day hours change for Week's day menu and Most used. `scripts/settings-phone-audit.ts` measures every Settings and Admin page on a phone. How to add a setting is in `docs/settings.md`.

## `actions/`

Every named, validated operation. The UI, the command menu, the assistant, the Teams bot and the tests all call these, so each read and each change exists once.

- `registry.ts` is the one list of action names, each with what it works on and how the command menu shows it. A new action starts here, then gets its handler: in its area's file, listed in that file's `*_ACTIONS` array and reached from one branch of `dispatch.ts` (for example `PLAN_ACTIONS` and `planAction()` in `plan-actions.ts`), or inline in `dispatch.ts` for a few small ones.
- `dispatch.ts` takes an action name and its input, rejects an unknown name or unexpected input, and calls the action. Its switch is exhaustive, so a registered action with no handler fails the type check.
- `types.ts` holds the response shapes the server and the UI share (types only).
- One file per area holds that area's actions (`plan-actions.ts` for to-dos and days, `weekplan-actions.ts`, `ahead-actions.ts`, `status-actions.ts`, `conversation-actions.ts`, `code-actions.ts` and the rest); a `*-types.ts` beside one holds its shapes.
- `shared-deploy-actions.ts`: who is on a shared deployment, Take me off, Delete for everyone and their Undos, and a person's own hold (its Outlook event goes through `timebox-actions.ts`).
- External writes live only in their named files: `timebox-actions.ts` (Outlook), `devops-write-actions.ts` (DevOps), `loop-actions.ts` (Close the loop), `presence-actions.ts` (Teams status), `vm-actions.ts` (the VM; the chip keeps the last state while a read fails, and `ui/vm-status.ts` does the same in the page). Each follows the write framework, with `readback.ts` the shared read back. How to add one is in [Adding an external write safely](technical/development.md#adding-an-external-write-safely).
- `admin.ts` is the one `isAdmin()` check; `org.ts` reads the team's values.
- The background readers the scheduler calls live here too: `devops-poll.ts` (DevOps), `request-poll.ts` and `conversations-pipeline.ts` (client chats), `notifier.ts` (the one notifier).

Rules: CLAUDE.md's hard rules name the only writes allowed and the file each lives in; an action never takes a user id from its input (the store adds the session's person); `actions/` is a core module and never touches the machine (see `host/`).

## `assistant/`

The assistant: one service for the in-app panel and the Teams bot. `service.ts` runs a request (one client, the AI, the reply), `allowlist.ts` is everything it may reach and whether each is a read or a proposal, `reads.ts` and `actions.ts` call the registry's actions, `resolve.ts` finds the client and the items a request names, `quick.ts` answers the requests that need no AI, and `types.ts` is the interface (described in `docs/assistant-interface.md`). Its two renderers are `ui/Assistant.tsx` and `server/teams/`.

Rules: nothing outside `allowlist.ts` is reachable; every write is a proposal that runs the button's own action only on Confirm; text read from chats, DevOps or captures is data, never instructions.

## `ai/`

The AI provider and everything around it. `service.ts` is the only way to ask the AI (`aiFor(ctx).run(task, input, schema)`): the admins' switches, the guard, the budget, one call, the schema check, the request log. `guard.ts` decides what may leave for the provider. `openai.ts` is the provider, `stub.ts` the tests' stand-in, `tiers.ts` which tasks use the slower half-price tier, `cost.ts` the prices, `schema.ts` the structured-output schemas, and `view.ts` what Settings › AI shows.

Rules: no code calls a provider except through `service.ts`; one client per request; the core views work with no AI at all.

## `week/`

Pure: the week from focus time patterns, standing blocks, calendar events and PTO. `build.ts` puts it together; `patterns.ts` expands patterns into blocks, `placement.ts` places events into AM or PM, `risks.ts` finds at-risk blocks and their reasons, `free.ts` and `hours.ts` the free time and working hours, `pto.ts` the days off, `personal.ts` the personal events switch, `dates.ts` and `format.ts` dates and their words, and `zone.ts` the person's time zone (`userZone()`, never a hard-coded zone).

Rule: no I/O and no clock of its own; everything comes in as arguments.

## `plan/`

Pure: every planning rule behind the screens (fit and estimates, to-dos, the block panel, Day's timeline, suggestions, promises and conversations, the timer, notifications, Backlog's model and readiness, the status report, Code's kinds, the client boundary's checks). One file per rule, named for what it decides; `types.ts` the shared planning types. Which rules each screen uses is in [The screens](technical/architecture.md#the-screens).

Rule: no I/O, no store, no sources; a rule takes data and returns data, so it is tested on its own.

## `links/`

Pure: `devops-url.ts` checks that a work item link is on the client's own DevOps organization before `link.open` opens it.

## `store/`

The plan store: everything FocusTime keeps for people.

- `open.ts` opens the database from the app config (SQL Server, or SQLite for the demo, the fallback and tests). `sql/` holds the SQL Server driver (`sqlserver.ts`, `conn.ts`), the SQLite one (`sqlite.ts`), the T-SQL translation (`tsql.ts`), SQL Server's baseline schema (`baseline.ts`) and the migration runner (`migrate.ts`).
- `scope.ts` adds the signed-in person to every statement, so no other code writes `user_id`. `isolation.test.ts` fails when a table is neither a user table (with `user_id` first in its keys) nor an app table.
- `plan-store.ts` is a person's plan (to-dos, days, weeks, follow-ups, captures, markers); each other `*-store.ts` file holds one area (conversations, DevOps, Teams, meetings, admin, code views, standards).
- `deployments.ts` is a deployment several people share (app tables), answering a person only about the ones they are on; `plan-store.ts` keeps each person's own to-do for one in step with it, in their zone, and their own hold.
- `user-secrets.ts` seals a person's secrets under the app data key; `user-settings.ts` holds their settings rows; `accounts.ts` the users and sessions; `user-data.ts`, `export-local.ts` and `import.ts` Export and import; `retention.ts` what is deleted after how long.
- `migrations/`: one timestamped file per schema change (`<UTC timestamp>_<what>.ts`), listed in `migrations/index.ts`; `migrations/named.ts` says how the runners apply them, after the frozen numbered migrations (in `plan-store.ts` for SQLite, `sql/migrate.ts` for SQL Server), in name order. `migrations/additive.test.ts` fails on a migration that renames or drops without a `safe-drop:` reason.

Rules: SQL Server changes only through `sql/migrate.ts`; migrations only add; every write runs in a transaction; never a password or token in a file, an argument or a log. The tables are listed on [Data](technical/data.md).

## `sources/`

The adapters that read outside systems, one folder each: `dataverse/` (clients, focus time patterns, PTO, holidays, the directory), `graph/` (Outlook, Teams chats and meetings, people, presence, photos, and the Graph writes in `write.ts` and `send.ts`), `google/` (the personal calendar), `ics/` (calendar links), `calendar/` (the shared calendar reader), `devops/` (work items, processes and Git, and the DevOps writes in `write.ts`), `azure/` (the VM, behind the allowlist in `client.ts`), `pocket/` (a person's own Pocket, three GETs behind the allowlist in `client.ts`), `github/` (Cooptimize's standards) and `oauth/` (token exchange and ID token checks). `demo/` holds the demo's fictional sources. `not-set-up.ts` is what a calendar says when it isn't set up.

Rules: a source that fails or isn't set up says so with its fix, and nothing stands in for it; only `server/demo.ts` wires `sources/demo/` (`host/no-demo-leak.test.ts`); each client sends only the requests its allowlist names. What each source reads and writes is in [Where each source is read and written](technical/architecture.md#where-each-source-is-read-and-written) and [Integrations](technical/integrations.md).

## `host/`

The host boundary: everything FocusTime needs from the machine it runs on, behind one interface, `host/types.ts`. `azure/` is the hosted app's host (Key Vault secrets, the data key, caches in memory); `local/` is the developer loop's (the keyring, files under the XDG folders, the app window, desktop notifications, media players). `server/main.ts` picks one from `FOCUSTIME_HOST`. `fakes.ts` is the tests' host; `per-person.ts` names per-person caches by a hash of the id; `imports.ts` reads a file's imports for the boundary tests.

Rules: core modules (`week/`, `plan/`, `actions/`, `sources/`, `store/`, `ai/`) never touch files, processes, sockets or the keyring (`host/boundary.test.ts`); desktop-only operations exist only in `local/`, and the hosted host refuses them.

## `config/`

The settings model, with no file I/O. `schema.ts` is every setting's type, `defaults.ts` the neutral defaults, `sections.ts` and `settings.ts` how settings are grouped and read, `edit.ts` validates a change, `org.ts` and `org-apply.ts` the team's values and how they resolve with a person's, `starter.ts` a new person's first settings, `deploy-catalog.ts` the deployment checklists, and `background-policy.ts` which background work may run in which environment ([What runs on its own](technical/operations.md#what-runs-on-its-own)).

Rule: a preference is the person's own setting with a neutral default, never the developer's.

## `server/`

The web server and what runs beside it.

- `main.ts` starts FocusTime: it reads the app config (`appconfig.ts`), picks the host, opens the store, builds the background policy and starts `app.ts`. Its header gives the usage.
- `app.ts` is the HTTP app: `guard.ts` checks Host and Origin on every request, then sign-in (`auth/`), sessions with a CSRF token, the one action endpoint (`POST /api/action`) and the UI. `demo.ts` builds a demo session's context.
- `scheduler.ts` runs everyone's background work: the app's jobs, which `main.ts` hands it (`retention-job.ts`, `meeting-job.ts`, `standards-job.ts` and the readers in `actions/`), and each person's ticks (`ticks.ts`: the timer, reminders, Teams status). `use.ts` knows whether anyone is using FocusTime, for the idle rule.
- `job-people.ts` builds one person for the meeting job and the chat poll, with their identity (`signedContext`). `identity-guard.test.ts` fails when a route or job hands the actions a context that didn't come through it.
- `teams/` is the Teams bot's endpoint: `bot.ts` receives, `assistant.ts` hands a message to the assistant, `cards.ts` and `render.ts` build the cards, `rhythm.ts` the daily messages, `gate.ts` the notification gate.
- `notify.ts`, `push.ts` and `webpush.ts` deliver notifications; `sw.js` and `pwa.ts` are the service worker and the installable app.
- `site-env.ts`: on dev and local, the page and the manifest say which site this is (the tab's title, the installed name, the page's `data-site="test"`), rewritten once at start; production's files are served as built.

## `log/`

`logger.ts` is the structured logger, `redact.ts` what is removed from an exception's message before it goes to telemetry, `appinsights.ts` the telemetry to Application Insights, and `operation.ts` one operation's span. What may and may not be logged is on [Security](technical/security.md) and [Operations](technical/operations.md#diagnostics-logs-and-what-is-never-logged).

## `fixtures/`

Older sample data used by a few older tests. New tests take their data from `test/builders/`.

## `e2e/`

Browser tests, one file per feature's main path. `harness.ts` starts a throwaway demo server for each file (its own port, folders and a pinned clock) and opens Chromium or WebKit on it; `live.ts` does the same for a real session on fake live sources; `shots.ts` takes screenshots at 1920 and at the largest Text size when `FOCUSTIME_SHOTS` names a folder. The `*-helpers.ts` files are shared steps.

Rules: fictional data only; a test waits for what it needs on the page, never a fixed sleep. How tests stay apart is in [How tests stay apart](technical/development.md#how-tests-stay-apart).

## `test/`

Helpers for every test: `builders/` (test data, never hand-written fixtures), `ports.ts` (a free port for a test that starts a server), `tmp-dir.ts` (a test's own folder), `db.ts` (the databases store tests run on), `workers.ts` (how many test files run at once), `e2e-build.ts` (the UI built once per browser run), `no-outbound.ts` (proof that a test sends nothing out) and `hosted-person.ts` (a person as the hosted app keeps them: their Dataverse user with their sign-in, not in their settings).

## `system/`

The developer loop: running FocusTime on one developer's machine, not part of the hosted product. `focustime.service` and `focustime-open` run and open it, `install.sh` and `install-icons.sh` set it up, the `.desktop` files add it to the desktop, and `sqlserver/compose.yaml` is the local SQL Server container. `system/README.md` says how.

## `scripts/`

Commands for developers and operators.

- `focustime.ts` is the `focustime` command (export, import, counts, migrate and the other operator tasks; its header and its usage text list them). `db.ts` runs the local database (`npm run db:up`, `db:migrate`, `db:reset`, `db:down`) and `db-guard.ts` limits what a reset may drop; `db-user.ts` makes the app identity's database user, run only by the deploy workflows.
- `guards.ts` runs the repo guards (`npm run guards`), `words-guard.ts` among them; `ci-tree-match.sh` and `ci-webkit-deps.sh` are CI's helpers.
- `tech-docs.ts` builds the Technical docs panel, `tech-docs.test.ts` is `npm run docs:check`, and `docs-diagrams.ts` renders the docs' diagrams.
- `teams-package.ts`, `teams-icons.ts` and `teams-card-previews.ts` build the Teams app package and its previews; `pwa-icons.ts` the app's icons; `build-info.ts` and `image-digest.ts` the build's version.
- `split-chunks.ts` cuts the UI build into its files; `first-download.ts` measures what the first screen downloads (its test is the size limit) and `first-screen-times.ts` times opening the app and each tab.
- `demo-check.ts` and `demo-walkthrough.mjs` check the demo; the `screenshot*` scripts take the screenshots for a screen; `ai-eval.ts` and `assistant-eval.ts` run the AI evaluations.

## `assets/`

Sources the build and the Teams package use: `brand/` (the week mark, the wordmark and the icons, with the tools that bake them) and `teams/` (the Teams app's two icons).

## `public/`

Files served as they are: `prefs.js` (the person's theme, text size and reduce motion before the app loads, so the loader paints right), `manifest.webmanifest` and `icons/` (the installable app), and `legal.html` with `legal.css` (the legal page).

## `infra/`

Azure infrastructure. `main.bicep` and `modules/` describe every resource (the app, the registry, SQL, Key Vault, monitoring, the bot, budgets and costs); `dev.bicepparam` and `prod.bicepparam` are the two environments; `scripts/` holds the idempotent scripts run outside the workflows (bootstrap, the app registration, copying secrets into Key Vault, the OpenAI and push keys, the Google client, the admin group, a smoke test, and a parity check against `parity-allow.txt`). How to use them is in `docs/azure/runbook.md`.

Rules: Azure resources change only through `infra/` and the deploy workflows; a what-if before any create; never a secret in a file, an argument or a log.

## `.github/workflows/`

`ci.yml` runs on every pull request and every push to main: the type check, the guards, the unit and store tests on SQLite and SQL Server (the docs check among them), the UI build, the browser tests in six shards on Chromium and WebKit, the Bicep build, and the image with a smoke test. `deploy-dev.yml` deploys dev on every push to main over OIDC: the CI checks when the tree is new, the image, the migration, the Bicep and a smoke test. `deploy-prod.yml` promotes an image dev tested to prod by its SHA, behind the environment's approval. `ci-webkit-deps.yml` proves the browser jobs' WebKit packages install with the package servers unreachable, and runs only when that script or the CI workflows change. More in [Tests and CI](technical/development.md#tests-and-ci) and [Workflows](technical/operations.md#workflows).

## `Dockerfile`

The hosted image: a build stage, then a slim Node runtime that runs as the `node` user and starts `node server/main.ts --no-open` on port 8080. `.dockerignore` keeps local stores, secrets, config, screenshots, footage and the docs out of it, except `docs/technical/`, which the build renders into the app.

## `docs/`

The written docs.

- `technical/` is how FocusTime works now, also read in the app (`#/docs`); its [README](technical/README.md) lists the pages.
- `decisions/` and `open-questions/` hold every decision and every open question, one file per step (`decisions/README.md` says how a step adds its own); `decisions.md` and `open-questions.md` are their indexes, one line per step.
- `design/` holds the style guide, the wording rules and the brand; `setup/` the setup guides for the Teams bot, meeting capture and Close the loop; `azure/` the Azure move's plan, reports and runbook.
- `settings.md`, `guide.md` and `assistant-interface.md` say how to add a setting, how to add to the Guide, and what the assistant's interface is.
- `history/` keeps each slice's plan as written. `ux/` holds each step's working notes and screenshots. `cleanup-step-2.md` lists what a later cleanup may drop. `analysis/` holds old notes on DevOps patterns, which the app does not have; `scope/` keeps the scope documents the chat steps started from; `teams/` the Teams bot's screenshots. `demo/README.md` says how the demo works (its seeds, Reset demo and what a demo session refuses). `demo/`'s screenshots and script, `roadmap.md`, `demo.md`, `phone.md` and `settings-inventory.md` describe an older app, and each says at its top what date it describes.

## Files at the top of the repo

- `index.html` is the page: the loader's styles and `public/prefs.js` first, then `ui/boot.ts`.
- `package.json` lists the dependencies and every `npm run` command; `vite.config.ts` builds the UI and configures the tests; `tsconfig.json` and `tsconfig.node.json` are the type check's settings.
- `CLAUDE.md` holds the rules every build session reads first; `KICKOFF_PROMPT.md` is the prompt that started the first slice, kept as history.

## Running and testing

Every command (`npm run dev`, `npm test`, `npm run db:up`, `npm run typecheck`, `npm run docs:check` and the rest), local setup, and how CI runs the tests are in [Development](technical/development.md).
