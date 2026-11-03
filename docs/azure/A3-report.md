# A3 report: the plan store on Azure SQL (SQL Server)

Nov 3, 2026. No Azure resources: the target is Azure SQL, built and tested against a local SQL Server 2025 container
(rootless Podman). The developer machine's service now runs on that container; the SQLite file is kept, untouched, as
the fallback.

Commits, in order:

| Commit | What |
|---|---|
| `5c38dc3` | Store interface and the SQL Server driver |
| `4f0aa8d` | Baseline migration and runner |
| `f46e35e` | Export and import CLI |
| `bc05f68` | Container and tests |
| (this commit) | Local switch and docs |

Rollback:
- **Config only (keeps the code):** in `~/.config/focustime/app.toml` set `[database] driver = "sqlite"` (or remove
  the section), then `systemctl --user restart focustime`. The service opens `~/.local/share/focustime/plan.db`, which
  the switch left as it was at the export (sha256 `8138e269…a114`, unchanged afterwards). Anything done on SQL Server
  after the switch is not in it.
- **Code:** `git revert 5c38dc3^..HEAD` (HEAD being the docs commit), with the config switch above first. plan.db is at version 26, which the
  A2 code reads.
- The container and its volume can stay (`npm run db:down` stops it) or go (`podman rm focustime-sqlserver`,
  `podman volume rm focustime_focustime-sqlserver`). The keyring entry `sql-password` is the only one A3 added.

## What changed

**One store interface, two drivers** (`store/sql/conn.ts`).
- `Conn`: `all`, `get`, `run` (with the new identity id, as SQLite's last insert id), `tx` (one transaction per
  async context; a statement inside joins it), a statement counter (the idle rule's test), `close`. The store became
  async end to end; every write is in a transaction.
- **sqlserver** (`store/sql/sqlserver.ts`, `mssql` 12.7.13):
  - a pool with no minimum and a 30 s idle time, so an idle server holds no connection;
  - auth `entra`: `DefaultAzureCredential` (the app's managed identity; `managed_identity_client_id` for a
    user-assigned one), token type `azure-active-directory-access-token`, the token kept only by the driver;
  - auth `sql`: a SQL login for a local server only, its password the host secret `sql-password`, read when a
    connection opens;
  - binds typed from the database's own catalog (so a stamp written to a datetime2 goes as UTC text with 7 digits);
  - reads decoded back to what the store expects: datetime2 as the instant in the person's zone, date as
    `YYYY-MM-DD`, bit as 0/1, bigint as a number.
- **sqlite** (`store/sql/sqlite.ts`, `node:sqlite`): the demo's in-memory store, the fallback switch, and
  `export-local`. A chain lock gives it the same one-transaction-at-a-time behaviour.
- `store/open.ts` opens the store from the app config's `[database]` (or `FOCUSTIME_DB_DRIVER`, `_SERVER`, `_PORT`,
  `_NAME`, `_AUTH`, `_USER`, `_MANAGED_IDENTITY_CLIENT_ID`), never per person. A connection error says the server,
  port and database, never a password or token.

**Dialect differences handled** (`store/sql/tsql.ts`, one place):

| SQLite form in the store | On SQL Server |
|---|---|
| `?` and `$uid` | `@p1`, `@p2`, … and `@uid` |
| `INSERT … ON CONFLICT (k) DO UPDATE / DO NOTHING` | `MERGE INTO t WITH (HOLDLOCK) USING (SELECT … AS col) AS excluded ON …` (literals cast to the column's type, so a NULL isn't an int) |
| `LIMIT n` | `SELECT TOP (n)` |
| `key`, `open`, `identity` as column names | `[key]`, `[open]`, `[identity]` |
| `a \|\| b` | `a + b` |
| `lastInsertRowid` | `SELECT CAST(SCOPE_IDENTITY() AS int) AS id` after an identity insert |
| an import keeping ids | `SET IDENTITY_INSERT` sent in the same request as the insert (a SET lasts only for its request) |
| partial unique indexes | filtered unique indexes (`WHERE rule_key IS NOT NULL`, …) |
| times stored as text | FocusTime's stamps are datetime2(7) UTC; the times a person or a calendar gave keep their text, offset and zone (nvarchar(100)) |
| `PRAGMA foreign_keys`, `VACUUM INTO` | foreign keys always on; no file copy (Reset local plan makes no backup on SQL Server) |

