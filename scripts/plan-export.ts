// Export the local plan store to JSON. Usage: node scripts/plan-export.ts [out.json]   (stdout without a file)
// Reads only FocusTime's own plan; contains no tokens or secrets.
import { writeFileSync } from "node:fs";
import { localPaths } from "../host/local/paths.ts";
import { createPlanStore } from "../store/plan-store.ts";

const store = createPlanStore({ path: localPaths().planDb, now: () => Temporal.Now.zonedDateTimeISO() });
const json = JSON.stringify(store.exportJson(), null, 2) + "\n";
store.close();
const out = process.argv[2];
if (out) {
  writeFileSync(out, json, { mode: 0o600 });
  process.stderr.write(`Plan exported to ${out}\n`);
} else process.stdout.write(json);
