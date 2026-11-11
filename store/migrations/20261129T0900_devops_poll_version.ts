// DV-2: when the poller last wrote a change for a client (an item added, changed or removed in the store, or a write's
// read-back). Screens ask for it every 30 s and reread the store only when it moves. The watermark moves on every
// check and changed_today resets each day, so neither can say "something changed". Only adds (D468). NULL until the
// first change after this migration.
import type { NamedMigration } from "./named.ts";

export const devopsPollVersion: NamedMigration = {
  name: "20261129T0900_devops_poll_version",
  sqlite: `ALTER TABLE devops_poll ADD COLUMN version_at TEXT;`,
  sqlserver: `ALTER TABLE devops_poll ADD version_at nvarchar(64) NULL;`,
};
