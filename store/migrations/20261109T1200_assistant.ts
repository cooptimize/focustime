// AS-1: the assistant's history. Only adds (D468). Two user tables, user_id first in every key (store/scope.ts):
// assistant_turns, what the person asked and what the assistant answered (text, and cards as ids, titles and links),
// one row each, kept 30 days rolling (Clear in Settings › Data removes them at once); assistant_proposals, each write
// the assistant proposed: the registry action and its input (JSON), the client, the preview shown and the
// before-snapshot confirm compares against, its state and when it expires (15 minutes). Channel: "panel" or "teams"
// (TB-1). Never visible to admins; in Export my data like every user table.
import type { NamedMigration } from "./named.ts";

export const assistant: NamedMigration = {
  name: "20261109T1200_assistant",
  sqlite: `CREATE TABLE assistant_turns (
     user_id TEXT NOT NULL,
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     channel TEXT NOT NULL CHECK (channel IN ('panel', 'teams')),
     role TEXT NOT NULL CHECK (role IN ('me', 'assistant')),
     text TEXT NOT NULL,
     cards_json TEXT NOT NULL DEFAULT '[]'
   );
   CREATE INDEX assistant_turns_user_at ON assistant_turns (user_id, at);
   CREATE TABLE assistant_proposals (
     user_id TEXT NOT NULL,
     id INTEGER PRIMARY KEY,
     turn_id INTEGER,
     action TEXT NOT NULL,
     input_json TEXT NOT NULL,
     client_key TEXT,
     view_json TEXT NOT NULL,
     snapshot_json TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('open', 'confirmed', 'cancelled', 'expired', 'failed')),
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     done_at TEXT
   );
   CREATE INDEX assistant_proposals_user_turn ON assistant_proposals (user_id, turn_id);`,
  sqlserver: `CREATE TABLE assistant_turns (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  at datetime2(7) NOT NULL,
  channel nvarchar(10) NOT NULL CONSTRAINT assistant_turns_channel CHECK (channel IN ('panel', 'teams')),
  role nvarchar(10) NOT NULL CONSTRAINT assistant_turns_role CHECK (role IN ('me', 'assistant')),
  text nvarchar(max) NOT NULL,
  cards_json nvarchar(max) NOT NULL CONSTRAINT assistant_turns_cards DEFAULT '[]'
);
CREATE INDEX assistant_turns_user_at ON assistant_turns (user_id, at);
CREATE TABLE assistant_proposals (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  turn_id int NULL,
  action nvarchar(64) NOT NULL,
  input_json nvarchar(max) NOT NULL,
  client_key nvarchar(100) NULL,
  view_json nvarchar(max) NOT NULL,
  snapshot_json nvarchar(max) NOT NULL,
  state nvarchar(12) NOT NULL CONSTRAINT assistant_proposals_state CHECK (state IN ('open', 'confirmed', 'cancelled', 'expired', 'failed')),
  created_at datetime2(7) NOT NULL,
  expires_at datetime2(7) NOT NULL,
  done_at datetime2(7) NULL
);
CREATE INDEX assistant_proposals_user_turn ON assistant_proposals (user_id, turn_id);`,
};
