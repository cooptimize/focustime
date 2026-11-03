# A0 inventory: what the Azure move touches

Step A0 is read-only. It inventories the code as of e1aa630 (Nov 2, 2026), one desktop app for one person, ahead of the move to a hosted FocusTime for every Cooptimizer. Each table below gives a proposed home or replacement. The plan is in [A0-plan.md](A0-plan.md).

Proposed homes used in the tables:

- **host/local**: a thin adapter kept only for the developer loop (`npm run dev` on a laptop), behind the same interface as the hosted one.
- **host/azure**: the hosted adapter (Container Apps, Azure SQL, Key Vault, the browser).
- **core**: stays in `week/`, `plan/`, `actions/` or `sources/`, made per-user.
- **removed**: gone, together with its settings, copy and tests.

This document still names the developer machine, Omarchy, Hyprland and the owner, because they are what has to go. A1 strips them from the product, and A5 strips them from these docs too (see the plan).

## 1. Machine and OS touches

The grep patterns and counts are in section 13. Every file they return is in this table.

| File | What it does today | Proposed home |
|---|---|---|
| `secrets/keyring.ts` | `secret-tool` (Secret Service) through `execFile`: app secrets, refresh tokens, write PATs, service `focustime` | host/local for the developer loop only. host/azure: app secrets from Key Vault (managed identity); per-user secrets encrypted in the database (section 4) |
| `secrets/keyring-rename.ts` | R1's move of the keyring entries from service `coopilot` | removed (one-time, done) |
| `server/rename.ts` | R1's one-time copy of the `~/.config`, `~/.local/share` and `~/.cache` folders | removed (one-time, done) |
| `config/load.ts` | `~/.config/focustime/config.toml`, `~/.cache/focustime`, `~/.local/share/focustime/plan.db` (XDG) | host/local: a dev config file. host/azure: app settings from environment variables and Key Vault references; per-user settings in the database (section 2) |
| `config/edit.ts` | Rewrites config.toml in place, keeping comments, with `.bak` copies | removed for users: Settings writes the user's settings rows. A dev-only config file can stay |
| `config/starter.ts` | Writes a commented starter config.toml | removed (hosted settings have defaults; dev uses `.env.example`) |
| `config/defaults.ts` | Compiled-in defaults, including hours in America/New_York and the Monday AM Internal standing block | core: neutral per-user defaults (sections 5, 6) |
| `config/schema.ts` | Parses config.toml; `[edge]`, `[chromium]`, `DEFAULT_FALLBACK_COMMAND = ["omarchy-launch-browser"]`, `[secrets]` expiry dates, `[ui]` | core: split into app settings (environment) and per-user settings (validated JSON per section); `[edge]` and `[chromium]` removed |
| `config/settings.ts` | The text edit for each Settings section, including the client's browser and Chromium command | core: per-user settings writes; browser and profile fields removed |
| `cache/snapshots.ts` | Last good snapshot per source and week under `~/.cache/focustime/<source>` (files) | host/azure: a `source_snapshots` table keyed by user (or a shared cache only for data that is the same for everyone, none today) |
| `cache/photos.ts` | Profile photo cache in `~/.cache/focustime/photos`, hashed names, 7 days | host/azure: a `photo_cache` table (blob column, 7 days, shared across users since photos are the same for every viewer), or no cache at all and 7-day HTTP caching in the browser |
| `sources/dataverse/source.ts` | `getSecret("dataverse-client-secret")`, snapshot cacheDir | core: secret from Key Vault through the host; cache through the snapshot store |
| `sources/graph/source.ts`, `sources/google/source.ts`, `sources/calendar/source.ts` | OAuth with `openBrowser`, keyring refresh tokens, cacheDir snapshots | core: tokens from the user's session and token store; no `openBrowser` (the web redirect does it) |
| `sources/devops/source.ts` | Per-client work item snapshots in cacheDir | core: snapshot store keyed by user and client |
| `sources/oauth/oauth.ts` | Authorization code + PKCE over a one-shot loopback listener (`http.createServer` on 127.0.0.1 or localhost), `openBrowser` | host/azure: web auth code flow with a confidential client (Microsoft) and a web client (Google), with the redirect handled by the app's own route. The loopback listener is removed (host/local keeps the same web routes on localhost:5317) |
| `store/plan-store.ts` | SQLite file under `~/.local/share/focustime/` (node:sqlite), backups beside it (`plan.db.bak-*`), exports in `exports/` | core interface, two implementations: SQLite (A2, dev and tests) and Azure SQL (A3). Backups by Azure SQL's point-in-time restore; export as a download (section 3) |
| `server/main.ts` | Process wiring: XDG paths, `xdg-open` for sign-in, `chromium --app` window, `notify-send` reminders, the 30-second reminder tick and 5-second timer tick in memory, `reopenWindow` (spawns `~/.local/bin/focustime-open`), `$XDG_RUNTIME_DIR/focustime/launch.json`, the launch token, the rename | split: host/local `dev.ts` (no windows, no notify-send), host/azure `server.ts` (section 11). Ticks become a scheduler on database rows |
| `server/app.ts` | HTTP server: `/api/action`, static UI, `/api/reopen`, `/api/open-request`, the launch token page "Super + Alt + C" | host/azure: the same routes behind the Entra session; reopen, open-request and the launch token page removed |
| `server/guard.ts` | Launch token cookie `focustime_<port>`, Host/Origin checks for 127.0.0.1 | host/azure: session cookie (`__Host-` prefix, Secure, HttpOnly, SameSite=Lax), CSRF token, Host and Origin against the configured hostname (section 11) |
| `server/open-request.ts` | One-shot request file from `focustime-open --capture` | removed (capture is a URL: `/#/today?capture`, or a PWA shortcut later) |
| `server/notify.ts` | `notify-send` with actions and `gdbus CloseNotification`; reminder checks | host/azure: the in-app notification center (section 10); reminder checks move to the scheduler |
| `actions/notifier.ts` | The one notifier (gate, once per key, held during focus, click routing); in-memory `shown` map and `facts` | core: kept; the host shows notices in-app; `shown` becomes rows (section 10) |
| `server/timer.ts` | Focus timer tick, `pw-play` end sound | core rules kept; the end sound plays in the browser (Web Audio already exists in `ui/sound.ts`); the server-side tick becomes a due-time row (section 11) |
| `server/media.ts` | `playerctl` pause and resume, `xdg-open` playlist links, detection | removed (host media control); playlist links open in a browser tab |
| `actions/timer-actions.ts`, `actions/types.ts`, `actions/registry.ts` (`media.status`, `secret.set`, `data.export`), `plan/focussound.ts`, `ui/FocusScreen.tsx`, `ui/Settings.tsx` (media section, client browser and profile) | Media control interface, "playerctl isn't installed" copy, keyring wording | core: `pauseMedia`, `media.status` and their copy removed; `secret.set` becomes an admin-only app setting or goes (app secrets live in Key Vault) |
| `server/host.ts`, `links/edge.ts`, `actions/settings-actions.ts` (browser detection) | Finds Edge and Chromium and their profiles on disk, builds the launch argv, opens a client's link in its Edge profile | removed. Links are plain `<a target="_blank" rel="noopener">`. A per-client "open in" note can come later if needed |
| `actions/dispatch.ts` | Builds ActionContext from config, keyring, host browsers, media, photo cache, notifier | core: ActionContext built per request from the session (user id, user settings, token store, scoped plan store) |
| `actions/photo-actions.ts`, `actions/settings-actions.ts` (export path, keyring states) | Writes the photo cache; export to `exports/plan-<stamp>.json` | core: export as a download response; keyring states become "set / not set" from the user's secret rows |
| `server/demo.ts` | Demo mode: in-memory config and store, a `demo-mode` flag file in the data folder | core + host/azure: demo is a sign-in option with an in-memory store per session (section 11) |
| `system/focustime-open`, `system/focustime.service`, `system/FocusTime.desktop`, `system/focustime-autostart.desktop`, `system/install.sh`, `system/install-icons.sh` | Launcher (`omarchy-launch-webapp`, `omarchy-launch-or-focus`), systemd user service with `/home/tanner` paths, desktop entries, hicolor icons | removed once prod is live (A5). The local service is uninstalled by hand (plan, A5) |
| `scripts/open-window.ts`, `scripts/screenshot.mjs`, `scripts/screenshot-step14.mjs`, `scripts/screenshot-step145.mjs`, `scripts/screenshot-step15.mjs`, `scripts/screenshot-step151.mjs`, `scripts/screenshot-step152.mjs`, `scripts/screenshot-step153.mjs`, `scripts/screenshot-step154.mjs`, `scripts/screenshot-step155.mjs`, `scripts/screenshot-step16.mjs`, `scripts/screenshot-step162.mjs`, `scripts/screenshot-step163.mjs`, `scripts/screenshot-step164.mjs`, `scripts/screenshot-step17.mjs`, `scripts/demo-walkthrough.mjs`, `scripts/footage-demo.mjs`, `scripts/notify-sample.mjs`, `scripts/edge-profiles.ts`, `scripts/plan-export.ts` | Developer tools that read `$XDG_RUNTIME_DIR/focustime/launch.json`, launch `chromium`, call notify-send, read Edge profiles | removed, except one screenshot script rewritten against a dev URL with a demo session |
| `e2e/harness.ts` | Spawns the server with temporary XDG folders and `--headless` | host/local: kept, with a temporary SQLite database and a fake session (A2) |

