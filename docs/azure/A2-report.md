# A2 report: Entra web sign-in, per-user data, per-user secrets and settings

Nov 2 to 3, 2026. Still SQLite, still the developer machine. The one Azure change is the "FocusTime" app registration
(`infra/scripts/app-registration.sh --local`). The old "Coopilot Desktop" registration still exists and is removed
in A5. Nothing is deployed.

Commits, in order:

| Commit | What |
|---|---|
| `bd5ac99` | Sign-in and sessions |
| `969dc12` | Users and the per-user scoping migration |
| `afb3174` | Settings rows |
| `2064b51` | Secrets and the KeyProvider |
| `86e8c4f` | Server state and the scheduler |
| `e76bbbc` | Verification fixes |
| `0675ff6` | Launcher fix |
| `bd74b37` | Needs-sign-in layout and the calendar scope |
| (this commit) | Docs |

Rollback: `git revert bd5ac99^..HEAD`, then restore the store from
`~/.local/share/focustime/plan.db.bak-v22-20261103T04422472373999Z`. The A1 code reads only version 22.

## What changed

**Sign-in.**
- **The flow.** OpenID Connect authorization code flow against the Cooptimize tenant only, as a confidential client.
  - PKCE, state and nonce.
  - The ID token's signature is checked against the tenant's published keys.
  - Issuer, audience, expiry and nonce are checked, and the tenant id is checked again.
  - Library: `openid-client` 6.8.9 (MIT).
  - The library skips the signature check on the code flow by default. `enableNonRepudiationChecks` turns it on. The fake identity provider's foreign-key test caught this.
- **The page.** "Sign in with Microsoft" and "Try the demo". The demo is a session with its own fictional person and an in-memory store, with no external calls.
- **The developer loop.** The launch token is gone. `focustime-open` only brings the window up.
- **Scopes.** One sign-in asks for `openid profile email offline_access https://graph.microsoft.com/.default`.
  - The registration grants: User.Read, Calendars.ReadWrite, MailboxSettings.Read, Presence.ReadWrite, Presence.Read.All, ProfilePhoto.Read.All, and Azure Service Management user_impersonation. Admin consent is tenant-wide.
  - Reads ask for Calendars.ReadWrite, because the registration doesn't grant ReadBasic. `bd74b37` fixed refreshes that asked for ReadBasic and were refused.
  - A test now checks every scope the client asks for against the script.

**Sessions.**
- **Storage.** In the plan store (`sessions`). Only a SHA-256 of the session id is stored.
- **Limits.** 12 hours idle, 7 days absolute, 2 hours for a demo.
- **Cookies.** All `__Host-`:
  - the session cookie: HttpOnly, SameSite=Lax;
  - the CSRF token: readable, SameSite=Strict, sent back as `X-CSRF` on every state change;
  - the pending sign-in's state: HttpOnly, Lax.
- **Checks and headers.**
  - Host and Origin are checked, and API calls are same-origin only.
  - Security headers: CSP, frame and content-type options, referrer, COOP, CORP, permissions, and HSTS on https.
- **Sign out** ends the session and revokes nothing at Microsoft.

**Users and scoping.**
- **`users`.** Columns: Entra oid, tenant, UPN, display name, email, time zone, created, last sign-in, deleted_at.
- **Migration 24** gives every plan table `user_id`:
  - first in every primary and unique key;
  - indexes led by it;
  - picks reference their day plan by (user_id, date).
- **One place for the filter.** `store/scope.ts` rewrites every statement the store prepares:
  - INSERT gets `user_id = $uid`;
  - UPDATE and DELETE get the filter;
  - SELECT gets it on every table it names.
  - It refuses what it can't scope: subqueries, CTEs, and any statement naming `user_id`.
  - `$uid` comes from the session's person, never from the client.
- **The isolation test** is generated from the table list, so a new table without scoping fails it. It runs two people side by side, aims every id-taking change at the other's ids, and resets.

**Settings rows.**
- **Where settings live.** A person's settings are rows (`user_settings`, one per top-level section of the settings text). Every Settings edit works as before and is saved only when the result is valid.
- **App keys are never stored per person.** These come from the app config (`~/.config/focustime/app.toml` or environment) and are added when a person's settings are read:
  - the Dataverse environment and app registration;
  - the Entra tenant and client;
  - the Google client id;
  - the person's sign-in email;
  - their time zone.
