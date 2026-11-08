# Architecture

For engineers changing FocusTime, and IT wanting the big picture before [Security](security.md). Checked against `4088995` on Nov 7, 2026; The assistant against `1e74410` with AS-3 (`feat/assistant-answers`) on Nov 7, 2026.

FocusTime is one Node.js server (TypeScript, run directly by Node) that serves a React app and a JSON action API, keeps its data in one SQL database, and talks to Microsoft Graph, Dataverse, Azure DevOps, Google Calendar, Azure Resource Manager and OpenAI. The per-folder detail is in [docs/architecture.md](../architecture.md); this page is the overview.

## The parts

| Part | What it is | Where |
|---|---|---|
| Web app | React 19, built by Vite into static files; one page with tabs (Today, Week, Ahead, Inbox) and full-window panels (Settings, the Guide, these docs). Heavy panels load only when opened | `ui/`, `vite.config.ts` |
| Server | Node.js `http` server: sign-in, sessions, the action API, a few upload and media routes, the Teams bot endpoint, the built UI | `server/app.ts`, `server/main.ts` |
| Actions | Every operation the UI, the command menu, the assistant and the bot can run: named in one registry, validated, dispatched | `actions/registry.ts`, `actions/dispatch.ts` |
| Pure rules | The week from patterns and events, risks, fit, planning, notifications; no I/O | `week/`, `plan/` |
| Sources | Adapters for each outside system | `sources/` |
| Plan store | Azure SQL (dev and prod), every statement scoped to the signed-in person | `store/` |
| Host | The only code that touches the machine (secrets, keys, caches, notifications): `host/azure` hosted, `host/local` for the developer loop; picked by `FOCUSTIME_HOST` | `host/` |
| Scheduler and jobs | One in-process scheduler: per-person ticks (timer ends, reminders, notifications) and app jobs (polling, purge) | `server/scheduler.ts`, `server/ticks.ts` |
| Teams bot | An Azure Bot whose identity is a managed identity, calling `/teams/messages` on the same app; 1:1 chats only | `server/teams/`, `infra/modules/bot.bicep` |
| Assistant | One service for the in-app panel and the bot; reaches only the actions on its allowlist | `assistant/` |
| AI provider | Every AI request goes through `ai/` (guard, budget, request log) to OpenAI; a stub in the developer loop | `ai/` |
| Infrastructure | Bicep for the Container Apps environment and app, Azure SQL, Key Vault, the registry, monitoring, the bot, budgets | `infra/` |

### Running in Azure

- **Container Apps.** One Container App per environment (`ft-dev-app`, `ft-prod-app`), 0.5 vCPU and 1 GiB, HTTPS-only external ingress on port 8080, health probe on `/healthz` (no database call), single revision mode, at most one replica (`infra/modules/app.bicep`). Prod keeps one replica always; dev scales to zero after 300 seconds without a request (`infra/dev.bicepparam`).
- **Azure SQL.** Entra-only authentication: the app signs in with its system-assigned managed identity. Fixed-price DTU tiers: dev S0, prod S1 (`infra/modules/sql.bicep`, `infra/prod.bicepparam`).
- **Key Vault.** RBAC mode, soft delete and purge protection on. Holds the app secrets and the key that wraps the app's data key (see [Security](security.md#secrets)).
- **Image.** Built once per commit by `deploy-dev.yml` into dev's container registry; prod runs the same image by digest (see [Operations](operations.md#deploys)).
- **Monitoring.** Log Analytics (30 days) and workspace-based Application Insights (`infra/modules/monitoring.bicep`).

### Background jobs and job_claims

The scheduler (`server/scheduler.ts`) runs a fast pass every 5 seconds and a slow pass every 30 seconds, but only while someone has used FocusTime in the last 15 minutes. Otherwise it sleeps until the next stored due time (`scheduler_state`), making no database call, so the database can rest.

App jobs run at the start of each slow pass, each with its own next-due time (`server/main.ts`):

