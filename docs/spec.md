# FocusTime | First Slice Spec v0.1 (Milestones 1 and 2)

October 31, 2026. Status: proposed, not authorized. Reads with Discovery Brief v0.3 and Build Plan v0.3.

## 0. Machine inventory

The first slice was built on one Linux developer machine (Node 26 through mise, Chromium, SQLite, a Secret Service
keyring). Since A1 that machine is only the developer loop (`system/README.md`); FocusTime itself is a hosted web app,
and its environment is in `docs/azure/A0-inventory.md`. The original inventory is in the git history of this file.

## 0b. Dataverse mapping (read from schema metadata, Oct 31; no rows read)

Environment: `https://cooptimize.crm.dynamics.com`, Web API v9.2.

**Focus Time** = `coop_focustime` (entity set `coop_focustimes`). Each row is a recurring weekly assignment, not a single half-day:

| Column | Type | Meaning (my reading, to confirm) |
|---|---|---|
| `coop_account` | Lookup → account | Client |
| `coop_systemuser` | Lookup → systemuser | Person doing the work |
| `coop_accountworker` | Lookup → coop_accountworker | Person-on-client link (has `coop_devopsemail`) |
| `coop_startdate`, `coop_enddate` | Date Only | Range the pattern applies to. Date Only means no time zone shifting |
| `coop_mondaydaypart`, `coop_tuesdaydaypart`, `coop_wednesdaydaypart`, `coop_thursdaydaypart` | Choice `coop_focustimedaypart`: 1=AM, 2=PM, 3=All Day | Which half of each weekday. Blank = not that day |
| `coop_focustimeindays` | Decimal | Weekly days of focus (derived; useful as a check) |
| `statecode` | State | Use active rows only |
| `coop_daypart`, `coop_thursday`, `coop_workday` | Choice, labeled "Deprecate" | Ignore |

There is no Friday column. Cooptimize works a four-day week, Mon–Thu (confirmed).

Expansion rule (confirmed): for each active row overlapping the week, for each weekday Mon–Thu between start and end date, emit an AM block, a PM block, or both (All Day) for that client and person. **A blank end date means ongoing** (25 of 49 active rows, Oct 31).

**Person and client (corrected Oct 31):** the Account Worker link is the reliable source for both. `coop_systemuser` is filled on only 13 of 49 active rows and Focus Time's own `coop_account` on only 2 of 25 ongoing rows, while all 25 ongoing rows have an Account Worker with a user and an account. Person = `coop_AccountWorker/coop_user`, client = `coop_AccountWorker/coop_account`, each falling back to the Focus Time column. The first user had 4 ongoing patterns (verified Oct 31). The app identifies the user by their `systemuserid` (resolved once at setup from their Entra object ID via `systemuser.azureactivedirectoryobjectid`, stored in their settings), never by name matching. The name match in the test script was a one-off shortcut.

**Identity isolation (found Oct 31):** the application user inherits roles from its business unit's default team ("Cooptimize": Project User, Project Common, Roadmap User), so it could read Contacts despite its own narrow role. Fix: place the application user in a child business unit (e.g. "FocusTime Integrations") whose default team has no roles; Coopilot Reader at Organization depth still reads org-wide.

**Friday (confirmed need):** not a scheduled workday, but available as an overflow and catch-up day for missed focus time. The week view shows Friday as a distinct, lighter overflow column with meetings and personal events but no focus blocks from Dataverse. Moving slipped work onto Friday arrives with the plan layer (Milestone 3).

**Internal (confirmed fact, open proposal):** Cooptimize exists as an account with DevOps settings, but internal focus time is usually not recorded. Decided: Mon–Thu half-days with no focus block show as "Open", meaning available for client or internal work.

**Standing blocks (per user, none by default since A1):** for example Monday AM as fixed Internal (Cooptimize) focus time. Implemented as a setting `standing_blocks = [{ day = "Mon", half = "AM", client = "Internal" }]`, labeled as coming from FocusTime config rather than Dataverse. If Dataverse has a client block in the same half-day, the client block shows and the slot is flagged "double-booked" so the conflict is visible. Recording internal focus time in Dataverse is a possible team practice change, not part of this slice.

**Client and DevOps config** = `account`: `name`, `coop_reportingnickname` (likely short name for UI), `coop_devopsorg`, `coop_devopsprojectid`, `coop_devopsprojectname`, `coop_devopsteam`, `coop_devopstoken` (PAT). Also present but out of scope: Teams IDs, invoice fields.

**Possibly useful later:** `coop_timeofftracker` / `coop_timeofffact` (time off as a risk source), `coop_workingdays` / `coop_workingdayscalendar` (holidays).

**Security finding:** `coop_devopstoken` has column security **off** (`IsSecured=false`, though it can be secured). Any identity with read on Accounts can read every client's PAT today. See D24.

## 1. User story

On Monday morning I open FocusTime and see this week as a grid of half-days. Each half-day shows my focus block (client or Internal, colored), my Outlook meetings and my personal Gmail events layered on top. Half-days at risk are highlighted with a plain reason, such as "3h 15m of meetings inside the Tailspin & Wingtip block". I can see where each item came from and when it was fetched. If Google sign-in has expired, the rest of the week still shows, with a clear "Reconnect Google" path.

## 2. Non-goals for this slice

- ~~No plan layer, dragging, ignition, triage, recap, capture or drafts (Milestones 3 and 4).~~ Step 5 (Oct 31) adds the local plan store, morning planning (now Plan the day) and local draft stories (section 19). Still no dragging, triage, recap or capture.
- No AI provider calls. The whole slice works without AI.
- ~~No DevOps reads and no PAT access.~~ Superseded by step 4 (Oct 31): read-only DevOps work items assigned to me, PATs read per fetch (D59–D66). Still no DevOps writes.
- No writes to Dataverse, Outlook, Google or anywhere else.
- No teammate focus blocks on screen (fetch only the user's rows).
- No remote desktop, Azure VM, Teams or Coop integration.
- No desktop key binding or shell plugin. ~~No autostart.~~ Step 5 adds a systemd user service and an XDG autostart entry (D79); since A1 these are the developer loop only.

## 3. Architecture map

One local app, modules in one codebase:

```
ui/            Week grid, source status bar, settings/connect screens
actions/       Dispatcher: named actions with validated input/output (UI and future chat call these)
week/          Normalize + slot model + risk rules (pure, no I/O)
sources/
  dataverse/   Focus blocks (read-only, app user)
  graph/       Outlook calendarView (read-only, delegated)
  google/      Google Calendar events.list (read-only)
secrets/       Keyring get/set/delete; nothing else touches secrets
config/        Non-secret settings (TOML), validated at load
cache/         Last good snapshot per source per week (no secrets)
```

Rule: `week/` never does I/O and never sees tokens. `sources/` returns normalized data or a typed error, never throws raw HTTP errors to the UI.

## 4. Core types (illustrative)

```ts
type SourceId = "dataverse" | "outlook" | "google";

type SourceResult<T> = {
  source: SourceId;
  status: "ok" | "auth_required" | "unreachable" | "misconfigured" | "error";
  fetchedAt: string | null;      // ISO 8601 with offset
  fromCache: boolean;
  items: T[];
  message?: string;              // human-readable, no tokens, no raw response bodies
  fixAction?: "connect_google" | "connect_microsoft" | "open_settings";
};

type FocusBlock = { id: string; clientKey: string; clientName: string;
  date: string; half: "AM" | "PM"; status?: string; source: "dataverse" };

type CalEvent = { id: string; source: "outlook" | "google"; title: string;
  start: string; end: string; allDay: boolean; showAs?: "free"|"tentative"|"busy"|"oof"|"unknown";
  isPersonal: boolean };

type Slot = { date: string; half: "AM" | "PM"; start: string; end: string;
  focus: FocusBlock[]; events: CalEvent[]; risks: Risk[] };

type Risk = { rule: "meeting_load" | "personal_conflict" | "no_focus_window" | "double_booked_block";
  severity: "watch" | "at_risk"; reason: string };
```

## 5. Action contracts

| Action | Input | Output | Side effects | Errors |
|---|---|---|---|---|
| `week.load` | `weekStart` (Monday, local date) | `{ slots, sources: SourceResult[] }` | Reads sources, updates cache | Never fails whole; each source reports its own status |
| `week.risks` | `weekStart` | `Risk[]` per slot | None (pure over loaded data) | None |
| `source.status` | none | `SourceResult` summary per source | None | None |
| `auth.connect_microsoft` | none | `ok` or error | Opens browser sign-in, stores refresh token in keyring | Cancelled, consent denied |
| `auth.connect_google` | none | `ok` or error | Same, Google | Same |
| `auth.disconnect` | `SourceId` | `ok` | Deletes that source's keyring entries and cache | None |

Inputs validated (zod or equivalent). Unknown action names rejected. These are the only actions in this slice.

## 6. Half-day and risk rules (deterministic)

**Half-days are units of commitment, not fixed clock windows (confirmed).** A real day: start around 9:00, sometimes a break mid-afternoon, then either resume or stop, flexing into the evening, another day or Friday.

So the slice uses a soft "day shape" in config only to place meetings and events into AM or PM and to estimate capacity: default start 09:00, AM/PM split 12:30, usual end 17:00, America/New_York. Events outside that shape (evenings) are shown, not hidden. Risk is about how much of a half-day's usable time is consumed, not about exact hours.

**Borrowed time (confirmed problem, proposal for Milestone 3):** A consultant sometimes makes up a slipped block in the evening or later in the week, outside focus time, and that borrowing can pile up unnoticed. Proposal: when a block slips, the recap or triage records it as borrowed time with a planned repayment (evening, another day, Friday). The week view shows the running total so overcommitment is visible early. Not part of Milestones 1–2.

Proposed v1 rules, thresholds in config:

1. **Meeting load:** busy/tentative meeting minutes inside a focus block ≥ 90 → watch, ≥ 150 → at risk. Reason names the minutes and block. FocusTime's own time boxes on Outlook (the tb- marker, or recorded as FocusTime's) and events I organize with no other attendees aren't meetings and don't count (D508).
2. **Personal conflict:** any personal (Google) timed event overlapping a focus block → at risk. All-day personal events → watch.
3. **No focus window:** no contiguous free gap ≥ 90 minutes inside the block → at risk. Time boxes and events with no other attendees are free for this rule; planning (free gaps, Timebox my day) still treats them as taken (D508).
4. **Double-booked block:** more than one focus block in the same half-day → at risk.

Events marked free are ignored. Declined Outlook events are excluded. Rules are pure functions with table-driven tests.

## 7. Data and secret boundaries

