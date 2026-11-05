// DV-1: central DevOps polling. Only adds (D468). Three app tables (no person in them), one set per client:
// devops_items holds each work item's fields as DevOps returned them (the ones screens use, never a description or a
// comment), with its revision; devops_changes is the change log (kept 30 days) with the changer's display name and,
// only to match a FocusTime user, their uniqueName (D156's narrow exception); devops_poll is each client's poll state
// (watermark, last check, last error in plain words, pace). Never a PAT, a header or a body.
import type { NamedMigration } from "./named.ts";

export const devopsPoll: NamedMigration = {
  name: "20261105T2000_devops_poll",
  sqlite: `CREATE TABLE devops_items (
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     project TEXT NOT NULL,
     rev INTEGER NOT NULL,
     changed_at TEXT NOT NULL,
     fields TEXT NOT NULL,
     stored_at TEXT NOT NULL,
     PRIMARY KEY (client_key, item_id)
   );
   CREATE TABLE devops_changes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     kind TEXT NOT NULL,
     old_value TEXT,
     new_value TEXT,
     by_name TEXT,
     by_unique TEXT,
     changed_at TEXT NOT NULL,
     rev INTEGER NOT NULL,
     logged_at TEXT NOT NULL
   );
   CREATE INDEX devops_changes_client ON devops_changes (client_key, changed_at);
   CREATE INDEX devops_changes_logged ON devops_changes (logged_at);
   CREATE TABLE devops_poll (
     client_key TEXT NOT NULL PRIMARY KEY,
     watermark TEXT,
     checked_at TEXT,
     ok_at TEXT,
     loaded_at TEXT,
     reconciled_on TEXT,
     error_kind TEXT,
     error TEXT,
     slow INTEGER NOT NULL DEFAULT 1,
     slow_reason TEXT,
     retry_at TEXT,
     day TEXT,
     changed_today INTEGER NOT NULL DEFAULT 0,
     calls_today INTEGER NOT NULL DEFAULT 0
   );`,
  sqlserver: `CREATE TABLE devops_items (
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  project nvarchar(200) NOT NULL,
  rev int NOT NULL,
  changed_at nvarchar(40) NOT NULL,
  fields nvarchar(max) NOT NULL,
  stored_at nvarchar(40) NOT NULL,
  CONSTRAINT pk_devops_items PRIMARY KEY (client_key, item_id)
);
CREATE TABLE devops_changes (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  kind nvarchar(20) NOT NULL,
  old_value nvarchar(400) NULL,
  new_value nvarchar(400) NULL,
  by_name nvarchar(200) NULL,
  by_unique nvarchar(320) NULL,
  changed_at nvarchar(40) NOT NULL,
  rev int NOT NULL,
  logged_at nvarchar(40) NOT NULL
);
CREATE INDEX devops_changes_client ON devops_changes (client_key, changed_at);
CREATE INDEX devops_changes_logged ON devops_changes (logged_at);
CREATE TABLE devops_poll (
  client_key nvarchar(100) NOT NULL PRIMARY KEY,
  watermark nvarchar(40) NULL,
  checked_at nvarchar(40) NULL,
  ok_at nvarchar(40) NULL,
  loaded_at nvarchar(40) NULL,
  reconciled_on nvarchar(10) NULL,
  error_kind nvarchar(30) NULL,
  error nvarchar(300) NULL,
  slow int NOT NULL DEFAULT 1,
  slow_reason nvarchar(200) NULL,
  retry_at nvarchar(40) NULL,
  day nvarchar(10) NULL,
  changed_today int NOT NULL DEFAULT 0,
  calls_today int NOT NULL DEFAULT 0
);`,
};
