# Operations

For whoever deploys, watches or fixes FocusTime. The step-by-step commands are in the [runbook](../azure/runbook.md); this page is the map. Checked against `13cd461` on Nov 7, 2026 (the Find an item row against `feat/dv2-devops-fresh` on Nov 11, the browser shards row against `chore/ci2-webkit-deps` on Nov 11; the VM auto-start against `feat/vm2-stop-autostart` on Nov 11, the What runs on its own section against `feat/env1-background-policy` on Nov 11).

## Environments

| | Dev | Prod |
|---|---|---|
| Resource group | `FocusTime-dev` | `FocusTime` |
| Region | Central US | Central US |
| App | `ft-dev-app` | `ft-prod-app` |
| Replicas | 0 to 1: sleeps 300 s after the last request, the next request wakes it | Always 1 (the in-process scheduler must keep running) |
| Database | Azure SQL, S0, 7 days point-in-time restore | Azure SQL, S1, 14 days point-in-time restore |
| Monthly budget | 30 USD, with alerts | 60 USD, with alerts |
| Image | Built from each merge to `main` | Dev's image for a chosen commit, by digest; never built for prod |
| Deploy identity | `ft-dev-deploy` (OIDC) | `ft-prod-deploy` (OIDC) |

Both run in the same subscription and share the Entra tenant, the "FocusTime" app registration and the "FocusTime Admins" group. Settings and resource names are in `infra/dev.bicepparam` and `infra/prod.bicepparam`. Scaling: one replica at most in both (`maxReplicas: 1`, `infra/modules/app.bicep`). The daily jobs claim their period in `job_claims`, and the Teams bot dedupes across replicas, but the scheduler's per-person ticks have no lease (its header says so). Keep one replica until one is added.

**What differs by environment beyond the table (VM-2).** The VM auto-start (Start my VM before my day) runs only on the hosted app (`FOCUSTIME_HOST=azure`) where `FOCUSTIME_ENV` is exactly `prod`, which only `infra/prod.bicepparam` sets. Dev, the developer loop (unset or `local`), the demo and anything else never start a VM on their own, and dev's scheduler doesn't wake for it; the form there says it runs only on production. A person may be opted in on both (separate databases): only prod starts the VM. Stop and Start pressed by a person work everywhere. To see it run without prod, use the e2e demo (`e2e/vm2.test.ts`, `FOCUSTIME_DEMO_AUTOSTART_ENV=prod` on the fake Azure); never set `FOCUSTIME_ENV=prod` anywhere else.

