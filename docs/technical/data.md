# Data

For engineers adding a table and IT checking what FocusTime keeps. Checked against `4088995` on Nov 7, 2026; SR-3's parts against `feat/report-finish` on Nov 8; DP-2's parts against `feat/deployment-items` on Nov 8; IB-2's against `feat/inbox-everything` on Nov 8.

## One database, two kinds of table

FocusTime keeps everything in one database, its plan store: Azure SQL in dev and prod, a SQL Server container in the developer loop, and SQLite only for the demo (in memory) and tests. The database comes from the app's config (`[database]` or `FOCUSTIME_DB_*`), never from a person. Schema changes go only through `store/sql/migrate.ts`, and migrations only add (tables, columns, indexes; `store/migrations/additive.test.ts`).

- **User tables** hold one person's rows. `user_id` (their Entra object id) is the first key column, and every statement on them goes through `store/scope.ts`, which adds the session's person; code never writes SQL that names `user_id`. The list is `USER_TABLES` in `store/scope.ts`.
- **App tables** belong to the app as a whole: sign-in, shared chat polling, the admin console, DevOps reads, team views. Who may read their rows is decided in their store module (for example the chat viewer rule in `store/conversation-store.ts`).

`store/isolation.test.ts` fails when a table is neither, or when a user table can leak between two people.

**Per client** below means the rows carry a client key, so views, AI requests and DevOps writes can keep one client's data to that client.

## Tables by area

### People, sign-in and settings

| Table | Kind | Per client | Holds |
|---|---|---|---|
| `users` | App | No | One row per person who signed in: Entra object id, tenant, UPN, name, email, time zone, deleted at |
| `sessions` | App | No | A hash of the session id only, its CSRF token, last seen, expiry |
| `auth_requests` | App | No | Short-lived sign-in state (PKCE and nonce) |
| `deletions` | App | No | Accounts waiting for their hard delete |
| `user_settings`, `setup_state`, `kv`, `account_state` | User | No | Settings rows, first-run progress, small per-person values, the signed-in identity (name, UPN, email, ids) |
| `user_secrets` | User | No | A person's refresh tokens and DevOps write PATs, sealed with the app data key |
| `push_devices` | User | No | Web Push subscriptions for "Notify this device" |
| `notices` | User | No | In-app notifications |
| `app_keys` | App | No | The app data key, wrapped by Key Vault's `ft-data-key` |

### The plan

