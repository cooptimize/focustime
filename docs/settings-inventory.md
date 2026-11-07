# ST-1 checkpoint: Settings inventory and the new layout

Status: proposal, waiting for review. Nothing here changes what a setting does; only where it shows.

Storage key: `[x] y` is a key in the person's settings rows (`user_settings`, one row per top-level section, saved through `settings.save`). "Sealed" is `user_secrets`. "Read-only" values come from Dataverse, the team's values (`org_settings`, set in Admin) or the app config, and show "Set by your FocusTime admin" or "Change this in Dataverse".

## 1. Inventory (before ST-1)

| Old section | Setting | What it controls | Stored | Who sees / kind | New home |
|---|---|---|---|---|---|
| You | Signed in, Sign out / Sign in | The session | Session | Everyone | Profile |
| You | Photos | Status line for profile photos | None (status) | Signed in | Profile |
| You | My VM: Find my VM, Forget, This is my VM, Use this VM (resource id), Allow Azure access | The one VM FocusTime reads and starts | Plan store account state (`vm:<oid>`) | Signed in | Accounts and calendars › My VM |
| You | Start my VM without asking | Morning prompt's Start skips the preview | `[azure] start_without_asking` | Everyone | Accounts and calendars › My VM |
| You | Email, Dataverse user | Read-only | Sign-in, Dataverse | Everyone | Profile |
| You | Environment | Read-only Dataverse URL | App config | Everyone (admin value) | Profile (labelled "Dataverse environment") |
| You | Time zone (read-only) | Duplicate of Working hours | `[hours] time_zone` | Everyone | Removed as a duplicate; Profile links to Working hours |
| Working hours | Mon to Sun spans, Lunch, Time zone | Capacity, risk, AM/PM split | `[hours]` | Everyone; read-only on phone | Working hours |
| Working hours | One-day changes, Use usual hours | Per-day overrides | `[[hours.override]]` | Everyone | Working hours |
| Standing blocks | Day, half, client rows | Blocks when Dataverse has none | `[[standing_blocks]]` | Everyone; read-only on phone | Working hours › Standing blocks |
| Planning › Guidance | Your level (read-only), Plan up to %, Break down offered, Readiness nudges | Emphasis only | `[guidance]` over team default by level | Everyone | Today and Week › Guidance |
| Planning › To-dos | Shortest useful time S/M/L, Carry-over, Reminder | Timebox my day, carry-over, plan reminder | `[plan] min_s/m/l, carry_days, reminder_offset_minutes` | Everyone | Today and Week › To-dos, Reminders |
| Planning | When I check off a to-do | Ask to update DevOps or never | `[plan] devops_on_done` | Everyone | Today and Week › To-dos |
| Planning › Check-in and Close out | Check-in reminder, Close out reminder | Reminder times | `[plan] checkin_reminder_minutes, closeout_reminder_minutes` | Everyone | Today and Week › Reminders |
| Planning › Plan the week | Thursday, Friday, Monday nudges | Week nudge times | `[plan] week_nudge_*` | Everyone | Today and Week › Plan the week nudges |
| Planning › Clients followed | Keep following after focus time ends | Follow grace days | `[plan] follow_grace_days` | Everyone | **Clients** (was under Planning) |
| Planning › Plan ahead rituals | Info only (next dates) | No setting; switches are in Notifications | None | Everyone | Today and Week › Plan ahead rituals |
| Planning › Focus timer | Focus length, Break length, End sound | Timer defaults | `[plan] focus_minutes, break_minutes, end_sound` | Everyone | **Focus › Focus timer** (was under Planning) |
| Planning › Timeboxes | Use timeboxing, Put on Outlook by default, Don't ask for my own | Timebox controls | `[timebox]` | Everyone | Today and Week › Timeboxes |
| Planning › Help sessions | Default length, Teams meeting, Days to search, People I exclude | Ask to collaborate | `[collab]` | Everyone | Today and Week › Help sessions |
| Planning › Help sessions | Never suggested for everyone; Invites go only to | Read-only | Team rule; app config | Everyone (admin values) | Today and Week › Help sessions |
| Focus | Teams status during focus, Plain focus sets | Presence while focus runs | `[focus] teams_status, plain_focus_status` | Everyone | Focus › Teams status |
| Focus | Default sound, Volume, Fade, When a break starts | Focus sounds | `[focus]` | Everyone | Focus |
| Focus | Pause and resume music | Media control (developer loop only works) | `[focus] pause_media` | Everyone | Focus |
| Focus | Playlists | Up to N links | `[focus] playlists` | Everyone | Focus |
| Notifications | A switch per kind (6 groups) | In-app and push kinds | `[notify] kinds` | Everyone | Notifications › In FocusTime |
| Notifications | Status report times, Urgent requests during focus | Timing | `[notify] status, asks_through_focus` | Everyone | Notifications › Timing |
| Notifications | Quiet, Quiet on PTO days | Quiet hours | `[notify] quiet, quiet_pto` | Everyone | Notifications › Quiet hours |
| Notifications | Send a test notification | Action | None | Everyone | Notifications › Test |
| Notifications | Notify this device, device list, Remove; Show details | Web push per device | Push subscription table; `[notify] push_details` | Everyone | Notifications › On your devices |
| Notifications | Let FocusTime message me in Teams; kinds with times and tests; Also Fridays | The bot's rhythm | `[notify] teams_messages, teams` | Everyone | Notifications › In Teams |
| Ahead | Stale after, Stalled after, Watch within | Backlog and Grid states | `[ahead] stale_weeks`, `[roadmap]` | Everyone | Ahead |
| Risk rules | Watch at, At risk at, Shortest useful focus window | Block risk | `[risk]` | Everyone | **Today and Week › At-risk blocks** |
| Clients | Requests phrases (folded at the top): my request, acknowledgement and promise phrases; team phrases read-only | How chats become requests and promises | `[asks]`; team default | Everyone | **Client chats** |
| Clients (per client) | Shown as, Color (team default, Reset), Keep following | Display and follow | `[clients.<key>]` | Everyone; read-only on phone | **Clients › <client>** (its own page) |
| Clients (per client) | Dataverse nickname, DevOps identity, States treated as open, AI for this client, House style, Delivery chats | Read-only | Dataverse, team rules | Everyone | Clients › <client> |
| Clients (per client) | DevOps write access: PAT (masked), expiry, Check and save, Turn off | Write PAT | Sealed `devops-write-pat:<client>` | Everyone | **DevOps › Write access**; the client page shows the status with a fix-it link |
| AI | AI for FocusTime, Allowed for, Your monthly limit | Read-only | Team rules | Everyone | AI and assistant |
| AI | This month, Test AI, What is sent, Last 20 requests | Status | `ai_requests` | Everyone | AI and assistant |
| AI | Break down looks back | Examples window | `[ai] draft_months` | Everyone | AI and assistant |
| Connections | Sources (Retry, Connect, Reconnect, Disconnect) | Calendars and Dataverse | Tokens sealed | Everyone | Accounts and calendars › Sources |
| Connections | Outlook calendar changes | Calendars.ReadWrite | Token | Everyone | Accounts and calendars |
| Connections | Send feedback status | Feedback setup | Status | Everyone | Accounts and calendars |
| Connections | Microsoft permissions | Per-permission state | Status | Everyone | Accounts and calendars |
| Connections | Client chats read for requests | Poll status per chat | Status | Everyone | **Client chats** |
| Connections | DevOps per client (read status, Retry) | Read status | Status | Everyone | **DevOps › Reading** |
| Connections | Client secrets (app secrets) | App's own keyring secrets | Host keyring | Developer loop, signed out only | Accounts and calendars › App secrets (flagged, see 3) |
| Display | Theme, Text size, Timelines, Personal events, Reduce motion | Display | `[ui]` | Everyone | Display |
| Display | Demo mode: Show demo data | Demo switch | Session | Everyone | **Your data › Demo** |
| Display | Style guide link | Developer page | None | Everyone | **About** |
| Data | Write log, DevOps write log, Azure write log, Teams status log | Undo, Retry | Plan store logs | Everyone; read-only on phone | **Activity** |
| Data | Export my data, Reset my plan, Delete my data | Data rights | Plan store | Everyone | Your data |
| Data | Assistant history: Clear | AS-1 history | `assistant_turns` | Everyone | **AI and assistant › Assistant** |
| Data | Diagnostics | DX-1 counts | Read only | Everyone (also on phone) | Your data |
| Setup | Finish setup, Run setup again, Run setup from the start, Start over (not prod) | First-run flow | `setup_state` | Everyone, not in demo | **Profile › Setup** |
| About | Lockup, version | | | Everyone | About (plus Open the Guide) |
| Demo | Reset demo | Demo only | Demo store | Demo sessions | **Your data › Demo** |
| Admin (7) | Clients, AI, Conversations, People, Organization, Status, Audit | Team values | `org_settings` | FocusTime admins | Unchanged, its own group at the foot of the rail |

