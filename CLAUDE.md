# Coopilot

Local, visual week-planning and focus app for Tanner on Omarchy. A week grid of half-day focus blocks with meetings and personal events layered on, risk flags, and (later) a conversation panel that calls the same actions as the UI.

Read before changing code: this file, `docs/spec.md` (current slice), `docs/decisions.md`.

## Current milestone

Milestones 1–2: read model + week view, plus step 4 (read-only DevOps work items assigned to me inside focus blocks), step 4.5 (responsive layout: wide, medium, narrow) and step 5 (morning planning, now "Plan the day": local plan store, picks, commit, checklist, reminder, autostart) and step 5.5 (Omarchy app launcher and key, work item links in the client's Edge profile, card polish, Loop recorded but not built) and step 6 (top bar views, item and command menus from the action registry, the ignition → Plan the day rename, planning the next workday, PTO from Dataverse, Outlook show-as styling and free-time summary), and step 6.1 (UX review fixes on a token foundation: Plan the day styling, three token layers, AA contrast, status bar by root cause, Tab scope, F6 and O, keyboard legend, plan fit on committed cards), and Plan any day (any date, day header menu, ← →, date picker, past days settle-only, one carry-over day), and step 6b (themes, time model with evening slot, unavailable time and flex sessions, Settings, Now strip, /styleguide), and step 6c (live verification of 6b, Settings > Planning sizes, carry-over, reminder and timer defaults, Reset local plan, draft picks in the Now strip, flex overlap, focus timer, basic Loops list), and step 6d (focused time on picks and days, calendar refresh for timer warnings, DevOps and Open half-days only for clients followed by focus time, Keep following), and step 7 (Check-in and Close out built around closing loops: loop rules, resume notes, borrowed time, walk-on work, two reminders), and step 8 (Plan the week: features and epics from DevOps, blocks per feature with a fit check, readiness ladder, Coop brief, week commit shown in the week and Plan the day, nudges), all authorized Oct 31, and step 9 (Quick capture: one box saved locally, @client tags, rule-based routing to a loop, draft story or note, inbox in Capture, Close out and Plan the week, notes, `coopilot-open --capture`), authorized Nov 1, and step 10 (simpler experience: Today as home, top bar Today · Week · Plan · Inbox, one Plan button for the ritual of the moment, quieter cards and status bar, plain wording, week → day → focus flow, focus screen, focus sounds and playlists, Super + Alt + N capture key), authorized Nov 1, and step 11 (Plan the week by client: Must and Nice to have lists per client from DevOps in stack rank order, optional pins, one-click re-planning with a heads-up offer, "Anything shifted?" in Check-in, musts progress and the on-track question, DevOps health), authorized Nov 1, and step 12 (write framework: named external writes with preview, confirm, read back, audit log and undo, marker-owned Outlook events only, idempotent retry, optional write access; timeboxing: drag onto the day strip, Timebox…, fit and focus timer from timeboxes, per-timebox Put on Outlook), authorized Nov 1. Only the work in `docs/spec.md` and the authorized steps is authorized. Ask before expanding scope, adding a source, or adding a dependency not listed there.

## Principles

- **#1 DevOps first.** We plan, track and show work in DevOps; if it isn't in DevOps, it isn't planned yet. Coopilot makes the healthy path the easy path, without policing, and re-planning never feels like failure.
- **Nothing machine-specific in core modules** (`week/`, `plan/`, `actions/`, `sources/`). OS integrations (keyring, Edge/Chromium launch, notify-send, playerctl, Hyprland) stay behind thin host adapters, so a hosted version stays possible later.

## Hard rules

- All external systems are read-only, except Outlook events Coopilot created (step 12), written only through the write framework (`actions/timebox-actions.ts`: preview, confirm, read back, audit log, undo; marker required). No writes to Dataverse, Google, DevOps, Teams. The plan (picks, drafts, done ticks) lives only in the local plan store.
- Secrets live only in the OS keyring (service `coopilot`). Access tokens in memory only. Never log, cache, export or print tokens, secrets, Authorization headers or raw HTTP bodies.
- DevOps PATs: read from Dataverse only at DevOps fetch time (`devopsTargets`), wrapped in `Pat` (prints as `[PAT]`), used only for the Authorization header to `https://dev.azure.com/<org>/`. Never logged, cached, returned to the UI or exported. No other PAT access.
- Core views work with no AI provider. AI never executes anything; it only suggests via allowlisted actions.
- Localhost server (if any): bind 127.0.0.1, check Host and Origin, per-launch token.
- Do not touch Hyprland, Omarchy, browser profiles, Remmina or existing keyring entries.
- Client data stays scoped to its client in views and drafts.

## Architecture map

```
ui/        week grid, top bar, Plan the day, menus (menu.ts builders, Menus.tsx popup and command menu), source status (status.ts: causes and actions), keys.ts (F6, O, legend), styles.css tokens (primitives, semantic, domain) and themes, Settings.tsx, NowStrip.tsx (Now strip with Start focus and borrowed time, TopTimer), Loops.tsx (LoopRow, AddLoop), CloseOut.tsx, CheckIn.tsx, PlanWeek.tsx (Plan the week), PickReview.tsx (focused vs size, slip actions, flex offer), Capture.tsx (Quick capture dialog, sort choices, notes section), StyleGuide.tsx (/styleguide), Today.tsx (home: now, urgent, Start focus, today's blocks, first-run hint), Inbox.tsx (loops and captures in one list), FocusScreen.tsx (focus screen and SoundControl), sound.ts (Web Audio engine), WeekMusts.tsx (musts per client, Anything shifted?), Timeboxes.tsx (day strip, Timebox… dialog, write preview dialog and flow, timeboxes on week cards)
actions/   named, validated actions; registry.ts is the one list (dispatcher, command menu, future chat); follow.ts (which clients are followed), warnings.ts (calendar refresh while a timer runs), loop-rules.ts (applies plan/loops.ts to the store), closeout-actions.ts (Close out, make up, notes, loops, borrowed), weekplan-actions.ts (Plan the week, brief, priorities loop), capture-actions.ts (capture, route, notes), timebox-actions.ts (timeboxes and the write framework: preview, confirm, retry, log, undo)
week/      pure: normalize, slots, risk rules, PTO days (pto.ts), free time (free.ts), followed clients (follow.ts) (no I/O, no tokens)
plan/      pure: plan types, capacity, fit, carry-over, block client, story level, planning target (target.ts), day rule, stepping and carry-over day (days.ts), Now strip (now.ts), focus timer rules and warnings (timer.ts), focused time (focus.ts), loop rules (loops.ts), borrowed time and payback (borrow.ts), Check-in fit (checkin.ts), week plan fit, readiness, brief and nudges (weekplan.ts), capture tags, due dates and routing (capture.ts), which ritual Plan opens (ritual.ts), Today's focus pick and urgent loops (today.ts), one card status (blockstatus.ts), focus sound, media and playlist rules (focussound.ts), week list order, done, progress, on-track and heads-up (weeklist.ts), timeboxes: validation, Outlook fields, sync need, own-event de-dup, capacity, undo (timebox.ts)
store/     SQLite plan store (~/.local/share/coopilot/plan.db), migrations, export
sources/   dataverse (focus time, PTO) | graph (write.ts: marker-checked Outlook writer) | google | devops adapters; oauth/ (PKCE loopback), calendar/ (shared fetch, cache, status), devops/ (per-client work items, Pat)
secrets/   keyring access only
config/    ~/.config/coopilot/config.toml, validated; text edits that keep comments, backups (edit.ts), Settings sections (settings.ts)
cache/     ~/.cache/coopilot, last good snapshot per source
server/    127.0.0.1 host: launch token, Host/Origin guard, /api/action, UI; reminders: plan the day, Check-in, Close out (notify.ts) and focus timer tick (timer.ts); open-request.ts (one-shot "open into capture"), host.ts (browser detection and link command, Q63), media.ts (playerctl detection and commands, playlist opening; argument arrays only)
log/       structured logger with a closed set of fields (no headers or bodies)
fixtures/  sample data (tests, and calendars with no config section)
links/     pure: Edge install detection, profile list, link validation, launch arguments
system/    systemd user service, coopilot-open, launcher entry and icon, XDG autostart entry (installed copies in ~/.config and ~/.local)
```

Run: `coopilot-open` (starts the service if needed, then opens or focuses the window; also the launcher entry, Super + Alt + C and autostart), or `npm start` (build + server + Chromium app window) when the service is stopped, `npm run dev` (Vite in the server, no HMR), `npm test`, `npm run typecheck`, `npm run screenshot` (needs a running server).

## Glossary (use these words in code, UI and chat)

| Term | Meaning |
|---|---|
| Coopilot | This app |
| Coop | Cooptimize's coding agent inside client Azure VMs. Not this app |
| Client | A customer context; "Internal" is treated as a client |
| Focus block | A half-day scheduled for a client or Internal, from Dataverse |
| Half-day / slot | AM or PM of a date; boundaries come from config |
| Look-ahead | The week view |
| At-risk block | Focus block threatened by meetings or personal events, with a stated reason |
| Plan layer | Coopilot's local plan: day plans and picks in the plan store (step 5) |
| Today | The default view (1 or T): what's now and next, anything urgent (a loop due, a source down), one large Start focus, today's blocks with their committed features and picks |
| Plan (button) | The top-bar Plan (3) opens the ritual for the moment: Plan the day in the morning, Check-in midday, Close out near the end of the day, Plan the week while a week nudge is in effect; chips inside switch rituals |
| Plan the day | The planning panel: a day's capacity (by default today, or the next workday; any plannable date) into committed picks per block. A past day opens as a review: done and drop only. Formerly "ignition"; `i` stays as an alias key |
| Check-in | Midday view (M): today's picks, time left per slot after meetings, what no longer fits, walk-on work |
| Close out | End-of-day view (E), any day up to today: picks done or not, resume notes, open loops, then commit |
| Resume note | One line per client, "where I left off / next step"; the latest wins, shown on the client's next block and in Plan the day |
| Plan the week | The weekly view (W): each client's week list of DevOps features and stories, Must and Nice to have, in stack rank order (local reorder), optional pins, fit per client on musts, DevOps health and Coop briefs. Next week by default; past weeks are a review |
| Feature tier | The lowest portfolio backlog level of a project's process (what a week commits to); levels above it are the epic tier. From backlog levels, never type names |
| Week plan | The local record of a week's lists per client (items with tier, blocks, pins, local order and done marks, committed at); editable and re-committable |
| Coop brief | Copyable markdown for one feature, DevOps fields only, asking Coop to propose user stories |
| PTO | Time off from Dataverse Time Off Tracker rows (mine only). Every PTO day is a whole day off: no risks, no picks, skipped as a planning target. Hours are not used |
| Command menu | Ctrl+K: every action from the action registry with its shortcut; the base for the chat panel |
| Pick | One planned piece of work in a block: a DevOps item, a draft story or an intention, sized S/M/L |
| Source | Dataverse, Outlook or Google; each reports its own status |
| Pattern | A Focus Time row: recurring weekly AM/PM/All Day per weekday between start and (optional) end date |
| Open | A Mon–Thu half-day with no focus block; free for client or internal work (offered clients: those followed) |
| Followed client | A client with Focus Time ongoing, ending today or later, or ended within the grace days; Cooptimize, standing-block and "Keep following" clients always. Only these get DevOps fetches and Open half-day choices (D144) |
| Standing block | A focus block defined in Coopilot config, e.g. Monday AM Internal |
| Overflow day | Friday: not scheduled, available for catch-up |
| Day shape | Soft start/split/end times used only to place events into AM or PM and estimate capacity |
| Borrowed time | Slipped focus made up later (tonight, Friday, another day): pick, minutes, payback; paid when the pick is done or by hand (D150) |
| Loop | Something I owe someone (an update, an answer or a follow-through): who, what, channel, optional due date; open until closed. Opened by a rule or by hand, closed by a signal that proves it or by me. Recorded (D92). Rules (D147): DevOps update, slip heads-up, blocker nudge, flex session ended, manual. Closed by a signal or "Mark as told" |
| Capture | One line saved at once to the local store (N, the Capture button, Ctrl+K, `coopilot-open --capture`, Super + Alt + N from any app), then sorted into a loop, a draft story or a note by one-click rule suggestions |
| Inbox | The view (4 or L) that lists open loops and captures not yet sorted in one list, urgent loops first; unsorted captures are also counted in Close out and Plan the week |
| Note | A personal note, optionally tagged to a client; searchable in Capture, in the export |
| Focus screen | The calm view while focus runs: large countdown, the one pick, next meeting, Done / +15 / Stop, the sound control. Esc goes back to Today; the timer stays in the top bar |
| Focus sounds | Sounds made in the app (brown, pink, rain, binaural alpha and beta) that play only while focus runs, plus saved Spotify or YouTube playlists and optional music pause via playerctl ([focus], Settings > Focus) |
| Status (card) | The one status a block shows: At risk, Too much planned, Fits just or Fits |
| Focus timer | A countdown for focus or a break, plain or timeboxing a pick; server-side, so it survives closing the window. Focus time on a pick is recorded for Close out (D138 to D140) |
| Must | A week list item that should be completed this week and definitely touched. Counts against the client's fit. A target, not a contract: one click to move it |
| Nice to have | A week list item worked on if there's room. Doesn't count against fit |
| Pin | An optional tie from a week list item to a specific half-day (for dependencies). Unpinned items belong to the client's week |
| Timebox | A stretch of a day's timeline for a client and a pick or item (start, end). Local; counts as planned time; optional Put on Outlook |
| Write framework | The only path for external writes: named action, preview, confirm, read back, audit log, undo |
| Audit log | Settings > Data: every external write with where, when, result and prior values, with Undo and Retry |
| Marker | The extended property (CoopilotId) on every Coopilot-created Outlook event; Coopilot refuses to change events without it |
| DevOps first | Principle #1: if it isn't in DevOps, it isn't planned yet. Coopilot nudges toward DevOps (health check, draft stories) without policing |

## Working style

- Small end-to-end steps. Define behavior first; failing test where it matters (normalization, risk rules, secret handling, failure isolation, persistence); implement; refactor.
- No tests for trivial styling or that mirror implementation.
- Type-check before calling a step done. Inspect the real UI (screenshot) for UI changes.
- Verify current official docs before version-specific integration code.
- Record decisions in `docs/decisions.md` and open questions in `docs/open-questions.md` as they come up.
- Plain language in UI copy. No em dashes.

## Completion report per increment

Delivered behavior, changed files, verification results, checks not possible, limitations, setup and rollback steps, proposed next increment.