The `spawn(`/`exec(` pattern also matches `RegExp.exec` in `plan/*.ts`, `sources/azure/client.ts`, `store/plan-store.ts` and the test fakes. Those aren't processes. The narrower pattern in section 13 counts only `node:child_process` users.

## 2. Identity assumptions (one user today)

| Where | The single-user assumption | Per-user replacement |
|---|---|---|
| `config/schema.ts` `[dataverse] my_email`, `my_systemuserid`; `actions/dispatch.ts` (9 uses), `actions/account.ts` `withMe`, `actions/settings-actions.ts`, `actions/collab-actions.ts`, `actions/followup-actions.ts`, `server/main.ts`, `sources/dataverse/source.ts`, `sources/dataverse/normalize.ts` | "Me" comes from config, then from the sign-in | `users` row from the Entra session (oid, tid, UPN, mail); the Dataverse systemuser id is resolved per user and kept on that row (section 8) |
| `actions/account.ts` `IDENTITY_KEY = "ms_identity"` in `account_state` | One stored identity; "a different person starts without a Dataverse user" | Removed: the session is the identity; `users` holds name, email, oid, tid, systemuser id |
| `actions/vm-actions.ts` (`vmKey`, shutdown keys in `account_state`, in-memory `previews`, `transitions`, `memo`, `following`) | One confirmed VM | `user_vms` (user id, resource id, name, confirmed at); previews and transitions in `pending_writes`; memos per user, or none |
| `store/plan-store.ts` `devops_identities` (key `client_key`); reads in `actions/devops-write-actions.ts` (116, 141, 177), `actions/dispatch.ts` (438, 950), `actions/settings-actions.ts` (79), `store/plan-store.ts` (1066–1076, export at 1831) | One DevOps identity per client | Key (user id, client key); every read through the user-scoped store |
| `sources/oauth/oauth.ts` `refreshAccount: "outlook-refresh-token"` / `"google-refresh-token"`, `server/main.ts` `keyring` | One Microsoft and one Google account per machine | `user_tokens` (user id, provider, encrypted refresh token, scopes, updated at); access tokens in a per-user in-memory cache |
| `actions/timer-actions.ts`, `server/timer.ts`, `server/main.ts` (`TIMER_KEY = "timer"` in `kv`, the 5-second tick) | One focus timer, ticked in the server process | `focus_timers` row per user with `ends_at` and `warn_at`; a scheduler wakes on the earliest due row (section 11) |
| `actions/presence-actions.ts`, `server/main.ts` (`TEAMS_STATUS_KEY`) | One Teams status to keep and clear | Per user, in the user's `account_state`, cleared by the scheduler |
| `actions/notifier.ts` (`HELD_KEY = "notify_held"`, `shown` map, `facts`), `server/notify.ts`, `server/main.ts` (`markOnce` reminders, `pendingRoute`); other `markOnce` once-a-day flags in `actions/closeout-actions.ts`, `actions/plan-actions.ts`, `actions/roadmap-actions.ts`, `actions/vm-actions.ts`, `actions/dispatch.ts`, `plan/weekplan.ts` | One notification stream, one desktop | `notifications` rows per user; once-keys as `markers` with user id; click routing is a link in the notice |
| `actions/outlook-sync.ts` `memo` (by week), `actions/photo-actions.ts` `inFlight`, `server/main.ts` source maps (`sources`, `calendars`, `devopsSources`, keyed by config) | Caches keyed without a user | Keys include the user id (or tokens), or the caches are per request |
| `cache/snapshots.ts`, `cache/photos.ts` | One cache folder | Section 1 |
| `sources/demo/azure.ts` `DEMO_PERSON` (Alex Rivera, you@example.com), `vm-demo-alex` | One demo person | Kept as fictional demo data; each demo session gets its own in-memory store |
| `server/demo.ts`, the `demo-mode` flag file | Demo on or off for the whole machine | Demo is per session (a sign-in choice), never mixed with a real user's data |
| `actions/timebox-actions.ts`, `actions/devops-write-actions.ts` in-memory `previews` / `held` | Preview then confirm in the same process | `pending_writes` (user id, preview id, payload, expires at), so confirm works after a restart or on another replica |

