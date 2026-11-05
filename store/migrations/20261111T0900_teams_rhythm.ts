// TB-2: the bot's daily rhythm in Teams. Only adds (D468). One user table (user_id first in its key), left out of the
// export like the other bot tables (store/user-data.ts NOT_EXPORTED) and removed with the person's data.
//
// teams_rhythm: one row per message the bot sends on its own (an occasion: "brief:2026-11-12", "nudges:2026-11-12T14",
// "nudge:<item key>", "test:brief:<ms>"). The row is inserted before anything is sent, and the insert is unique on
// (user_id, occasion), so of two replicas only one sends: at most once (a send lost between the claim and Teams is
// logged as lost, never sent again). It keeps the message id (to update the card in place) and the card's own state
// (which picks were ticked, an inline proposal), never a message's text beyond the titles the card shows.
import type { NamedMigration } from "./named.ts";

export const teamsRhythm: NamedMigration = {
  name: "20261111T0900_teams_rhythm",
  sqlite: `CREATE TABLE teams_rhythm (
     user_id TEXT NOT NULL,
     occasion TEXT NOT NULL,
     kind TEXT NOT NULL,
     state TEXT NOT NULL,
     activity_id TEXT,
     model_json TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, occasion)
   );
   CREATE INDEX teams_rhythm_kind ON teams_rhythm (user_id, kind, created_at);`,
  sqlserver: `CREATE TABLE teams_rhythm (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  occasion nvarchar(120) NOT NULL,
  kind nvarchar(20) NOT NULL,
  state nvarchar(20) NOT NULL,
  activity_id nvarchar(200) NULL,
  model_json nvarchar(max) NULL,
  created_at nvarchar(40) NOT NULL,
  updated_at nvarchar(40) NOT NULL,
  CONSTRAINT pk_teams_rhythm PRIMARY KEY (user_id, occasion)
);
CREATE INDEX teams_rhythm_kind ON teams_rhythm (user_id, kind, created_at);`,
};
