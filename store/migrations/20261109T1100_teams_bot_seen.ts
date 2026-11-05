// TB-1b: Teams activities the bot has already handled, so a message Teams sends again (a retry, or the same delivery
// reaching a second replica) is answered once. Only adds (D468). A user table (user_id first in its key), left out
// of the export like the other bot tables (store/user-data.ts NOT_EXPORTED) and removed with the person's data.
//
// teams_bot_seen: one row per incoming activity: a SHA-256 of Teams' activity id (never the activity, its text or
// who it was from beyond the row's owner) and when it came. The insert is unique on (user_id, activity_hash), so of two
// replicas handling the same delivery only one inserts and answers. Rows older than a day are deleted as new ones come.
import type { NamedMigration } from "./named.ts";

export const teamsBotSeen: NamedMigration = {
  name: "20261109T1100_teams_bot_seen",
  sqlite: `CREATE TABLE teams_bot_seen (
     user_id TEXT NOT NULL,
     activity_hash TEXT NOT NULL,
     seen_at TEXT NOT NULL,
     PRIMARY KEY (user_id, activity_hash)
   );
   CREATE INDEX teams_bot_seen_at ON teams_bot_seen (user_id, seen_at);`,
  sqlserver: `CREATE TABLE teams_bot_seen (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  activity_hash nvarchar(64) NOT NULL,
  seen_at nvarchar(40) NOT NULL,
  CONSTRAINT pk_teams_bot_seen PRIMARY KEY (user_id, activity_hash)
);
CREATE INDEX teams_bot_seen_at ON teams_bot_seen (user_id, seen_at);`,
};
