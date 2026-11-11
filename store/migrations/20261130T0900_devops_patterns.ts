// WP-1: DevOps patterns, a hidden page that reads how work is entered in each client's DevOps. Only adds (D468). App
// tables (no person in their keys; who may see what is decided by actions/patterns.ts on every request):
//   patterns_runs        one inventory or classification run: its state, who pressed it (a FocusTime user id), which
//                        process owns it and its heartbeat, the reason it stopped, each client's progress (JSON: state,
//                        phase, ids and how far through them), the estimate and what it spent (millionths of a dollar).
//   patterns_snapshots   the numbers worked out for one client in one inventory run (JSON). Kept.
//   patterns_items       per item, the latest read: id, rev, type, level, state, dates, parent, title, and numbers about
//                        its text (lengths, counts, booleans). Never a description, acceptance or comment text, never a
//                        person.
//   patterns_labels      the labels for an item at a revision, per request type list version (and the second answer for
//                        the agreement sample). Only the validated labels.
//   patterns_type_lists  both versions of the request type list (names, meanings, made-up examples, the changes).
//   patterns_platforms   each client's platform (Azure, Fabric, Both), set on the page.
import type { NamedMigration } from "./named.ts";

export const devopsPatterns: NamedMigration = {
  name: "20261130T0900_devops_patterns",
  sqlite: `CREATE TABLE patterns_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL CHECK (kind IN ('inventory', 'classify')),
     state TEXT NOT NULL CHECK (state IN ('running', 'stopped', 'done')),
     started_by TEXT NOT NULL,
     started_at TEXT NOT NULL,
     heartbeat_at TEXT NOT NULL,
     finished_at TEXT,
     owner TEXT NOT NULL,
     reason TEXT,
     progress TEXT NOT NULL,
     estimate_micros INTEGER NOT NULL DEFAULT 0,
     spent_micros INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX patterns_runs_state ON patterns_runs (state, kind);
   CREATE TABLE patterns_snapshots (
     run_id INTEGER NOT NULL,
     client_key TEXT NOT NULL,
     at TEXT NOT NULL,
     numbers TEXT NOT NULL,
     PRIMARY KEY (run_id, client_key)
   );
   CREATE TABLE patterns_items (
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     rev INTEGER NOT NULL,
     type TEXT NOT NULL,
     state TEXT NOT NULL,
     created_at TEXT,
     activated_at TEXT,
     closed_at TEXT,
     parent_id INTEGER,
     title TEXT NOT NULL,
     facts TEXT NOT NULL,
     in_window INTEGER NOT NULL,
     run_id INTEGER NOT NULL,
     PRIMARY KEY (client_key, item_id)
   );
   CREATE TABLE patterns_labels (
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     list_version TEXT NOT NULL,
     rev INTEGER NOT NULL,
     labels TEXT NOT NULL,
     labels_b TEXT,
     at TEXT NOT NULL,
     PRIMARY KEY (client_key, item_id, list_version)
   );
   CREATE TABLE patterns_type_lists (
     version TEXT PRIMARY KEY,
     run_id INTEGER,
     created_at TEXT NOT NULL,
     list TEXT NOT NULL,
     changes TEXT NOT NULL,
     fingerprint TEXT NOT NULL
   );
   CREATE TABLE patterns_platforms (
     client_key TEXT PRIMARY KEY,
     platform TEXT NOT NULL CHECK (platform IN ('azure', 'fabric', 'both')),
     set_by TEXT NOT NULL,
     set_at TEXT NOT NULL
   );`,
  sqlserver: `CREATE TABLE patterns_runs (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  kind nvarchar(20) NOT NULL CONSTRAINT patterns_runs_kind_check CHECK (kind IN ('inventory', 'classify')),
  state nvarchar(20) NOT NULL CONSTRAINT patterns_runs_state_check CHECK (state IN ('running', 'stopped', 'done')),
  started_by nvarchar(64) NOT NULL,
  started_at nvarchar(40) NOT NULL,
  heartbeat_at nvarchar(40) NOT NULL,
  finished_at nvarchar(40) NULL,
  owner nvarchar(64) NOT NULL,
  reason nvarchar(300) NULL,
  progress nvarchar(max) NOT NULL,
  estimate_micros bigint NOT NULL CONSTRAINT patterns_runs_estimate_default DEFAULT 0,
  spent_micros bigint NOT NULL CONSTRAINT patterns_runs_spent_default DEFAULT 0
);
CREATE INDEX patterns_runs_state ON patterns_runs (state, kind);
CREATE TABLE patterns_snapshots (
  run_id int NOT NULL,
  client_key nvarchar(100) NOT NULL,
  at nvarchar(40) NOT NULL,
  numbers nvarchar(max) NOT NULL,
  CONSTRAINT patterns_snapshots_pk PRIMARY KEY (run_id, client_key)
);
CREATE TABLE patterns_items (
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  rev int NOT NULL,
  type nvarchar(200) NOT NULL,
  state nvarchar(200) NOT NULL,
  created_at nvarchar(40) NULL,
  activated_at nvarchar(40) NULL,
  closed_at nvarchar(40) NULL,
  parent_id int NULL,
  title nvarchar(400) NOT NULL,
  facts nvarchar(2000) NOT NULL,
  in_window int NOT NULL,
  run_id int NOT NULL,
  CONSTRAINT patterns_items_pk PRIMARY KEY (client_key, item_id)
);
CREATE TABLE patterns_labels (
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  list_version nvarchar(40) NOT NULL,
  rev int NOT NULL,
  labels nvarchar(2000) NOT NULL,
  labels_b nvarchar(2000) NULL,
  at nvarchar(40) NOT NULL,
  CONSTRAINT patterns_labels_pk PRIMARY KEY (client_key, item_id, list_version)
);
CREATE TABLE patterns_type_lists (
  version nvarchar(40) NOT NULL PRIMARY KEY,
  run_id int NULL,
  created_at nvarchar(40) NOT NULL,
  list nvarchar(max) NOT NULL,
  changes nvarchar(max) NOT NULL,
  fingerprint nvarchar(80) NOT NULL
);
CREATE TABLE patterns_platforms (
  client_key nvarchar(100) NOT NULL PRIMARY KEY,
  platform nvarchar(10) NOT NULL CONSTRAINT patterns_platforms_check CHECK (platform IN ('azure', 'fabric', 'both')),
  set_by nvarchar(64) NOT NULL,
  set_at nvarchar(40) NOT NULL
);`,
};
