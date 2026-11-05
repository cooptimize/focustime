// AH-1: Ahead's change set. Only adds (D468).
//   ahead_changes  my pending DevOps edits (D657): one row per item and field (start, target, size, assignee), the
//                  value as JSON, the half-day for a date (display only), the item's revision and the field's value
//                  when I started editing it, and DevOps's value when it changed since (a conflict). A user table; a
//                  row goes when its change lands in DevOps, when I remove it, or with Discard all.
//   ahead_halves   the half-day (AM or PM) I chose for a start or target date after it landed in DevOps (DevOps stores
//                  the day, D659). Shown only while DevOps still has that day.
//   devops_notes   an app table (no person in it), like devops_takes: one row per notice another person should get
//                  from a commit (D664): "assigned" (an item assigned to them) or "dates" (dates moved on their items,
//                  one row per commit per owner, with the item ids). Their DevOps email (lowercased, only to match
//                  them), who did it (display name), the client, org and item ids; never a title. Kept 14 days.
import type { NamedMigration } from "./named.ts";

export const aheadChanges: NamedMigration = {
  name: "20261107T0900_ahead_changes",
  sqlite: `CREATE TABLE ahead_changes (
     user_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     field TEXT NOT NULL CHECK (field IN ('start', 'target', 'size', 'assignee')),
     value_json TEXT NOT NULL,
     half TEXT CHECK (half IN ('AM', 'PM')),
     base_rev INTEGER NOT NULL,
     base_json TEXT NOT NULL,
     theirs_json TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, client_key, item_id, field)
   );
   CREATE TABLE ahead_halves (
     user_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     field TEXT NOT NULL CHECK (field IN ('start', 'target')),
     day TEXT NOT NULL,
     half TEXT NOT NULL CHECK (half IN ('AM', 'PM')),
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, client_key, item_id, field)
   );
   CREATE TABLE devops_notes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL CHECK (kind IN ('assigned', 'dates')),
     client_key TEXT NOT NULL,
     org TEXT NOT NULL,
     item_ids TEXT NOT NULL,
     to_email TEXT NOT NULL,
     by_name TEXT NOT NULL,
     at TEXT NOT NULL
   );
   CREATE INDEX devops_notes_to ON devops_notes (to_email, at);`,
  sqlserver: `CREATE TABLE ahead_changes (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  field nvarchar(10) NOT NULL CHECK (field IN ('start', 'target', 'size', 'assignee')),
  value_json nvarchar(1000) NOT NULL,
  half nvarchar(3) NULL CHECK (half IN ('AM', 'PM')),
  base_rev int NOT NULL,
  base_json nvarchar(1000) NOT NULL,
  theirs_json nvarchar(1000) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, client_key, item_id, field)
);
CREATE TABLE ahead_halves (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  field nvarchar(10) NOT NULL CHECK (field IN ('start', 'target')),
  day date NOT NULL,
  half nvarchar(3) NOT NULL CHECK (half IN ('AM', 'PM')),
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, client_key, item_id, field)
);
CREATE TABLE devops_notes (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  kind nvarchar(10) NOT NULL CHECK (kind IN ('assigned', 'dates')),
  client_key nvarchar(100) NOT NULL,
  org nvarchar(100) NOT NULL,
  item_ids nvarchar(2000) NOT NULL,
  to_email nvarchar(320) NOT NULL,
  by_name nvarchar(200) NOT NULL,
  at nvarchar(40) NOT NULL
);
CREATE INDEX devops_notes_to ON devops_notes (to_email, at);`,
};
