# 11. Decisions and roadmap

The full log is [docs/decisions.md](../../docs/decisions.md) (D19 to D357 as of this branch; D01 to D20 live in a discovery brief outside the repo). Open questions are in [docs/open-questions.md](../../docs/open-questions.md); direction is in [docs/roadmap.md](../../docs/roadmap.md).

## Key decisions

Grouped by theme. IDs link to the log; search the file for the ID.

### Platform

| ID | Decision |
|---|---|
| D22 | Local TypeScript app opened as a Chromium app window, with a host layer thin enough to move to Tauri later |
| D48 | Sign-in is authorization code with PKCE through a one-shot loopback listener, written on built-in `fetch`, `crypto` and `http`; no MSAL or Google library |
| D71 | Plan store is SQLite via built-in `node:sqlite`, numbered migrations, newer schemas refused |
| D79 | Always on through a systemd user service and an XDG autostart entry; no Hyprland edits for the service (the key bindings came later, step 5.5) |
| D101 | One action registry: dispatcher, command menu and future chat share it |
| D125 | Full copy of the plan store before any migration |

### Data sources and identity

| ID | Decision |
|---|---|
| D21, D25 | Dataverse through a read-only application user with a custom role; Outlook delegated `Calendars.ReadBasic`; Google `calendar.events.readonly` |
| D26 to D30 | Mon to Thu workweek, Friday overflow; Focus Time rows are weekly patterns; unassigned half-days are Open; half-days are soft; standing Internal block from config |
| D59, D60 | DevOps shows open items assigned to me; the company PAT is read only at fetch time, only by one query, wrapped in `Pat` |
| D105 | Every PTO day is a whole day off |
| D144 | DevOps follows focus time: only followed clients are fetched |
| D305, D306 | One Microsoft sign-in is the app's user; the ID token is read for display, not stored |

### Writes

| ID | Decision |
|---|---|
| D210, D211 | Outlook write access is optional and separate; Coopilot's events have fixed fields and a marker |
| D218, D219 | Two-way sync of Coopilot events with a conflict choice; rebuild records from the marker |
| D236 | Recurring and all-day own events stay meeting tier; tentative counts as busy |
| D250, D258 | The named DevOps writes; `connectionData` is the only PAT identity check |
| D255 | One more read after a network error before a write is "Not confirmed" |
| D284 | RSVP is a write kind; never edits the meeting |
| D307, D308, D312, D316 | My VM by Owner tag; VM chip states; morning prompt; one-click Start from the morning box when allowed |

### Planning

| ID | Decision |
|---|---|
| D122 | The time model: hours per weekday, lunch as the AM/PM split, overrides |
| D136 | Reset local plan behind a typed confirmation and a backup |
| D272 | Demo mode with fictional sources and an in-memory store |
| D324 | Navigation: four tabs, a mode switch per tab, planning as a mode |
| D334 | Estimating in whole blocks and S/M/L, no fractions |
| D349, D350 | Plan ahead bar dates from DevOps first; week 1 is this week |

## Open questions that matter for a wider audience

From [docs/open-questions.md](../../docs/open-questions.md). Many are answered; these are still open and touch security, hosting or data:

| ID | Question |
|---|---|
| Q12 | Google app stays in Testing, so the sign-in lasts 7 days. Publish with a homepage and privacy policy? |
| Q16 | Secure the DevOps token column in Dataverse so only the Coopilot app user can read it |
| Q17 | Global PATs retire December 1, 2026; recreate client PATs as organization-scoped |
| Q18, Q41 | Some client processes put Blocked states in the Removed category, so blocked items are hidden |
| Q63 | `actions/` imports the Edge launch-argument builder; move it behind a host adapter before hosting |
| Q89 | A hosted Coopilot should read Dataverse delegated per user instead of app-only |

## What is next

Only what the repo says; nothing invented here.

- **Step 17.5, brand integration**, is being built in the main checkout while these docs were written. The brand assets and brief are on this branch ([assets/brand/](../../assets/brand/), [docs/design/brand-brief.md](../../docs/design/brand-brief.md)).
- **Later, from [docs/roadmap.md](../../docs/roadmap.md#after-step-11-agreed-nov-1):** schedule a meeting for an item; a chat panel on the same actions as the command menu; browser access from machines that can't run Moonlight.
- **Backlog (not built):** a registered internal Teams delivery thread per client, with preview-and-confirm posting; never to external client threads ([docs/roadmap.md](../../docs/roadmap.md#queued-features)). Calibrate S/M/L sizes from recorded focus time.
- **Direction, needs buy-in:** an Azure-hosted web app for any Cooptimizer, with per-user Entra sign-in, Key Vault for secrets, a per-user database and normal link opening. Cost and secure design are to be explored separately before any resources are created ([docs/roadmap.md](../../docs/roadmap.md#direction-hosted-for-other-cooptimizers-later-needs-buy-in)).
- **North star:** AI that interprets Teams, email and DevOps activity to propose follow-ups and summaries, in stages; stage A (rules, no AI) and part of B (DevOps signals close follow-ups) are built. Before stages B and C: which communications are reachable, AI provider data terms, noise, cost and retention ([docs/roadmap.md](../../docs/roadmap.md#north-star-synthesized-intelligence)).
- Dropped (Nov 2): Remmina launch and resume.
