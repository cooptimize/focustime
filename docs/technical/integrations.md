# Integrations

For engineers working on a source and IT reviewing what FocusTime asks for. Checked against `2f4c0ea` on Nov 13, 2026; shared deployments against the DP-3 branch on Nov 18, 2026.

Every outside system is read only, except the named writes listed for each one below. Each source reports its own status (`ok`, `auth_required`, `unreachable`, `misconfigured` or `error`, `week/types.ts`). When one fails, people see that source's last good data with its age, or a plain message and the fix ("Connect Google Calendar", "Open Settings"), and the rest of FocusTime keeps working. Nothing stands in for a failed source: a real session never shows demo data.

Every outside request has a time limit, after which it gives up and counts as failed:

| System | Request | Gives up after |
|---|---|---|
| Microsoft Graph | Calendar reads, free/busy, people suggestions, meetings and transcripts, writes, Close the loop's sends | 20 seconds |
| Microsoft Graph | Chat lists and messages, presence, photos | 15 seconds |
| Microsoft Graph | A chat image | 30 seconds |
| Microsoft Graph | Group membership (admin check), mailbox settings at first sign-in | 10 seconds |
| Microsoft identity | Token refresh | 20 seconds |
| Azure DevOps | Reads (items, process, teams, the poll) | 15 seconds |
| Azure DevOps | Writes and the identity check; Code's repo reads | 20 seconds |
| Dataverse | Every read | 20 seconds |
| Google Calendar | Every read | 20 seconds |
| Calendar links | Each request, and each of at most 3 redirects | 15 seconds |
| Azure Resource Manager | Every request | 20 seconds |
| Pocket | The one list call, tried once | 15 seconds |
| OpenAI | Standard requests and push-to-talk | 30 seconds (`[ai] timeout_ms`) |
| OpenAI | Flex requests | 120 seconds a try, 90 seconds of tries before falling back to standard |
| GitHub | Every read | 20 seconds |
| Web Push | Each send | 10 seconds |

## Microsoft Entra ID and Microsoft Graph

**Auth.** One Microsoft sign-in on the "FocusTime" web app registration (single tenant, Cooptimize only), OpenID Connect with authorization code and PKCE (`server/auth/entra.ts`). The client secret is the Key Vault secret `ft-entra-client-secret`. Sign-in asks for `openid profile email offline_access` and Graph's `.default`, so it gets the delegated permissions granted on the registration. Further token kinds (presence, photos, chats, messages, meetings, Azure) each ask for their own scopes on the same refresh token (`sources/oauth/oauth.ts`). The refresh token is sealed in the person's `user_secrets`; access tokens stay in memory.

**Permissions.** All delegated: FocusTime always acts as the signed-in person, never app-only. The list lives in three places that must agree: `plan/permissions.ts` (what Settings › Accounts and calendars shows), `GRAPH_SCOPES` in `infra/scripts/app-registration.sh` (what the registration requests and the tenant grant covers) and the scope constants in `sources/oauth/oauth.ts`. `scripts/tech-docs.test.ts` fails when one of them names a permission missing here.

