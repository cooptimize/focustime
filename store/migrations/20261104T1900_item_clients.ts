// AP-2 (the guard fix): which client each DevOps work item id belongs to, per person, filled whenever FocusTime reads a
// client's items, so the AI guard refuses another client's known item ids after a restart too (and only those). Only
// adds (D468). Ids and client keys only: never a title or anything else from the item.
import type { NamedMigration } from "./named.ts";

export const itemClients: NamedMigration = {
  name: "20261104T1900_item_clients",
  sqlite: `CREATE TABLE devops_item_clients (
     user_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     seen_at TEXT NOT NULL,
     PRIMARY KEY (user_id, client_key, item_id)
   );
   CREATE INDEX devops_item_clients_item ON devops_item_clients (user_id, item_id);`,
  sqlserver: `CREATE TABLE devops_item_clients (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  seen_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, client_key, item_id)
);
CREATE INDEX devops_item_clients_item ON devops_item_clients (user_id, item_id);`,
};
