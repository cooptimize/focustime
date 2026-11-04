// DS-1: Draft stories. Only adds (D468). story_drafts keeps one draft per run (the client, the feature, the person's
// note and the reviewed proposals as JSON: titles, descriptions, acceptance, dependencies, sizes, Keep or Drop, plus the
// AI's rationale and what it set aside); story_draft_writes maps a proposal to the DevOps write that created it, so a
// retry never makes a second item; house_styles keeps each client's computed house style (cached a week) and the
// person's edit of it. Never a token, never anything from another client.
import type { NamedMigration } from "./named.ts";

export const storyDrafts: NamedMigration = {
  name: "20261105T0100_story_drafts",
  sqlite: `CREATE TABLE story_drafts (
     user_id TEXT NOT NULL,
     id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     feature_id INTEGER NOT NULL,
     body TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, id)
   );
   CREATE INDEX story_drafts_feature ON story_drafts (user_id, client_key, feature_id);
   CREATE TABLE story_draft_writes (
     user_id TEXT NOT NULL,
     draft_id TEXT NOT NULL,
     proposal_id TEXT NOT NULL,
     write_id INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (user_id, draft_id, proposal_id)
   );
   CREATE TABLE house_styles (
     user_id TEXT NOT NULL,
     client_key TEXT NOT NULL,
     computed_text TEXT,
     computed_at TEXT,
     learned INTEGER NOT NULL DEFAULT 0 CHECK (learned IN (0, 1)),
     edited_text TEXT,
     edited_at TEXT,
     PRIMARY KEY (user_id, client_key)
   );`,
  sqlserver: `CREATE TABLE story_drafts (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  id nvarchar(64) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  feature_id int NOT NULL,
  body nvarchar(max) NOT NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX story_drafts_feature ON story_drafts (user_id, client_key, feature_id);
CREATE TABLE story_draft_writes (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  draft_id nvarchar(64) NOT NULL,
  proposal_id nvarchar(16) NOT NULL,
  write_id int NOT NULL,
  created_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, draft_id, proposal_id)
);
CREATE TABLE house_styles (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  client_key nvarchar(100) NOT NULL,
  computed_text nvarchar(2000) NULL,
  computed_at datetime2(7) NULL,
  learned bit NOT NULL CONSTRAINT house_styles_learned_default DEFAULT 0,
  edited_text nvarchar(2000) NULL,
  edited_at datetime2(7) NULL,
  PRIMARY KEY (user_id, client_key)
);`,
};
