// PV-1 (D573): Take one. Only adds (D468). devops_takes is an app table (no person in it): one row when someone takes
// a teammate's DevOps story (assigns it to themselves through the write framework), so the teammate, if they use
// FocusTime, gets one quiet notice "<name> took #<id>" from their own scheduler pass. It keeps the client, the org,
// the item id, the previous assignee's DevOps sign-in email (lowercased, only to match them), the taker's display
// name and when; never the item's title. Rows go after 14 days, and an undo removes its row.
import type { NamedMigration } from "./named.ts";

export const devopsTakes: NamedMigration = {
  name: "20261105T1300_devops_takes",
  sqlite: `CREATE TABLE devops_takes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     client_key TEXT NOT NULL,
     org TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     from_email TEXT NOT NULL,
     by_name TEXT NOT NULL,
     taken_at TEXT NOT NULL
   );
   CREATE INDEX devops_takes_from ON devops_takes (from_email, taken_at);`,
  sqlserver: `CREATE TABLE devops_takes (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  client_key nvarchar(100) NOT NULL,
  org nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  from_email nvarchar(320) NOT NULL,
  by_name nvarchar(200) NOT NULL,
  taken_at nvarchar(40) NOT NULL
);
CREATE INDEX devops_takes_from ON devops_takes (from_email, taken_at);`,
};
