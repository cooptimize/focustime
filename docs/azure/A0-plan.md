# A0 plan: FocusTime on Azure

This plan builds on [A0-inventory.md](A0-inventory.md). The fixed decisions:

- **Where:** tenant cooptimize.org, one subscription, resource group **FocusTime**, Central US.
- **Stack:** Azure SQL serverless with auto-pause, Container Apps, Key Vault, ACR, Application Insights, Bicep, and GitHub Actions with OIDC.
- **Environments:** dev and prod. The built-in Container Apps address until a cooptimize.org hostname.
- **Users:** every user has their own time zone. Retention is two years, with export and delete in Settings. Personal Google Calendar is optional per user.
- **Pilot:** two Cooptimizers after prod.

The steps run in order. Each one ends with typecheck, all tests, screenshots for UI changes, a decision entry, and a commit and push.

## Steps

### A1: host boundary and strip

**Goal.** The product has no machine-specific code, copy or docs. Everything that remains machine-specific sits behind one `Host` interface, with a local implementation only for the developer loop.

**Work:**

1. **Define `Host`** in `server/host-types.ts`: `secrets` (get and put app secrets), `userSecrets` (get, put and delete per user, encrypted), `notify` (store a notice), `clock`, `scheduler` (due rows), `snapshots` (cache read and write), `photos` and `exportDownload`. `actions/dispatch.ts` builds ActionContext only from `Host` and the session.
2. **Remove:**
   - `server/media.ts`, `server/host.ts`, `links/edge.ts`, `server/open-request.ts`, `scripts/open-window.ts`, `scripts/edge-profiles.ts`, `scripts/notify-sample.mjs`;
   - the screenshot, footage and walkthrough scripts, except one screenshot script against a dev URL;
   - the `[edge]` and `[chromium]` config with Settings' browser and profile fields;
   - `pauseMedia` and `media.status`;
   - `secret.set` for users;
   - `ui/Reopen.tsx`, the launch-token page and `focustime-open --capture`;
   - `system/` stays only until A5.
3. **Links** become `<a target="_blank" rel="noopener">` everywhere `link.open` was used (`actions/link-actions.ts`, the menus).
4. **Notifications.** `server/notify.ts`'s `notify-send` and `gdbus` move behind `Host.notify`. The local host may keep `notify-send` for the developer only, and the product UI gains the in-app center (A6 finishes it).
5. **The focus end sound** plays in the browser (`ui/sound.ts`). `server/timer.ts` drops `pw-play`.
6. **Defaults** (`config/defaults.ts`): no standing block; 9:00 to 5:00 in the user's zone (section 6).
7. **Copy, fixtures and tests:** remove Omarchy, Hyprland, Super + Alt, playerctl, Edge profiles, `/home/...` and the `omarchy` theme name. Replace `@cooptimize.org` test addresses, "T&S" and "WC Project" with fictional values (inventory section 5).
8. **Docs:** rewrite `CLAUDE.md` and `docs/spec.md` to role words and the hosted product; delete `docs/ux/R1/notification.png`; drop the `coopilot-*` lines from `.gitignore`.

**Tests:**
- A guard test like `ui/appname.test.ts`: no string in `ui/`, `server/`, `actions/`, `plan/`, `week/`, `sources/` or `config/` names Omarchy, Hyprland, playerctl, notify-send, secret-tool, xdg-open, Edge profiles, `/home/` or the owner.
- Host contract tests run against the local host.
- Existing tests are updated for the removed features.

**By hand first (Tanner):** answer Q2 (the real names to grep for) and Q3 (the decision log). Nothing else.

### A2: identity and per-user data (still SQLite, still local)

**Goal.** Everything works per signed-in user, against a local SQLite file, with two users side by side.

**Work:**

1. **Store.** `store/plan-store.ts` becomes `createPlanStore({ db, userId })`:
   - a migration adds `user_id` to the 30 user tables, with the keys and indexes in inventory section 3;
   - existing rows go to the first user who signs in, once;
   - every statement binds `user_id`;
   - updates and deletes by id check `user_id` and the changed-row count.
