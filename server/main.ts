// Start Coopilot: local server on 127.0.0.1, per-launch token, opens a Chromium app window.
// Usage: node server/main.ts [--dev] [--no-open] [--port 5317]
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cacheRoot, configPath, loadConfigFile, saveSystemUserId } from "../config/load.ts";
import type { DataverseConfig, GoogleConfig, OutlookConfig } from "../config/schema.ts";
import { stderrLogger } from "../log/logger.ts";
import { deleteSecret, getSecret, setSecret } from "../secrets/keyring.ts";
import type { CalendarSource } from "../sources/calendar/source.ts";
import { createDataverseSource, type DataverseSource } from "../sources/dataverse/source.ts";
import { createGoogleSource } from "../sources/google/source.ts";
import { createOutlookSource } from "../sources/graph/source.ts";
import type { Keyring } from "../sources/oauth/oauth.ts";
import { createApp } from "./app.ts";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const open = !args.includes("--no-open");
const portArg = args.indexOf("--port");
const port = portArg >= 0 ? Number(args[portArg + 1]) : 5317;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be 1024-65535");

const root = resolve(import.meta.dirname, "..");
const token = randomBytes(32).toString("base64url");
const cfgPath = configPath();
const log = stderrLogger;

// One Dataverse source per distinct config, so the in-memory token and results survive between requests.
const sources = new Map<string, DataverseSource>();
const makeDataverse = (cfg: DataverseConfig, timeZone: string) => {
  const key = JSON.stringify([cfg, timeZone]);
  let s = sources.get(key);
  if (!s) {
    s = createDataverseSource({ config: cfg, timeZone, getSecret: () => getSecret("dataverse-client-secret"), fetch, cacheDir: cacheRoot(), log });
    sources.set(key, s);
  }
  return s;
};

// Calendar sources: one instance per config so access tokens and results stay in memory.
const keyring: Keyring = { get: (a) => getSecret(a), set: (a, v) => setSecret(a, v), delete: (a) => deleteSecret(a) };
/** Opens the sign-in page in the default browser. The URL holds no secret (client ID, PKCE challenge, state). */
const openBrowser = async (url: string) => {
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
};
const calendars = new Map<string, CalendarSource>();
function memo(kind: "outlook" | "google", cfg: OutlookConfig | GoogleConfig, timeZone: string, make: () => CalendarSource) {
  const key = JSON.stringify([kind, cfg, timeZone]);
  let s = calendars.get(key);
  if (!s) calendars.set(key, (s = make()));
  return s;
}
const calendarDeps = (timeZone: string) => ({ fetch, keyring, openBrowser, cacheDir: cacheRoot(), log, timeZone });
const makeOutlook = (cfg: OutlookConfig, timeZone: string) => memo("outlook", cfg, timeZone, () => createOutlookSource({ ...calendarDeps(timeZone), config: cfg }));
const makeGoogle = (cfg: GoogleConfig, timeZone: string) => memo("google", cfg, timeZone, () => createGoogleSource({ ...calendarDeps(timeZone), config: cfg }));

let devMiddleware: Parameters<typeof createApp>[0]["devMiddleware"];
if (dev) {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, configFile: join(root, "vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "spa" });
  devMiddleware = vite.middlewares;
}

const server = createApp({
  port,
  token,
  log,
  ...(devMiddleware ? { devMiddleware } : { distDir: join(root, "dist") }),
  ctx: {
    loadConfig: () => loadConfigFile(cfgPath),
    makeDataverse,
    makeOutlook,
    makeGoogle,
    saveSystemUserId: (id) => saveSystemUserId(cfgPath, id),
    now: () => Temporal.Now.instant().toString(),
  },
});

const runtimeDir = join(process.env.XDG_RUNTIME_DIR || tmpdir(), "coopilot");
const launchFile = join(runtimeDir, "launch.json");

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Coopilot is already running on port ${port}. Use that window, or stop the other copy first.`);
    process.exit(1);
  }
  throw e;
});
server.listen(port, "127.0.0.1", async () => {
  const url = `http://127.0.0.1:${port}/?token=${token}`;
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await writeFile(launchFile, JSON.stringify({ url, pid: process.pid }), { mode: 0o600 });
  // The launch URL holds the per-launch token, so it goes to a private file, not the terminal.
  process.stdout.write(`Coopilot running on http://127.0.0.1:${port} (${dev ? "dev" : "built"} UI)\nConfig: ${cfgPath}\nLaunch link: ${launchFile}\n`);
  if (open) spawn("chromium", [`--app=${url}`], { detached: true, stdio: "ignore" }).unref();
});

const stop = async () => {
  await rm(launchFile, { force: true });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
