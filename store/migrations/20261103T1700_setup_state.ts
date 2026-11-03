// S1 (D451): first-run setup's per-person state: one row per setup step the person finished, skipped or closed.
// Nothing else of setup is stored here; the settings it edits are the person's ordinary settings rows.
import type { NamedMigration } from "./named.ts";

const STEPS = "'day', 'clients', 'blocks', 'calendars'";
const STATUSES = "'done', 'skipped', 'dismissed'";

export const setupState: NamedMigration = {
  name: "20261103T1700_setup_state",
  sqlite: `CREATE TABLE setup_state (
     user_id TEXT NOT NULL,
     step TEXT NOT NULL CHECK (step IN (${STEPS})),
     status TEXT NOT NULL CHECK (status IN (${STATUSES})),
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, step)
   );`,
  sqlserver: `CREATE TABLE setup_state (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  step nvarchar(16) NOT NULL CONSTRAINT setup_state_step CHECK (step IN (${STEPS})),
  status nvarchar(16) NOT NULL CONSTRAINT setup_state_status CHECK (status IN (${STATUSES})),
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, step)
);`,
};
