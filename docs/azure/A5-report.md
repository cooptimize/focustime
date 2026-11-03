# A5 report: production, a clean start, and the pilot

Prod is FocusTime's daily app: the resource group **FocusTime** (subscription "Production Services and Apps", Central
US), the same Bicep as dev with `infra/prod.bicepparam`, an empty database, its own vault and data key, deployed by hand
by SHA with the exact image dev tested. Branch `feat/prod`; decisions D463 to D470.

URL: `https://ft-prod-app.grayforest-92f64bef.centralus.azurecontainerapps.io` (the built-in Container Apps hostname).

## Delivered

- **Prod environment** (what-if shown and approved, then created): ft-prod-log and ft-prod-appi, ft-prod-cae and
  ft-prod-app (min 1, max 1 replica), ft-prod-sql-kkzllj (Entra-only, admin "FocusTime DB Admins", TLS 1.2, only the
  "Azure services" rule) with an empty `focustime` database (serverless 0.5 to 2 vCores, auto-pause 60 minutes, 14
  days PITR), ft-prod-kv-kkzllj (RBAC, purge protection) with its own `ft-data-key`, the app's Secrets User and Crypto
  User roles. The resource group already existed, empty, in East US; every resource in it is in Central US.
- **Identities** (`bootstrap.sh --env prod`): ft-prod-deploy (OIDC on main only; Contributor and User Access
  Administrator on FocusTime, nothing else but AcrPull on dev's registry; in FocusTime DB Admins), ft-prod-pull (AcrPull
  on dev's registry only), and the GitHub variables `AZURE_PROD_CLIENT_ID`, `AZURE_PROD_RESOURCE_GROUP`,
  `AZURE_PROD_REGISTRY`, `AZURE_PROD_APP_IDENTITY_CLIENT_ID`, `PROD_DEPLOYERS`.
- **One registry** (D470): prod pulls dev's `ftdevacr5bthbn` with ft-prod-pull, so it runs the bytes dev tested. The
  app's system identity keeps Key Vault and SQL.
- **deploy-prod.yml** (D464): manual, from main, by SHA; refuses anyone not in PROD_DEPLOYERS and any commit not on main;
  builds nothing, reads the digest of dev's image for that commit (`scripts/image-digest.ts`, pull rights only) and
  fails plainly if there is none; migrate, database user, Bicep what-if and deploy, smoke test that `/version` says
  `prod <sha>`. `dry_run` stops after the checks. Rollback and roll forward: the same with another SHA, printed in each
  run's summary.
- **Sign-in and secrets**: `app-registration.sh` added the prod callback to the "FocusTime" registration (dev, prod and
  local now) and put a prod-only Entra client secret into the prod vault; `copy-secrets.sh` copied the Google and
  Dataverse secrets from the keyring by pipe. Tanner added the prod Google redirect URI to "FocusTime Web".
- **App-level settings** (runbook table): env label `prod`, invite domains `cooptimize.org` (D469: an app setting,
  `FOCUSTIME_INVITE_DOMAINS`, that replaces a person's own; Settings says "Set by your FocusTime admin"), and the ids
  dev already had.
- **Clean start** (D463): nothing copied from the local app or dev, either way. `scripts/env-separation.test.ts` fails if
  dev's parameters or workflow name a prod resource, or the reverse (the shared registry line excepted).
- **Migrations only add** (D466): the rule in CLAUDE.md; `store/migrations/additive.test.ts` flags a DROP or RENAME
  without a `safe-drop: <reason>` comment and keeps the numbered lists frozen; the named runner now runs on a newer
  database (logs `newer_schema`) instead of refusing, so a rollback always starts.
- **Old timeboxes** (D468): an event with FocusTime's marker and no record in this person's store is an ordinary event
  (tier "earlier", Open in Outlook only), never moved, cancelled or deleted, and not imported (replaces Q69). One Guide
  question.
- **The capture address**: `#/capture` opens Quick capture over the last place, for the hosted app's Super+Alt+N.

## Changed files

`store/migrations/named.ts`, `named.test.ts`, `additive.test.ts` (new), `store/sql/migrate.ts`; `actions/outlook-sync.ts`,
`actions/step13.test.ts`, `plan/caltier.ts`, `plan/outlooksync.ts`, `plan/outlooksync.test.ts`, `ui/guide/content.ts`;
`server/appconfig.ts`, `server/appconfig.test.ts` (new), `store/user-settings.ts`, `store/user-settings.test.ts`,
`config/schema.ts`, `server/main.ts`, `ui/Settings.tsx`; `ui/App.tsx`, `e2e/capture-address.test.ts` (new);
`infra/main.bicep`, `infra/modules/app.bicep`, `infra/modules/sql.bicep`, `infra/prod.bicepparam`,
`infra/scripts/bootstrap.sh`; `.github/workflows/deploy-prod.yml`; `scripts/image-digest.ts` (new),
`scripts/env-separation.test.ts` (new); `docs/azure/runbook.md`, `docs/azure/A5-report.md` (new), `docs/decisions.md`,
`docs/architecture.md`, `system/README.md`, `CLAUDE.md`.

## Security checklist (prod)

Checked with the Azure CLI on Nov 3 after the create; the app half after the first real deploy (below).

| Check | Result |
|---|---|
| SQL: Entra-only | `azureADOnlyAuthentication: true`, admin "FocusTime DB Admins", TLS 1.2 |
| SQL firewall | only `AllowAllWindowsAzureIps`; deploy-prod removes its runner rule at the end of the job |
| SQL size and backups | GP_S_Gen5, 0.5 to 2 vCores, auto-pause 60, PITR 14 days |
| Key Vault | RBAC, purge protection, 90-day soft delete; roles: DB Admins Secrets Officer, the app Secrets User and Crypto User; its own ft-data-key |
| Registry | AcrPull only for ft-prod-pull and ft-prod-deploy; no push from prod |
| Deploy identity | Contributor and UAA on FocusTime, AcrPull on dev's registry; nothing else |
| App ingress | `allowInsecure: false`; min 1, max 1 |
| No secrets in the repo, image, GitHub or logs | as A4: ids only in the param files and variables; Key Vault references at run time; OIDC; tokens in `image-digest.ts` stay in its process |
| HSTS, CSP, frame and type headers; CSRF and Origin on prod | _after the first deploy_ |

## Verification

- Typecheck clean. Related tests: migrations, outlook sync and step 13, app config, user settings, env separation,
  the capture address e2e: all pass. Full suite before the PR: see the PR.
- `scripts/image-digest.ts` against dev's registry returns the same digest as `az acr repository show` for main's head,
  and fails with the plain message for a commit with no image.
- Bicep: `az bicep build` and `build-params` for both parameter files; the prod what-if listed 15 creates, nothing
  changed or deleted.

### After merge (with Tanner)

_To fill in: deploy-prod run, health, About shows "prod" with the PR and commit, row counts zero before the first
sign-in, dev unaffected; setup through S1; Outlook, Dataverse, Google and DevOps live; a new timebox editable; an old
marker event ordinary; the VM chip; a timer across a revision restart; the actor check refusal (dry run), one rollback
and a roll forward._

## Retiring the local app

_After the prod checks: the Hyprland diff shown first, then `systemctl --user disable --now focustime`, the autostart
entry moved aside; system/README.md says how to turn it back on. "Coopilot Desktop" stays until 2026-11-10._

## The pilot

Welcome message for the two pilot users (sent by Tanner; their names stay out of the repo):

> Hi, FocusTime is ready for you to try:
> https://ft-prod-app.grayforest-92f64bef.centralus.azurecontainerapps.io
>
> Sign in with your Cooptimize account. Setup takes about two minutes. For each client it asks for a DevOps personal
> access token with Work Items (Read & write), so FocusTime can update your items: in that client's Azure DevOps,
> User settings › Personal access tokens (https://dev.azure.com/<org>/_usersSettings/tokens). You can skip it and add
> it later in Settings.
>
> Open the Guide first (⋯ › Guide). Send feedback in the FocusTime team in Teams until Send feedback ships in the app.
>
> You're done with the pilot when you've planned one week and one day, started focus once, and marked one item done
> in DevOps.

After each signs in, the report back is only: matched in Dataverse yes or no, the number of followed clients, sources
live, setup steps done or skipped. Never plan content.

## Limitations

- Max 1 replica until the scheduler has a lease (D465).
- Prod depends on dev's registry (D470): deleting dev needs a prod registry first (runbook).
- The FocusTime resource group's own location is East US (it existed before A5); its resources are in Central US.
- CLAUDE.md's cloud rule still says prod deploys go through "its environment approval"; with the free plan that is the
  PROD_DEPLOYERS check (D464). The rule's wording was left for Tanner (this step changes CLAUDE.md only for the
  migrations rule and the milestone).
- Cost is an estimate from list prices (runbook); the real figure goes in after the first week.

## Setup and rollback

Setup is done (runbook, "The first deploy of prod"). Roll back the app: deploy-prod with the previous SHA. Remove prod
entirely: `az group delete -n FocusTime` (the vault stays reserved for 90 days by purge protection), remove the prod
redirect URIs by running `app-registration.sh` without `--prod-url`, delete the `AZURE_PROD_*` and `PROD_DEPLOYERS`
variables, and the AcrPull assignments on dev's registry go with the identities.

## Proposed next increment

A6, as planned in A0; and before max 2 replicas, a scheduler lease.
