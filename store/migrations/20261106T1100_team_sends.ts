// SW-1 (D630 to D641): Send to someone's week, client priorities, the client team view, Ask <lead> to look. Only adds
// (D468). All four are app tables (no user_id; people by their one id from cooptimizers(), lowercased), read and
// written on the database itself, like devops_takes:
//   sends             one item sent to one Cooptimizer's week (this week or next), Suggested or Must, with its state;
//                     from_id is the original sender and stays so through Pass to (by_id is who passed it last)
//   week_commitments  what a person committed for a week, per client, published on commit and re-commit: the
//                     feature, its type, must or nice to have, watched or not. Never hours, estimates, picks, pins,
//                     notes or focus (D636)
//   client_priorities a feature a client lead flagged for the client (no person named), with an optional note
//   look_asks         Ask <lead> to look: who asked whom about which client and week, a note, the lead's reply
// Titles are the item's DevOps title, shown only to people on that client (Account Workers and client leads who are
// Cooptimizers, checked per client in actions/team-actions.ts).
import type { NamedMigration } from "./named.ts";

export const teamSends: NamedMigration = {
  name: "20261106T1100_team_sends",
  sqlite: `CREATE TABLE sends (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     level TEXT NOT NULL CHECK (level IN ('feature', 'story')),
     title TEXT NOT NULL,
     item_type TEXT,
     url TEXT,
     parent_id INTEGER,
     week_start TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('suggested', 'must')),
     note TEXT,
     ask_take INTEGER NOT NULL DEFAULT 0,
     from_id TEXT NOT NULL,
     from_name TEXT NOT NULL,
     by_id TEXT,
     by_name TEXT,
     to_id TEXT NOT NULL,
     to_name TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('waiting', 'accepted', 'scheduled', 'cant', 'cancelled', 'withdrawn', 'done')),
     reason TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX sends_to ON sends (to_id, week_start);
   CREATE INDEX sends_from ON sends (from_id, week_start);
   CREATE INDEX sends_client ON sends (client_key, week_start);
   CREATE TABLE week_commitments (
     person_id TEXT NOT NULL,
     week_start TEXT NOT NULL,
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     title TEXT NOT NULL,
     item_type TEXT,
     url TEXT,
     tier TEXT NOT NULL CHECK (tier IN ('must', 'nice')),
     watching INTEGER NOT NULL DEFAULT 0,
     committed_at TEXT NOT NULL,
     PRIMARY KEY (person_id, week_start, client_key, item_id)
   );
   CREATE INDEX week_commitments_client ON week_commitments (client_key, week_start);
   CREATE TABLE client_priorities (
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     title TEXT NOT NULL,
     item_type TEXT,
     url TEXT,
     note TEXT,
     flagged_by_id TEXT NOT NULL,
     flagged_by_name TEXT NOT NULL,
     flagged_at TEXT NOT NULL,
     PRIMARY KEY (client_key, item_id)
   );
   CREATE TABLE look_asks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     client_key TEXT NOT NULL,
     week_start TEXT NOT NULL,
     from_id TEXT NOT NULL,
     from_name TEXT NOT NULL,
     to_id TEXT NOT NULL,
     to_name TEXT NOT NULL,
     note TEXT,
     reply TEXT,
     replied_at TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX look_asks_to ON look_asks (to_id, created_at);
   CREATE INDEX look_asks_from ON look_asks (from_id, week_start);`,
  sqlserver: `CREATE TABLE sends (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  level nvarchar(10) NOT NULL CONSTRAINT sends_level CHECK (level IN ('feature', 'story')),
  title nvarchar(400) NOT NULL,
  item_type nvarchar(100) NULL,
  url nvarchar(1000) NULL,
  parent_id int NULL,
  week_start nvarchar(10) NOT NULL,
  kind nvarchar(10) NOT NULL CONSTRAINT sends_kind CHECK (kind IN ('suggested', 'must')),
  note nvarchar(500) NULL,
  ask_take bit NOT NULL CONSTRAINT sends_ask_take DEFAULT 0,
  from_id nvarchar(100) NOT NULL,
  from_name nvarchar(200) NOT NULL,
  by_id nvarchar(100) NULL,
  by_name nvarchar(200) NULL,
  to_id nvarchar(100) NOT NULL,
  to_name nvarchar(200) NOT NULL,
  state nvarchar(12) NOT NULL CONSTRAINT sends_state CHECK (state IN ('waiting', 'accepted', 'scheduled', 'cant', 'cancelled', 'withdrawn', 'done')),
  reason nvarchar(500) NULL,
  created_at nvarchar(40) NOT NULL,
  updated_at nvarchar(40) NOT NULL
);
CREATE INDEX sends_to ON sends (to_id, week_start);
CREATE INDEX sends_from ON sends (from_id, week_start);
CREATE INDEX sends_client ON sends (client_key, week_start);
CREATE TABLE week_commitments (
  person_id nvarchar(100) NOT NULL,
  week_start nvarchar(10) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  title nvarchar(400) NOT NULL,
  item_type nvarchar(100) NULL,
  url nvarchar(1000) NULL,
  tier nvarchar(10) NOT NULL CONSTRAINT week_commitments_tier CHECK (tier IN ('must', 'nice')),
  watching bit NOT NULL CONSTRAINT week_commitments_watching DEFAULT 0,
  committed_at nvarchar(40) NOT NULL,
  CONSTRAINT week_commitments_pk PRIMARY KEY (person_id, week_start, client_key, item_id)
);
CREATE INDEX week_commitments_client ON week_commitments (client_key, week_start);
CREATE TABLE client_priorities (
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  title nvarchar(400) NOT NULL,
  item_type nvarchar(100) NULL,
  url nvarchar(1000) NULL,
  note nvarchar(500) NULL,
  flagged_by_id nvarchar(100) NOT NULL,
  flagged_by_name nvarchar(200) NOT NULL,
  flagged_at nvarchar(40) NOT NULL,
  CONSTRAINT client_priorities_pk PRIMARY KEY (client_key, item_id)
);
CREATE TABLE look_asks (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  client_key nvarchar(100) NOT NULL,
  week_start nvarchar(10) NOT NULL,
  from_id nvarchar(100) NOT NULL,
  from_name nvarchar(200) NOT NULL,
  to_id nvarchar(100) NOT NULL,
  to_name nvarchar(200) NOT NULL,
  note nvarchar(500) NULL,
  reply nvarchar(500) NULL,
  replied_at nvarchar(40) NULL,
  created_at nvarchar(40) NOT NULL
);
CREATE INDEX look_asks_to ON look_asks (to_id, created_at);
CREATE INDEX look_asks_from ON look_asks (from_id, week_start);`,
};