| Job | What it does |
|---|---|
| `people_refresh` | Reads people and client leads from Dataverse into the directory; ends sessions of anyone now known as a guest |
| `retention` | The daily purge (see [Data](data.md#retention)) |
| `meeting_capture` | Registered client calls: occurrences, transcripts after each call, the AI pass |
| `devops_poll` | Central DevOps reads: changed items per client, the change log |
| `requests_poll` | Shared polling of registered client chats, every 5 minutes in followers' working hours; also records their co-working calls (CW-1, `chat_calls`) |

A job that must run once per period claims it with a unique insert in `job_claims` (`store/retention.ts` `claimPeriod`), so a restart or a second replica can't run it twice; a failed run gives its claim back. Hourly maintenance hard-deletes accounts past their 30 days and sweeps expired sessions.

## Module map

```mermaid
flowchart LR
  ui[ui/ React app] -->|POST /api/action| server[server/]
  server --> actions[actions/]
  server --> assistant[assistant/]
  assistant --> actions
  actions --> plan[plan/ and week/ pure rules]
  actions --> store[store/ plan store]
  actions --> sources[sources/ adapters]
  actions --> ai[ai/ guard and provider]
  server --> host[host/ local or azure]
  store --> host
  sources --> host
```

The host boundary is enforced: `host/boundary.test.ts` fails when a core module (`week/`, `plan/`, `actions/`, `sources/`, `store/`, `ai/`) touches files, processes, sockets or the keyring. Demo data is wired in one place (`server/main.ts` to `server/demo.ts` to `sources/demo/`), and `host/no-demo-leak.test.ts` fails if anything else imports it.

## The planning rules

The week, risks, free time, budgets and estimates are pure code in `week/` and `plan/`: no I/O, deterministic, unit tested. The words for each idea are in the [glossary](../../CLAUDE.md#glossary-use-these-words-in-code-ui-and-chat).

- **Half-days.** A person's working hours (`[hours]`, their own setting, read with `userZone()` in `week/zone.ts`) split each day into AM and PM at lunch (`week/hours.ts`). The hours only place meetings into AM or PM and estimate free time; a half-day is a unit of commitment, not a clock window.
- **Focus blocks.** Dataverse Focus Time rows are weekly patterns (Mon to Thu, AM, PM or All Day, a start and an optional end), expanded into the week's blocks (`week/patterns.ts`). Standing blocks are the person's own setting, none by default. A Mon to Thu half-day with no block is Open.
- **PTO.** Every PTO day is a whole day off: no risks, no to-dos, no free time (`week/pto.ts`, `week/free.ts`). Teammates' PTO shows only as "away".
- **Risks.** Checked per half-day that has a focus block (`week/risks.ts` `evaluateRisks`); events shown as free or working elsewhere don't count, tentative and missing show-as count as busy. The thresholds start from the team's Default (Admin) or the built-in values below.

| Rule | When | Shows as |
|---|---|---|
| Meeting load | Busy meeting minutes inside the block reach 90 (`meeting_watch_minutes`) | Watch |
| Meeting load | They reach 150 (`meeting_at_risk_minutes`) | At risk |
| Personal conflict | A busy personal (Google) event overlaps the block | At risk |
| Personal conflict | An all-day personal event that day | Watch |
| Out of office | An Outlook out-of-office event overlaps or covers the block | At risk |
| All-day busy | An all-day Outlook event that is busy or has no show-as | Watch |
| No focus window | The longest free stretch is under 90 minutes (`min_focus_window_minutes`) | At risk |
| Double-booked | More than one focus block in the half-day | At risk |

- **Week's weekend columns and Evening band (WK-3).** Week is Monday to Friday; `week.load` adds Saturday or Sunday (`week/build.ts`, `weekendPlanned` in `actions/dispatch.ts`) when a timed or all-day calendar item, a planned or done to-do, a FocusTime timebox, a flex session or a promise due falls there, or always with the viewer's Show weekend (`ui/weekend.ts`, this browser's storage, sent as `weekend: true`). A weekend day is `kind: "weekend"`: no blocks, Open half-days, capacity or risks; the Board draws it as one quiet cell (`WeekendDay` in `ui/WeekGrid.tsx`, rows from `weekendRows` in `plan/evening.ts`), Today as a Weekend day, the phone as one more day chip. Items after a weekday's day shape go in the Evening band under PM (`eveningBand`), hidden when empty. Moves onto a weekend are allowed by drag, menu and assistant with the day's note (D947) and Undo.
- **Deployment to-dos and after-hours time (WK-3, DP-0).** A Deployment is a to-do (`picks.todo_kind = 'deployment'`) with a window (`window_start`, `window_end`, local times) and optional links (`links`) and note; `deploy.add` and `pick.set_kind` make one, and the window decides its half (`windowHalf` in `plan/deploy.ts`). `afterHours` in `plan/deploy.ts` adds up the week's time outside the day shape (a Deployment's window outside the person's hours, all of it on a weekend or PTO day; other to-dos placed in an evening or on a weekend; timeboxes after the day's end), returned by `week.load` as `afterHours` and shown as "3h after hours this week". Done on a Deployment offers Tell <client> through LP-1's Close the loop (`DeployedOffer` in `ui/Deploy.tsx`). The assistant's `plan_deployment` proposes `deploy.add`, run only on Confirm.
- **Ahead's tree (AH-6).** Grid and Gantt fold the same tree (`plan/gantt-tree.ts`): a level for the whole tree (Show: Epics · Features · Stories, names from the process model) with per-row carets on top, the rows on screen, and a collapsed row's roll-up (its children's earliest start to latest end). The Gantt (`ui/ahead/Gantt.tsx`) draws one row height for label and bar, status as the bar's look (`barTreatment` in `plan/gantt.ts`), one callout marker per row with its popover and fixes, and arrow caps past the edges (`capText`). View choices (level, carets, Show callouts, column width) are per browser (`ui/ahead/prefs.ts`).
- **Ahead's toolbar (AH-6).** One toolbar (`ui/ahead/Toolbar.tsx`) for Grid, Gantt, Readiness and Backlog, over one filter state: the filters in the plan store (`ahead.filters`), the level, carets and Show callouts in this browser, all mirrored in Ahead's address query. `plan/ahead-view.ts` is the pure part: the Dates quick picks against today, the query (`toQuery`, `fromQuery`, `withQuery`), where a control can't apply and why (`notHere`), and the summary line with its chips. Every mode filters through `filterRows` (`plan/ahead-model.ts`): Grid and Gantt directly, Readiness (`fixGroups` with the filters) and Backlog (`backlogOf`) on its kept rows. Readiness was Gaps until AH-6; its code name stays `fix`.
- **Readiness you can finish (AH-7).** `plan/readiness.ts` is the pure part: Start here's urgency rule (`startHere`, `START_RULE`), the counts by kind (`kindCounts`, `toggleKind`), skips that last 14 days (`liveSkips`) and progress (`fills`, `addFixed`, `fixedSince`). `fixClient` (`plan/fixnext.ts`) also returns the skipped entries, the pieces my change set fills (`pending`) and a just-fixed entry kept to fade out (`leaving`). Skips are `ahead.skip` and `ahead.unskip`, kept in the plan store's `kv` (`ahead_skips`); the write framework records each saved fix after a `fields` write lands (`aheadLanded` → `ahead_fixed`); `ahead.load` returns the live skips and this week's count. `ui/ahead/FixNext.tsx` draws the counts, Start here, a fix per missing piece (AH-5's popover editors) and Skipped; `ui/ahead/Ahead.tsx` keeps the skips, the fade, the Undo toast and the progress line.

A card shows one status: At risk with its short reason, Too much planned, Fits just or Fits (`plan/blockstatus.ts`). Budgets and estimates are in hours (`plan/weekplan.ts`, `plan/estimate.ts`).

## A normal request

1. The browser calls `POST /api/action` with `{ action, input }`, its session cookie and the `X-CSRF` header.
2. `server/guard.ts` checks the Host and Origin against the public URL and that the call comes from FocusTime's own page (fetch metadata). Anything else gets 403.
3. `server/app.ts` finds the session (`store/accounts.ts`: 12 hours idle, 7 days at most) and checks the CSRF token for any state change.
4. `actions/dispatch.ts` looks the action up in the registry, validates its input and builds the person's context: their settings, their scoped plan store, their sources.
5. Every plan store statement goes through `store/scope.ts`, which adds the session's `user_id`; a user id never comes from the browser.
6. The answer is JSON. Source failures come back as a status with a plain message and a fix, never as another source's data.

## An external write

Every write to Outlook, DevOps, Teams presence or Azure is a named action through the write framework. Outlook and DevOps follow this shape:

```mermaid
sequenceDiagram
  participant P as Person
  participant A as FocusTime
  participant X as Outlook or DevOps
  P->>A: preview (named write)
  A->>X: read the target now
  A-->>P: before and after, who sees it
  P->>A: confirm (the preview id)
  A->>X: write (DevOps: test /rev first)
  A->>X: read back
  A-->>P: done, with Undo
  Note over A: every attempt in the audit log
```

- **Preview.** The server reads the target and holds a preview (every field before and after, the account, who will see it) for 5 minutes under an id (`PREVIEW_MS` in `actions/timebox-actions.ts`, `actions/devops-write-actions.ts` and `actions/vm-actions.ts`).
- **Confirm** sends only the preview id. A preview that expired or whose target changed is refused.
- **Write.** DevOps patches start with a `test` on `/rev`, so a change someone made since the preview fails instead of being overwritten. Outlook updates re-read the event and refuse it unless FocusTime's marker is on it.
- **Read back.** The target is read again and compared with what was meant before the write counts as done.
- **Audit log.** Every attempt with when, where, before and after, and its result (`write_log`, `devops_write_log`, `azure_write_log`, `teams_status_log`), shown in Settings › Activity with Undo and Retry where they apply.
- **Undo** is itself a previewed, confirmed and logged write, refused when the target changed after FocusTime's change.

Exceptions are listed in [Security](security.md#external-writes-and-the-audit-log): Teams presence during focus has no preview, the VM start has no undo, and plan store changes from the bot's buttons run at once with Undo.

## The assistant

One service (`assistant/service.ts`) answers the in-app panel and the Teams bot; it reaches only the actions on its allowlist (`assistant/allowlist.ts`), through the person's own dispatch. A message goes:

1. **The server reads my words first** (`assistant/resolve.ts`): to-dos, items and features of my clients by `#id`, whole title, "the story for …" or (AS-3) part of a feature's title ("the Data Staleness items", "the feature name they're under is data staleness"). Matches in two clients, or two items that fit equally, are a question with choices (AS-2); nothing of any client goes to the AI before I choose.
2. **The intent round** (`assistant.intent`) sees only my words, the screen and, for a follow-up, my earlier request with client names and ids hidden. It names the tools a change needs, or (AS-3) says it is a question: a topic (`plan_check`, `capabilities`, `agenda`, `promises`, `waiting`, `readiness`, `deployments`, `status_updates`, `done`, `calls`, `items`, `general`), a period, and whether it follows up the last request.
3. **A change** goes to the answer round (`assistant.answer`) with one client's matches as quoted data; each write becomes a proposal with the button's own preview, run only on Confirm (AS-1, AS-2).
4. **A question** (AS-3) is answered from my own data. `assistant/context.ts` reads the period (one `week.load` per week it touches, and only what the topic needs of `ahead.load`, `status.load`, `inbox.list` and `meeting.mine`), keeps only my clients (`isMine`), and bounds it: at most 14 days, 40 to-dos, 12 promises, 10 waiting, 12 gaps, 12 features without an update, 6 calls and 10 after-hours parts (`CONTEXT_LIMITS`). `assistant/answer.ts` composes the answer on the server, grouped by client: each line names a real block, to-do, `#id` or promise with its link, and what couldn't be read is said ("Not known"). Up to 3 suggested steps are FocusTime plan proposals (`SUGGEST_TOOLS`: `move_plan`, `confirm_week`); a tap builds the proposal with its preview and still needs Confirm. Only a `general` question about one client sends that client's context to the AI (`assistant.question`), as quoted JSON of at most 16,000 characters; a general question across clients asks which client first.
5. **Memory.** The answer's turn keeps what a follow-up needs (`assistant_turns.pending_json`: my words, the client, the topic and period, the items, to-dos and promises it referred to) for 2 hours (`CONVERSATION_MINUTES`), with its suggestions; a question's choices still wait 10 minutes (AS-2). It is my history: in Export, removed by Clear, pruned at 30 days, never shown to admins.

With AI off, not set up or over a cap, any message gets one line saying so and the command menu; there is no canned list of what the assistant can do. "What can you help me with?" is a question like any other (`capabilities`): what it does, with up to 6 example questions built from my own week, each a tap. The bot shows the same answer: each section a card with its first two links, the suggestions as buttons (`server/teams/assistant.ts`, `server/teams/cards.ts`). `scripts/assistant-eval.ts --url <host>` asks the golden set in a demo session and prints the answers (not in CI).

