// Start Coopilot: local server on 127.0.0.1, per-launch token, opens a Chromium app window.
// Usage: node server/main.ts [--dev] [--no-open] [--port 5317]
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cacheRoot, configPath, loadConfigFile, planDbPath, saveSystemUserId } from "../config/load.ts";
import { writeConfig } from "../config/edit.ts";
import type { DataverseConfig, GoogleConfig, OutlookConfig } from "../config/schema.ts";
import { stderrLogger } from "../log/logger.ts";
import { deleteSecret, getSecret, secretState, setAppSecret, setSecret } from "../secrets/keyring.ts";
import { readFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { exportPath } from "../actions/settings-actions.ts";
import type { CalendarSource } from "../sources/calendar/source.ts";
import { createDataverseSource, type DataverseSource } from "../sources/dataverse/source.ts";
import { createGoogleSource } from "../sources/google/source.ts";
import { createOutlookSource } from "../sources/graph/source.ts";
import { createDevOpsSource, type DevOpsSource } from "../sources/devops/source.ts";
import type { Keyring } from "../sources/oauth/oauth.ts";
import { createPlanStore, type PlanStore } from "../store/plan-store.ts";
import { createApp } from "./app.ts";
import { checkTimer, notifyWithActions, playEndSound } from "./timer.ts";
import { timerAction } from "../actions/timer-actions.ts";
import { checkReminder, notifySend } from "./notify.ts";

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

// DevOps: one source per Dataverse config. PATs come from Dataverse per fetch (devopsTargets) and are not kept.
const devopsSources = new Map<string, DevOpsSource>();
const makeDevOps = (cfg: DataverseConfig, timeZone: string) => {
  const key = JSON.stringify([cfg, timeZone]);
  let s = devopsSources.get(key);
  if (!s) {
    const dv = makeDataverse(cfg, timeZone);
    s = createDevOpsSource({ fetch, log, cacheDir: cacheRoot(), timeZone, targets: (keys) => dv.devopsTargets(keys), pickableTypes: () => pickableTypes, openStates: (k) => openStates[k] ?? [] });
    devopsSources.set(key, s);
  }
  return s;
};

// Local plan store (step 5). Its clock follows the configured day shape time zone. If it can't open,
// the week view still works and the plan actions say the store is unavailable.
let timeZone = "America/New_York";
let pickableTypes: string[] = [];
let openStates: Record<string, string[]> = {};
const loadConfig = async () => {
  const r = await loadConfigFile(cfgPath);
  if (r.parsed.ok) {
    timeZone = r.parsed.config.week.hours.timeZone;
    pickableTypes = r.parsed.config.plan.pickablePortfolioTypes;
    openStates = Object.fromEntries(Object.entries(r.parsed.config.clientSettings).map(([k, v]) => [k, v.openStates]));
  }
  return r;
};
await loadConfig().catch(() => null);
let plan: PlanStore | undefined;
try {
  plan = createPlanStore({ path: planDbPath(), now: () => Temporal.Now.zonedDateTimeISO(timeZone) });
} catch {
  log({ source: "plan", op: "open", kind: "failed" });
}

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
    loadConfig,
    makeDataverse,
    makeOutlook,
    makeGoogle,
    makeDevOps,
    saveSystemUserId: (id) => saveSystemUserId(cfgPath, id),
    writeConfig: (edit) => writeConfig(cfgPath, edit),
    now: () => Temporal.Now.instant().toString(),
    ...(plan ? { plan } : {}),
    launch: launchDetached,
    secrets: { state: (a) => secretState(a), set: (a, v) => setAppSecret(a, v) },
    // Browser .desktop entries and Local State only; profile names are all that is kept.
    readText: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    home: homedir(),
    exportPlan: async (json) => {
      const out = exportPath(dirname(planDbPath()), new Date().toISOString());
      await mkdir(dirname(out), { recursive: true, mode: 0o700 });
      await writeFile(out, json, { mode: 0o600 });
      await chmod(out, 0o600);
      return out;
    },
  },
});

/** link.open: start a browser from an argument array (no shell), detached, with no output kept. */
function launchDetached(argv: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const [cmd, ...args] = argv;
    if (!cmd) return fail(new Error("empty command"));
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", shell: false });
    child.once("error", () => fail(new Error("could not start")));
    child.once("spawn", () => {
      child.unref();
      ok();
    });
  });
}

// The once-a-day reminder. Checked every 30 s, so it also handles day rollover while running for days.
if (plan) {
  const store = plan;
  const tick = () =>
    checkReminder({
      now: () => Temporal.Now.zonedDateTimeISO(timeZone),
      hours: async () => {
        const r = await loadConfig();
        return r.parsed.ok ? r.parsed.config.week.hours : null;
      },
      offsetMinutes: async () => {
        const r = await loadConfig();
        return r.parsed.ok ? r.parsed.config.plan.reminderOffsetMinutes : 0;
      },
      committed: (d) => !!store.day(d)?.committedAt,
      off: async (d) => {
        const r = await loadConfig();
        if (!r.parsed.ok || !r.parsed.config.dataverse.mySystemUserId) return false;
        const pto = await makeDataverse(r.parsed.config.dataverse, r.parsed.config.week.hours.timeZone).pto(d, d);
        return pto.items.some((e) => e.date === d);
      },
      once: (d) => store.markOnce("reminder", d),
      send: (title, body) => {
        notifySend(title, body);
        log({ source: "plan", op: "reminder", kind: "sent" });
      },
    }).catch(() => log({ source: "plan", op: "reminder", kind: "failed" }));
  setInterval(tick, 30_000).unref();
  void tick();

  // The focus timer (step 6c): ends sessions on time and warns 5 minutes ahead, window open or not.
  const configOrNull = async () => {
    const r = await loadConfig();
    return r.parsed.ok ? r.parsed.config : null;
  };
  const timerTick = () =>
    checkTimer({
      plan: store,
      now: () => Temporal.Now.instant(),
      endSound: async () => (await configOrNull())?.plan.endSound ?? false,
      notify: notifyWithActions,
      sound: playEndSound,
      act: (action) => timerAction({ plan: store, config: configOrNull, now: () => Temporal.Now.instant().toString() }, action, {}),
    })
      .then((did) => did && log({ source: "plan", op: "timer", kind: did }))
      .catch(() => log({ source: "plan", op: "timer", kind: "failed" }));
  setInterval(timerTick, 5_000).unref();
  void timerTick();
}

const runtimeDir = join(process.env.XDG_RUNTIME_DIR || tmpdir(), "coopilot");
const launchFile = join(runtimeDir, "launch.json");

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Coopilot is already running on port ${port} (perhaps as the coopilot service). Open its window with: node scripts/open-window.ts`);
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
  plan?.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