## 3. Data

### Tables and the scoping each needs

The final schema, read from a store created by the migrations (31 tables). An asterisk marks a primary key column. "Statements" is the number of SQL statements in `store/plan-store.ts` that name the table. In total there are 217 `db.prepare` calls, and every one sits inside a `PlanStore` method.

| Table | Columns | Statements | Per-user scoping |
|---|---|---|---|
| account_state | key*, value, updated_at | 3 | (user_id, key) |
| azure_write_log | id*, at, op, vm_id, vm_name, before, after, status, message, auto, attempts, updated_at | 5 | user_id + index (user_id, at) |
| borrowed | id*, pick_id, from_pick_id, client_key, title, date, minutes, payback, payback_date, payback_half, created_at, paid_at, paid_by | 9 | user_id |
| breakdown_marks | client_key*, item_id*, marked_at | 3 | (user_id, client_key, item_id) |
| captures | id*, text, client_key, created_at, routed_at, routed_as, routed_id | 11 | user_id + index (user_id, routed_at) |
| day_plans | date*, committed_at, created_at, updated_at, closed_out_at | 5 | (user_id, date) |
| dedupe_log | id*, at, table_name, removed_id, kept_id, week_start, client_key, item_id | 4 | user_id |
| delivery_snapshots | client_key*, item_id*, date*, done, open | 3 | (user_id, client_key, item_id, date); counts are per owner, so not shared |
| devops_identities | client_key*, org, identity_id, name, email, validated_at, expires | 4 | (user_id, client_key) |
| devops_write_log | id*, at, client_key, org, project, op, item_id, parent_id, title, identity, before, after, ops, rev_before, rev_after, comment_id, draft_id, pick_ids, follow_up_id, status, message, undo_of, undone_by, attempts, updated_at | 6 | user_id + index (user_id, at) |
| draft_stories | id*, client_key, parent_item_id, title, size, created_at, updated_at, level, devops_id, devops_url, description, acceptance, start_date, target_date | 21 | user_id |
| flex_sessions | id*, date, client_key, start_at, end_at, item_id, item_title, item_url, note, created_at, updated_at | 7 | user_id + index (user_id, date) |
| focus_log | id*, pick_id, label, started_at, ended_at, seconds | 2 | user_id |
| follow_ups | id*, kind, client_key, what, channel, due, … origin | 28 | user_id + index (user_id, closed_at, due) |
| invites | id*, uid, client_key, … follow_up_id, created_at, updated_at | 5 | user_id; uid stays globally unique |
| kv | key*, value, updated_at | 3 | (user_id, key) |
| markers | kind*, date*, at | 3 | (user_id, kind, date) |
| outlook_events | uid*, timebox_id, event_id, fields, created_at, updated_at, deleted_at | 6 | user_id; uid stays globally unique (it is the Outlook marker value) |
| picks | id*, date, half, client_key, kind, item_id, draft_id, … follow_up_id | 27 | user_id + index (user_id, date) |
| resume_notes | id*, client_key, date, note, created_at, updated_at | 8 | user_id |
| roadmap_dates | client_key*, item_id*, start_date, end_date, updated_at | 3 | (user_id, client_key, item_id) |
| schema_migrations | version*, applied_at | 2 | none (app-level) |
| teams_status_log | id*, at, op, status, minutes, result, message | 4 | user_id |
| timeboxes | id*, uid, date, client_key, pick_id, … conflict | 7 | user_id + index (user_id, date) |
| unavailable | id*, date, title, start_at, end_at, note, created_at, updated_at | 6 | user_id |
| week_drafts | week_start*, draft_id*, tier, created_at | 4 | via draft (user_id added for direct queries) |
| week_feature_slots | feature_id*, date*, half* | 5 | via week_features (user_id added for direct queries) |
| week_features | id*, week_start, client_key, item_id, … updated_at | 33 | user_id + index (user_id, week_start) |
| week_plans | week_start*, committed_at, created_at, updated_at | 4 | (user_id, week_start) |
| week_quiet | week_start*, client_key*, marked_at | 4 | (user_id, week_start, client_key) |
| write_log | id*, at, system, op, kind, uid, event_id, … updated_at | 7 | user_id + index (user_id, at) |

New app-level tables:

| Table | Purpose |
|---|---|
| `users` | id, entra oid, tid, UPN, mail, display name, time zone, Dataverse systemuser id and the email it was matched by, created, last seen, deleted |
| `user_settings` | user id, section, JSON, updated at. Replaces each user's config.toml sections (hours, standing blocks, clients, plan, focus, notify, roadmap, ui, timebox, collab, azure, secrets expiry dates) |
| `user_tokens` | user id, provider (microsoft, google), encrypted refresh token, scopes, updated at |
| `user_secrets` | user id, name (`devops-write-pat:<client>`), ciphertext, key version, expires, updated at |
| `sessions` | id (hash of the cookie value), user id, created, last seen, expires, CSRF secret, demo flag |
| `pending_writes` | user id, preview id, kind, payload, expires at |
| `notifications` | user id, kind, key, title, body, route, created, read, closed |
| `focus_timers` | user id, state JSON, ends at, warn at |
| `schedule` | user id, kind (reminder or timer), due at, key. Lets the scheduler find the next due row with one indexed query |
| `source_snapshots`, `photo_cache` | Section 1 |
| `deletions` | Hashed oid and the time of each account deletion, with no content |

