# Coopilot | First Slice Spec v0.1 (Milestones 1 and 2)

October 31, 2026. Status: proposed, not authorized. Reads with Discovery Brief v0.3 and Build Plan v0.3.

## 0. Machine inventory (collected Oct 31, read-only)

| Item | Finding | Implication |
|---|---|---|
| OS / desktop | Omarchy 4.0.6, Hyprland 0.56.2 (Lua config), Quickshell 0.3.2 | Shell plugins possible later; not for main app |
| Hardware | 20 threads, 31 GB RAM, Intel UHD (Raptor Lake), 441 GB free | No resource constraints; Intel GPU avoids most WebKitGTK/NVIDIA issues |
| Display | One 3840x1080 ultrawide at 119 Hz, scale 1 (seen at 1920x1080 on Oct 31) | Wide and short by default; since step 4.5 the view also adapts to medium and narrow windows (D69) |
| Runtimes | Node 26.12 (via mise), npm 11, Deno 2.9, Python 3.14. No Rust, Bun or pnpm | Option A needs nothing new at the system level; Option B would require installing Rust |
| Browser | Chromium 155, default `omarchy-browser.desktop` | App-window approach and Playwright inspection both available |
| Secrets | Secret Service on the session bus, `secret-tool` present; gnome-keyring and kwallet both installed | Keyring works; which daemon owns Secret Service still to confirm (not blocking) |
| Storage | sqlite 3.54 | Fine for Milestone 3 |
| Remote | Remmina 1.4.43, FreeRDP 3, 4 saved profiles (gvnc plugin warning, harmless for RDP) | Ready for the launch/resume slice later |
| Cloud CLI | Azure CLI not installed | Schema check uses the browser instead (see open questions) |
| Audio | Shure MV7 is the default input | Good basis for voice capture later |

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

**Person and client (corrected Oct 31):** the Account Worker link is the reliable source for both. `coop_systemuser` is filled on only 13 of 49 active rows and Focus Time's own `coop_account` on only 2 of 25 ongoing rows, while all 25 ongoing rows have an Account Worker with a user and an account. Person = `coop_AccountWorker/coop_user`, client = `coop_AccountWorker/coop_account`, each falling back to the Focus Time column. Tanner has 4 ongoing patterns (verified Oct 31). The app identifies Tanner by his `systemuserid` (resolved once at setup from his Entra object ID via `systemuser.azureactivedirectoryobjectid`, stored in config), never by name matching. The name match in the test script was a one-off shortcut.

**Identity isolation (found Oct 31):** the application user inherits roles from its business unit's default team ("Cooptimize": Project User, Project Common, Roadmap User), so it could read Contacts despite its own narrow role. Fix: place the application user in a child business unit (e.g. "Coopilot Integrations") whose default team has no roles; Coopilot Reader at Organization depth still reads org-wide.

**Friday (confirmed need):** not a scheduled workday, but available as an overflow and catch-up day for missed focus time. The week view shows Friday as a distinct, lighter overflow column with meetings and personal events but no focus blocks from Dataverse. Moving slipped work onto Friday arrives with the plan layer (Milestone 3).

**Internal (confirmed fact, open proposal):** Cooptimize exists as an account with DevOps settings, but internal focus time is usually not recorded. Decided: Mon–Thu half-days with no focus block show as "Open", meaning available for client or internal work.

**Standing Internal block (being considered by Tanner):** Monday AM as default fixed Internal (Cooptimize) focus time. Implemented as a config setting `standing_blocks = [{ day = "Mon", half = "AM", client = "Internal" }]`, labeled as coming from Coopilot config rather than Dataverse. If Dataverse has a client block in the same half-day, the client block shows and the slot is flagged "double-booked" so the conflict is visible. Recording internal focus time in Dataverse is a possible team practice change, not part of this slice.

**Client and DevOps config** = `account`: `name`, `coop_reportingnickname` (likely short name for UI), `coop_devopsorg`, `coop_devopsprojectid`, `coop_devopsprojectname`, `coop_devopsteam`, `coop_devopstoken` (PAT). Also present but out of scope: Teams IDs, invoice fields.

**Possibly useful later:** `coop_timeofftracker` / `coop_timeofffact` (time off as a risk source), `coop_workingdays` / `coop_workingdayscalendar` (holidays).

**Security finding:** `coop_devopstoken` has column security **off** (`IsSecured=false`, though it can be secured). Any identity with read on Accounts can read every client's PAT today. See D24.

## 1. User story

On Monday morning I open Coopilot and see this week as a grid of half-days. Each half-day shows my focus block (client or Internal, colored), my Outlook meetings and my personal Gmail events layered on top. Half-days at risk are highlighted with a plain reason, such as "3h 15m of meetings inside the Woodard & Curran block". I can see where each item came from and when it was fetched. If Google sign-in has expired, the rest of the week still shows, with a clear "Reconnect Google" path.

## 2. Non-goals for this slice

