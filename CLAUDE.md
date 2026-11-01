# Coopilot

Local, visual week-planning and focus app for Tanner on Omarchy. A week grid of half-day focus blocks with meetings and personal events layered on, risk flags, and (later) a conversation panel that calls the same actions as the UI.

Read before changing code: this file, `docs/spec.md` (current slice), `docs/decisions.md`.

## Current milestone

Milestones 1–2: read model + week view, plus step 4 (read-only DevOps work items assigned to me inside focus blocks), step 4.5 (responsive layout: wide, medium, narrow) and step 5 (morning planning, now "Plan the day": local plan store, picks, commit, checklist, reminder, autostart) and step 5.5 (Omarchy app launcher and key, work item links in the client's Edge profile, card polish, Loop recorded but not built) and step 6 (top bar views, item and command menus from the action registry, the ignition → Plan the day rename, planning the next workday, PTO from Dataverse, Outlook show-as styling and free-time summary), and step 6.1 (UX review fixes on a token foundation: Plan the day styling, three token layers, AA contrast, status bar by root cause, Tab scope, F6 and O, keyboard legend, plan fit on committed cards), and Plan any day (any date, day header menu, ← →, date picker, past days settle-only, one carry-over day), and step 6b (themes, time model with evening slot, unavailable time and flex sessions, Settings, Now strip, /styleguide), and step 6c (live verification of 6b, Settings > Planning sizes, carry-over, reminder and timer defaults, Reset local plan, draft picks in the Now strip, flex overlap, focus timer, basic Loops list), and step 6d (focused time on picks and days, calendar refresh for timer warnings, DevOps and Open half-days only for clients followed by focus time, Keep following), and step 7 (Check-in and Close out built around closing loops: loop rules, resume notes, borrowed time, walk-on work, two reminders), and step 8 (Plan the week: features and epics from DevOps, blocks per feature with a fit check, readiness ladder, Coop brief, week commit shown in the week and Plan the day, nudges), all authorized Oct 31, and step 9 (Quick capture: one box saved locally, @client tags, rule-based routing to a loop, draft story or note, inbox in Capture, Close out and Plan the week, notes, `coopilot-open --capture`), authorized Nov 1. Only the work in `docs/spec.md` and the authorized steps is authorized. Ask before expanding scope, adding a source, or adding a dependency not listed there.

## Hard rules

- All external systems are read-only. No writes to Dataverse, Outlook, Google, DevOps, Teams. The plan (picks, drafts, done ticks) lives only in the local plan store.
- Secrets live only in the OS keyring (service `coopilot`). Access tokens in memory only. Never log, cache, export or print tokens, secrets, Authorization headers or raw HTTP bodies.
- DevOps PATs: read from Dataverse only at DevOps fetch time (`devopsTargets`), wrapped in `Pat` (prints as `[PAT]`), used only for the Authorization header to `https://dev.azure.com/<org>/`. Never logged, cached, returned to the UI or exported. No other PAT access.
- Core views work with no AI provider. AI never executes anything; it only suggests via allowlisted actions.
- Localhost server (if any): bind 127.0.0.1, check Host and Origin, per-launch token.
- Do not touch Hyprland, Omarchy, browser profiles, Remmina or existing keyring entries.
- Client data stays scoped to its client in views and drafts.

## Architecture map

```
ui/        week grid, top bar, Plan the day, menus (menu.ts builders, Menus.tsx popup and command menu), source status (status.ts: causes and actions), keys.ts (F6, O, legend), styles.css tokens (primitives, semantic, domain) and themes, Settings.tsx, NowStrip.tsx (with the timer box and borrowed time), Loops.tsx (LoopRow, AddLoop), CloseOut.tsx, CheckIn.tsx, PlanWeek.tsx (Plan the week), PickReview.tsx (focused vs size, slip actions, flex offer), Capture.tsx (Quick capture dialog, sort choices, Capture view), StyleGuide.tsx (/styleguide)
actions/   named, validated actions; registry.ts is the one list (dispatcher, command menu, future chat); follow.ts (which clients are followed), warnings.ts (calendar refresh while a timer runs), loop-rules.ts (applies plan/loops.ts to the store), closeout-actions.ts (Close out, make up, notes, loops, borrowed), weekplan-actions.ts (Plan the week, brief, priorities loop), capture-actions.ts (capture, route, notes)
week/      pure: normalize, slots, risk rules, PTO days (pto.ts), free time (free.ts), followed clients (follow.ts) (no I/O, no tokens)
plan/      pure: plan types, capacity, fit, carry-over, block client, story level, planning target (target.ts), day rule, stepping and carry-over day (days.ts), Now strip (now.ts), focus timer rules and warnings (timer.ts), focused time (focus.ts), loop rules (loops.ts), borrowed time and payback (borrow.ts), Check-in fit (checkin.ts), week plan fit, readiness, brief and nudges (weekplan.ts), capture tags, due dates and routing (capture.ts)
store/     SQLite plan store (~/.local/share/coopilot/plan.db), migrations, export
sources/   dataverse (focus time, PTO) | graph | google | devops adapters; oauth/ (PKCE loopback), calendar/ (shared fetch, cache, status), devops/ (per-client work items, Pat)
secrets/   keyring access only
config/    ~/.config/coopilot/config.toml, validated; text edits that keep comments, backups (edit.ts), Settings sections (settings.ts)
cache/     ~/.cache/coopilot, last good snapshot per source
server/    127.0.0.1 host: launch token, Host/Origin guard, /api/action, UI; reminders: plan the day, Check-in, Close out (notify.ts) and focus timer tick (timer.ts); open-request.ts (one-shot "open into capture")
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
| Plan the day | The planning panel: a day's capacity (by default today, or the next workday; any plannable date) into committed picks per block. A past day opens as a review: done and drop only. Formerly "ignition"; `i` stays as an alias key |
| Check-in | Midday view (M): today's picks, time left per slot after meetings, what no longer fits, walk-on work |
| Close out | End-of-day view (E), any day up to today: picks done or not, resume notes, open loops, then commit |
| Resume note | One line per client, "where I left off / next step"; the latest wins, shown on the client's next block and in Plan the day |
| Plan the week | The weekly view (W): commit features per client to a week by blocks or by placing them on blocks, with a fit check, readiness ladder and Coop briefs. Next week by default; past weeks are a review |
| Feature tier | The lowest portfolio backlog level of a project's process (what a week commits to); levels above it are the epic tier. From backlog levels, never type names |
| Week plan | The local record of a week's committed features (blocks, placements, committed at); editable and re-committable |
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
| Capture | One line saved at once to the local store (N, the Capture button, Ctrl+K, `coopilot-open --capture`), then sorted into a loop, a draft story or a note by one-click rule suggestions |
| Inbox | Captures not yet sorted; listed in the Capture view, counted in Close out and Plan the week |
| Note | A personal note, optionally tagged to a client; searchable in Capture, in the export |
| Focus timer | A countdown for focus or a break, plain or timeboxing a pick; server-side, so it survives closing the window. Focus time on a pick is recorded for Close out (D138 to D140) |

## Working style

- Small end-to-end steps. Define behavior first; failing test where it matters (normalization, risk rules, secret handling, failure isolation, persistence); implement; refactor.
- No tests for trivial styling or that mirror implementation.
- Type-check before calling a step done. Inspect the real UI (screenshot) for UI changes.
- Verify current official docs before version-specific integration code.
- Record decisions in `docs/decisions.md` and open questions in `docs/open-questions.md` as they come up.
- Plain language in UI copy. No em dashes.

## Completion report per increment

Delivered behavior, changed files, verification results, checks not possible, limitations, setup and rollback steps, proposed next increment.
