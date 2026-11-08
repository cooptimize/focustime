// DP-2: what a deployment moves. Only adds (D468): one nullable column on picks, the ticked items as JSON
// [{ "key": "fabric.reports", "name": "Reports" }], a snapshot: a change to the client's list never reaches a deployment
// already planned. Null on every WK-3 deployment, whose free text stays in picks.notes as its Note. An older build
// ignores the column.
import type { NamedMigration } from "./named.ts";

export const pickDeployItems: NamedMigration = {
  name: "20261122T0900_pick_deploy_items",
  sqlite: `ALTER TABLE picks ADD COLUMN deploy_items TEXT;`,
  sqlserver: `ALTER TABLE picks ADD deploy_items nvarchar(max) NULL;`,
};