- ~~No plan layer, dragging, ignition, triage, recap, capture or drafts (Milestones 3 and 4).~~ Step 5 (Oct 31) adds the local plan store, morning planning (now Plan the day) and local draft stories (section 19). Still no dragging, triage, recap or capture.
- No AI provider calls. The whole slice works without AI.
- ~~No DevOps reads and no PAT access.~~ Superseded by step 4 (Oct 31): read-only DevOps work items assigned to me, PATs read per fetch (D59–D66). Still no DevOps writes.
- No writes to Dataverse, Outlook, Google or anywhere else.
- No teammate focus blocks on screen (fetch only Tanner's rows).
- No Remmina, Azure VM, Teams or Coop integration.
- No Hyprland keybinding or shell plugin. ~~No autostart.~~ Step 5 adds a systemd user service and an XDG autostart entry, with no Hyprland config change (D79).

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

**Half-days are units of commitment, not fixed clock windows (confirmed).** Tanner's real day: start around 9:00 after preschool drop-off, sometimes a break when school lets out around 3:30, then either resume or stop, flexing into the evening, another day or Friday.

So the slice uses a soft "day shape" in config only to place meetings and events into AM or PM and to estimate capacity: default start 09:00, AM/PM split 12:30, usual end 17:00, America/New_York. Events outside that shape (evenings) are shown, not hidden. Risk is about how much of a half-day's usable time is consumed, not about exact hours.

**Borrowed time (confirmed problem, proposal for Milestone 3):** Tanner sometimes makes up a slipped block in the evening or later in the week, outside focus time, and that borrowing can pile up unnoticed. Proposal: when a block slips, the recap or triage records it as borrowed time with a planned repayment (evening, another day, Friday). The week view shows the running total so overcommitment is visible early. Not part of Milestones 1–2.

Proposed v1 rules, thresholds in config:

1. **Meeting load:** busy/tentative meeting minutes inside a focus block ≥ 90 → watch, ≥ 150 → at risk. Reason names the minutes and block.
2. **Personal conflict:** any personal (Google) timed event overlapping a focus block → at risk. All-day personal events → watch.
3. **No focus window:** no contiguous free gap ≥ 90 minutes inside the block → at risk.
4. **Double-booked block:** more than one focus block in the same half-day → at risk.

Events marked free are ignored. Declined Outlook events are excluded. Rules are pure functions with table-driven tests.

## 7. Data and secret boundaries

| Data | Where it lives | Notes |
|---|---|---|
| Dataverse focus blocks (Tanner's rows only) | Memory + cache file | Cache holds only normalized fields |
| Outlook events | Memory + cache | Subject, times, showAs, response status. No bodies, no attendee lists in this slice |
| Google events | Memory + cache | Title, times, all-day flag |
| Tenant ID, client IDs, environment URL, table/column names, half-day hours, colors | `~/.config/coopilot/config.toml` | Not secret, but not committed to a public repo |
| Dataverse app credential (prefer certificate) | Keyring (Secret Service) | Never on disk in plain text |
| Microsoft and Google refresh tokens | Keyring | Access tokens in memory only |
| DevOps PATs | Memory only, for one DevOps fetch | Read from Dataverse by `devopsTargets` only, wrapped in `Pat`; never logged, cached or returned (D60) |
| DevOps work items (assigned to me) | Memory + cache per client | Id, title, type, state, state category, board order, parent id, changed date, URL. No PAT, no identity email |

Never logged: tokens, secrets, Authorization headers, raw HTTP bodies. Logs record source, status code, duration, item count. A test asserts that a fake token passed through every code path never appears in logs, cache or error messages.

If a local HTTP server is used: bind 127.0.0.1 only, check `Host` and `Origin`, require a per-launch random token for every request.

## 8. Auth approach (proposed decision D21, needs Tanner's agreement)

- **Dataverse:** dedicated app registration + Dataverse application user with a custom security role granting **read on the focus block table only** (and the client table if needed for names/colors). Certificate credential stored in keyring. This keeps Coopilot from inheriting Tanner's admin rights.
- **Outlook (Graph):** dedicated public-client app registration, **delegated** sign-in as Tanner, scope `Calendars.ReadBasic` (Microsoft lists it as least privileged for calendarView). Application permissions would cover every mailbox in the tenant unless separately restricted in Exchange, so delegated is the tighter choice for one person's calendar.
- **Google:** desktop OAuth client, loopback redirect with PKCE, scope `calendar.events.readonly` (or `calendar.events.owned.readonly` if only Tanner-owned calendars matter). Note for setup: Google OAuth apps left in "Testing" status issue refresh tokens that expire after about a week; confirm current behavior when setting up and decide whether to publish the app for internal personal use.

## 9. Failure states (each visible in the source status bar)

| Situation | What Tanner sees | Recovery |
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
- Repo: `~/Code/coopilot` (path to confirm)
- Config: `~/.config/coopilot/config.toml`
- Cache: `~/.cache/coopilot/` (safe to delete anytime)
- Keyring entries under service name `coopilot`
- Optional: `~/.local/share/applications/coopilot.desktop` (only if Tanner wants a launcher entry now)

Not touched: Hyprland config, Omarchy config, existing browser profiles, Remmina, any existing keyring entries.

Outside the machine (Tanner does these in Entra/Dataverse, Claude can write the click-path):
- App registration "Coopilot Dataverse Reader" + application user + custom read-only role + column security on PAT column
- App registration "Coopilot Desktop" (public client, delegated `Calendars.ReadBasic`)
- Google Cloud project with Calendar API enabled and a desktop OAuth client

## 11. Dependencies

Pinned at install time after checking current releases. Shared by both stack options: TypeScript, React, Vite, zod, MSAL (`@azure/msal-node` or equivalent), Google auth library, a keyring binding for Secret Service, Vitest, Playwright for UI checks. Option-specific additions in section 13.

## 12. Install and rollback

Install: clone/create repo, install deps locally in the repo, run setup to write config and connect accounts. No global packages beyond what the chosen runtime needs (via existing package manager or mise).

Rollback: stop the app, run `auth.disconnect` for each source (or delete `coopilot` keyring entries), remove repo, `~/.config/coopilot`, `~/.cache/coopilot`, and the optional .desktop file. In Entra/Google: delete the app registrations or revoke consent. Nothing else changes, so nothing else needs reverting.

## 13. Stack options (inventory done: A recommended)

**A. Local TypeScript app in an Omarchy web-app window (recommended for the first slice).** Runs on the existing mise-managed Node 26 and Chromium 155 with no system-level installs.
A small Node or Bun backend on 127.0.0.1 serves a React UI, opened as an app-style Chromium window (the same pattern Omarchy uses for web apps).
- For: one language, fastest feedback loop, Chromium rendering, Playwright can inspect the exact UI, easy to maintain, chat panel later is just another client of the same actions.
- Against: it's a browser window, not a "real" app; a localhost server needs the hardening in section 7; keyring access via a native Node binding.

**B. Tauri 2 desktop app (Rust core, same React UI).**
- For: native window and lifecycle, no open local port, secrets and HTTP stay in Rust, small footprint.
- Against: two languages; WebKitGTK rendering and its Wayland/GPU quirks on Hyprland; heavier build toolchain; slower iteration while the product is still being discovered.

Both keep the same `actions/`, `week/` and UI, so moving from A to B later means replacing the thin host layer. An Omarchy 4 shell plugin (QML) is a good later candidate for a quick-capture hotkey, but not for the main app, since it runs inside the long-lived desktop shell process.

## 14. Acceptance steps

1. With config and all three accounts connected, `week.load` for the current week shows real focus blocks, Outlook meetings and Gmail events, each labeled by source with a fetched-at time.
2. Revoke Google consent: Google shows "needs reconnecting", Dataverse and Outlook still display, reconnect restores it.
3. Disconnect the network: cached week shows with an offline banner and timestamps.
4. A half-day with ≥ 150 meeting minutes inside its focus block is flagged at risk with the minutes in the reason.
5. A personal event inside a focus block is flagged with the event time in the reason.
6. Week grid is fully usable by keyboard: arrow keys move between half-days, Enter opens details, `t` jumps to today, `[` and `]` change week.
7. Grep of logs and cache after a full run finds no token, secret or Authorization header.
8. Dataverse app user cannot read the PAT column (verified with a deliberate read attempt that must fail).
9. Real UI inspected on Tanner's monitor layout via screenshot; no AI provider needed for any step.

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
- Q6. Which client is on which pattern? The sample guesses Mon AM Quiddity, Mon PM + Tue PM CSC, Tue AM Internal, Wed All Day + Thu AM Woodard & Curran. Real data replaces this in step 2.
- Q7. ~~All-day and OOO Outlook events~~ Resolved in step 3 (D54): out of office puts covered half-days at risk; other all-day Outlook events are a watch only if busy.
- Q8. ~~Personal events on Open half-days~~ Resolved in step 3 (D54): shown, never flagged.
- Q9. The kickoff folder and zip (`coopilot-kickoff/`, `coopilot-kickoff.zip`) are still in the repo folder and git-ignored. Their docs were copied to the repo root. Delete them when you're happy.

Raised in step 2 (not blocking):
- Q10. The internal account's nickname is "Cooptimize", and that is what the grid shows. Should it show as "Internal" (the glossary word) instead?
- Q11. ~~Sample meetings over real blocks~~ Resolved in step 3 (D53): sample meetings show only for a calendar with no config section. Sample meetings now sit on top of your real focus blocks, so some risk badges this week come from sample meetings. Keep that until step 3 (as now, labeled sample), or hide sample meetings once Dataverse is live?

Raised in step 3 (not blocking):
- Q12. Google publishing status. Google requires a homepage and privacy policy URL to switch an External app to production, so Coopilot stays in Testing for now. In Testing, Google ends the sign-in after 7 days and the status bar asks to reconnect. Option: two small public pages (for example on GitHub Pages) to unlock production. Decide after living with weekly reconnects.
- Q13. Ranking of double-booked block and all-day event in the single badge (D58) was my placement, not requested. Confirm or reorder.

Raised in step 4 (not blocking):
- Q14. W&C has no DevOps email on my Account Worker row, so W&C shows "DevOps identity missing". Fill in `coop_devopsemail` in Dataverse to see W&C items.
- Q15. CSC's `coop_devopsprojectid` in Dataverse does not match the real project ID (the name works, so Coopilot uses names first). W&C and Quiddity have no project ID. Correct them in Dataverse if IDs are wanted.
- Q16. PAT column security (D24) matters more now that Coopilot reads PATs: any identity with read on Accounts can read every client's PAT. Consider securing `coop_devopstoken` and granting the Coopilot app user read on it only.
- Q17. Microsoft retires global PATs on December 1, 2026. Any client PAT created as a global PAT stops working then; recreate as organization-scoped PATs before that date.
- Q18. Some client processes put Blocked states in the Removed category (Quiddity: Task "10-Blocked", User Story "07-Blocked"), so blocked items are hidden, as the metadata says. Keep that, or treat Blocked as open?
- Q19. Cooptimize items show because the Monday AM standing block is Cooptimize. If that block is removed, Cooptimize work only shows in weeks with a Cooptimize focus block. Always include it?

## 17. Decisions proposed this round

| ID | Status | Entry |
|---|---|---|
| D19 | Re-scoped | AI provider choice no longer blocks Milestones 1–2 |
| D21 | Proposed | Dataverse via app user with read-only custom role; Outlook via delegated `Calendars.ReadBasic`; Google via desktop OAuth `calendar.events.readonly` |
| D22 | Proposed | Stack option A for first slice, with a host layer thin enough to move to Tauri later |
| D23 | Done (step 5) | Cache last good snapshot as files; SQLite arrives with the plan layer (built in step 5, D71) |
| D24 | Superseded by D60 | PAT column security not a priority now (tokens are read-only). Coopilot now reads PATs for DevOps (step 4). Column security is still off, so any identity with read on Accounts can read every PAT (Q16) |
| D22 | Accepted | Stack option A (local TypeScript app in a Chromium app window) |
| D28 | Confirmed | Unassigned Mon–Thu half-days display as "Open" (client or internal) |
| D30 | Proposed | Monday AM is a standing Internal block from Coopilot config; Dataverse client blocks take precedence and raise a double-booked flag |
| D29 | Confirmed | Half-days are soft commitment units; day shape in config is for placement and capacity only |
| D26 | Confirmed | Workweek is Mon–Thu; Friday is an optional overflow/catch-up day shown separately |
| D27 | Confirmed | Focus Time rows are recurring weekly patterns expanded per week |
| D25 | In place, amending | Application user "Coopilot Dataverse Reader" with role Coopilot Reader: Read (Org) on Focus Time, Account, User; adding Account Worker. Token, connect and read verified Oct 31 |
| D31 | Done | Application user moved to its own business unit with no team roles; Contacts refused, only Coopilot Reader access (verified Oct 31) |
| D48 | Done | Outlook and Google sign-in is authorization code + PKCE (S256) through a one-shot listener on 127.0.0.1 with a random port, written with built-in `fetch`, `crypto` and `http`. No MSAL or Google client library. Redirects: `http://localhost` for Microsoft (registered under Mobile and desktop, any port matches) and `http://127.0.0.1:<port>/` for Google. The listener checks Host and `state`, then closes |
| D49 | Done | Refresh tokens live only in the keyring (`outlook-refresh-token`, `google-refresh-token`); access tokens only in memory. Microsoft rotates refresh tokens, so a new one replaces the old on every refresh. The Google desktop client secret is read from the keyring (`google-client-secret`) and Coopilot never writes or deletes it |
| D50 | Done | Scopes: Microsoft `offline_access Calendars.ReadBasic` (no body, attachments or attendees); Google `calendar.events.readonly`. Requests select only the fields used: Outlook `subject,start,end,isAllDay,showAs,responseStatus,isCancelled`; Google `id,status,summary,transparency,start,end,attendees(self,responseStatus)` (the self entry only matters, to detect my declines) |
| D51 | Done | Normalization: cancelled events and ones I declined are dropped. Outlook `workingElsewhere` counts as free, `tentativelyAccepted` and `tentative` as tentative. Google `transparent` counts as free. Outlook is fetched with `Prefer: outlook.timezone` set to the day shape zone; Google uses `singleEvents=true` over Mon 00:00 to Sat 00:00 local. Paging links are followed only when they stay on the provider API; a failed later page fails the whole fetch, so a partial week is never cached |
| D52 | Done | `auth.disconnect(outlook or google)` is local only: it forgets that source's refresh token, its in-memory token and its cached snapshots. It does not revoke the grant at the provider (revoking is a write; remove access in the account settings if wanted). Dataverse cannot be disconnected from the UI |
| D53 | Done | Sample meetings are used only for a calendar whose config section is missing or has an empty `client_id`. Once configured, that source is real (live, cached or needs sign-in) and never falls back to samples. The fixture stays for tests |
| D54 | Done | Q7 and Q8: an Outlook out-of-office event puts the half-days it covers at risk (timed: if it overlaps; all-day: the whole day). Other all-day Outlook events are a watch ("All-day event") only if busy or showAs is missing; free and tentative are ignored. Personal events on Open half-days and Friday show but never flag |
| D55 | Done | Status bar per calendar: LIVE, CACHED (with the snapshot time), NEEDS SIGN-IN with Connect or Reconnect, and Disconnect behind a confirm. While sign-in runs, the bar says to finish in the browser; it gives up after 5 minutes |
| D56 | Done | Freshness (step 3.5): the window refetches all sources when it regains focus (at most once per 60 s), quietly every 5 minutes while visible (a manual or focus refresh resets that clock), and on "r" or Refresh. Only one refresh runs at a time. Focus and background refreshes do not show "Loading" |
| D57 | Done | A refresh never blanks the grid: the data on screen stays until new data arrives. If the server cannot be reached, the last good week stays with "Could not reach the Coopilot server. Showing what was loaded earlier"; if a source fails, the server already returns its snapshot with the CACHED or error state. A slower older response never overwrites a newer one. The status bar shows "updated N min ago" per source (the exact time is in the tooltip) |
| D58 | Done | One badge per half-day card: the most serious risk, then "+N more". Order: at risk before watch; within a level out of office, personal conflict, double-booked block, no focus window, all-day event, meetings. Double-booked and all-day event were not in the requested order; they sit where shown. The details panel lists every reason in the same order |
| D59 | Done | The week view shows personal assigned work: DevOps work items assigned to me, open (state category not Completed or Removed), any type, no sprint filter, in each client's focus blocks. Ownership (epics and features I own, contributors' progress, target dates) is a separate future area, not this view |
| D60 | Done | PATs: Dataverse `devopsTargets(clientKeys)` is the only query that selects `coop_devopstoken`. It runs at DevOps fetch time, only for clients with a block this week, only for accounts I am an active Account Worker on, and wraps each PAT in `Pat` at once (String, JSON and inspect show `[PAT]`). The cached focus block path never selects it. The PAT is used only to build `Authorization: Basic base64(":" + PAT)` for `https://dev.azure.com/<org>/`, with redirects not followed. Not kept between fetches |
| D61 | Done | Identity per client = my Account Worker `coop_devopsemail`, used as `[System.AssignedTo] = '<email>'` in WIQL. Blank means "DevOps identity missing for <client>" and no call. Verified Oct 31: matches in the Cooptimize, Quiddity and CSC orgs |
| D62 | Done | Open = per work item type, states whose category (from that project's `workitemtypes` metadata) is not Completed or Removed. WIQL has one clause per type, since state names differ per type ("Ready for Go-live" is Completed for Bug but Resolved for Issue in one real project). Items are re-checked after the batch |
| D63 | Done | Board order = `typeFields.Order.referenceName` from the project's process configuration (StackRank or BacklogPriority), detected per project. No order field: sorted by last change. Unranked items go last. Type, state and order metadata are kept in memory for 1 hour |
| D64 | Done | API: api-version 7.1. WIQL (`$top=1000`, ids only) then `workitemsbatch` (200 ids per call, documented maximum) for System.Id, Title, WorkItemType, State, Parent, ChangedDate and the order field, `errorPolicy: omit`. The item link is built as `https://dev.azure.com/<org>/<project name>/_workitems/edit/<id>`. Project paths use the project name first, then the ID: CSC's stored ID is wrong and two accounts have none (Q15) |
| D65 | Done | Isolation: each client is fetched in its own try/catch and cached in its own file (`devops/<slug>-<hash>.json`, items only). Results are keyed by exact client key, the same key focus blocks use (`clientKeyOf`: nickname, else name); two accounts with one key are refused, not merged. A block shows only its own client's items; Open half-days and Friday show none. If DevOps fails as a whole, the week still loads |
| D66 | Done | Failure messages: "DevOps PAT expired or invalid for X" (401, 203, redirect or non-JSON), "No access to DevOps project P for X" (403, 404), "DevOps organization O unreachable" (network), "DevOps identity missing for X", "DevOps not set up for X (missing ...)", "No Account Worker for X in Dataverse", "DevOps settings unavailable (Dataverse ...)". Failures fall back to the client's last good items with their time |
| D67 | Done | Refresh: DevOps follows the step 3.5 triggers, throttled more because items do not depend on the week: a normal load (changing weeks) reuses results up to 5 minutes old; a forced refresh refetches a client at most once a minute; metadata is cached for 1 hour. That keeps a refresh to about 2 DevOps calls per client and avoids refetching on every week change |
| D68 | Done | UI: each block shows its client's top 3 items by board order and "+N more"; the details panel lists all, each a link that opens in a new browser tab (only `https://dev.azure.com/` links). The status bar has one "DevOps N of M live" entry; hover or click for each client's status and message |

## 18. Backlog (not built)

- **End-of-day recap (next step):** built around closing loops (D92). It lists the loops opened today and what would close each, from the day's picks, slipped or moved blocks and blocked items, and lets me close one with an optional note. Proposal only; to be specified and authorized.
- **Waiting-on loops:** things others owe me, the mirror of D92's loops. Later.
- **AI layer (direction, D93):** interpret Teams, email and DevOps to detect loops and synthesize context, staged as rules, then signals, then AI proposals I confirm, then an orchestrator, always through the same actions and confirmations.
- **Ownership area** (future, separate from the week view, see D59): epics and features I own, progress of the people contributing to them, and risk against target dates. Would need its own read model, likely per-client WIQL on ownership fields, and its own view. Not in the Look-ahead.

## 19. Step 5: morning planning, now Plan the day (authorized Oct 31)

Purpose: in about two minutes, turn today's real capacity into a short, committed plan per block, at story level. All local; no writes to DevOps, Outlook, Google or Dataverse.

- **Store:** SQLite through Node's built-in `node:sqlite` (no new dependency) at `~/.local/share/coopilot/plan.db` (0600, folder 0700). Numbered migrations in `store/plan-store.ts`; timestamps carry offset and zone (`2026-11-03T08:41:00-05:00[America/New_York]`). Tables: `day_plans`, `picks`, `draft_stories`, `markers` (once-a-day flags). Export: `node scripts/plan-export.ts [file]`.
- **Actions** (validated, shared with the future chat): `planday.start(date, auto?)`, `planday.commit(date)` (renamed from ignition in step 6), `pick.add`, `pick.remove`, `pick.set_size`, `pick.move`, `pick.mark_done`, `draft.add_story`.
- **Flow:** today's column widens into the planning panel and the rest of the week dims. Each half-day shows client and free time from now on (after meetings and personal events), with fits, tight or over by X. Carry-over (unfinished earlier picks) sits at the top. Picks come from that client's DevOps items in board order, or a typed intention. Open half-days pick from any client you're an Account Worker on, plus Cooptimize (D81), and take the first pick's client; mixing clients is allowed but flagged. `c` commits; the picks then show as a checklist on the week view.
- **Story level:** pickable types come from each project's process backlog categories (requirement, task and bug), not type names. Epics, features and other portfolio levels (except types listed in `[plan] pickable_portfolio_types`, D80) open into their open children (any assignee, up to two levels, read with WIQL and the batch call). None: "Needs breakdown" and local draft stories, which stay local until a write step is authorized (D82).
- **Sizes:** S about 1 h, M about 2 h (default), L a whole block (about 3.5 h). Nothing above L: split it first.
- **Triggers:** on Mon–Thu the first window focus after 05:00 opens Plan the day once if today isn't committed; `p` (or `i`) opens it any time. One desktop notification (`notify-send`) between the day-shape start and 90 minutes after it if today isn't committed, once per day (D83).
- **Always on:** `~/.config/systemd/user/coopilot.service` (from `system/coopilot.service`, restart on failure) and `~/.config/autostart/coopilot.desktop` (from `system/coopilot.desktop`, runs `scripts/open-window.ts`).
- **Rollback:** `systemctl --user disable --now coopilot && rm ~/.config/systemd/user/coopilot.service ~/.config/autostart/coopilot.desktop && systemctl --user daemon-reload`. The plan store can be removed with `rm -r ~/.local/share/coopilot` (export first).

## 20. Step 5.5: Omarchy app, Edge profile links, polish (authorized Oct 31)

- **Launch path (D85–D88):** `coopilot-open` starts the service if needed, waits for it, then focuses the Coopilot window or opens it with Omarchy's web-app pattern (own Chromium data directory, class `chrome-127.0.0.1__-Default`). A window from an earlier server run is replaced. Used by the launcher entry "Coopilot", Super + Alt + C and login autostart.
- **Links (D89, D90):** `link.open(clientKey, url)` checks the link is on that client's DevOps org, then starts Edge with the client's profile (`[edge]` in config) from an argument array. Unmapped clients open in the default browser with "No Edge profile set for <client>". Week cards, details, Plan the day picks and candidates all use it.
- **Polish (D91):** the source line is gone from cards in every layout; details keep it.
- **Recorded only:** Loop (D92), the AI direction (D93) and the end-of-day recap as the next step (section 18).
- **Files installed:** `~/.local/bin/coopilot-open` (link to `system/coopilot-open`), `~/.local/share/applications/Coopilot.desktop`, `~/.local/share/icons/hicolor/256x256/apps/coopilot.png`, one line appended to `~/.config/hypr/bindings.lua`, Exec line of `~/.config/autostart/coopilot.desktop`, `[edge]` appended to `~/.config/coopilot/config.toml`. Created on first open: `~/.local/share/coopilot/browser` and `$XDG_RUNTIME_DIR/coopilot/window-server-pid`.
- **Rollback:** `cp ~/.config/hypr/bindings.lua.bak-step55 ~/.config/hypr/bindings.lua && hyprctl reload`; `cp ~/.config/autostart/coopilot.desktop.bak-step5 ~/.config/autostart/coopilot.desktop`; `rm ~/.local/bin/coopilot-open ~/.local/share/applications/Coopilot.desktop ~/.local/share/icons/hicolor/256x256/apps/coopilot.png`; `rm -r ~/.local/share/coopilot/browser`; `cp ~/.config/coopilot/config.toml.bak-step55 ~/.config/coopilot/config.toml` (or delete the `[edge]` section).

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

- **Close out (D146):** end of day, about 3 minutes, any day up to today (key E). Picks with focused time against size; not done: carry over, move, make it up, drop. Resume notes per client worked. Open loops newest first, each closed in one step ("Mark as told…"). Commit Close out. Nothing blocks on an unreviewed day.
- **Loop rules (D147):** DevOps update (done pick, item still open; closes on a later fetch), slip heads-up (moved or dropped from a committed client block, template draft), blocker nudge (state or tag), flex session ended, and manual. Rules only, no AI, nothing posted.
- **Borrowed time (D150):** "I'll make it up" tonight, Friday or another day records minutes and payback; tonight or a weekend offers a local flex session. Paid when the pick is done or by hand. Week chip and Now strip.
- **Resume notes (D151):** latest per client wins, history kept; shown on the client's next block and in Plan the day.
- **Check-in (D152):** midday, about 1 minute (key M): each slot's time left after meetings, picks that no longer fit with the same actions, walk-on work.
- **Reminders (D153):** Close out near the end of the day, Check-in at the end of lunch, each once a day, offsets in Settings > Planning.
- **Contract change:** plan store migration 5 (D148); config `[plan] closeout_reminder_minutes`, `checkin_reminder_minutes`; DevOps `System.Tags` and a watched-by-id read (D149); actions `closeout.load`, `closeout.commit`, `pick.make_up`, `note.set`, `loop.add`, `borrow.pay`; `week.load` gains `resumeNotes`, `borrowed`, `closeOut`; `LoopView` gains who, kind, item, draft and close fields; `PlanDayState.resumeNotes`; `--clock` server flag (D154). All additive for existing callers.
- **Rollback:** revert the commit. Migration 5 only adds columns and tables; the pre-migration copy `plan.db.bak-v4-<stamp>` is next to the store. The two config keys are optional and can stay.

## 24. Step 8: Plan the week (authorized Oct 31)

- **Step 7 answers:** Q42 (D156), Q43 (D157), Q45 (D158), Q46 (D159).
- **Plan the week (D160):** tab and key W; next week by default (or the week a nudge asked for); any week; past weeks are a review.
- **Features and epics (D161, D162):** read-only, followed clients only; tiers from backlog levels; assigned to me or parent of my stories; state, target date (field detected per process), children with assignees, board order.
- **My share of time (D163):** blocks per feature or drop on blocks; fit per client after PTO, meetings, unavailable time and unpaid borrowed time: fits, tight, over. No sizing or forecasting.
- **Readiness (D164):** Block needs work, Needs breakdown, Needs features, No target date, one action each.
- **Coop brief (D165):** markdown from DevOps fields only, copied.
- **Commit the week (D166):** local, editable, re-committable; week cards and Plan the day show committed features first.
- **Summary strip:** open loops, unpaid borrowed time, PTO days, flex sessions.
- **Nudges (D167):** Thursday, Friday, Monday, each once, configurable; tab badge until committed.
- **Contract change:** `System.ChangedBy` read (`changedByMe`, `assignedTo`, `targetDate` on items); a portfolio read and an on-demand description read; committed features read by id in `week.load`'s DevOps read; plan store migration 6; config `[plan] week_nudge_thu`, `week_nudge_fri`, `week_nudge_mon`; actions `weekplan.load`, `weekplan.set_feature`, `weekplan.place`, `weekplan.commit`, `feature.brief`, `feature.mark_breakdown`, `loop.ask_priorities`; `week.load` gains `weekPlan`, `weekFeatures`, `weekNudge`; `PlanDayState.weekFeatures`; `ClientWork.committed`; loop kind `priorities`. All additive for existing callers. Nothing is written to DevOps, Outlook, Google or Dataverse.
- **Rollback:** revert the commit. Migration 6 only adds tables; the pre-migration copy `plan.db.bak-v5-<stamp>` is next to the store. The three config keys are optional and can stay.

## 25. Step 9: Quick capture (authorized Nov 1)

- **Step 8 answers (D169):** Q47 per-client error with no story level; Q48 borrowed time by payback week; Q49 epics above followed up; Q50 skipped nudge fires at next working time; Q51 current DevOps titles.
- **Quick capture (D170):** one box, Enter saves locally at once, works offline. N, the top-bar Capture button, the command menu, `coopilot-open --capture`.
- **Client tag (D171):** @nickname with autocomplete from followed clients, or a client select.
- **Routing (D172):** rules, no AI: promise → loop (who, what, due), work → draft story (optionally under a feature), else note. One click to confirm or change.
- **Inbox (D175):** the Capture view; "N unprocessed captures" in Close out; "Captures to sort" in Plan the week readiness; drafts under features in Plan the week.
- **Notes (D175):** per client, searchable, deletable, in the export.
- **Contract change:** plan store migration 7 (captures, notes, nullable draft parent; D173); actions `capture.add`, `capture.load`, `capture.features`, `capture.route`, `note.delete` (D174); `POST /api/open-request` and `coopilot-open --capture` (D176); loop kind `capture`; `week.load`, `closeout.load` and `weekplan.load` return the unsorted count; `weekplan.load` returns local drafts. Still no writes to any external system.
- **Not done:** the global Hyprland key (D178, needs confirmation).
- **Rollback:** revert the commit. Migration 7 adds tables and rebuilds `draft_stories` with the same rows; the pre-migration copy `plan.db.bak-v6-<stamp>` is next to the store.

## 26. Step 10: simpler, week → day → focus, focus mode and sounds (authorized Nov 1)

- **Navigation (D179 to D182):** Today is the default view; the top bar is Today · Week · Plan · Inbox plus Capture, Commands, Settings and the timer. Plan opens the ritual for the moment, with a switcher. Inbox merges loops and unsorted captures. Every earlier key and command still works.
- **Quieter UI (D183, D184):** one status per card, details behind a click, a one-line status bar when all is well, plain words.
- **Week → day (D185 to D187):** Plan the week grid on top with a filtering click and Place target, chips and search, readiness folded. Plan the day one block at a time, committed features first, "Break down #id" and Copy Coop brief. "This week: #id" on cards and Today. A first-run hint.
- **Focus mode (D188):** a calm focus screen; the top-bar timer on every view; Start focus from Today, a pick and the Now strip.
- **Focus sounds (D189 to D191):** Web Audio sounds, Settings > Focus, saved playlists, playerctl pause and resume when installed.
- **Global capture key (D192):** Super + Alt + N.
- **Contract change:** optional `[focus]` table; `week.load` and `settings.load` return `focus` (and `week.load` returns `media`); `timer.start` takes `playlist`; new actions `media.status` and `playlist.open`; settings section `focus`. No store migration. Still no writes to any external system.
- **Rollback:** revert the step 10 commits, rebuild and restart the service; remove `[focus]` from config.toml if it was saved; remove the Super + Alt + N lines from bindings.lua or restore `bindings.lua.bak-step10`.

## 27. Step 11: Plan the week by client, flexible musts, DevOps first (authorized Nov 1)

Principles: **DevOps first** (if it isn't in DevOps, it isn't planned yet; the healthy path is the easy path, without policing; re-planning never feels like failure) and **nothing machine-specific in core modules** (D194).

- **Week list per client (D195, D196):** each followed client (Cooptimize included) has a week list of DevOps features and stories, in stack rank order, split into Must and Nice to have. Local reorder only, with "Back to DevOps order". Fit counts musts against the client's free blocks: Fits, Tight, Too much (D199).
- **Pins (D198):** optional, for dependencies. The block grid stays on top and shows pins and each client's musts left.
- **Flexible (D197):** move, swap, demote or take off in one click, no reason. Dropping a must the week was committed with offers a heads-up loop and nothing else. Progress is against the current list.
- **Check-in:** "Anything shifted?" lists each client's open musts and nice to haves with one-click swaps and the on-track question.
- **Plan the day (D202):** musts first, then nice to haves, then the rest; pinned items first on their day; "Break down #id" for a must with no stories.
- **Tracking (D200, D201):** "CSC: 2 of 4 musts done" from DevOps state, local done marks and done picks, in Today, the Week strip, Plan the day and Plan the week; midweek "Still realistic?" question.
- **DevOps health (D203):** top of Plan the week, folded to a count, one action each.
- **Contract change:** store migration 8 (backup first); `WeekFeature` gains `level`, `tier`, `position` (nullable) and `doneAt`, and `blocks` may be a half; new actions (D204); `weekplan.place` pins without raising blocks; `draft.add_story` takes `parentItemId: null`; `week.load` reads list items by id; Plan the day's `weekFeatures` carry the list fields. Still no writes to any external system.
- **Rollback:** stop the service, restore `plan.db.bak-v7-<stamp>` over `plan.db` (and remove `plan.db-wal`, `plan.db-shm`), check out the commit before step 11, rebuild and start the service.

