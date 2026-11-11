# WP-1: What is in DevOps (plan)

Written before any code (Nov 11), then updated to what was built. The code "WP" was free in `docs/decisions.md`.

## Step 0

- No branch `feat/wp1-devops-patterns` and no WP-1 pull request existed: this started fresh from `origin/main` at `22e41701` (ENV-1 merged).
- ENV-1 has merged. Its policy (`config/background-policy.ts`) names every piece of background work. This step adds none: no scheduler job, no tick part, no `atStart` call. A run happens only inside the request of a person who pressed a button, and carries on in the same process until it ends, stops or the process goes away.
- Running at the same time: SG-1, QC-1, QT-2. This step stays in its own page (`ui/patterns/`), its server module (`actions/patterns*.ts`, pure parts in `plan/patterns/`), its store (`store/patterns-store.ts`, one migration), one switch in Admin › People and one command menu entry.

## What the DevOps store already holds, and what this step reads itself

The central store (`devops_items`, DV-1) keeps, per client, the open items and those closed in the last 90 days, with the fields screens use (title, type, state, parent, tags, changed date, assignee, area, iteration, target and start dates, size fields, rev, comment count, created date, project). It never holds descriptions or acceptance criteria, and it doesn't hold items closed more than 90 days ago.

So this step reads DevOps itself, and leaves the store alone:

- Items created in the last 24 months, by WIQL on `System.CreatedDate`, one month at a time (each query stays far below WIQL's 20,000 result limit, which the poller already treats as the maximum). Plus their parents (up to 3 levels up), wherever they were created.
- Per item, through the batch call (200 ids at most; this step sends 100): id, rev, type, state, title, parent, tags, created, activated, closed, comment count, the process's size or estimate fields, and the description and acceptance criteria. The two text fields are read only to measure them (length, empty or not) and, in a classification run, to send to the AI provider. They are never stored.
- Each client's first item date: one WIQL ordered by `System.CreatedDate` with `$top=1`, and one batch read.
- On a sample of up to 200 closed items per client, the item's history (the updates endpoint, `_apis/wit/workItems/{id}/updates`): whether the description or acceptance criteria changed after work started, and whether they were still empty at close. Booleans only.

## What is reused without changes

- The DevOps client (`sources/devops/source.ts`): a second app-level instance, built the same way as the poller's, through its `internal` reads (`ids`, `batch`). One read was added to `internal`: `updates(target, id)`, a GET of the item's history. Nothing existing changed.
- The poller's target (`devopsPoller.reads.target`), which carries the company read PAT in memory as before. This step never reads the PAT itself and never keeps it.
- Pacing (`plan/devops-pace.ts`: `readRate`), the poller's limiter (`ClientLimiter.waiting` and `hold`) and its freshness (`devopsPoller.freshness`, for when the poller's next check is due).
- The AI service (`ai/service.ts` through `aiFor(ctx)`): the switches, the guard, the caps, the request log without text, the per-client Allow AI. Prices from the app's settings (`ai/cost.ts`).
- The GD-2 checks: `maskTranscript` (MC-1's masking: another client's names, projects and item ids become "[another client]", emails "[email]") before every request, and `replaceMentions` on the request type names and meanings before they cross clients; the service's guard after that, as always.
- ADM-2's per-person Rules (`PERSON_SPECS`, scope `person:<id>`, saved by `admin.set` into `org_settings` with a row in `admin_audit`).

## How dev scales, and what survives what

`infra/dev.bicepparam`: `minReplicas = 0`, and the app module caps `maxReplicas` at 1. Dev scales to zero when no requests come in. So:

- One replica at a time: one run at a time is enforced in the database (a run row with an owner and a heartbeat) and in memory.
- Closing the tab: the run keeps going while the replica lives. With nobody else using dev it scales down within minutes and the run stops with it. The page asks for status every few seconds while it is open, which keeps the replica up, so the plain advice is "keep the page open".
- Scale-down or restart: the process is gone, the run's heartbeat stops. The next look at the page shows "Stopped: the server restarted or scaled down" with Resume. Nothing restarts it.
- This step doesn't change how anything scales.

## A per-person preview switch

None existed. ADM-2's "Automation account" is the one per-person Rule; "DevOps patterns (preview)" is added beside it (`devops_patterns`, a Rule set only by an admin, off by default, recorded in Admin › Audit like the rest). No migration needed for it.