### Queries and the user filter

- **Every statement takes the user id.** All 217 statements live in `createPlanStore`, so the store becomes `createPlanStore({ db, userId })`. Each statement binds `user_id = ?` or inserts it. The UI never filters, and actions never see another user's store.
- **Row-level check in the store layer.** Every update or delete by id adds `AND user_id = ?` and checks that it changed rows, so an id from another user is "not found". Joins between plan tables join on user_id too.
- **Test.** A store test seeds two users and calls every public method as user B against user A's ids; nothing reads or changes A's rows.
- **Azure SQL row-level security** (a security policy on `SESSION_CONTEXT('user_id')`) is an optional second guard in A3, not a replacement for the store check.

### Migrations, backups, export and import

- **Migrations.** Today there are 22 numbered SQLite migrations, and the store copies itself to `plan.db.bak-v<from>-<stamp>` before each one. Azure SQL gets a fresh baseline schema (A3) with its own numbered migrations run at deploy time, before the new revision takes traffic. SQLite stays for dev and tests until A3 ends, through the same store interface.
- **Backups.** Azure SQL keeps automatic backups with point-in-time restore. "Reset local plan" makes a JSON export first, then deletes the user's rows.
- **Export.** Today `exportJson()` writes `exports/plan-<stamp>.json`. Hosted, Settings > Data downloads the same JSON for the signed-in user only.
- **Import.** There is none today. A5 adds a one-time import for the owner's local store into prod: it reads an export file and writes it with the owner's user id.

### What the audit logs hold

- **`write_log` (Outlook).** Before and after fields: subject, body, start and end, show as, attendees for help invites. Also local before and after.
- **`devops_write_log`.** Item ids, titles, the comment text, the identity email, the patch ops, revisions and the undo chain.
- **`azure_write_log`.** VM id and name, schedule before and after.
- **`teams_status_log`.** Op, status and minutes.

All four are personal and client data. They stay per user, are included in the export and fall under retention.

### Retention and delete

- **Retention: two years.** A daily job deletes the user's rows older than 730 days, judged by each table's date column: `day_plans.date`, `picks.date`, `follow_ups.closed_at` (open ones are kept), `captures.routed_at`, the logs' `at`, and `week_*` by `week_start`. Settings shows the rule.
- **Delete my data** (Settings > Data):
  1. Offer the export first.
  2. In one transaction, delete every row with the user's id, their tokens and secrets, and their sessions.
  3. Write a `deletions` row (hashed oid, time), then sign them out.
- **What delete doesn't touch.** Outlook events, DevOps changes and the Azure schedule already written stay as they are. Settings says so before the user confirms.

## 4. Secrets

| Secret | Where it lives today | Owner in the hosted app | Rotation |
|---|---|---|---|
| Dataverse client secret ("Coopilot Dataverse Reader" registration) | keyring `dataverse-client-secret` | App: Key Vault secret, read by the app's managed identity | In Entra before expiry; new Key Vault version; app restart picks it up (expiry date in Settings becomes an admin alert) |
| Google OAuth client secret | keyring `google-client-secret` (desktop client) | App: Key Vault (new web client) | In Google Cloud console; new Key Vault version |
| Microsoft OAuth client secret | none today (public client, PKCE) | App: Key Vault `entra-client-secret` (written by `infra/scripts/app-registration.sh`) | `--rotate-secret`, then remove the old credential after restart |
| Microsoft refresh token | keyring `outlook-refresh-token` | Per user: `user_tokens`, encrypted with a data key wrapped by a Key Vault key (envelope encryption) | Rolled by every token refresh; deleted on sign-out or delete |
| Google refresh token | keyring `google-refresh-token` | Per user: `user_tokens`, as above | Rolled by Google; deleted on disconnect |
| DevOps write PAT per client | keyring `devops-write-pat:<client>` | Per user: `user_secrets`, envelope-encrypted, checked against the user's DevOps identity before saving (as today) | The user enters a new one before `expires`; the expiry line stays on Today |
| Company DevOps read PAT | Dataverse (read at fetch time, `devopsTargets`) | Unchanged: read from Dataverse by the app identity, wrapped in `Pat`, never stored | In Dataverse by its owner |
| Session secret / cookie | Launch token per run (in memory) and cookie `focustime_<port>` | App: random session ids stored hashed in `sessions`; a cookie-signing key in Key Vault | Key Vault version with an overlap window |
| Data encryption key (new) | none | App: a Key Vault key (RSA or AES via wrap/unwrap) that wraps per-row data keys | Key Vault key rotation; rows re-wrapped lazily on read |
| Access tokens (Graph, ARM, Google, Dataverse) | memory only | memory only, per user, never stored | Short-lived |

**Nothing logs or returns secrets today:**

- **The logger.** `log/logger.ts` has a closed set of fields: `source`, `op`, `status`, `durationMs`, `count` and `kind`, with no field for headers, bodies or values.
- **Every `log({…})` call.** There are 61 calls that set `kind:`. All 16 whose `kind` isn't a literal string were checked: Dataverse error codes, HTTP error class names, the guard's reason, notification route prefixes, folder names and the keyring account names logged by R1. None can carry a token or a value.
- **Other output.** The only `console.*` and `stdout` writes are in `server/main.ts`: the port in use, and "running on 127.0.0.1:<port>", which prints the launch file's path, not the token.
- **What `secrets/keyring.ts` exposes.** It returns a value only to its callers, and write PATs only wrapped in `Pat` (prints as `[PAT]`). Settings sees only set, missing or locked, never a value.

## 5. Owner-specific and Omarchy-specific content

