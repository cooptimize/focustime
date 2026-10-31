// Open the Coopilot app window for a running server (the systemd service or npm start).
// Waits up to 60 s for the server's private launch file, checks the server answers, then starts Chromium.
// The launch URL holds the per-launch token, so it is never printed.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const launchFile = join(process.env.XDG_RUNTIME_DIR || tmpdir(), "coopilot", "launch.json");
const deadline = Date.now() + 60_000;

async function ready(): Promise<string | null> {
  try {
    const { url, pid } = JSON.parse(readFileSync(launchFile, "utf8")) as { url: string; pid: number };
    process.kill(pid, 0); // throws if that server is gone (stale file)
    const u = new URL(url);
    if (u.hostname !== "127.0.0.1") return null;
    const r = await fetch(`${u.origin}/`, { signal: AbortSignal.timeout(2000) });
    return r.status < 500 ? url : null;
  } catch {
    return null;
  }
}

let url: string | null = null;
while (!(url = await ready())) {
  if (Date.now() > deadline) {
    console.error("Coopilot server is not running. Start it with: systemctl --user start coopilot (or npm start)");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
spawn("chromium", [`--app=${url}`], { detached: true, stdio: "ignore" }).unref();
