// Step 15.5 live check: sends one notification of a kind through the running FocusTime (its real path: text, buttons,
// click routing), without waiting for its occasion. Reads the launch link from the private launch file; never prints it.
//   node scripts/notify-sample.mjs <kind> [--live] [--gated]
// kinds: test plan_day checkin closeout plan_week look_ahead timer meeting vm vm_changed followups expiry
// VM samples open the VM menu instead of starting or restoring, unless --live (then they really do).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const kind = process.argv[2];
if (!kind) {
  console.error("usage: node scripts/notify-sample.mjs <kind> [--live]");
  process.exit(2);
}
const live = process.argv.includes("--live");
// --gated: through Settings > Notifications like a real one (switch, quiet hours, held during focus).
const gated = process.argv.includes("--gated");
const { url } = JSON.parse(readFileSync(join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "focustime", "launch.json"), "utf8"));
const origin = new URL(url).origin;
const first = await fetch(url, { redirect: "manual" });
const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
const body = kind === "test" ? { action: "notify.test", input: {} } : { action: "notify.sample", input: { kind, ...(live ? { live } : {}), ...(gated ? { gated } : {}) } };
const r = await fetch(`${origin}/api/action`, { method: "POST", headers: { "content-type": "application/json", cookie, origin }, body: JSON.stringify(body) });
const j = await r.json();
console.log(j.ok ? `sent ${kind}` : `refused: ${j.error}`);
process.exit(j.ok ? 0 : 1);