## Azure DevOps REST, checked Nov 11

- WIQL (Query By Wiql, 7.1): `$top` and `timePrecision` are parameters. The page doesn't state the 20,000 limit; the poller already treats 20,000 as the maximum (D586). Month-sized queries keep this far under it; a month that comes back with 20,000 is logged as capped and named on the page.
- Work items batch (7.1): "Maximum 200" ids; body `ids`, `fields`, `asOf`, `$expand`, `errorPolicy` (`Omit` used, as the poller does).
- Comment count: the docs pages fetched don't list it; `System.CommentCount` is what the poller already reads and stores in production (DV-1's change log counts comments from it).
- Parent: `System.Parent` isn't listed on the batch page either; the poller and the children queries already read and filter on it in production.
- Updates (List, 7.1): `GET {project}/_apis/wit/workItems/{id}/updates?$top=&$skip=`, each update with `rev`, `revisedDate` and `fields` as `{ oldValue, newValue }`. No page size is stated: this step asks for 200 at a time, at most 5 pages.
- Rate limits: 200 TSTUs in a sliding 5-minute window; headers `Retry-After`, `X-RateLimit-Resource`, `-Delay`, `-Limit`, `-Remaining`, `-Reset`; 429 with TF400733 when blocked. The limit is per identity, and the poller and this step use the same company read PAT, so they share one budget.

## Sharing the budget with the poller

- One request at a time, per client, at least 2 seconds apart.
- Before each request: wait while DevOps asked the poller to wait (the shared limiter's hold), while the poller's next check is due within 15 seconds (or due in the last minute, so it is probably in flight), and while the last response this step saw left less than half the budget (the poller slows down at a fifth). Waits are 30 seconds and say so on the page ("Waiting for DevOps budget").
- This step's requests go through their own limiter, so their responses never count toward the poller's pace. A 429 or Retry-After on this step's request holds the shared limiter too: DevOps asked, and the poller would only be refused.
- An hour per run is fine. A client with 5,000 items in 24 months is about 300 requests, about 10 to 15 minutes.

## What a run does

Inventory: per client, in order: the first item date; the ids by month; the items; their parents; the history sample; the numbers, saved as that run's snapshot. Progress (the phase, the ids, how far through them) is saved after each step, so Resume carries on from there and never reads a finished client again.

Classification: Estimate (per client and in total, from stored lengths and the app's prices), then Run classification. Pass 1 on a sample of about 150 items per client with the starting list; then the "other" suggestions from all clients (names and meanings only, client names replaced) merged into a second list by one request with no client; then pass 2 on everything with that list. Item text is read again from DevOps for each batch, sent, and dropped. Labels are kept per item, revision and list version, so nothing unchanged is paid for twice.

## Who sees what

Counts, shares, labels and shapes for every client, to everyone with the switch on. Item rows (id, title, labels) only for the clients the person is on (Account Workers, `people_clients`), checked on every request. Being an admin changes nothing.

## What it stores

App tables, added by one migration: runs, a snapshot per client per run, items (id, rev, type, level, dates, state, parent, title, numbers about the text), labels per item and list version, the request type lists, each client's platform. Never stored: description, acceptance criteria or comment text, people's names, anything from an AI request but the labels (the adapter's own request log without text is unchanged).

## Removing it

Turn the switch off for everyone (nothing runs without a press). Then remove `ui/patterns/`, `actions/patterns*.ts`, `plan/patterns/`, `store/patterns-store.ts`, the registry entries and the Admin column; the tables go in a later release with a `safe-drop` migration (D468).

## What was built (Nov 11)

As planned, with these details settled while building:

- Ten items per classification request; a refused or malformed batch is retried one item at a time, and an item with no valid answer is counted, not shown.
- The estimate reads only the store (the lengths kept from the inventory), so it is free; Run classification carries its total and the server re-estimates before starting.
- The cost stop is checked after a batch's labels are saved, so what was paid for is kept.
- A classification Resume asks for a new estimate first.
- The page asks for status every 5 seconds while a run goes.
- The reader's freshness check uses the poller's own `freshness` (its next check per client).
- The skipped-client words name where to change it: "Allow AI is off for this client (Admin › AI)".
- Screenshots: `docs/ux/wp1/` (1440×900, light and dark, fictional data).
