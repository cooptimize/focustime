# A4 report: Azure infrastructure and the dev deployment

Nov 3, 2026. Dev is deployed in **FocusTime-dev** (subscription "Production Services and Apps",
`65be698f-0695-48f4-b322-1aa1c387d5e2`, tenant `abf29d42-…`, Central US). Prod is A5.

Dev URL: **https://ft-dev-app.ashysand-30e17134.centralus.azurecontainerapps.io**

Commits, in order:

| Commit | What |
|---|---|
| `0ccb529` | Bicep: `infra/main.bicep`, five modules, dev and prod parameters |
| `080770e` | Dockerfile and `.dockerignore` |
| `5c3d4ef` | Workflows: `ci.yml`, `deploy-dev.yml`, `deploy-prod.yml` (stub) |
| `f5339f0` | Scripts: `bootstrap.sh`, `copy-secrets.sh`, `app-registration.sh` (A4 changes), `scripts/db-user.ts` |
| `2f6419b` | App code: health probes, Key Vault secrets and data key, App Insights telemetry |
| `400f6db` | Docs: runbook, decisions D433 to D436, CLAUDE.md |
| (later commits) | Fixes from the first deploys, and this report |

Rollback:
- `az group delete -n FocusTime-dev` (everything in it, including the deploy identity `ft-dev-deploy` and its
  federated credential and role assignments). The Key Vault stays soft-deleted for 90 days under purge protection (its
  name is reserved until then).
- If the group is kept: `az identity federated-credential delete -g FocusTime-dev --identity-name ft-dev-deploy -n github-main`
  stops GitHub from deploying.
- The "FocusTime" registration stays (its dev redirect URI and the `focustime-20261103` secret can be removed with
  `app-registration.sh` run without the dev URL, and `az ad app credential delete`). "FocusTime DB Admins" stays (prod
  uses it). "Coopilot Desktop" was not touched.
- Code: `git revert 0ccb529^..HEAD`. The local service is unaffected either way (it runs on the local container).

## Resources

| Resource | Name | Settings |
|---|---|---|
| Resource group | `FocusTime-dev` | Central US, tags app=focustime env=dev |
| Log Analytics | `ft-dev-log` | PerGB2018, 30 days |
| Application Insights | `ft-dev-appi` | workspace-based, 30 days; the app sends only its closed log fields and route names, no bodies |
| Container registry | `ftdevacr5bthbn` | Basic, admin user off, anonymous pull off |
| Key Vault | `ft-dev-kv-5bthbn` | RBAC, soft delete 90 days, purge protection; key `ft-data-key` (RSA 3072, wrap and unwrap only); secrets `ft-entra-client-secret`, `ft-google-client-secret`, `ft-dataverse-client-secret`; audit logs to Log Analytics |
| SQL server | `ft-dev-sql-5bthbn` | Entra-only auth, admin "FocusTime DB Admins", TLS 1.2, public endpoint, only `AllowAllWindowsAzureIps` |
| SQL database | `focustime` | GP serverless Gen5, 0.5 to 1 vCore, auto-pause 60 min, 32 GB, no zone redundancy, local backup redundancy, PITR 7 days |
| Container Apps environment | `ft-dev-cae` | Consumption profile, logs to `ft-dev-log` |
| Container App | `ft-dev-app` | system identity, external HTTPS ingress (no insecure), port 8080, single revision, 0.5 vCPU / 1 GiB, min 0 max 1, startup, liveness and readiness probes on `/healthz` and `/readyz` |
| Deploy identity | `ft-dev-deploy` | federated credential `repo:cooptimize/focustime:ref:refs/heads/main`; Contributor and User Access Administrator on FocusTime-dev only; member of FocusTime DB Admins |

Role assignments made by the Bicep: the app identity has AcrPull on the registry and Key Vault Secrets User and Key
Vault Crypto User on the vault; FocusTime DB Admins has Key Vault Secrets Officer on the vault. In the database
(`scripts/db-user.ts`, run by the workflow): the app identity `ft-dev-app` is a contained user with db_datareader,
db_datawriter and EXECUTE on dbo, no DDL.

Entra (tenant level, made by `bootstrap.sh`): the security group **FocusTime DB Admins** (Tanner, Josh Knox, Aaron
Jennings, and `ft-dev-deploy`).

GitHub repository variables (ids, no secrets): `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_DEV_CLIENT_ID`,
`AZURE_DEV_RESOURCE_GROUP`, `AZURE_DB_ADMIN_GROUP_ID`. No GitHub secrets.

### Two-phase first deploy

