// MC-4: the meetings a person hid from Calls. Only adds (D468): one user table (user_id first in its key), in Export my
// data and removed with the person's data.
//
// call_hides: which meeting, and nothing else about it: its calendar key (Graph's iCalUId, "one") or, for Hide every
// one, its series' key on my calendar (Graph's seriesMasterId, "every"), and when I hid it. Never its name, time,
// people or link: Hidden shows names by reading my calendar the way the list does. A single meeting's row is deleted
// once it is 60 days old. An older build ignores the table: every meeting shows again, which loses nothing.
import type { NamedMigration } from "./named.ts";

export const callHides: NamedMigration = {
  name: "20261118T1500_call_hides",
  sqlite: `CREATE TABLE call_hides (
     user_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('one', 'every')),
     meeting_key TEXT NOT NULL,
     hidden_at TEXT NOT NULL,
     PRIMARY KEY (user_id, kind, meeting_key)
   );`,
  sqlserver: `CREATE TABLE call_hides (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  kind nvarchar(5) NOT NULL CHECK (kind IN ('one', 'every')),
  meeting_key nvarchar(300) NOT NULL,
  hidden_at nvarchar(40) NOT NULL,
  CONSTRAINT pk_call_hides PRIMARY KEY (user_id, kind, meeting_key)
);`,
};