| Data | Where it lives | Notes |
|---|---|---|
| Dataverse focus blocks (the user's rows only) | Memory + cache file | Cache holds only normalized fields |
| Outlook events | Memory + cache | Subject, times, showAs, response status. No bodies, no attendee lists in this slice |
| Google events | Memory + cache | Title, times, all-day flag |
| Tenant ID, client IDs, environment URL, table/column names, half-day hours, colors | `~/.config/focustime/config.toml` | Not secret, but not committed to a public repo |
| Dataverse app credential (prefer certificate) | Keyring (Secret Service) | Never on disk in plain text |
| Microsoft and Google refresh tokens | Keyring | Access tokens in memory only |
| DevOps PATs | Memory only, for one DevOps fetch | Read from Dataverse by `devopsTargets` only, wrapped in `Pat`; never logged, cached or returned (D60) |
| DevOps work items (assigned to me) | Memory + cache per client | Id, title, type, state, state category, board order, parent id, changed date, URL. No PAT, no identity email |

Never logged: tokens, secrets, Authorization headers, raw HTTP bodies. Logs record source, status code, duration, item count. A test asserts that a fake token passed through every code path never appears in logs, cache or error messages.

If a local HTTP server is used: bind 127.0.0.1 only, check `Host` and `Origin`, require a per-launch random token for every request.

## 8. Auth approach (proposed decision D21, agreed)

- **Dataverse:** dedicated app registration + Dataverse application user with a custom security role granting **read on the focus block table only** (and the client table if needed for names/colors). Certificate credential stored in keyring. This keeps FocusTime from inheriting the user's admin rights.
- **Outlook (Graph):** dedicated public-client app registration, **delegated** sign-in as the user, scope `Calendars.ReadBasic` (Microsoft lists it as least privileged for calendarView). Application permissions would cover every mailbox in the tenant unless separately restricted in Exchange, so delegated is the tighter choice for one person's calendar.
- **Google:** desktop OAuth client, loopback redirect with PKCE, scope `calendar.events.readonly` (or `calendar.events.owned.readonly` if only the user's own calendars matter). Note for setup: Google OAuth apps left in "Testing" status issue refresh tokens that expire after about a week; confirm current behavior when setting up and decide whether to publish the app for internal personal use.

## 9. Failure states (each visible in the source status bar)

| Situation | What the user sees | Recovery |
|---|---|---|
| Google refresh token expired/revoked | Google events greyed out, "Google needs reconnecting", last cached time | Reconnect button runs `auth.connect_google` |
| Microsoft sign-in needed | Same pattern for Outlook | `auth.connect_microsoft` |
| Dataverse 401/403 | "Dataverse access denied: check app user role" | Link to settings and setup doc |
| Network down | All sources show cached data with timestamps, banner "Offline, showing data from 08:02" | Retry button |
| Config missing or invalid | Settings screen naming the bad field | Edit config |
| Dataverse table/column renamed | "Focus block table not found: check config" | Settings |
| Keyring locked/unavailable | "Secret storage unavailable" with which service | Unlock keyring, retry |
| Partial pages (Graph nextLink failure) | Source marked error, not silently truncated | Retry |

## 10. Files and configuration changes

Created by the slice (after authorization):
- Repo: `~/Code/focustime` (path to confirm)
- Config: `~/.config/focustime/config.toml`
- Cache: `~/.cache/focustime/` (safe to delete anytime)
- Keyring entries under service name `focustime`
- Optional: `~/.local/share/applications/focustime.desktop` (a launcher entry)

Not touched: the desktop's own configuration, existing browser profiles, remote desktop profiles, any existing keyring entries.

Outside the machine (an admin does these in Entra/Dataverse, Claude can write the click-path):
- App registration "Coopilot Dataverse Reader" + application user + custom read-only role + column security on PAT column
- App registration "Coopilot Desktop" (public client, delegated `Calendars.ReadBasic`)
- Google Cloud project with Calendar API enabled and a desktop OAuth client

## 11. Dependencies

Pinned at install time after checking current releases. Shared by both stack options: TypeScript, React, Vite, zod, MSAL (`@azure/msal-node` or equivalent), Google auth library, a keyring binding for Secret Service, Vitest, Playwright for UI checks. Option-specific additions in section 13.

## 12. Install and rollback

Install: clone/create repo, install deps locally in the repo, run setup to write config and connect accounts. No global packages beyond what the chosen runtime needs (via existing package manager or mise).

Rollback: stop the app, run `auth.disconnect` for each source (or delete `focustime` keyring entries), remove repo, `~/.config/focustime`, `~/.cache/focustime`, and the optional .desktop file. In Entra/Google: delete the app registrations or revoke consent. Nothing else changes, so nothing else needs reverting.

## 13. Stack options (inventory done: A recommended)

**A. Local TypeScript app in a browser app window (recommended for the first slice).** Runs on the existing Node 26 and Chromium with no system-level installs.
A small Node or Bun backend on 127.0.0.1 serves a React UI, opened as an app-style Chromium window.
- For: one language, fastest feedback loop, Chromium rendering, Playwright can inspect the exact UI, easy to maintain, chat panel later is just another client of the same actions.
- Against: it's a browser window, not a "real" app; a localhost server needs the hardening in section 7; keyring access via a native Node binding.

**B. Tauri 2 desktop app (Rust core, same React UI).**
- For: native window and lifecycle, no open local port, secrets and HTTP stay in Rust, small footprint.
- Against: two languages; WebKitGTK rendering and its Wayland/GPU quirks; heavier build toolchain; slower iteration while the product is still being discovered.

Both keep the same `actions/`, `week/` and UI, so moving from A to B later means replacing the thin host layer. A desktop shell plugin was a later candidate for a quick-capture hotkey; the hosted app (A1) makes it moot.

## 14. Acceptance steps

1. With config and all three accounts connected, `week.load` for the current week shows real focus blocks, Outlook meetings and Gmail events, each labeled by source with a fetched-at time.
2. Revoke Google consent: Google shows "needs reconnecting", Dataverse and Outlook still display, reconnect restores it.
3. Disconnect the network: cached week shows with an offline banner and timestamps.
4. A half-day with ≥ 150 meeting minutes inside its focus block is flagged at risk with the minutes in the reason.
5. A personal event inside a focus block is flagged with the event time in the reason.
6. Week grid is fully usable by keyboard: arrow keys move between half-days, Enter opens details, `t` jumps to today, `[` and `]` change week.
7. Grep of logs and cache after a full run finds no token, secret or Authorization header.
8. Dataverse app user cannot read the PAT column (verified with a deliberate read attempt that must fail).
9. Real UI inspected on a wide monitor layout via screenshot; no AI provider needed for any step.

## 15. Tests that matter

- Normalization: Dataverse rows → `FocusBlock` (date-only vs UTC DateTime behavior), Graph events with time zones and all-day, Google all-day and timed events, recurring instances.
- Risk rules: table-driven, including edge cases at block boundaries and events spanning AM/PM.
- Source failure isolation: one source erroring never blanks the others.
- Secret handling: token never appears in logs, cache, errors or UI.
- Config validation: clear message for each missing or invalid field.

## 16. Open questions

Blocking this slice:
- Q1. ~~Dataverse schema~~ Resolved, see 0b. Verified Oct 31 (step 2): all 9 of my rows have an Account Worker with user and account, while only 2 have `coop_systemuser` filled in, so the Account Worker link is the right source.
- Q1b. ~~Open vs Internal~~ Open.
- Q2. ~~Half-day hours~~ Soft day shape, see section 6.
- Q3. ~~Machine inventory~~ Done, see section 0.
- Q4. Agree to D21 auth approach. Dataverse part is done and working (step 2); Outlook and Google are built (step 3, D48) and wait on real sign-in.
- Q5. ~~Stack~~ Option A.

Schema confirmation without installing anything: while signed into the Cooptimize Dynamics environment in Chromium, open
`https://<org>.crm.dynamics.com/api/data/v9.2/EntityDefinitions(LogicalName='<table>')?$select=LogicalName,EntitySetName&$expand=Attributes($select=LogicalName,AttributeType)`
This is a read-only GET using the existing browser session. Alternatively, view the table's columns in the Power Apps maker portal.

Not blocking this slice:
- AI provider choice (needed from Milestone 4).
- Per-client DevOps config location (needed for Milestone 6, but PAT column security should be set now).
- Teammate focus display.
- Client color choices (defaults until chosen).

Raised in step 1 (not blocking):
- Q6. Which client is on which pattern? The sample guesses Mon AM Proseware, Mon PM + Tue PM Adatum, Tue AM Internal, Wed All Day + Thu AM Tailspin & Wingtip. Real data replaces this in step 2.
- Q7. ~~All-day and OOO Outlook events~~ Resolved in step 3 (D54): out of office puts covered half-days at risk; other all-day Outlook events are a watch only if busy.
- Q8. ~~Personal events on Open half-days~~ Resolved in step 3 (D54): shown, never flagged.
- Q9. The kickoff folder and zip (`coopilot-kickoff/`, `coopilot-kickoff.zip`) are still in the repo folder and git-ignored. Their docs were copied to the repo root. Delete them when you're happy.

Raised in step 2 (not blocking):
- Q10. The internal account's nickname is "Cooptimize", and that is what the grid shows. Should it show as "Internal" (the glossary word) instead?
- Q11. ~~Sample meetings over real blocks~~ Resolved in step 3 (D53): sample meetings show only for a calendar with no config section. Sample meetings now sit on top of your real focus blocks, so some risk badges this week come from sample meetings. Keep that until step 3 (as now, labeled sample), or hide sample meetings once Dataverse is live?

Raised in step 3 (not blocking):
- Q12. Google publishing status. Google requires a homepage and privacy policy URL to switch an External app to production, so FocusTime stays in Testing for now. In Testing, Google ends the sign-in after 7 days and the status bar asks to reconnect. Option: two small public pages (for example on GitHub Pages) to unlock production. Decide after living with weekly reconnects.
- Q13. Ranking of double-booked block and all-day event in the single badge (D58) was my placement, not requested. Confirm or reorder.

Raised in step 4 (not blocking):
- Q14. T&W has no DevOps email on my Account Worker row, so T&W shows "DevOps identity missing". Fill in `coop_devopsemail` in Dataverse to see T&W items.
- Q15. Adatum's `coop_devopsprojectid` in Dataverse does not match the real project ID (the name works, so FocusTime uses names first). T&W and Proseware have no project ID. Correct them in Dataverse if IDs are wanted.
- Q16. PAT column security (D24) matters more now that FocusTime reads PATs: any identity with read on Accounts can read every client's PAT. Consider securing `coop_devopstoken` and granting the FocusTime app user read on it only.
- Q17. Microsoft retires global PATs on December 1, 2026. Any client PAT created as a global PAT stops working then; recreate as organization-scoped PATs before that date.
- Q18. Some client processes put Blocked states in the Removed category (Proseware: Task "10-Blocked", User Story "07-Blocked"), so blocked items are hidden, as the metadata says. Keep that, or treat Blocked as open?
- Q19. Cooptimize items show because the Monday AM standing block is Cooptimize. If that block is removed, Cooptimize work only shows in weeks with a Cooptimize focus block. Always include it?

## 17. Decisions proposed this round

| ID | Status | Entry |
|---|---|---|
| D19 | Re-scoped | AI provider choice no longer blocks Milestones 1–2 |
| D21 | Proposed | Dataverse via app user with read-only custom role; Outlook via delegated `Calendars.ReadBasic`; Google via desktop OAuth `calendar.events.readonly` |
| D22 | Proposed | Stack option A for first slice, with a host layer thin enough to move to Tauri later |
| D23 | Done (step 5) | Cache last good snapshot as files; SQLite arrives with the plan layer (built in step 5, D71) |
| D24 | Superseded by D60 | PAT column security not a priority now (tokens are read-only). FocusTime now reads PATs for DevOps (step 4). Column security is still off, so any identity with read on Accounts can read every PAT (Q16) |
| D22 | Accepted | Stack option A (local TypeScript app in a Chromium app window) |
| D28 | Confirmed | Unassigned Mon–Thu half-days display as "Open" (client or internal) |
| D30 | Proposed | Monday AM is a standing Internal block from FocusTime config; Dataverse client blocks take precedence and raise a double-booked flag |
| D29 | Confirmed | Half-days are soft commitment units; day shape in config is for placement and capacity only |
| D26 | Confirmed | Workweek is Mon–Thu; Friday is an optional overflow/catch-up day shown separately |
| D27 | Confirmed | Focus Time rows are recurring weekly patterns expanded per week |
| D25 | In place, amending | Application user "Coopilot Dataverse Reader" with role Coopilot Reader: Read (Org) on Focus Time, Account, User; adding Account Worker. Token, connect and read verified Oct 31 |
| D31 | Done | Application user moved to its own business unit with no team roles; Contacts refused, only Coopilot Reader access (verified Oct 31) |
| D48 | Done | Outlook and Google sign-in is authorization code + PKCE (S256) through a one-shot listener on 127.0.0.1 with a random port, written with built-in `fetch`, `crypto` and `http`. No MSAL or Google client library. Redirects: `http://localhost` for Microsoft (registered under Mobile and desktop, any port matches) and `http://127.0.0.1:<port>/` for Google. The listener checks Host and `state`, then closes |
| D49 | Done | Refresh tokens live only in the keyring (`outlook-refresh-token`, `google-refresh-token`); access tokens only in memory. Microsoft rotates refresh tokens, so a new one replaces the old on every refresh. The Google desktop client secret is read from the keyring (`google-client-secret`) and FocusTime never writes or deletes it |
| D50 | Done | Scopes: Microsoft `offline_access Calendars.ReadBasic` (no body, attachments or attendees); Google `calendar.events.readonly`. Requests select only the fields used: Outlook `subject,start,end,isAllDay,showAs,responseStatus,isCancelled`; Google `id,status,summary,transparency,start,end,attendees(self,responseStatus)` (the self entry only matters, to detect my declines) |
| D51 | Done | Normalization: cancelled events and ones I declined are dropped. Outlook `workingElsewhere` counts as free, `tentativelyAccepted` and `tentative` as tentative. Google `transparent` counts as free. Outlook is fetched with `Prefer: outlook.timezone` set to the day shape zone; Google uses `singleEvents=true` over Mon 00:00 to Sat 00:00 local. Paging links are followed only when they stay on the provider API; a failed later page fails the whole fetch, so a partial week is never cached |
| D52 | Done | `auth.disconnect(outlook or google)` is local only: it forgets that source's refresh token, its in-memory token and its cached snapshots. It does not revoke the grant at the provider (revoking is a write; remove access in the account settings if wanted). Dataverse cannot be disconnected from the UI |
| D53 | Done | Sample meetings are used only for a calendar whose config section is missing or has an empty `client_id`. Once configured, that source is real (live, cached or needs sign-in) and never falls back to samples. The fixture stays for tests |
| D54 | Done | Q7 and Q8: an Outlook out-of-office event puts the half-days it covers at risk (timed: if it overlaps; all-day: the whole day). Other all-day Outlook events are a watch ("All-day event") only if busy or showAs is missing; free and tentative are ignored. Personal events on Open half-days and Friday show but never flag |
| D55 | Done | Status bar per calendar: LIVE, CACHED (with the snapshot time), NEEDS SIGN-IN with Connect or Reconnect, and Disconnect behind a confirm. While sign-in runs, the bar says to finish in the browser; it gives up after 5 minutes |
| D56 | Done | Freshness (step 3.5): the window refetches all sources when it regains focus (at most once per 60 s), quietly every 5 minutes while visible (a manual or focus refresh resets that clock), and on "r" or Refresh. Only one refresh runs at a time. Focus and background refreshes do not show "Loading" |
| D57 | Done | A refresh never blanks the grid: the data on screen stays until new data arrives. If the server cannot be reached, the last good week stays with "Could not reach the FocusTime server. Showing what was loaded earlier"; if a source fails, the server already returns its snapshot with the CACHED or error state. A slower older response never overwrites a newer one. The status bar shows "updated N min ago" per source (the exact time is in the tooltip) |
| D58 | Done | One badge per half-day card: the most serious risk, then "+N more". Order: at risk before watch; within a level out of office, personal conflict, double-booked block, no focus window, all-day event, meetings. Double-booked and all-day event were not in the requested order; they sit where shown. The details panel lists every reason in the same order |
| D59 | Done | The week view shows personal assigned work: DevOps work items assigned to me, open (state category not Completed or Removed), any type, no sprint filter, in each client's focus blocks. Ownership (epics and features I own, contributors' progress, target dates) is a separate future area, not this view |
| D60 | Done | PATs: Dataverse `devopsTargets(clientKeys)` is the only query that selects `coop_devopstoken`. It runs at DevOps fetch time, only for clients with a block this week, only for accounts I am an active Account Worker on, and wraps each PAT in `Pat` at once (String, JSON and inspect show `[PAT]`). The cached focus block path never selects it. The PAT is used only to build `Authorization: Basic base64(":" + PAT)` for `https://dev.azure.com/<org>/`, with redirects not followed. Not kept between fetches |
| D61 | Done | Identity per client = my Account Worker `coop_devopsemail`, used as `[System.AssignedTo] = '<email>'` in WIQL. Blank means "DevOps identity missing for <client>" and no call. Verified Oct 31: matches in the Cooptimize, Proseware and Adatum orgs |
| D62 | Done | Open = per work item type, states whose category (from that project's `workitemtypes` metadata) is not Completed or Removed. WIQL has one clause per type, since state names differ per type ("Ready for Go-live" is Completed for Bug but Resolved for Issue in one real project). Items are re-checked after the batch |
| D63 | Done | Board order = `typeFields.Order.referenceName` from the project's process configuration (StackRank or BacklogPriority), detected per project. No order field: sorted by last change. Unranked items go last. Type, state and order metadata are kept in memory for 1 hour |
| D64 | Done | API: api-version 7.1. WIQL (`$top=1000`, ids only) then `workitemsbatch` (200 ids per call, documented maximum) for System.Id, Title, WorkItemType, State, Parent, ChangedDate and the order field, `errorPolicy: omit`. The item link is built as `https://dev.azure.com/<org>/<project name>/_workitems/edit/<id>`. Project paths use the project name first, then the ID: Adatum's stored ID is wrong and two accounts have none (Q15) |
| D65 | Done | Isolation: each client is fetched in its own try/catch and cached in its own file (`devops/<slug>-<hash>.json`, items only). Results are keyed by exact client key, the same key focus blocks use (`clientKeyOf`: nickname, else name); two accounts with one key are refused, not merged. A block shows only its own client's items; Open half-days and Friday show none. If DevOps fails as a whole, the week still loads |
| D66 | Done | Failure messages: "DevOps PAT expired or invalid for X" (401, 203, redirect or non-JSON), "No access to DevOps project P for X" (403, 404), "DevOps organization O unreachable" (network), "DevOps identity missing for X", "DevOps not set up for X (missing ...)", "No Account Worker for X in Dataverse", "DevOps settings unavailable (Dataverse ...)". Failures fall back to the client's last good items with their time |
| D67 | Done | Refresh: DevOps follows the step 3.5 triggers, throttled more because items do not depend on the week: a normal load (changing weeks) reuses results up to 5 minutes old; a forced refresh refetches a client at most once a minute; metadata is cached for 1 hour. That keeps a refresh to about 2 DevOps calls per client and avoids refetching on every week change |
| D68 | Done | UI: each block shows its client's top 3 items by board order and "+N more"; the details panel lists all, each a link that opens in a new browser tab (only `https://dev.azure.com/` links). The status bar has one "DevOps N of M live" entry; hover or click for each client's status and message |

## 18. Backlog (not built)

- **End-of-day recap (next step):** built around closing loops (D92). It lists the follow-ups opened today and what would close each, from the day's picks, slipped or moved blocks and blocked items, and lets me close one with an optional note. Proposal only; to be specified and authorized.
- **Waiting-on follow-ups:** things others owe me, the mirror of D92's follow-ups. Later.
- **AI layer (direction, D93):** interpret Teams, email and DevOps to detect follow-ups and synthesize context, staged as rules, then signals, then AI proposals I confirm, then an orchestrator, always through the same actions and confirmations.
- **Ownership area** (future, separate from the week view, see D59): epics and features I own, progress of the people contributing to them, and risk against target dates. Would need its own read model, likely per-client WIQL on ownership fields, and its own view. Not in the Look-ahead.

## 19. Step 5: morning planning, now Plan the day (authorized Oct 31)

Purpose: in about two minutes, turn today's real capacity into a short, committed plan per block, at story level. All local; no writes to DevOps, Outlook, Google or Dataverse.

- **Store:** SQLite through Node's built-in `node:sqlite` (no new dependency) at `~/.local/share/focustime/plan.db` (0600, folder 0700). Numbered migrations in `store/plan-store.ts`; timestamps carry offset and zone (`2026-11-03T08:41:00-05:00[America/New_York]`). Tables: `day_plans`, `picks`, `draft_stories`, `markers` (once-a-day flags). Export: `node scripts/plan-export.ts [file]`.
- **Actions** (validated, shared with the future chat): `planday.start(date, auto?)`, `planday.commit(date)` (renamed from ignition in step 6), `pick.add`, `pick.remove`, `pick.set_size`, `pick.move`, `pick.mark_done`, `draft.add_story`.
- **Flow:** today's column widens into the planning panel and the rest of the week dims. Each half-day shows client and free time from now on (after meetings and personal events), with fits, tight or over by X. Carry-over (unfinished earlier picks) sits at the top. Picks come from that client's DevOps items in board order, or a typed intention. Open half-days pick from any client you're an Account Worker on, plus Cooptimize (D81), and take the first pick's client; mixing clients is allowed but flagged. `c` commits; the picks then show as a checklist on the week view.
- **Story level:** pickable types come from each project's process backlog categories (requirement, task and bug), not type names. Epics, features and other portfolio levels (except types listed in `[plan] pickable_portfolio_types`, D80) open into their open children (any assignee, up to two levels, read with WIQL and the batch call). None: "Needs breakdown" and local draft stories, which stay local until a write step is authorized (D82).
- **Sizes:** S about 1 h, M about 2 h (default), L a whole block (about 3.5 h). Nothing above L: split it first.
- **Triggers:** on Mon–Thu the first window focus after 05:00 opens Plan the day once if today isn't committed; `p` (or `i`) opens it any time. One desktop notification (`notify-send`) between the day-shape start and 90 minutes after it if today isn't committed, once per day (D83).
- **Always on:** `~/.config/systemd/user/focustime.service` (from `system/focustime.service`, restart on failure) and `~/.config/autostart/focustime.desktop` (from `system/focustime-autostart.desktop`, runs `scripts/open-window.ts`).
- **Rollback:** `systemctl --user disable --now focustime && rm ~/.config/systemd/user/focustime.service ~/.config/autostart/focustime.desktop && systemctl --user daemon-reload`. The plan store can be removed with `rm -r ~/.local/share/focustime` (export first).

## 20. Step 5.5: desktop app, work item links, polish (authorized Oct 31; launch path is the developer loop and browser profiles were removed in A1)

- **Launch path (D85–D88):** `focustime-open` starts the service if needed, waits for it, then focuses the FocusTime window or opens it as a web-app window (own Chromium data directory, class `chrome-127.0.0.1__-Default`). A window from an earlier server run is replaced. Used by the launcher entry "FocusTime", a key binding and login autostart.
- **Links (D89, D90):** `link.open(clientKey, url)` checks the link is on that client's DevOps org, then starts Edge with the client's profile (`[edge]` in config) from an argument array. Unmapped clients open in the default browser with "No Edge profile set for <client>". Week cards, details, Plan the day picks and candidates all use it.
- **Polish (D91):** the source line is gone from cards in every layout; details keep it.
- **Recorded only:** Follow-up (D92), the AI direction (D93) and the end-of-day recap as the next step (section 18).
- **Files installed:** `~/.local/bin/focustime-open` (link to `system/focustime-open`), `~/.local/share/applications/FocusTime.desktop`, `~/.local/share/icons/hicolor/256x256/apps/focustime.png`, a desktop key binding, Exec line of `~/.config/autostart/focustime.desktop`, `[edge]` appended to `~/.config/focustime/config.toml`. Created on first open: `~/.local/share/focustime/browser` and `$XDG_RUNTIME_DIR/focustime/window-server-pid`.
- **Rollback:** remove the desktop key binding; `cp ~/.config/autostart/focustime.desktop.bak-step5 ~/.config/autostart/focustime.desktop`; `rm ~/.local/bin/focustime-open ~/.local/share/applications/FocusTime.desktop ~/.local/share/icons/hicolor/256x256/apps/focustime.png`; `rm -r ~/.local/share/focustime/browser`; `cp ~/.config/focustime/config.toml.bak-step55 ~/.config/focustime/config.toml` (or delete the `[edge]` section).

## 21. Step 6: navigation, menus, Plan the day, PTO, show-as (authorized Oct 31)

- **Top bar (D95):** views Week and Plan the day, with Plan the week, Check-in and Close out disabled ("coming soon"); week arrows, Today, Refresh, Commands (Ctrl K), Settings (disabled). On a weekend: "Today is Sat, Oct 31 · showing next week" (D96).
- **Menus (D102):** "⋯" and right-click on every block card, pick and work item. Anything a key does to an item, a menu does.
- **Command menu (D101):** Ctrl+K or the top-bar button; searchable; each entry shows its shortcut. Built from `actions/registry.ts`, the same list the dispatcher accepts, plus view and navigation commands.
- **Rename (D94):** ignition is Plan the day. `p` opens it, `i` is an alias.
- **Next workday (D97, D106, D107):** today on a workday before the usual end, else the next workday (Mon–Thu), skipping PTO days. Friday is not a target for now. The panel names the day and whether it is today or the next workday. No automatic open or reminder on a PTO day.
- **PTO (D98, D99, D105, D109):** my Time Off Tracker rows and their detail rows from Dataverse, read-only, dates only. Every PTO day is a whole day off: off style, "PTO · title", blocks dimmed, no risks, no picks. Detail rows give the days; a tracker without them covers every weekday from start to end. Source "PTO" in the status bar with cache and plain errors.
- **Schema errors (D108):** a missing or renamed Dataverse table or column (PTO, focus blocks, clients) shows as a named message in the status bar, found with read-only probes on my own rows.
- **Show-as and time (D100, D103):** busy, tentative, free, out of office and working elsewhere look different without relying on color; legend in details. Every card: "2h meetings · 2h 15m free · longest 1h"; Plan the day uses the same free number.
- **Rollback:** code only, plus store migration 2 (marker rename, harmless to keep). Revert the commit; no files outside the repo changed in this step.

## 22. Plan any day (authorized Oct 31)

- **Any date (D116):** Plan the day opens any date. The default target is unchanged (D97, D106). Entry points: "Plan this day" in each day header's ⋯ menu (also right-click on the header), ← → in the panel plus ‹ › buttons, and "Plan a day…" in the command menu (a date picker; also "Another date…" under Plan which day?).
- **Day rule (D117):** PTO days are refused with the reason. Days without working hours are refused with the reason; since step 6b a day has working hours from the time model, or a flex session (D127). Today and later days are fully plannable. Earlier days are past.
- **Past days (D118):** the panel becomes "Review": picks per block with a done tick and Drop, nothing else (no candidates, sizes, moves into the day, or commit). The server enforces it: `pick.add`, `pick.set_size`, `planday.commit` and moving into a past day are 409; a past pick may move forward to today or later (carrying it); `pick.remove` keeps a past pick as dropped, never deletes it. Past is judged by the server's clock.
- **Carry-over (D119):** offered only on the earliest upcoming day (today until the usual end, else tomorrow) that can be planned and isn't committed. Other days show where it is offered. Source: picks still planned in the 7 days before that upcoming day.
- **Contract change:** `PlanDayState` gains `access` ("plan" | "past") and `carryTarget`; `carryOver` is empty except on the carry-over day. `planday.start` and `planday.commit` can now refuse with 422. No new action, source or dependency.
- **Rollback:** code only; no migration and no files outside the repo.

## 23. Step 7: Check-in and Close out, built around closing loops (authorized Oct 31)

- **Close out (D146):** end of day, about 3 minutes, any day up to today (key E). Picks with focused time against size; not done: carry over, move, make it up, drop. Resume notes per client worked. Open follow-ups newest first, each closed in one step ("Mark as told…"). Commit Close out. Nothing blocks on an unreviewed day.
- **Follow-up rules (D147):** DevOps update (done pick, item still open; closes on a later fetch), slip heads-up (moved or dropped from a committed client block, template draft), blocker nudge (state or tag), flex session ended, and manual. Rules only, no AI, nothing posted.
- **Borrowed time (D150):** "I'll make it up" tonight, Friday or another day records minutes and payback; tonight or a weekend offers a local flex session. Paid when the pick is done or by hand. Week chip and Now strip.
- **Resume notes (D151):** latest per client wins, history kept; shown on the client's next block and in Plan the day.
- **Check-in (D152):** midday, about 1 minute (key M): each slot's time left after meetings, picks that no longer fit with the same actions, walk-on work.
- **Reminders (D153):** Close out near the end of the day, Check-in at the end of lunch, each once a day, offsets in Settings > Planning.
- **Contract change:** plan store migration 5 (D148); config `[plan] closeout_reminder_minutes`, `checkin_reminder_minutes`; DevOps `System.Tags` and a watched-by-id read (D149); actions `closeout.load`, `closeout.commit`, `pick.make_up`, `note.set`, `followup.add`, `borrow.pay`; `week.load` gains `resumeNotes`, `borrowed`, `closeOut`; `LoopView` gains who, kind, item, draft and close fields; `PlanDayState.resumeNotes`; `--clock` server flag (D154). All additive for existing callers.
- **Rollback:** revert the commit. Migration 5 only adds columns and tables; the pre-migration copy `plan.db.bak-v4-<stamp>` is next to the store. The two config keys are optional and can stay.

## 24. Step 8: Plan the week (authorized Oct 31)

- **Step 7 answers:** Q42 (D156), Q43 (D157), Q45 (D158), Q46 (D159).
- **Plan the week (D160):** tab and key W; next week by default (or the week a nudge asked for); any week; past weeks are a review.
- **Features and epics (D161, D162):** read-only, followed clients only; tiers from backlog levels; assigned to me or parent of my stories; state, target date (field detected per process), children with assignees, board order.
- **My share of time (D163):** blocks per feature or drop on blocks; fit per client after PTO, meetings, unavailable time and unpaid borrowed time: fits, tight, over. No sizing or forecasting.
- **Readiness (D164):** Block needs work, Needs breakdown, Needs features, No target date, one action each.
- **Coop brief (D165):** markdown from DevOps fields only, copied.
- **Commit the week (D166):** local, editable, re-committable; week cards and Plan the day show committed features first.
- **Summary strip:** open follow-ups, unpaid borrowed time, PTO days, flex sessions.
- **Nudges (D167):** Thursday, Friday, Monday, each once, configurable; tab badge until committed.
- **Contract change:** `System.ChangedBy` read (`changedByMe`, `assignedTo`, `targetDate` on items); a portfolio read and an on-demand description read; committed features read by id in `week.load`'s DevOps read; plan store migration 6; config `[plan] week_nudge_thu`, `week_nudge_fri`, `week_nudge_mon`; actions `weekplan.load`, `weekplan.set_feature`, `weekplan.place`, `weekplan.commit`, `feature.brief`, `feature.mark_breakdown`, `followup.ask_priorities`; `week.load` gains `weekPlan`, `weekFeatures`, `weekNudge`; `PlanDayState.weekFeatures`; `ClientWork.committed`; follow-up kind `priorities`. All additive for existing callers. Nothing is written to DevOps, Outlook, Google or Dataverse.
- **Rollback:** revert the commit. Migration 6 only adds tables; the pre-migration copy `plan.db.bak-v5-<stamp>` is next to the store. The three config keys are optional and can stay.

## 25. Step 9: Quick capture (authorized Nov 1)

- **Step 8 answers (D169):** Q47 per-client error with no story level; Q48 borrowed time by payback week; Q49 epics above followed up; Q50 skipped nudge fires at next working time; Q51 current DevOps titles.
- **Quick capture (D170):** one box, Enter saves locally at once, works offline. N, the top-bar Capture button, the command menu, `focustime-open --capture`.
- **Client tag (D171):** @nickname with autocomplete from followed clients, or a client select.
- **Routing (D172):** rules, no AI: promise → follow-up (who, what, due), work → draft story (optionally under a feature), else note. One click to confirm or change.
- **Inbox (D175):** the Capture view; "N unprocessed captures" in Close out; "Captures to sort" in Plan the week readiness; drafts under features in Plan the week.
- **Notes (D175):** per client, searchable, deletable, in the export.
- **Contract change:** plan store migration 7 (captures, notes, nullable draft parent; D173); actions `capture.add`, `capture.load`, `capture.features`, `capture.route`, `note.delete` (D174); `POST /api/open-request` and `focustime-open --capture` (D176); follow-up kind `capture`; `week.load`, `closeout.load` and `weekplan.load` return the unsorted count; `weekplan.load` returns local drafts. Still no writes to any external system.
- **Not done:** the global capture key (D178, needs confirmation).
- **Rollback:** revert the commit. Migration 7 adds tables and rebuilds `draft_stories` with the same rows; the pre-migration copy `plan.db.bak-v6-<stamp>` is next to the store.

## 26. Step 10: simpler, week → day → focus, focus mode and sounds (authorized Nov 1)

- **Navigation (D179 to D182):** Today is the default view; the top bar is Today · Week · Plan · Inbox plus Capture, Commands, Settings and the timer. Plan opens the ritual for the moment, with a switcher. Inbox merges follow-ups and unsorted captures. Every earlier key and command still works.
- **Quieter UI (D183, D184):** one status per card, details behind a click, a one-line status bar when all is well, plain words.
- **Week → day (D185 to D187):** Plan the week grid on top with a filtering click and Place target, chips and search, readiness folded. Plan the day one block at a time, committed features first, "Break down #id" and Copy Coop brief. "This week: #id" on cards and Today. A first-run hint.
- **Focus mode (D188):** a calm focus screen; the top-bar timer on every view; Start focus from Today, a pick and the Now strip.
- **Focus sounds (D189 to D191):** Web Audio sounds, Settings > Focus, saved playlists, playerctl pause and resume when installed.
- **Global capture key (D192):** a desktop key binding (developer loop).
- **Contract change:** optional `[focus]` table; `week.load` and `settings.load` return `focus` (and `week.load` returns `media`); `timer.start` takes `playlist`; new actions `media.status` and `playlist.open`; settings section `focus`. No store migration. Still no writes to any external system.
- **Rollback:** revert the step 10 commits, rebuild and restart the service; remove `[focus]` from config.toml if it was saved; remove the capture key binding.

## 27. Step 11: Plan the week by client, flexible musts, DevOps first (authorized Nov 1)

Principles: **DevOps first** (if it isn't in DevOps, it isn't planned yet; the healthy path is the easy path, without policing; re-planning never feels like failure) and **nothing machine-specific in core modules** (D194).

- **Week list per client (D195, D196):** each followed client (Cooptimize included) has a week list of DevOps features and stories, in stack rank order, split into Must and Nice to have. Local reorder only, with "Back to DevOps order". Fit counts musts against the client's free blocks: Fits, Tight, Too much (D199).
- **Pins (D198):** optional, for dependencies. The block grid stays on top and shows pins and each client's musts left.
- **Flexible (D197):** move, swap, demote or take off in one click, no reason. Dropping a must the week was committed with offers a heads-up follow-up and nothing else. Progress is against the current list.
- **Check-in:** "Anything shifted?" lists each client's open musts and nice to haves with one-click swaps and the on-track question.
- **Plan the day (D202):** musts first, then nice to haves, then the rest; pinned items first on their day; "Break down #id" for a must with no stories.
- **Tracking (D200, D201):** "Adatum: 2 of 4 musts done" from DevOps state, local done marks and done picks, in Today, the Week strip, Plan the day and Plan the week; midweek "Still realistic?" question.
- **DevOps health (D203):** top of Plan the week, folded to a count, one action each.
- **Contract change:** store migration 8 (backup first); `WeekFeature` gains `level`, `tier`, `position` (nullable) and `doneAt`, and `blocks` may be a half; new actions (D204); `weekplan.place` pins without raising blocks; `draft.add_story` takes `parentItemId: null`; `week.load` reads list items by id; Plan the day's `weekFeatures` carry the list fields. Still no writes to any external system.
- **Rollback:** stop the service, restore `plan.db.bak-v7-<stamp>` over `plan.db` (and remove `plan.db-wal`, `plan.db-shm`), check out the commit before step 11, rebuild and start the service.


## 28. Step 12: write framework, then timeboxing with optional Outlook blocks (authorized Nov 1)

- **Write framework (D206 to D211):** every external write is a named action with narrow inputs; Outlook is the only target. Preview first (system, account, calendar, every field before and after, who can see it), confirm, write, read back, then success; otherwise "Not confirmed" with Retry. FocusTime touches only events with its marker, never duplicates on retry, and logs every write with prior values in Settings > Data, with Undo.
- **Write access (D210):** optional. Without Calendars.ReadWrite timeboxes work locally and the toggle explains "Reconnect Outlook" in Settings > Connections. Reading keeps its own read-only token.
- **Timeboxes (D212, D213):** drag a pick or a must onto the day strip in Plan the day, or "Timebox…" (start, length). Move and resize by dragging or keys. They count as planned time in fit, and Start focus from a timebox runs for its length.
- **Put on Outlook (D211, D215):** per timebox, off by default (Settings). A Busy event "<client>: <item title>" with the DevOps link, no attendees, no reminder. Moving, resizing or removing updates or removes it after a preview; "Don't ask again for my own timeboxes" skips the question for those (still logged, still undoable).
- **Shown once (D214):** FocusTime's own events are dropped from the calendar read and never count as meetings; the timebox shows in the client color.
- **Contract change:** plan store migration 9 (backup first): `timeboxes`, `outlook_events`, `write_log`; config `[timebox]`; `WeekLoadData.timeboxes` and `timeboxSettings`; `SettingsData.timebox`; new actions `auth.connect_outlook_write`, `timebox.add/update/remove/set_outlook`, `write.status/preview/confirm/retry/log`; `timer.start` takes `timeboxId`; `ActionContext.host` (Q63) and `makeOutlook(...).write`; Graph reads send `IdType="ImmutableId"`.
- **Rollback:** stop the service, restore `plan.db.bak-v8-<stamp>` over `plan.db` (remove `plan.db-wal`, `plan.db-shm`), check out the commit before step 12, rebuild and start. Any FocusTime events already on Outlook can be removed first from Settings > Data (Undo, or Remove from Outlook), or by hand: they are titled "<client>: <item>" with the FocusTime body line.

## 29. Step 13: calendar editing tiers and the collaboration finder (authorized Nov 1)

Rule (the "calendar editing rule"): **FocusTime only edits what it created or what only I can see.** Every external write still goes through the step 12 write framework (preview, confirm, read back, audit log, undo).

- **Tiers (D217, `plan/caltier.ts`):** each Outlook event gets one tier from a write-token scan of the week (`isOrganizer`, attendee count, `type`, all-day, marker): *FocusTime* (marker `tb-…`: move, resize, retitle, show as, delete; the event and its timebox are one thing), *Invite* (marker `inv-…`: only Cancel, through undo), *Mine* (I organize, no other attendees, single, timed: move, resize, show as; title and body never touched, never marked), *Meeting* (anyone else on it: never edited, Open in Outlook). Google and unavailable time keep their own rules. The menu lists every action with a one-line reason on the disabled ones. Without write access nothing is editable and the reason says how to allow it.
- **Two-way sync (D218, `plan/outlooksync.ts`, `actions/outlook-sync.ts`):** on each Outlook refresh with write access, every marked event is compared with what FocusTime last wrote (`outlook_events.fields`) and with the timebox now. Outlook changed only → the timebox follows (time, day, title, show as; deleted → removed) with "Changed in Outlook" on it. Both changed → nothing is overwritten: the timebox holds Outlook's version as a conflict and shows both; Keep FocusTime's (then the usual preview) or Use Outlook's. Sync changes are logged as "from Outlook" (kind `sync`), not undoable from the log.
- **Q69 (D219):** a `tb-` marked event with no local record is rebuilt from the scan (record, and the timebox when it is missing too), so it never shows as a meeting.
- **Collaboration finder (D220 to D224, `plan/collab.ts`, `actions/collab-actions.ts`):** "Needs help from…" on a pick, a week list item, a timebox or a work item. Candidates are Cooptimize staff from Dataverse (`systemusers`: enabled, licensed, not application users, email from `internalemailaddress`, limited to the allowed domains), ranked: 1 on this client that day (Focus Time), 2 on this client (Account Worker, or Focus Time on other days), 3 anyone else. PTO from every tracker overlapping the range, dates only (never `coop_title`), shown as "away". Free/busy from Graph `getSchedule` (delegated, the read token, Calendars.ReadBasic): only `availabilityView` and `workingHours` are kept; `scheduleItems` are never read into anything. Slots inside my working hours, outside my meetings and personal events, everyone free inside their own working hours in their own zone, nobody away; ranked by tier, then minutes over my timeboxes, then time; at most 2 a day; up to 5.
- **Invite (D225):** a meeting on my calendar with the chosen Cooptimizers, "<client>: help on <item title>", body with the DevOps link and an optional note, Teams on by default, marker `inv-<uuid>`. The preview names every attendee and says they will receive an invite. Attendee domains must be allowed (checked at preview, at confirm and in the writer). Read back after create. Undo cancels it (`POST /me/events/{id}/cancel`, preview says attendees get a cancellation). The invite is kept on the item and opens a follow-up "Help session with <names> on <item>" that closes once the meeting has ended.
- **Contract change:** plan store migration 10 (backup first): `timeboxes.show_as`, `timeboxes.outlook_note`, `timeboxes.conflict`, `write_log.kind` (`timebox`, `event`, `invite`, `sync`), new table `invites`. `Fields.showAs` widens to Outlook's values and gains optional `attendees` and `teams`. `Timebox` gains `showAs`, `outlookNote`, `conflict`. `timebox.update` takes `title` and `showAs`; new `timebox.resolve {id, keep}`. `write.preview` also takes `{ event: {id, start?, end?, showAs?} }` (my own events) and holds invites made by `collab.preview_invite`. New actions `collab.candidates`, `collab.suggest`, `collab.preview_invite`, `outlook.open`. `WeekLoadData` gains `eventEdit` (per event id: tier, actions, web link; never attendee addresses), `invites` and `collab` settings. Config `[collab]` (optional): `meeting_minutes`, `teams`, `days_ahead`, `domains`. `makeOutlook(...).write.writer` gains `scan`, `ownEditable`, `updateOwn`, `createInvite`, `cancel`; `makeOutlook(...).schedule`; Dataverse gains `teammates`, `clientTeam`, `teamPto`. Still no writes to Dataverse, Google, DevOps or Teams.
- **Backlog:** RSVP to meetings (accept, tentative, decline with a note) behind preview and confirm.
- **Rollback:** stop the service, restore `plan.db.bak-v9-<stamp>` over `plan.db` (remove `plan.db-wal`, `plan.db-shm`), check out the commit before step 13, rebuild and start. Cancel any test invites first from Settings > Data (Undo).

## 30. Step 13.5: follow-ups overhaul, capture simplification and a keyboard fix (authorized Nov 1)

No new external writes. Contract changes, before any code:

- **Keys (D228):** one rule in `ui/keys.ts` (`globalKeyAllowed`, `topOverlay`, `isTypingTarget`): window shortcuts never act while focus is in a text-like input, textarea, select or contenteditable (Esc and F6 excepted), never while a dialog or menu is open (every overlay carries `data-overlay="modal"`; the half-day details carry `data-overlay="details"` and let only F6 through). Each overlay handles its own keys and Esc closes only it. Ctrl+K opens the command menu unless another dialog is on top.
- **Rename (D229):** Loop becomes Follow-up in UI, code, docs and glossary. Files `plan/followups.ts`, `actions/followup-rules.ts`, `ui/FollowUps.tsx`. Actions `followups.list`, `followup.add`, `followup.close`, `followup.ask_priorities`; capture route `as: "follow_up"`; view `follow_ups`; export key `followUps`; `WeekLoadData.openFollowUps`; invites `followUpId`. "Close the loop" stays the phrase for the action.
- **Plan store migration 11 (D230, backup first):** `loops` renamed `follow_ups` (index `follow_ups_rule`) with `outcome` (done, not_needed), `close_how` (teams, email, devops, call), `snoozed_until`, `origin` (JSON: trigger, items, at); closed rows get outcome done. `invites.loop_id` renamed `follow_up_id`. Notes removed: a note with a client joins that client's "where I left off" history on its day (appended with " · " when that day has one); a note with no client goes back to the inbox as an unsorted capture; `notes` dropped. Captures rebuilt: `routed_as` in follow_up, draft, draft_feature, left_off (migrated notes), dismissed. `draft_stories.level` (story, feature). Migration 12: `picks.follow_up_id` (a follow-up picked into a block, kind intention).
- **Notes removed:** `note.delete` gone, `capture.load` no longer returns notes, export has no notes, Capture has no notes section. The only free text kept per client is the Close out "where I left off" line.
- **Capture (D231):** sorts into exactly three kinds: Follow-up, Draft story (optionally under a feature), Draft feature (optionally under an epic). `capture.route` takes `as: follow_up | draft | draft_feature | dismissed`; `capture.features` also returns the client's open epics. `draft.add_feature {clientKey, parentItemId?, title}` adds one from Plan the week's "Epic needs features → Draft a feature" (the flag counts local draft features under the epic).
- **Follow-up actions (D232):** `followup.close {id, how?, note?}` (Close the loop, outcome done), `followup.not_needed {id}` (outcome not_needed, not counted as done), `followup.snooze {id, until}` (hidden until that day), `followup.delete {id}` (only follow-ups added by hand or from a capture; rule-made ones answer "use Not needed"), `followup.edit {id, clientKey?, who?, what?, channel?, due?}`, `followup.add` gains `clientKey` and `channel`, `who` optional. `followups.list {includeClosed}` returns origin, outcome, how, snooze and `dueState`. `followup.people {clientKey?}`: suggestions for Who: Cooptimizers from Dataverse minus excluded people, then attendees of my Outlook meetings (last 60 days to 14 days ahead) whose email domain is the client's; names and addresses only, nothing stored or logged. `pick.add {date, half, clientKey, followUpId}` puts a follow-up into a block as a pick (kind intention, size S by default, `picks.follow_up_id`); ticking it done closes the loop (outcome done, note "Done as a pick"). `followups.list` also takes `includeSnoozed` and returns the snoozed count.
- **Due (D233, `plan/due.ts`):** `dueState(due, today)`: overdue (red, "Overdue 2 days"), today (orange, "Due today"), tomorrow (amber, "Due tomorrow"), later (neutral, "Due Thu, Nov 5"); always words. Inbox order: overdue (oldest first), due today, due tomorrow, then later due dates, then the rest newest first.
- **Day and week (D234):** `WeekLoadData.followUps` (open, not snoozed). Week cards list a client's open follow-ups in its blocks and a dated one on its due day; Today and Plan the day put due today and overdue at the top; Plan the day offers a block's follow-ups as candidates; Close out lists follow-ups due by the day being closed, still open, first.
- **Heads-up rule (D235):** a "Heads-up to <client>" follow-up opens only when a committed must is dropped or demoted (the step 11 offer), committed client work moves out of its week (moved to another week or dropped), or a pick slips on or after its own day. Reordering, moving between future days of the same week and nice to have changes never open one. Each shows its origin (trigger, items, when); `weekplan.headsup` takes `trigger` (dropped or demoted) from the offer. Drafts list each item once with its latest status; open heads-ups are redrafted on the next read. `followups.review` lists open heads-ups that no longer qualify (none closed automatically).
- **Help (D236):** `[collab] exclude` (default `["Kat 🤖"]`), Settings > Planning > Help sessions > People to exclude, matched by name or email; excluded people are never candidates or Who suggestions. Slots inside my focus blocks for that client rank first. Teammates without shared working hours are assumed 9:00 to 5:00 in my time zone and labelled "hours unknown". Q71, Q72 kept as they are; Q74: DevOps writes before RSVP.
- **Small fixes (D237):** moving a pick to a day with no working hours asks "Friday has no working hours. Add hours for that day?" (Add hours opens Settings > Working hours; Move anyway moves). A FocusTime event deleted in Outlook keeps its timebox with Put on Outlook off and "Removed in Outlook" with Keep or Remove; never re-created by itself. Updating or removing an event that is already gone (404) counts as done and is logged "already gone". Contract: `pick.move` takes `anyway` and refuses with `code: "no_hours"` (ActionResponse gains an optional `code`); `timebox.resolve` takes `keep: "local" | "remove"` for a timebox removed in Outlook; `write.preview` answers `{nothing, alreadyGone}` when the event is gone; the sync decision `adopt_delete` becomes `removed_in_outlook`; the writer's `remove` returns `deleted` or `already_gone`.

## 31. Step 13.6: planning visibility, Plan panel fixes and timeboxing redesign (authorized Nov 1)

No new external system or kind of write. Outlook writes stay inside the write framework: the combined preview is many held previews shown in one dialog, each confirmed, read back, logged and undoable on its own. Contract changes, before any code:

- **Friday (Q78, D238):** `noHoursPrompt` returns null on Friday, the overflow day (D26): `pick.move` to Friday never refuses with `code: "no_hours"`. Weekends and any other day without working hours still ask. A Friday pick shows on Friday's catch-up card in every layout and counts in the week like any other pick. Friday's header shows a quiet "Add hours" link (Settings > Working hours) while it has work and no hours.
- **Follow-ups per card (Q76, D239):** `capFollowUps(list, 3)` in `plan/due.ts`: at most three per card in due order (overdue and due soon first), then "+N more", which opens the half-day details.
- **Plan button (D240):** `planButton(input)` in `plan/days.ts` gives each day header `hidden`, `plan` ("Plan") or `planned` ("Planned ✓", committed). Hidden on PTO days, on days Plan the day refuses (outside the plannable range), on days without working hours or a flex session and on past days not planned. Friday follows the same rule: with hours it shows Plan; with work but no hours its header shows the "Add hours" link instead, since Plan the day plans against working time (Friday's picks are on its catch-up card). Click opens Plan the day for that date. "Plan this day" stays in the day's ⋯ menu.
- **+ Add work (D241):** `addWorkTarget(...)` in `plan/days.ts`: a block card gets "+ Add work" (on hover, always on the selected card) unless the day is past, PTO or the block has no working time (Friday without hours included: Plan the day plans against working time, and "To Fri" moves work there). It opens Plan the day on that date with that block open on its picker (the client's DevOps items, an intention, its follow-ups). Key A on the selected block does the same (ui/keys.ts rules: never while typing or under a dialog). New window command `ui.add_work` (hint A) in the command menu.
- **Plan panel (D242):** the panel has a fixed height inside the window; its header (date, Commit) and each block's header stay pinned; only the lists scroll (`overscroll-behavior: contain`). While it is open the page behind does not scroll: the week's scroller is locked and a wheel or trackpad event at a list's edge is stopped (`wheelEscapes` in `ui/scroll.ts`); keys scroll the list that has focus.
- **Draft offer (D243):** `WorkItem.tier` ("feature" or "epic", portfolio items only, from the backlog levels as in Plan the week). An epic with no features offers "Draft feature" (`draft.add_feature`); a feature with no stories offers "Draft story" (`draft.add_story`). `draftOffer(item)` in `plan/rules.ts`. Items cached before have no tier and count as features.
- **Agenda and gaps (D244, `plan/agenda.ts`, pure):** `agendaOf(slot, timeboxes, now?)`: a block's meetings, personal events, unavailable time and timeboxes in time order, plus free gaps ("Free 9:00–11:00 · 2h"). `openGaps(slot, timeboxes, now?)`: the slot's working windows minus busy events, minus timeboxes, from now on for today, gaps under 15 minutes dropped. `placeInGap(gap, minutes)`: starts at the gap start (rounded up to 5 minutes), length the pick's size from Settings > Planning sizes, trimmed to the gap end (`trimmed: true`), null under 15 minutes.
- **Timebox a pick (D245):** the day strip (`DayStrip`) leaves Plan the day. Each block shows its agenda; a timebox row opens its details there (show as, Put on Outlook, Removed in Outlook, conflicts, Remove). A pick's "Timebox" lists its block's free gaps; one click places it there (`timebox.add`, unchanged). "Custom time…" keeps the Timebox… dialog. Time and length change afterwards from the timebox menu (Move…, Change end…) and by dragging on the week card timeline.
- **Timebox my day (D246):** after commit, `planMyDay(picks, blocks, sizes, musts)` proposes a place for every planned pick without a timebox: musts first, then larger sizes first, then pick order; each in its own block's first gap that fits whole, else the largest gap left trimmed, else "No free time left". Shown as the resulting agenda per block, each row with its own "Put on Outlook" (default from Settings). Apply calls the new `timebox.add_many {date, items: [{pickId, start, end, outlook}]}` (all checked first, then added in one transaction).
- **Combined Outlook preview (D247):** `write.preview` also takes `{ uids: [...] }` (up to 20) and returns `{ previews: WritePreview[], nothing: uid[], alreadyGone: uid[] }`, each preview held as before. One dialog lists every event (title, time, fields, who can see it); "Put N on Outlook" calls `write.confirm {previewIds: [...]}`, which confirms each in turn exactly as a single confirm (checks, write, read back, its own log entry and undo) and returns `{ results: WriteResult[] }`. A failure on one doesn't stop the rest; each shows its own result.
- **Week cards:** timeboxes stay on the card timelines in client color with their title and time; compact cards keep the list. FocusTime's own Outlook events still show once (D214).
- **Q77 (D248):** snoozing never moves a due date; a snoozed follow-up whose due date passes comes back showing its due badge (Overdue). **Q79 (D248):** no Coop brief for a draft feature until it is in DevOps (DevOps first: the brief is DevOps fields only).

## 32. Step 14: DevOps writes through the write framework, plus Timebox my day placement (authorized Nov 1)

Azure DevOps REST docs checked Nov 1: Work Items Create, Update and Get, Work Item Type States and Work Item Type Fields are GA at **`api-version=7.1`** (7.2 is preview only, no 8.0 listed). JSON Patch (`application/json-patch+json`) supports `add`, `remove`, `replace`, `test`; the docs' own examples put `{"op":"test","path":"/rev","value":N}` first. The docs give no status code for a failed `test`, so 409, 412 and a 400 whose re-read shows a different rev all count as "changed since". Parent links are relations `{"rel":"System.LinkTypes.Hierarchy-Reverse","url":"https://dev.azure.com/<org>/_apis/wit/workItems/<id>"}` added at `/relations/-`. Comments (Add, Get, List, Delete) exist only as **`7.1-preview.4`**; Delete is a soft delete (`isDeleted: true`). `connectionData` (`GET https://dev.azure.com/<org>/_apis/connectionData`) is not on Learn; it is the read-only identity call (authenticated user id, display name, `properties.Account.$value`), verified live before relying on it. A PAT can't read its own expiry (the PAT Lifecycle API needs a Microsoft Entra token), so the expiry is an optional date I enter. Scopes: writes need Work (Read & write), `vso.work_write`.

Contract changes, before any code:

- **Write identity (D249):** a personal write PAT per client, keyring account `devops-write-pat:<cacheKey(client)>`, set only through `devops.set_write_pat {clientKey, pat, expires?}` (masked field in Settings > Clients, "DevOps write access"; stdin to `secret-tool`, never argv, never returned or logged, wrapped in `Pat` the moment it is read). On entry FocusTime calls `connectionData` on the client's org with that PAT and keeps the PAT only if the authenticated account equals my DevOps identity for the client (Account Worker `coop_devopsemail`). Stored (not secret, plan store `devops_identities`): display name, email, id, validated at, optional expiry. `devops.clear_write_pat {clientKey}` forgets both. The company read PAT from Dataverse is never used: the write path reads targets with `devopsTargets(keys, { withPat: false })`, which doesn't select `coop_devopstoken`.
- **Allowed writes (D250), named changes for `devops.preview`:** `{kind:"state", itemId, state, comment?}` (any state of the item's type, from its states; the comment goes in `System.History` in the same patch), `{kind:"comment", itemId, text}`, `{kind:"create", draftId, description?, acceptance?}` (a draft story becomes the requirement backlog's default type, a draft feature the feature tier's default type; parent link required; assigned to me; area and iteration from the parent; acceptance criteria only when the type has `Microsoft.VSTS.Common.AcceptanceCriteria`), `{kind:"target_date", itemId, date}` (feature or epic assigned to me; field detected per process as in step 8). Nothing else: no deletes, no reassigning, no reordering, no other fields.
- **Framework (D251):** `devops.preview {clientKey, change}` or `{clientKey, changes: [...]}` (at most 10) reads the item with the write PAT and holds a preview for five minutes: org, project, item, every field before and after, link changes, the identity it writes as, and "Visible to everyone with access to <project>". `devops.confirm {previewId | previewIds (≤10)}` writes with `test /rev` first in every update patch, reads back and only then reports success (else Retry). A changed item is refused with `code: "changed"` and what changed; the UI offers Reload (a new preview). `devops.retry {id}` checks before writing again (an update already applied, a comment already posted, or a created item found by WIQL under the parent with the same title created by me after the attempt, is adopted, never duplicated). `devops.log` returns the audit log (Settings > Data, DevOps section). Undo is `devops.preview {clientKey, change: {kind:"undo", writeId}}`: a state or target date goes back to its prior value (with its own rev test, refused if DevOps shows another value now); a comment is deleted (soft delete, read back as deleted); a create sets the new item to its type's Removed-category state with a comment (refused when the type has none) and brings the draft and its picks back. Undo is a stack per item (the newest change not undone). Every URL is built from the client's own org (`https://dev.azure.com/<org>/`, org name validated), with that client's write PAT only.
- **Drafts (D252):** after a create is read back, the draft is marked created (`draft_stories.devops_id`, `devops_url`) and leaves draft lists, and its picks become item picks for the new id (title, type, link); the pick ids are kept on the log entry so undo can put them back. The DevOps memory for that client is dropped so the next read shows the new item (and its Coop brief).
- **Where (D253):** follow-up "Update DevOps #id": Mark done in DevOps (state picker on the completed state, optional comment; closes the loop, how DevOps, after read back). Close out: done picks whose item is still open get the same inline. Draft stories and features: Create in DevOps (Plan the week, Plan the day, Inbox). Plan the week readiness: No target date → Set target date; Needs breakdown → Create N drafted stories (one combined preview). A client without a write PAT shows "Enable DevOps writes" there instead (opens Settings > Clients).
- **Timebox my day (D254):** the commit confirmation in Plan the day offers "Timebox my day" at once, with "Keep the panel open"; "Planned ✓" keeps it. Today: the current block offers "Timebox" for its untimeboxed planned picks (opens the same proposal for today).
- **Contract change:** plan store migration 13 (backup first): `draft_stories.devops_id`, `devops_url`; tables `devops_identities` and `devops_write_log`. New actions `devops.set_write_pat`, `devops.clear_write_pat`, `devops.write_status`, `devops.states`, `devops.preview`, `devops.confirm`, `devops.retry`, `devops.log`. `SettingsClient` gains `write` (enabled, name, email, validatedAt, expires). `WeekLoadData` gains `devopsWrite` (client keys with a write PAT). `ActionContext` gains `devopsWrite` (keyring for write PATs) and `makeDevOpsWriter`. `DevOpsSource` gains `forget(clientKey)`. `devopsTargets` takes `{ withPat }`. Still no writes to Dataverse, Google, Teams; Outlook unchanged.
- **Rollback:** stop the service, restore `plan.db.bak-v12-<stamp>`, check out the commit before step 14, rebuild and start. Write PATs: `secret-tool clear service focustime account devops-write-pat:<key>` (listed in Settings > Clients). Items created in DevOps stay (undo first, which sets them Removed).

Step 14 additive contract changes found during UI wiring: `capture.load` returns `drafts` (drafts not yet in DevOps) for the Inbox's "Drafts to add in DevOps"; `PlanDay` takes `justCommitted` and `onCommitSeen` (the commit keeps the panel open, D254).

### Step 14 live verification (Nov 1, Cooptimize org only, each write approved in chat)

- Identity: write PAT saved by the user in Settings; `connectionData` (no api-version) answered the identity live: my name and work address, org cooptimize.
- Baseline #437: rev 1, New, parent #291, no children.
- 1 create: #495 "[FocusTime test] safe to remove", User Story, New, under #437, assigned to me, area and iteration from #437. Confirmed. #437 gained only the Hierarchy-Forward link and kept rev 1 (DevOps doesn't add a parent revision; the fake does, harmless).
- 2 comment (7.1-preview.4): confirmed, id 23514739. A comment moves the item's rev (1 to 2).
- 3 state New → Active with `test /rev` 2: PATCH 200, but the read-back GET failed at the network level, so it was logged Not confirmed. Retry (approved) read the item, found Active, sent no PATCH, confirmed (2 attempts).
- 4 undo state: Active → New with test rev 3, confirmed.
- 5 undo comment: DELETE answered 204 with no body (handled as success), comment read back as deleted, confirmed. The delete moved the rev (4 to 5).
- 6 undo create: test rev 5, State Removed plus the removal comment, confirmed. The local draft came back.
- Final: #495 Removed at rev 6, still under #437. #437 identical to the baseline apart from the child link to #495. Nothing written to T&W, Proseware or Adatum.

## 33. Step 14.5: timeboxing made obvious and editable, plus step 14 follow-ups (authorized Nov 1)

No new external system or kind of write. Outlook and DevOps writes stay inside their write frameworks. Contract changes, before any code:

- **Read-back retry (D255):** a write that landed but whose read-back fails on a network error waits briefly (1.5 s) and reads once more before settling Not confirmed. Shared helper `readBack(read, isNetwork, sleep)` in `actions/readback.ts`, used by every read-back in `devops-write-actions.ts` and `timebox-actions.ts` (timeboxes, my own events, help invites). `ActionContext.sleep?` (tests pass an instant one). Other errors are not retried.
- **Expiry lines (D256, Q82):** `plan/expiry.ts` `expiringSoon(list, today, days = 14)`: each DevOps write PAT with an expiry and each app secret expiry ([secrets]) within 14 days (or past) gives one line, "T&W DevOps write access expires in 9 days. Update in Settings" ("expires today", "expired 2 days ago"). New `WeekLoadData.expiring: { key, text, days, section }[]`; Today shows them under Needs attention, each opening Settings at its section. Settings keeps its own warning.
- **Parent first (D257, Q81):** a draft with no parent can't be created in DevOps (unchanged on the server). "Create in DevOps" on such a draft opens "Choose a parent": that client's open features (for a story) or epics (for a feature) from the DevOps read. Choosing calls the new local `draft.set_parent {id, parentItemId}` (checked against the loaded items: right tier, open), then the usual create preview. New local `draft.remove {id}` (refused while a planned pick uses it), with Delete on drafts in the Inbox.
- **Q80 (D258):** keep `connectionData` as the only identity check; no Profiles API fallback (it needs another scope and host). If it can't name an identity, the PAT is refused and nothing is saved, with "DevOps didn't say who this PAT belongs to".
- **One row per pick (D259):** `plan/picktime.ts` (pure): `pickTime(pick, timeboxes)` gives `{ state: "untimed" | "timed" | "outlook", timebox }` ("outlook" when Put on Outlook is on); `timeChoices(slot, timeboxes, pick, sizes, now)` gives the block's free gaps with the pick's own timebox treated as free, "Keep current" first for a timed pick, so it never says "no free time" because of itself; `dragTimes(mode: "move" | "start" | "end", start, end, deltaMinutes)` snaps to 15 minutes and keeps 15 minutes at least. The row shows "+ time", "9:00–11:00" or "9:00–11:00 · Outlook" (calendar icon). Clicking opens a small editor: the gap list, start, length, Put on Outlook (preview through the write framework), Remove time; its show as, conflict and Removed in Outlook choices move there. Week cards, Today and Plan the day use the same row (`ui/PickTime.tsx`). Separate timebox rows go from cards and agendas: in Plan the day a timed pick shows in the agenda at its time as its pick row; untimed picks follow. Timeboxes without a pick (from week lists) keep their own row. Timed picks stay on the wide card timelines in client color with titles; drag to move, either edge to resize, Outlook follows after a preview; a click opens the same editor.
- **Hint (D260):** once per browser profile, on the first untimed pick in Plan the day or Today: "Give it a time, optionally put it on Outlook." Dismissed for good.
- **Use timeboxing (D261):** config `[timebox] enabled` (default true), Settings > Planning "Use timeboxing". Off hides "+ time", times, the editor, Timebox my day and the commit offer; timeboxes are kept and still count. `WeekLoadData.timeboxSettings.enabled`, `SettingsData.timebox.enabled`, settings section `timebox` takes `enabled`.
- **Screenshots:** true light shots switch `[ui] theme` to cooptimize-light for the run and put it back after (`scripts/screenshot-step145.mjs <out> light|dark`, one run per saved theme). The three row states on one card are shot on an isolated sample instance (its own XDG dirs, no keyring, sample calendars, fixed clock) so the real plan isn't changed for a picture.
- **Rollback:** no migration. Check out the commit before step 14.5, rebuild, restart. `[timebox] enabled` in config is ignored by older code only if removed (older code rejects unknown fields), so remove that line when rolling back.

## 34. Step 15: clearer Plan the day and Plan the week, plain words, bug fixes, demo mode (authorized Nov 1)

No new external system and no new kind of external write. Goal: usable and demoable on Monday morning, with the Today view as the visual model (clean rows, one obvious action, details on click). Contract changes, before any code:

- **Plan the day is its own view (D263).** It no longer replaces a day column in the week grid. Two panes, one job each. Left, "Your <Weekday>": one section per block (client, time range, one calm fit line); each pick is one row: checkbox, title, size chip (click cycles S, M, L), time or "+ time", and ⋯ (also right-click) holding every other action from `pickMenu` (move to the other block, another day or Friday, drop, timebox, open, Needs help from…). No inline Move, To Fri or Drop buttons. Clicking a block selects it; the right pane follows. Default selection: `defaultBlock` (plan/addpane.ts): the block "+ Add work" asked for, else the first block not yet over with room, else the first block not over, else the first.
- **Right pane, "Add to <Client> <Morning/Afternoon>" (D264).** `addSections(input)` (plan/addpane.ts, pure) gives three sections in this order: 1. "This week's priorities" (the client's musts, then nice to haves, from the week plan; a feature expands to its open, pickable stories; a feature with no stories gives one "Break it down" row: Copy Coop brief, Draft a story), with "From your week plan."; 2. "Follow-ups" for that client (due order); 3. "Everything else", collapsed, the client's other pickable items in DevOps order, searchable (`matches(query)` on id and title). Anything already picked on the day is left out. A feature filter (from a card's "This week: <feature>") keeps only that feature in section 1. Each row has one "+" (pick.add, unchanged). "+ Draft a story" is one link per section that opens an inline field only when clicked. An Open half-day shows client chips first. Intentions stay ("Or type what you'll do").
- **Header and Done (D265).** "Plan Monday, Nov 2", a status line ("7h of work · 6h 15m free", from `dayTotals`), ‹ › for the day, and one primary "Done". `doneAction(committedAt)`: not committed → `planday.commit` then close; committed → close only. Changes save as you go; no "Commit again", no explanatory paragraph. Heads-up rules are unchanged (they read `committedAt`, set once by the first Done). Timebox my day: in the header after Done, and offered once right after the first Done (D254 unchanged). Key C still commits; Esc closes.
- **Fit while planning (D266, plan/fit.ts).** `planFit(picks, sizes, timeboxes, slot)`: planned and done picks (timebox minutes when timed) against the block's whole free time (`freeMinutes(slot)` with no "now"). Used by Plan the day, week cards, Today and Plan the week's client fit. Check-in alone keeps time left (`capacityMinutes(slot, now)`). `fitWords(fit)`: "Fits" (neutral) when spare is under 30 minutes or over by 10 minutes or less; "Room for about 45m more" (neutral, spare rounded down to 15 minutes) at 30 minutes or more; "About 1h over" (amber, rounded to the nearest 15 minutes, at least 15m) when over by more than 10 minutes. No red for fit anywhere. Over shows a small "trim" link: `trimCandidates(picks, over, sizes, musts)` marks the fewest planned picks (not musts first, larger first, untimed before timed) whose sizes cover the overage; those rows are highlighted. The card status (`blockStatus`) uses the same words: At risk (red, a real problem), then "About 1h over" (amber), then "Fits"/"Room for…" (neutral).
- **Plan the week rows (D267).** A row shows: title (link), state, story count, block count (click opens a 0.5 to 5 chooser), pin (if any). Everything else moves to the row's ⋯ menu and right-click, built by `weekItemMenu(env, item, ctx)` (ui/menu.ts): Move up, Move down, Make nice to have / Make a must, Pin to…, Mark done / Not done, Needs help from…, Set target date, Copy Coop brief, Create drafts in DevOps, Take off the week. Reorder also by drag within a list. The client header uses `fitWords` on musts against the client's blocks.
- **One context line (D268).** The Now strip, the ritual chips and the Musts strip become one line under the top bar (`ContextLine`): now / next in a few words, then the musts per client from `mustsSummary` ("Cooptimize 0/2 · T&W 0/1 · Adatum 0/1"); a click opens a small popover with the details (each client's musts and blocks left). The ritual chips move into the Plan view's own header. "Still realistic?" and "too much planned" sentences leave the strips; that question stays in Check-in only. Not on Today or the focus screen (Today has its own now line).
- **Consistency (D269).** Week cards, Today and Plan the day use one pick row (`PickRow`: checkbox, title, size chip, time, ⋯). A card's "This week: <feature>" opens Plan the day on that block with the right pane filtered to that feature.
- **Wording (D270).** `docs/design/wording.md`: plain, short, calm; red only for real problems (overdue, failures, at risk); no jargon ("slot", "carry target", "free share", "capacity"). Applied to every visible string.
- **Bugs (D271).** The DevOps write log's When shows "Invalid Date" because the store stamps zoned times (`…-05:00[America/New_York]`), which `new Date` can't read: `whenText(stamp, tz)` (ui/labels.ts) reads them with Temporal. Wide layout: an event that spans the AM/PM boundary is drawn with its title once, in the block it starts in; the next block shows only its unlabelled continuation (`labelHere(placed, earlierIds)`). View range: the H key and the menu change the view for this session only (the UI passes `viewRange` to `week.load`, which overrides the saved range for that load); Settings > Display sets the saved default through `ui.set_view_range` (unchanged; business hours unless changed).
- **Demo mode (D272).** Settings > Display "Demo mode" and the command menu (`demo.set {on}`). The server keeps two action contexts and serves the demo one while demo mode is on: fictional clients (Northwind Foods, Harbor Health, Atlas Freight, plus Cooptimize internal), people, DevOps items, meetings, personal events and PTO, all generated for the current week by `sources/demo/` (no fetch is given to them), a plan store in memory seeded the same way, and the config held in memory (theme and view changes in demo never touch the real config file). In demo: no external calls, no writes (Outlook and DevOps writers absent, write PATs and secrets refused, links and export refused with "Demo data: nothing leaves FocusTime"), no reminders. The top bar shows "Demo data". The on/off flag is a file (`~/.local/share/focustime/demo-mode`) so a restart keeps it; turning it off drops the demo store and serves live data untouched. The real plan store and config are never opened for writing by the demo context. `WeekLoadData.demo: boolean` (Settings reads it from there); new registry action `demo.set`; `ActionContext.demo?`; `DEMO_REFUSED` lists the actions refused with code "demo" (links, Outlook open, playlists, export, secrets, sign-ins, every external write confirm and retry, write PATs). DM-1 changes the writes: they are simulated end to end against the session's own in-memory DevOps and Outlook (preview, confirm, read back, undo), and confirm and retry leave the list; AI may answer the fictional data for real under the caps, else stored samples; Reset demo starts the session over (docs/demo/README.md).
- **Rollback:** no migration. Check out the commit before step 15, rebuild, restart. Remove `~/.local/share/focustime/demo-mode` if demo mode was on.

## 35. Step 15.1: Timebox my day polish, compact timelines at 1920, duplicate picks

Authorized Nov 1. Contract changes, all additive (no store migration):

- **Shortest useful time per size (D273).** `[plan] min_s`, `min_m`, `min_l` (defaults 30, 60, 90 minutes; 15 to 480 in steps of 5; each at most its size), Settings > Planning "Shortest useful time". `PlanConfig.minSizes`. `placeInGap(gap, want, min)` returns null when the gap holds less than `min`. `planMyDay(…, minSizes)`: a pick goes into the first gap that holds it whole; else into the largest gap that holds at least its minimum, trimmed to the gap (never below the minimum); else it isn't placed, with the reason "No gap of 1h or more left in the afternoon".
- **Didn't fit, said plainly (D274).** After Timebox my day runs, Plan the day shows one line for what didn't fit: "2 picks didn't fit: Export spec draft (M), Delay alerts (S)." (`didntFitText`, plan/agenda.ts), and per pick: "Move to <tomorrow / Tue>" (`pick.move` to the next plannable day, same half, `stepDay`), "Make smaller" (`pick.set_size` one size down; not for S) and "Leave untimed" (takes it off the list). "Got it" closes the line. When everything fits, the notice says "Timeboxed N picks". Showing that summary, or acting on it, clears the "N picks have no time yet" offer for that day.
- **Done just closes (D275).** Close out: the first "Done for the day" commits; afterwards the button reads "Done" and goes back (no "Save again"). Plan the day already works this way (D265). `closeout.commit` is unchanged.
- **Compact timelines (D276).** Medium layout (the 1920 class): each block card with working hours gets a narrow time ruler on its right edge, covering only that block's working hours (`slot.start` to `slot.end`): meetings, personal events and unavailable time, timed picks as labeled bands in client color, free stretches visible. A pick band opens the time editor (as on the wide timeline); an event opens its menu. The list on the left is unchanged. `showRuler(layout, on, slot)` (ui/layout.ts): medium only, switched on, and the block has working hours. Wide is unchanged; narrow never shows it. The switch "Timelines" sits next to the view range control in the status bar (medium layout only); key **V** toggles it for the session (never while typing). Settings > Display "Show timelines on cards" saves the default: `[ui] show_timelines` (default true) through the new action `ui.set_timelines { on }`. `UiConfig.showTimelines`; the session value lives in the UI only (the server build doesn't depend on it). The switch also shows in the quiet status line, beside the view range, which now shows there too.
- **Duplicate picks (D277).** `alreadyPlanned(picks, ref, date, half, exceptId)` (plan/dup.ts): the same work item (or draft, or follow-up) planned or done in a block. `pick.add` refuses it in the same block with "Already planned here" (409, code `duplicate`) and keeps the existing same-day refusal for the other half; `pick.move` now refuses a move into a block that already has it (it had no check, which is how one item ended up planned three times). Menus that add a work item to a block show "Already planned here" (disabled) instead of adding. Existing duplicates are not removed automatically.
- **Rollback:** no migration. Revert the step 15.1 commit, rebuild, restart. The new config keys are optional; an older build reports them as unknown fields, so remove `min_s`, `min_m`, `min_l` and `show_timelines` before rolling back if they were saved.

## 36. Step 16: Delivery view, meeting RSVP, small experience fixes (authorized Nov 2)

Microsoft Graph v1.0 docs checked Nov 2: `POST /me/events/{id}/accept`, `/tentativelyAccept`, `/decline`, each with an optional JSON body `comment` (string) and `sendResponse` (boolean, default true); `tentativelyAccept` and `decline` also take `proposedNewTime` (timeSlot: `start`, `end` as dateTimeTimeZone), valid only when the event's `allowNewTimeProposals` is true and only with `sendResponse: true` (400 otherwise); `accept` has no `proposedNewTime`. All three answer `202 Accepted` with no body and need `Calendars.ReadWrite` (the write token FocusTime already asks for in step 12). The event's `responseStatus.response` is one of `none`, `organizer`, `tentativelyAccepted`, `accepted`, `declined`, `notResponded`. The docs don't say what declining does to the event on my calendar; Exchange usually moves it to Deleted Items, so a 404 on read back after a decline counts as declined (D284). Built in three slices, each committed and pushed.

Contract changes, before any code:

**Slice 1: Delivery (read-only).**
- **What (D278):** a new top-bar view "Delivery" (key 5, `delivery.load` in the command menu): the features and epics assigned to me (portfolio level from each project's backlog levels, as in step 8), for followed clients (Cooptimize always), grouped by client. Built from the step 8 portfolio read (`DevOpsSource.portfolio`), keeping only items whose `why` includes `assigned`.
- **Per row (D279):** title (link), state, target date, stories done vs open, who works on its open stories (display names with counts, never emails), unassigned and unsized open stories, open stories with no change in 14 days. "Stories" are the item's direct children at the story level; a story counts as done when its state category is Resolved or Completed, Removed ones are left out. An epic counts its direct children the same way (features under it). Unsized needs a size field: the first of `Microsoft.VSTS.Scheduling.StoryPoints`, `Microsoft.VSTS.Scheduling.Effort`, `Microsoft.VSTS.Scheduling.Size` present in the project's field list; none found means no unsized count. `PortfolioChild` gains `changedAt` and `size` (number or null), `ClientPortfolio` gains `sizeField`. Readiness flags reuse Plan the week's rules (needs breakdown, needs features, no target date), now exported as `needsBreakdown`, `needsFeatures` from `plan/weekplan.ts`.
- **Trend (D280):** plan store migration 14 (backup first) adds `delivery_snapshots (client_key, item_id, date, done, open)`, one row per item per day (a later load that day replaces it), written only from a live read (never from a cached snapshot), kept 120 days. The row shows the last 21 days as a small trend. Rate: stories closed per week between the oldest snapshot in those 21 days and today (`done` difference over days, times 7; a negative difference counts as 0).
- **Signal (D281), `plan/delivery.ts deliverySignal`:** none open → "On track", "All N stories done". No target date → no signal, "No target date" with Set target date (the step 14 write). Target date passed with stories open → "At risk", "Target date passed, N stories open". Less than 7 days of snapshots → no signal yet, "Trend after a week of snapshots (N days so far)". Otherwise weeks needed = open / rate, weeks left = days to target / 7: needed ≤ left → "On track"; needed ≤ 1.5 × left → "Watch"; else "At risk"; no stories closed in the window → "Watch" with 2 weeks or more left, "At risk" under 2 weeks. The reason in words: "9 stories open, about 3 closed per week, 2 weeks to target". Nothing more than that rate.
- **Row ⋯ (D282):** Open in browser (`link.open`), Copy Coop brief (`feature.brief`), Needs help from… (step 13, on the work item), Add to this week's plan (`weekplan.add` on this week as a nice to have; disabled for an epic, "Add its features instead", and when already on the week), Set target date (step 14: inline "Set target date" without a target date, Set or Change from ⋯; "Enable DevOps writes" without a write PAT). Nothing in Delivery writes except those existing named writes.
- **Contract change:** migration 14; action `delivery.load {refresh?}` → `{ today, clients: DeliveryClient[] }` (`DeliveryClient`: client key and name, status and message, fetchedAt, fromCache, rows; `DeliveryRow`: id, title, type, tier, state, url, targetDate, done, open, people, unassigned, unsized (null without a size field), stale, trend (date, done, open), signal (level and reason), flags); `PortfolioChild.changedAt`, `.size`; `ClientPortfolio.sizeField`; `View` gains `"delivery"`. No new external system.

**Slice 2: Meeting RSVP.**
- **Where (D283):** the event menu of a meeting I'm invited to (Outlook, someone else organizes it, not cancelled) gets Accept, Tentative and Decline, with the current response checked, each opening a short form: an optional note and, for Tentative and Decline when the meeting allows it, "Propose a new time" (start and end). A meeting that overlaps a focus block shows a quiet line at the top of its menu: "Overlaps your <client> focus block". The meeting itself is never edited: no PATCH, no DELETE, no cancel on these events; only the three response endpoints.
- **Write framework (D284):** new write kind `rsvp`. `write.preview {rsvp: {id, response: "accepted" | "tentativelyAccepted" | "declined", comment?, proposedStart?, proposedEnd?}}` reads the meeting first (`responseStatus`, `organizer`, `allowNewTimeProposals`, `isOrganizer`, attendee count, `isCancelled`, marker) and refuses one I organize, a FocusTime event, one with nobody else on it, and a cancelled one. The preview shows the meeting, when, who is notified (the organizer by name), my response before and after, the note and any proposed time; visibility "<organizer> gets your response by email" (with the note). Confirm sends `POST /me/events/{id}/<accept|tentativelyAccept|decline>` with `{ sendResponse: true, comment?, proposedNewTime? }` (times in UTC), reads back `responseStatus` and only then reports success; after a decline a 404 also confirms ("Declined. Outlook took it off your calendar"). Logged in Settings > Data with the prior response. Undo is a new response restoring the previous one (no note), previewed with "<organizer> is notified again"; there is no undo when the previous response was none or not responded (Graph can't take a response back). The organizer's name is kept in the log; no attendee addresses are read or kept.
- **Contract change:** plan store migration 15 (backup first) rebuilds `write_log` so `kind` allows `rsvp`. `WriteKind` gains `rsvp`; `Fields` gains optional `response`, `comment`, `proposed` (start, end) and `organizer`. `EditFacts` gains `response`, `organizer` (display name) and `proposals`; `EditAction` gains `rsvp`. The Graph writer gains `meeting(id)` and `respond(id, response, opts)`; the scan selects `responseStatus`, `organizer`, `allowNewTimeProposals`, `isCancelled`.

**Slice 3: small fixes.**
- **"+ time" minimum (D285):** the free gaps offered by "+ time" (`pickTimeChoices`) skip gaps shorter than the pick's shortest useful time (D273) and never trim below it; Custom time stays free.
- **Test data (D286):** real client and person names in older tests and fixtures are replaced with fictional ones (Fabrikam, Contoso, Northwind; `@example.com`).
- **Wording:** Delivery and RSVP copy follows `docs/design/wording.md`.

**Rollback:** stop the service; restore `plan.db.bak-v13-<stamp>` (slice 1) or `plan.db.bak-v14-<stamp>` (slice 2) over `plan.db` (remove `plan.db-wal`, `plan.db-shm`); check out the commit before the slice, rebuild and start. An RSVP sent stays sent: change it back in Outlook or with Undo before rolling back.

## 37. Step 15.2: stabilize Plan the day, small experience fixes (authorized Nov 2)

No new external system, no new external write, no store migration. Contract changes:

- **Adding work, the bug (D287).** ⋯ → Add to the plan put the item in the Week view's selected block, not the block selected in Plan the day; the item then disappeared from the right pane (anything picked on the day was hidden), so it looked like nothing happened. Fixed: while Plan the day is open, the menus' selection is its selected block (`onSelectBlock`, App `pdHalf`). Reproduced in demo mode and on a copy of the real Monday before fixing; "+" in all three sections, "+ Add work" and A worked; drag onto a block did not exist for right-pane rows.
- **Where an item can go (D288, plan/addtargets.ts `addTargets`).** Order: the block selected in Plan the day, this client's blocks on the day being planned, its other blocks this week, Open half-days and Friday catch-up, then other clients' blocks last under "Different client", each asking "Add <client> work to <client>' block?" first. Past days and halves with no working time are left out; a day off ("Day off"), a block with no free time ("No free time left: meetings fill it"), the same item in that block ("Already planned here") or in the other half that day ("Already planned for the afternoon that day") stay listed, disabled.
- **The right pane after adding (D289).** `addSections({here})`: rows planned in the selected block stay in their section with a check and "Already planned here" (planned in the other half: still left out). Rows drag onto any block on the left (`ADD_DRAG`); another client's block asks first. When focus falls to the page (a "+" became a check, a dialog closed), ← → C Esc still reach Plan the day.
- **Focus always visible (D290).** A top-bar "Focus F" button next to Capture opens the start menu: "Start focus: <next pick>" first (`focusNext`, today's next planned pick), then Plain timer, Break, Another pick…. While a timer runs the button is the countdown and the pick, in the client color; a click opens the focus screen. The context line's Start focus shows whenever a pick is next.
- **Quick capture (D291).** The client dropdown becomes one client chip, pre-filled from the selected block (Plan the day's, else the Week view's); a finished `@nickname ` sets the chip and leaves the text (`takeTag`, plan/capture.ts); a click on the chip chooses another client or none. Placeholder "Capture anything…". The tip "Type @ and a client's nickname to tag it" shows until "Got it" (`focustime.hint.capturetag` in localStorage). Same in the Inbox capture box.
- **Shared work item lookup (D292, plan/lookup.ts, ui/ItemLookup.tsx).** One control for the flex session form (menu form field type `item`), the follow-up form, and Needs help from… ("About"): searches the chosen client's loaded items by title or #id, this week's priorities (and their stories) first, then my assigned items, then the rest; ↑↓ and Enter link a result, Enter otherwise keeps the plain text (flex: into the note; follow-up: added to what I owe; help: the invite title). A linked item shows its title and link with × to unlink; changing the client clears it; no client disables it with a hint. `followup.add` and `followup.edit` take an optional `itemId` (positive integer or null; needs a client; a new client clears it); the follow-up row shows the item as a link. Manual follow-ups are never closed by an item's state. The Timebox… dialog has no item entry (a timebox is always for a pick or an item chosen from a menu), so nothing changed there.
- **Smaller (D293).** "+ time" minimum was already done (D285). Older tests and fixtures were already fictional (D286); the last code comments naming the user now say "I". Browser tests: `e2e/` (vitest + playwright-core with the system Chromium; a throwaway server in demo mode on its own port, XDG dirs and pinned clock, UI through Vite), part of `npm test`, skipped when no Chromium is installed.
- **Rollback:** no migration. Revert the step 15.2 commit, rebuild, restart. Follow-ups that got an item keep it in `item_id`, which older builds already read.

## 38. Step 15.3: one capture flow, editable drafts (authorized Nov 2)

No new source, no new external write (Create in DevOps is the step 14 create from a draft). One store migration (16). Contract changes:

- **Housekeeping.** An untracked AGENTS.md (a Codex copy of CLAUDE.md) was deleted; AGENTS.md, AGENTS.override.md and `.codex/` are ignored (commit 0e09aec). Dropped duplicate picks 10, 12 and 13 deleted from the plan store (backup first); pick 6 kept (Q83).
- **One capture flow (D294 to D296).** The capture box is the single entry point for new things. Kind chips under it (Sort later · Follow-up · Draft story · Draft feature); the rules (`boxKind`) highlight one while typing, a click or Tab changes it. Each kind's fields open inline: Follow-up (who, channel, due, linked item), Draft story (parent feature, size), Draft feature (parent epic, target date); the client is the chip. Enter saves as the chosen kind (`capture.add` then `capture.route`); Sort later saves an unsorted capture. `capture.route` takes `itemId` (follow-up, needs a client) and `targetDate` (draft feature); anything else refuses them. `capture.features` returns each feature's and epic's type, link, area and iteration, and whether the story type has acceptance criteria. "Add a follow-up" buttons are gone; Ctrl+K "Add a follow-up" and Close out open the box with Follow-up chosen. The Inbox explainer: "Capture anything. Sort it now or later: follow-ups are what you owe people; drafts become DevOps items."
- **Editable drafts (D297 to D299).** One editor from Plan the week, Plan the day and the Inbox. `draft.update {id, title?, description?, acceptance?, clientKey?, parentItemId?, size?, startDate?, targetDate?}` (local; see D297 for the rules). Create in DevOps writes the edited values, preview first, every field listed. Plan it adds the draft to a block in the 15.2 order; Delete is local.
- **From 15.2 (D300, D301).** Right-pane rows drag onto the week's other days (a strip while dragging). The intention box links an item through the shared lookup; Enter keeps plain text.
- **Verification on real data.** Every add path was clicked once on a copy of the real config, plan store and cache in scratch directories (a separate server; the real service and store untouched; nothing confirmed in DevOps or Outlook; the copy deleted after).
- **Rollback:** revert the step 15.3 commit, rebuild, restart. Migration 16 only adds nullable columns; older builds ignore them (a backup `plan.db.bak-v15-*` is written before migrating).

## 39. Step 15.4: Microsoft sign-in for the app, my Azure VM, small follow-ups (authorized Nov 2)

New source: Azure Resource Manager and Resource Graph, delegated (the signed-in person's own Azure RBAC). New external writes, only through the write framework: start, deallocate, and the confirmed VM's auto-shutdown schedule. One store migration (17). api-versions (checked on Microsoft Learn, Nov 2): Compute `2026-04-01`, Resource Graph `2024-04-01`, DevTestLab schedules `2018-09-15`; Entra v2.0 authorize and token endpoints. Contract changes:

- **One Microsoft sign-in (D303 to D306).** `auth.status` → `{configured, state: signed_in | signed_out | unavailable, person, message}`; `auth.sign_in {azure?}` (default true; keeps calendar changes if allowed; prefills my account when known); `auth.sign_out`. `auth.connect_microsoft` is the same sign-in; `auth.disconnect {source: outlook}` also signs out. `OAuthClient` gains `identity()` and token kinds `id` and `arm`; `connect` takes `{write?, azure?, loginHint?}`. Keyring account unchanged (`outlook-refresh-token`). "Me" from the sign-in; config's my_email is the fallback.
- **My VM (D307 to D311).** `vm.find {tag?, value?}`, `vm.choose {vmId | null}`, `vm.status {fresh?}` (chip, label, power, transition, canStart, canStop, schedule, change, stillChanged, prompt, refreshMs, needsConsent, error), `vm.preview {op: start | deallocate | delay60 | delay120 | skip | restore, vmId?}`, `vm.confirm {previewId}`, `vm.restore {vmId?}`, `vm.dismiss_prompt`, `vm.log`. Config `[azure] owner_tag`, `owner_value` (optional). Store: `azure_write_log`, `account_state`.
- **Morning prompt (D312)** on Today and a notification at work start; never starts automatically.
- **Small follow-ups (D312).** Q84, Q85, Inbox kind chips.
- **Demo (D313)** fictional person and VM, simulated.
- **Not done here.** Dataverse stays app-only (Q89). No VM start at work start. No other VM, no other Azure resource, no resize, no disks.
- **Rollback:** revert the step 15.4 commit, rebuild, restart. Migration 17 only adds two tables (backup `plan.db.bak-v16-*` written first). The keyring entry is the same one as before, so Outlook keeps working on the older build.
- **Live verification (done Nov 2, recorded in step 16.2, D322):** Azure consent given in the sign-in; Settings > You > Find my VM found the VM by its Owner tag and it was confirmed; power state and auto-shutdown schedule read.

## 40. Step 15.5: notifications made reliable and controllable, step 15.4 decisions (authorized Nov 2)

No new external writes and no new source. Contract changes:

- **Step 15.4 decisions (D316).** `vm.start_now {vmId?}` (the morning box's and its notification's Start; 409 `ask_first` when the setting is off). `VmStatus.startWithoutAsking`. Config `[azure] start_without_asking` (default true), Settings > You. `auth.sign_in` may answer `{status: "failed", offline: true}`; the sign-in screen offers the demo, and Continue offline only when offline.
- **Notifications (D317 to D321).** Config `[notify]`: one boolean per kind (`plan_day`, `checkin`, `closeout`, `plan_week`, `look_ahead`, `timer`, `meeting`, `vm`, `followups`, `expiry`), `quiet` (`outside_hours` | `off`), `quiet_pto`. Settings section `notify` (Settings > Notifications) and `vm`. New actions `notify.test`, `notify.sample {kind, live?, gated?}`. `/api/open-request` also returns a clicked notification's route. New notifications: follow-ups due, expiring secrets. Texts changed: each says what a click does.
- **Kept:** each occasion once (the existing markers), plus a key per notification; Reset local plan doesn't touch them.
- **Not done:** buttons on the developer desktop's notification cards (its shell draws none, Q90); withdrawing sent notifications (Q91).
- **Rollback:** revert the step 15.5 commit, rebuild, restart. `[notify]` and `start_without_asking` in config.toml would then be unknown fields: remove them (the older build says so per field).

## 41. Step 16.2: navigation restructure and small cleanup (authorized Nov 2)

No new external writes and no new source. Mostly reorganization: every capability and action stays, moved. Contract changes:

- **Tabs.** Today · Week · Roadmap · Inbox, always in that order, keys 1–4 (T stays Today). The Plan tab, the ritual chips and the stacked context line (Now/Next strip and musts strip) are gone: Today › Now carries now and next, the Week header the musts summary, the Focus button a running timer. Right side of the top bar: VM chip, Focus (the live countdown while running), Capture, ⋯ (Commands, Keyboard shortcuts) and my initials (Settings, Sign out or Sign in). Ctrl+K still opens Commands, `,` Settings.
- **Delivery is Roadmap** everywhere: UI, code (`ui/Roadmap.tsx`, `plan/roadmap.ts`, `actions/roadmap-actions.ts`), the action `delivery.load` is now `roadmap.load`, types `Roadmap*`, docs and glossary. The plan store table keeps its name (`delivery_snapshots`): renaming it would need a migration for no visible gain.
- **One mode switch per tab**, at the right of every page header, the same component (`ui/ModeSwitch.tsx`): Today: Now · Plan · Check-in · Close out; Week: Week · Plan the week; Roadmap: Roadmap · Plan ahead (a placeholder until step 17); the Inbox has one mode, so no switch. Planning modes (Plan, Check-in, Close out, Plan the week, Plan ahead) show a green Done next to the switch: it saves (Plan the day's first Done commits, as before, and still offers Timebox my day once; Close out commits; Plan the week commits or recommits changes; Check-in marks today checked in) and returns to the tab's view mode. Esc in a planning mode goes back without saving.
- **Status on the switch** (`plan/modes.ts`): ✓ when done for that day (or week), a small dot while due, never forced. Plan: ✓ once committed, due on today's morning (before the morning ends) while not. Check-in: ✓ once done or closed out, due on a planned day from the end of lunch plus the check-in offset until Close out is due. Close out: ✓ once closed out, due from max(60 min, the Close out reminder lead) before the end of the day. Only today has dots. Plan the week: ✓ when its week is committed, due while a week nudge asks for that week.
- **New local action** `checkin.done {date}` (today only; a `checkin_done` marker). Week load adds `checkIn {date, done}` and `weekCommitted {<monday>: boolean}` (this week, next week, the week shown); the week's plan days add `closedOutAt`.
- **No auto-switching**: Plan the day no longer opens by itself on the first focus of a workday (the due dot on Plan replaces it). `planday.start` still accepts `auto` (unused by the UI).
- **Addresses** (`ui/nav.ts`): every place has one, mirrored in the URL hash with history, so back, forward and reload land in the same place, and a reopened window lands where the last one was (kept in localStorage): `#/today`, `#/today/plan[/<date>[/<AM|PM|EVE>]]`, `#/today/checkin`, `#/today/closeout[/<date>]`, `#/week[/<monday>]`, `#/week/plan[/<monday>]` (next week by default), `#/roadmap`, `#/roadmap/ahead`, `#/inbox[/<follow-up id>]`, `#/focus`, `#/settings/<section>`. Anything else opens Today.
- **Entry points**: a Week day header's Plan / Planned ✓ chip opens Today › Plan on that day; "+ Add work" and A open it on that day and block. Notification routes (unchanged strings) map to tab and mode: planday, checkin, closeout → Today in that mode; planweek:<w> (Plan the week, Look ahead) → Week › Plan the week on w; inbox, followup:<id> → Inbox; focus (timer, meetings) → the focus screen; vm → Today with the VM menu open; today (auto-shutdown still changed); settings:<s> (expiring secrets) → Settings. Commands route the same way.
- **Keys**: 1–4 tabs; P toggles the current tab's planning mode (I alias); W Week › Plan the week; M Today › Check-in; E Today › Close out; L Inbox; 3 is Roadmap (was the Plan ritual) and 5 is gone. Nothing fires while typing.
- **Q91** (cleanup): a sent notification whose occasion was handled (day planned, check-in or close out done, week planned, VM started or auto-shutdown put back, follow-up closed or none due, timer answered in the app) is closed through the notification service (freedesktop CloseNotification; `notify-send --print-id`), checked every 5 s while one is on screen. Meeting warnings, expiring secrets, tests and plain samples stay. Elsewhere a click opens a view that shows it's done.
- **Rollback:** revert the step 16.2 commit, rebuild, restart. No migration; the `checkin_done` markers would simply be unused.

## 42. Step 16.3: Teams presence, VM chip consolidation (authorized Nov 2)

Docs checked Nov 2 (Microsoft Graph v1.0): `setUserPreferredPresence` and `clearUserPreferredPresence` are `POST /users/{id}/presence/…` with delegated `Presence.ReadWrite`. Valid pairs include Busy/Busy and DoNotDisturb/DoNotDisturb. `expirationDuration` is ISO 8601; without it Busy and DND default to 1 day, so FocusTime always sends one. A preferred presence overrides session presence. `POST /communications/getPresencesByUserId {ids}` takes Entra object IDs, at most 650 per request, 1,500 requests per 30 s per app per tenant, with delegated `Presence.Read.All`. For delegated use, the permissions reference says "AdminConsentRequired: No" for both (only application `Presence.Read.All` needs an admin). Graph has no way to read the preferred presence alone; `GET /me/presence` gives the aggregate.

Contract changes:

- **A new external write, only my own Teams status** (`actions/presence-actions.ts`, `sources/graph/presence.ts`): set Busy (plain focus) or Do not disturb (deep focus), always with an expiration equal to the time left plus 5 minutes, and clear (back to automatic). No preview (my own status, reversible, time-limited). Every set, clear and "left as you set it" goes to a new Teams status log (plan store migration 18, `teams_status_log`), shown in Settings > Data. Never another person's status.
- **When:** one sync, after every timer action and on the server's 5 s tick (only while a timer exists or a status FocusTime set is still to clear). It sets on start, sets again on +15 (fresh expiration), on a switch between deep and plain, on resume and on a new session (Next pick). It clears on Stop, Done, Pause, a break, the session ending on time, the timer gone (abandoned, Reset local plan) and Settings turned off. What FocusTime set is kept in account state, so a restart still clears it. A failure waits a minute and is logged once.
- **A status I set by hand in Teams wins:** a minute after setting, and then every minute, FocusTime reads `/me/presence`. An availability other than the one set (or its meeting or presenting forms) means I changed it. FocusTime then leaves it alone: no more sets this session, and no clear at the end. Offline or unknown is not a change. The next session starts fresh. A manual Busy over FocusTime's Busy can't be told apart (Q92).
- **Timer:** `TimerState.deep` and `TimerView.deep`; `timer.start {deep}`; new action `timer.deep {on}`. Next pick keeps deep. The Focus button menu has Deep focus (on the next pick when there is one) and, while running, a Deep focus switch. The focus screen has a Deep focus checkbox and "Teams: Busy until 10:45".
- **Settings > Focus** (`[focus] teams_status = true`, `plain_focus_status = "busy" | "none"`): whether focus sets my status, and whether plain focus sets Busy or leaves it alone (deep focus always sets Do not disturb). It also shows whether Teams is connected, with "Allow Teams status" when consent is needed.
- **Sign-in:** a new token kind `presence` (`offline_access Presence.ReadWrite Presence.Read.All`) on the existing Microsoft sign-in, asked for incrementally (`auth.sign_in {teams: true}` adds the scopes to the Graph scopes of the browser visit). On Nov 2 the live sign-in already had consent (`presence_me` 200), so no prompt was needed.
- **Teammates' presence** (`presence.people {emails?, names?}`, at most 100): the server maps Cooptimizers (the Dataverse team, now read with `azureactivedirectoryobjectid`) to object IDs and asks Graph once for all of them. Only a word is returned: Available, Busy, In a meeting, Do not disturb, Away, Be right back, Offline. Status messages, out of office notes and work location are dropped on arrival. Nothing is stored, cached or logged beyond status, count and duration. Unknown presence, no consent, signed out or an error shows nothing. The UI (`ui/Presence.tsx`) reads for the people on screen and refreshes every 2 minutes while visible. It shows a small mark whose shape differs by state, with the word on hover and focus and for screen readers. Where: Needs help from… (Available now first within each tier, and in the times found), follow-up Who suggestions (the word on the suggestion), Roadmap people (by display name, which DevOps gives) and the help invite preview.
- **VM chip consolidation:** the header chip is the single place for VM status on every tab: "VM Running · off at 7:30 PM" (`VmStatus.text`, `chipText` in plan/vm.ts: the auto-shutdown time while running or starting and a schedule exists; "auto-shutdown off" when disabled; otherwise the state alone). Its title carries a changed schedule and errors, and a "!" asks for Azure consent. Its menu is unchanged (Start, Stop, Delay 1h / 2h, Skip tonight, Restore, Allow Azure access). Today no longer has its own chip, consent banner or error line. It keeps only the morning "Your VM is off. Start it?" box and "Auto-shutdown is still changed", now only after a restore failed (`stillChanged` requires `failedAt`). The auto-shutdown notification's route is `vm` (was `today`), so both VM notifications open the header chip's menu.
- **Demo mode:** fictional teammates with fictional presence (Jordan Lee Available, Priya Shah In a meeting, Sam Ortiz Away, Taylor Kim Do not disturb) and my status kept in memory. No Graph calls.
- **Live check (Nov 2):**
  - One 5-minute plain focus session set Busy for 10 minutes (`presence_set` 200). A minute later the manual-change check read Busy back (`presence_me` 200). Stop cleared the status (`presence_clear` 200), and both changes are in the Teams status log. The test focus row was removed afterwards; a backup is at `plan.db.bak-step163-focuslog`.
  - Teammates' presence: one batched read for 6 Cooptimizers (`presence_people` 200, count 6), all with a word. Only counts were printed.
- **Backlog (not built):** a registered internal Teams delivery thread per client, with preview-and-confirm posting; never post to external client threads.
- **Rollback:** revert the step 16.3 commit, rebuild, restart. Migration 18 only adds a table, which older code ignores (a newer schema number refuses to open, so restore the pre-step backup `plan.db.bak-*` if rolling back the code). The `[focus]` keys `teams_status` and `plain_focus_status` would then be unknown fields: remove them. A status set by a session expires on its own within the session length plus 5 minutes.


## 43. Step 16.4: profile photos, reliable person matching, simple estimating (authorized Nov 2)

**Contract changes (explained before building):**
- Week plan items: `blocks` is now a whole number from 1 to 20 for features, or empty (the feature takes the blocks its stories add up to). Stories no longer have blocks; they have a size, `S`, `M` or `L`, and a `parentId` (their DevOps parent). `weekplan.set_blocks` takes whole numbers only; `weekplan.add` takes `size` for stories and refuses blocks for them; new `weekplan.set_size`. `weekplan.set_tier` on a story nested in its feature is refused ("Stories take their feature's tier").
- `weekFit` (fractional room) is replaced by `weekBudget` (whole blocks per client, the half-days that don't count with a reason, planned and status words).
- New read action `people.photos {emails?, me?}`: data URLs for me and the Cooptimizers on screen. `presence.people` takes `me` for my own word (my avatar's corner mark).
- `auth.sign_in {photos}` asks for ProfilePhoto.Read.All on its own token kind (`photo`).
- Roadmap people carry the matched Cooptimizer's email (for photo and presence) and nothing more.
- No new external writes.

**Estimating (two units, whole numbers only):**
- Block: one half-day of client focus time. Features get a whole number of blocks.
- Story sizes: S about an hour, M a couple of hours, L about a whole block. Internally a block holds about four S, two M or one L (`plan/estimate.ts`); that math is never shown.
- Budget per client per week: the client's half-days (plus Open half-days pinned to it), minus PTO days, minus half-days with under 2 hours free after meetings ("Mon PM: mostly meetings"), minus whole blocks of borrowed time paid back this week. Always a whole number. Header: "Northwind · 3 blocks" then "All 3 planned", "1 block free" or "4 planned, 3 available"; musts count, nice to haves don't.
- Features are envelopes: a story whose parent feature is on the list nests under it (adding the feature later moves it under), fills the feature's blocks and never adds to the client total. Unfilled: "needs more stories". Overfilled: "Stories need more than 2 blocks. Raise to 3?" with one click. No block count: the stories' total, rounded up. A story without its feature on the list stays its own row, "Under <feature> · Add the feature", and counts in whole blocks (rounded up per client and tier). Nested stories take their feature's tier.
- Progress: done stories count toward their feature ("1 of 2 blocks done", whole blocks only).
- Everywhere else: no decimals or fractions. Plan the day keeps real minutes internally and shows "about 2 hours free", "Fits", "A little over", "About an hour over". Check-in and Today use the same words. Roadmap's rate reads "2 closed per week" or "1 closed every 3 weeks".
- Migration 19 (backup `plan.db.bak-v18-*` first): feature blocks rounded up to whole blocks; a story of half a block or less became M, larger ones L. On my plan store: 9 features already whole (none changed), 3 stories of half a block became M. Parents filled in from the next DevOps read.

**Photos and matching:**
- Graph docs checked Nov 2 (profilePhoto get, v1.0): `GET /me/photos/{size}/$value` and `/users/{id}/photos/{size}/$value`, sizes include 48x48 and 96x96; 404 when there is no photo. ProfilePhoto.Read.All (delegated) needs admin consent; it is requested incrementally with "Allow photos" in Settings > You.
- 96 px photos for my avatar (top bar, with my presence mark on its corner) and every listed Cooptimizer (Needs help from…, follow-up Who, Roadmap people, invite previews). No photo, no permission or no sign-in: initials.
- Cache: `~/.cache/focustime/photos`, file names are hashes, 7 days, older ones shown while read again in the background, a missing photo remembered too; cleared on sign-out. Only people on screen (at most 60 per read), only Cooptimizers with an Entra object ID. Logged with status only. Demo mode: generated avatars, no Graph calls.
- Person matching: DevOps `uniqueName` (kept as `assignedToEmail`, for matching only) against the Cooptimizer's email first; the display name only when there is no email and exactly one Cooptimizer has it.
- Q92 accepted as is (D343).

**Verification:** unit and browser tests (1567), including a scan of seven views for decimals and fractions. Real next week (Nov 9, counts only): 4 clients, whole budgets 1, 2, 1 and 3; planned 0, 1, 2 and 3; two with blocks free, one over, one all planned; 2 of 3 stories nested; my photo read. Demo screenshots at 1920 and 3840, dark and light (`docs/demo/164-*.png`).

**Rollback:** revert the step 16.4 commit, rebuild, restart, and restore `plan.db.bak-v18-*` (schema 19 refuses to open in older code). Delete `~/.cache/focustime/photos`.


## 44. Step 17: Plan ahead in the Roadmap tab (authorized Nov 2)

A 4-week plan and an 8 to 12 week direction view on one timeline, built in four slices, each committed. The only new external write extends the existing Set target date write to Start Date (slice 2). Estimating rules from step 16.4 apply everywhere: whole blocks, S/M/L, no decimals, plain-word rates.

**Contract changes (explained before building):**
- `roadmap.load` lists features and epics I own and those I contribute to (the parent of a story assigned to me), owned first. Each row: `relation` (owned or contributing), `parentId` (the epic above, when listed), `startDate` and `hasStartField`, `blocked`, `lastActivity`, `status` ({ state, reason, trendBuilding, forecastEnd }, replacing the three-level `signal`), `stories` (one level down, Removed left out, each with group blocked, active, new or done, the assignee and a matched Cooptimizer's email for the photo only). The state also carries `thresholds`.
- The DevOps portfolio read adds the process's Start Date (`Microsoft.VSTS.Scheduling.StartDate`) per type where the type has it (`ClientPortfolio.startFields`, `PortfolioItem.startDate`), and a `blocked` flag on children (Blocked state or tag, as the step 7 rule). Reads only.
- Config `[roadmap]`: `stalled_days` (3 to 60, default 14) and `watch_weeks` (0 to 4, default 1); Settings > Roadmap.

**Slice 1: Roadmap (the status board).**
- One state per row, evaluated in order: Blocked (an open story is blocked), At risk (the target date passed, or the pace forecast lands after it), Not scoped (no stories; an epic: no features), Stalled (no story change in `stalled_days`), Watch (the forecast lands within `watch_weeks` of the target; with nothing closed in the window and 2 weeks or more left), Needs a date (open work, no target date), On track, Done (every story done or resolved). The rules that need open work apply only with open work, so a finished feature reads Done, never Stalled or Needs a date (D344).
- Pace: stories closed per week from the daily snapshots of the last 21 days. The forecast is today plus the open count over that pace, rounded up to a whole day. Reasons in whole words: "9 stories open, about 3 close a week, 2 weeks left", "about 1 closes every 3 weeks", "…, needs about 5 weeks" when it overshoots, "Target date passed 1 week ago, 3 stories open", "No story changes in 3 weeks, 4 stories open".
- Trend building: under 7 days of counts, no pace and no pace-based state; the row shows "Trend building" and the reason leaves the pace out (D346).
- Summary bar: a card per state with its count (the counts follow the other filters, not the state filter), each a toggle. Toggle Both / Owned / Contributing, client chips, search (title or #id), sort by risk (state order, then target date; default) or target date. Filters combine and last for the session (sessionStorage), never beyond. "What do these mean?" shows each state's meaning and the order.
- Rows expand (▸) to their stories grouped Blocked, In progress, Not started, Done, with the assignee's photo, presence and name. Row ⋯ as before (Open in browser, Copy Coop brief, Needs help from…, Add to this week's plan, Set target date); Set target date is offered only on rows I own.
- Look: a 5 px state-colored edge, a solid state badge (word, a shape mark per state and the state color, never color alone), the reason in bold.
- Demo: fictional features so every state shows (Harbor's intake form Blocked by a tagged story, Northwind's export At risk, Supplier onboarding Not scoped, Atlas's dashboard Stalled, Knowledge base search On track, Patient portal login Done, two December features for a crowded month). The demo epic "Customer portal 2.0" is now "Customer portal redesign" so the no-decimals scan stays strict.

**Slice 2: Plan ahead (the timeline).**
- Roadmap › Plan ahead (P, `#/roadmap/ahead`): one timeline of 12 weeks from this week's Monday. Weeks 1 to 4 are weekly columns; weeks 5 to 12 are compressed into one column per month (a week belongs to the month its Thursday is in). A today line. Rows grouped by client; epics as thin parent bars with their features nested and collapsible.
- Bar dates (`plan/ahead.ts barDates`, D349): start = dragged, else DevOps Start Date (where the process has it), else the first planned week, else the first story activity, else today. End = dragged, else Target Date, else the last planned week's Friday, else the pace forecast, else two weeks from the later of start and today. Solid only when both dates come from DevOps; otherwise hatched with "est.". The target date is a diamond; a pace forecast after the target draws a dashed ghost past it (the row is At risk). Bars past the 12 weeks end with "→ date"; ones that ended before them show "← ended date".
- Dragging a bar's body moves both dates, an end moves one (whole days), kept locally (`roadmap.set_dates`, table `roadmap_dates`, migration 20) until "Save dates" (owned rows only) runs the existing Set target date write with `startDate` (preview, rev test, read back, audit log, undo restoring both). Reset goes back to DevOps or the estimate. Local dates that DevOps now matches are cleared on load.
- Week cells (weeks 1 to 4, features only): whole blocks 0 to the client's budget that week, shown as filled segments; click for a menu of choices, drag across cells to give each empty week 1. They write `weekplan.set_feature` for that week: the same rows Plan the week shows (new ones as musts; 0 removes). Epics show their features' total per week.
- Capacity strip per client: weeks 1 to 4 with Plan the week's words ("All 3 planned", "1 block free", "4 planned, 3 available", "No blocks this week"), the not-counted reasons on hover. Months: "N blocks, M features due" (blocks from focus patterns, standing blocks and PTO; meetings aren't known that far ahead), flagged "Crowded month" when the features due get fewer than 3 blocks each (D351).
- Keyboard: arrows move between rows and weeks, Enter expands an epic, + and − change the focused week's blocks (never while typing).
- Roadmap's summary adds "Over-booked weeks" (client weeks 1 to 4 with more musts than blocks); as a filter it shows the features with blocks in those weeks and their epics.
- Layout: the label column is 240, 320 or 440 px by window width; weeks take 1 share and each month 1.6, so 1920 and 3840 both fit without scrolling. Full titles on hover.
- Demo: Atlas Freight has two features due in December with few blocks (a crowded month); Northwind's export shows a ghost past its target.

**Slice 3: readiness and the link to Plan the week.**
- Readiness flags per row (`plan/ahead.ts readiness`), a ⚑ chip with the count (its words on a wide screen); the chip's menu lists each flag with its next steps: "Starts in N weeks, not scoped" (Break it down: a draft story under it, opened in the draft editor; Copy Coop brief), for an epic "…, no features" (Draft a feature), "No target date" (Set target date on mine, else Ask owner as a follow-up), "Target date before its last planned week", "Target in N weeks, nothing planned after week X" (or "nothing planned"; only gaps inside weeks 1 to 4; Plan its weeks focuses the first empty week cell), "Stalled" and "Blocked" (Ask owner as a follow-up: a Teams follow-up for the owner or the first person on its stories; Needs help from…), "Crowded month", "Target beyond 12 weeks", "Needs more stories" (a planned week whose listed stories don't fill its blocks, step 16.4). Weeks count from this week. Done rows have none.
- One source of truth with Plan the week (slice 2, D350): week cells are the week plan rows, so a change in either shows in the other; new rows are musts, the tier is switched in Plan the week.
- Planned against worked: two past weekly columns (2 weeks ago, last week) before week 1. Per feature (an epic: its features) the musts' blocks on that week's plan against the focused time on picks of it or its stories, in words: "planned 2, worked about 1", "planned 1, no focus time", "planned 1, worked under a block", "not planned, worked about 1". A block is the L size (Settings > Planning, 210 minutes by default), rounded to whole blocks. The capacity strip does the same per client.
- Rows grew a top band: week cells and the past words sit above the bar, so a bar can be dragged anywhere along it.
- Allocations: the week cells live in the week plan tables (migrations up to 19); the dragged dates in `roadmap_dates` (migration 20, backup first). No other new tables.
- Demo: committed week plans for the last 2 weeks and focused time on picks settled as dropped (so nothing carries over and no follow-up opens).

**Slice 4: rituals and nudges.**
- Look ahead 4 weeks (`plan/rituals.ts`): every other Thursday (from Nov 5 2026, D355), once that Thursday's next week is planned (Done in Plan the week). Due from work start on a working day in the Thursday-to-Wednesday window; a PTO day or a day without hours waits for the next working day's start. After Done in Plan the week, the Week shows an offer "Look ahead 4 weeks" (open Plan ahead, or Not now).
- Direction review: the first Thursday of each month, due from work start on a working day until the month ends.
- Both: a desktop notification once per occasion (new kinds `plan_ahead` and `direction`, each with its switch in Settings > Notifications under the ritual reminders, quiet outside hours and on PTO, held during focus), a due dot on Roadmap's Plan ahead, a click opens Roadmap › Plan ahead (route `ahead`). Opening Plan ahead answers them (`roadmap.ahead {seen}`, markers `ahead_seen`): the dot goes and a shown notification closes (Q91). Settings > Planning lists when each comes next.

## 45. Step 17.5: brand integration and IBM Plex Sans (authorized Nov 2)

The identity from `assets/brand/` in the app, with no layout or domain token change. Details in `docs/design/brand.md`; decisions D358 to D365.

- **Font:** IBM Plex Sans 400/500/600 for the UI, IBM Plex Mono 400/500 for keyboard hints, self-hosted from @fontsource (latin woff2); tabular figures; weights snapped to the three that exist.
- **Tokens:** brand-am, brand-pm, brand-accent, brand-ghost, mascot-highlight and brand-beam-blend in every theme; mascot-highlight only inside `ui/brand/`.
- **Assets:** Lumen upright, a level gradient beam (about 1.8x tall, 2.3x long, lime fading out, screen or multiply), a radial loading sweep about 50 degrees wide; re-baked; wordmark and lockup outlined (opentype.js); favicon.
- **Desktop:** `system/install-icons.sh` (install or uninstall into the user's hicolor theme, icon cache refreshed for the user folder only); notify-send `-i focustime` everywhere.
- **UI (`ui/brand/`):** WeekMark in the top bar (to Today); the opening (nothing within 400 ms, else the loader for at least 600 ms with each source waiting, done or didn't load; then the unroll, the hop into Mon AM and the flight into the top bar); Close out's reverse, with "Musts done. See you tomorrow." when today's musts are done; the first launch moment once (`ui.first_launch`); a reconnect moment in Settings > Connections; empty states in Inbox and Close out; About in Settings; Settings > Display "Reduce motion" (`ui.set_reduce_motion`), with the system setting doing the same.
- **Never:** Lumen in Week, Plan the week, Today › Now, Plan the day, Check-in, Roadmap or Plan ahead, on cards or for inline waits.
- **Open:** Q93 (the brief's surface palette), Q94 (a zero at-risk week moment, suggested after Done in Plan the week), Q95 (B08 live favicon), Q96 (the icon tile's recipe). B07 stays open.

## 46. Step 17.6: meetings on Today, launcher check (authorized Nov 2)

- **Bug:** Today › Now showed no meetings (never built, D366). Plan the day hid them behind a collapsed link.
- **Rules (`plan/todaycal.ts`, D367):** one entry per event in time order, declined hidden, tentative and free kept with their show-as, all-day apart, the configured time zone decides the day, FocusTime's own timebox events never shown as meetings, Now and Next on today only.
- **UI (`ui/DayCalendar.tsx`, D368):** meetings inside each block on Today, all-day row and before/after lines; Plan the day's agendas open by default with Now and Next.
- **Launcher check:** `system/FocusTime.desktop` passes `desktop-file-validate`, and the desktop's launcher lists it. No repo change.
- **Contract change:** none (no new action, source or store change). `AgendaItem` gains an optional `showAs`.

## 47. E1: estimating in half blocks, derived from sized stories (authorized Nov 3)

Revises step 16.4's estimating (section 43) and D334, D339. Decisions D438 to D441.

- Units: quarters of a block inside (`plan/estimate.ts`), integers only: S = 1, M = 2, L = 4, a block = 4. Shown as half blocks: "½ block", "1 block", "1½ blocks", "2 blocks", "half a block free", "2½ planned, 2 available". No decimals, no quarters.
- A feature's load this week: with sized stories under it on the list, their sum rounded up to a half block ("From its stories", no stepper); otherwise its estimate, ½ to 20 in half-block steps (±½ on hover, default 1 block). Unsized stories under it: "size its stories to plan from them". A story added to the week starts not sized.
- Loose stories (no feature on the list): each its own size rounded up to a half block, unsized as M.
- Budget: counted half-days × 4, less borrowed time in half blocks. The over line, the client line's fit words, the client panel and Plan ahead (cells, capacity row, past weeks) use the same quarters and words. Plan ahead's cells step half a block; a derived cell can't be set.
- The feature's other open DevOps stories are one muted line, "5 more stories · 2 assigned to others"; it opens the feature panel (each story with state and owner).
- Storage: `week_features.blocks` takes halves (SQLite migration 27 rebuilds the table, SQL Server migration 29 makes it decimal(3,1)); whole blocks stay valid, nothing converted. Export schema 27; 26 still reads.
- Plan the day unchanged.

## 48. MC-1: meeting capture, slice 1 (authorized Nov 6)

A client's registered weekly call becomes proposals its reviewers confirm. Decisions under "MC-1" (unnumbered until
merge); setup in `docs/setup/meeting-capture.md`; files in `docs/architecture.md` (MC-1).

- **New source scope:** Graph, delegated, `OnlineMeetings.Read` and `OnlineMeetingTranscript.Read.All` (admin
  consented), a person's own token (the registrant's, then the other reviewers'). Read only, and only for registered
  meetings and meetings FocusTime scheduled. No app-only permission, access policy or change notifications.
- **No new external write.** Confirm runs the existing writes: the step 14 create (`proposal_create`) for a gap and
  the step 14 comment for a decision or status, each through the write framework (preview, confirm, `test /rev`, read
  back, audit log, undo); a commitment is a CV-1 shared commitment (the person's own Promises, or my Waiting on).
- **Registration (admins):** Admin › Clients › <client> › Meetings. From my calendar or a pasted Teams link; name,
  role (Weekly status call, Planning), reviewers (the registrant and the client's leads by default), transcript source
  (Automatic for a Cooptimize organizer, Upload otherwise; detected, with an override to Upload). A client-hosted call
  keeps only calendar fields.
- **After each occurrence:** an Automatic call's transcript is polled for 12 hours, then its reviewers are asked to
  upload; an Upload call asks at once. Upload a transcript (.vtt or .docx) is always open to reviewers. "No
  transcript this week" dismisses. One AI request (`meeting.capture`, Flex for the poll, standard for an upload),
  one client, masked first.
- **Review:** "Update <client>'s plan · <meeting> <date>": tick, edit or skip each proposal with its quotes, then one
  Confirm with every write's preview. Reviewers confirm; attendees look.
- **Week:** the call on its client's card for its half-day, with what it needs from me; ⋯ › Client calls.
- **Nudges:** in the app (`meeting_review`, on by default) and in Teams (TB-2 kind Client calls to review, off by
  default), once per occurrence.
- **Retention:** transcripts and quotes 30 days; proposals and results kept; reviewers and attendees only.
- **Store:** one migration, `20261116T0900_meetings` (four app tables; adds only). Not in Export.
- **Rollback:** revert the PR and redeploy; the tables stay unused (an older build ignores them).

## 49. CW-1: co-working calls (authorized Nov 7)

Cooptimizers co-work on a Teams call in a client's delivery chat. FocusTime makes it visible and one click away. Decisions under "CW-1" (unnumbered until merge); files in `docs/architecture.md` (CW-1).

- **Call live.** A call started in a registered client chat and not ended shows on that client's first block today that hasn't ended (Week) and on Today's Now card: "Call live in <chat> · started 9:12", who started it (a Cooptimizer by name, anyone else as "someone outside Cooptimize"), and Join, which opens the chat in Teams. It clears on the call ended event, or 10 hours after the start.
- **Start a call.** The block's ⋯, its detail panel and the command menu: "Start a call in <chat>" (or "Join the call in <chat>" while live) opens the chat in Teams. FocusTime never starts, joins or posts in a call.
- **No new source scope and no new permission.** The shared poll's existing `GET /chats/{id}/messages` (delegated `Chat.Read`) already returns the call system events; they are read off the same pages. Same interval.
- **Rules.** Call events are never messages, conversations, promises or chatter, and never go to the AI. Nothing is recorded or transcribed; only the call id, its times and the starter's id and tenant are kept (`chat_calls`, 48 hours). Only registered chats count; only someone in the chat who follows its client sees it.
- **Store:** one migration, `20261121T1000_chat_calls` (an app table; adds only). Not in Export.
- **Rollback:** revert the PR and redeploy; the table stays unused (an older build ignores it).


## 50. CAL-1: Add any calendar by link (authorized Nov 10)

Pilots need personal calendars without Google sign-in, and Apple has no comparable API. Anyone can add a calendar by its ICS subscription link (Google's secret iCal address, an Outlook published calendar, an iCloud public calendar, a school or team app). Decisions under "CAL-1"; files in `docs/architecture.md` (CAL-1).

- **Add.** Settings › Accounts and calendars › Calendars added by link › Add a calendar by link: the link (webcal or https), Check link ("Found N upcoming events on host/…"), a name, a color, Busy only (default) or Show titles, Personal (default) or Work. At most 10 links. Where to find the link per provider in the help.
- **Show.** Its events on Week and Today like other events, in its color, read only; Personal ones follow the Personal events switch and count in risk and free time.
- **Refresh.** On use, at most every 15 minutes per link, conditional (ETag or Last-Modified); nothing polls when nobody uses FocusTime. Each link has its own source line: name, live, events, updated N min ago; a failure says why, with Retry, or Replace link when the link itself stopped working.
- **Private.** The link is a secret: sealed per person, never returned, logged or exported (only its host shows). Busy only stores no titles. Visible only to the person; admins never see links or events.
- **Safe fetch.** https only, no private or internal addresses at any hop (checked at connect time), 3 redirects, 15 seconds, 5 MB.
- **Store:** one migration, `20261128T0900_calendar_links` (two user tables; adds only). Not in Export.
- **Rollback:** revert the PR and redeploy; the tables stay unused (an older build ignores them).

## 51. VM-2: Stop, and an opt-in start before the day begins (authorized Nov 11)

From the Nov 11 review: start the VM on work days before the day, but never from dev. Decisions under "VM-2" in `docs/decisions.md`.

- **Stop.** The VM chip's menu has Stop… while my VM runs: a preview (Running → Stopped (deallocated), it stops billing, anything running on it ends, its auto-shutdown isn't changed), then Stop; followed until Azure shows it. Only my own confirmed VM; amends D475.
- **Start without a preview.** Was Start right away; same setting.
- **Start my VM before my day.** Off by default; minutes before my day starts (0, 5, 10, 15, 30) and which of my working days. Never on PTO or a holiday, never when it already runs; once a day; late by up to an hour; pauses after 3 working days without FocusTime (Resume). Production only: the env check is first, and dev never starts a VM. Uses my own Azure sign-in; when it can't, the VM stays off and FocusTime says so once.
- **Setup.** A fifth, optional screen: Your VM.
- **Not in it:** any schedule change, stopping on a schedule or when idle, other VMs, the assistant or the Teams bot, Azure, Entra or infra changes.
- **Store:** no migration (settings rows and kv state). **Rollback:** revert the PR and redeploy; the settings rows are ignored by an older build.

## 52. RB-1: Code, every client's repos, read only (authorized Nov 12)

Cooptimizers borrow working code from one client to start the same job at another. Code gives every Cooptimizer one place to open any client's repos, walk the tree and read a file, read only. Decisions under "RB-1" in `docs/decisions.md`; the rules in CLAUDE.md (Client code (RB-1)).

- **Code.** `#/code[/<client>[/<repo>[/<path>]]]` from ⋯ and the command menu: the client picker, the repo, Find a file, the tree, and the file colored by its language with line numbers, Copy, Copy path, Copy DevOps link, Copy link, Wrap, and Format for squashed JSON. One client at a time, its name and color always in the header with Read only.
- **Who.** Every Cooptimizer, every client, unless an admin sets a client to its team only. Guests, automation accounts and the demo's people never reach real code.
- **What is read.** The client's registered project, its default branch, with the company read token (it needs Code (read), added by hand). Text up to 1 MB; binaries, images and larger files say why.
- **Kept.** Only the view log (`code_views`, 12 months, admins only). Nothing of the code.
- **Not in it:** a view by kind, search across clients or inside files, other branches, history or pull requests, notebooks as cells, Markdown as a page, anything with AI, any write.
- **Store:** one migration, `20261113T0022_code_views` (an app table; adds only). Not in Export. **Rollback:** revert the PR and redeploy; the table stays unused.

## Part 0: a shared owner and state per conversation

One record per conversation, the same for everyone who can see it: an owner (none, or one Cooptimizer, plus helpers), a state (Open, Owned or Closed) and a history. Each person sees Asked you, Up for grabs, You're on it, Teammate has it or Done, worked out from that record. I'll take it, Give to…, Add helper, Release, Close out and Reopen apply at once with Undo (through the Assistant and Teams, as a proposal with Confirm). A reply or a detected "I'll do it" only offers one tap. The first of two claims wins. Asking again on a Closed one reopens it to its last owner; a new message on an Owned one notifies the owner. Nothing is posted to Teams. Existing conversations are moved once by a backfill. Decisions under "Part 0" in `docs/decisions.md`.