- **The config file** was read once more to seed the owner's rows, then ignored.
- **A new person** gets the starter in the zone their Outlook mailbox names (Graph `mailboxSettings/timeZone`, mapped from the Windows name), else the host clock's.
- **Settings > Data, Export my data:** every row of theirs as JSON. It never includes a token, secret, session or user id column.
- **Settings > Data, Delete my data:**
  - typed confirmation;
  - soft now: sign-in refused, sessions ended, secrets cleared, background work stopped;
  - hard after 30 days: every row and the users row removed;
  - both logged with only a hash of the id.
- **App secrets.** A person's Settings no longer lists or sets the app's client secrets.

**Secrets.**
- **What's per person.** A person's Microsoft and Google refresh tokens and DevOps write PATs are sealed in `user_secrets`:
  - AES-256-GCM under the app's data key;
  - a fresh IV per value;
  - the person and account bound in as associated data, so a value moved to another row or person doesn't open.
- **The key** comes from a KeyProvider on the host:
  - local: the secret store's `data-key` entry, made once through stdin;
  - hosted: wrapped by a Key Vault key (A4);
  - tests: a fake.
- **What stays in the host's store.** App client secrets (Entra, Google, Dataverse).
- **The owner's existing secrets.** At the owner's first sign-in, the write PAT and the Google refresh token in the keyring were copied into their secrets. The keyring entries are kept.
- **Caches.** Every source, and every source's snapshot cache, is per person (`host.snapshotsFor`, a folder per hash of the id).

**Sources per person.**
- **Microsoft.** The Outlook source, Teams presence, photos and the Azure token use the person's refresh token from the web sign-in.
- **Google Calendar.** Connected per person through `/auth/google/login` and `/auth/google/callback`: PKCE and state, read-only scope.
- **Dataverse.** Finds the person by email, then UPN. A stored `my_systemuserid` is used as is. Otherwise: "We couldn't match you in Dataverse yet".
- **The VM.** Found by an Owner tag of the person's UPN, then their display name.

**Server state.**
- **One scheduler** (`server/scheduler.ts`) runs everyone's background work: a fast pass every 5 s and a slow one every 30 s. A pass never overlaps another of its kind, and one person's failure stays theirs.
- **The tick code** (`server/ticks.ts`) reads what is due from the person's rows each pass:
  - the timer;
  - once-a-day marks;
  - held notices;
  - Teams status.
- **At start** the timer pass runs first.
- **A clicked notification's view** is kept in the person's own store for 2 minutes instead of one route in memory.

## The migration on this machine

The live store went from version 22 to 26 at the first start of the A2 code (Nov 2, 11:42 PM Eastern). The backup is
`plan.db.bak-v22-20261103T04422472373999Z`. The first sign-in (11:56 PM) claimed every row in one transaction.

| Table | Rows before (v22) | Rows after the claim |
|---|---:|---:|
| account_state | 3 | 3 |
| azure_write_log | 2 | 2 |
| borrowed | 1 | 1 |
| captures | 5 | 5 |
| day_plans | 9 | 9 |
| delivery_snapshots | 32 | 32 |
| devops_identities | 1 | 1 |
| devops_write_log | 7 | 7 |
| draft_stories | 4 | 4 |
| flex_sessions | 1 | 1 |
| focus_log | 13 | 13 |
| follow_ups | 10 | 10 |
| invites | 2 | 2 |
| kv | 2 | 3 |
| markers | 37 | 37 |
| outlook_events | 6 | 6 |
| picks | 21 | 21 |
| resume_notes | 1 | 1 |
| teams_status_log | 16 | 17 |
| timeboxes | 3 | 3 |
| week_feature_slots | 4 | 4 |
| week_features | 16 | 16 |
| week_plans | 2 | 2 |
| write_log | 16 | 16 |
| **Total** | **214** | **216** |

The two extra rows came from normal use after the claim: one more state row and one more Teams status entry.

New rows:
- users: 1;
- sessions: 1;
- user_settings: 10, seeded from the config file;
- user_secrets: 3 (the Outlook refresh token from the sign-in, the Google refresh token and the write PAT copied from the keyring).

