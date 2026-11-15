// ED-2: Title and Parent in Backlog's change set. Only adds (D468): ahead_changes keeps its field CHECK (start,
// target, size, assignee) and ahead_state_changes its own (state), so a pending rename or move has its own user table
// with the same columns (the values a little wider: a title is up to 255 characters, and a parent is kept with its
// title). An older build ignores it (its pending renames and moves simply aren't shown, and nothing of them is
// written), so rolling back is safe. In Export like ahead_changes.
import type { NamedMigration } from "./named.ts";

export const aheadEditChanges: NamedMigration = {
  name: "20261205T0900_ahead_edit_changes",
  sqlite: `CREATE TABLE ahead_edit_changes (
     user_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     field TEXT NOT NULL CHECK (field IN ('title', 'parent')),
     value_json TEXT NOT NULL,
     half TEXT CHECK (half IN ('AM', 'PM')),
     base_rev INTEGER NOT NULL,
     base_json TEXT NOT NULL,
     theirs_json TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, client_key, item_id, field)
   );`,
  sqlserver: `CREATE TABLE ahead_edit_changes (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  field nvarchar(10) NOT NULL CHECK (field IN ('title', 'parent')),
  value_json nvarchar(2000) NOT NULL,
  half nvarchar(3) NULL CHECK (half IN ('AM', 'PM')),
  base_rev int NOT NULL,
  base_json nvarchar(2000) NOT NULL,
  theirs_json nvarchar(2000) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, client_key, item_id, field)
);`,
};
