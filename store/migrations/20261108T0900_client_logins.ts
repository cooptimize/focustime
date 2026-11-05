// AH-3: client DevOps identities. Only adds (D468). client_logins is an app table (no user_id: it says which
// Cooptimizer a client's DevOps login is, for everyone). One row per client, DevOps sign-in email (lowercased, only
// to match) and source: "dataverse" (a person's Account Worker DevOps email, replaced on each directory read), "link"
// (a confirmed link, by the person or an admin) or "unlink" (an admin removed a Dataverse one). The person is their
// one id from cooptimizers(). The DevOps display name is kept for Admin › People; the email is never shown or logged.
import type { NamedMigration } from "./named.ts";

export const clientLogins: NamedMigration = {
  name: "20261108T0900_client_logins",
  sqlite: `CREATE TABLE client_logins (
     client_key TEXT NOT NULL,
     devops_email TEXT NOT NULL,
     source TEXT NOT NULL,
     person_id TEXT NOT NULL,
     devops_name TEXT,
     by_id TEXT,
     by_name TEXT,
     at TEXT NOT NULL,
     PRIMARY KEY (client_key, devops_email, source)
   );
   CREATE INDEX client_logins_person ON client_logins (person_id);`,
  sqlserver: `CREATE TABLE client_logins (
  client_key nvarchar(100) NOT NULL,
  devops_email nvarchar(320) NOT NULL,
  source nvarchar(20) NOT NULL,
  person_id nvarchar(100) NOT NULL,
  devops_name nvarchar(200) NULL,
  by_id nvarchar(100) NULL,
  by_name nvarchar(200) NULL,
  at nvarchar(40) NOT NULL,
  CONSTRAINT pk_client_logins PRIMARY KEY (client_key, devops_email, source)
);
CREATE INDEX client_logins_person ON client_logins (person_id);`,
};