After the claim:
- unowned rows: 0;
- foreign key problems: 0.

A dry run on a copy (22 to 24) before the real run kept all 214 rows. The copy was deleted.

## Redirect URIs

**Microsoft** (the "FocusTime" registration, tenant `abf29d42-2ea9-422b-b0af-ed7cb5595b7e`, client
`0040169f-a4c9-46d9-bd81-83c31d0d6ff0`):
- registered now: `http://localhost:5317/auth/microsoft/callback`;
- to add in A4: `https://<dev host>/auth/microsoft/callback` and `https://<prod host>/auth/microsoft/callback`.

**Google** (the redirect URIs to add in the Google Cloud console, APIs & Services > Credentials):
- `http://localhost:5317/auth/google/callback` (the developer loop, now);
- `https://<dev host>/auth/google/callback` and `https://<prod host>/auth/google/callback` (A4).

The current Google client is a Desktop client. Your existing connection carried over (its refresh token was copied),
so Connect Google hasn't been needed yet. For the web redirect, create a **Web application** client with the URIs
above, then put its id in `app.toml` `[google] client_id` and its secret in the secret store as
`google-client-secret`.

**Google publishing checklist** (before anyone outside the developer uses it):

1. OAuth consent screen:
   - User type **Internal** if the Cooptimize Google Workspace is the only audience (no verification needed);
   - otherwise **External** and "In production".
2. App name "FocusTime", support email, the app's logo, and the home page, privacy policy and terms URLs on the
   prod host.
3. Authorized domains: the prod host's domain.
4. Scopes: only `https://www.googleapis.com/auth/calendar.events.readonly`. It is a sensitive scope, so External needs
   Google's verification, with a demo video of the connect flow and the scope's use.
5. The Web client's redirect URIs as above, and no JavaScript origins (the flow is server side).
6. Test users while in testing. Refresh tokens of an External app in testing expire after 7 days.

## Verified

- **Typecheck and tests.** Typecheck is clean. 1864 tests pass, including the browser tests.
  - The suite passes under New York, Chicago, Denver and Los Angeles.
  - Chicago's first run overlapped a dev demo server and timed out in the browser tests; it passes alone.
- **The demo.** Works from the sign-in page with no external requests (checked with a request log).
- **Live on this machine.**
  - Sign-in through the new flow.
  - The claim of every row, and settings from the config file.
  - Outlook, Google, Teams presence and Dataverse answering with the person's own tokens, and the PTO read.
- **Screenshots** from demo mode: `docs/ux/A2/signin.png`, `settings-connections.png`, `settings-data.png`.
- **Still for you to confirm on this machine:**
  - your plan, follow-ups, captures, settings and write PAT look right in the app;
  - the VM chip works;
  - a running timer survives `systemctl --user restart focustime`.

  The restart test proves the timer case on a store file. The live check is yours, because a timer sets your Teams status.

## Found and fixed during verification

- **The launcher waited forever.** `focustime-open` accepted only a 127.0.0.1 launch link, and A2 publishes `http://localhost:5317/`. It also needed the localhost window class.
- **The tall Outlook chip.** The sign-in page's class `.signin` was also the status chip's "needs sign-in" class, so that chip grew to the page's height. The page class is now `.signin-page`, and a browser test measures the bars.
- **The calendar scope.** Read and identity tokens asked for Calendars.ReadBasic, which the registration doesn't grant.
- **A real client's initials** in a code comment (caught by `fixtures/names.test.ts`).

## Deferred

- **Previews in memory.** Previews for timeboxes, DevOps writes and VM changes are still in memory (confirm within the same process). `pending_writes` rows come with the hosted app (A4).
- **The scheduler lease.** With one replica there's no lease; A4 adds it before scaling out.
- **Retention.** The two-year retention job for logs, and "Sign out everywhere".
- **Notifications.** Desktop notifications are the machine's, and only meaningful for the machine's owner. In-app notices per person come in A6.
- **Shared on the host.** The machine-level open request (Quick capture from the launcher) goes to whoever is signed in on this machine. The photo cache is shared too.
- **Google.** A Web client for the Google redirect (above).
- **The old registration.** "Coopilot Desktop" stays until A5.
