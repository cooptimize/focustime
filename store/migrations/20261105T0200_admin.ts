// ADM-1: the admin console. Only adds (D468). App tables (no user_id: they are the team's, read and written on the
// database itself by the admin module, never through a person's scoped store):
//   org_settings      Rules, Defaults and Defaults by level: (scope, key) → a JSON value, with who set it and when.
//                     Scopes: "org", "client:<client key>", "level:<consultant|senior|lead>" (config/org.ts).
//   admin_audit       every admin change: who, when, what (area, target, setting), old and new value, and a note
//                     ("migrated", "suggested", "replaced by team style"). Never a secret, never plan content.
//   people_directory  each Cooptimizer's level from Dataverse (systemuser.positionid → position.name), refreshed daily,
//                     keyed by Entra object id (person_id).
//   client_leads      each client's leads from Dataverse: the account's owner (source "owner") and its Account Workers
//                     whose position is Lead Consultant ("lead_worker"). Several per client.
//   people_clients    the clients each person works on in Dataverse (Account Workers and current Focus Time), for
//                     Admin › People's "clients followed". Names only.
//   people_overrides  an admin's level override, or a client lead added or removed, while Dataverse is behind.
//   admin_seen        the latest admin answer per person (group or break-glass), for Admin's read-only list of admins.
// The org bootstrap (store/org-bootstrap.ts) fills org_settings once from people's old settings at the first start.
import type { NamedMigration } from "./named.ts";

export const admin: NamedMigration = {
  name: "20261105T0200_admin",
  sqlite: `CREATE TABLE org_settings (
     scope TEXT NOT NULL,
     skey TEXT NOT NULL,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     updated_by TEXT,
     PRIMARY KEY (scope, skey)
   );
   CREATE TABLE admin_audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     actor_id TEXT,
     actor_name TEXT NOT NULL,
     area TEXT NOT NULL,
     target TEXT NOT NULL,
     setting TEXT NOT NULL,
     old_value TEXT,
     new_value TEXT,
     note TEXT
   );
   CREATE INDEX admin_audit_at ON admin_audit (at);
   CREATE TABLE people_directory (
     person_id TEXT NOT NULL PRIMARY KEY,
     systemuser_id TEXT NOT NULL,
     name TEXT NOT NULL,
     email TEXT,
     level TEXT CHECK (level IN ('consultant', 'senior', 'lead')),
     position_name TEXT,
     refreshed_at TEXT NOT NULL
   );
   CREATE TABLE client_leads (
     client_key TEXT NOT NULL,
     person_id TEXT NOT NULL,
     source TEXT NOT NULL CHECK (source IN ('owner', 'lead_worker')),
     refreshed_at TEXT NOT NULL,
     PRIMARY KEY (client_key, person_id, source)
   );
   CREATE TABLE people_clients (
     person_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     refreshed_at TEXT NOT NULL,
     PRIMARY KEY (person_id, client_key)
   );
   CREATE TABLE people_overrides (
     person_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('level', 'lead_add', 'lead_remove')),
     client_key TEXT NOT NULL DEFAULT '',
     value TEXT,
     by_id TEXT,
     by_name TEXT NOT NULL,
     at TEXT NOT NULL,
     PRIMARY KEY (person_id, kind, client_key)
   );
   CREATE TABLE admin_seen (
     person_id TEXT NOT NULL PRIMARY KEY,
     is_admin INTEGER NOT NULL CHECK (is_admin IN (0, 1)),
     via TEXT,
     checked_at TEXT NOT NULL
   );`,
  sqlserver: `CREATE TABLE org_settings (
  scope nvarchar(120) NOT NULL,
  skey nvarchar(80) NOT NULL,
  value nvarchar(max) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  updated_by nvarchar(64) NULL,
  PRIMARY KEY (scope, skey)
);
CREATE TABLE admin_audit (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  at datetime2(7) NOT NULL,
  actor_id nvarchar(64) NULL,
  actor_name nvarchar(200) NOT NULL,
  area nvarchar(40) NOT NULL,
  target nvarchar(200) NOT NULL,
  setting nvarchar(120) NOT NULL,
  old_value nvarchar(max) NULL,
  new_value nvarchar(max) NULL,
  note nvarchar(200) NULL
);
CREATE INDEX admin_audit_at ON admin_audit (at);
CREATE TABLE people_directory (
  person_id nvarchar(64) NOT NULL PRIMARY KEY,
  systemuser_id nvarchar(64) NOT NULL,
  name nvarchar(200) NOT NULL,
  email nvarchar(320) NULL,
  level nvarchar(20) NULL CONSTRAINT people_directory_level CHECK (level IN ('consultant', 'senior', 'lead')),
  position_name nvarchar(100) NULL,
  refreshed_at datetime2(7) NOT NULL
);
CREATE TABLE client_leads (
  client_key nvarchar(100) NOT NULL,
  person_id nvarchar(64) NOT NULL,
  source nvarchar(20) NOT NULL CONSTRAINT client_leads_source CHECK (source IN ('owner', 'lead_worker')),
  refreshed_at datetime2(7) NOT NULL,
  PRIMARY KEY (client_key, person_id, source)
);
CREATE TABLE people_clients (
  person_id nvarchar(64) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  refreshed_at datetime2(7) NOT NULL,
  PRIMARY KEY (person_id, client_key)
);
CREATE TABLE people_overrides (
  person_id nvarchar(64) NOT NULL,
  kind nvarchar(20) NOT NULL CONSTRAINT people_overrides_kind CHECK (kind IN ('level', 'lead_add', 'lead_remove')),
  client_key nvarchar(100) NOT NULL CONSTRAINT people_overrides_client_default DEFAULT '',
  value nvarchar(20) NULL,
  by_id nvarchar(64) NULL,
  by_name nvarchar(200) NOT NULL,
  at datetime2(7) NOT NULL,
  PRIMARY KEY (person_id, kind, client_key)
);
CREATE TABLE admin_seen (
  person_id nvarchar(64) NOT NULL PRIMARY KEY,
  is_admin bit NOT NULL,
  via nvarchar(20) NULL,
  checked_at datetime2(7) NOT NULL
);`,
};