| Where | What | Replacement |
|---|---|---|
| `system/*` (6 files) | `/home/tanner` paths, `omarchy-launch-webapp`, `omarchy-launch-or-focus`, the mise node path, desktop entries | removed (A5) |
| `config/schema.ts` `DEFAULT_FALLBACK_COMMAND = ["omarchy-launch-browser"]`, `[edge]`, `[chromium]` | Owner's browser launcher | removed with `links/edge.ts` and `server/host.ts` |
| `config/defaults.ts` | Monday AM Internal standing block; hours 09:00–17:00, lunch 12:30, America/New_York | per-user settings: no standing block by default; hours from the user's Outlook working hours and time zone (section 6), else 9:00–5:00 in their zone |
| `server/app.ts` (launch token page), `ui/Reopen.tsx` | "Super + Alt + C", "focustime-open" | removed (sessions replace the launch token) |
| `ui/styles.css` comment | "never taken from the Omarchy theme" | reword |
| `ui/Settings.tsx`, `ui/FocusScreen.tsx`, `plan/focussound.ts` | playerctl copy, Edge profile and browser per client | removed |
| Tests: `actions/link-actions.test.ts`, `config/config.test.ts`, `config/edit.test.ts`, `links/edge.test.ts`, `actions/ui-actions.test.ts`, `e2e/vm.test.ts` | `omarchy-launch-browser`, `uwsm-app`, `/usr/bin/microsoft-edge-stable`, Edge "Profile 3", the theme name "omarchy", "Super + Alt + C" | removed with their features, or fictional values |
| Tests and fixtures with `@cooptimize.org` addresses (ana@, ben@, cy@, avery@) and the client key "T&S", DevOps project "WC Project" under org `cooptimize` | Could be real people, a real client or a real project | replace with `@cooptimize.example`, a fictional client and project (A1); Q2 asks for the list to grep |
| `sources/demo/*` | Fictional: Alex Rivera, Northwind, Harbor, Atlas, Cooptimize (demo org `cooptimize-demo`), vm-demo-alex | keep (demo data) |
| `CLAUDE.md`, `docs/spec.md` (15 lines with the owner's name), `docs/decisions.md` (6), `docs/roadmap.md` (6), `docs/open-questions.md`, `docs/design/style-guide.md`, `docs/ux/U1/designer-prompt.md`, `docs/ux/U2/mockups/README.md`, `docs/ux/R1/report.md` | The owner's name, Omarchy, Hyprland and `bindings.lua`, Remmina, Moonlight, `/home/tanner`, Super + Alt keys, the local service, keyring and launcher | rewrite to role words ("the user", "the developer") and the hosted product (A1 for product docs, A5 for history and these Azure docs). Q3 asks whether the decision log is rewritten or archived |
| `docs/ux/R1/notification.png` | A desktop notification on the owner's desktop | removed |
| `docs/demo/*.png`, `docs/ux/*/screens` | Browser screenshots from demo mode; they show the VM chip, Settings > Connections (keyring wording) and the Focus screen's media line | retaken after A1 where they show removed features |
| Root folder: `coopilot-shots-3.zip` (untracked), `.gitignore` entries `coopilot-kickoff*`, `coopilot-footage*` | Local leftovers | removed in A1 (`.gitignore` lines); the zip stays untracked |

## 6. Time zones

**Today: one zone for everything.**

- **The zone itself.** `[hours] time_zone` (`cfg.week.hours.timeZone`) is read in about 120 places, most in `actions/dispatch.ts` (32), `ui/App.tsx` (8), `week/risks.ts`, `ui/StatusBar.tsx` and `server/main.ts`.
- **Fallbacks.** `server/main.ts` has `let timeZone = "America/New_York"`, `actions/timer-actions.ts` defaults to the same, and Settings shows a free-text "Like America/New_York".
- **The server.** It knows one zone, so the 30-second reminder tick, the "today" of reminders and `localToday` all use it.

**Per-user design:**

- **Where the zone comes from.** `users.time_zone`, set at first sign-in from Graph `GET /me/mailboxSettings` (`timeZone`, a Windows name such as "Central Standard Time", mapped to IANA by `plan/timezones.ts`, which the VM schedule already uses). The fallback is `"UTC"` with a Settings prompt. `workingHours` from the same call seeds the user's hours.
- **Editing it.** In Settings > Working hours: a dropdown of IANA zones grouped with US zones first, never free text.
- **Every rule takes the user's zone.** The time model already carries `timeZone`: slots, half-days, PTO days, Plan the day's target day, Check-in and Close out times, reminders, quiet hours, the week's Monday, and the retention cutoff. ActionContext gets the zone from the user's settings, so no code reads a process-wide zone.
- **The scheduler.** It stores due times as UTC instants computed in each user's zone, so a 9:00 reminder is 9:00 for each person.
- **Teammates' free/busy** is already zone-aware: `getSchedule` with explicit UTC ranges, and working hours with their own zone in `plan/collab.ts`. Unchanged.
- **Tests.** One run of the week and reminder tests per zone: Eastern, Central, Mountain, Pacific, plus a DST week.

## 7. Entra and Google

### Microsoft scopes used today (from `sources/oauth/oauth.ts`)

| Kind | Scopes | Admin consent |
|---|---|---|
| Sign-in (`id`) | `openid profile email offline_access` + Graph `Calendars.ReadBasic` | No |
| Calendar writes (`writeScope`) | Graph `Calendars.ReadWrite` (Coopilot events, own events, invites, RSVP) | No |
| Azure (`arm`) | Azure Service Management `user_impersonation` | No (limited by the user's Azure RBAC) |
| Teams presence (`presence`) | Graph `Presence.ReadWrite`, `Presence.Read.All` | No (code comment: delegated, no admin consent) |
| Photos (`photo`) | Graph `ProfilePhoto.Read.All` | Yes |
| Used through those | `/me/calendarView`, `/me/events`, `/me/calendar/getSchedule`, `/me/presence`, `/users/{id}/presence/setUserPreferredPresence`, `clearUserPreferredPresence`, `/communications/getPresencesByUserId`, `/me/photos/96x96`, `/users/{oid}/photos/96x96`; ARM: Resource Graph `resources` query, `Microsoft.Compute/virtualMachines` start and deallocate, `Microsoft.DevTestLab/schedules/shutdown-*` | |
| Dataverse | App-only, client credentials, `<environment>/.default` on the "Coopilot Dataverse Reader" registration | Granted (application user and role) |

**The hosted registration "FocusTime" requests:**

- **Graph:** `openid profile email offline_access User.Read Calendars.ReadWrite MailboxSettings.Read Presence.ReadWrite Presence.Read.All ProfilePhoto.Read.All`. `User.Read` and `MailboxSettings.Read` are new, for the profile and the time zone.
- **ARM:** `user_impersonation`.
- **Consent:** admin consent is granted once for the tenant, so no Cooptimizer sees a consent prompt.

### Registrations compared

| | "Coopilot Desktop" (today) | "FocusTime" (hosted) |
|---|---|---|
| Client type | Public client, PKCE | Confidential web client, auth code flow (PKCE kept as well), client secret in Key Vault |
| Platform | Mobile and desktop, `http://localhost` loopback, any port | Web: `https://<dev app>.centralus.azurecontainerapps.io/auth/microsoft/callback`, `https://<prod app>…/auth/microsoft/callback`, `http://localhost:5317/auth/microsoft/callback` (later `https://focustime.cooptimize.org/…`) |
| Implicit flow | off | off |
| Audience | single tenant | single tenant (cooptimize.org) |
| Consent | each user, scope by scope, as needed | admin consent once for the tenant |
| Tokens | refresh token in the keyring; access in memory | refresh token encrypted in `user_tokens`; access in memory; the ID token is validated (issuer, audience, nonce) at sign-in, then the session cookie is the login |
| Script | by hand (Oct 31) | `infra/scripts/app-registration.sh`, run in A4 |

"Coopilot Desktop" stays for the developer loop until A5 and is then deleted. Q97 in `docs/open-questions.md` covered renaming it; that question is now moot.

### Google

- **OAuth client.** A web OAuth client in Google Cloud, with redirect URIs `https://<dev>/auth/google/callback`, `https://<prod>/auth/google/callback` and `http://localhost:5317/auth/google/callback`. This replaces the desktop client and the 127.0.0.1 loopback.
- **Scope.** The same `calendar.events.readonly`.
- **Consent and tokens.** Each user consents with their own Google account (`access_type=offline`, `prompt=consent`). The refresh token goes in `user_tokens`.
- **Optional per user.** Settings > Connections has "Connect Google Calendar" and "Disconnect".
- **Publishing.** The consent screen needs "In production" status, or every user added as a test user. A restricted calendar scope may need Google verification (Q6).

## 8. Dataverse

- **Unchanged.** The application user "Coopilot Dataverse Reader" and its role are reused as they are: client credentials from the app, secret in Key Vault.
- **Per-user filters.** Today's filters, already parameterized by the systemuser id (`sources/dataverse/source.ts`):
  - **Focus Time:** `_coop_systemuser_value eq <me> or coop_AccountWorker/_coop_user_value eq <me>` (line 251), and the schema probe `_coop_systemuser_value eq <me>`.
  - **Account Workers:** `_coop_user_value eq <me> and statecode eq 0` (lines 357, 421), giving the user's clients and `coop_devopsemail` per client.
  - **Time off:** `_coop_employee_value eq <me> and statecode eq 0 and coop_timeoffstartdate le <end> and (coop_enddate eq null or coop_enddate ge <start>)` (line 476), then detail rows by tracker id.
  - **Teammates:** all licensed, enabled systemusers with an email (line 566). Shared across users; it can be cached app-wide.
- **Matching a user (email-first, as today).**
  1. `systemusers?$filter=internalemailaddress eq '<email>'` (line 531), first with the signed-in user's `mail`.
  2. If that misses, with their UPN.
  3. If both miss, with `azureactivedirectoryobjectid eq <oid>`. This step is new, and the most reliable.

  The match and the address it used are kept on `users`. "Not found in Dataverse" is a plain message with what to ask an admin, not a broken week.
- **Not shared across users.** Per-user Dataverse results (focus blocks, PTO, clients) are cached per user only. The app identity can read everyone's rows, so the user filter is the guard. The store-layer rule applies here too: the systemuser id comes from the session's `users` row, never from input.

## 9. DevOps

- **Unchanged.** The company read PAT is still read from Dataverse at fetch time (`devopsTargets`, `{ withPat: false }` on the write path), wrapped in `Pat`, never stored. Work item reads are per user ("assigned to me" by the user's DevOps email from Account Workers).
- **Write PAT.** The per-user write PAT moves from the keyring to `user_secrets`, entered in Settings > Clients, checked against the user's DevOps identity before saving, as today. Without one, a client stays read-only with "Enable DevOps writes".
- **Identity map.** It becomes per user: `devops_identities` keyed by (user_id, client_key). It is read in:
  - `actions/devops-write-actions.ts:116` (write context);
  - `:141` (after saving a PAT);
  - `:177` (`devops.write_status`);
  - `actions/dispatch.ts:438` (which clients can write);
  - `:950` (expiry lines);
  - `actions/settings-actions.ts:79` (Settings > Clients);
  - `store/plan-store.ts:1066–1076` (get, list, save, delete);
  - `:1831` (export);
  - and R1's `server/rename.ts` (removed).

## 10. Notifications

Kinds (`plan/notify.ts` `NOTIFY_KINDS`), all shown today by `notify-send` with an Open action and closed by `gdbus` when they no longer apply:

| Kind | Today | Hosted (first) | Later options |
|---|---|---|---|
| plan_day | Morning, today not planned | In-app center item + a dot on Today › Plan | Teams activity feed |
| checkin | Midday Check-in | In-app | Teams activity feed |
| closeout | End of day Close out | In-app | Teams activity feed |
| plan_week | Week nudges | In-app | Teams activity feed |
| look_ahead, plan_ahead | Look ahead 4 weeks (every other Thursday) | In-app | |
| direction | Monthly direction review | In-app | |
| timer | Focus end and the 5-minute warning | In-app with sound in the open tab; the title shows the countdown | Web Push (works with the tab closed) |
| meeting | Meeting warnings while a timer runs | In-app | Web Push |
| vm | The VM morning prompt and a failed restore | In-app | Teams activity feed |
| followups | Follow-ups due | In-app | Teams activity feed |
| expiry | Expiring secrets (PATs) | In-app | email later |
| test, held | Settings test; "While you were focused" | In-app | |

**Rules per user:**

- **Unchanged:** the switch per kind, quiet outside the user's working hours and on their PTO days, held during their focus and collapsed after, once per key, and closed once what it asked for is done (Q91).
- **The hosted center:** a bell in the top bar with unread count, plus `notifications` rows. `actions/notifier.ts` stays the one path, and the host only stores and shows.
- **Teams activity feed** needs the application permission `TeamsActivity.Send` and a Teams app manifest (Q7).
- **Web Push** needs a VAPID key in Key Vault and a service worker.

## 11. Hosting

### Container and server

- **Dockerfile (multi-stage).**
  - *Build stage* on `node:26-slim`: `npm ci`, `vite build`, prune dev dependencies.
  - *Run stage* on `node:26-slim` as a non-root user, with the server source, `dist/` and production `node_modules`.
  - `node server/azure.ts` listens on `0.0.0.0:8080`, and `PORT` comes from the environment.
  - No secrets in the image. App settings come from environment variables and Key Vault references, read through the managed identity.
  - Node runs TypeScript directly today, with no compile step to add. A3 must pick a SQL driver (`mssql`/`tedious`), which is a new dependency to ask for (Q8).
- **Health.** `GET /healthz` is liveness (process up, no I/O). `GET /readyz` is readiness: the database answers `SELECT 1` with a short timeout, and is reported as "waking" while Azure SQL resumes. Container Apps probes use both.
- **Graceful shutdown.** On SIGTERM:
  1. Stop taking requests (readiness fails).
  2. Finish in-flight actions, up to 20 seconds.
  3. Release the scheduler lease.
  4. Close the database pool and exit.

  Today `stop()` only removes the launch file and closes the store.

### In-memory state that moves

| In memory today | Where it goes |
|---|---|
| Focus timer tick (5 s) and the timer state's in-process deadline (`server/timer.ts`; the state itself is already in `kv`) | `focus_timers` + `schedule` rows; one replica holds a lease row and wakes at the earliest due time (and at most every 30 s); the browser counts down from `ends_at` |
| Reminder tick (30 s), `markOnce` keys | `schedule` rows per user, computed in the user's zone; `markers` per user |
| `pendingRoute` (notification click route) | removed: the in-app notice carries its route |
| Open request file, `reopenWindow` | removed |
| Launch token and cookie | `sessions` (section 11, sessions) |
| Presence sync loop (every 5 s while a timer runs) | the scheduler on the user's timer row; `teams_status` per user |
| Previews: `timebox-actions.ts`, `devops-write-actions.ts` (`held`), `vm-actions.ts` (`previews`, `transitions`, `following`) | `pending_writes` with expiry; VM transitions polled by the scheduler from a row |
| `actions/notifier.ts` `shown`, `facts` | `notifications` rows; facts recomputed per user |
| Source maps, `outlook-sync.ts` memo, `vm-actions.ts` memo, `photo-actions.ts` `inFlight` | per-user caches keyed by user id; losing them only costs a re-read |
| OAuth access tokens | per-user memory cache; refresh tokens in `user_tokens` |
| `pickableTypes`, `openStates` | per-user settings |

With these in rows, a restart or a second replica loses nothing: a timer that ended while the container was down fires on the next scheduler pass, and a preview can be confirmed after a restart until it expires.

### Sessions and request security

- **Sign-in.** Entra OIDC, auth code flow with PKCE and nonce. On callback, the server validates the ID token, finds or creates the `users` row, stores the refresh token encrypted, and creates a session.
- **Session cookie.** A random 256-bit id, stored hashed, with a 12-hour idle timeout and a 7-day absolute limit. The cookie is `__Host-focustime`, Secure, HttpOnly, SameSite=Lax and Path=/.
- **Sign-out.** Deletes the session row; "Sign out everywhere" deletes all of the user's sessions.
- **CSRF.** A per-session token in a header (`X-CSRF`) on every POST, checked together with Origin. `/api/action` stays POST-only.
- **Host and Origin.** Checked against the configured public hostnames (dev, prod, later the custom domain), replacing today's 127.0.0.1 check (`server/guard.ts`).
- **Security headers.**
  - `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;
  - HSTS;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: same-origin`;
  - `Permissions-Policy` limited.
- **Rate limits.** Per session on sign-in and write actions.
- **Demo mode.** "Try the demo" on the sign-in page creates a demo session with an in-memory store seeded with the fictional data, no external calls (as today) and a 2-hour expiry. It is never mixed with a real user's data.

## 12. Cost (Central US, checked Nov 2, 2026)

**Sources:**

- **Unit prices:** the Azure Retail Prices API, `https://prices.azure.com/api/retail/prices`, filtered to `armRegionName eq 'centralus'`, Consumption.
- **Free grants and billing rules:** the pricing pages below, read the same day.
  - https://azure.microsoft.com/en-us/pricing/details/container-apps/
  - https://azure.microsoft.com/en-us/pricing/details/azure-sql-database/single/
  - https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer
  - https://learn.microsoft.com/en-us/azure/azure-sql/database/serverless-tier-auto-pause-resume
  - https://azure.microsoft.com/en-us/pricing/details/key-vault/
  - https://azure.microsoft.com/en-us/pricing/details/container-registry/
  - https://azure.microsoft.com/en-us/pricing/details/monitor/

  The pages' own price cells didn't render ("$-"), so every dollar figure comes from the API.

**Unit prices:**

| Service | Unit prices | Free or included |
|---|---|---|
| Container Apps, Consumption | vCPU $0.000024/s active, $0.000003/s idle; memory $0.000003/GiB-s (active and idle); requests $0.40 per million | 180,000 vCPU-s, 360,000 GiB-s and 2M requests per subscription per month; nothing charged while scaled to zero |
| Azure SQL serverless, General Purpose Gen5 | compute $0.62611 per vCore-hour (billed per second; at least the minimum vCores while online); storage $0.138 per GB-month on the configured max size | backup storage up to the max data size included. Free offer: 100,000 vCore-s, 32 GB data and 32 GB backup per database per month, up to 10 databases per subscription; at the limit it either pauses until next month or bills at serverless rates; fixed 15-minute auto-pause; no SLA |
| Key Vault Standard | $0.03 per 10,000 operations | no monthly fee |
| Container Registry Basic | $0.1666 per day | 10 GB storage included |
| Log Analytics (Analytics Logs; App Insights workspace-based) | $2.76 per GB ingested after the free 5 GB; retention $0.12 per GB-month beyond the free period | first 5 GB per billing account per month; 31 days retention (90 days for Application Insights data) free |

Assumptions:

- **Usage.** About 10 Cooptimizers eventually, the pilot first. One container app per environment at 0.5 vCPU and 1 GiB, scaling 0 to 1.
- **Active hours.** Prod is active about 10 hours a workday (220 hours a month); dev about 40 hours a month.
- **Database.** Prod is awake about 264 hours a month: the active hours plus the 60-minute auto-pause tail twice a day. 0.5 to 1 vCore, max size 32 GB.
- **Environment.** A Consumption-only environment, with no environment management charge. The API lists $0.10 per hour "Environment Management" and "Dedicated Plan Management" meters, which apply to Dedicated workload profiles. A4 checks this on the bill's first day.
- **Logs.** Under 1 GB a month per environment, kept 30 days.

| | Dev | Prod (low) | Prod (high) |
|---|---|---|---|
| Container Apps | $0 (inside the free grant) | $8.64: 792,000 active s at $0.000015/s, less the subscription's free 360,000 s (dev's 144,000 s share that grant, so this counts it all against prod) | $16.90: as low, plus a minimum of 1 replica idle the other 510 h at $0.0000045/s ($8.26), if reminders keep a replica up |
| Azure SQL compute | $0 on the free offer (100,000 vCore-s ≈ 55 h at 0.5 vCore; pauses until next month at the limit) | $82.65: 264 h × 0.5 vCore × $0.62611 | $165.30: 264 h at 1 vCore. If something keeps it awake all month: $228.53 at 0.5 vCore (730 h) |
| Azure SQL storage | $0 (free offer, 32 GB) | $4.42 (32 GB × $0.138) | $4.42 |
| Key Vault | about $0.05 | about $0.15 (50,000 operations) | about $0.15 |
| App Insights + Log Analytics | $0 (inside the shared free 5 GB) | $0 | $0 |
| Container Registry Basic (one, shared) | $5.06 a month (30.4 days × $0.1666), counted once | | |
| **Total per month** | **≈ $0.05 + the shared $5.06** | **≈ $95.86** | **≈ $186.77** |

**Overall, about $101 to $192 a month.** Azure SQL compute is about 85% of it.

- **Reducing it.** Putting prod on the SQL free offer with "continue with charges" would take off about $17 of compute and $4.42 of storage, but it has no SLA (Q5).
- **The cost risk.** The one thing that changes the bill is the scheduler: it must not touch the database every 30 seconds, or the database never pauses (risk 1 in the plan).

## 13. Completeness check

These patterns were run over `*.ts`, `*.tsx`, `*.mjs` and `*.sh` files plus `system/`, excluding `node_modules`, `dist`, `docs`, `*.test.ts` and the test fakes. The counts are files. Every file found is in section 1 (OS touches), section 2 (identity) or section 9 (DevOps identity map).

| Pattern | Files |
|---|---|
| `child_process\|spawn\(\|execFile\(` (processes) | 7: `secrets/keyring.ts`, `server/main.ts`, `server/media.ts`, `server/notify.ts`, `server/timer.ts`, `scripts/open-window.ts`, `e2e/harness.ts` |
| `secret-tool\|KEYRING_SERVICE\|getSecret\|setSecret\|getWritePat` | 5: `sources/dataverse/source.ts`, `actions/dispatch.ts`, `secrets/keyring.ts`, `secrets/keyring-rename.ts`, `server/main.ts` |
| `homedir\(\|XDG_[A-Z_]+\|\.local/share\|\.config/\|\.cache` | 41: the source, config, cache, store, server, links, system, e2e and scripts files in section 1 |
| `systemctl\|systemd` | 5: `scripts/open-window.ts`, `server/rename.ts`, `system/install.sh`, `system/focustime-open`, `system/focustime.service` |
| `notify-send\|notifySend\|gdbus\|CloseNotification` | 4: `actions/notifier.ts`, `server/notify.ts`, `server/main.ts`, `system/focustime-open` |
| `playerctl` | 9: `ui/FocusScreen.tsx`, `ui/Settings.tsx`, `actions/timer-actions.ts`, `actions/registry.ts`, `actions/types.ts`, `actions/dispatch.ts`, `server/media.ts`, `server/main.ts`, `plan/focussound.ts` |
| `msedge\|microsoft-edge\|chromium\|xdg-open\|openBrowser` | 33: `ui/Settings.tsx`, `sources/oauth/oauth.ts`, `sources/graph/source.ts`, `sources/google/source.ts`, `config/starter.ts`, `config/settings.ts`, `config/schema.ts`, `actions/timer-actions.ts`, `actions/settings-actions.ts`, `actions/types.ts`, `server/media.ts`, `server/host.ts`, `server/main.ts`, `links/edge.ts`, `e2e/harness.ts` and 18 files under `scripts/` |
| `hypr\|Hyprland\|omarchy\|Omarchy` | 3: `config/schema.ts`, `system/install.sh`, `system/focustime-open` |
| `createServer\|\.listen\(` | 4: `sources/oauth/oauth.ts`, `server/app.ts`, `server/main.ts`, `e2e/harness.ts` |
| `cookieName\|Set-Cookie\|setCookie` | 2: `server/guard.ts`, `server/app.ts` |
| `myEmail\|mySystemUserId\|IDENTITY_KEY\|TIMER_KEY\|TEAMS_STATUS_KEY\|devopsIdentit\|markOnce\|accountState` | 21 files, all listed in section 2 or 9 |

The machine check that produced these counts is in the A0 completion report. It searched this document for every file name and found none missing.
