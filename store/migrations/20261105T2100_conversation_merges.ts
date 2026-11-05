// CV-2: Merge into… by hand. Only adds (D468). conversations.merged_into marks a conversation merged into another
// (kept, never deleted, so Undo can bring it back; the lists and the pipeline leave it out). conversation_merges is an
// app table: one row per merge with what moved (message, commitment and suggestion ids) and both conversations'
// state before, for Undo. Ids and the conversations' own fields only: never message text.
import type { NamedMigration } from "./named.ts";

export const conversationMerges: NamedMigration = {
  name: "20261105T2100_conversation_merges",
  sqlite: `ALTER TABLE conversations ADD COLUMN merged_into INTEGER;
   CREATE TABLE conversation_merges (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     into_id INTEGER NOT NULL,
     from_id INTEGER NOT NULL,
     by_user TEXT NOT NULL,
     at TEXT NOT NULL,
     moved_json TEXT NOT NULL,
     before_json TEXT NOT NULL,
     after_summary TEXT,
     undone_at TEXT
   );
   CREATE INDEX conversation_merges_from ON conversation_merges (from_id);`,
  sqlserver: `ALTER TABLE conversations ADD merged_into int NULL;
CREATE TABLE conversation_merges (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  into_id int NOT NULL,
  from_id int NOT NULL,
  by_user nvarchar(64) NOT NULL,
  at datetime2(7) NOT NULL,
  moved_json nvarchar(max) NOT NULL,
  before_json nvarchar(max) NOT NULL,
  after_summary nvarchar(1000) NULL,
  undone_at datetime2(7) NULL
);
CREATE INDEX conversation_merges_from ON conversation_merges (from_id);`,
};
