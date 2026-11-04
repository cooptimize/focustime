# FocusTime on Azure: runbook

Two environments in the subscription "Production Services and Apps" (`65be698f-0695-48f4-b322-1aa1c387d5e2`), both in
Central US: dev in the resource group **FocusTime-dev**, prod (A5) in **FocusTime** (the group itself was made earlier
in East US and is empty but for FocusTime; every resource in it is in Central US). Names are `ft-<env>-<resource>`;
the globally unique ones carry a suffix from the resource group id:

| What | Dev | Prod |
|---|---|---|
| URL | `https://ft-dev-app.ashysand-30e17134.centralus.azurecontainerapps.io` | `https://ft-prod-app.grayforest-92f64bef.centralus.azurecontainerapps.io` |
| Container App / environment | `ft-dev-app` / `ft-dev-cae` (0 to 1 replica) | `ft-prod-app` / `ft-prod-cae` (1 replica, D467) |
| Container registry | `ftdevacr5bthbn` | the same one (D471): pulled by `ft-prod-pull`, AcrPull only |
| Key Vault | `ft-dev-kv-5bthbn` | `ft-prod-kv-kkzllj` (its own `ft-data-key`, never dev's) |
| Secrets in the vault | `ft-entra-client-secret`, `ft-google-client-secret`, `ft-dataverse-client-secret` | the same names, prod's own copies |
| SQL server / database | `ft-dev-sql-5bthbn` / `focustime` (serverless 0.5 to 1 vCore, 7 days PITR) | `ft-prod-sql-kkzllj` / `focustime` (serverless 0.5 to 2 vCores, auto-pause 60 min, 14 days PITR) |
| Log Analytics / App Insights | `ft-dev-log` / `ft-dev-appi` | `ft-prod-log` / `ft-prod-appi` |
| Deploy identity | `ft-dev-deploy` | `ft-prod-deploy` (also AcrPull on dev's registry, to read digests) |
| How it deploys | every merge to main (`deploy-dev.yml`) | by hand, by SHA (`deploy-prod.yml`, PROD_DEPLOYERS) |
| SQL admin group | "FocusTime DB Admins" | the same |

Both use the "FocusTime" Entra registration (`0040169f-a4c9-46d9-bd81-83c31d0d6ff0`, each environment with its own
client secret) and the "FocusTime Web" Google client (both redirect URIs on it).

Rules: every cloud change goes through the Bicep (`infra/`) and the deploy workflow, or one of the scripts in
`infra/scripts/`. Nobody runs SQL against the hosted database by hand except to read; nobody prints a secret.

## Deploy

Push to `main` (from A5 on: merge a pull request). `.github/workflows/deploy-dev.yml` then:

1. checks whether the pull request's own ci run already tested this exact tree (below); if it did, runs only the
   typecheck, otherwise the full CI checks (`ci.yml`: typecheck, tests on SQLite and SQL Server, browser tests, Bicep
   build, image smoke);
2. builds the image and pushes `ftdevacr5bthbn.azurecr.io/focustime:<commit sha>`;
3. adds a firewall rule for the runner's address (removed at the end of the job, whatever happens);
4. runs `focustime migrate` and `scripts/db-user.ts` with the deploy identity's token (a DB admin);
5. prints the Bicep what-if, then deploys `infra/main.bicep` with `infra/dev.bicepparam` and the new image tag;
6. smoke tests `/healthz`, `/version` (it must name this commit), the page title, the Microsoft sign-in redirect and
   the security headers.

Watch it: `gh run watch --repo cooptimize/focustime`, or the Actions tab. A re-run of the same commit is safe (every step
is idempotent).

By hand (rare: the deploy identity is the normal path), as a member of FocusTime DB Admins with Owner or Contributor and
User Access Administrator on the group:

```sh
cd infra
FT_IMAGE_TAG=<sha> az deployment group what-if -g FocusTime-dev -n ft-dev --parameters dev.bicepparam
FT_IMAGE_TAG=<sha> az deployment group create  -g FocusTime-dev -n ft-dev --parameters dev.bicepparam
```

A brand new environment: `infra/scripts/bootstrap.sh --env dev --member <upn> ...`, then a first deploy with
`FT_APP_READY=false` (a placeholder image, so the app's identity exists and gets its roles), then
`infra/scripts/app-registration.sh --dev-url https://<fqdn> --vault <vault>` and
`infra/scripts/copy-secrets.sh --vault <vault>`, then the repository variable for the app's identity
(`gh variable set AZURE_DEV_APP_IDENTITY_CLIENT_ID --body $(az ad sp show --id $(az containerapp show -g FocusTime-dev -n ft-dev-app --query identity.principalId -o tsv) --query appId -o tsv)`;
`scripts/db-user.ts` makes the database user from it), then the workflow. If the app is ever deleted and recreated, its
identity changes: set the variable again.

### The tree check (S1, D456)

`ci.yml`'s test job (the gate after the unit and browser jobs, D487) saves `git rev-parse HEAD^{tree}` as the artifact `tested-tree`. On a pull request, HEAD is
GitHub's merge of the PR into main at that moment. `scripts/ci-tree-match.sh <owner/repo> <sha>` (deploy-dev's `reuse`
job) finds the merged PR for the commit on main, the newest passing `pull_request` run of ci on the PR's last commit,
downloads its `tested-tree` and compares it with the tree of the commit on main. Equal trees mean the same files were
tested, so the full suite is skipped (the typecheck and the post-deploy smoke test still run). Anything missing or
different answers no and the full suite runs: a direct push, no passing run, an expired artifact (90 days), or main
having moved between the PR's last ci run and the merge. It prints its reason in the job log
(`reuse: tested=true pr=12 (run 123 tested tree abc…)`). Run it by hand with `gh` signed in:
`scripts/ci-tree-match.sh cooptimize/focustime <sha>`.

## What's deployed where (S1, D452)

The image carries its build info, baked at build time (`scripts/build-info.ts` into Docker build args): the short
commit, the PR number from the merge message, and the build time in UTC. The environment comes from runtime config
(`FOCUSTIME_ENV`, set by Bicep). Nothing else: no secrets, host names or user data.

- Dev or prod: open `https://<host>/version` (public, like `/healthz`): `{"env":"dev","pr":"7","sha":"8f6d963","builtAt":"2026-11-03T19:14:00Z"}`.
  Or in the app, ⋯ › About: "FocusTime · dev · #7 · 8f6d963 · built Nov 3, 2:14 PM", with links to the PR and commit.
  From a shell: `curl -s https://<host>/version`; or `az containerapp show -g FocusTime-dev -n ft-dev-app --query
  properties.template.containers[0].image -o tsv` (the image tag is the full commit).
- Locally: ⋯ › About reads "FocusTime · local · <sha>" (the commit the service was started from, `git rev-parse`), and
  `curl -s http://127.0.0.1:<port>/version` says the same.
- deploy-dev fails if `/version` on dev doesn't name the commit it just built (an old revision still serving).

## Reset first-run setup on dev (S1, D451)

Settings > Setup > Start over clears your own setup state, so the four screens show again on the next load. It is
refused on prod (403) and hidden there.

## Web Push: the VAPID key per environment (P1)

Push needs one VAPID key per environment, the Key Vault secret `ft-vapid-key` (a P-256 JWK). The app reads it at run time with its own identity, so it is not in the Bicep and an environment without it still deploys: Settings › Notifications then says "Push isn't set up for this app yet" and in-app notifications work as usual.

```
az login
infra/scripts/vapid-key.sh --vault ft-dev-kv-5bthbn          # dev
infra/scripts/vapid-key.sh --vault ft-prod-kv-kkzllj         # prod
```

The key goes from node through a pipe into Key Vault; it is never printed, written to a file or passed as an argument. An existing key is left alone. `--force` replaces it, which ends push on every device (each subscribed with the old public key): people tap Notify this device again. The app picks a new key up within 5 minutes, no restart needed.

### Test push on dev

1. Make the key once (above), then open dev on the phone: Android in Chrome, or iPhone in Safari, then Share › Add to Home Screen and open FocusTime from the home screen (iOS 16.4 or later).
2. Settings › Notifications › Notify this device, and allow notifications. The device shows in the list as "iPhone · Safari" or "Android · Chrome".
3. Send a test notification (same page). It shows in ⋯ › Notifications and, with the app closed or in the background, as a notification on the phone saying "FocusTime · Notifications reach this device". Tapping it opens Settings › Notifications.
4. Logs (Application Insights or the replica's console) have `server push_sent kind=test count=1`; `push_gone` means the push service dropped the subscription (the device was removed), `push_failed` that it refused (look at the time on the phone and the key). Never an endpoint or a key in the logs.
5. Show details in notifications is off by default: the lock screen says only what kind of notice it is.

## Check a VM's auto-shutdown is on (D475)

FocusTime only reads a VM's auto-shutdown; it never changes it. To check one (yours, or one someone asks about):

- Portal: the VM > Operations > Auto-shutdown. "Enabled" should be On, with the time and time zone the owner wants.
  Notification before auto-shutdown can stay as it is.
- Shell (read only):

```sh
az rest --method get --url "https://management.azure.com/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.DevTestLab/schedules/shutdown-computevm-<vm>?api-version=2018-09-15" \
  --query "{status:properties.status,time:properties.dailyRecurrence.time,tz:properties.timeZoneId,notify:properties.notificationSettings.status}"
```

  `status` should be `Enabled`. A 404 means the VM has no auto-shutdown at all.
- Who changed it, and with which app (90 days):

```sh
az monitor activity-log list --subscription <sub> --offset 90d --namespace Microsoft.DevTestLab \
  --query "[?operationName.value=='Microsoft.DevTestLab/schedules/write' && status.value=='Succeeded'].{at:eventTimestamp,who:caller,app:claims.appid,schedule:resourceId}" -o table
```

  The app id says where a change came from: `c44b4083-3bb0-49c1-b47d-974e53cbdf3c` is the Azure portal, and
  `15021957-09f5-41de-b9b2-ab28f42d6d0c` (Coopilot Desktop) is the local FocusTime before D475. The hosted FocusTime
  (`0040169f-a4c9-46d9-bd81-83c31d0d6ff0`) never wrote a schedule.
- To turn it back on, use the portal page above. Don't use FocusTime; it can't write a schedule.

## Roll back a revision

Single revision mode: the previous image is redeployed, not reactivated.

```sh
az acr repository show-tags -n ftdevacr5bthbn --repository focustime --orderby time_desc -o tsv | head
az containerapp update -g FocusTime-dev -n ft-dev-app --image ftdevacr5bthbn.azurecr.io/focustime:<earlier sha>
```

Or re-run the deploy workflow for the earlier commit (Actions, the run, "Re-run all jobs"). A rollback across a
schema change is safe: migrations only add (D468), and an older build runs on a newer database (it logs
`newer_schema`). Restore the database only when the data itself went wrong.

Restore the database (7 days of point-in-time restore) to a new database, then swap names:

```sh
az sql db restore -g FocusTime-dev -s ft-dev-sql-5bthbn -n focustime --dest-name focustime-restored --time <UTC ISO time>
```

## Rotate the Entra client secret

```sh
infra/scripts/app-registration.sh --dev-url https://<dev fqdn> --vault ft-dev-kv-5bthbn --rotate-secret
az containerapp revision restart -g FocusTime-dev -n ft-dev-app --revision $(az containerapp revision list -g FocusTime-dev -n ft-dev-app --query "[?properties.active].name | [0]" -o tsv)
```

The new secret goes straight to Key Vault; the old one stays valid until it expires, so remove it once the app runs on
the new one: `az ad app credential list --id 0040169f-a4c9-46d9-bd81-83c31d0d6ff0 --query "[].{name:displayName,id:keyId,ends:endDateTime}"`,
then `az ad app credential delete --id 0040169f-a4c9-46d9-bd81-83c31d0d6ff0 --key-id <old keyId>`.
The Google and Dataverse secrets: put the new value in the keyring, then `infra/scripts/copy-secrets.sh --vault ft-dev-kv-5bthbn --force`
and restart the revision.

## Resume a paused database

Serverless pauses after 60 idle minutes; the first connection resumes it (about a minute; the page shows "Waking up the
database" and the app retries). Nothing to do. To resume ahead of a demo, any query does it, or open the app.
Check the state: `az sql db show -g FocusTime-dev -s ft-dev-sql-5bthbn -n focustime --query status -o tsv` (`Online`,
`Paused`, `Resuming`).

## Read logs

The app logs only its closed field set (source, op, kind, count, status, ms; never bodies, tokens or ids of people).

```sh
az containerapp logs show -g FocusTime-dev -n ft-dev-app --follow            # the console, live
az containerapp revision list -g FocusTime-dev -n ft-dev-app -o table       # revisions and their health
```

App Insights (`ft-dev-appi`, Logs) or Log Analytics (`ft-dev-log`):

```kusto
AppRequests | where TimeGenerated > ago(1h) | summarize count() by Name, ResultCode
AppTraces | where TimeGenerated > ago(1h) | project TimeGenerated, Message, Properties
ContainerAppConsoleLogs_CL | where TimeGenerated > ago(1h) | project TimeGenerated, Log_s
```

## Delete dev

Prod pulls its image from dev's registry (D471). Before deleting dev, give prod a registry of its own (drop
`sharedRegistry` and `pullIdentityName` from `prod.bicepparam` and build in deploy-prod), or prod can no longer start a
new revision.

```sh
az group delete -n FocusTime-dev            # everything in it, including the deploy identity
az keyvault purge -n ft-dev-kv-5bthbn        # fails while purge protection holds it (90 days); the name is then reserved
```

Then remove the federated deploy identity's leftovers: none outside the group (its role assignments go with the group).
The "FocusTime" app registration and the "FocusTime DB Admins" group stay (prod uses both); remove the dev redirect URI
by running `app-registration.sh` with only the URLs still in use. Delete the GitHub variables `AZURE_DEV_*` if dev is
gone for good.

## Send feedback (F1, D509 to D513)

⋯ › Send feedback creates a User Story under Feature #496 in the cooptimize organization, project Cooptimize Internal,
as the app's own managed identity. Until an identity is added below, that environment's dialog says "Feedback isn't set
up yet" and Settings > Connections says why.

### Add the app identities to Azure DevOps (once per environment)

Needs a Project Collection Administrator of the cooptimize organization. No invitation email is sent.

| Environment | Display name to search for | Object ID (Enterprise app) |
|---|---|---|
| dev | `ft-dev-app` | `66524ed9-5595-49de-8dfa-b533373d7d06` |
| prod | `ft-prod-app` | `b3e17d23-b891-4a99-82c0-59206050e095` |

For each:
1. https://dev.azure.com/cooptimize > Organization settings > Users > Add users.
2. In Users or Service Principals, type the display name (or paste the Object ID) and pick it.
3. Access level: **Basic**. Stakeholder can create stories but can't set their iteration, so the create would fail.
   Basic uses one license.
4. Add to projects: **Cooptimize Internal**, group **Contributors**. Untick "Send email invites".
5. Add.

Then check: Settings > Connections > Send feedback, Check again. It should say "Set up: stories go under Feature #496".
If an identity is ever removed, the dialog falls back to "isn't set up" with Copy text; nothing else breaks.

### Feedback settings

Set by the Bicep only (main.bicep defaults, `infra/prod.bicepparam`, `infra/dev.bicepparam`), never by hand:
`FOCUSTIME_FEEDBACK_ORG` `cooptimize`, `FOCUSTIME_FEEDBACK_PROJECT` `Cooptimize Internal`,
`FOCUSTIME_FEEDBACK_PARENT_ID` `496`, `FOCUSTIME_FEEDBACK_LIVE` `true` on prod and `false` on dev.
To move feedback to another feature, change `feedbackParentId` in main.bicep and deploy.

### Switch dev live for one test

1. GitHub > Actions > deploy-dev > Run workflow on main, tick **feedback_live**, Run.
2. When it's deployed, send one from dev. Its title starts "[dev]". Check it under #496 in DevOps, then close or
   delete it there.
3. Switch back: run deploy-dev again without the box ticked (any push to main does the same).

## Prod (A5)

### Deploy by SHA

Prod runs only a commit dev already built, tested and deployed: the same image, by digest (D466).

1. Find the commit: dev's ⋯ › About ("FocusTime · dev · #12 · 3f96061"), or `curl -s <dev url>/version`.
2. Run the workflow from main: Actions › deploy-prod › Run workflow, `ref` = that SHA, or
   `gh workflow run deploy-prod.yml --repo cooptimize/focustime -f ref=<sha>`, then `gh run watch`.
3. It refuses anyone not in the repository variable PROD_DEPLOYERS (comma separated GitHub logins), a commit not on
   main, or a commit dev has no image for. Then it migrates, makes the app's database user, prints the Bicep what-if,
   deploys, and checks that `/version` says `prod <sha>`. The run's summary names the image and what ran before.
4. Check: `curl -s https://ft-prod-app.grayforest-92f64bef.centralus.azurecontainerapps.io/version`, or ⋯ › About in prod.

A dry run (`-f dry_run=true`) checks only who is running it and that the image exists; nothing changes. Add or remove a
deployer: `gh variable set PROD_DEPLOYERS --repo cooptimize/focustime --body "login1,login2"` (or `bootstrap.sh --env
prod --deployer <login> ...`, which sets the whole list).

### Roll back and roll forward

Roll back: run deploy-prod with the previous SHA. The last run's summary prints it as a ready command:

```sh
gh workflow run deploy-prod.yml --repo cooptimize/focustime -f ref=<previous sha>
```

Roll forward: the same with the newer SHA. Only the app changes: the image is the chosen commit's, while the
migrations and the Bicep are always main's (D472). Nothing older than prod's first commit, `a347188`, can be deployed. Single revision mode: each deploy makes a new revision and the old ones stay
listed, inactive (`az containerapp revision list -g FocusTime -n ft-prod-app -o table`). Migrations only add (D468), so
the older build runs on the database as it is; no restore is needed for a rollback.

### Prod's app-level settings

Set by `infra/prod.bicepparam` and `infra/modules/app.bicep` (env vars on the Container App), never by hand and never
per person. Settings shows the ones a person sees as "Set by your FocusTime admin".

| Setting | Prod value | Where |
|---|---|---|
| `FOCUSTIME_ENV` | `prod` (About, `/version`; Setup's Start over is refused) | `param env` |
| `FOCUSTIME_HOST` | `azure` | app.bicep |
| `FOCUSTIME_PUBLIC_URL` | the Container App's own hostname | app.bicep |
| `FOCUSTIME_INVITE_DOMAINS` | `cooptimize.org` (D464; dev: empty, each person's work email) | `param inviteDomains` |
| `FOCUSTIME_ENTRA_TENANT_ID` / `_CLIENT_ID` | the tenant / `0040169f-a4c9-46d9-bd81-83c31d0d6ff0` | `param entraClientId` |
| `FOCUSTIME_GOOGLE_CLIENT_ID` | the "FocusTime Web" client | `param googleClientId` |
| `FOCUSTIME_DATAVERSE_URL` / `_TENANT_ID` / `_CLIENT_ID` | `https://cooptimize.crm.dynamics.com` and its ids | `param dataverse*` |
| `FOCUSTIME_DB_*` | `sqlserver`, `ft-prod-sql-kkzllj.database.windows.net`, `focustime`, auth `entra` | app.bicep |
| `FOCUSTIME_KEYVAULT_URL` / `FOCUSTIME_DATA_KEY_NAME` | `ft-prod-kv-kkzllj` / `ft-data-key` | app.bicep |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | `ft-prod-appi`'s | app.bicep |
| Secrets (Key Vault references) | `FOCUSTIME_SECRET_ENTRA_CLIENT`, `_GOOGLE_CLIENT`, `_DATAVERSE_CLIENT` | app.bicep |
| `FOCUSTIME_FEEDBACK_ORG` / `_PROJECT` / `_PARENT_ID` | `cooptimize` / `Cooptimize Internal` / `496` (dev the same) | `param feedback*` (main.bicep defaults) |
| `FOCUSTIME_FEEDBACK_LIVE` | `true` (dev: `false` unless deploy-dev runs with feedback_live) | `param feedbackLive` |

### The first deploy of prod (done in A5, for the record)

1. `infra/scripts/bootstrap.sh --env prod --member <upn> --deployer <github login>`: ft-prod-deploy, ft-prod-pull,
   AcrPull on dev's registry for both, the GitHub variables `AZURE_PROD_CLIENT_ID`, `AZURE_PROD_RESOURCE_GROUP`,
   `AZURE_PROD_REGISTRY`, `PROD_DEPLOYERS`.
2. `FT_APP_READY=false az deployment group what-if`, then `create`, `-g FocusTime -n ft-prod --parameters
   infra/prod.bicepparam`: everything with a placeholder image, so the app's identity exists and gets its vault roles.
3. `gh variable set AZURE_PROD_APP_IDENTITY_CLIENT_ID --body $(az ad sp show --id $(az containerapp show -g FocusTime -n ft-prod-app --query identity.principalId -o tsv) --query appId -o tsv)`.
4. `infra/scripts/app-registration.sh --dev-url <dev url> --prod-url <prod url> --vault ft-prod-kv-kkzllj` (both
   redirect URIs, prod's own Entra secret) and `infra/scripts/copy-secrets.sh --vault ft-prod-kv-kkzllj`.
5. The prod Google redirect URI `<prod url>/auth/google/callback` on the "FocusTime Web" client (by hand in the Google
   console: there is no API for it).
6. deploy-prod with the SHA to promote.

### Dev and prod parity (D473)

Every prod deploy (a dry run too) first runs `infra/scripts/parity.sh`: it fails if dev has an app setting, app
secret reference or Key Vault secret name that prod lacks, now or after the deploy. Fix a missing secret with
`infra/scripts/copy-secrets.sh --vault ft-prod-kv-kkzllj`, a missing setting through `infra/`, or allow a name that is
meant to be dev-only in `infra/parity-allow.txt` with a reason. Run it by hand any time: `infra/scripts/parity.sh`. If it
says it can't read a name, ft-prod-deploy is missing its read roles: run `bootstrap.sh --env prod` again (step 7).

### First run for a new person

Nothing to set up for them in Azure: anyone in the Cooptimize tenant can sign in.

1. Send them the prod URL. They sign in with their Cooptimize account (one consent for Outlook, Teams presence and
   Azure).
2. Setup (S1) opens: Your day, Your clients, Standing blocks, Calendars; about two minutes. Each client's DevOps writes
   need a personal PAT (Work Items, read and write) from `https://dev.azure.com/<org>/_usersSettings/tokens`, entered
   in Setup or later in Settings; without one the client stays read-only.
3. They should open ⋯ › Guide first.
4. What to check (and all an admin reports back, never plan content): matched in Dataverse yes or no, the number of
   followed clients, which sources are live, which setup steps were done or skipped. Settings › Data and the
   attention line show the same to them.

### Retire the local daily app (D469)

Prod replaces the local service for daily use. Kept installed for a few weeks:

```sh
systemctl --user disable --now focustime     # the service and its autostart; files and data stay
```

The launcher, Super+Alt+C and Super+Alt+N open prod in an app-style browser window instead (`~/.config/hypr/`). The
SQL Server container and the developer loop stay. Turning it back on: `system/README.md`.

### Delete the old "Coopilot Desktop" registration

Kept as a fallback until **2026-11-10**, then deleted (nothing in FocusTime uses it after A5; the local app is retired):

```sh
az ad app list --display-name "Coopilot Desktop" --query "[].{name:displayName,appId:appId}" -o table
az ad app delete --id <that appId>
```

### Cost (estimate, list prices for Central US on 2026-11-03)

| | Prod per month | Dev per month |
|---|---|---|
| SQL compute (serverless, $0.626 per vCore hour; awake about 300 h for working hours and the scheduler's wakes, mostly at the 0.5 vCore floor) | $95 to $140 | $15 to $30 (fewer hours) |
| SQL storage (32 GB max, $0.138 per GB) and backups (within the free allowance) | $4.50 | $4.50 |
| Container App (0.5 vCPU, 1 GiB; prod always on, mostly idle at $0.000003 per vCPU and GiB second; the free grant is shared) | $15 to $20 | $0 to $3 |
| Container registry (Basic, shared) | | $5 |
| Log Analytics and App Insights (first 5 GB a month free) | $0 to $3 | $0 to $2 |
| Key Vault | under $1 | under $1 |
| **Total** | **about $115 to $165** | **about $25 to $45** |

SQL compute is most of it; what keeps it down is the idle rule (D431) letting the database pause outside people's
working hours. The actual cost after the first week goes here (Cost Management, resource group FocusTime, or
`az consumption usage list --start-date <d> --end-date <d>`): _not measured yet_.

## Asks (AP-1)

### Graph permissions and consent

Asks uses two delegated Microsoft Graph permissions, both ones a person can allow for themselves (no admin consent):

| Permission | What for | How it's granted |
|---|---|---|
| Chat.ReadBasic | The chat picker and members (names, tenants) | On the app registration (`infra/scripts/app-registration.sh`, GRAPH_SCOPES; granted tenant-wide on Nov 4), so the sign-in asks for it |
| Chat.Read | Reading new messages in a chat switched on for asks | **Not** on the registration (D490). Each person allows it the first time they switch Read for asks on: FocusTime sends them to Microsoft (`/auth/microsoft/login?consent=chat_read`) and back to Settings › Clients |

Nothing to run for Chat.Read. Don't add it to GRAPH_SCOPES: everyone would then be asked for it at sign-in. If a tenant admin turns off user consent, an admin can grant Chat.Read for the FocusTime registration in Entra (Enterprise applications › FocusTime › Permissions › Grant admin consent); FocusTime's code doesn't change. ChatMember.Read and any app-only (application) Teams permission are never needed and must not be added. Settings › Connections shows each person's state: Chat.Read reads "Missing" until they allow it.

### Switching Asks on for a client

Each person, for themselves (no admin step):

1. Settings › Clients › the client › Delivery chats › Add a chat (if it isn't there yet).
2. Switch **Read for asks** on for that chat. The first time, Microsoft asks to allow FocusTime to read chat messages; accept, and FocusTime comes back and switches it on. Reading starts from that moment (no history).
3. Optional: Settings › Clients › Asks sets how often (default every 5 minutes, only in working hours, not on PTO days) and the phrase lists.
4. Asks show in Inbox › Asks. Create bug, story or feature needs that client's DevOps write access (Settings › Clients › DevOps write access).

Off is the same switch; it stops the reads at once and keeps what was stored (see below to delete it).

### Purging a client's stored chat text

- **One person, one client:** Settings › Clients › the client › Delivery chats › **Delete stored messages** (asks the person to confirm). Deletes every stored message and ask for that client in their plan; DevOps items made from asks stay in DevOps. Removing a chat deletes that chat's messages and asks too.
- **Automatically:** messages that didn't become asks are deleted 14 days after they were written, once a day, by the scheduler (D492). Asks keep their text with their resolution.
- **Everything a person has:** Settings › Data › Delete my data (all their rows, chat text included).
- **Across people** (a client asks for its text to be removed): each person does it from their own Settings, as above; there is no admin purge yet, and the hosted database is never edited by hand (no SQL against Azure SQL outside `focustime migrate`). Ask for an admin purge as a new step if this is needed.

Nothing to clean elsewhere: chat text is never in logs or Application Insights (counts and kinds only), and never in exports to other systems.

## AI (AI-0)

FocusTime calls OpenAI's API for AI tasks, behind `ai/` (docs/architecture.md, D495 to D499). Nothing uses AI until a person turns on Use AI in Settings › AI, and a client task also needs Allow AI on that client (both off by default).

### Create the OpenAI project and key (once per environment)

The API is billed separately from ChatGPT Business. In the Cooptimize OpenAI organization (platform.openai.com):

1. **Projects › Create project**: `FocusTime dev`, and separately `FocusTime prod`. One key per environment, never shared.
2. In each project, **Limits › Spend**: a monthly spend limit a little above the app cap (default 100 USD), with **Enforce a hard limit** on. Requests over it fail with `project_spend_limit_exceeded`, which FocusTime shows as "The AI service's account is out of credit or over its limit" and never retries.
3. **Data controls**: API data isn't used for training by default; leave it so. FocusTime sends `store: false` so OpenAI keeps no application state; abuse monitoring logs are kept up to 30 days (developers.openai.com/api/docs/guides/your-data). Zero data retention, if wanted later, is an organization agreement with OpenAI and needs no code change.
4. **API keys › Create new secret key** in that project (a service account key is best for an app). Copy it once; it's shown only then.

### Put the key in Key Vault

The app reads `ft-openai-key` at run time with its own identity, so it isn't in the Bicep and an environment without it still deploys: Settings › AI then says "AI isn't set up for this FocusTime yet" and everything else works.

```
az login
infra/scripts/openai-key.sh --vault ft-dev-kv-5bthbn       # dev: paste the dev project's key
infra/scripts/openai-key.sh --vault ft-prod-kv-kkzllj      # prod: paste the prod project's key
```

The script asks for the key without showing it and pipes it into Key Vault: never printed, never in a file, an argument, the shell history or a log. An existing key is left alone; `--force` replaces it (rotation: make a new key, `--force`, then revoke the old one in OpenAI). The app picks a new key up within a minute, no restart.

Put prod's key in before the next prod deploy after dev has one: the parity check (D473) fails when dev's vault has `ft-openai-key` and prod's doesn't.

Then check: sign in, Settings › AI, turn on Use AI, press **Test AI**. "OK · 1.2 s · $0.0001" means the key, the model and the network work; the request shows in Last 20 requests.

In the developer loop the stub answers (no network, no cost). To try the real API locally: `infra/scripts/openai-key.sh --local`, then `[ai] provider = "openai"` in `~/.config/focustime/app.toml`, and restart.

### Change the model, limits or caps

App settings, the same for everyone; the defaults are in `server/appconfig.ts` (`DEFAULT_AI`): model `gpt-6-luna`, reasoning effort low, timeout 30 s, max output tokens 4000 (Test AI 1000), prices 0.10 / 0.01 cached / 0.50 USD per million tokens, app cap 100 USD a month. To change one for an environment, add its `FOCUSTIME_AI_*` setting to the container app in `infra/modules/app.bicep` in a pull request and deploy (never `az containerapp update` by hand):

| Setting | Example |
|---|---|
| `FOCUSTIME_AI_MODEL` | `gpt-5-mini` |
| `FOCUSTIME_AI_REASONING_EFFORT` | `minimal`, `low`, `medium`, or empty for the model's default |
| `FOCUSTIME_AI_TIMEOUT_MS` | `45000` |
| `FOCUSTIME_AI_MAX_OUTPUT_TOKENS` | `default=4000,test_ai=1000` |
| `FOCUSTIME_AI_INPUT_USD_PER_MILLION`, `..._CACHED_INPUT_...`, `..._OUTPUT_...` | from the pricing page for the model |
| `FOCUSTIME_AI_APP_CAP_USD` | `100` |
| `FOCUSTIME_AI_PROVIDER` | `off` turns AI off for everyone (Settings › AI says it isn't set up) |

Change the prices whenever the model changes: they are only used to estimate cost and enforce the caps. Each person's own cap is theirs to set in Settings › AI (0 to 1000 USD, default 10).

### What "AI isn't set up" means

FocusTime has no usable key for this environment: `ft-openai-key` is missing from the vault, the app can't read the vault, or `FOCUSTIME_AI_PROVIDER` is `off`. Nothing is sent and every other part of FocusTime works. Fix: put the key in (above), wait a minute, press Test AI. Other messages:

- "AI budget reached for this month": the person's or the app's cap; it starts again on the 1st (UTC).
- "The AI service's account is out of credit or over its limit": OpenAI's billing or the project's hard limit.
- "The AI service is busy": rate limited after one retry.
- "Not sent: ...": FocusTime's own guard refused it (another client, a secret, an outside email address); nothing left FocusTime.

## AI sorting of asks, and Promises (AP-2)

### What it costs (estimate, gpt-6-luna list prices on 2026-11-04)

Only ask candidates (messages the AP-1 rules picked out) and the person's own messages with a promise phrase are sent; every other message costs nothing. One request is about 3,000 to 4,000 input tokens (instructions, the schema, up to 50 open items and 5 earlier messages) and 300 to 500 output tokens.

| A day, per person and chat | Requests | Cost |
|---|---|---|
| 50 external messages, 10 of them ask candidates | 10 `asks.classify` | about 0.0065 USD |
| 3 of my own messages with a promise phrase | 3 `promises.extract` | about 0.002 USD |
| Together | 13 | under 0.01 USD a day, about 0.20 USD a month |

That is about 2% of the 10 USD monthly default per person. A provider that fails costs one request per ask: nothing retries on its own (Sort again is by hand). Settings › AI shows the real month to date; Application Insights has the counts by task (`asks.classify`, `promises.extract`), never text.

### Turning sorting off

- For one client: Settings › Clients, that client's Allow AI off. New asks show "Not sorted: AI isn't allowed for <client>"; already sorted ones keep their labels. Promises fall back to the rule alone (first line, no date).
- For one person: Settings › AI, Use AI off. Same as above for every client.
- For everyone: remove `ft-openai-key` from the vault or set `FOCUSTIME_AI_PROVIDER=off`; Asks and Promises keep working on the rules alone.
- Urgent asks notify only through Settings › Notifications "Urgent asks"; "Let urgent asks through" (off by default) lets them break into focus.

