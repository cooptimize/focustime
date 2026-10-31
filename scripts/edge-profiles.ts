// Show how Edge is installed and its profiles (directory and display name only), to fill in [edge] in config.
// Reads Edge's .desktop entry and the profile list in Local State. Nothing else in Local State is read or printed.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { detectEdge, profilesFromLocalState } from "../links/edge.ts";

const read = (p: string) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
const edge = detectEdge(read, homedir());
if (!edge) {
  console.log("Edge not found (no microsoft-edge.desktop or com.microsoft.Edge.desktop entry).");
  process.exit(1);
}
console.log(`Install: ${edge.install} (${edge.desktopFile})`);
console.log(`Launch command: ${JSON.stringify(edge.command)}`);
// Through uwsm-app, Edge runs in its own unit, so restarting the Coopilot service never closes it.
if (read("/usr/bin/uwsm-app") !== null) console.log(`For config: command = ${JSON.stringify(["uwsm-app", "--", ...edge.command])}`);
console.log(`Profiles in ${edge.profilesDir}:`);
for (const p of profilesFromLocalState(read(`${edge.profilesDir}/Local State`) ?? "")) console.log(`  ${JSON.stringify(p.directory)}  ${p.name}`);
