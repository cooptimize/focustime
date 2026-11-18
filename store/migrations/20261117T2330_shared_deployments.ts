// DP-3: a deployment several people share. Only adds (D468): three app tables and one nullable column.
//   deployments         the one shared deployment: its client, title, window as two UTC instants (start_at, end_at, so
//                       two people in different zones see the same moment), the zone it was planned in, the note, the
//                       linked items, the ticked items, done, and a version that every change moves on (a save made
//                       on an older version is refused, never silently overwritten). last_move keeps the window a
//                       move came from, for its Undo. deleted_at marks one deleted for everyone (kept for Undo).
//   deployment_people   who is on it: the deployment, the person's id (their users.id, lowercased), the name shown,
//                       who added them and when. Only the people on it ever read a deployment.
//   deployment_notes    FocusTime's own notices to someone on it (added, moved, removed, deleted): the recipient, who
//                       made the change (a display name), the client and the window. Never the note or the items.
//                       Kept 14 days.
//   picks.deployment_id a person's own to-do for a shared deployment (their handle, in their own plan): the id they
//                       act on, their own half and position. Only that person's session writes it; its other columns
//                       are a mirror their own session refreshes from the shared row, which is the truth.
// An older build ignores all four: a deployment's pick reads as the deployment it was before DP-3.
import type { NamedMigration } from "./named.ts";

export const sharedDeployments: NamedMigration = {
  name: "20261117T2330_shared_deployments",
  sqlite: `CREATE TABLE deployments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     client_key TEXT NOT NULL,
     title TEXT NOT NULL,
     start_at TEXT NOT NULL,
     end_at TEXT NOT NULL,
     zone TEXT NOT NULL,
     notes TEXT,
     links TEXT,
     deploy_items TEXT,
     done_at TEXT,
     done_by TEXT,
     version INTEGER NOT NULL DEFAULT 1,
     last_move TEXT,
     created_by TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_by TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted_at TEXT,
     deleted_by TEXT
   );
   CREATE TABLE deployment_people (
     deployment_id INTEGER NOT NULL,
     person_id TEXT NOT NULL,
     name TEXT NOT NULL,
     added_by TEXT NOT NULL,
     added_at TEXT NOT NULL,
     PRIMARY KEY (deployment_id, person_id)
   );
   CREATE INDEX deployment_people_person ON deployment_people (person_id);
   CREATE TABLE deployment_notes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     deployment_id INTEGER NOT NULL,
     to_person TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('added', 'moved', 'removed', 'deleted')),
     by_name TEXT NOT NULL,
     client_key TEXT NOT NULL,
     start_at TEXT NOT NULL,
     end_at TEXT NOT NULL,
     at TEXT NOT NULL
   );
   CREATE INDEX deployment_notes_to ON deployment_notes (to_person, at);
   ALTER TABLE picks ADD COLUMN deployment_id INTEGER;
   CREATE INDEX picks_deployment ON picks (user_id, deployment_id);`,
  sqlserver: `CREATE TABLE deployments (
  id int IDENTITY(1,1) PRIMARY KEY,
  client_key nvarchar(100) NOT NULL,
  title nvarchar(200) NOT NULL,
  start_at nvarchar(40) NOT NULL,
  end_at nvarchar(40) NOT NULL,
  zone nvarchar(64) NOT NULL,
  notes nvarchar(2000) NULL,
  links nvarchar(max) NULL,
  deploy_items nvarchar(max) NULL,
  done_at nvarchar(40) NULL,
  done_by nvarchar(64) NULL,
  version int NOT NULL CONSTRAINT deployments_version_default DEFAULT 1,
  last_move nvarchar(400) NULL,
  created_by nvarchar(64) NOT NULL,
  created_at nvarchar(40) NOT NULL,
  updated_by nvarchar(64) NOT NULL,
  updated_at nvarchar(40) NOT NULL,
  deleted_at nvarchar(40) NULL,
  deleted_by nvarchar(64) NULL
);
CREATE TABLE deployment_people (
  deployment_id int NOT NULL,
  person_id nvarchar(64) NOT NULL,
  name nvarchar(200) NOT NULL,
  added_by nvarchar(64) NOT NULL,
  added_at nvarchar(40) NOT NULL,
  CONSTRAINT deployment_people_pk PRIMARY KEY (deployment_id, person_id)
);
CREATE INDEX deployment_people_person ON deployment_people (person_id);
CREATE TABLE deployment_notes (
  id int IDENTITY(1,1) PRIMARY KEY,
  deployment_id int NOT NULL,
  to_person nvarchar(64) NOT NULL,
  kind nvarchar(16) NOT NULL CONSTRAINT deployment_notes_kind_check CHECK (kind IN ('added', 'moved', 'removed', 'deleted')),
  by_name nvarchar(200) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  start_at nvarchar(40) NOT NULL,
  end_at nvarchar(40) NOT NULL,
  at nvarchar(40) NOT NULL
);
CREATE INDEX deployment_notes_to ON deployment_notes (to_person, at);
ALTER TABLE picks ADD deployment_id int NULL;
CREATE INDEX picks_deployment ON picks (user_id, deployment_id);`,
};
