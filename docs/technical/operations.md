# Operations

For whoever deploys, watches or fixes FocusTime. The step-by-step commands are in the [runbook](../azure/runbook.md); this page is the map. Checked against `2f4c0ea` on Nov 13, 2026.

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

The VM's automatic start (Settings › Accounts and calendars › Start my VM before my day) runs only on the hosted app (`FOCUSTIME_HOST=azure`) where `FOCUSTIME_ENV` is exactly `prod`, which only `infra/prod.bicepparam` sets. Dev, the developer loop and the demo never start a VM on their own; the setting there says it runs only on production. Start and Stop pressed by a person work everywhere. To see the automatic start without prod, use the e2e demo (`e2e/vm2.test.ts`, `FOCUSTIME_DEMO_AUTOSTART_ENV=prod` on the fake Azure); never set `FOCUSTIME_ENV=prod` anywhere else.

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

Admin › Status on a test site has a "This is a test site" row listing what runs there only on a button (`server/background-status.ts`), and a second row while a watch period is on. What a test site's database already holds stays; the usual retention rules still expire old chat text and transcripts.

**Adding background work:** name it in `BACKGROUND` with what it touches and what it does outside production, then start it from the scheduler or a tick under that name. Nothing else reads `FOCUSTIME_ENV` to decide what runs.

## Reminders

Every reminder goes through one notifier (`plan/notify.ts`) and one gate: each kind has its own switch in Settings › Notifications › What to notify me about, nothing is sent outside working hours or on PTO days, and what comes due during focus is held and delivered as one after. The person's ticks (`server/ticks.ts`) send these now:

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
| Urgent request | A chat message picked out as needing the person now (Settings › Notifications › Urgent requests during focus decides whether it breaks through focus) |
| Story taken, Assigned, Dates moved, Item edited | Someone took my story, assigned me an item, moved my dates or edited my item in FocusTime |
| Sent to you, Send answered, Can't lead | A teammate sent me work; my send was answered; someone I sent a Must to can't take it this week |
| Look asked, Look replied | A teammate asked me to look at their week; my ask was answered |
| Status report | Monday's status report is coming and my features need updates |
| Client call to review | A registered client call I review has proposals |

The Teams bot sends its own rhythm (brief, check-in, close out, nudges, client calls) only with "Let FocusTime message me in Teams" and that kind on, all off by default.

## Deploys

- **Dev on merge.** `.github/workflows/deploy-dev.yml` runs on every push to `main`: the CI checks (only the typecheck when the pull request's CI run tested exactly the same tree), the image to dev's registry, `focustime migrate`, the app's database user, the Bicep (what-if, then create), a smoke test (`infra/scripts/smoke.sh`).
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
| `ci.yml` | Every pull request, every push to `main`, and called by deploy-dev | The typecheck, the guards, the unit tests against SQL Server, the browser tests in shards (see [Development](development.md)) |
| `deploy-dev.yml` | Every push to `main`, or by hand | Above |
| `deploy-prod.yml` | By hand only | Above |
| `ci-webkit-deps.yml` | A pull request that changes `scripts/ci-webkit-deps.sh` or the CI workflows, or by hand | Proves the browser jobs' WebKit packages install from the cache with the package servers unreachable; tests nothing of FocusTime's and isn't part of the gate |

## Diagnostics, logs and what is never logged

- **For people:** Settings › Your data › Diagnostics (counts only, for their own chats), Settings › Activity (every outside write, with Undo and Retry) and Settings › DevOps › Find an item (why an item isn't showing).
- **For admins:** Admin › Status (sources, jobs, polling health) and Admin › Audit (every admin change). **Not verified:** each Status line against the code.
- **Logs:** the console (`az containerapp logs show`), Application Insights and Log Analytics (30 days, `infra/modules/monitoring.bicep`). Queries in the runbook's [Read logs](../azure/runbook.md#read-logs). Each request is one operation with its own trace.
- **Never logged:** tokens, secrets, PATs, Authorization headers, request or response bodies, message or transcript text, prompts and answers, people's ids or email addresses, chat ids, topics or members, and client keys except as a one-way reference. The logger has no field for them (`log/logger.ts`).

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| Someone says an item they made in DevOps isn't in FocusTime | Usually the area scope, a filter, or the item is in another project | Ask them to open Settings › DevOps › Find an item with the client and the number: it says which. Refresh checks DevOps now |
| A deploy fails because a resource provider is `NotRegistered` | The deploy identity can only work in its resource group; it can't register a provider for the subscription | Run `infra/scripts/bootstrap.sh --env <env> --member <your upn> --dry-run`, then without `--dry-run`. It registers the providers and changes nothing else. **Not verified:** the exact error text Azure shows |
| FocusTime doesn't show in Teams | Prod: the package isn't uploaded, isn't Allowed in Manage apps, or a permission policy blocks custom apps; it can take a few hours to reach people. Dev: the tester's setup policy hasn't applied yet (hours), or they haven't uploaded the package | Check Teams admin center › Manage apps and the policies ([teams-bot.md](../setup/teams-bot.md)) |
| The bot doesn't answer the first message on dev | Dev wakes from zero in about 30 seconds; Teams gives a bot 10 to 15 | Send it again. Prod always runs |
| A source shows as not live: Outlook, Google or DevOps writes say they aren't connected | That person hasn't connected it, their sign-in expired, or a consent is missing | The source's own message names the fix: Settings › Accounts and calendars (consents, Reconnect), Settings › DevOps (DevOps write access) |
| Every browser shard fails at "Install WebKit's system packages" (or another step before "Browser tests") with `Temporary failure resolving` or `Failed to fetch` | The Ubuntu package servers, npm or the Playwright CDN couldn't be reached; nothing is wrong with the code. The packages install from the cache with no network on the same runner image, so this happens only on a new image or Playwright version | Re-run the failed jobs once it's back: `gh run rerun <run id> --failed`. A deploy-dev that ran CI itself waits on it: re-run its failed jobs too. Runbook, [When CI's browser jobs fail before testing](../azure/runbook.md#when-cis-browser-jobs-fail-before-testing-ci-2) |
| Dev is slow on the first request | A cold start: dev scales to zero | Wait a few seconds |
| "AI isn't set up" | No `ft-openai-key` in that environment's vault | `infra/scripts/openai-key.sh` (used within a minute, no restart) |
| Push notifications aren't set up | No `ft-vapid-key` | `infra/scripts/vapid-key.sh` |

History: environments, deploys and the background policy are recorded in [docs/decisions.md](../decisions.md).
