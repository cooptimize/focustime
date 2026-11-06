// HK-4: once-a-day app jobs claim their day here, so of two replicas (or a restart) only one runs it. Only adds (D468).
// An app table (no person in it): the job's name, the period it claimed (a UTC date), when, and when it finished with
// its counts (numbers only). A unique insert on (job, period) is the claim; a run that fails removes its claim so the
// next try can take it. Rows older than 30 days go with the retention purge.
import type { NamedMigration } from "./named.ts";

export const jobClaims: NamedMigration = {
  name: "20261114T0900_job_claims",
  sqlite: `CREATE TABLE job_claims (
     job TEXT NOT NULL,
     period TEXT NOT NULL,
     claimed_at TEXT NOT NULL,
     done_at TEXT,
     counts_json TEXT,
     PRIMARY KEY (job, period)
   );`,
  sqlserver: `CREATE TABLE job_claims (
  job nvarchar(64) NOT NULL,
  period nvarchar(20) NOT NULL,
  claimed_at nvarchar(40) NOT NULL,
  done_at nvarchar(40) NULL,
  counts_json nvarchar(2000) NULL,
  CONSTRAINT pk_job_claims PRIMARY KEY (job, period)
);`,
};