Stays SQLite-only: the claim of rows from before A2 (`store/claim.ts`, only ever a local store's), SQLite's own file,
backup and migration tests (10 tests, skipped in the SQL Server block by design).

**The baseline schema** (`store/sql/baseline.ts`, version 26; D429). 36 tables, 20 indexes besides the keys.
- Every per-person table: `user_id nvarchar(64) NOT NULL REFERENCES users(id)`, first in the primary key or unique
  key, and every index from the A2 isolation test led by it.
- ids: int identities, the same numbers as SQLite's. Stamps: datetime2(7) UTC. Dates: date. Flags: bit. JSON:
  nvarchar(max) with `CHECK (ISJSON(col) = 1)`.
- App tables: `users`, `sessions`, `auth_requests` (no reference to users: a demo session's person has no row),
  `deletions`, `schema_version`, and from migration 27 `scheduler_state` (one row: the idle rule's next-due time).

**Migration runner** (`store/sql/migrate.ts`). `schema_version (version, name, applied_at)`; each migration in its own
transaction, the version row written in it, a concurrent migrator held off by `UPDLOCK, HOLDLOCK` on that row; applied
versions skipped; a database newer than the build refused. Tests: empty to current, re-run applies nothing, baseline
then the rest, a failing migration leaves the version before it and no half-made table, newer refused.

**Retries** (`withRetry`, D430). Transient: 40613 (database not available, the serverless resume), 40197, 40501,
49918, 49919, 49920, 4060, 4221, 926, 615, 1205 (deadlock victim), and dropped or refused connections (ESOCKET,
ECONNRESET, ECONNCLOSED, ETIMEOUT, ENOTOPEN). Waits 5, 10, 20, 25 s (60 s in all); the whole transaction is retried,
never one statement inside it. While it waits on 40613, 4060 or a connection error the status is "waking"; after the
last wait, "unavailable". The page asks `/api/db-status` (from memory, no session needed, same origin only) when a call
hasn't answered in 1.5 s, and shows "Waking up the database. This can take up to a minute." Error numbers from
Microsoft's "Troubleshoot transient connection errors" and "Serverless tier" pages (current as of Nov 2026).

**The idle rule** (D431). The scheduler's passes run only while a signed-in person has used FocusTime in the last 15
minutes. Otherwise it stores the next moment anyone's work could be due (`plan/wake.ts`) and only looks at the clock
until then: no database call. Runtimes are built on the first pass, not at start. Hard deletes and the session sweep
moved from their own timers onto the slow pass. A restart before the stored time reads one row and sleeps
(`idle_start` in the log). Read-after-write: one connection per transaction, read committed (with read committed
snapshot on the databases `db:up` makes), so a write is visible to the next read.

**Export and import** (D432).
- `focustime export-local [--out] [--user]`: plan.db as one person's export, the same JSON as Settings > Data > Export
  my data (`focustime-export-1`, `schemaVersion` 26, the user tables' version on both stores). Opened read-only, as
  immutable when no write-ahead log is waiting (so not even a `-wal` or `-shm` file appears), never migrated; a store
  at another version is refused.
- `focustime import --file <export.json> --user <oid> [--dry-run]`: into the SQL Server database the app config names.
  One transaction; parents first; ids kept; links within a table (a moved pick, undone writes) filled after; rows
  already there left alone, so a second run adds nothing; refused for another format or version, a file with
  `user_secrets`, an unknown column, or an id that belongs to someone else. The users row is made from the export when
  missing. Dry run: the same checks and counts, nothing written.
- `focustime counts --user <oid> [--sqlite]`, `focustime migrate`.

**Container and commands** (`system/sqlserver/compose.yaml`, `scripts/db.ts`).
- `mcr.microsoft.com/mssql/server:2025-latest`, Developer edition, `ACCEPT_EULA=Y`, 127.0.0.1:14330 only, volume
  `focustime-sqlserver`, a 30 s stop grace period. Run with podman-compose.
- `npm run db:up` (first time: a random sa password into the keyring entry `sql-password`, passed to Podman in the
  environment, never on a command line), `db:migrate [-- --database <db>]`, `db:reset` (refuses `focustime`),
  `db:down`.
- Databases: `focustime` (the service), `focustime_dev`, and `focustime_test_*` (one per test file, dropped after).
- The service's first step, `scripts/db.ts start-if-configured`, starts the container when the app config names the
  local one, in a systemd scope of its own (started from the service, Podman's monitor would join the service's process
  group and a FocusTime restart would kill SQL Server).

## The migration on this machine

The service was stopped, so plan.db had no pending log. plan.db's sha256 before: `8138e269…a114`. `export-local`,
a dry run, the import, a second import (0 rows added), then counts per table for the owner:

| Table | SQLite | SQL Server |
|---|---:|---:|
| account_state | 3 | 3 |
| azure_write_log | 2 | 2 |
| borrowed | 1 | 1 |
| captures | 5 | 5 |
| day_plans | 9 | 9 |
| delivery_snapshots | 32 | 32 |
| devops_identities | 1 | 1 |
| devops_write_log | 7 | 7 |
| draft_stories | 4 | 4 |
| flex_sessions | 1 | 1 |
| focus_log | 14 | 14 |
| follow_ups | 10 | 10 |
| invites | 2 | 2 |
| kv | 3 | 3 |
| markers | 38 | 38 |
| outlook_events | 6 | 6 |
| picks | 21 | 21 |
| resume_notes | 1 | 1 |
| teams_status_log | 18 | 18 |
| timeboxes | 3 | 3 |
| user_settings | 10 | 10 |
| week_feature_slots | 4 | 4 |
| week_features | 16 | 16 |
| week_plans | 2 | 2 |
| write_log | 16 | 16 |
| user_secrets | 3 | 0 (not exported, by design) |
| breakdown_marks, dedupe_log, roadmap_dates, unavailable, week_drafts, week_quiet | 0 | 0 |
| **Total** | **232** | **229** |

Afterwards plan.db and its 23 backups had the same sha256 as before. Tanner confirmed the counts; then `app.toml` got
`[database] driver = "sqlserver"`, the build, and the service start. `DBCC CHECKDB` on `focustime`: no errors.

Found on the way:
- The first import was refused and rolled back: a follow-up's reference time held a zone name
  (`…-05:00[America/New_York]`), longer than the 40 characters the baseline gave caller-given times. They are
  nvarchar(100) now (the baseline corrected; nothing was deployed), with a test using the longest zone names, and a
  check of every column's size against the export's longest values found nothing else.
- The first read-only open of plan.db left an empty `plan.db-wal` and a `plan.db-shm` beside it (removed, nothing had
  them open); `export-local` now opens it as immutable when the service is stopped.
- A FocusTime restart killed the container while Podman's monitor ran in the service's process group (once, during
  the rehearsal; `DBCC CHECKDB` clean after); the container now starts in its own scope.

## Dependencies added

| Package | Version | License | Why |
|---|---|---|---|
| `mssql` | 12.7.13 (exact) | MIT | SQL Server driver (brings `tedious` 20.3.8, MIT) |
| `@azure/identity` | 4.14.1 (exact) | MIT | `DefaultAzureCredential` for the app's managed identity |

On this machine: `podman` 6.1.4 and `podman-compose` 1.6.0 (pacman, installed by Tanner). The SQL Server 2025 image
under Microsoft's Developer edition terms (accepted by Tanner).

## Verified

- Typecheck clean. The full suite with `FOCUSTIME_TEST_SQL=required` (a missing server fails instead of skipping):
  1964 passed, 10 skipped (the SQLite-file tests in the SQL Server block). With `FOCUSTIME_TEST_SQL=off` (as with no
  container): the SQL Server blocks skip with "SQL Server store tests SKIPPED: …" on stderr and in the block names,
  and the rest passes, 1898 tests, the demo included (in-memory SQLite, no container). SQL Server tests have a 30 s
  limit (the whole suite shares one server). `e2e/capture-drafts.test.ts` failed once under the full suite's load and
  passed 3 of 3 alone (demo mode, no database server; flaky before A3).
- On SQL Server: the A2 isolation test (two people, every table, with the foreign key to users checked), the migration
  tests, the restart test (a running timer and a due reminder fire once after a restart, not again), the scheduler,
  the round trip (a SQLite store's export imported equals it, row for row, times compared as instants), idempotence,
  the dry run, refusals, the retry rule with a fake transient error, and the idle rule (no statement in 19 idle
  minutes, the 9:00 reminder fired at 9:00, a restart before the stored time makes one read).
- On this machine after the switch (Tanner, in the app window): signed in (a returning user, from the imported row);
  the plan intact (Today, Week, Inbox, follow-ups); signed out and in again, which copied the keyring's DevOps write
  PAT once (`owner_secrets_copied count=1`; Google was already reconnected), so `user_secrets` is back to 3; the
  session survived service restarts (sessions are in SQL Server); a focus timer started at 07:10:57 UTC was still
  running after a restart; Settings > Data > Export my data downloaded (`data_export`). Restarts while nobody was using
  it slept until the stored time (`idle_start`). With the container stopped, a service start brought it up and the
  store waited for it (`database retry kind=ESOCKET`, then `recovered`).
- Found during that check and fixed: the keyring copy ran only at a first sign-in, which an imported person never has
  (now: also the only person's first sign-in after an import, once, recorded in their own store); and the stored
  wake time was only written on going idle, so a restart during a timer started while active could sleep past its end
  (now refreshed on every slow pass while someone is active; tested on SQL Server).
- Test runs no longer leave folders in /tmp (`test/tmp-dir.ts`: one TMPDIR per run, removed after); before, each
  full run left about 240 folders (about 100 MB), which filled /tmp during this step.

## CI (A4)

GitHub Actions runs the same image as a service container, and the tests require it:

```yaml
services:
  sqlserver:
    image: mcr.microsoft.com/mssql/server:2025-latest
    env: { ACCEPT_EULA: "Y", MSSQL_PID: Developer, MSSQL_SA_PASSWORD: "${{ secrets.CI_SQL_PASSWORD }}" }
    ports: ["14330:1433"]
    options: --health-cmd "/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P \"$MSSQL_SA_PASSWORD\" -Q 'SELECT 1'" --health-interval 5s --health-retries 30
steps:
  - run: npm ci && npm run typecheck
  - run: npm test
    env: { FOCUSTIME_TEST_SQL: required, FOCUSTIME_TEST_SQL_PASSWORD: "${{ secrets.CI_SQL_PASSWORD }}" }
```

The password is a throwaway for the job's container (a repository secret so it isn't in logs); the tests make and drop
their own databases. The health check's `-P` runs inside the service container, not in the job's logs.

## Deferred

- Azure SQL itself (the server, the database, the managed identity as a database user, firewall and private access)
  is A4. The connection code for it is written and typechecked but has only run against the container.
- The lease for one replica running the passes (A4).
- A5: Tanner's move from this container to Azure SQL with the same `export-local`/Export and `import`.
