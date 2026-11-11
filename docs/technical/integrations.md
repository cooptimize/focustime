# Integrations

For engineers working on a source and IT reviewing what FocusTime asks for. Checked against `bc72446` on Nov 7, 2026 (with IN-2 on `feat/invite-send`; the holidays read against `feat/report-finish` on Nov 8). GitHub (KB-1) against `feat/coop-standards` on Nov 8. Calendar links (CAL-1) against `feat/ics-calendars` on Nov 10. Client calls (MC-1c) against `fix/mc1c-meeting-register` on Nov 11. DevOps freshness and Find an item (DV-2) against `feat/dv2-devops-fresh` on Nov 11.

Every outside system is read only, except the named writes listed for each one below. Calendar links (CAL-1) are read only. Each source reports its own status (`ok`, `auth_required`, `unreachable`, `misconfigured` or `error`, `week/types.ts`). When one fails, people see that source's last good data with its age, or a plain message and the fix ("Connect Google Calendar", "Open Settings"), and the rest of FocusTime keeps working. Nothing stands in for a failed source: a real session never shows demo data.

## Microsoft Entra ID and Microsoft Graph

**Auth.** One Microsoft sign-in on the "FocusTime" web app registration (single tenant, Cooptimize only), OpenID Connect with authorization code and PKCE (`server/auth/entra.ts`). The client secret is the Key Vault secret `ft-entra-client-secret`. Sign-in asks for `openid profile email offline_access` and Graph's `.default`, so it gets the delegated permissions granted on the registration. Further token kinds (presence, photos, chats, messages, meetings, Azure) each ask for their own scopes on the same refresh token (`sources/oauth/oauth.ts`). The refresh token is sealed in the person's `user_secrets`; access tokens stay in memory.

**Permissions.** All delegated: FocusTime always acts as the signed-in person, never app-only. The list lives in three places that must agree: `plan/permissions.ts` (what Settings › Connections shows), `GRAPH_SCOPES` in `infra/scripts/app-registration.sh` (what the registration requests and the tenant grant covers) and the scope constants in `sources/oauth/oauth.ts`. `scripts/tech-docs.test.ts` fails when one of them names a permission missing here.

| Permission | API | Admin consent | Granted how | What it is for |
|---|---|---|---|---|
| `openid`, `profile`, `email`, `offline_access` | OpenID | No | Tenant grant | Who signed in, and a refresh token |
| `User.Read` | Graph | No | Tenant grant | Who you are |
| `Calendars.ReadWrite` | Graph | No | Tenant grant | Reading your calendar; writing only FocusTime's own events, your own events with no other attendees, help invites and your replies to invitations |
| `MailboxSettings.Read` | Graph | No | Tenant grant | Your working hours and time zone |
| `Presence.ReadWrite` | Graph | No | Tenant grant | Setting your own Teams status while focus runs |
| `Presence.Read.All` | Graph | No | Tenant grant | Teammates' availability, as a word |
| `ProfilePhoto.Read.All` | Graph | Yes | Tenant grant | Profile photos of you and the Cooptimizers on screen |
| `Chat.ReadBasic` | Graph | No | Tenant grant | Names and members of your group chats, to register a client chat; never messages |
| `Chat.Read` | Graph | No | Each person, when they first need it | New messages in registered client chats, read for everyone on them who follows the client, and their call started and ended events (CW-1); never posts |
| `ChatMessage.Send` | Graph | No | Each person, when they first send from Close the loop | LP-1: posting my update, as me, in the client chat a promise came from, or in a 1:1 chat with someone at Cooptimize; only after the preview and Send. IN-2: an admin's invite, one 1:1 message per Cooptimizer who hasn't signed in, after its preview and Send |
| `Chat.Create` | Graph | No | With `ChatMessage.Send` | LP-1: starting (or finding) the 1:1 chat with someone at Cooptimize; Graph returns the existing chat when there is one. IN-2: the same, for an invite |
| `Mail.ReadWrite` | Graph | No | Each person, when they first create an email draft | LP-1: creating the Outlook draft of my update in my own mailbox and reading back that one message (draft or sent). IN-2: an admin's invite as a draft (one each, or one to everyone) |
| `Mail.Send` | Graph | No | Each person, when they first choose Send now | LP-1: sending that draft from my mailbox when I chose Send now; never any other message. IN-2: an admin's invite when they chose Send now |
| `OnlineMeetings.Read` | Graph | Yes | Tenant grant | Finding a registered client call from its join link |
| `OnlineMeetingTranscript.Read.All` | Graph | Yes | Tenant grant | The transcript of a registered client call, for its reviewers |
| `user_impersonation` | Azure Service Management | No | Tenant grant | Your own VM, with your own Azure access |
| `Calendars.ReadBasic` | Graph | No | The old desktop registration only | Developer loop on the old "Coopilot Desktop" registration (`sources/oauth/oauth.ts`); the hosted app uses `Calendars.ReadWrite` |

