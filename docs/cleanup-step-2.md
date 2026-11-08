# Cleanup step 2: what can be dropped (needs the product owner's OK)

CL-1 (Nov 7) stopped using these; nothing here is dropped yet. Migrations only add (D468), so each drop ships in its
own new timestamped migration with a `safe-drop: <reason>` comment, in a release **after** the one that stops naming
the table anywhere, so rolling back one release still works against the database. The SQL below is text for that
later step, not a file in `store/migrations/`.

Row counts: no existing script reads the hosted dev database (Azure SQL takes only the app's managed identity, and the
only firewall rule is "Azure services"), so every count below is **count not checked**. Prod was not touched. A
counts-only check (Diagnostics style: numbers, never rows) is the first thing step 2 needs.

## The one thing step 2 must do first: take the tables out of `USER_TABLES`

`delivery_chats`, `chat_messages`, `asks` and `dedupe_log` are user tables. Every build up to and including CL-1 runs
`SELECT * FROM <table>` over `USER_TABLES` (`store/scope.ts`) for Export my data, the hard delete (`PARENTS_FIRST`)
and the claim of unowned rows (`store/claim.ts`). A build that still lists a table breaks those three paths if the
table is gone. So step 2 is two releases:

1. **Release 2a (no drop).** Remove the four tables from `USER_TABLES` and `store/sql/sqlserver.ts`'s datetime column
   map; stop `purgeChatText` and its daily `asks_cleanup` tick (`server/ticks.ts`); give `store/isolation.test.ts`
   and `test/fill.ts` an allow-list for tables kept only for a coming drop. Raise `USER_SCHEMA_VERSION` and keep
   reading older exports (`READABLE_SCHEMA_VERSIONS`), whose rows for these tables the import then skips. Before
   2a ships, every row of `chat_messages` older than 14 days must be gone (the cleanup has run daily since AP-1; with
   no writes since Nov 4, the last unmatched ones age out by Nov 18). Messages kept by an `asks` row stay until 2b.
2. **Release 2b (the drops).** One migration with the statements below, once 2a is the oldest revision anyone can
   roll back to.

`teams_message_images.bytes` is a column of an app table and isn't in `USER_TABLES`, so it needs only one release.

## The list

| Table or column | What it held | Unused since | Rollback risk |
|---|---|---|---|
| `teams_message_images.bytes` | CV-2's stripped chat image bytes | CV-4, Nov 7 (`20261107T1400_images_no_bytes` set every value to NULL; `store/images-bytes.test.ts` fails on any write) | Low. Only CV-2 builds wrote it; a rollback to one of those after the drop would fail its image fetch (it writes the column). Prod's last deploy (Nov 6, 21:21 UTC, `e8e21ce`) already includes CV-4, so prod's rollback target never writes it. |
| `delivery_chats` | T-2 / AP-1: each person's registered client chats, cached members (names, emails, tenants), the Read for asks state | AP-1's shared polling, Nov 4 (`20261104T2100_shared_requests` copied them to `client_chats`); CL-1 removed the last store methods | Builds before 2a run `SELECT *` on it (Export, hard delete, claim): see 2a above. Holds member emails, so it is personal data until dropped; Delete my data still removes a person's rows |
| `chat_messages` | AP-1: each person's copy of chat message text (up to 28,000 characters), author ids and tenants | Nov 4, same migration (messages live once in `teams_messages`); no writes since | As above, and builds before 2a delete from it daily (`purgeChatText`). Client data: Delete my data removes a person's rows; the per-client purge (`requests.purge`) only reaches `teams_messages` since D519, so these rows go with the 14-day rule or the drop |
| `asks` | AP-1 / AP-2: each person's asks (rule, status, item, note, the AI's sort) | Nov 4, same migration (`requests` replaced it); no writes since | As `chat_messages` (the same daily cleanup deletes hidden no-action asks) |
| `dedupe_log` | U3 (D388): the duplicate week items numbered migration 21 removed, for a count in the log | Migration 21 (the week features dedupe) is the only writer; nothing reads it except `openPlanDb` when it migrates a SQLite store from before 21 | None on SQL Server. On SQLite the numbered migrations are frozen and create and rename it, and `openPlanDb` reads it for an old local store; so drop it on SQL Server only and leave SQLite's |

Not on the list yet:

- **The `promises` table and `requests`** (HK-4's item 5): AP-1's rules pass still writes both on every poll and
  Settings › Client chats and the command menu still read them. Waiting on the product owner's decision (D910,
  Q-HK4-3).
- **The person's old `[ai]` keys** (`use`, `monthly_cap_usd`, `allowed_clients`): settings text, not a column. Still
  parsed for the one-time org bootstrap; see D1043 (CL-1). Removing them from the settings model later needs no
  migration (BH-1's loader ignores unknown keys).

## The migration (text for step 2b, not a file)

```ts
// 2026MMDDTHHMM_cleanup_drops.ts
// safe-drop: CL-1 stopped using these (Nov 7) and release 2a took the four user tables out of USER_TABLES;
// no revision that can still be rolled back to names them. the product owner's OK: <date>.
import type { NamedMigration } from "./named.ts";

export const cleanupDrops: NamedMigration = {
  name: "2026MMDDTHHMM_cleanup_drops",
  count: { op: "cleanup_drops_rows", sql: "SELECT (SELECT COUNT(*) FROM delivery_chats) + (SELECT COUNT(*) FROM chat_messages) + (SELECT COUNT(*) FROM asks) AS n" },
  // SQLite (the demo, the fallback, a local store's export): dedupe_log stays (the frozen numbered migrations use it).
  sqlite: `ALTER TABLE teams_message_images DROP COLUMN bytes;
   DROP TABLE IF EXISTS asks;
   DROP TABLE IF EXISTS chat_messages;
   DROP TABLE IF EXISTS delivery_chats;`,
  sqlserver: `ALTER TABLE teams_message_images DROP COLUMN IF EXISTS bytes;
DROP TABLE IF EXISTS asks;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS delivery_chats;
DROP TABLE IF EXISTS dedupe_log;`,
};
```

Notes for whoever writes it: `bytes` has no default constraint or index on either driver
(`20261106T1020_message_images`), so the column drop needs nothing first. No foreign key references any of the
tables. `store/migrations/additive.test.ts` will fail until the file carries its `safe-drop:` comment, which is the
point. The `count` line logs how many rows went (a number, never rows).
