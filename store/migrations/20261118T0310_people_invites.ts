// IN-1: Invite to FocusTime. Only adds (D468). people_invites is an app table (no user_id: it is the team's record
// of who an admin invited, for admins): each Cooptimizer's latest invite an admin opened or copied (the one before
// is replaced; Admin › Audit keeps every one). The person is their one id (Entra object id, or "dv:<systemuserid>"); how is teams, outlook,
// email or copy. FocusTime sends nothing: the row says only that an admin opened the invite to send it themselves.
// Removing a person (Admin › People) deletes their rows.
import type { NamedMigration } from "./named.ts";

export const peopleInvites: NamedMigration = {
  name: "20261118T0310_people_invites",
  sqlite: `CREATE TABLE people_invites (
     person_id TEXT NOT NULL,
     at TEXT NOT NULL,
     by_id TEXT,
     by_name TEXT NOT NULL,
     via TEXT NOT NULL,
     PRIMARY KEY (person_id)
   );`,
  sqlserver: `CREATE TABLE people_invites (
  person_id nvarchar(100) NOT NULL,
  at nvarchar(40) NOT NULL,
  by_id nvarchar(100) NULL,
  by_name nvarchar(200) NOT NULL,
  via nvarchar(20) NOT NULL,
  CONSTRAINT pk_people_invites PRIMARY KEY (person_id)
);`,
};