Every section also had the line "Changes save as you make them, to <where>". It now shows once, in Profile; each field keeps its own Saved / Couldn't save. Retry mark.

### Settings that live outside Settings (not moved)

- Week's timeline on or off (B, `[ui] show_timelines`), the Inbox's view, clients and grouping (`ui.set_inbox`), Keep open per client (Plan the week, `[keep_open]`). They are set where they are used. Should search point at them? I'd say no.

### Asked for in the brief, but no such setting today (not added)

- A PTO view, a voice setting (push-to-talk has no switch; it follows the client's Allow AI), What's new. ST-1 adds no functions, so these are left out. About now links to the Guide.

## 2. Duplicates, wrong places, dead-looking

Duplicates
- Time zone was shown in You (read-only) and edited in Working hours. Now only in Working hours; Profile links there.
- Teams shows in three places: Focus (status during focus), Notifications (what the bot sends) and nowhere for "is the bot connected". Accounts and calendars › FocusTime in Teams now shows the bot's state and links to the other two, which stay where they act.
- Delivery chats show per client (read-only, client page) and as a poll status list (Client chats). Both kept: one is "which chats", the other "are they read".
- Similar names, different meanings: "Shortest useful time" (per to-do size, Timebox my day) and "Shortest useful focus window" (risk). Both kept; now under different headings (To-dos, At-risk blocks).

In the wrong place (moved, meaning unchanged): focus timer (Planning → Focus), Keep following (Planning → Clients), My VM (You → Accounts and calendars), the four write logs (Data → Activity), demo switch (Display → Your data), Assistant history (Data → AI and assistant), DevOps write PATs (Clients → DevOps), request phrases (folded inside Clients → Client chats), Risk rules (own section → Today and Week), Standing blocks (own section → Working hours), Setup (own section → Profile), Style guide (Display → About).

Admin-flavored values in Settings (flagged, not moved; all read-only with "Set by your FocusTime admin"): Dataverse environment, Invites go only to, Never suggested, States treated as open, team phrases, AI rules, house style, team color. One is more than flavor:
- **App secrets** (Connections › Client secrets): the app's own Dataverse and Google client secrets, editable from a person's Settings in the developer loop when signed out. CLAUDE.md says app secrets are "set up outside FocusTime, never from a person's Settings". It only appears there with a local keyring and no signed-in person, so it is a developer tool. Proposal: remove it in a follow-up (the `focustime` command can set them). Kept for now, labelled "App secrets (developer loop)".

Dead-looking
- Demo mode "Show demo data": in the hosted app `demo.set` answers "Demo mode isn't available here" (the demo is "Try the demo" at sign-in). It works only in the developer loop. Kept; candidate to hide outside the developer loop.
- Setup's "Start over": dev and local only, by design.
- Style guide link: a developer page; kept under About.
- Profile's "Microsoft sign-in needs an app registration: set [outlook] client_id in config" is developer-loop wording.
- The phone's read-only banner on Clients and Your data says "Planning works best on a bigger screen" (PhoneReadOnly's fixed line), which reads oddly in Settings.
- Settings › AI's request log shows raw task names for newer tasks (only four are named). Out of scope; noted.

