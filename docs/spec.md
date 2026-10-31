# Coopilot | First Slice Spec v0.1 (Milestones 1 and 2)

October 31, 2026. Status: proposed, not authorized. Reads with Discovery Brief v0.3 and Build Plan v0.3.

## 0. Machine inventory (collected Oct 31, read-only)

| Item | Finding | Implication |
|---|---|---|
| OS / desktop | Omarchy 4.0.6, Hyprland 0.56.2 (Lua config), Quickshell 0.3.2 | Shell plugins possible later; not for main app |
| Hardware | 20 threads, 31 GB RAM, Intel UHD (Raptor Lake), 441 GB free | No resource constraints; Intel GPU avoids most WebKitGTK/NVIDIA issues |
| Display | One 3840x1080 ultrawide at 119 Hz, scale 1 | Design for wide and short: full week fits horizontally, keep vertical density tight |
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

- No plan layer, dragging, ignition, triage, recap, capture or drafts (Milestones 3 and 4).
- No AI provider calls. The whole slice works without AI.
- No DevOps reads and no PAT access. The Dataverse role must not be able to read PAT columns yet.
- No writes to Dataverse, Outlook, Google or anywhere else.
- No teammate focus blocks on screen (fetch only Tanner's rows).
- No Remmina, Azure VM, Teams or Coop integration.
- No Hyprland keybinding, autostart or shell plugin.

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
| DevOps PATs | Not accessed in this slice | Column security should block the role from reading them |

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
- Q1. ~~Dataverse schema~~ Resolved, see 0b. Only verification left: check `coop_systemuser` against real rows.
- Q1b. ~~Open vs Internal~~ Open.
- Q2. ~~Half-day hours~~ Soft day shape, see section 6.
- Q3. ~~Machine inventory~~ Done, see section 0.
- Q4. Agree to D21 auth approach.
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
- Q7. Should all-day or out-of-office Outlook events (holidays, OOO) raise a risk? The v1 rules only look at personal all-day events.
- Q8. Should personal events during an Open half-day or on Friday be flagged at all? Currently they are shown but never flagged.
- Q9. The kickoff folder and zip (`coopilot-kickoff/`, `coopilot-kickoff.zip`) are still in the repo folder and git-ignored. Their docs were copied to the repo root. Delete them when you're happy.

## 17. Decisions proposed this round

| ID | Status | Entry |
|---|---|---|
| D19 | Re-scoped | AI provider choice no longer blocks Milestones 1–2 |
| D21 | Proposed | Dataverse via app user with read-only custom role; Outlook via delegated `Calendars.ReadBasic`; Google via desktop OAuth `calendar.events.readonly` |
| D22 | Proposed | Stack option A for first slice, with a host layer thin enough to move to Tauri later |
| D23 | Proposed | Cache last good snapshot as files; SQLite arrives with the plan layer in Milestone 3 |
| D24 | Deferred by Tanner | PAT column security not a priority now (tokens are read-only). Coopilot still never requests the PAT column in Milestones 1–5. Revisit before Milestone 6 (DevOps reads) |
| D22 | Accepted | Stack option A (local TypeScript app in a Chromium app window) |
| D28 | Confirmed | Unassigned Mon–Thu half-days display as "Open" (client or internal) |
| D30 | Proposed | Monday AM is a standing Internal block from Coopilot config; Dataverse client blocks take precedence and raise a double-booked flag |
| D29 | Confirmed | Half-days are soft commitment units; day shape in config is for placement and capacity only |
| D26 | Confirmed | Workweek is Mon–Thu; Friday is an optional overflow/catch-up day shown separately |
| D27 | Confirmed | Focus Time rows are recurring weekly patterns expanded per week |
| D25 | In place, amending | Application user "Coopilot Dataverse Reader" with role Coopilot Reader: Read (Org) on Focus Time, Account, User; adding Account Worker. Token, connect and read verified Oct 31 |
| D31 | Done | Application user moved to its own business unit with no team roles; Contacts refused, only Coopilot Reader access (verified Oct 31) |
