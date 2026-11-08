// KB-1: Cooptimize's development standards, synced from GitHub. Only adds (D468). Two app tables, no person in them:
// the active articles as last read in full (path, front matter, SHA-256, commit, text) and the one row of sync state.
// Policy text with no client data; never in an export.
import type { NamedMigration } from "./named.ts";

export const standards: NamedMigration = {
  name: "20261124T0900_standards",
  sqlite: `CREATE TABLE standards_articles (
     path TEXT NOT NULL PRIMARY KEY,
     article_id TEXT NOT NULL,
     title TEXT NOT NULL,
     domain TEXT NOT NULL,
     layer TEXT NOT NULL,
     artifact TEXT NOT NULL,
     technology TEXT NOT NULL,
     status TEXT NOT NULL,
     sha256 TEXT NOT NULL,
     commit_sha TEXT NOT NULL,
     body TEXT NOT NULL
   );
   CREATE TABLE standards_sync (
     id INTEGER NOT NULL PRIMARY KEY,
     repo_url TEXT NOT NULL,
     branch TEXT NOT NULL,
     commit_sha TEXT,
     synced_at TEXT,
     checked_at TEXT,
     error TEXT,
     error_at TEXT,
     warnings TEXT NOT NULL
   );`,
  sqlserver: `CREATE TABLE standards_articles (
  path nvarchar(400) NOT NULL,
  article_id nvarchar(200) NOT NULL,
  title nvarchar(400) NOT NULL,
  domain nvarchar(100) NOT NULL,
  layer nvarchar(100) NOT NULL,
  artifact nvarchar(100) NOT NULL,
  technology nvarchar(100) NOT NULL,
  status nvarchar(40) NOT NULL,
  sha256 nvarchar(64) NOT NULL,
  commit_sha nvarchar(40) NOT NULL,
  body nvarchar(max) NOT NULL,
  CONSTRAINT standards_articles_pk PRIMARY KEY (path)
);
CREATE TABLE standards_sync (
  id int NOT NULL,
  repo_url nvarchar(300) NOT NULL,
  branch nvarchar(200) NOT NULL,
  commit_sha nvarchar(40) NULL,
  synced_at datetime2(7) NULL,
  checked_at datetime2(7) NULL,
  error nvarchar(500) NULL,
  error_at datetime2(7) NULL,
  warnings nvarchar(max) NOT NULL,
  CONSTRAINT standards_sync_pk PRIMARY KEY (id)
);`,
};
