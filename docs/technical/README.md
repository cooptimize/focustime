# FocusTime technical docs

For every Cooptimizer who wants to know how FocusTime works under the hood: engineers changing it, IT reviewing it, and anyone curious. Checked against `13cd461` on Nov 7, 2026.

These pages are the single source for how FocusTime is built and run. They are written from the code, the Bicep, the scripts and the workflows on `main`. Where a page says **Not verified**, the fact couldn't be confirmed from the code and needs a person to check it.

## What FocusTime is

FocusTime is Cooptimize's hosted web app for planning focus work. It shows a week of half-day focus blocks per client (from Dataverse), lays meetings and personal events over them (from Outlook and, optionally, Google Calendar), flags blocks at risk, and helps each person plan their week and day against DevOps work items. It adds a focus timer, promises (follow-ups), an Inbox of client chat conversations, an assistant (in the app and as a Teams bot) and a few careful writes back to Outlook, DevOps and the person's own Azure VM.

It runs in Azure (Container Apps, Azure SQL, Key Vault) in two environments, dev and prod. People sign in with their Cooptimize Microsoft account. Everything they plan lives in FocusTime's own database; the outside systems stay the source of truth for their own data.

The person-facing guide is the in-app Guide (`ui/guide/`). These technical docs sit beside it: ⋯ › Technical docs.

## The pages

| Page | For | What it answers |
|---|---|---|
| [Architecture](architecture.md) | Engineers | The parts, the module map, how a request and an external write flow |
| [Data](data.md) | Engineers, IT | Every table by area, what is kept how long, what is never stored, who sees what |
| [Integrations](integrations.md) | Engineers, IT | Each outside system: sign-in, permissions, what is read and written, what people see when it fails |
| [Security](security.md) | IT first, then engineers | Secrets, tokens, client boundaries, admins, AI, external writes, the meeting and VM rules |
| [Operations](operations.md) | Whoever runs it | Environments, deploys and rollback, scripts, the Teams package, logs, troubleshooting |
| [Development](development.md) | Engineers | Local setup, worktrees, tests and CI, decisions, adding a write or a Graph permission safely |

## Glossary

The product's words (to-do, block, promise, Inbox and the rest) are in the glossary in [CLAUDE.md](../../CLAUDE.md#glossary-use-these-words-in-code-ui-and-chat) and the Guide's Renamed section. The technical words used on these pages:

| Term | Meaning |
|---|---|
| Host | Everything FocusTime needs from the machine it runs on, behind one interface (`host/types.ts`): `host/azure` in the hosted app, `host/local` for the developer loop |
| Developer loop | Running FocusTime on one developer's machine (`host/local`, `system/`); not part of the product |
| Plan store | FocusTime's database: Azure SQL in dev and prod, a SQL Server container in the developer loop, SQLite only for the demo and tests |
| User table / app table | A table with `user_id` first in its keys (one person's rows) or one that belongs to the app as a whole (see [Data](data.md)) |
| Action | A named, validated operation in `actions/registry.ts`. The UI, the command menu and the assistant all call actions |
| Write framework | The only path for writes to outside systems: preview, confirm, write, read back, audit log, undo |
| Marker | The extended property on every Outlook event FocusTime created; FocusTime refuses to change an event without it |
| Write PAT | A person's own Azure DevOps personal access token for one client, used only for that person's DevOps writes |
| Read PAT | The company's DevOps read token per client, read from Dataverse only when DevOps is fetched |
| Job | Background work for the app as a whole (polling, the retention purge), run by the one scheduler |
| Flex | OpenAI's slower, half-price processing tier, used only for background AI work nobody waits on |
| Demo | "Try the demo": a fictional person with fictional data in memory; nothing leaves FocusTime |

## Keeping these docs current

- **Same PR as the change.** A change that makes a page wrong updates that page in the same pull request. A new table, write, permission, secret, job or retention rule always does.
- **Re-check the line at the top.** After checking a page against the code, set its "Checked against" line to the commit you read and the date. A page you didn't re-check keeps its old line.
- **Mark what you couldn't confirm** as **Not verified** rather than guessing.
- **The checks.** `npm run docs:check` (also in the full suite and CI) fails on a broken link or heading, a page without its "Checked against" line, a Graph permission in the code that [Integrations](integrations.md) doesn't list, a diagram that isn't drawn, or anything that looks like a secret.
- **Diagrams** are Mermaid in the page. After changing one, run `npm run docs:diagrams` and commit the SVG it writes to `docs/technical/diagrams/`.
- **Nothing sensitive.** These pages are bundled into the app, and the app's built files are served without signing in. Never put a secret, token, key, connection string, tenant or subscription id, a client's or person's real name, or anything else that isn't fit for anyone to read. Name a secret by its Key Vault secret name only.