Costs and budgets: [runbook, Cost](../azure/runbook.md#cost-hk-2-fixed-price-databases-list-prices-for-central-us-on-2026-11-05) and [Budgets and alerts](../azure/runbook.md#budgets-and-alerts-hk-2).

## What runs on its own (ENV-1)

Dev and prod are two deployments used by the same people against the same outside systems: one Entra app registration, the same Dataverse, DevOps read PAT, Graph tenant and Azure subscription. Their databases and Teams bot apps are separate. So **outside production, nothing happens on its own** that reaches a person, spends AI, writes to an outside system (Teams status included) or reads a person's delegated data on a schedule. A person pressing a button still works, and acts only for that person.

One pure module decides it: `config/background-policy.ts`. `server/main.ts` computes the policy once from the environment and hands it to the scheduler (its app jobs), to every person's ticks (their parts) and to the few on-demand paths that differ on a test site. Production is `FOCUSTIME_ENV` exactly `prod`; any other value (`Prod`, `production`, `prod ` with a space), an empty value or none is not, so a new deployment that forgets the variable is a test site. Every piece of background work is named in the policy's list; a job or tick part that isn't named never runs outside production, and `config/background-policy.test.ts` fails until it is.

Everything FocusTime does with nobody pressing a button (checked against the code on `feat/env1-background-policy`, Nov 11, 2026):

| Work (policy name) | Started from | Outside system | Reads, writes or messages | Prod | Test site (dev, local) |
|---|---|---|---|---|---|
| Chat poll (`requests_poll`) | App job, every 5 min in followers' hours | Teams (followers' delegated Chat.Read), AI | Reads people's chats, spends AI | Runs | Off. Refresh reads your own chats once with your sign-in. `FOCUSTIME_REQUESTS_POLL=on` declares a watch period |
| Conversation upkeep (`conversations_upkeep`) | After each chat poll | Nothing since IB-4 | Nothing: escalations and follow-through drafts are no longer made | Runs, does nothing | Off |
| Meeting capture (`meeting_capture`) | App job: lay out calls, look for transcripts, the AI pass | Graph (reviewers' calendars and transcripts), AI | Reads people's transcripts, spends AI | Runs | Off. Check now on a registered call looks once with your sign-in |
| Held messages re-sorted (`held_recheck`) | Once per build at start, and when an admin edits a client's names | AI | Spends AI | Runs | Off: held messages stay held |
| Reminders and notices (`notices`): plan today, check-in, close out, the week nudges, Look ahead, promises due, expiring secrets, the VM's morning prompt, urgent requests, promises waiting on an item, taken over, conversations given or active, Take one, Ahead's notes, sends and looks, client calls to review, the status report nudge | Each person's slow pass (held ones in the fast pass) | The in-app list; reads the person's own VM status and DevOps status for some | Messages a person | Runs | Only for someone who switches on "Send me reminders and Teams messages from this test site" |
| Web Push (`web_push`) | Every notice that passes the gate | Web Push services | Messages a person | Runs | Only with that switch on (the test send and the samples always) |
| Teams bot's rhythm (`teams_rhythm`): brief, check-in, close out, nudges, client calls | Each person's slow pass | Teams (the bot, the person's 1:1 chat) | Messages a person | Runs | Only with that switch on (Send me a test now always) |
| Teams status (`teams_status`) | The fast pass and every timer button | Teams presence (the person's own) | Writes | Runs | Never, not even from a button. The focus screen says "Teams status isn't changed from the test site." |
| VM-2's automatic start (`vm_autostart`) | Each person's slow pass, before work when they turned it on | Azure (the person's own VM) | Writes | Runs | Never (the chip's Start still works) |
| Coop DevOps mailbox (`coop_mailbox`) | Reserved: not built yet | DevOps comments | Writes | When built | Never, so an answer is posted once |
| DevOps store (`devops_poll`) | App job | DevOps (the company read PAT) | Reads shared data | Runs (in followers' hours) | Only while someone is using that deployment, paced and backing off as in prod |
| People refresh (`people_refresh`) | App job, once a day | Dataverse (the app's own access) | Reads shared data | Runs | Runs |
| Standards sync (`standards_sync`) | App job and once at start | Public GitHub, no token | Reads public data | Runs | Runs |
| Calendar refresh (`calendar_refresh`) | Fast pass, every 5 min while a focus timer runs | Outlook, Google (the person's own) | Reads | Runs | Runs (the person started the timer) |
| The focus timer (`focus_timer`) | Fast pass | none | That database only | Runs | Runs; its end shows in the page, no push without the switch. Its meeting warnings are timed reminders: only with the switch |
| Retention purge (`retention_purge`), ownership backfill (`conversation_ownership_backfill`), maintenance (`maintenance`), notice sweep (`notice_sweep`), old chat rows (`chat_text_cleanup`) | App jobs and passes | none | That database only | Runs | Runs |
| Start-up moves (`startup_upkeep`): team settings, Who repair, AP-1 requests to conversations, guest sessions, cancelled VM restores | Once at start | none | That database only | Runs | Runs |

**What differs between dev and prod** after ENV-1: dev never reads chats, calendars for capture or transcripts on its own, never runs AI in the background, never changes anyone's Teams status and never messages anyone unless that person switched it on for themselves. Production is unchanged: `config/background-policy.test.ts` proves its job list and tick parts are what they were. Admin › Status on a test site has a "This is a test site" row listing what runs only on a button, and a second row while a watch period is on. What dev's database already holds stays; the usual retention rules still expire old chat text and transcripts.

**Adding background work:** name it in `BACKGROUND` (`config/background-policy.ts`) with what it touches and what it does outside production, then start it from the scheduler or a tick part under that name. Nothing else reads `FOCUSTIME_ENV` to decide what runs.

## Deploys

- **Dev on merge.** `.github/workflows/deploy-dev.yml` runs on every push to `main`: the CI checks (skipped when the PR's run tested exactly the same tree), the image to dev's registry, `focustime migrate`, the app's database user, the Bicep (what-if, then create), a smoke test.
- **Prod by SHA.** `.github/workflows/deploy-prod.yml`, manual only, by someone in the `PROD_DEPLOYERS` repository variable: `gh workflow run deploy-prod.yml -f ref=<sha>`. It promotes the image dev built and tested for that commit (by digest), checks dev and prod have the same app settings and secret names (`infra/scripts/parity.sh`), migrates, deploys the Bicep and checks that prod serves that commit. `dry_run` changes nothing.
- **Which commit is where.** ⋯ › About in each environment shows its PR and commit; `gh run list --workflow deploy-dev.yml` and `deploy-prod.yml` show the runs.
- **Migrations only add.** A rename or a drop ships in a later release than the code that stops using it (`store/migrations/additive.test.ts`), so the previous build always runs on the current database.

### Rollback

Run deploy-prod again with the previous SHA (the last run's summary prints the command). Only the app changes: the image is the chosen commit's, while migrations and Bicep are always main's (D472). Nothing older than prod's first commit (`a347188`) can be deployed.

An older build is safe on a newer database and newer settings: migrations only add, and since BH-1 unknown settings sections and keys are ignored when read and kept untouched when saved, so a rollback doesn't break or wipe a setting a newer build wrote (Q-BH1-1 in [open questions](../open-questions.md)). Restore the database only when the data itself went wrong (runbook, [Roll back a revision](../azure/runbook.md#roll-back-a-revision)).

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

The bot itself deploys with the Bicep. The Teams app package (the manifest and icons) is built by `scripts/teams-package.ts` and uploaded by hand: testers upload dev's package themselves (a setup policy allowing custom apps), and a Teams admin uploads prod's to the org catalog. A code change to the bot needs no new package; a change to the manifest does. Steps: [docs/setup/teams-bot.md](../setup/teams-bot.md).

## Diagnostics, logs and what is never logged

- **For people:** Settings › Data › Diagnostics (counts only, for their own chats) and Settings › Activity (every outside write).
- **For admins:** Admin › Status (sources, jobs, polling health) and Admin › Audit (every admin change). **Not verified:** each Status line against the code.
- **Logs:** the console (`az containerapp logs show`), Application Insights and Log Analytics (30 days). Queries in the runbook's [Read logs](../azure/runbook.md#read-logs). Each request is one operation with its own trace.
- **Never logged:** tokens, secrets, PATs, Authorization headers, request or response bodies, message or transcript text, prompts and answers, people's ids or email addresses, chat ids, topics or members, and client keys except as a one-way reference. The logger has no field for them (`log/logger.ts`).

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| Someone says an item they made in DevOps isn't in FocusTime | Usually the area scope, a filter, or the item isn't on the week's plan; sometimes another project | Ask them to open Settings › DevOps › Find an item with the client and the number: it says which (DV-2). Refresh checks DevOps now. |
| A deploy fails because a resource provider is `NotRegistered` (seen with `Microsoft.BotService` when TB-1 added the bot) | The deploy identity can only work in its resource group; it can't register a provider for the subscription | Run `infra/scripts/bootstrap.sh --env <env> --member <your upn> --dry-run`, then without `--dry-run`. It registers the providers and changes nothing else. **Not verified:** the exact error text Azure shows |
| FocusTime doesn't show in Teams | Prod: the package isn't uploaded, isn't Allowed in Manage apps, or a permission policy blocks custom apps; it can take a few hours to reach people. Dev: the tester's setup policy hasn't applied yet (hours), or they haven't uploaded the package | Check Teams admin center › Manage apps and the policies ([teams-bot.md](../setup/teams-bot.md)) |
| The bot doesn't answer the first message on dev | Dev wakes from zero in about 30 seconds; Teams gives a bot 10 to 15 | Send it again. Prod always runs |
| A source shows as not live: Outlook, Google or DevOps writes say they aren't connected | That person hasn't connected it, their sign-in expired, or a consent is missing | The source's own message names the fix: Settings › Connections (consents, Reconnect), Settings › Clients (Enable DevOps writes) |
| Every browser shard fails at "Install WebKit's system packages" (or another step before "Browser tests") with `Temporary failure resolving` or `Failed to fetch` | The Ubuntu package servers, npm or the Playwright CDN couldn't be reached; nothing is wrong with the code. Since CI-2 the packages install from the cache with no network on the same runner image, so this is left only on a new image or Playwright version | Re-run the failed jobs once it's back: `gh run rerun <run id> --failed`. A deploy-dev that ran CI itself waits on it: re-run its failed jobs too. Runbook, [When CI's browser jobs fail before testing](../azure/runbook.md#when-cis-browser-jobs-fail-before-testing-ci-2) |
| Dev is slow on the first request | A cold start: dev scales to zero | Wait a few seconds; it stays awake for 300 s after the last request |
| "AI isn't set up" | No `ft-openai-key` in that environment's vault | `infra/scripts/openai-key.sh` (used within a minute, no restart) |
| Push notifications aren't set up | No `ft-vapid-key` | `infra/scripts/vapid-key.sh` |
