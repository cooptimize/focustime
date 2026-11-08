# How the demo works

**Try the demo** on the sign-in page starts a demo session: a fictional person (Alex Rivera, you@example.com), four
fictional clients (Cooptimize, Northwind, Harbor Health, Atlas Freight), and fictional teammates (Jordan Lee, Priya
Shah, Sam Ortiz, Taylor Kim, plus a few names on items). Nothing in it is real, and nothing leaves FocusTime. The script for
showing it is [script.md](script.md).

## Where it lives

All demo wiring is in one place (no-demo-leak, D442): `server/main.ts` → `server/demo.ts` → `sources/demo/`.
Nothing else that runs imports from there (`host/no-demo-leak.test.ts`).

| Part | File | What it does |
|---|---|---|
| The context | `server/demo.ts` | One `ActionContext` per demo session: an in-memory plan store, the demo's team settings (an admin console of its own), its sources, writers and AI, then the seeds |
| The data | `sources/demo/data.ts` | Clients, work items, meetings, personal events, PTO (every Thursday, or Friday when the demo opens on a Thursday: never today; QF-1), people. Dates are relative to the current week, so the story is the same any week |
| DevOps | `sources/demo/devops.ts` | The session's own DevOps in memory. The app's real DevOps writer is given its `fetch`, so a state change, comment, create, Ahead save, Take one, description edit or Break down runs through the real preview, `test /rev`, read back, audit log and undo. Any other org throws before a request |
| Outlook | `sources/demo/outlook.ts` | The session's own calendar in memory, behind the real Graph writer: timeboxes on Outlook, help invites, my own events, RSVPs. Only `graph.microsoft.com/v1.0/me/...` is answered |
| AI | `sources/demo/ai.ts` | Real AI on demo data when the app has it: the team's AI for FocusTime on, under the app's monthly cap, and the session under about 1 USD. Otherwise, or after about 6 seconds, or when an answer doesn't fit its schema, a stored sample for the same task. The guard runs first, so a refused request is refused and never gets a sample |
| The assistant | `sources/demo/assistant.ts` | The scripted assistant for AI off: the script's lookup, to-do move and dictated comment, plus what's next, gaps, sends, confirm today, a capture |
| The seeds | `sources/demo/seeds/` | The starting data, one file per feature (below) |

Still refused in the demo (`DEMO_REFUSED` in `actions/dispatch.ts`): connecting accounts, signing in, setting or
clearing secrets and write PATs, export, opening links and players. Writes are simulated instead of refused since
DM-1.

## The seeds

Seeds run in order on every new demo session and again on Reset demo (`DEMO_SEEDS` in
`sources/demo/seeds/index.ts`). Each gets a `DemoSeedEnv`: the context, `run(action, input)` (the app's own actions,
so every rule applies), dates (`today`, `weekDay(n)`, `lastWorkday`, `ago(minutes)`), the demo person and the shared
demo stores (chats, conversations, the team). While seeds run, AI answers come only from the samples, so every run
starts the same.

| Seed | Owner | Makes |
|---|---|---|
| `week-plan.ts` | DM-1 | This week's plan: features and stories per client, musts and nice to haves |
| `team.ts` | DM-1 (SW-1) | Teammates' snapshots, two sends to my week, a client priority, an ask to look |
| `followups.ts` | DM-1 | Four follow-ups (overdue, today, tomorrow, Thursday) and a resume note |
| `captures.ts` | DM-1 (CP-1) | A capture to sort, and a draft story with its AI-prepared version |
| `unfinished.ts` | DM-1 (UI-B) | Unfinished to-dos from earlier days (from the last workday on a Monday) |
| `todo-done.ts` | PK-1 | A to-do checked off on the last workday whose DevOps item is still open (Harbor #2211), so Close out of that day asks to set it done in DevOps |
| `ahead.ts` | DM-1 (AH-1) | Three staged Ahead changes, one a conflict |
| `notices.ts`, `history.ts` | DM-1 | Notes and past days |
| `conversations.ts` | DM-1 (CV-1, CV-5) | Four registered chats; a conversation that needs me, my late promise, my promise due Friday, one tracked as #2211, one a teammate handles, chatter |
| `boundary.ts` | GD-2 | One teammate message naming Harbor in Northwind's customer chat, held back to sort by hand; a delivery team conversation that names Harbor, with its "mentions Harbor" tag |
| `status.ts` | SR-1 | Kat's sends last Monday; this week's comments on two features (mine, a teammate's, a Coop update), last week's, and the story changes behind the drafts |
| `inbox.ts` | IB-1 | What the Inbox needs beyond the other seeds, so every view shows something: Priya's question to me by name on Atlas (Needs you, "Priya asked you by name"; not sorted as urgent, so Today keeps one Start focus), her commitment to me (Waiting on), a conversation resolved this morning and a promise closed today (Done). `server/demo-inbox.test.ts` checks every view on every weekday |
| `assistant.ts` | AS-2 | Export orders to CSV (#1111) on the coming Wednesday afternoon, so the script's move by feature moves two to-dos |
| `meetings.ts` | MC-1 | Northwind's weekly status call (Upload; reviewers me and Priya) on the last workday's weekday, with a short fictional transcript uploaded for it: six proposals (a gap, three commitments, two comments) to review |

### Adding demo data for a feature

1. Add `sources/demo/seeds/<feature>.ts` exporting a `DemoSeed` (`name`, `owner`, `seed`). Prefer `e.run(...)` with
   the feature's own actions; write a store directly only for data no action makes (it comes from Teams or another
   person in the hosted app).
2. Add it to `DEMO_SEEDS` in `index.ts` (after anything it reads).
3. Keep it fictional: `@example.com` addresses, the demo's clients and people. `npm run guards` and
   `e2e/demo-names.test.ts` check names against the guard's list.
4. If an e2e counts things the seed changes, update it in the same change.
5. If the demo script shows the feature, update [script.md](script.md) and `e2e/demo-script.test.ts`.

## Reset demo

Settings › Demo › **Reset demo** (also Ctrl+K, "Reset demo") builds a fresh demo context for the session in place,
runs the seeds and reloads on Today. Every write, to-do, capture and send since is gone. It takes well under a
second (under 5 seconds is the test, `e2e/demo-reset.test.ts`). A restart of the app (a deploy, dev scaling to zero)
does the same for every demo session.

## Checking a deployed demo

`npm run demo:check -- --url https://<host> [--sha <commit>]` (`scripts/demo-check.ts`): the site is up, the build,
Try the demo, the demo's week, the Inbox's conversations and promises, Ahead, an AI answer (real or sample, with the
reason) and Reset demo, as a pass/fail list. It prints no cookie, token or response text.

## Tests

- `server/demo-writes.test.ts`: each write kind end to end in the demo, under `useNoOutbound()` from
  `test/no-outbound.ts`, which fails any fetch, http(s) request or socket. Use it in any future write test.
- `e2e/demo-script.test.ts`: the script, step by step (`DEMO_SHOTS=<folder>` for screenshots, dark and light).
- `e2e/demo-reset.test.ts`, `e2e/demo-check.test.ts`, `e2e/demo-names.test.ts`.