| Permission | API | Admin consent | Granted how | What it is for |
|---|---|---|---|---|
| `openid`, `profile`, `email`, `offline_access` | OpenID | No | Tenant grant | Who signed in, and a refresh token |
| `User.Read` | Graph | No | Tenant grant | Who you are; whether you are in the FocusTime Admins group |
| `Calendars.ReadWrite` | Graph | No | Tenant grant | Reading your calendar; writing only FocusTime's own events (a shared deployment's hold among them, on your own calendar, never an invite), your own events with no other attendees, help invites and your replies to invitations |
| `MailboxSettings.Read` | Graph | No | Tenant grant | Your working hours and time zone |
| `Presence.ReadWrite` | Graph | No | Tenant grant | Setting your own Teams status while focus runs |
| `Presence.Read.All` | Graph | No | Tenant grant | Teammates' availability, as a word |
| `ProfilePhoto.Read.All` | Graph | Yes | Tenant grant | Profile photos of you and the Cooptimizers on screen |
| `Chat.ReadBasic` | Graph | No | Tenant grant | Names and members of your group chats, to register a client chat; never messages |
| `Chat.Read` | Graph | No | Each person, when they first need it | New messages in registered client chats, read for everyone on them who follows the client, and their call started and ended events; never posts |
| `ChatMessage.Send` | Graph | No | Each person, when they first send from Close the loop | Posting my update, as me, in the client chat a promise came from or in a 1:1 chat with someone at Cooptimize, only after the preview and Send; an admin's invite to a Cooptimizer who hasn't signed in |
| `Chat.Create` | Graph | No | With `ChatMessage.Send` | Starting (or finding) the 1:1 chat with someone at Cooptimize; Graph returns the existing chat when there is one |
| `Mail.ReadWrite` | Graph | No | Each person, when they first create an email draft | Creating the Outlook draft of my update in my own mailbox and reading back that one message; an admin's invite as a draft |
| `Mail.Send` | Graph | No | Each person, when they first choose Send now | Sending that draft from my mailbox when I chose Send now; never any other message |
| `OnlineMeetings.Read` | Graph | Yes | Tenant grant | Finding a registered client call from its join link |
| `OnlineMeetingTranscript.Read.All` | Graph | Yes | Tenant grant | The transcript of a registered client call, for its reviewers |
| `user_impersonation` | Azure Service Management | No | Tenant grant | Your own VM, with your own Azure access |
| `Calendars.ReadBasic` | Graph | No | The old desktop registration only | The developer loop on the old "Coopilot Desktop" registration (`sources/oauth/oauth.ts`); the hosted app uses `Calendars.ReadWrite` |

**Read.** Your calendar view and free/busy of teammates (`getSchedule`: free or busy and working hours only), mailbox settings, presence (`getPresencesByUserId`), photos, chat names and members, registered chats' messages and their images (on view), registered meetings and their transcripts, and attendees of your own meetings in a client's email domain for promise suggestions (names and addresses only) (`sources/graph/`).

