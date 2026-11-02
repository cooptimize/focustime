# Coopilot technical documentation

Coopilot is a local week-planning and focus app. It runs on one person's Linux desktop (Omarchy) as a small Node server bound to `127.0.0.1` with a React UI in a Chromium app window. It shows the week as a grid of half-day **focus blocks** from Dataverse, puts Outlook meetings and personal Google events on top, flags blocks that are at risk, and helps plan which DevOps work goes into each block. It writes to outside systems only through a small set of named, previewed, logged and undoable actions. Source: [CLAUDE.md](../../CLAUDE.md), [server/main.ts](../../server/main.ts).

## Who this is for

Cooptimize colleagues with a data or Azure background who have not seen the code. The pages explain what the code does today, with links to the files that prove each claim. Where the docs and the code disagree, the code wins and the gap is listed in [90-doc-gaps.md](90-doc-gaps.md).

## How to read these docs

| If you want to know... | Read |
|---|---|
| What it does for the user, day to day | [01-product.md](01-product.md) |
| How the pieces fit | [02-architecture.md](02-architecture.md) |
| What it reads and writes in Dataverse, Graph, Google, DevOps and Azure | [03-sources-and-auth.md](03-sources-and-auth.md) |
| What is stored on disk, and for how long | [04-data-and-persistence.md](04-data-and-persistence.md) |
| How half-days, budgets, sizes and risks are calculated | [05-planning-model.md](05-planning-model.md) |
| How outside writes are kept safe | [06-write-framework.md](06-write-framework.md) |
| Security, privacy and the threat model | [07-security-and-privacy.md](07-security-and-privacy.md) |
| Screens, keys and theming | [08-ui.md](08-ui.md) |
| Install, service, logs, demo mode, troubleshooting | [09-operations.md](09-operations.md) |
| Tests | [10-testing.md](10-testing.md) |
| Decisions, open questions and what is next | [11-decisions-and-roadmap.md](11-decisions-and-roadmap.md) |
| Short answers for the demo | [12-demo-faq.md](12-demo-faq.md) |
| Known gaps in these docs | [90-doc-gaps.md](90-doc-gaps.md) |

Conventions:

- Links point into the repository, relative to this folder (for example [week/risks.ts](../../week/risks.ts)).
- "Not verified" means I could not confirm the claim from code alone.
- Placeholders such as `<tenant-id>` or `<client-devops-org>` stand in for real identifiers. No real IDs, addresses or work item text appear here.
- Screenshots come from demo mode (fictional data) in [docs/demo/](../demo/).

## Glossary

These are the terms from [CLAUDE.md](../../CLAUDE.md#glossary-use-these-words-in-code-ui-and-chat), used the same way throughout. The full list there has more.

| Term | Meaning |
|---|---|
| Coopilot | This app |
| Coop | Cooptimize's coding agent inside client Azure VMs. Not this app |
| Client | A customer context; "Internal" is treated as a client |
| Focus block | A half-day scheduled for a client or Internal, from Dataverse |
| Half-day / slot | AM or PM of a date; boundaries come from config |
| Block | One half-day of client focus time; the unit for features and budgets, always a whole number |
| Source | Dataverse, Outlook or Google; each reports its own status |
| Plan layer | Coopilot's local plan: day plans and picks in the plan store |
| Pattern | A Focus Time row: recurring weekly AM/PM/All Day per weekday between start and (optional) end date |
| Open | A Mon–Thu half-day with no focus block; free for client or internal work |
| Standing block | A focus block defined in Coopilot config, e.g. Monday AM Internal |
| Overflow day | Friday: not scheduled, available for catch-up |
| Day shape | Soft start/split/end times used only to place events into AM or PM and estimate capacity |
| At-risk block | Focus block threatened by meetings or personal events, with a stated reason |
| Followed client | A client with Focus Time ongoing, ending today or later, or ended within the grace days; Cooptimize, standing-block and "Keep following" clients always. Only these get DevOps fetches and Open half-day choices |
| PTO | Time off from Dataverse Time Off Tracker rows (mine only). Every PTO day is a whole day off |
| Pick | One planned piece of work in a block: a DevOps item, a draft story or an intention, sized S/M/L |
| Story size | S (about an hour), M (a couple of hours), L (about a whole block) |
| Budget | A client's whole blocks in a week: its half-days minus PTO, minus half-days that are mostly meetings (under 2 hours free), minus borrowed time |
| Must / Nice to have | A week list item that should be completed this week (counts against the budget) / worked on if there's room (doesn't) |
| Envelope | A feature on the week list with its stories nested under it: they fill its blocks, never add to the total |
| Follow-up | Something I owe someone: client, who (optional), what, channel, optional due date; open until closed. Formerly "Loop" |
| Capture | One line saved at once to the local store, the one way to add something new |
| Timebox | A stretch of a day's timeline for a client and a pick or item (start, end). Local; optional Put on Outlook |
| Write framework | The only path for external writes: named action, preview, confirm, read back, audit log, undo |
| Audit log | Settings > Data: every external write with where, when, result and prior values, with Undo and Retry |
| Marker | The extended property (CoopilotId) on every Coopilot-created Outlook event; Coopilot refuses to change events without it |
| Calendar editing rule | Coopilot only edits what it created or what only I can see |
| Sign-in | One Microsoft sign-in on the Coopilot Desktop registration: the app's user, Outlook calendars and Azure from one consent, scopes added as needed |
| My VM | The one Azure VM I confirmed (found by its Owner tag or entered by resource ID); the only VM Coopilot reads or changes |
| DevOps first | Principle #1: if it isn't in DevOps, it isn't planned yet |
| Tab | One of four places in the top bar: Today · Week · Roadmap · Inbox (1–4) |
| Mode switch | At the right of each page header: Today: Now · Plan · Check-in · Close out; Week: Week · Plan the week; Roadmap: Roadmap · Plan ahead |

Coopilot and Coop are different things. Coopilot is this planner on a person's desktop. Coop is the coding agent that works inside client VMs. Coopilot's only link to Coop is the "Coop brief": copyable Markdown about one feature that a person can paste to Coop ([actions/registry.ts](../../actions/registry.ts), action `feature.brief`).
