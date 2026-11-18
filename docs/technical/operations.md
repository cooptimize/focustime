# Operations

For whoever deploys, watches or fixes FocusTime. The step-by-step commands are in the [runbook](../azure/runbook.md); this page is the map. Checked against `2f4c0ea` on Nov 13, 2026; Telling the sites apart against EV-1 on Nov 17, 2026; Reminders against the NT-1 branch on Nov 17, 2026; the jobs' identity against the ID-1 branch on Nov 17, 2026.

## Environments

| | Dev | Prod |
|---|---|---|
| Resource group | `FocusTime-dev` | `FocusTime` |
| Region | Central US | Central US |
| App | `ft-dev-app` | `ft-prod-app` |
| Replicas | 0 to 1: scales to zero when idle, the next request wakes it | Always 1 (the in-process scheduler must keep running) |
| Database | Azure SQL, S0, 7 days point-in-time restore | Azure SQL, S1, 14 days point-in-time restore |
| Monthly budget | 30 USD, with alerts | 60 USD, with alerts |
| Image | Built from each merge to `main` | Dev's image for a chosen commit, by digest; never built for prod |
| Deploy identity | `ft-dev-deploy` (OIDC) | `ft-prod-deploy` (OIDC) |
| Chat reading on its own | Off (`requestsPoll = 'off'`) unless a watch period is declared | On |

Both run in the same subscription and share the Entra tenant, the "FocusTime" app registration and the "FocusTime Admins" group. Settings and resource names are in `infra/dev.bicepparam` and `infra/prod.bicepparam`; the container app is `infra/modules/app.bicep`. One replica at most in both (`maxReplicas: 1`). The daily jobs claim their period in `job_claims` and the Teams bot dedupes across replicas, but each person's ticks have no lease (the scheduler's header says so), so keep one replica until one is added.

**Not verified:** how long dev waits before scaling to zero. The Bicep sets no cooldown, so it is Container Apps' default; the runbook says 300 seconds.

The VM's automatic start (Settings › Connections › Start my VM before my day) runs only on the hosted app (`FOCUSTIME_HOST=azure`) where `FOCUSTIME_ENV` is exactly `prod`, which only `infra/prod.bicepparam` sets. Dev, the developer loop and the demo never start a VM on their own; the setting there says it runs only on production. Start and Stop pressed by a person work everywhere. To see the automatic start without prod, use the e2e demo (`e2e/shell/vm-stop-and-autostart.test.ts`, `FOCUSTIME_DEMO_AUTOSTART_ENV=prod` on the fake Azure); never set `FOCUSTIME_ENV=prod` anywhere else.

### Telling the sites apart (EV-1)