**Your calendar.** `/me/calendarView` for the week, in your time zone, with `$select` (`GRAPH_SELECT` in `sources/graph/source.ts`): subject, start, end, all day, show as, your response, cancelled, whether you organize it, its attendees (counted only, never kept) and `type` ([event](https://learn.microsoft.com/en-us/graph/api/resources/event): `singleInstance`, `occurrence`, `exception` or `seriesMaster`). Of `type` only a yes or no is kept, whether the event is one of a series (`repeats` on the event, DY-1's repeat mark); nothing is guessed from a title. Since WK-6 also `iCalUId` (the same for every attendee, one per occurrence), held with the week (`CalEvent.key`, in the person's week snapshot beside its titles) to tie a call to its meeting, never in the plan store or the browser's storage. No body, location or series id is read.

**Co-working calls.** The same `GET /chats/{id}/messages` read the shared poll already makes brings each registered chat's call system events: a chatMessage whose `eventDetail` is `callStartedEventMessageDetail` or `callEndedEventMessageDetail` ([system messages](https://learn.microsoft.com/en-us/graph/system-messages)). FocusTime goes by `eventDetail`, since `messageType` may be `systemEventMessage` or `unknownFutureValue`. Only a call or a Meet now counts, not a screen share. From each event only the call id, the event's time, the starter's user id and tenant and, for an end, its duration are kept (`chat_calls`). A call with no end event is treated as ended 10 hours after it started. Call events never reach the conversations pipeline, the Inbox, promises or the AI (`plan/cowork.ts`). Join and Start a call only open the chat in Teams; FocusTime never starts, joins or posts in a call.

**Client calls.** Registration reads the admin's own calendar: the next 5 weeks (`/me/calendarView`, filtered in code), the online occurrences that belong to a series, then each series master once (`/me/events/{id}`, at most 40); a pasted link is found the same way. Transcripts of registered Automatic calls only, with a person's own `OnlineMeetings.Read` (`/me/onlineMeetings?$filter=JoinWebUrl eq '…'`) and `OnlineMeetingTranscript.Read.All`; [calltranscript-get](https://learn.microsoft.com/en-us/graph/api/calltranscript-get) says the transcript "is also available to users who are part of the meeting calendar invite", so a reviewer on the invite reads it like the organizer. A failed call is one kind (signin, consent, missing, refused, busy, setup), logged as a kind and answered in plain words; never a token, header, body, link or id.

**Calls (MC-2).** FocusTime reads a call's transcript only when the call is registered by an admin, when FocusTime scheduled it, or when a Cooptimizer who was on it asks FocusTime to review it, on their press, for that one call. Your other calls come from the person's own calendar only (`/me/calendarView` for their last 14 local days, `iCalUId`, subject, times, `isAllDay`, `isCancelled`, `isOrganizer`, `responseStatus`, attendees and `onlineMeeting.joinUrl`), read when Calls opens and kept nowhere; a teammate's calendar is never read. Review checks the call on the presser's calendar again (`callAt`, by its iCalUId around its start), keeps it, and Get it from Teams opens a press (`actions/call-press.ts`, in memory, for that person, that call's join link and the online meeting it resolves to, one try, 2 minutes at most). The meetings client's gate asks the press first, then the registry, before every request; the job never presses, so no unregistered call is read in the background. The same permissions as client calls: [onlinemeeting-get](https://learn.microsoft.com/en-us/graph/api/onlinemeeting-get) takes an attendee's own `/me/onlineMeetings?$filter=JoinWebUrl eq '…'`, and the [transcripts APIs](https://learn.microsoft.com/en-us/graph/api/onlinemeeting-list-transcripts) are open to users on the invite; a 403 (`GraphAccessToTranscriptsDisabled`, the organizer's choice) is said as Not allowed. A call organized outside Cooptimize, or not online, is never asked for. No new permission.

**Written.** Only through the write framework:

- **Outlook.** FocusTime's own events (the marker), the time and show-as of your own events with no other attendees, help invites to Cooptimize addresses, and your accept, tentative or decline on a meeting someone else invited you to (Graph's accept, tentativelyAccept and decline only, never a PATCH, DELETE or cancel of their meeting).
- **Teams presence.** Your preferred presence from the focus timer (`setUserPreferredPresence` Busy or DoNotDisturb with an expiry, and `clearUserPreferredPresence`).
- **Close the loop**, only after its preview and Send, as you: one Teams message in the chat the promise came from or a 1:1 chat with someone at Cooptimize (`POST /chats`, `POST /chats/{id}/messages`, read back with `Chat.Read` when granted), or one email in your own mailbox (`POST /me/messages` as a draft, `POST /me/messages/{id}/send` only for Send now, read back by its immutable id). Never reactions, read marks, edits or deletes, and never a message you didn't preview (`sources/graph/send.ts`; setup in `docs/setup/close-the-loop.md`).
- **An admin's invite** from Admin › People: the same requests and the same per-person consents, one 1:1 Teams message per person, or an Outlook draft or email, only to Cooptimizers who haven't signed in, after the invite's preview and Send, each read back (`actions/invite-send.ts`).

**Failure.** A missing consent shows in Settings › Accounts and calendars as needs consent or needs an admin, with where to allow it. An expired sign-in shows Reconnect. A failed calendar read shows the last good data and its age. A read still going after 3 s answers from that last good copy, marked unreachable with its time, and finishes in the background to refresh the copy (Outlook and Google, not calendar links or Dataverse).

## Azure DevOps

**Auth.** Two kinds of personal access token, each wrapped in `Pat` (prints as `[PAT]`) and sent only as the Authorization header to `https://dev.azure.com/<org>/` (`sources/devops/pat.ts`):

- **Read PAT**: the company's token per client, read from Dataverse (`coop_devopstoken`) only at read time, never kept and never used on the write path.
- **Write PAT**: a person's own token per client (Work Items read and write), entered in Settings › Clients, checked against their DevOps identity (`_apis/connectionData`) before it's saved, sealed in `user_secrets` as `devops-write-pat:<client>`.

**Read.** Work items (WIQL, batch reads), the process (backlog levels, types, states, fields), backlogs and team settings, team members (`_apis/projects/{project}/teams/{team}/members`, once a day, kept in memory per client, for Backlog's assignee list; groups, service accounts and deleted identities left out; never another client's project), classification nodes. DevOps is read centrally by the `devops_poll` job with changed-since reads and a change log (`sources/devops/`, `devops_items`, `devops_changes`). Each client has a version that moves only when a check stores a change; open pages ask for the versions every 30 seconds (a background call that never counts as use) and reread only what moved. Refresh asks for a check now (30 seconds apart per client, shared by everyone). Settings › DevOps › Find an item answers from the store only, the same for an item that doesn't exist and one in a project FocusTime doesn't read.

**Written.** Only the named writes in `actions/devops-write-actions.ts`, each with preview, a `test` on `/rev`, read back, the audit log and undo (refused when the item changed since), with the person's own write PAT for that client:

| Write | What it changes |
|---|---|
| `state` | The item's state, with an optional comment |
| `comment` | A new comment |
| `meeting_create`, `meeting_comment` | A client call's new item (the New form's create, `new_item`, with its required-field check, from the proposal's fields) and its comment (refused unless the item is at story level in the client's process); confirming settles the call's proposal (MC-1e) |
| `comment_edit` | My own comment inside this week's status report window, before and after shown |
| `comment_delete` | My own comment inside the report window; undo posts its text again |
| `create` | A new item from a draft, Break down's batch, a conversation, a promise or a client call; from a conversation also its images as attachments (linked in the same patch; undo removes the links, never the attachment) |
| `create` from the New form | `POST _apis/wit/workitems/$<type>`: any type on the project's backlog levels, an optional parent one level up, assigned to me, nobody or someone on the client's project. The type's fields are read first (`_apis/wit/workitemtypes/<type>/fields`) as a first hint; then DevOps checks the create without saving it (below), and its answer wins. The three optional answers go in at create only: "Where:" and "What should change:" in the description, "How will we know it's right?" in the acceptance criteria field (or the description when the type has none) |
| `target_date` | Target Date, with Start Date in the same patch when set |
| `description` | Appends to the description for a clear scope change, or (`description_edit`) a full edit with before and after shown |
| `assign` | Assign to me (Take one), its previous assignee shown |
| `fields` | Backlog's change set for one item: title, parent (an open item one level up in the same project, or none; the link only), start, target, the size field, assignee (anyone on the client's project), state (one the type has). Never the backlog order |
| `remaining_work` | Remaining Work in hours, from Close out's end of day offer or Wrap it up, on a type whose process has the field |
| `item_edit` | Title, description (repro steps for a bug) and acceptance criteria, only the parts that changed |
| `reparent` | Moves the item under another parent, or none |
| Send feedback | A story under the FocusTime feature in Cooptimize's own DevOps (`FOCUSTIME_FEEDBACK_*`), as the person, with their write PAT for that project's client; a 10 minute preview; at most 10 a day (`actions/feedback-actions.ts`) |

**Checking a new item (RQ-1).** Before any create is previewed (`devops.preview`, in one place for every kind that makes `op:"create"`, and Send feedback's preview), FocusTime sends the same `POST _apis/wit/workitems/$<type>` with the same patch and the person's write PAT, plus `validateOnly=true` (`checkCreatePath` and `checkCreate` in `sources/devops/write.ts`, the only builder, which can't send it without the flag). DevOps answers 200 without saving, or 400 with the rule errors: every field when `customProperties.RuleValidationErrors` lists them, otherwise the first one ("TF401320: Rule Error for field <name>."), and FocusTime checks again as fields are filled, a few times at most. Fields named are marked Needed; a field FocusTime has no control for is said in words. The check is not a write: no audit log, no undo, and the log has only `op: "check"`, `kind: "create"`, the status and the time. When the form or row opens, `devops.needed` makes the same check with only a title (kept about 10 minutes per person, client, type and patch); if it can't be made, nothing is said and the check at preview decides. Updates of existing items are not checked.

Work items are never deleted; undoing a create sets the item to its type's removed state with a comment. A write is refused for an item the shared `canEdit` rule doesn't allow and for automation accounts.

**Editing on the story card.** Each edit is one `PATCH _apis/wit/workitems/<id>` (`application/json-patch+json`) behind `{"op":"test","path":"/rev","value":<the rev read>}`, so DevOps applies all of it or none, and any newer revision (a comment included) is refused with nothing written.

- `item_edit`: `add` on `/fields/System.Title`, `/fields/System.Description` (`Microsoft.VSTS.TCM.ReproSteps` for a bug) and `/fields/Microsoft.VSTS.Common.AcceptanceCriteria`; an emptied field is a `remove`. A field DevOps stores as Markdown is read and written with API `7.2-preview.3`, the only version with `multilineFieldsFormat`, so it stays Markdown; FocusTime never converts a field. Reads fall back to 7.1 (everything HTML) when the preview version is refused. Undo writes the old values back, only while DevOps still shows FocusTime's.
- `reparent`: `remove` on `/relations/<i>` for each `System.LinkTypes.Hierarchy-Reverse` link (highest index first), then `add` on `/relations/-` with the new parent's url, or nothing for No parent. The single patch behind the revision test keeps the item from ever having two parents. Undo moves it back, only while it is still under the parent FocusTime chose.
- Neither touches area, iteration, state, dates, assignee or backlog order.

**Code.** The read-only Code tab reads each client's repos with the same company read PAT, from Dataverse at each read and dropped after it, through the shared DevOps limiter. The token needs **Code (read)**; it is added to each client's token by hand. The token is sent only to `https://dev.azure.com/<org>/` and, for Search inside files, `https://almsearch.dev.azure.com/<org>/`. The reader (`sources/devops/git.ts`) can build only these GETs under `https://dev.azure.com/<the client's org>/<its registered project>/_apis/git/` with `api-version=7.1` (its `ALLOWED` list; anything else throws before a request):

- `repositories`: the project's repos (id, name, default branch, disabled or not, web link).
- `repositories/{id}/items?scopePath=<folder>&recursionLevel=OneLevel&versionDescriptor…`: one folder level on the default branch.
- `repositories/{id}/items?scopePath=/&recursionLevel=Full&versionDescriptor…`: every file name, for Find, By kind and Search names (up to 20,000).
- `repositories/{id}/items?path=<file>&includeContentMetadata=true&versionDescriptor…`: a file's commit and whether DevOps marks it binary or an image.
- `repositories/{id}/items?path=<file>&versionDescriptor.version=<commit>&versionDescriptor.versionType=commit` with `Accept: application/octet-stream`: the file's bytes, at most 1 MB (a larger `Content-Length` isn't read at all). Git LFS pointers show as they are.

By kind and Search names make no other request: for one client they read the repo list and each repo's file names, four repos at a time, and sort the names into kinds in `plan/code-kinds.ts` without opening a file. A search across clients asks for three clients at a time, each its own request; the shared limiter adds no wait of its own (it only holds a client DevOps told to wait), so 5 clients with 4 repos each are 25 requests in two rounds.

Search inside files makes one more request, the only one outside `dev.azure.com/<org>/…/_apis/git/` (`buildSearch`; anything else throws before a request):

- `POST https://almsearch.dev.azure.com/<the client's org>/<its registered project>/_apis/search/codesearchresults?api-version=7.1` with a body of exactly `searchText` (the words), `$skip` 0, `$top` (100 at most), `includeFacets` false and `includeSnippet` false. This is Azure DevOps's documented [code search request](https://learn.microsoft.com/en-us/rest/api/azure/devops/search/code-search-results/fetch-code-search-results); it needs the same Code (read) scope (`vso.code`, which "also grants the ability to search code") and Microsoft's Code Search extension in the client's organization.

FocusTime reads from the answer each file's path, repo id, branch names and number of matches, and the total and info code; it never asks for a snippet and never reads a file to search it. A file is listed only when its repo is one of the client's own and it was found on that repo's default branch. What each file is comes from the repo's file names (the Find read, from memory when it is there). With the SQL kind chosen and more files than one answer holds, a second request adds DevOps's own `ext:sql` filter. Nothing of the words or the answer is kept, not even in the 5-minute memory. Answers: no Code Search extension (a 404) says code search isn't turned on there and who can add it; a refused token says Code (read) is needed; info codes 1, 2, 6, 7 and 9 say DevOps is still indexing; 3, 4, 5, 19 and 20 and a 400 say DevOps couldn't run the search as written; 429 says busy. DevOps searches only each repo's default branch unless that organization added more, and never forks.

The organization and project come from the client's Dataverse account, never from the browser; a repo id must be in that client's own list; a path travels only as a query value and can't leave the repo (`cleanPath`). A token without Code (read) shows "FocusTime can't read <client>'s code yet. The company DevOps token for <client> needs Code (read)."; 429 says DevOps is busy; 404 says not found. The log lines carry the read's name, its status and how long it took, never a path, a repo name, a client or the words of a search.

**Failure.** Without a write PAT a client stays read only and shows Enable DevOps writes. A read failure shows that client's DevOps as unavailable with DevOps's own error code; bodies, headers and PATs are never shown or logged.

## Dataverse

**Auth.** Client credentials on a separate read-only app registration with a Dataverse application user (`sources/dataverse/source.ts`, scope `<environment>/.default`). The secret is the Key Vault secret `ft-dataverse-client-secret`.

**Read.** Focus Time rows (each person's recurring focus blocks), accounts (clients), account workers (who is on which client), users, time off (Time Off Tracker details; each person's own as PTO, teammates' only as "away"), the company read PAT per client at DevOps read time, each client's status report last send time (`accounts.coop_statuslastsenton`), and Cooptimize's observed holidays (the Working Days Calendar, `coop_workingdayscalendars`: date, name and the observed flag only). **Not verified:** the full column list per table; see `sources/dataverse/`.

**Written.** Nothing.

**Failure.** The week shows the last good snapshot with its age, or "Dataverse isn't set up" with the fix.

## Google Calendar

**Auth.** Optional, per person: OAuth with `https://www.googleapis.com/auth/calendar.events.readonly` on the "FocusTime Web" Google client (`sources/oauth/oauth.ts`). Client secret: the Key Vault secret `ft-google-client-secret`. The refresh token is sealed in `user_secrets`.

**Read.** Your personal events, counted against free time; shown or hidden with the Personal events switch. `events.list` with `singleEvents=true` and a field list (`GOOGLE_FIELDS` in `sources/google/source.ts`): id, status, title, show as, start, end, your own response, and `recurringEventId` ([events](https://developers.google.com/calendar/api/v3/reference/events)), read only to know whether the event is one of a series (DY-1). Of that id only a yes or no is kept (`repeats` on the event); the id itself is never kept, logged or sent.

**Written.** Nothing.

**Failure.** Connect Google Calendar or Reconnect; everything else works without it.

## Calendar links

**Auth.** None: a calendar's subscription link (an ICS address) carries its own access, so FocusTime treats the link as a secret. Each person adds their own in Settings › Accounts and calendars › Calendars added by link; it is sealed in `calendar_links` and never shown again (only its host).

**Read.** One https GET of the link (`server/ics-fetch.ts`, behind the guard in [Security](security.md#calendar-links-the-ssrf-guard)), parsed with `ical.js` (`sources/ics/parse.ts`): recurrences expanded from 8 weeks back to 26 ahead, the feed's time zones, all-day events as dates, cancelled instances dropped. The instances join Outlook's and Google's events, personal or work as the person set. Busy only (the default) keeps no titles. Whether an instance is one of a series (DY-1's repeat mark) isn't kept for a calendar added by link: its instances are stored in columns and keeping it would need a migration, so these events show no repeat mark yet (docs/open-questions.md, DY-1). Read at most every 15 minutes per link while FocusTime reads the week, and at once on Refresh; conditional with ETag or Last-Modified, and a 304 keeps what is stored. Nothing is fetched in the background.

**How fresh each provider is.** FocusTime's 15 minutes is on top of how often the provider rebuilds its feed:

| Provider | Where the link is | Lag (provider side, not FocusTime's) |
|---|---|---|
| Google Calendar | Settings › the calendar › Integrate calendar › Secret address in iCal format | Google updates its iCal feeds on its own schedule, often hours behind; ETag supported |
| Outlook.com, Outlook on the web | Settings › Calendar › Shared calendars › Publish a calendar › ICS | Usually minutes to an hour; Exchange's published calendars can lag more |
| iCloud | Share the calendar › Public Calendar (webcal://) | Usually minutes; the host can change, and iCloud redirects, which is followed (re-checked) |
| School and activity apps | "Subscribe", "iCal" or "ICS" | Varies; some serve the calendar as `text/plain` or `application/octet-stream`, accepted when the body is a calendar |

**Not verified:** these lags are typical behavior, not tested by FocusTime; when a provider is slow, Refresh only reads what the provider serves.

**Written.** Nothing, ever.

**Failure.** The link's line says what happened, with its last good events and their age: "The link stopped working" with Replace link (404, 410, 401, 403, not a calendar, or a blocked address), or a passing problem with Retry (a timeout, the network). Everything else works without it.

## Azure Resource Manager (My VM)

**Auth.** Delegated `user_impersonation`: your own Azure access, nothing more.

**Read and written.** A fixed allowlist checked before any token is asked for (`ALLOWED` in `sources/azure/client.ts`): find VMs by the owner tag (Resource Graph), read the VM and its instance view, read its auto-shutdown schedule, read a start's or stop's progress, and two writes on the one VM you confirmed: **start**, and **deallocate** (`POST …/deallocate`, api-version 2026-04-01: it shuts the VM down and ends compute billing). The writes take no query parameter but api-version. Nothing else: never power off without deallocating, restart, delete or resize, and never any write to the auto-shutdown schedule.

**Unattended start.** With Start my VM before my day on, the production server starts your VM before your day without you there, with your own delegated access: your stored Microsoft sign-in is redeemed for an Azure Resource Manager token held in memory for that call. No app-only access and no Azure role for FocusTime. When that sign-in can't be used, the VM stays off and FocusTime says so once.

**Failure.** The VM chip says Unknown, with the reason kind; Azure's own messages are never shown (they can name principals).

## Pocket (a person's own recorder)

PK-2, MC-2b. Pocket's public API (`https://public.heypocketai.com/api/v1`, [docs.heypocketai.com/docs/api](https://docs.heypocketai.com/docs/api), read Nov 17 and Nov 18, 2026).

**Auth.** The person's own Pocket API key (`pk_…`), sent as `Authorization: Bearer`. Each person pastes their own in Settings › Accounts and calendars › Pocket recorder; there is no admin step and no key for the whole organization. The key is sealed in their `user_secrets` (account `pocket-key`) and never shown again. Pocket's docs describe organization API keys with scopes (`recordings:read` among them) and no way to tell a personal key from an organization one, so FocusTime can't refuse an organization key; the guide asks for a key made for the person alone, reading recordings only.

**Read (PK-2: the check).** One call: `GET /api/v1/public/recordings` with `start_date`, `end_date`, `page=1` and `limit=1` (`sources/pocket/client.ts`). FocusTime reads only `pagination.total`, the number of recordings in the last 7 days (UTC dates, as Pocket reads them); the one listed recording in the answer (Pocket sends its title, transcript and summaries with it) is dropped unread. Every other method, host, path or parameter is refused before the key is read or the network is used (`allowedPocketCall`). Only on a person's press: Check and save, Check again.

**Read (MC-2b: my recordings in Calls).** Two more GETs, and nothing else (`allowedPocketCall` names three: `count`, `list`, `recording`):
- **The list**, on Get my Pocket recordings (`meeting.pocket_list`): `GET /public/recordings?start_date&end_date&page&limit=100` for Calls' last 14 days (UTC dates), pages 1 to 3 at most; past 300 it stops and says so. Pocket's docs offer no field filter, so each record comes with its transcript and summaries: FocusTime reads `recorded_by.email` first, drops a record whose recorder isn't the person (any address FocusTime knows them by, or the one recorder when every listed recording has the same one) unread and only counts it, and from a kept record reads only `id`, `recording_at` (UTC), `duration` (seconds) and `title`. The list is held 5 minutes in the server's memory for that person (`createPocketHold`, `actions/meeting-pocket.ts`) and in the page's memory while Calls is open.
- **One recording**, on Continue with Use my Pocket recording (`meeting.pocket_bring`): `GET /public/recordings/{id}?include_transcript=true&include_summarizations=false`, only for an id from the person's own held list, onto a call they review that it overlaps for at least half the call's length (checked on the server before Pocket is asked; a call with a transcript asks first). The answer is read up to 20 MB; from it only each segment's `start`, `end`, `speaker` label and `text`, and `duration`. Speakers become Speaker 1, Speaker 2 (never `speakerName`); line times are kept where Pocket gives them (the docs give no unit: seconds, read as milliseconds when the last end runs far past the recording's length). A recording more than 10 minutes longer than its call brings in the lines during the call plus 5 minutes either side unless the person chose all of it; without line times the setup says the whole recording comes in and how long it is before a second Continue. Then the upload's line rules (`linesOf`), the transcript store (`transcript_kind` `pocket_api`) and the same AI pass.
- **A recording with no call** (`meeting.pocket_add`) becomes a call only the person sees (as one added by hand) from the held list, without asking Pocket; its transcript then comes in as above.

Never in the background, on a schedule, on page load, from the assistant or the Teams bot, in any environment (no entry in `config/background-policy.ts`).

**Written.** Nothing, ever: no upload, no change.

**Logs.** Source `pocket`, the call's kind (count, list, recording), its status or failure kind and its time; the actions log only their outcome. Never the key, a title, an id, a count, a date or any of Pocket's answer.

**Failure.** One try with a time limit; each failure in its own words with what to do: the key wasn't accepted (401, 403), Pocket didn't answer (a timeout, the network, a 5xx), Pocket is busy (429, 503), or Pocket answered in a way FocusTime doesn't understand (any other answer, or one without a total). A failed Check and save saves nothing; a failed Check again keeps the connection. A recording over 20 MB says so (`too_long`). In Calls, a failure keeps whatever list was there and says why.

## The AI provider

**Auth.** An OpenAI API key, the Key Vault secret `ft-openai-key` (the developer's keyring in the developer loop). No key means "AI isn't set up" and everything else works.

**Models.** `gpt-6-luna` by default for text (Admin › Team defaults › AI may change it) and `gpt-transcribe` for push-to-talk (`DEFAULT_AI` in `server/appconfig.ts`). Background tasks run on OpenAI's Flex tier (`conversations.update`, `promises.extract`, `asks.classify`, `meeting.capture`; `FLEX_TASKS` in `ai/tiers.ts`), falling back to standard after 3 tries or 90 seconds; everything a person waits for runs on standard. Requests are sent with `store: false`.

**Sent.** Only through `ai/` after the guard (see [Security](security.md#ai-the-guard-and-redaction)): one client per request, structured output only.

**Failure.** A typed error with a plain reason (AI isn't set up, a cap is reached, the client doesn't allow AI, the guard refused it; `ai/types.ts`); an answer that fails its schema is never shown and never retried.

## GitHub (Cooptimize's standards)

FocusTime reads Cooptimize's public standards repo (`cooptimize/coop-standards` by default; repo and branch in Admin › Team defaults › Standards) so AI drafts and Ask can use it (`sources/github/standards.ts`).

- **Read only and anonymous.** Every request is a GET with no token, no cookies and no redirects, to `api.github.com` (the default branch, its head commit, the file list) or `raw.githubusercontent.com` (one Markdown file at that commit). FocusTime never writes to the repo.
- **Data only.** Only paths that can be articles are fetched. Scripts, hooks, `standards.yml` and the retired folders are never downloaded, and nothing from the repo is executed, imported or evaluated.
- **What's kept.** Active articles with their path, front matter, SHA-256 and the repo commit, in `standards_articles` and `standards_sync`.
- **When.** Once at start, hourly while FocusTime is in use, and on Sync now. An unchanged commit reads no files. A failure keeps the last good copy and shows the error in Admin › Team defaults › Standards.
- **Limits.** 60 anonymous API requests an hour per IP on GitHub's side; a check uses two.

## The Teams bot

**Auth.** An Azure Bot (free tier) whose identity is a user-assigned managed identity (`ft-<env>-bot-id`): no secret anywhere. Teams signs each message and the SDK checks it (`server/teams/sdk.ts`); replies use the identity's token. The bot asks for no Graph permissions.

**Read.** The messages people send it in their own 1:1 chat.

**Written.** Only in the person's own 1:1 chat: replies, card updates, and, with "Let FocusTime message me in Teams" and that kind on, the morning brief, check-in, close out, nudges and client calls to review. Never a group chat or channel. Every outside write it offers is a proposal card that runs only on Confirm.

**Who.** Cooptimizers who have signed in to FocusTime once, matched by Entra object id. Guests, automation accounts and addresses outside the Cooptimize domains get "FocusTime is for Cooptimize accounts." (`server/teams/gate.ts`).

**Failure.** If Teams says the person blocked or removed the app, their switch turns off and Settings says so. Dev waking from zero may miss Teams' 10 to 15 second window; the person sends again (see [Operations](operations.md#troubleshooting)).

## Web Push

**Auth.** The app's VAPID key, the Key Vault secret `ft-vapid-key` (`server/webpush.ts`). **Sent.** A notification's title and route to the person's own subscribed devices. **Not verified:** which push services each browser uses; that's the browser's choice.

History: when each system was added and the Microsoft Learn pages checked for it are in [docs/decisions.md](../decisions.md).
