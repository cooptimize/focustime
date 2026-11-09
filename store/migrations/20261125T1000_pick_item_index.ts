// TX-1b: an index so a week's stories read their time left by item instead of scanning a person's whole to-do history.
// Only adds (D468).
//   picks_client_item   picks(user_id, client_key, item_id, date)
import type { NamedMigration } from "./named.ts";

export const pickItemIndex: NamedMigration = {
  name: "20261125T1000_pick_item_index",
  sqlite: `CREATE INDEX picks_client_item ON picks(user_id, client_key, item_id, date);`,
  sqlserver: `CREATE INDEX picks_client_item ON picks(user_id, client_key, item_id, date);`,
};
