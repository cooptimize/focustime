// RB-1: the code view log. Only adds (D468).
//   code_views  app table: one row each time someone opens a client's repo, opens a file or uses Find in Code: when,
//               who (their Entra object id and name, as admin_audit keeps them), the client key, the repo (id and
//               name), the path and what happened. Never any of a file's content. Read only by admins (Admin › Audit ›
//               Code views); kept 12 months, then the daily retention purge removes it (store/retention.ts).
import type { NamedMigration } from "./named.ts";

export const codeViews: NamedMigration = {
  name: "20261113T0022_code_views",
  sqlite: `CREATE TABLE code_views (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     actor_id TEXT NOT NULL,
     actor_name TEXT NOT NULL,
     client_key TEXT NOT NULL,
     repo_id TEXT NOT NULL,
     repo_name TEXT NOT NULL,
     path TEXT NOT NULL,
     event TEXT NOT NULL
   );
   CREATE INDEX code_views_at ON code_views (at);
   CREATE INDEX code_views_client ON code_views (client_key, at);`,
  sqlserver: `CREATE TABLE code_views (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  at nvarchar(40) NOT NULL,
  actor_id nvarchar(100) NOT NULL,
  actor_name nvarchar(200) NOT NULL,
  client_key nvarchar(100) NOT NULL,
  repo_id nvarchar(40) NOT NULL,
  repo_name nvarchar(200) NOT NULL,
  path nvarchar(1100) NOT NULL,
  event nvarchar(20) NOT NULL
);
CREATE INDEX code_views_at ON code_views (at);
CREATE INDEX code_views_client ON code_views (client_key, at);`,
};
