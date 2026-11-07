// AH-5: State in Ahead's change set. Only adds (D468): ahead_changes keeps its field CHECK (start, target, size,
// assignee), so a pending state change has its own user table with the same columns. An older build ignores it
// (its pending state changes simply aren't shown), so rolling back is safe. In Export like ahead_changes.
import type { NamedMigration } from "./named.ts";

export const aheadStateChanges: NamedMigration = {
  name: "20261119T1000_ahead_state_changes",
  sqlite: `CREATE TABLE ahead_state_changes (
     user_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     field TEXT NOT NULL CHECK (field IN ('state')),
     value_json TEXT NOT NULL,
     half TEXT CHECK (half IN ('AM', 'PM')),
     base_rev INTEGER NOT NULL,
     base_json TEXT NOT NULL,
     theirs_json TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, client_key, item_id, field)
   );`,
  sqlserver: `CREATE TABLE ahead_state_changes (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  field nvarchar(10) NOT NULL CHECK (field IN ('state')),
  value_json nvarchar(1000) NOT NULL,
  half nvarchar(3) NULL CHECK (half IN ('AM', 'PM')),
  base_rev int NOT NULL,
  base_json nvarchar(1000) NOT NULL,
  theirs_json nvarchar(1000) NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, client_key, item_id, field)
);`,
};
