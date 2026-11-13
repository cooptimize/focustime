# Data

For engineers adding a table and IT checking what FocusTime keeps. Checked against `2f4c0ea` on Nov 13, 2026.

## One database, two kinds of table

FocusTime keeps everything in one database, its plan store: Azure SQL in dev and prod, a SQL Server container in the developer loop, and SQLite only for the demo (in memory) and tests. The database comes from the app's config (`[database]` or `FOCUSTIME_DB_*`), never from a person. Schema changes go only through `store/sql/migrate.ts`, and migrations only add (tables, columns, indexes; `store/migrations/additive.test.ts`).

- **User tables** hold one person's rows. `user_id` (their Entra object id) is the first key column, and every statement on them goes through `store/scope.ts`, which adds the session's person; code never writes SQL that names `user_id`. The list is `USER_TABLES` in `store/scope.ts` (60 tables).
- **App tables** belong to the app as a whole: sign-in, shared chat polling, the admin console, DevOps reads, team views. Who may read their rows is decided in their store module (for example the chat viewer rule in `store/conversation-store.ts`). The list is `APP_TABLES` in `store/isolation.test.ts` (65 tables).

`store/isolation.test.ts` fails when a table is neither, or when a user table can leak between two people.

**Per client** below means the rows carry a client key, so views, AI requests and DevOps writes can keep one client's data to that client. Code names that differ from what people see (picks for to-dos, `ahead` for Backlog) are in the [names table](README.md#names-in-the-code).

## Tables by area

### People, sign-in and settings

| Table | Kind | Per client | Holds |
|---|---|---|---|
| `users` | App | No | One row per person who signed in: Entra object id, tenant, UPN, name, email, time zone, deleted at |
| `sessions` | App | No | A hash of the session id only, its CSRF token, last seen, expiry |
| `auth_requests` | App | No | Short-lived sign-in state (PKCE and nonce) |
| `deletions` | App | No | Accounts waiting for their hard delete (a hash of the user id) |
| `user_settings`, `setup_state`, `account_state` | User | No | Settings rows, first-run progress, the signed-in identity (name, UPN, email, ids) |
| `kv` | User | No | Small per-person values (below) |
| `user_secrets` | User | No | A person's refresh tokens and DevOps write PATs, sealed with the app data key |
| `push_devices` | User | No | Web Push subscriptions for "Notify this device" |
| `notices` | User | No | In-app notifications |
| `app_keys` | App | No | The app data key, wrapped by Key Vault's `ft-data-key` |

**Small per-person values in `kv`** (key, JSON value, updated at), each read and written only through `getState` and `setState` on the person's own store: the focus timer's state, Backlog's filters (`ahead_filters`), Needs attention's skips (`ahead_skips`: "client:id" and the day skipped, each dropped 14 days later) and saved fixes (`ahead_fixed`, at most 14 days), when the person last looked at the Inbox (`inbox_last_looked`). No item titles or other DevOps text. In Export and removed with Delete my data, like every user table not listed under [Export](#export).

### The plan

| Table | Kind | Per client | Holds |
|---|---|---|---|
| `day_plans`, `picks`, `timeboxes`, `unavailable`, `borrowed`, `flex_sessions`, `resume_notes`, `focus_log` | User | To-dos, timeboxes and notes | Day plans, to-dos, their times, unavailable time, borrowed time, focus records (details below) |
| `week_plans`, `week_features`, `week_feature_slots`, `week_drafts`, `week_quiet`, `week_watch`, `week_carry` | User | Mostly | A week's features per client, pins, quiet and watch marks, carry decisions. `week_plans.committed_at` and the `tier` columns are kept and never read |
| `follow_ups` | User | Yes | Promises a person added or a rule opened; `changed_at` is a promise's last change |
| `promises` | User | Yes | Promises the chat rules found in my own messages, before they join a conversation's commitments |
| `captures`, `draft_stories`, `story_drafts`, `story_draft_writes`, `breakdown_marks`, `house_styles` | User | Yes | Captures, draft stories and features (`draft_stories.brief`: the three answers as JSON), Break down's work, each client's house style |
| `roadmap_dates`, `ahead_changes`, `ahead_state_changes`, `ahead_halves`, `delivery_snapshots` | User | Yes | Backlog's dates, its change set (start, target, size, assignee; state changes in their own table), daily counts for trends |
| `inbox_marks`, `conversation_views` | User | No | What a person has seen or hidden in the Inbox: a suggestion shown (`suggested_at`) and what became of it (`outcome`, `outcome_at`), a promise touched (`touched_at`), cleared on its own as done or expired (`cleared`, `cleared_at`) or put back (`put_back_at`); Diagnostics counts them |
| `loop_sends` | User | Yes | Close the loop's sends: channel, mode (draft, sent, marked), state, where it went and to whom (a name), counts of people inside and outside Cooptimize, the text sent, the link, Graph's reference, the audit row's id |
| `assistant_turns`, `assistant_proposals` | User | Proposals | The assistant's history and its open proposals |
| `teams_bot_chats`, `teams_bot_cards`, `teams_bot_seen`, `teams_rhythm` | User | No | Where a person's bot chat is, card state, duplicates seen, the daily rhythm |

**A to-do's columns** (`picks`): its kind (`todo_kind`: null, or `deployment` with a window `window_start`, `window_end` and ticked deployment items `deploy_items`, a snapshot of keys and names), linked DevOps items (`links`, the same client's only), its note (`notes`), time spent and left (`spent_minutes`, `remaining_minutes`, null until the first check-in answer), what a Done took off the plan (`done_removed`, ids only, so unticking puts it back) and XS (`size_xs`, with `size` holding S so an older reader sees S; also on `week_features` and `draft_stories`). A timebox's check-in answer is `timeboxes.settled_as` (`done`, `partly` or `none`), with `settled_at` and `settle_before` (numbers and a status, for Undo).