| Table | Kind | Per client | Holds |
|---|---|---|---|
| `week_plans`, `week_features`, `week_feature_slots`, `week_drafts`, `week_quiet`, `week_carry`, `week_watch` | User | Mostly | A week's lists per client, pins, carry decisions, watches |
| `day_plans`, `picks`, `timeboxes`, `unavailable`, `borrowed`, `flex_sessions`, `resume_notes`, `focus_log` | User | Picks, timeboxes and notes yes | Day plans, to-dos (code name picks), their times, focus records. A to-do's kind (`picks.todo_kind`: null, or `deployment` since WK-3) and a Deployment's window (`window_start`, `window_end`, local "HH:MM" on its date), linked DevOps items (`links`, JSON of ids and titles, the same client's only), its Note (`notes`; a WK-3 deployment's free text stays here) and, since DP-2, its ticked items (`deploy_items`, JSON of keys and names: a snapshot, so a later change to the client's list never reaches it) |
| `follow_ups`, `promises`, `captures`, `draft_stories`, `story_drafts`, `story_draft_writes`, `breakdown_marks`, `house_styles` | User | Yes | Promises, captures, drafts, Break down's work. `follow_ups.changed_at` (IB-2) is a promise's last change, for the Inbox's timeline |
| `roadmap_dates`, `ahead_changes`, `ahead_halves`, `delivery_snapshots` | User | Yes | Ahead's dates, staged change sets, daily counts for trends |
| `inbox_marks`, `conversation_views` | User | No | What a person has seen or hidden in the Inbox |
| `kv` (key `inbox_last_looked`) | User | No | IB-2: when the person last looked at Everything, an instant, server-side so it follows them across devices. Written by `inbox.looked`, which only moves it forward. Goes with Export and Delete my data like the rest of `kv` |
| `assistant_turns`, `assistant_proposals` | User | Proposals | The assistant's history and its open proposals |
| `teams_bot_chats`, `teams_bot_cards`, `teams_bot_seen`, `teams_rhythm` | User | No | Where a person's bot chat is, card state, duplicates seen, the daily rhythm |

### Outside systems and their logs

| Table | Kind | Per client | Holds |
|---|---|---|---|
| `outlook_events`, `markers`, `invites` | User | Invites | FocusTime's own Outlook events and help invites |
| `write_log`, `devops_write_log`, `azure_write_log`, `teams_status_log` | User | DevOps log | The audit logs (see [Security](security.md#external-writes-and-the-audit-log)) |

Newer DevOps write kinds than the `op` column's CHECK are kept in `write_kind`, with `op` "comment", so an older build still reads the row. SR-3's delete of one's own comment is stored as `write_kind` "comment_edit" with `deleted: true` in `ops`, and the old text in `before` for Undo. No migration.
| `devops_identities`, `devops_item_clients` | User | Yes | A person's checked DevOps identity per client (never the PAT), item to client links |
| `devops_items`, `devops_changes`, `devops_poll` | App | Yes | Central DevOps reads, the change log, the poll's watermarks |
| `devops_takes`, `devops_notes` | App | No | Quiet notes to someone whose item was taken or changed |
| `ai_requests`, `app_ai_requests`, `ai_app_spend`, `chat_ai_days` | User and app | Yes | AI request log (counts, cost, outcome; never text), spend per month and per chat per day |

### Client chats and meetings

| Table | Kind | Per client | Holds |
|---|---|---|---|
| `client_chats`, `client_chat_changes`, `delivery_chats` | App and user | Yes | Registered client chats, their member lists, who registered them |
| `teams_messages`, `teams_message_images` | App | Yes | Messages read from registered chats; for images only type, size, a skipped reason and the AI's description (never the bytes) |
| `chat_calls` | App | Yes | CW-1: calls in registered chats, from their call started and ended events: the call id, when it started and ended, who started it (a user id and tenant). Never the participants or anything said |
| `conversations`, `conversation_messages`, `commitments`, `conversation_suggestions`, `conversation_merges`, `requests` | App | Yes | Conversations, their summaries and commitments |
| `chat_messages`, `asks`, `dedupe_log` | User | Yes | The older per-person Requests rows (AP-1) |
| `meeting_series`, `meeting_occurrences`, `meeting_transcripts`, `meeting_proposals` | App | Yes | Registered client calls, transcripts (30 days), proposals |

### Admin and team

| Table | Kind | Holds |
|---|---|---|
| `org_settings`, `admin_audit`, `admin_seen` | App | Team settings (Rules and Defaults) and every admin change |
| `people_directory`, `directory_accounts`, `people_clients`, `client_leads`, `people_overrides`, `client_logins`, `people_invites` | App | People, their levels and clients, client leads, client DevOps logins an admin confirmed, invites |
| `sends`, `week_commitments`, `client_priorities`, `look_asks` | App | Send to…, Team's commit snapshots (no hours, to-dos or notes), client priorities, Ask to look |
| `scheduler_state`, `job_claims`, `schema_migrations`, `schema_version`, `schema_migration_names` | App | The scheduler's next due time, job claims, migrations |

**Small per-person values in `kv`** (a user table: key, JSON value, updated at), each read and written only through `getState` and `setState` on the person's own store: the focus timer's state, Ahead's filters (`ahead_filters`, AH-1), Readiness's skips (`ahead_skips`: "client:id" → the day skipped, each dropped 14 days later when skips are next read or written, AH-7) and Readiness's saved fixes (`ahead_fixed`: "client:id", the kind and when, for "N fixed this week", at most 14 days, AH-7). No item titles or other DevOps text. Not in Export; removed with Delete my data.

## Retention

What is deleted by age, for everyone at once (`store/retention.ts` `RETENTION_RULES`, run once a UTC day by the `retention` job and claimed in `job_claims`):

| What | Kept |
|---|---|
| `assistant_turns` | 30 days |
| `assistant_proposals` | 30 days, or a day after it settles or expires |
| `teams_bot_seen` | a day |
| `teams_bot_cards` | a week after it settles or expires |
| `teams_rhythm` | 30 days |
| `devops_takes`, `devops_notes` | 14 days |
| `devops_changes` | 30 days |
| `delivery_snapshots` | 120 days |
| `meeting_transcripts` | 30 days; the quotes in `meeting_proposals` go at 30 days too, the proposals stay |
| `job_claims` | 30 days |

Kept elsewhere:

- **Chat messages** that aren't part of a request, promise or conversation: deleted after the Rule `conv.retention_days` (Admin › Conversations, 14 days by default, 1 to 90; `config/org.ts`).
- **Co-working calls** (`chat_calls`): 48 hours after the call started, at the next poll (`actions/request-poll.ts`); with their chat when it is removed or its messages purged.
- **The older Requests rows** (`chat_messages`, `asks`): each person's daily cleanup (`server/ticks.ts`).
- **Sessions** end after 12 hours idle or 7 days at most (`store/accounts.ts`); the hourly maintenance sweeps them.
- **Delete my data** (Settings › Data): a soft delete now, everything removed 30 days later (`store/user-data.ts`, `HARD_DELETE_AFTER_DAYS`). Clear (the assistant history, for example) deletes at once.
- **Profile photos** in the hosted app: in memory only, lost on restart (`host/azure/memory.ts`). In the developer loop, cached 7 days under hashed names.
- **Logs**: Log Analytics keeps 30 days, and Application Insights is workspace-based, so it keeps the same (`infra/modules/monitoring.bicep`).
- **Database backups**: point-in-time restore of 7 days in dev and 14 days in prod (`sqlRetentionDays` in `infra/main.bicep` and `infra/prod.bicepparam`).

## What is never stored

- **Tokens and secrets in the clear.** Access tokens live only in memory. Refresh tokens and write PATs are sealed in `user_secrets`. The ID token is validated at sign-in and dropped; only name, UPN, email, object id and tenant id are kept.
- **The company DevOps read PAT.** Read from Dataverse when DevOps is fetched and not kept.
- **Teammates' calendar details.** From free/busy only free or busy and working hours; never subjects, locations or other details. A teammate's time off shows only as "away".
- **Teammates' presence.** Read for the people on screen, never stored, cached or logged.
- **Chat images.** Never stored: fetched from Teams on view (held in memory 5 minutes), for the AI step or for a DevOps create.
- **Voice.** Push-to-talk audio is held in memory for one request and never stored or logged.
- **AI prompts and answers.** The request log keeps counts, cost and outcome only.
- **Status report drafts and suggestions (SR-1, SR-3).** Feature comments are read live from DevOps and never stored. AI suggestions are held in server memory for 6 hours and never written to the plan store. Lines not pushed yet, features added by hand and dismissed suggestions stay only in that browser (`localStorage`). Upcoming PTO and Holidays is read from Dataverse each time (names and dates only).
- **Teams chat previews** (`lastMessagePreview`), status messages, out of office notes and work location are never read.

## Who can see what

- **A person** sees their own plan: every user table, through `store/scope.ts`. Export my data (Settings › Data) gives them all of it as JSON (`focustime-export-1`).
- **Chat messages, conversations and commitments** show only to FocusTime users who are members of that chat now and follow its client (`viewer(userId)` in the store; following alone is never enough), and never outside that client's views.
- **Meeting transcripts and proposals** show only to the call's reviewers and attendees (`store/meeting-store.ts`).
- **Team views** (Team, sends, priorities) show a commit snapshot to people on the same client: no hours, to-dos, notes or focus.
- **Admins** set team values and see health and counts. They never see anyone's plan, to-dos, promises, captures, focus sessions, PATs, AI request text, assistant history or chats they aren't in. Details in [Security](security.md#admins-guests-and-automation-accounts).
- **Diagnostics** (Settings › Data › Diagnostics) is counts only, for a person's own chats, with no admin view.

## Deployment items (DP-2)

What a deployment can move depends on the client's data platform. Three places hold it:

- **The seeded catalog** is data in `config/deploy-catalog.ts`: per platform (Fabric, Azure), each item's stable key, name and whether it is ticked by default. It is not in the database and no screen holds a copy; the UI reads it through `deploy.items`.
- **A client's platform and its own list** are Rules in the app table `org_settings`, scope `client:<key>`: `data_platform` (`fabric` or `azure`; no row means not set, and both lists show with nothing ticked) and `deploy_items` (per platform, its rows in order: `{ key, on, hidden }`, with `name` for the client's own). A platform never edited has no rows and follows the catalog; a seed added later joins the end of a list that was edited. Changed by a FocusTime admin or the client's lead through `deploy.config_save`, each change in `admin_audit`. An older build reads neither key and ignores the rows.
- **A planned deployment's ticks** are in `picks.deploy_items`, a snapshot (above). Editing keeps them, including an item since hidden or removed from the list; only a new deployment takes the list's defaults.

