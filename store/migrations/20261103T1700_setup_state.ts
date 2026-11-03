// S1 (D451): first-run setup's per-person state: one row per setup step the person finished, skipped or closed.
// Nothing else of setup is stored here; the settings it edits are the person's ordinary settings rows. Everyone who
// already has settings when it runs counts as set up: each of their four steps is recorded done, so they never see
// the flow or the Today line. A person who first signs in later has no rows, and sees the flow.
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
   );
   INSERT INTO setup_state (user_id, step, status, updated_at)
     SELECT u.user_id, s.step, 'done', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     FROM (SELECT DISTINCT user_id FROM user_settings) u
     CROSS JOIN (SELECT 'day' AS step UNION ALL SELECT 'clients' UNION ALL SELECT 'blocks' UNION ALL SELECT 'calendars') s;`,
  sqlserver: `CREATE TABLE setup_state (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  step nvarchar(16) NOT NULL CONSTRAINT setup_state_step CHECK (step IN (${STEPS})),
  status nvarchar(16) NOT NULL CONSTRAINT setup_state_status CHECK (status IN (${STATUSES})),
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, step)
);
INSERT INTO setup_state (user_id, step, status, updated_at)
  SELECT u.user_id, s.step, 'done', SYSUTCDATETIME()
  FROM (SELECT DISTINCT user_id FROM user_settings) u
  CROSS JOIN (VALUES ('day'), ('clients'), ('blocks'), ('calendars')) s(step);`,
};