**Read.** Your calendar view and free/busy of teammates (`getSchedule`: free or busy and working hours only), mailbox settings, presence (`getPresencesByUserId`), photos, chat names and members, registered chats' messages and their images (on view), registered meetings and their transcripts (`sources/graph/`).

**Co-working calls (CW-1).** The same `GET /chats/{id}/messages` read the shared poll already makes (delegated `Chat.Read`, every 5 minutes in the followers' working hours) brings each registered chat's call system events: a chatMessage whose `eventDetail` is `callStartedEventMessageDetail` or `callEndedEventMessageDetail` (its `messageType` is `systemEventMessage`, or `unknownFutureValue` without the `Prefer: include-unknown-enum-members` header, so FocusTime goes by `eventDetail`; [system messages](https://learn.microsoft.com/en-us/graph/system-messages)). Only a call or a Meet now (`callEventType` call or meeting, not screenShare) counts. From each event only the call id, the event's time, the starter's user id and tenant and, for an end, `callDuration` are kept (`chat_calls`; never the participants, a name from the event, a recording or a transcript). No extra request, no new permission, no change to the interval. A call with no end event is treated as ended 10 hours after it started. Call events are never messages: they never reach the conversations pipeline, the Inbox, promises, chatter or the AI (`plan/cowork.ts`). Join and Start a call only open the chat in Teams (its `webUrl`, else `https://teams.microsoft.com/l/chat/<chat id>/conversations`); FocusTime never starts, joins or posts in a call.

**Client calls (MC-1, MC-1c).** Registration reads the admin's own calendar: the next 5 weeks (`/me/calendarView`, no `$filter`: Microsoft's docs don't say `type` or `isOnlineMeeting` can be filtered on events), the online occurrences that belong to a series picked in code, then each series master once (`/me/events/{id}`, at most 40); a pasted link is found the same way, compared however it was copied. Transcripts of registered Automatic calls only, with a person's own `OnlineMeetings.Read` (`/me/onlineMeetings?$filter=JoinWebUrl eq '…'`) and `OnlineMeetingTranscript.Read.All`; [calltranscript-get](https://learn.microsoft.com/en-us/graph/api/calltranscript-get) says the transcript "is also available to users who are part of the meeting calendar invite" (checked Nov 11, 2026), so a registrant who attends a teammate's call reads it like the organizer. A failed call is one kind (`graphFailureOf`: signin, consent, missing, refused, busy, setup), logged as `meeting_graph_failed` or on the job's `meeting_check`, and answered in plain words; never a token, header, body, link or id.

**Written.** Only through the write framework: FocusTime's own events (the marker), the time and show-as of your own events with no other attendees, help invites to Cooptimize addresses, and your accept, tentative or decline on a meeting someone else invited you to (Graph's accept, tentativelyAccept and decline only, never a PATCH, DELETE or cancel of their meeting). Your preferred presence from the focus timer (`setUserPreferredPresence` Busy or DoNotDisturb with an expiry, and `clearUserPreferredPresence`). LP-1's Close the loop, only after its preview and Send, as me: one Teams message in the chat the promise came from or a 1:1 chat with someone at Cooptimize (`POST /chats`, `POST /chats/{id}/messages`, read back with `Chat.Read` when granted), or one email in my own mailbox (`POST /me/messages` as a draft, `POST /me/messages/{id}/send` only for Send now, read back by its immutable id). Never reactions, read marks, edits or deletes of messages, and never a message the person didn't preview (`sources/graph/send.ts`). Setup and the admin's part: `docs/setup/close-the-loop.md`. IN-2 reuses the same requests and the same per-person consents, with nothing new asked for, for an admin's invite from Admin › People: one 1:1 Teams message per person, or an Outlook draft or email (one each, or one with everyone on To), only to Cooptimizers who haven't signed in, only after the invite's preview and Send, each read back (`actions/invite-send.ts`).

**Failure.** A missing consent shows in Settings › Connections as needs consent or needs an admin, with where to allow it. An expired sign-in shows "Reconnect". A failed calendar read shows the last good data and its age.

## Azure DevOps

**Auth.** Two kinds of personal access token, each wrapped in `Pat` (prints as `[PAT]`) and sent only as the Authorization header to `https://dev.azure.com/<org>/` (`sources/devops/pat.ts`):

- **Read PAT**: the company's token per client, read from Dataverse (`coop_devopstoken`) only at fetch time, never kept and never used on the write path.
- **Write PAT**: a person's own token per client (Work Items read and write), entered in Settings › Clients, checked against their DevOps identity (`_apis/connectionData`) before it's saved, sealed in `user_secrets` as `devops-write-pat:<client>`.

**Read.** Work items (WIQL, batch reads), the process (backlog levels, types, states, fields), backlogs and team settings, team members (`_apis/projects/{project}/teams/{team}/members`, read with the teams once a day and kept in memory per client, for Ahead's Assigned to list; groups, service accounts and deleted identities left out; never another client's project), classification nodes. DevOps is read centrally by the `devops_poll` job with changed-since reads and a change log (`sources/devops/`, `devops_items`, `devops_changes`). Each client has a version that moves only when a check stores a change; open pages ask for the versions every 30 seconds (a background call that never counts as use, and never carries items) and reread only what moved. Refresh asks for a check now (30 seconds apart per client, shared by everyone). Settings › DevOps › Find an item answers from the store only (never a request to DevOps on a person's behalf), the same for an item that doesn't exist and one in a project FocusTime doesn't read (DV-2).

**Written.** Only the named writes in `actions/devops-write-actions.ts`, each with preview, a `test` on `/rev`, read back, the audit log and undo (refused when the item changed since): `state`, `comment`, `create` (also Break down's batch and creates from a conversation, promise or meeting), `target_date` (with Start Date), `description_update` (appends) and `description_edit` (full before and after shown), `assign_to_me`, `fields` (Ahead's change set: start, target, state (a state the item's type has in the process), size, assignee (anyone on the client's DevOps project; only Cooptimizers get FocusTime's quiet note)), `comment_edit` (your own comment in this week's status report window), and attachment uploads only as part of a create from a conversation. Work items are never deleted; undoing a create sets the item to its type's removed state with a comment. A write is refused for an item the shared `canEdit` rule doesn't allow and for automation accounts.

**Failure.** Without a write PAT a client stays read only and shows "Enable DevOps writes". A read failure shows that client's DevOps as unavailable with DevOps's own error code; bodies, headers and PATs are never shown or logged.

## Dataverse

**Auth.** Client credentials on a separate read-only app registration with a Dataverse application user (`sources/dataverse/source.ts`, scope `<environment>/.default`). The secret is the Key Vault secret `ft-dataverse-client-secret`.

**Read.** Focus Time rows (each person's recurring focus blocks), accounts (clients), account workers (who is on which client), users, time off (Time Off Tracker details; each person's own as PTO, teammates' only as "away"), the company read PAT per client at DevOps fetch time, the status report's last send time, and Cooptimize's observed holidays (the Working Days Calendar, `coop_workingdayscalendars`: date, name and the observed flag only, SR-3; the reader role still needs Read on it). **Not verified:** the full column list per table; see `sources/dataverse/`.

**Written.** Nothing.

**Failure.** The week shows the last good snapshot with its age, or "Dataverse isn't set up" with the fix.

## Google Calendar

**Auth.** Optional, per person: OAuth with `https://www.googleapis.com/auth/calendar.events.readonly` on the "FocusTime Web" Google client (`sources/oauth/oauth.ts`). Client secret: the Key Vault secret `ft-google-client-secret`. The refresh token is sealed in `user_secrets`.

**Read.** Your personal events, counted against free time; shown or hidden with the Personal events switch.

**Written.** Nothing.

**Failure.** "Connect Google Calendar" or "Reconnect"; everything else works without it.

## Calendar links (ICS)

**Auth.** None: a calendar's subscription link (an ICS address) carries its own access, so FocusTime treats the link as a secret (CAL-1). Each person adds their own in Settings › Accounts and calendars › Calendars added by link; it is sealed in `calendar_links` and never shown again (only its host).

**Read.** One https GET of the link (`server/ics-fetch.ts`, behind the SSRF guard in [Security](security.md#calendar-links-the-ssrf-guard-cal-1)), parsed with `ical.js` (`sources/ics/parse.ts`): recurrences (RRULE, RDATE, EXDATE, RECURRENCE-ID overrides) expanded from 8 weeks back to 26 ahead, the feed's VTIMEZONE or an IANA TZID, all-day events as dates, cancelled instances dropped. The instances go into the same calendar events as Outlook's and Google's (`sources/ics/source.ts`), personal or work as the person set. Busy only (the default) keeps no titles. Read at most every 15 minutes per link while FocusTime reads the week, and at once on Refresh; conditional with ETag (If-None-Match) or Last-Modified, and a 304 keeps what is stored. Nothing is fetched in the background.

**How fresh each provider is.** FocusTime's 15 minutes is on top of how often the provider rebuilds its feed:

| Provider | Where the link is | Lag (provider side, not FocusTime's) |
|---|---|---|
| Google Calendar | Settings › the calendar › Integrate calendar › Secret address in iCal format | Google updates its iCal feeds on its own schedule, often hours behind; ETag supported |
| Outlook.com, Outlook on the web | Settings › Calendar › Shared calendars › Publish a calendar › ICS | Usually minutes to an hour; Exchange's published calendars can lag more |
| iCloud | Share the calendar › Public Calendar (webcal://) | Usually minutes; the host can change (p01 to p123), and iCloud redirects, which is followed (re-checked) |
| School and activity apps | "Subscribe", "iCal" or "ICS" | Varies; some serve the calendar as `text/plain` or `application/octet-stream`, accepted when the body is a calendar |

These lags are typical behavior, not tested by FocusTime; when a provider is slow, Refresh only reads what the provider serves.

**Written.** Nothing, ever.

**Failure.** The link's line in the status says what happened with its last good events and their age: "Family: The link stopped working" with Replace link (404, 410, 401, 403, not a calendar, or a blocked address), or a passing problem with Retry (a timeout, the network). Everything else works without it.

## Azure Resource Manager (My VM)

**Auth.** Delegated `user_impersonation`: your own Azure access, nothing more.

**Read and written.** A fixed allowlist checked before any token is asked for (`ALLOWED` in `sources/azure/client.ts`): find VMs by the owner tag (Resource Graph), read the VM and its instance view, read its auto-shutdown schedule, read a start's progress, and **start** the one VM you confirmed. Nothing else: never stop, never any write to the auto-shutdown schedule.

**Failure.** The VM chip says Unknown, with the reason kind; Azure's own messages are never shown (they can name principals).

## The AI provider

**Auth.** An OpenAI API key, the Key Vault secret `ft-openai-key` (the developer's keyring in the developer loop). No key means "AI isn't set up" and everything else works.

**Models.** `gpt-6-luna` by default for text (Admin › AI may change it) and `gpt-transcribe` for push-to-talk (`server/appconfig.ts`). Background tasks run on OpenAI's Flex tier (`conversations.update`, `promises.extract`, `asks.classify`, `meeting.capture`; `ai/tiers.ts`), falling back to standard after a few tries; everything a person waits for runs on standard. Requests are sent with `store: false`.

**Sent.** Only through `ai/` after the guard (see [Security](security.md#ai-the-guard-and-redaction)): one client per request, structured output only.

**Failure.** A typed error with a plain reason (AI isn't set up, a cap is reached, the client doesn't allow AI, the guard refused it; `ai/types.ts`); an answer that fails its schema is never shown and never retried.

## GitHub (Cooptimize's standards)

KB-1. FocusTime reads Cooptimize's public standards repo (`cooptimize/coop-standards` by default; repo and branch in Admin › Standards) so AI drafts and Ask can use it. `sources/github/standards.ts`.

- **Read only and anonymous.** Every request is a GET with no token, no cookies and no redirects, to `api.github.com` (the default branch, its head commit, the file list) or `raw.githubusercontent.com` (one Markdown file at that commit). FocusTime never writes to the repo in any way: no commits, branches, pull requests, issues or comments.
- **Data only.** Only paths that can be articles are fetched. Scripts, hooks, `standards.yml` and the retired `standards/` and `deprecation/` folders are never downloaded, and nothing from the repo is executed, imported or evaluated.
- **What's kept.** Active articles (`status: active` front matter) with their path, front matter, SHA-256 and the repo commit, in the app tables `standards_articles` and `standards_sync`.
- **When.** Once at startup, hourly while FocusTime is in use, and on Sync now. An unchanged commit reads no files. A failure keeps the last good copy and shows the error in Admin › Standards.
- **Limits.** 60 anonymous API requests an hour per IP on GitHub's side; a check uses two.

## The Teams bot

**Auth.** An Azure Bot (free tier) whose identity is a user-assigned managed identity (`ft-<env>-bot-id`): no secret anywhere. Teams signs each message and the SDK checks it (`server/teams/sdk.ts`); replies use the identity's token. The bot asks for no Graph permissions.

**Read.** The messages people send it in their own 1:1 chat.

**Written.** Only in the person's own 1:1 chat: replies, card updates, and, with "Let FocusTime message me in Teams" and that kind on, the morning brief, check-in, close out and nudges. Never a group chat or channel. Every outside write it offers is a proposal card that runs only on Confirm.

**Who.** Cooptimizers who have signed in to FocusTime once, matched by Entra object id. Guests, automation accounts and addresses outside the Cooptimize domains get "FocusTime is for Cooptimize accounts." (`server/teams/gate.ts`).

**Failure.** If Teams says the person blocked or removed the app, their switch turns off and Settings says so. A dev environment waking from zero may miss Teams' 10 to 15 second window; the person sends again (see [Operations](operations.md#troubleshooting)).

## Web Push

**Auth.** The app's VAPID key, the Key Vault secret `ft-vapid-key` (`server/webpush.ts`). **Sent.** A notification's title and route to the person's own subscribed devices. **Not verified:** which push services each browser uses; that's the browser's choice.
