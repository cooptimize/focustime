// IB-2: when a promise I added last changed, for the Inbox's timeline (its latest activity). Only adds (D468). NULL for
// rows from before this migration and until the first change; the timeline falls back to closed_at, then opened_at.
import type { NamedMigration } from "./named.ts";

export const followUpChangedAt: NamedMigration = {
  name: "20261123T0900_follow_up_changed_at",
  sqlite: `ALTER TABLE follow_ups ADD COLUMN changed_at TEXT;`,
  sqlserver: `ALTER TABLE follow_ups ADD changed_at nvarchar(64) NULL;`,
};