## 3. The new layout

Rail with search on top, five groups, then Admin for admins. 15 items (was 16 plus Admin), deep links `#/settings/<section>[/<setting>]`.

| Group | Section (id) | Holds |
|---|---|---|
| You | Profile (`you`) | Signed in, photos, email, Dataverse user and environment, where settings save, Setup |
| You | Working hours (`hours`) | Day spans, lunch, time zone, one-day changes, standing blocks |
| You | Notifications (`notifications`) | In FocusTime kinds, timing, quiet hours, test, devices, In Teams |
| You | Display (`display`) | Theme, text size, timelines, personal events, motion |
| Planning | Today and Week (`planning`) | Guidance, to-dos, reminders, week nudges, rituals, timeboxes, help sessions, at-risk blocks |
| Planning | Focus (`focus`) | Focus timer, Teams status, sound, music, playlists |
| Planning | Ahead (`ahead`) | Stale, Stalled, Watch |
| Clients | Clients (`clients`) | Keep following after; one row per client → its own page (`client/<key>`, Back to Clients) |
| Clients | Client chats (`chats`) | My phrases, team phrases, chats read |
| Connections | Accounts and calendars (`connections`) | Sources, Outlook changes, Microsoft permissions, My VM, FocusTime in Teams, Send feedback, app secrets |
| Connections | DevOps (`devops`) | Reading per client, write access per client (status, never the PAT) |
| Connections | AI and assistant (`ai`) | Team AI values, spend, Break down looks back, Test AI, what is sent, last 20, assistant history |
| Data | Activity (`activity`) | Outlook, DevOps, Azure and Teams logs |
| Data | Your data (`data`) | Export, reset, delete, diagnostics, demo |
| Data | About (`about`) | Version, Open the Guide, style guide |
| Admin | 7 sections, unchanged | |

Old addresses keep working: `standing` → `hours/standing-blocks`, `risk` → `planning/risk-rules`, `roadmap` → `ahead`, `setup` → `you/setup`, `demo` → `data/demo-reset`; `#/settings/clients` still opens Clients (the server's consent redirects use it). Send feedback's and every DevOps write prompt's "Enable DevOps writes" now go to `devops/devops-write`.

## 4. The shell

`ui/PanelShell.tsx`: header (Back at the top left only on a sub-page or a phone page, the title and its one-line description, UI-3's × at the top right), the rail (a slot on top for search, grouped items as links with their address, an override slot for results), and a body that scrolls on its own. Esc closes (search's first Esc clears it), focus starts on the title and returns to the opener (UI-3's `useReturnFocus`). Under 900 px wide or on a phone the rail is its own list page and each section a page with Back and ×. The bottom-left Back is gone.
