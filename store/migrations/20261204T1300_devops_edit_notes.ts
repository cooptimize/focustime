// ED-1: the quiet "<name> edited #<id>" note to an item's owner. Only adds (D468): devops_notes keeps its kind CHECK
// (assigned, dates), so an edit note has its own app table, like devops_notes (no person in it beyond the recipient's
// DevOps email, lowercased, only to match them): who edited (display name), the client, org and item id, the day,
// never a title or any of the text. One row per item, recipient and day at most (the unique index). Kept 14 days. An
// older build ignores it, so rolling back is safe.
import type { NamedMigration } from "./named.ts";

export const devopsEditNotes: NamedMigration = {
  name: "20261204T1300_devops_edit_notes",
  sqlite: `CREATE TABLE devops_edit_notes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     client_key TEXT NOT NULL,
     org TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     to_email TEXT NOT NULL,
     by_name TEXT NOT NULL,
     day TEXT NOT NULL,
     at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX devops_edit_notes_once ON devops_edit_notes (org, item_id, to_email, day);
   CREATE INDEX devops_edit_notes_to ON devops_edit_notes (to_email, at);`,
  sqlserver: `CREATE TABLE devops_edit_notes (
  id int IDENTITY(1,1) PRIMARY KEY,
  client_key nvarchar(100) NOT NULL,
  org nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  to_email nvarchar(320) NOT NULL,
  by_name nvarchar(200) NOT NULL,
  day nvarchar(10) NOT NULL,
  at nvarchar(40) NOT NULL
);
CREATE UNIQUE INDEX devops_edit_notes_once ON devops_edit_notes (org, item_id, to_email, day);
CREATE INDEX devops_edit_notes_to ON devops_edit_notes (to_email, at);`,
};
