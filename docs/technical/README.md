# FocusTime technical docs

For every Cooptimizer who wants to know how FocusTime works under the hood: engineers changing it, IT reviewing it, and anyone curious. Checked against `2f4c0ea` on Nov 13, 2026.

These pages describe FocusTime as it is on `main` on that day, written from the code, the Bicep, the scripts and the workflows. Where a page says **Not verified**, the fact couldn't be confirmed from those and needs a person to check it.

## What FocusTime is

FocusTime is Cooptimize's hosted web app for planning focus work. It shows each person's week as half-day focus blocks per client (from Dataverse), lays their meetings and personal events over the blocks (from Outlook, Google Calendar and calendars added by link), and says which blocks are at risk. People place DevOps work and their own to-dos on the blocks, time them, and tick them off.

Around that sit a focus timer, promises (what a person owes someone), an Inbox of suggestions from registered client chats, promises and captures, a client status report, Code (any client's repos, read only), an assistant in the app and as a Teams bot, and a few careful writes back to Outlook, Teams, DevOps and the person's own Azure VM.

It runs in Azure (Container Apps, Azure SQL, Key Vault) in two environments, dev and prod. People sign in with their Cooptimize Microsoft account. What they plan lives in FocusTime's own database; the outside systems stay the source of truth for their own data.

## The screens

| Screen | Where | What it is |
|---|---|---|
| Day | The first tab (1 or T), `#/day` | One date's blocks as cards, the urgent strip, a line of chips and the moment card |
| Week | The second tab (2), `#/week` | The week's blocks, Monday to Thursday, Friday as the catch-up day, and Saturday or Sunday when they have work |
| Backlog | The third tab (3), `#/backlog` | Every client's DevOps items as a Grid or a Gantt, edited through a change set |
| Status | The fourth tab (4), `#/status` | My features' updates for Monday's status report, and each client's whole report |
| Inbox | The fifth tab (5 or L), `#/inbox` | Three lists: From chats, Promises, Captures |
| Block panel | Beside Week and Day | One block: what's on it, its meetings, and one Add box |
| Story card | Over any screen, `#/item/<client>/<id>` | A DevOps item as FocusTime shows it, with Edit and Wrap it up |
| Code | More › Code, `#/code` | Any client's repos, read only |
| Settings and Admin | More › Settings, More › Admin | A person's preferences; the team's values (admins only) |
| The Guide and these docs | More › Guide, More › Technical docs | How to use FocusTime; how it works |

On the phone the bottom bar holds Day, Week, Capture, Inbox and Ask; Backlog, Status and the rest are under More.

## The pages

| Page | For | What it answers |
|---|---|---|
| [Architecture](architecture.md) | Engineers | The parts, the module map, the screens and where they live, how a request and an external write flow |
| [Data](data.md) | Engineers, IT | Every table by area, what is kept how long, what is never stored, who sees what |
| [Integrations](integrations.md) | Engineers, IT | Each outside system: sign-in, permissions, what is read and written, timeouts, what people see when it fails |
| [Security](security.md) | IT first, then engineers | Secrets, tokens, client boundaries, client code, admins, AI, external writes, test sites, the VM |
| [Operations](operations.md) | Whoever runs it | Environments, configuration, deploys, what runs on its own, reminders, logs, troubleshooting |
| [Development](development.md) | Engineers | Local setup, tests and CI, the dependencies, adding a write or a Graph permission safely |

[The Coop comment contract](coop-contract.md) sits beside these pages in the repo: a format FocusTime and Coop agreed on, not built yet.

## Words

The product's words (to-do, block, promise, Inbox and the rest) are in the glossary in [CLAUDE.md](../../CLAUDE.md#glossary-use-these-words-in-code-ui-and-chat), with its Renamed list of older names. The technical words used on these pages:

| Term | Meaning |
|---|---|
| Host | Everything FocusTime needs from the machine it runs on, behind one interface (`host/types.ts`): `host/azure` in the hosted app, `host/local` for the developer loop |
| Developer loop | Running FocusTime on one developer's machine (`host/local`, `system/`); not part of the product |
| Plan store | FocusTime's database: Azure SQL in dev and prod, a SQL Server container in the developer loop, SQLite only for the demo and tests |
| User table, app table | A table with `user_id` first in its keys (one person's rows), or one that belongs to the app as a whole (see [Data](data.md)) |
| Action | A named, validated operation in `actions/registry.ts`. The UI, the command menu, the assistant and the Teams bot all call actions |
| Write framework | The only path for writes to outside systems: preview, confirm, write, read back, audit log, undo |
| Marker | The extended property on every Outlook event FocusTime created; FocusTime refuses to change an event without it |
| Write PAT | A person's own Azure DevOps personal access token for one client, used only for that person's DevOps writes |
| Read PAT | The company's DevOps read token per client, read from Dataverse only when DevOps is read |
| Job | Background work for the app as a whole (polling, the retention purge), run by the one scheduler |
| Tick | Background work for one person (their timer, reminders, Teams messages), run by the same scheduler |
| Flex | OpenAI's slower, half-price processing tier, used only for background AI work nobody waits on |
| Demo | "Try the demo": a fictional person with fictional data in memory; nothing leaves FocusTime |

## How to keep them true

- **Same pull request as the change.** A step that changes what a page describes updates that page in the same pull request. A new table, write, permission, secret, job, reminder, dependency or retention rule always does.
- **Re-check the whole page, then stamp it.** A page's "Checked against" line names one commit of `main` and the date. Change it only after re-checking the whole page against that commit, never for the part you touched; a page you didn't re-check keeps its line. One commit per page, no list of exceptions.
- **The present only.** Pages say what FocusTime does now. History goes in [docs/decisions.md](../decisions.md); a page may have one short History line pointing there.
- **Screen names.** Use the screen's name as people see it. Where the code keeps another name, the names table gives it.
- **Mark what you couldn't confirm** as **Not verified** rather than guessing.
- **The checks.** `npm run docs:check` (also in the full suite and CI) fails on a broken link or heading, a page without exactly one "Checked against" commit, a Graph permission in the code that [Integrations](integrations.md) doesn't list, a diagram that isn't drawn, anything that looks like a secret, a retired screen name outside the names table and History lines, a repo path that doesn't exist, a table on [Data](data.md) the code doesn't have, and a dependency in `package.json` missing from [Development](development.md).
- **Diagrams** are Mermaid in the page. After changing one, run `npm run docs:diagrams` and commit the SVG it writes to `docs/technical/diagrams/`.
- **Nothing sensitive.** These pages are bundled into the app, and the app's built files are served without signing in. Never put a secret, token, key, connection string, tenant or subscription id, a client's or person's real name, or anything else that isn't fit for anyone to read. Name a secret by its Key Vault secret name only.

History: written whole from the code in DOC-1 and again in TD-1; see [docs/decisions.md](../decisions.md).