2. **New tables:** `users`, `user_settings`, `user_tokens`, `user_secrets`, `sessions`, `pending_writes`, `notifications`, `focus_timers`, `schedule`, `source_snapshots`, `photo_cache`, `deletions`.
3. **Settings per user.** Config sections move to `user_settings` (`config/settings.ts`, `actions/settings-actions.ts`). App-level settings (Dataverse URL, tenant, client ids) come from environment variables. Local dev reads them from a `.env.local` that isn't committed, with `.env.example` committed.
4. **Sign-in** moves to web routes `/auth/microsoft/login` and `/auth/microsoft/callback`, plus `/auth/google/*`, in `sources/oauth/oauth.ts`:
   - confidential client with PKCE and nonce;
   - a session row and the `__Host-focustime` cookie;
   - CSRF on POST;
   - Host and Origin from configuration (`server/guard.ts`, `server/app.ts`).
   - The loopback listener goes. Local dev uses `http://localhost:5317/auth/...` on the existing "Coopilot Desktop" registration, given a web redirect URI and a dev secret, until A4's "FocusTime" registration exists.
5. **"Me"** comes from the session: `actions/account.ts`, `actions/dispatch.ts` (`myEmail`, `mySystemUserId`), `sources/dataverse/source.ts`, plus the Dataverse match by mail, then UPN, then oid (inventory section 8). `[dataverse] my_email` and `my_systemuserid` go.
6. **Time zone per user** (inventory section 6): from `mailboxSettings`, saved on `users`, editable in Settings; no process-wide zone. Remove the `America/New_York` fallbacks in `server/main.ts` and `actions/timer-actions.ts`.
7. **Secrets and tokens.** Refresh tokens and write PATs go in `user_tokens` and `user_secrets` with envelope encryption. Locally the wrapping key is a file key, outside the repo; in Azure it is a Key Vault key (A4).
8. **Persistent state:**
   - the timer, reminders, presence sync, previews (`timebox-actions.ts`, `devops-write-actions.ts`, `vm-actions.ts`) and notifier state move to rows;
   - a scheduler loop with a lease row replaces the 5-second and 30-second ticks;
   - it sleeps until the earliest due row and never polls the database while nothing is due.
9. **Demo** becomes a per-session sign-in choice (`server/demo.ts`).
10. **Export** downloads the user's JSON. **Delete my data** and the 2-year retention job.