**First-run setup's end** is a `markers` row of kind `setup_through`; Start over deletes it with the setup rows.

### Outside systems and their logs

| Table | Kind | Per client | Holds |
|---|---|---|---|
| `outlook_events`, `markers`, `invites` | User | Invites | FocusTime's own Outlook events and help invites; `markers` also holds once-marks, cleared board suggestions (kind `sg_clear`) and the setup mark |
| `write_log`, `devops_write_log`, `azure_write_log`, `teams_status_log` | User | DevOps log | The audit logs (see [Security](security.md#external-writes-and-the-audit-log)) |
| `calendar_links`, `calendar_link_events` | User | No | Calendars added by an ICS link. The link is sealed (`sealed`, the app data key, bound to the person and the link); also its name, color, Busy only or Show titles, Personal or Work, the host shown, ETag and Last-Modified, and the last check (a failure kind, never the server's words). Events: the instances 8 weeks back to 26 ahead, start and end, all day, show as, and a title only with Show titles; never a location or description |
| `devops_identities`, `devops_item_clients` | User | Yes | A person's checked DevOps identity per client (never the PAT), item to client links |
| `devops_items`, `devops_changes`, `devops_poll` | App | Yes | Central DevOps reads, the change log, the poll's watermarks |
| `devops_takes`, `devops_notes`, `devops_edit_notes` | App | No | Quiet notes to someone whose item was taken, changed, edited (once a day per item) or moved |
| `standards_articles`, `standards_sync` | App | No | Cooptimize's standards: active articles with their path, front matter, SHA-256 and the repo commit; the last sync and its error |
| `ai_requests`, `app_ai_requests`, `ai_app_spend`, `chat_ai_days` | User and app | Yes | AI request log (counts, cost, outcome; never text), spend per month and per chat per day |

DevOps write kinds newer than the `op` column's CHECK are kept in `write_kind`, with `op` "comment", so an older build still reads the row. A delete of my own comment is `write_kind` "comment_edit" with `deleted: true`, and the old text in `before` for Undo.

### DevOps patterns

A hidden working page for the people an admin turned it on for ([Integrations](integrations.md#azure-devops)). All app tables, per client, never description, acceptance or comment text and never people's names.

| Table | Holds |
|---|---|
| `patterns_runs`, `patterns_snapshots` | Runs (kind, state, the starter's user id, progress, estimate and spend) and each client's numbers per run |
| `patterns_items`, `patterns_labels` | Items of the last 24 months and their parents (id, rev, type, state, dates, parent, title, and numbers about the text), labels per item |
| `patterns_type_lists`, `patterns_ignored` | The request types list in versions (who made each, a line of why, the version it came from, `made_by`, `why`, `base`, `relabel`), and "other" names a person chose to ignore |
| `patterns_platforms`, `patterns_layout`, `patterns_projects`, `patterns_scopes`, `patterns_kinds` | Each client's platform; per item its project, area, type and created date; each project's area tree and teams (names only, never the teams' people); each client's scope; each type's kind |

### Client chats and meetings

| Table | Kind | Per client | Holds |
|---|---|---|---|
| `client_chats`, `client_chat_changes` | App | Yes | Registered client chats, their cached member lists, who registered them and when |
| `teams_messages`, `teams_message_images` | App | Yes | Messages read from registered chats; for images only type, size, a skipped reason and the AI's description (never the bytes) |
| `chat_calls` | App | Yes | Calls in registered chats, from their started and ended events: the call id, start and end, who started it (a user id and tenant). Never the participants or anything said |
| `conversations`, `conversation_messages`, `commitments`, `conversation_suggestions`, `conversation_merges`, `conversation_events` | App | Yes | Conversations, their summaries, commitments, drafted suggestions, merges and history. `conversations.item_needed_json` is the sorting step's judgment that one needs a DevOps item (why, a title, a level) |
| `requests` | App | Yes | Messages the chat rules picked out as requests; read for the urgent request notice |
| `meeting_series`, `meeting_occurrences`, `meeting_transcripts`, `meeting_proposals` | App | Yes | Registered client calls, transcripts (30 days), proposals; each occurrence's last look for its transcript (what was found and through whose sign-in) |

### Admin and team

| Table | Kind | Holds |
|---|---|---|
| `org_settings`, `admin_audit`, `admin_seen` | App | Team settings (Rules and Defaults, including each client's data platform and deployment items) and every admin change |
| `people_directory`, `directory_accounts`, `people_clients`, `client_leads`, `people_overrides`, `client_logins`, `people_invites` | App | People, their levels and clients, client leads, client DevOps logins an admin confirmed, invites |
| `sends`, `week_commitments`, `client_priorities`, `look_asks` | App | Send to…, each person's week features for the team view and the status report (feature, type, title, link; no hours, to-dos or notes), client priorities, Ask to look |
| `code_views` | App | Who opened which client's repo or file in Code, or used Find, and when (actor id and name, client, repo id and name, path, event); never content. Read only by admins |
| `work_templates`, `work_template_uses` | App | The team's work templates (one document, its version, who saved it last) and one row per item created with a request type (its tag, when, whether complete): counts only. No screen reads or writes them |
| `scheduler_state`, `job_claims`, `schema_migrations`, `schema_version`, `schema_migration_names` | App | The scheduler's next due time, job claims, migrations |

## Kept, no longer written

These tables are still in the database and in `USER_TABLES` or `APP_TABLES`, but nothing in the app writes them:

| Table | Kind | What happens to it now | What would remove it |
|---|---|---|---|
| `chat_messages`, `asks` | User | Messages and requests from the older per-person chat reading; client chats are now read once for everyone into `teams_messages`. The daily cleanup still deletes rows older than 14 days that didn't become a request or promise (`purgeChatText` in `store/plan-store.ts`), so they empty on their own; Export includes any left | Remove `purgeChatText` and the rows' import, then a migration with a `safe-drop` comment in a later release |
| `delivery_chats` | User | The older per-person registry of client chats; `client_chats` replaced it. Neither read nor written | A `safe-drop` migration in a later release |
| `dedupe_log` | User | Rows a one-time clean-up of duplicate week items wrote; only the SQLite store counts them at start, for its log | A `safe-drop` migration in a later release |

`work_templates` and `work_template_uses` are kept on purpose for a later use and are listed above. A drop always ships in a release after the code stops using the table, so rolling back stays safe (`store/migrations/additive.test.ts`).

## Retention

What is deleted by age, for everyone at once (`RETENTION_RULES` in `store/retention.ts`, run once a UTC day by the `retention_purge` job and claimed in `job_claims`):

| What | Kept |
|---|---|
| `assistant_turns` | 30 days |
| `assistant_proposals` | 30 days, or a day after it settles or expires |
| `teams_bot_seen` | a day |
| `teams_bot_cards` | a week after it settles or expires |
| `teams_rhythm` | 30 days |
| `devops_takes`, `devops_notes`, `devops_edit_notes` | 14 days |
| `devops_changes` | 30 days |
| `delivery_snapshots` | 120 days |
| `meeting_transcripts` | 30 days; the quotes in `meeting_proposals` go at 30 days too, the proposals stay |
| `code_views` | 12 months |
| `job_claims` | 30 days |

Kept elsewhere:

- **Chat messages** that aren't part of a request, promise or conversation: deleted after the Rule `conv.retention_days` (Admin › Conversations, 14 days by default, 1 to 90; `config/org.ts`).
- **Co-working calls** (`chat_calls`): 48 hours after the call started, at the next poll (`actions/request-poll.ts`); with their chat when it is removed or its messages purged.
- **Sessions** end after 12 hours idle or 7 days at most (`store/accounts.ts`); the hourly maintenance sweeps them.
- **Delete my data** (Settings › Your data): a soft delete now, everything removed 30 days later (`HARD_DELETE_AFTER_DAYS` in `store/user-data.ts`). The Teams bot's rows go at once. Clear (the assistant history, for example) deletes at once.
- **Everything else a person keeps** (their plan, promises, captures, audit logs, `loop_sends`, calendar links) stays until they remove it or delete their data.
- **Profile photos** in the hosted app: in memory only, lost on restart (`host/azure/memory.ts`). In the developer loop, cached 7 days under hashed names.
- **Logs**: Log Analytics keeps 30 days, and Application Insights is workspace-based, so it keeps the same (`infra/modules/monitoring.bicep`).
- **Database backups**: point-in-time restore of 7 days in dev and 14 days in prod (`sqlRetentionDays` in `infra/main.bicep` and `infra/prod.bicepparam`).

## Export

Settings › Your data › Export my data gives a person every user table's rows as JSON (`focustime-export-1`, schema version 41, `store/user-data.ts`), without their user id. Not in Export: `user_secrets`, `push_devices`, the Teams bot's four tables, `calendar_links` and `calendar_link_events` (`NOT_EXPORTED`). `focustime import` loads an export of version 26 or later.

## What is never stored

- **Tokens and secrets in the clear.** Access tokens live only in memory. Refresh tokens and write PATs are sealed in `user_secrets`; calendar links are sealed in `calendar_links`. The ID token is validated at sign-in and dropped; only name, UPN, email, object id and tenant id are kept.
- **The company DevOps read PAT.** Read from Dataverse when DevOps is read and not kept.
- **Teammates' calendar details.** From free/busy only free or busy and working hours; never subjects, locations or other details. A teammate's time off shows only as "away".
- **Teammates' presence.** Read for the people on screen, never stored, cached or logged.
- **Chat images.** Never stored: fetched from Teams on view (held in memory 5 minutes), for the AI step or for a DevOps create.
- **Voice.** Push-to-talk audio is held in memory for one request and never stored or logged.
- **AI prompts and answers.** The request log keeps counts, cost and outcome only.
- **Status report text.** Feature comments are read live from DevOps and never stored. AI suggestions are held in server memory for 6 hours. Lines not pushed yet, features added by hand and dismissed suggestions stay only in that browser (`localStorage`). Upcoming PTO and Holidays is read from Dataverse each time (names and dates only).
- **Calendar link details with Busy only.** Only start, end and busy, free or tentative; Show titles keeps titles only. A calendar link's own address is never shown again, logged or exported; only its host is shown.
- **DevOps item text on the patterns page.** Descriptions and acceptance criteria are read to measure them and, for a classification, to send; the text is dropped once the request is done.
- **Client code.** Repo lists, folder lists and file text are read from DevOps on each click and held in server memory at most 5 minutes; never written to the database, disk, logs, Export or the browser's storage. Only the view log's row is kept.
- **Teams chat previews** (`lastMessagePreview`), status messages, out of office notes and work location are never read.

## Who sees what

- **A person** sees their own plan: every user table, through `store/scope.ts`, and all of it in Export.
- **Chat messages, conversations and commitments** show only to FocusTime users who are members of that chat now and follow its client (`viewer(userId)` in the store; following alone is never enough), and never outside that client's views. A person sees them as From chats' suggestions (with their messages) and their own promises; the rest stays stored and unshown.
- **Meeting transcripts and proposals** show only to the call's reviewers and attendees (`store/meeting-store.ts`).
- **Team views** (sends, priorities, the status report's committed features) show a snapshot to people on the same client: no hours, to-dos, notes or focus.
- **Admins** set team values and see health and counts. They never see anyone's plan, to-dos, promises, captures, focus sessions, PATs, AI request text, assistant history or chats they aren't in. Details in [Security](security.md#admins-guests-and-automation-accounts).
- **DevOps patterns** shows counts, shares, labels and shapes for every client to the people an admin turned it on for, and item rows (id, title, labels) only for clients they are on, checked on every request. Being an admin changes nothing.
- **Code** shows any client's code to every Cooptimizer, except a client an admin set to its team only; Code views shows admins who opened what, never the code.
- **Diagnostics** (Settings › Your data › Diagnostics) is counts only, for a person's own chats, with no admin view.

History: each table's step is in [docs/decisions.md](../decisions.md) and the migrations in `store/migrations/`.
