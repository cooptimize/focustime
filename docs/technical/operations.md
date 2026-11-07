# Operations

For whoever deploys, watches or fixes FocusTime. The step-by-step commands are in the [runbook](../azure/runbook.md); this page is the map. Checked against `13cd461` on Nov 7, 2026.

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

Both run in the same subscription and share the Entra tenant, the "FocusTime" app registration and the "FocusTime Admins" group. Settings and resource names are in `infra/dev.bicepparam` and `infra/prod.bicepparam`. Scaling: one replica at most in both (`maxReplicas: 1`, `infra/modules/app.bicep`). The daily jobs claim their period in `job_claims`, and the Teams bot dedupes across replicas, but the scheduler's per-person ticks have no lease: its header mentions one, the code has none. Keep one replica until that changes.

Costs and budgets: [runbook, Cost](../azure/runbook.md#cost-hk-2-fixed-price-databases-list-prices-for-central-us-on-2026-11-05) and [Budgets and alerts](../azure/runbook.md#budgets-and-alerts-hk-2).

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
| A deploy fails because a resource provider is `NotRegistered` (seen with `Microsoft.BotService` when TB-1 added the bot) | The deploy identity can only work in its resource group; it can't register a provider for the subscription | Run `infra/scripts/bootstrap.sh --env <env> --member <your upn> --dry-run`, then without `--dry-run`. It registers the providers and changes nothing else. **Not verified:** the exact error text Azure shows |
| FocusTime doesn't show in Teams | Prod: the package isn't uploaded, isn't Allowed in Manage apps, or a permission policy blocks custom apps; it can take a few hours to reach people. Dev: the tester's setup policy hasn't applied yet (hours), or they haven't uploaded the package | Check Teams admin center › Manage apps and the policies ([teams-bot.md](../setup/teams-bot.md)) |
| The bot doesn't answer the first message on dev | Dev wakes from zero in about 30 seconds; Teams gives a bot 10 to 15 | Send it again. Prod always runs |
| A source shows as not live: Outlook, Google or DevOps writes say they aren't connected | That person hasn't connected it, their sign-in expired, or a consent is missing | The source's own message names the fix: Settings › Connections (consents, Reconnect), Settings › Clients (Enable DevOps writes) |
| Dev is slow on the first request | A cold start: dev scales to zero | Wait a few seconds; it stays awake for 300 s after the last request |
| "AI isn't set up" | No `ft-openai-key` in that environment's vault | `infra/scripts/openai-key.sh` (used within a minute, no restart) |
| Push notifications aren't set up | No `ft-vapid-key` | `infra/scripts/vapid-key.sh` |
