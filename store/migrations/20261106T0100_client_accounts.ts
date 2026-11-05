// ADM-2. Only adds (D468). App tables, refreshed with the daily Dataverse read (store/admin-store.ts):
//   directory_accounts         every active account's client key, name, relationship type (customertypecode as a
//                              word), and its Account Worker and current Focus Time counts, for clientAccounts()
//                              (plan/client-accounts.ts). Names and counts only, nothing else of a client's.
//   people_directory.guest     1 for a B2B guest in the Cooptimize tenant (#EXT# in Dataverse's domainname).
//   people_directory.entra     1 when Dataverse has the person's Entra object id (else person_id is "dv:<systemuserid>").
//   people_clients.worker      1 for an Account Worker link (Lead Consultants among the workers are leads), 0 for Focus
//                              Time only. Older builds ignore all three columns.
import type { NamedMigration } from "./named.ts";

export const clientAccounts: NamedMigration = {
  name: "20261106T0100_client_accounts",
  sqlite: `CREATE TABLE directory_accounts (
     account_id TEXT NOT NULL PRIMARY KEY,
     client_key TEXT NOT NULL,
     name TEXT NOT NULL,
     account_type TEXT,
     workers INTEGER NOT NULL DEFAULT 0,
     focus INTEGER NOT NULL DEFAULT 0,
     refreshed_at TEXT NOT NULL
   );
   CREATE INDEX directory_accounts_key ON directory_accounts (client_key);
   ALTER TABLE people_directory ADD COLUMN guest INTEGER;
   ALTER TABLE people_directory ADD COLUMN entra INTEGER;
   ALTER TABLE people_clients ADD COLUMN worker INTEGER;`,
  sqlserver: `CREATE TABLE directory_accounts (
  account_id nvarchar(64) NOT NULL PRIMARY KEY,
  client_key nvarchar(100) NOT NULL,
  name nvarchar(200) NOT NULL,
  account_type nvarchar(20) NULL,
  workers int NOT NULL CONSTRAINT directory_accounts_workers DEFAULT 0,
  focus int NOT NULL CONSTRAINT directory_accounts_focus DEFAULT 0,
  refreshed_at nvarchar(40) NOT NULL
);
CREATE INDEX directory_accounts_key ON directory_accounts (client_key);
ALTER TABLE people_directory ADD guest bit NULL;
ALTER TABLE people_directory ADD entra bit NULL;
ALTER TABLE people_clients ADD worker bit NULL;`,
};
