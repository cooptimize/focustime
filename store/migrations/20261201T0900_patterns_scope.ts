// WP-2: DevOps patterns within a scope. Only adds (D468). App tables (no person in their keys; who may see what is decided
// by actions/patterns.ts on every request):
//   patterns_layout    per item in the 24-month window, what the layout needs: its project, area path, type and created
//                      date, and the run that read it. Never a title, text or person. Items outside the scope are kept
//                      only here.
//   patterns_projects  per client and project, the area tree and teams (names, area paths, "include sub areas", whether
//                      the team field is the area path) as the last layout read them. Never the teams' people.
//   patterns_scopes    each client's analysis scope, set on the page (whole projects, teams or area paths). The page's
//                      own: Admin › Clients' scope is never written here or from here.
//   patterns_kinds     each client's kind per work item type (Build work, Tickets and support, Leave out), when a person
//                      chose one; otherwise the page's guess applies.
import type { NamedMigration } from "./named.ts";

export const patternsScope: NamedMigration = {
  name: "20261201T0900_patterns_scope",
  sqlite: `CREATE TABLE patterns_layout (
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     project TEXT NOT NULL,
     area TEXT,
     type TEXT NOT NULL,
     created_at TEXT,
     run_id INTEGER NOT NULL,
     PRIMARY KEY (client_key, item_id)
   );
   CREATE TABLE patterns_projects (
     client_key TEXT NOT NULL,
     project TEXT NOT NULL,
     run_id INTEGER NOT NULL,
     at TEXT NOT NULL,
     tree TEXT NOT NULL,
     PRIMARY KEY (client_key, project)
   );
   CREATE TABLE patterns_scopes (
     client_key TEXT PRIMARY KEY,
     scope TEXT NOT NULL,
     set_by TEXT NOT NULL,
     set_at TEXT NOT NULL
   );
   CREATE TABLE patterns_kinds (
     client_key TEXT NOT NULL,
     type TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('build', 'tickets', 'leave_out')),
     set_by TEXT NOT NULL,
     set_at TEXT NOT NULL,
     PRIMARY KEY (client_key, type)
   );`,
  sqlserver: `CREATE TABLE patterns_layout (
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  project nvarchar(256) NOT NULL,
  area nvarchar(1000) NULL,
  type nvarchar(200) NOT NULL,
  created_at nvarchar(40) NULL,
  run_id int NOT NULL,
  CONSTRAINT patterns_layout_pk PRIMARY KEY (client_key, item_id)
);
CREATE TABLE patterns_projects (
  client_key nvarchar(100) NOT NULL,
  project nvarchar(256) NOT NULL,
  run_id int NOT NULL,
  at nvarchar(40) NOT NULL,
  tree nvarchar(max) NOT NULL,
  CONSTRAINT patterns_projects_pk PRIMARY KEY (client_key, project)
);
CREATE TABLE patterns_scopes (
  client_key nvarchar(100) NOT NULL PRIMARY KEY,
  scope nvarchar(max) NOT NULL,
  set_by nvarchar(64) NOT NULL,
  set_at nvarchar(40) NOT NULL
);
CREATE TABLE patterns_kinds (
  client_key nvarchar(100) NOT NULL,
  type nvarchar(200) NOT NULL,
  kind nvarchar(20) NOT NULL CONSTRAINT patterns_kinds_check CHECK (kind IN ('build', 'tickets', 'leave_out')),
  set_by nvarchar(64) NOT NULL,
  set_at nvarchar(40) NOT NULL,
  CONSTRAINT patterns_kinds_pk PRIMARY KEY (client_key, type)
);`,
};
