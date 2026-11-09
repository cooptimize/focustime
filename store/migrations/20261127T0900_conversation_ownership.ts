// Part 0: one shared owner per conversation. Only adds (D468). New columns on conversations: claimed_by, claimed_name,
// claimed_at (who is on it, by a person's own action or a Give to) and helpers_json. State is never stored: Closed is
// closed_at, Owned is claimed_by, else Open, so the two can't disagree. owner_id stays what it always was, the AI's
// guess at who is driving it, and never makes anything Owned.
//   conversation_events   an app table: who claimed, gave, added a helper, released, closed or reopened it, when, and
//                         the record before the change (for Undo). Ids and names only, never message text.
import type { NamedMigration } from "./named.ts";

export const conversationOwnership: NamedMigration = {
  name: "20261127T0900_conversation_ownership",
  sqlite: `ALTER TABLE conversations ADD COLUMN claimed_by TEXT;
   ALTER TABLE conversations ADD COLUMN claimed_name TEXT;
   ALTER TABLE conversations ADD COLUMN claimed_at TEXT;
   ALTER TABLE conversations ADD COLUMN helpers_json TEXT;
   CREATE TABLE conversation_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conversation_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('claim', 'give', 'helper', 'release', 'close', 'reopen')),
     by_user TEXT,
     by_name TEXT NOT NULL,
     to_user TEXT,
     to_name TEXT,
     via TEXT,
     note TEXT,
     before_json TEXT NOT NULL,
     at TEXT NOT NULL,
     undone_at TEXT
   );
   CREATE INDEX conversation_events_conv ON conversation_events (conversation_id, id);
   CREATE INDEX conversation_events_to ON conversation_events (to_user, at);`,
  sqlserver: `ALTER TABLE conversations ADD claimed_by nvarchar(64) NULL, claimed_name nvarchar(200) NULL, claimed_at datetime2(7) NULL, helpers_json nvarchar(max) NULL;
CREATE TABLE conversation_events (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  conversation_id int NOT NULL,
  kind nvarchar(10) NOT NULL CONSTRAINT conversation_events_kind_check CHECK (kind IN ('claim', 'give', 'helper', 'release', 'close', 'reopen')),
  by_user nvarchar(64) NULL,
  by_name nvarchar(200) NOT NULL,
  to_user nvarchar(64) NULL,
  to_name nvarchar(200) NULL,
  via nvarchar(20) NULL,
  note nvarchar(400) NULL,
  before_json nvarchar(max) NOT NULL,
  at datetime2(7) NOT NULL,
  undone_at datetime2(7) NULL
);
CREATE INDEX conversation_events_conv ON conversation_events (conversation_id, id);
CREATE INDEX conversation_events_to ON conversation_events (to_user, at);`,
};