- **Dev** says so: a small red "Dev" (white letters) beside the FocusTime name in the top bar on a computer, and beside the date on a phone; the browser tab's title starts with "Dev · "; the installed app is named "FocusTime Dev". The developer loop says "Local" the same way.
- **Production** shows none of this: no mark, the title "FocusTime", the installed app "FocusTime".
- **About** (Settings › About, or More › About) says the site in a word and its address on every site, for example "Site: Dev · " and the address you opened.
- How: the server rewrites the page and the manifest once when it starts where `FOCUSTIME_ENV` is `dev` (or the developer loop), from the same value `/version` reports (`server/site-env.ts`). Only that marked page asks `/version` for the top bar's mark, so production asks nothing new. One image serves both: no second build.
- **An app installed from dev before EV-1 may keep the name "FocusTime".** On Android, Chrome checks an installed app's manifest when it is opened (at most about once a day) and updates its name once all its windows are closed, on Android when the phone is charging and on Wi-Fi ([web.dev, How Chrome handles updates to the web app manifest](https://web.dev/articles/manifest-updates)). On an iPhone, Add to Home Screen takes the name once, from the page's `apple-mobile-web-app-title` (Apple's Safari Web Content Guide, "Configuring Web Applications"; the link is in `docs/open-questions.md`, EV-1); nothing found says it is ever updated, so remove the icon and add it again from Safari to get "FocusTime Dev". The person can also rename it while adding it.

Costs and budgets: [runbook, Cost](../azure/runbook.md#cost-hk-2-fixed-price-databases-list-prices-for-central-us-on-2026-11-05) and [Budgets and alerts](../azure/runbook.md#budgets-and-alerts-hk-2). The budget only alerts; it never stops or changes anything (`infra/modules/budget.bicep`).

## App configuration

The app reads its configuration from environment variables set by the Bicep (`infra/modules/app.bicep`), parsed in `server/appconfig.ts`. They hold names and ids, never a secret: each secret is named by its Key Vault secret name and read through the host's secret store.

| Group | Variables |
|---|---|
| Where it runs | `FOCUSTIME_HOST` (`azure` or `local`), `FOCUSTIME_ENV` (`prod` only on prod), `FOCUSTIME_PUBLIC_URL`, `FOCUSTIME_DIST` |
| Sign-in and admins | `FOCUSTIME_ENTRA_TENANT_ID`, `FOCUSTIME_ENTRA_CLIENT_ID`, `FOCUSTIME_ADMIN_GROUP_ID`, `FOCUSTIME_ADMINS` (the break-glass list) |
| Key Vault | `FOCUSTIME_KEYVAULT_URL`, `FOCUSTIME_DATA_KEY_NAME`, `FOCUSTIME_SECRET_ENTRA_CLIENT`, `FOCUSTIME_SECRET_GOOGLE_CLIENT`, `FOCUSTIME_SECRET_DATAVERSE_CLIENT`, `FOCUSTIME_OPENAI_SECRET_NAME`, `FOCUSTIME_VAPID_SECRET_NAME` |
| Database | `FOCUSTIME_DB_DRIVER`, `FOCUSTIME_DB_SERVER`, `FOCUSTIME_DB_PORT`, `FOCUSTIME_DB_NAME`, `FOCUSTIME_DB_AUTH`, `FOCUSTIME_DB_USER`, `FOCUSTIME_DB_MANAGED_IDENTITY_CLIENT_ID` |
| Sources | `FOCUSTIME_DATAVERSE_URL`, `FOCUSTIME_DATAVERSE_TENANT_ID`, `FOCUSTIME_DATAVERSE_CLIENT_ID`, `FOCUSTIME_GOOGLE_CLIENT_ID`, `FOCUSTIME_BOT_APP_ID`, `FOCUSTIME_INVITE_DOMAINS` |
| AI | `FOCUSTIME_AI_PROVIDER`, `FOCUSTIME_AI_MODEL`, `FOCUSTIME_AI_REASONING_EFFORT`, `FOCUSTIME_AI_MAX_OUTPUT_TOKENS`, `FOCUSTIME_AI_TIMEOUT_MS`, `FOCUSTIME_AI_APP_CAP_USD`, the prices per million tokens (`FOCUSTIME_AI_INPUT_USD_PER_MILLION` and the cached, output and Flex variants) and the Flex limits (`FOCUSTIME_AI_FLEX_TIMEOUT_MS`, `FOCUSTIME_AI_FLEX_MAX_TRIES`, `FOCUSTIME_AI_FLEX_MAX_WAIT_MS`) |
| Send feedback | `FOCUSTIME_FEEDBACK_ORG`, `FOCUSTIME_FEEDBACK_PROJECT`, `FOCUSTIME_FEEDBACK_PARENT_ID` |
| Background work | `FOCUSTIME_REQUESTS_POLL` (a watch period on a test site), `FOCUSTIME_STANDARDS_SYNC` |
| Demo and tests only | `FOCUSTIME_DEMO`, `FOCUSTIME_DEMO_AUTOSTART_ENV`, `FOCUSTIME_DEMO_FEEDBACK_PARENT` |

`infra/scripts/parity.sh` checks that dev and prod have the same app setting and secret names before every prod deploy (names only, never values).

## What runs on its own

Dev and prod are two deployments used by the same people against the same outside systems: one Entra app registration, the same Dataverse, DevOps read PAT, Graph tenant and Azure subscription. Their databases and Teams bot apps are separate. So **outside production, nothing happens on its own** that reaches a person, spends AI, writes to an outside system (Teams status included) or reads a person's delegated data on a schedule. A person pressing a button still works, and acts only for that person.

One pure module decides it: `config/background-policy.ts`. `server/main.ts` computes the policy once from the environment and hands it to the scheduler (its app jobs), to every person's ticks and to the few on-demand paths that differ on a test site. Production is `FOCUSTIME_ENV` exactly `prod`; any other value, an empty value or none is a test site, so a new deployment that forgets the variable is a test site. Every piece of background work is named in the policy's `BACKGROUND` list; one that isn't named never runs outside production, and `config/background-policy.test.ts` fails until it is.

| Work (policy name) | Started from | Outside system | What it does | Prod | Test site (dev, local) |
|---|---|---|---|---|---|
| Chat poll (`requests_poll`) | App job, every 5 min in followers' working hours | Teams (followers' delegated Chat.Read), AI | Reads registered chats, sorts them with AI | Runs | Off. Refresh in the Inbox reads your own chats once with your sign-in. `FOCUSTIME_REQUESTS_POLL=on` declares a watch period |
| Meeting capture (`meeting_capture`) | App job: lay out registered calls, look for transcripts, the AI pass | Graph (reviewers' calendars and transcripts), AI | Reads transcripts, spends AI | Runs | Off. Check now on a registered call looks once with your sign-in |
| Held messages re-sorted (`held_recheck`) | Once per build at start, and when an admin edits a client's names | AI | Spends AI | Runs | Off: held messages stay held |
| Reminders and notices (`notices`) | Each person's ticks | None (the in-app list) | Messages a person (see [Reminders](#reminders)) | Runs | Only for someone who switched on "Send me reminders and Teams messages from this test site" |
| Web Push (`web_push`) | Every notice that passes the gate | Web Push services | Messages a person's devices | Runs | Only with that switch on (the test send always) |
| Teams bot rhythm (`teams_rhythm`) | Each person's ticks | Teams (the bot, the person's 1:1 chat) | The brief, check-in, close out, nudges and client calls to review | Runs | Only with that switch on (Send me a test now always) |
| Teams status (`teams_status`) | The fast tick and every timer button | Teams presence (the person's own) | Writes | Runs | Never, not even from a button. The focus screen says "Teams status isn't changed from the test site." |
| Automatic VM start (`vm_autostart`) | Each person's ticks, before work when they turned it on | Azure (the person's own VM) | Writes | Runs | Never (the VM chip's Start still works) |
| Coop DevOps mailbox (`coop_mailbox`) | Reserved: not built | DevOps comments | Would write | When built | Never |
| DevOps store (`devops_poll`) | App job | DevOps (the company read PAT) | Reads shared data | Runs, in followers' hours | Only while someone is using that deployment |
| People refresh (`people_refresh`) | App job, once a day | Dataverse (the app's own access) | Reads people, levels and client leads | Runs | Runs |
| Standards sync (`standards_sync`) | App job and once at start | Public GitHub, no token | Reads public data | Runs | Runs |
| Calendar refresh (`calendar_refresh`) | Fast tick, every 5 min while a focus timer runs | Outlook, Google (the person's own) | Reads | Runs | Runs (the person started the timer) |
| Focus timer (`focus_timer`) | Fast tick | None | Ends the timer on time | Runs | Runs; its end shows in the page, no push without the switch |
| Retention purge (`retention_purge`), ownership backfill (`conversation_ownership_backfill`), maintenance (`maintenance`), notice sweep (`notice_sweep`), old chat rows (`chat_text_cleanup`) | App jobs and ticks | None | That database only | Runs | Runs |
| Start-up moves (`startup_upkeep`) | Once at start | None | One-time database moves: team settings, the Who repair, old requests to conversations, guest sessions, cancelled VM restores | Runs | Runs |

**The automatic VM start (VM-3):** in production, from the person's planned time on, each outcome is logged once a day as `azure vm_autostart <word>` (started, started_late, already_on, not_chosen, skipped, paused, pto, holiday, pto_unreadable, sign_in, no_vm, refused, not_running, and since VM-4 state_unreadable (a read failed at the planned time; tried again later) and state_unreadable_late (still unreadable at the late limit); and holidays_unchecked, pto_earlier). The words and what each person is told are one list, `OUTCOMES` in `plan/vm-autostart.ts`. When it leaves the VM off for a reason that isn't their own choice, the person sees it on the VM chip, in its menu, in one notice and in Settings. A try with no VM record is in their Azure write log. The scheduler's own lines: `scheduler <pass>_over_limit`, `<pass>_finished_late`, `<pass>_slow`, `<job>_over_limit`, `early_over_limit`; a person's parts: `tick_part <name>_failed`, `<name>_over_limit`. Admin › Status › Background passes shows the same.

Admin › Status on a test site has a "This is a test site" row listing what runs there only on a button (`server/background-status.ts`), and a second row while a watch period is on. What a test site's database already holds stays; the usual retention rules still expire old chat text and transcripts.

**Adding background work:** name it in `BACKGROUND` with what it touches and what it does outside production, then start it from the scheduler or a tick under that name. Nothing else reads `FOCUSTIME_ENV` to decide what runs.

## Reminders

Every reminder goes through one notifier (`plan/notify.ts`) and one gate: each kind has its own switch in Settings › Reminders and notices › What to notify me about, nothing is sent outside working hours or on a day off (with Quiet hours and Quiet on days off on), and what comes due during focus is held and delivered as one after. The person's ticks (`server/ticks.ts`) send these now:

| Reminder | When |
|---|---|
| Plan today | The start of a workday with nothing planned |
| Midday check-in, Close out | After the afternoon starts; near the end of the day |
| The week | Plan next week, a dropped must, the week's nudges |
| Look ahead 4 weeks, Direction review | Every other Thursday once next week is planned; the first Thursday of the month |
| Focus timer, Meeting | A timer ends; a meeting is about to start during focus |
| VM | The morning prompt about the person's VM |
| Promises due | A promise is due or late |
| Expiring secret | A write PAT or another of the person's secrets is near its end |
| Urgent request | A chat message picked out as needing the person now (Settings › Reminders and notices › Urgent requests during focus decides whether it breaks through focus) |
| Story taken, Assigned, Dates moved, Item edited | Someone took my story, assigned me an item, moved my dates or edited my item in FocusTime |
| Sent to you, Send answered, Can't lead | A teammate sent me work; my send was answered; someone I sent a Must to can't take it this week |
| Look asked, Look replied | A teammate asked me to look at their week; my ask was answered |
| Status report | Monday's status report is coming and my features need updates |
| Client call to review | A registered client call I review has proposals |

The Teams bot sends its own rhythm (brief, check-in, close out, nudges, client calls) only with "Let FocusTime message me in Teams" and that kind on, all off by default.

**How the background reads a person's settings.** A person's ticks read their settings one way, the way a request does: in production with their sign-in's identity added (`withSignedIn`), because a hosted person's Dataverse user is kept with the sign-in, not in their settings. Outside production the raw settings, so nothing new is read there. `server/ticks-identity.test.ts` fails when a part reads settings, Dataverse or a context built from them the raw way. The meeting job and the chat poll build each person the way a request does, in every environment (`server/job-people.ts`; [Who is asking](architecture.md#who-is-asking)).

**What a day off is.** Whole-day PTO (the Time Off Tracker) or a company holiday (the Working Days Calendar). One reader per person (`server/days-off.ts`) answers for the whole background: the gate, the reminders, the Teams rhythm, the VM's morning notice and the automatic VM start, from one read of each for a window of 14 days from today, at most every 30 minutes. When PTO can't be read, a read from the last 24 hours that covers the day stands in; without one the gate sends, while the reminders (the look-ahead and direction review among them) and the status nudge wait for a later pass. Holidays that can't be read make it a working day. A failed read is logged once a day per reason as `dataverse day_off pto_unread`, `pto_unread_earlier` or `holidays_unread`, never with a name, an id, a date or a holiday's name. Outside production nothing is read and no day is off. The reminders skip a day off whatever the setting; Quiet on days off decides the rest.

## Deploys

- **Dev on merge.** `.github/workflows/deploy-dev.yml` runs on every push to `main`: the CI checks (only the typecheck when the pull request's CI run tested exactly the same tree), the image to dev's registry, `focustime migrate`, the app's database user, the Bicep (what-if, then create), a smoke test (`infra/scripts/smoke.sh`). A docs-only pull request's run (the browser and image jobs skipped, see [Development](development.md#what-ci-runs-and-when)) records no tested tree, so after its merge all of CI runs first, as for any push.
- **Prod by commit.** `.github/workflows/deploy-prod.yml`, manual only, by someone in the `PROD_DEPLOYERS` repository variable: `gh workflow run deploy-prod.yml -f ref=<sha>`. It promotes the image dev built and tested for that commit (by digest), checks dev and prod have the same app settings and secret names (`infra/scripts/parity.sh`), migrates, deploys the Bicep and checks that prod serves that commit. `dry_run` checks who is running it, that the image exists and parity, and changes nothing.
- **Which commit is where.** More › About in each environment shows its pull request and commit; `gh run list --workflow deploy-dev.yml` and `deploy-prod.yml` show the runs.
- **Migrations only add.** A rename or a drop ships in a later release than the code that stops using it (`store/migrations/additive.test.ts`), so the previous build always runs on the current database.

### Rollback

Run deploy-prod again with the previous commit (the last run's summary prints the command). Only the app changes: the image is the chosen commit's, while migrations and Bicep are always main's. Nothing older than prod's first commit (`a347188`) can be deployed.

An older build is safe on a newer database and newer settings: migrations only add, and unknown settings sections and keys are ignored when read and kept untouched when saved, so a rollback doesn't break or wipe a setting a newer build wrote. Restore the database only when the data itself went wrong (runbook, [Roll back a revision](../azure/runbook.md#roll-back-a-revision)).

## Scripts

All in `infra/scripts/`, each idempotent, each with `--dry-run`, run by hand with your own `az login`:

| Script | What it does |
|---|---|
| `bootstrap.sh` | Once per environment: resource providers (including `Microsoft.BotService`), the resource group, the "FocusTime DB Admins" group, the deploy identity with its GitHub federated credential and roles, the GitHub variables (ids only), and for prod the pull identity and the parity reads |
| `app-registration.sh` | The "FocusTime" web registration: redirect URIs, optional claims, delegated permissions, the tenant grant, the client secret into Key Vault |
| `admin-group.sh` | The "FocusTime Admins" group and the groups claim |
| `copy-secrets.sh` | Copies the Google and Dataverse secrets from the developer's keyring into Key Vault, once |
| `google-client.sh` | Switches to a Google web client from its downloaded JSON |
| `openai-key.sh`, `vapid-key.sh` | The OpenAI key and the Web Push key, straight into Key Vault |
| `parity.sh` | Dev and prod have the same setting and secret names (names only) |
| `smoke.sh` | A read-only check after a deploy: database tier and state, health, version |

### Never do a full run of app-registration.sh

A full run of `infra/scripts/app-registration.sh` re-grants consent with `az ad app permission grant`, which **deletes every grant the app has for Graph**, people's own consents included, then makes one tenant-wide grant of `GRAPH_SCOPES`. Everyone's `Chat.Read` (consented one by one, see [Integrations](integrations.md#microsoft-entra-id-and-microsoft-graph)) would be lost until each person consents again. For a claim change use `--claims-only`. Rotating the secret also runs the grant step, so plan a rotation with this in mind. The open question is Q-HK1-1 in [open questions](../open-questions.md).

Also leave the old "Coopilot Desktop" registration alone; the scripts refuse it (`admin-group.sh`).

## The Teams package

The bot itself deploys with the Bicep (`infra/modules/bot.bicep`). The Teams app package (the manifest and icons) is built by `scripts/teams-package.ts` and uploaded by hand: testers upload dev's package themselves (a setup policy allowing custom apps), and a Teams admin uploads prod's to the org catalog. A code change to the bot needs no new package; a change to the manifest does. Steps: [docs/setup/teams-bot.md](../setup/teams-bot.md).

## Workflows

| Workflow | Runs on | What it does |
|---|---|---|
| `ci.yml` | Every pull request, every push to `main`, and called by deploy-dev | The typecheck, the guards, the unit tests against SQL Server, the browser tests in six shards filled by time and WebKit's own job, the Bicep and the image; a pull request that changes only docs outside `docs/technical/` skips the browser and image jobs, and its own run on a push to `main` skips the tests, which the pull request ran and deploy-dev reruns when it finds no tested tree ([Development](development.md#what-ci-runs-and-when)). The shards' times: `node scripts/shard-times.ts <ci run ids>` rewrites `test/shard-times.json` from those runs' logs (read with `gh`); refresh it when a file's time changes a lot or many files are added |
| `deploy-dev.yml` | Every push to `main`, or by hand | Above |
| `deploy-prod.yml` | By hand only | Above |
| `ci-webkit-deps.yml` | A pull request that changes `scripts/ci-webkit-deps.sh` or the CI workflows, or by hand | Proves the webkit job's packages install from the cache with the package servers unreachable; tests nothing of FocusTime's and isn't part of the gate |

## What the server sends

- **Compressed by the app.** Container Apps' ingress passes answers through as they are; the app compresses its own files once at start (about 0.2 s before it listens) and a named list of large reads per answer ([Architecture](architecture.md#what-the-server-sends-compressed)). No Azure setting is involved, and a rollback to a build before PF-2 simply sends everything plain again.
- **Check it** without signing in or any secret: `curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip, br' <url>/` and the same for a script named in the page (`curl -s <url>/ | grep -o '/assets/[^"]*\.js' | head -1`). Expect `content-encoding: br`, a `content-length` and `vary: Accept-Encoding`; a made-up file under `/assets/` answers 404.
- **A missing file** under `/assets/` is 404 and never cached; the installed app keeps only files that came back as themselves, so a release can't leave a screen broken until the next one.
- **Memory.** The built files are held in memory with their compressed forms: about 3 MB plain and 1.5 MB compressed for this build.

## Diagnostics, logs and what is never logged

- **For people:** Settings › Your data › Diagnostics (counts only, for their own chats), Settings › Your data (every outside write, with Undo and Retry) and Settings › Connections › DevOps › Find an item (why an item isn't showing).
- **For admins:** Admin › Status (sources, jobs, polling health) and Admin › Audit (every admin change). **Not verified:** each Status line against the code.
- **Logs:** the console (`az containerapp logs show`), Application Insights and Log Analytics (30 days, `infra/modules/monitoring.bicep`). Queries in the runbook's [Read logs](../azure/runbook.md#read-logs). Each request is one operation with its own trace.
- **Never logged:** tokens, secrets, PATs, Authorization headers, request or response bodies, message or transcript text, prompts and answers, people's ids or email addresses, chat ids, topics or members, and client keys except as a one-way reference. The logger has no field for them (`log/logger.ts`).

## The VM chip's states

- **A state** (Running, Stopped (deallocated), Starting… and the rest): the last read worked.
- **The state with a hollow mark**: the last read failed; FocusTime keeps the last state it read, says how long ago in the chip's title and menu ("Read 1 minute ago"), and asks again in about 10 seconds.
- **The state and a reason** (Can't reach Azure, Azure is busy, Sign in to Azure again, Azure refused, Can't reach FocusTime): reads have failed for 2 minutes; asked again every 30 seconds. The menu's first line has the same words and what to do.
- **Checking…** alone: FocusTime restarted and hasn't read the VM yet.
- **Unknown**: Azure answered without a state.
- Start and Stop always read Azure afresh before they act (the preview and the confirm each read it), so nothing is started or stopped on an old reading.
- In the log, each failed read is `azure instanceView` with its HTTP status and Azure's error code as `kind` (`AuthorizationFailed`, `TooManyRequests`, `none`, or `other` when it isn't one plain word).

## Find an unexpected failure by its reference

When an action fails in a way the server didn't expect, the person sees "That didn't work … (reference K7QH2M)". The answer is a 500. In the log the same reference is on two lines: `server action_failed` (the action's name in `action`, the error's type in `kind`) and the exception item (`ref` in its properties, with the redacted message and FocusTime's own frames). The reference is random and says nothing about the person or their data.

```kusto
AppTraces | where TimeGenerated > ago(7d) | where Properties['ref'] == 'K7QH2M' | project TimeGenerated, Message, Properties
AppExceptions | where TimeGenerated > ago(7d) | where Properties['ref'] == 'K7QH2M' | project TimeGenerated, ExceptionType, OuterMessage, Details
```

## The VM-4 queries

How VM-4 read production (read only, Log Analytics `ft-prod-log`; `docs/ux/vm4/what-happened.md`). `kind` and `first` are reserved words in KQL: use `Properties['kind']` and other names.

```kusto
// Reads of the VM's state per day: count, failures, median
AppDependencies | where TimeGenerated > ago(3d) | where Name startswith 'azure instanceView'
| summarize n=count(), failed=countif(Success == false), p50=percentile(DurationMs, 50), maxMs=max(DurationMs) by bin(TimeGenerated, 1d)
// Failures by status and Azure's code, per 15 minutes
AppDependencies | where TimeGenerated > ago(1d) | where Name startswith 'azure' and Success == false
| summarize n=count() by bin(TimeGenerated, 15m), ResultCode, code=tostring(Properties['kind'])
// Deploys and restarts: revisions and the background policy line
ContainerAppSystemLogs_CL | where TimeGenerated > ago(1d) | project TimeGenerated, RevisionName_s, Reason_s
ContainerAppConsoleLogs_CL | where TimeGenerated > ago(1d) | where Log_s has 'background_policy' | project TimeGenerated, RevisionName_s, Log_s
// Token refreshes by source and status
AppDependencies | where TimeGenerated > ago(2d) | where Name has 'token' | summarize count() by Name, ResultCode, bin(TimeGenerated, 1d)
// Sign-ins and sign-outs
AppRequests | where TimeGenerated > ago(1d) | where Name has 'sign' | project TimeGenerated, Name, ResultCode
// Background passes that ran long or a part that failed
AppTraces | where TimeGenerated > ago(2d) | where Message startswith 'scheduler' or Message startswith 'server tick_part'
| summarize count() by Message, k=tostring(Properties['kind'])
// Unexpected failures of actions
AppExceptions | where TimeGenerated > ago(2d) | summarize count() by where=tostring(Properties['where']), ExceptionType, bin(TimeGenerated, 1h)
```

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| Someone says an item they made in DevOps isn't in FocusTime | Usually the area scope, a filter, or the item is in another project | Ask them to open Settings › Connections › DevOps › Find an item with the client and the number: it says which. Refresh checks DevOps now |
| A deploy fails because a resource provider is `NotRegistered` | The deploy identity can only work in its resource group; it can't register a provider for the subscription | Run `infra/scripts/bootstrap.sh --env <env> --member <your upn> --dry-run`, then without `--dry-run`. It registers the providers and changes nothing else. **Not verified:** the exact error text Azure shows |
| FocusTime doesn't show in Teams | Prod: the package isn't uploaded, isn't Allowed in Manage apps, or a permission policy blocks custom apps; it can take a few hours to reach people. Dev: the tester's setup policy hasn't applied yet (hours), or they haven't uploaded the package | Check Teams admin center › Manage apps and the policies ([teams-bot.md](../setup/teams-bot.md)) |
| The bot doesn't answer the first message on dev | Dev wakes from zero in about 30 seconds; Teams gives a bot 10 to 15 | Send it again. Prod always runs |
| A source shows as not live: Outlook, Google or DevOps writes say they aren't connected | That person hasn't connected it, their sign-in expired, or a consent is missing | The source's own message names the fix: Settings › Connections (consents, Reconnect), Settings › Connections › DevOps (DevOps write access) |
| The webkit job fails at "Install WebKit's system packages" (or a browser job at another step before "Browser tests") with `Temporary failure resolving` or `Failed to fetch` | The Ubuntu package servers, npm or the Playwright CDN couldn't be reached; nothing is wrong with the code. The packages install from the cache with no network on the same runner image, so this happens only on a new image or Playwright version | Re-run the failed jobs once it's back: `gh run rerun <run id> --failed`. A deploy-dev that ran CI itself waits on it: re-run its failed jobs too. Runbook, [When CI's browser jobs fail before testing](../azure/runbook.md#when-cis-browser-jobs-fail-before-testing-ci-2) |
| Dev is slow on the first request | A cold start: dev scales to zero | Wait a few seconds |
| "AI isn't set up" | No `ft-openai-key` in that environment's vault | `infra/scripts/openai-key.sh` (used within a minute, no restart) |
| A call says the AI step failed | The pass for that call didn't finish: the page names why (the AI service, a timeout, AI not allowed for the client, the budget, FocusTime couldn't read the client's items) and, for a call sent in parts, which part. In production FocusTime tries it again by itself 3 times, 15 minutes apart, unless a retry can't fix it | Fix what the page names (Admin › AI for AI or Allow AI, the budget), then a reviewer presses Propose again. Last 20 requests (Settings, AI and assistant) shows the provider's HTTP status for a failed request ("Failed · HTTP 400"); App Insights has the same as `status` on `op: "request"`, with the tier in `kind`. On dev nothing retries by itself |
| Push notifications aren't set up | No `ft-vapid-key` | `infra/scripts/vapid-key.sh` |
| The VM chip shows a reason (Azure refused, Can't reach Azure, …) | Reads of the VM's state have failed for 2 minutes. The chip keeps the last state it read and keeps asking | Ask what the chip's menu says. In the log, `azure instanceView` lines with a failed status: `kind` is Azure's error code. Azure refused (403): check the person can still see the VM in the Azure portal, and the subscription's activity log for role assignment changes |
| Someone was told "That didn't work … (reference ABC123)" | An action failed in a way the server didn't expect | Find the reference ([above](#find-an-unexpected-failure-by-its-reference)): the action, the error's type and the exception |
| My VM didn't start before my day | The person's chip, its menu and Settings say why (PTO, a holiday, PTO unreadable, the Azure sign-in, no VM, Azure refused, or FocusTime wasn't running). Nothing at all: it wasn't production, or auto-start is off, or it was their own choice (a day not chosen, skipped, paused). VM-4: a state that couldn't be read at the planned time isn't the day's try; FocusTime reads again on later passes until the late limit, then says "couldn't read your VM's state" | Ask what the chip's menu says. In the log, `azure vm_autostart` lines that day (one per reason). Admin › Status › Background passes: a warning means a pass is stuck; the log names the work (`tick_part`, `scheduler … over_limit`). It doesn't try again that day: Start in the chip's menu |

History: environments, deploys and the background policy are recorded in [docs/decisions.md](../decisions.md).
