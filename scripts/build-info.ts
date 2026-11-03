// S1 (D452): the build args for the image, from the workflow: the short sha, the PR number (the reuse job's answer
// from GitHub's API, else the "(#N)" or "Merge pull request #N" in the merge message, else "none") and the build time
// in UTC. Prints KEY=value lines for $GITHUB_ENV. Usage: node scripts/build-info.ts <sha> <pr from the API|none> <message>
import { prFromMessage } from "../server/buildinfo.ts";

const [sha = "", apiPr = "none", message = ""] = process.argv.slice(2);
const pr = /^\d+$/.test(apiPr) ? apiPr : (prFromMessage(message) ?? "none");
const at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
console.log(`BUILD_SHA=${/^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : "unknown"}`);
console.log(`BUILD_PR=${pr}`);
console.log(`BUILD_TIME=${at}`);
