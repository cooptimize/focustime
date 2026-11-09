// TX-1c: what a Done took off the plan, so unticking it puts them back. Only adds (D468).
//   picks.done_removed   JSON: { removed: pick ids, removedBoxes: timebox ids }, or null. Numbers only.
import type { NamedMigration } from "./named.ts";

export const pickDoneRemoved: NamedMigration = {
  name: "20261126T0900_pick_done_removed",
  sqlite: `ALTER TABLE picks ADD COLUMN done_removed TEXT;`,
  sqlserver: `ALTER TABLE picks ADD done_removed nvarchar(max) NULL;`,
};
