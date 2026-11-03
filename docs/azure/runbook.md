# FocusTime on Azure: runbook

Dev lives in the resource group **FocusTime-dev** (subscription "Production Services and Apps",
`65be698f-0695-48f4-b322-1aa1c387d5e2`, Central US). Prod (A5) will be **FocusTime**. Names are `ft-<env>-<resource>`;
the globally unique ones carry a suffix from the resource group id:

| What | Dev name |
|---|---|
| Container App / environment | `ft-dev-app` / `ft-dev-cae` |
| Container registry | `ftdevacr5bthbn` |
| Key Vault | `ft-dev-kv-5bthbn` (key `ft-data-key`; secrets `ft-entra-client-secret`, `ft-google-client-secret`, `ft-dataverse-client-secret`) |
| SQL server / database | `ft-dev-sql-5bthbn` / `focustime` |
| Log Analytics / App Insights | `ft-dev-log` / `ft-dev-appi` |
| Deploy identity | `ft-dev-deploy` (federated: `repo:cooptimize/focustime:ref:refs/heads/main`) |
| SQL admin group | "FocusTime DB Admins" |

Rules: every cloud change goes through the Bicep (`infra/`) and the deploy workflow, or one of the scripts in
`infra/scripts/`. Nobody runs SQL against the hosted database by hand except to read; nobody prints a secret.

## Deploy

Push to `main` (from A5 on: merge a pull request). `.github/workflows/deploy-dev.yml` then:

1. runs the CI checks (`ci.yml`: typecheck, tests on SQLite and SQL Server, browser tests, Bicep build, image smoke);
2. builds the image and pushes `ftdevacr5bthbn.azurecr.io/focustime:<commit sha>`;
3. adds a firewall rule for the runner's address (removed at the end of the job, whatever happens);
4. runs `focustime migrate` and `scripts/db-user.ts` with the deploy identity's token (a DB admin);
5. prints the Bicep what-if, then deploys `infra/main.bicep` with `infra/dev.bicepparam` and the new image tag;
6. smoke tests `/healthz`, the page title, the Microsoft sign-in redirect and the security headers.

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
`infra/scripts/copy-secrets.sh --vault <vault>`, then the workflow.

## Roll back a revision

Single revision mode: the previous image is redeployed, not reactivated.

```sh
az acr repository show-tags -n ftdevacr5bthbn --repository focustime --orderby time_desc -o tsv | head
az containerapp update -g FocusTime-dev -n ft-dev-app --image ftdevacr5bthbn.azurecr.io/focustime:<earlier sha>
```

Or re-run the deploy workflow for the earlier commit (Actions, the run, "Re-run all jobs"). A rollback across a
schema change: the older build refuses a newer database ("newer than this build"); restore the database to a point
before the migration instead (below), then roll back the image.

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

```sh
az group delete -n FocusTime-dev            # everything in it, including the deploy identity
az keyvault purge -n ft-dev-kv-5bthbn        # fails while purge protection holds it (90 days); the name is then reserved
```

Then remove the federated deploy identity's leftovers: none outside the group (its role assignments go with the group).
The "FocusTime" app registration and the "FocusTime DB Admins" group stay (prod uses both); remove the dev redirect URI
by running `app-registration.sh` with only the URLs still in use. Delete the GitHub variables `AZURE_DEV_*` if dev is
gone for good.