**Tests:**
- **Two users.** Every store method as user B against user A's ids: nothing read or changed.
- **Sessions.** Expiry, cookie flags, CSRF refusal, Host and Origin refusal.
- **Time zones.** Week, slot, PTO and reminder tests in Eastern, Central, Mountain and Pacific, plus one DST week.
- **Scheduler.** It fires a timer that ended while the process was down, and two processes never both fire one row (the lease).
- **Pending writes.** A preview confirmed after a restart; an expired one refused.
- **Delete.** Removes every row, token and secret of one user, and nothing of the other.
- **Retention.** Deletes only rows older than 730 days in that user's zone.
- **Browser tests** sign in with a fake identity provider (a test-only route behind a flag that can't be set in production).

**By hand first (Tanner):** add the web redirect URI `http://localhost:5317/auth/microsoft/callback` and a dev client secret to the existing registration (or wait for A4's script). Create a Google web OAuth client for localhost.

### A3: Azure SQL

**Goal.** The same store on Azure SQL, with SQLite kept for unit tests.

**Work:**

1. **Store implementation.** A second store implementation (`store/sql/`) behind the same interface, with T-SQL migrations starting from a baseline equal to A2's schema.
2. **Driver.** `mssql` (on `tedious`), a new dependency (Q8), using Entra authentication with the managed identity (no SQL passwords). Locally, `az login` or a dev SQL login against the dev database.
3. **Connection retry on error 40613** (the database is resuming), with a "Waking up the database…" state in the UI. `/readyz` reports waking.
4. **Optional row-level security** policy on `SESSION_CONTEXT('user_id')` as a second guard.
5. **Import tool.** A one-time import of a SQLite export into Azure SQL for a given user (for A5).

**Tests:**
- The store contract suite runs against both SQLite and a SQL Server container in CI (`mcr.microsoft.com/mssql/server`).
- The 40613 retry is tested with a fake driver.
- Migrations are idempotent.

**By hand first (Tanner):** nothing. The dev database comes with A4. Until then, the contract suite runs against a local SQL Server container.

### A4: infrastructure and dev deploy

**Goal.** Bicep for both environments, the "FocusTime" registration, the GitHub workflows, and dev deployed from main.

**Work:**

1. **Bicep** (`infra/main.bicep` and modules, `infra/dev.bicepparam`, `infra/prod.bicepparam`): the layout below; Container Apps with probes, scale 0 to 1, 0.5 vCPU and 1 GiB; managed identities and role assignments; diagnostic settings to Log Analytics with 30-day retention.
2. **Run `infra/scripts/app-registration.sh`** for the dev and prod URLs once the Container Apps exist. This needs a deploy with a placeholder image first.
3. **`.github/workflows/ci.yml`:** on PR and push, typecheck, unit tests and browser tests, plus the SQL contract suite.
4. **`.github/workflows/deploy.yml`:** on push to main, build the image once (tag = commit SHA), push it to ACR, `az deployment group create` for dev, set the dev app's image by digest, run migrations as a Container Apps job, then a smoke test (`/readyz`, demo sign-in).
5. **App settings in Key Vault:** the Dataverse secret (copied by hand from the current registration), the Google client secret, the Entra client secret (from the script), the cookie key and the data encryption key.
6. **Dockerfile and `.dockerignore`** (inventory section 11).

**Tests:**
- `az bicep build` and `what-if` in CI.
- A container smoke test in CI (build, run with the demo, `/healthz`).
- The deploy workflow is dry-run on a branch.

**By hand first (Tanner):**
1. Agree to installing the Azure CLI on this machine (a new dependency), from the distribution's package manager. Then sign in once with `az login --tenant cooptimize.org`, as someone who can create app registrations, grant admin consent, and has Owner (or Contributor plus User Access Administrator) on the FocusTime resource group.
2. Give the subscription id as a repository variable.
3. Finish the GitHub move (below).
4. Copy the Dataverse client secret into Key Vault: `az keyvault secret set --file`, not on the command line.

### A5: prod, the owner's migration and the pilot

**Work:**

1. **Prod deploy:** the deploy workflow's prod job, with environment approval, deploys the dev-tested digest.
2. **The owner's data:**
   1. Export from the local app.
   2. Import into prod as Tanner's user (the A3 tool).
   3. Re-enter the write PATs in Settings: the keyring values aren't copied off the machine.
   4. Connect Google Calendar again.
   5. Check: the plan, follow-ups, the audit logs, and an Outlook timebox from before the move still editable by its `CoopilotId` marker.
3. **Retire the local install:** `systemctl --user disable --now focustime`, remove the unit, `~/.local/bin/focustime-open`, the desktop and autostart entries and the icons. Remove the two Hyprland bindings by hand (a host file, so Tanner does it or approves a diff), and delete the keyring entries under `focustime`. Delete the "Coopilot Desktop" registration.
4. **Docs:** strip `system/`, the owner's name and the machine from the remaining docs, including `docs/azure/`, which then say "the admin".
5. **Pilot.**
   - Two Cooptimizers sign in, plan a week and a day, start focus, and mark one item done in DevOps, each in their own time zone.
   - Watch Application Insights for errors and Azure SQL for auto-pause behavior for a week.

**Tests:** the pilot checklist as a browser test against dev with fictional data. A restore drill: point-in-time restore of the dev database into a copy.

**By hand first (Tanner):** pick the two pilot users and confirm their Dataverse rows. Approve the prod deployment.

### A6: notifications and small things

**Work:**
- The in-app notification center (bell, list, read and clear).
- The focus timer in the tab title.
- An optional Web Push (VAPID key in Key Vault, a service worker) for timer and meeting warnings with the tab closed.
- The custom hostname `focustime.cooptimize.org` with a managed certificate, its redirect URIs added by re-running the script, and the Host and Origin allowlist updated.
- A Teams activity feed proposal (Q7).
- A PWA manifest so it can be pinned like an app (replaces the launcher).

**Tests:** the notification gate per user (quiet hours in their zone, held during focus); a push subscription stored and removed; the host allowlist.

## Layout in the FocusTime resource group

One resource group, as decided. Each resource is per environment where isolation matters and shared where it doesn't. Names follow the Cloud Adoption Framework abbreviations. Key Vault and ACR need globally unique names, so they get a short suffix.

| Resource | Dev | Prod | Notes |
|---|---|---|---|
| Container Apps environment | `cae-focustime-dev` | `cae-focustime-prod` | Consumption-only; separate so a dev change can't affect prod networking |
| Container App | `ca-focustime-dev` | `ca-focustime-prod` | scale 0 to 1 (prod may go to minimum 1 if Q4 says so) |
| Migration job | `caj-focustime-migrate-dev` | `caj-focustime-migrate-prod` | Container Apps job run by the deploy |
| User-assigned identity | `id-focustime-dev` | `id-focustime-prod` | AcrPull, Key Vault Secrets User and Crypto User on its own vault, a contained database user on its own database |
| Azure SQL logical server | `sql-focustime` (one) | | Entra-only authentication; admin = an Entra group (Q9) |
| Database | `sqldb-focustime-dev` (free offer, pause at the limit) | `sqldb-focustime-prod` (serverless 0.5 to 1 vCore, auto-pause 60 min, 32 GB) | |
| Key Vault | `kv-focustime-dev-<sfx>` | `kv-focustime-prod-<sfx>` | RBAC mode, purge protection on prod |
| Container Registry | `crfocustime<sfx>` (one, Basic) | | one image, promoted by digest |
| Log Analytics | `log-focustime` (one) | | 30-day retention |
| Application Insights | `appi-focustime-dev` | `appi-focustime-prod` | workspace-based |
| Deploy identity | `id-focustime-deploy` (one) | | federated credentials for GitHub environments `dev` and `prod`; Contributor on the group plus AcrPush |

Tags: `app=focustime`, `env=dev|prod`. A `CanNotDelete` lock on the prod database and the prod Key Vault.

A twin group (`FocusTime-dev`) would make access and cost split cleaner, but it goes against the decision for one group. It's offered as Q10 rather than assumed.

**Promotion.**
1. Every push to main builds the image once and deploys it to dev automatically.
2. The smoke test runs, then the prod job waits on the GitHub environment `prod` (required reviewer: Tanner).
3. Approval deploys the same image digest to prod with multiple-revision mode. The new revision takes 100% of traffic once `/readyz` passes, and the previous revision stays for a quick rollback.
4. Database migrations run before the traffic switch and are backward compatible for one release (expand, then contract).

## Entra automation

`infra/scripts/app-registration.sh` (written in A0, run in A4). It finds or creates the single-tenant **FocusTime** registration and brings it to:

- **Platform:** web.
- **Redirect URIs:** `<dev>/auth/microsoft/callback`, `<prod>/auth/microsoft/callback` and `http://localhost:5317/auth/microsoft/callback`.
- **Implicit flow:** both access and ID tokens off.
- **Delegated permissions:**
  - Graph: `openid profile email offline_access User.Read Calendars.ReadWrite MailboxSettings.Read Presence.ReadWrite Presence.Read.All ProfilePhoto.Read.All`;
  - Azure Service Management: `user_impersonation`.
  - Each scope's id is resolved from the tenant, never hard-coded.
- **The enterprise app** is created if it's missing, then admin consent is granted for the tenant.

**The client secret** goes from `az ad app credential reset` through a pipe into `az keyvault secret set` (`entra-client-secret`, with an expiry date). It is never in a variable, a file, the terminal or a log.
- It only runs when the vault has no secret yet, or with `--rotate-secret`.
- A rotation keeps the old secret valid until the app restarts on the new one.

**Running it.** It prints the registration's settings at the end: app id, redirect URIs, implicit flags, the credential names and end dates (never values), the permissions and the grants. Running it again changes nothing, and `--dry-run` shows the writes without making them.

The Azure CLI isn't installed on this machine. Installing it is a new dependency, asked for at the start of A4. After that, the one interactive step is Tanner's `az login --tenant cooptimize.org`.

## GitHub (before A4)

1. **Transfer** the repository from Tanner's account to the Cooptimize organization: Settings > Danger Zone > Transfer, which needs org owner rights. Keep it private.
2. **Remote update** on every clone: `git remote set-url origin https://github.com/<org>/focustime.git`. GitHub redirects the old URL, but don't rely on that.
3. **Branch protection on `main`:** PRs required, the CI checks required (typecheck, tests, browser tests, Bicep build), linear history, no force pushes, no deletions.
4. **Environments `dev` and `prod`:**
   - `prod` has a required reviewer (Tanner), only `main` can deploy to it, and a short wait timer is optional.
   - Each environment holds variables only: `AZURE_CLIENT_ID` (the deploy identity), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `ACR_NAME`, `RESOURCE_GROUP`, `APP_NAME`.
5. **The OIDC federated credential** on `id-focustime-deploy`: issuer `https://token.actions.githubusercontent.com`, subjects `repo:<org>/focustime:environment:dev` and `repo:<org>/focustime:environment:prod`, audience `api://AzureADTokenExchange`. The workflow uses `azure/login` with `id-token: write` permission.
6. **No credentials in GitHub:** no client secrets, PATs or publish profiles as repository secrets. App secrets live in Key Vault and the deploy identity authenticates by OIDC.
7. **Org settings:** Actions limited to verified creators plus `azure/*` and `actions/*`; Dependabot alerts on; secret scanning and push protection on.

## Risks

1. **Azure SQL auto-pause cold start and a database that never pauses.**
   - *Risk.* The first request after a pause gets error 40613 and waits about a minute; Microsoft's page says "generally less than one minute". The opposite risk is a scheduler or health probe touching the database every few seconds, so it never pauses: about $229 a month at 0.5 vCore instead of about $83.
   - *Mitigation.*
     - Retry 40613 with backoff, show "Waking up the database…" on the sign-in page and in `/readyz`.
     - The scheduler sleeps until the earliest due row (held in memory, re-read only on change).
     - Liveness never touches the database.
     - Watch "auto-pause count" in the pilot.
     - If the morning wake-up is a problem, schedule a wake just before working hours in the earliest zone.
2. **Moving sign-in from loopback to the web, for Microsoft and Google.**
   - *Risk.* The flows, tokens and consent all change. A mistake could leak tokens or lock users out.
   - *Mitigation.*
     - A confidential client with PKCE and nonce; tokens validated server-side; refresh tokens encrypted per user.
     - Admin consent granted once, so users see no prompts.
     - Google's web client published, or the pilot users added as test users first.
     - One sign-in test per provider with a fake identity provider.
     - A2 runs the new flow locally before anything is hosted.
3. **Timers and reminders in memory.**
   - *Risk.* A restart, scale to zero or a second replica drops focus timers, reminders, previews and Teams status clears.
   - *Mitigation.*
     - All of these become rows (inventory section 11), with a scheduler holding a lease.
     - A test where the process is down at a timer's end and the timer still fires on start.
     - Scale to zero means reminders fire only when something wakes the app. Q4 decides between a minimum of 1 replica (about $8 a month more) and a Container Apps cron job.
4. **Time zones per user.**
   - *Risk.* About 120 places read one zone, so a missed one shows the wrong day or slot for someone in another zone.
   - *Mitigation.*
     - The zone only comes from ActionContext (the user's settings), and there's no process zone.
     - A lint-style test fails on `America/` literals and process-wide zone reads outside tests.
     - The week, slot, PTO and reminder suites run in Eastern, Central, Mountain and Pacific, plus a DST week.
     - The pilot users are in different zones.
5. **Matching Dataverse users whose email differs from their UPN.**
   - *Risk.* `internalemailaddress` may hold a primary SMTP that isn't the UPN, or an old alias. That user would see no focus blocks, PTO or clients.
   - *Mitigation.*
     - Match by mail, then UPN, then `azureactivedirectoryobjectid`, and record which one matched.
     - Show a plain "We couldn't find you in Dataverse" with what to ask an admin, never an empty week that looks fine.
     - Check both pilot users before A5.

Also watched, but not in the top five:
- Envelope encryption key handling (Key Vault crypto role, key rotation).
- Google's verification for calendar scopes.
- Cost drift from logs.
- The single SQL server as a shared failure point (point-in-time restore covers data, not availability).

## Open questions for Tanner

1. **Subscription.** The subscription id, and whether the deploy identity may have Owner, or Contributor plus User Access Administrator, on the FocusTime group (needed for role assignments in Bicep).
2. **Names to grep for.** The real client names, project names and people to grep for (A1), so tests and docs can be checked for real data beyond what's already fictional: `@cooptimize.org` test addresses, "T&S", "WC Project".
3. **The decision log** (`docs/decisions.md`) names the owner, the machine and Omarchy throughout. Rewrite it to role words, or move it to an archive outside the product repo?
4. **Reminders with scale to zero.** Keep prod at a minimum of 1 replica so reminders fire on time (about $8 a month more), or use a Container Apps cron job every few minutes that wakes the app only when a row is due?
5. **SQL for prod.** Serverless at 0.5 to 1 vCore (about $83 to $165 a month), or the free offer with "continue with charges" (saves about $22 a month, no SLA)?
6. **Google Calendar.** Publish the Google OAuth app (may need Google's verification for the calendar scope), or keep it in testing with each user added as a test user?
7. **Teams activity feed** for notifications later: it needs an application permission (`TeamsActivity.Send`) and a Teams app. Worth it after the in-app center, or is Web Push enough?
8. **New dependencies, for approval when their step starts:** `mssql` (A3, Azure SQL driver), `@azure/identity` and `@azure/keyvault-secrets`/`keys` (A4), and an OIDC library, or keep the hand-written token validation with `jose` (A2).
9. **The Entra admin group** for the SQL server and Key Vault (who besides Tanner)?
10. **Twin group.** One FocusTime group for dev and prod, as decided, or a `FocusTime-dev` twin for cleaner access and cost?
11. **Custom hostname.** Is `focustime.cooptimize.org` the name, and who manages the cooptimize.org DNS?
12. **VM control** stays per user (each Cooptimizer's own VM by Owner tag, with their own Azure RBAC). Should everyone get it, or is it off by default and turned on in Settings?
13. **Retention.** Is the two-year clock right for the audit logs too, or should write logs be kept longer than plans?