The Container App's system identity exists only once the app does, and it needs AcrPull and the Key Vault roles
before it can pull the image or read a Key Vault reference. So the first deploy runs with `appReady=false`: a public
placeholder image, no registry and no references. That creates the identity and its roles. Every later deploy (the
workflow) runs with `appReady=true`.

### What-if (first deploy, shown before the create)

17 creates, all in FocusTime-dev, nothing outside it; the deploy identity made by the bootstrap showed as Ignore:
the workspace and App Insights; the registry and its AcrPull assignment; the vault, `ft-data-key`, three role
assignments and its diagnostic setting; the SQL server, its firewall rule, the database, its short-term retention policy
and its diagnostic setting; the Container Apps environment and the app. The workflow prints a what-if before every
deploy (in the run log).

## Redirect URIs

The "FocusTime" registration (`0040169f-a4c9-46d9-bd81-83c31d0d6ff0`, web, single tenant, implicit flow off, the A2
scopes, admin consent granted):

- `https://ft-dev-app.ashysand-30e17134.centralus.azurecontainerapps.io/auth/microsoft/callback`
- `http://localhost:5317/auth/microsoft/callback`

Client secrets: `focustime-20261103` (in Key Vault as `ft-entra-client-secret`, ends Nov 3, 2027) and
`focustime-local-20261102` (the local keyring's, from A2). Neither was printed.

**Google** (for Tanner to add in the Google Cloud console, OAuth client
`1059654433254-7qloie755h12e9qk050b6fpi2cbhkspn`, Authorized redirect URIs):

- `https://ft-dev-app.ashysand-30e17134.centralus.azurecontainerapps.io/auth/google/callback`

## Costs

Prices from the Azure retail prices API (`prices.azure.com`), Central US, pay as you go, USD, read Nov 3, 2026. A month is
730 hours.

| Meter | Price |
|---|---|
| SQL Database GP serverless Gen5 compute | $0.62611 per vCore hour |
| SQL Database GP storage | $0.138 per GB month |
| SQL Database Standard S0 (10 DTU, 250 GB included) | $0.4839 per day (about $14.72 a month) |
| SQL Database Standard S1 (20 DTU, 250 GB included) | $0.9677 per day (about $29.43 a month) |
| Container Apps consumption, active | $0.000024 per vCPU second, $0.000003 per GiB second |
| Container Apps consumption, idle | $0.000003 per vCPU second, $0.000003 per GiB second |
| Container Apps free grant (per subscription, monthly) | 180,000 vCPU seconds, 360,000 GiB seconds, 2 million requests |
| Container Registry Basic | $0.1666 per day (about $5.07 a month) |
| Log Analytics ingestion | $2.76 per GB after the free 5 GB a month |
| Key Vault | operations in cents (a few hundred a day: the data key once per start, secrets at revision start) |

**Dev, a month:** about **$30**.
- SQL serverless: storage 32 GB × $0.138 = $4.42; compute only while online. Each use keeps it up for the use plus 60
  minutes; at about 3 online hours on 22 working days, 66 hours × 0.5 vCore × $0.626 = about $21. Paused otherwise ($0).
- Container App: scale to zero; a few hours a day of one replica stays inside the free grant ($0).
- Registry $5.07; logs inside the free 5 GB ($0); Key Vault under $0.10.

**Prod projection (A5), a month**, one replica always on (D433) and a team using it in working hours:
- Container App: 0.5 vCPU and 1 GiB for 2.63 million seconds, less the free grant: about $3 idle to $27 if always
  active, plus memory about $7. About **$10 to $34**.
- Database, three choices:

| Option | Compute | Storage | Month | Notes |
|---|---|---|---|---|
| GP serverless 0.5 to 1 vCore, auto-pause 60 | 250 to 350 online hours × 0.5 to 1 vCore × $0.626 = $78 to $219 | $4.42 (32 GB) | **$83 to $224** | the scheduler wakes it for reminders and timer ends (D431), so working days stay online; cold start about a minute |
| Standard S0 (10 DTU) | always on | 250 GB included | **$14.72** | no pause, no cold start; 10 DTU is enough for a small team's plan rows; no Entra difference |
| Standard S1 (20 DTU) | always on | 250 GB included | **$29.43** | headroom for the scheduler's passes and exports |

Recommendation for A5: **S1** for prod (cheaper than serverless once the team uses it every working day, no
"Waking up" wait, double S0's headroom for little money); keep dev on serverless (idle most of the day).

## Security checklist

| Check | Result |
|---|---|
| SQL: Entra-only (no SQL logins) | `azureADOnlyAuthentication: true`; admin is the group |
| SQL firewall | only `AllowAllWindowsAzureIps`; the deploy runner's rule `gh-run-<id>` is removed at the end of its job |
| No secrets in the repo | the names test and `git grep` for secret shapes; the param files hold ids only |
| No secrets in the image | `.dockerignore` keeps config, `.env`, keys and stores out; no build args; secrets reach the container as Key Vault references at run time |
| No secrets in GitHub | OIDC; variables hold ids only; no repository or environment secrets |
| No secrets in logs | the closed log field set (D407/A2); App Insights gets the same fields and route names, no bodies, no query strings |
| Key Vault | RBAC mode, purge protection, the app with Secrets User and Crypto User only |
| HTTPS only | ingress `allowInsecure: false`; HSTS on (the public URL is https) |
| CSRF and headers on dev | see Verification |

## Verification

Deploy runs on main: `41600671851` failed at the Azure sign-in (fix 1 below), `41602450875` failed at the database
user (fix 2), `41604132652` **green**: CI (test, infra, image), image push, migration, the database user
(`ft-dev-app: user created; roles db_datareader, db_datawriter; EXECUTE on dbo`), what-if and deploy, smoke test.
Revision `ft-dev-app--0000001` runs the image `focustime:6367d22…`.

Checked from this machine with curl (Nov 3, 08:50 UTC):

| Check | Result |
|---|---|
| `/healthz` | 200 `{"status":"ok"}` |
| Page | 200, `<title>FocusTime</title>` (the built UI with the brand) |
| HTTP | 301 to https |
| Headers | `strict-transport-security: max-age=31536000; includeSubDomains`, `content-security-policy: default-src 'self'; … frame-ancestors 'none'; …`, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer` |
| Microsoft sign-in | `/auth/microsoft/login` 302 to `login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize` |
| CSRF | `POST /api/action` without a session and token: 401; from a foreign Origin: 403 (`server denied kind=origin_not_allowed` in the log) |
| Demo | `POST /auth/demo` 200; demo sources are fictional and make no external call |
| Firewall after the run | only `AllowAllWindowsAzureIps` (the runner's rule was removed) |
| App Insights | `AppRequests` rows named by route class only (`GET / (page)` 200, `GET /auth/microsoft/login` 302, `POST /api/action` 401 and 403, `POST /auth/demo` 200), no URL, query, header or body; `AppTraces` the closed log fields (`auth sign_in_started`, `server denied`, `plan scheduler`); ingestion lags about 5 minutes |
| Container log | `FocusTime running on https://ft-dev-app… (built UI, azure host)`, `Sign-in: Microsoft, demo`, the scheduler idle |

Waiting on Tanner (needs a signed-in person): sign-in as the first user with an empty plan, Outlook live, Google
connect (after the console URI), the VM chip, a focus timer across a revision restart
(`az containerapp revision restart`), the data key's first wrap (`app_keys` gets its row when the first secret is
sealed), and the database pausing after an idle hour with the "Waking up" banner on the next visit.

### Fixes from the first deploys

1. **Federated subject.** This organization's GitHub tokens present the immutable-id subject
   `repo:cooptimize@105446763/focustime@1442471077:ref:refs/heads/main`, not `repo:cooptimize/focustime:…`
   (AADSTS700213). `bootstrap.sh` now adds both (`github-main`, `github-main-ids`).
2. **The app's database user.** `CREATE USER … FROM EXTERNAL PROVIDER` run by a service principal needs the SQL server's
   own identity to hold Directory Readers in the tenant (error 33134). That is a tenant-wide role grant outside A4, so
   `scripts/db-user.ts` makes the same Entra user with `CREATE USER [ft-dev-app] WITH SID = <client id>, TYPE = E`, the
   documented form that needs no directory lookup. The client id (not a secret) is the repository variable
   `AZURE_DEV_APP_IDENTITY_CLIENT_ID`; recreating the app changes it (runbook).

## What Tanner must click

1. **Google console**: add the redirect URI above to the OAuth client's Authorized redirect URIs.
2. **Sign in on dev** (first user, empty plan) and connect Outlook and Google.
3. **Group membership**: Josh and Aaron are in "FocusTime DB Admins"; nothing to click unless someone else needs it.
4. **Branch protection on main** (after A4 is green; A5 works on branches with pull requests): Settings > Branches >
   Add rule for `main` (or a ruleset):
   - Require a pull request before merging (1 approval; dismiss stale approvals on new commits);
   - Require status checks to pass: `test`, `infra`, `image` (from `ci`); require branches to be up to date;
   - Require conversation resolution;
   - Block force pushes and deletions;
   - Do not allow bypassing the above (or allow only admins, for emergencies);
   - Then Settings > Environments > New environment `production`: required reviewers (Tanner, and one other),
     deployment branches `main` only (A5's `deploy-prod.yml` uses it).
