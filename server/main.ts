// Start Coopilot: local server on 127.0.0.1, per-launch token, opens a Chromium app window.
// Usage: node server/main.ts [--dev] [--no-open] [--port 5317] [--clock <ISO instant>]
// --clock (verification runs only): the server's clock starts at that instant and runs forward from there.
import { createHostBrowsers } from "./host.ts";
import { hoursOn } from "../week/hours.ts";
import { takeOpenRequest } from "./open-request.ts";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cacheRoot, configPath, loadConfigFile, planDbPath, saveSystemUserId } from "../config/load.ts";
import { writeConfig } from "../config/edit.ts";
import type { DataverseConfig, GoogleConfig, OutlookConfig } from "../config/schema.ts";
import { stderrLogger } from "../log/logger.ts";
import { clearWritePat, deleteSecret, getSecret, getWritePat, secretState, setAppSecret, setSecret, setWritePat } from "../secrets/keyring.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
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
import { createDemoContext, seedDemo, type DemoControl } from "./demo.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { existsSync } from "node:fs";
import { calendarRefreshDue, checkTimer, notifyWithActions, playEndSound } from "./timer.ts";
import { refreshTodayWarnings } from "../actions/warnings.ts";
import { TIMER_KEY, timerAction, timerLike } from "../actions/timer-actions.ts";
import { DEFAULT_FOCUS } from "../plan/focussound.ts";
import { mediaControl } from "./media.ts";
import type { TimerState } from "../plan/timer.ts";
import { CHECKIN_MESSAGE, CLOSEOUT_MESSAGE, checkDayReminder, checkinReminderDue, checkReminder, checkWeekNudges, closeoutReminderDue, notifySend } from "./notify.ts";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const open = !args.includes("--no-open");
const portArg = args.indexOf("--port");
const port = portArg >= 0 ? Number(args[portArg + 1]) : 5317;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be 1024-65535");
const clockArg = args.indexOf("--clock");
const clockOffsetMs = clockArg >= 0 ? Temporal.Instant.from(args[clockArg + 1] ?? "").epochMilliseconds - Date.now() : 0;
/** The server's clock: real time, or a pinned start running forward (--clock). */
const instantNow = () => (clockOffsetMs ? Temporal.Instant.fromEpochMilliseconds(Date.now() + clockOffsetMs) : Temporal.Now.instant());
const zonedNow = (tz: string) => instantNow().toZonedDateTimeISO(tz);

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
  plan = createPlanStore({ path: planDbPath(), now: () => zonedNow(timeZone) });
} catch {
  log({ source: "plan", op: "open", kind: "failed" });
}

let devMiddleware: Parameters<typeof createApp>[0]["devMiddleware"];
if (dev) {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, configFile: join(root, "vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "spa" });
  devMiddleware = vite.middlewares;
}

/** Media control for focus (step 10): playerctl when installed, playlist links through xdg-open. */
const media = mediaControl();

// Demo mode (step 15, D272): a flag file next to the plan store; the demo context is built (and seeded) on demand.
const demoFlag = join(dirname(planDbPath()), "demo-mode");
let demoCtx: ActionContext | null = null;
const demoControl = (on: boolean): DemoControl => ({ on, set: async (v) => setDemo(v) });
async function setDemo(on: boolean): Promise<void> {
  if (on) {
    if (!demoCtx) {
      const ctx = createDemoContext({ now: () => instantNow().toString(), demo: demoControl(true) });
      await seedDemo(ctx);
      demoCtx = ctx;
    }
    await mkdir(dirname(demoFlag), { recursive: true, mode: 0o700 });
    await writeFile(demoFlag, "on\n", { mode: 0o600 });
    log({ source: "plan", op: "demo", kind: "on" });
  } else {
    await rm(demoFlag, { force: true });
    demoCtx?.plan?.close();
    demoCtx = null;
    log({ source: "plan", op: "demo", kind: "off" });
  }
}
if (existsSync(demoFlag)) await setDemo(true).catch(() => log({ source: "plan", op: "demo", kind: "failed" }));
/** The plan store the timer ticks on: the demo one while demo mode is on. */
const activePlan = () => demoCtx?.plan ?? plan;

const server = createApp({
  port,
  token,
  log,
  // COOPILOT_DIST: a verification build elsewhere, so checking work never swaps the UI the service serves.
  ...(devMiddleware ? { devMiddleware } : { distDir: process.env.COOPILOT_DIST ?? join(root, "dist") }),
  takeOpenRequest: () => takeOpenRequest(runtimeDir),
  ctx: () => demoCtx ?? liveCtx,
});
const liveCtx: ActionContext = {
    demo: demoControl(false),
    loadConfig,
    makeDataverse,
    makeOutlook,
    makeGoogle,
    makeDevOps,
    saveSystemUserId: (id) => saveSystemUserId(cfgPath, id),
    writeConfig: (edit) => writeConfig(cfgPath, edit),
    now: () => instantNow().toString(),
    ...(plan ? { plan } : {}),
    launch: launchDetached,
    media,
    secrets: { state: (a) => secretState(a), set: (a, v) => setAppSecret(a, v) },
    // Step 14: personal DevOps write PATs (keyring, stdin only) and the writer (dev.azure.com of one client per call).
    writePats: { get: (k) => getWritePat(k), set: (k, v) => setWritePat(k, v), clear: (k) => clearWritePat(k) },
    devopsWriter: createDevOpsWriter({ fetch, log }),
    // Browser .desktop entries and Local State only; profile names are all that is kept.
    host: createHostBrowsers({
      readText: (path) => {
        try {
          return readFileSync(path, "utf8");
        } catch {
          return null;
        }
      },
      home: homedir(),
    }),
    exportPlan: async (json) => {
      const out = exportPath(dirname(planDbPath()), new Date().toISOString());
      await mkdir(dirname(out), { recursive: true, mode: 0o700 });
      await writeFile(out, json, { mode: 0o600 });
      await chmod(out, 0o600);
      return out;
    },
};

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
  const configOrNull = async () => {
    const r = await loadConfig();
    return r.parsed.ok ? r.parsed.config : null;
  };
  const tick = () =>
    checkReminder({
      now: () => zonedNow(timeZone),
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
  // Check-in and Close out (step 7): once a day each, the same way.
  const hoursOrNull = async () => (await configOrNull())?.week.hours ?? null;
  const ptoOff = async (d: string) => {
    const c = await configOrNull();
    if (!c?.dataverse.mySystemUserId) return false;
    return (await makeDataverse(c.dataverse, c.week.hours.timeZone).pto(d, d)).items.some((e) => e.date === d);
  };
  const dayReminders = () => {
    void checkDayReminder({
      now: () => zonedNow(timeZone),
      hours: hoursOrNull,
      due: async (n, m) => checkinReminderDue(n, m, !!store.day(n.toPlainDate().toString())?.committedAt, (await configOrNull())?.plan.checkinReminderMinutes ?? 0),
      off: ptoOff,
      once: (d) => store.markOnce("checkin_reminder", d),
      send: () => {
        notifySend("Coopilot", CHECKIN_MESSAGE);
        log({ source: "plan", op: "checkin_reminder", kind: "sent" });
      },
    }).catch(() => log({ source: "plan", op: "checkin_reminder", kind: "failed" }));
    void checkDayReminder({
      now: () => zonedNow(timeZone),
      hours: hoursOrNull,
      due: async (n, m) => closeoutReminderDue(n, m, !!store.day(n.toPlainDate().toString())?.closedOutAt, (await configOrNull())?.plan.closeoutReminderMinutes ?? 15),
      off: ptoOff,
      once: (d) => store.markOnce("closeout_reminder", d),
      send: () => {
        notifySend("Coopilot", CLOSEOUT_MESSAGE);
        log({ source: "plan", op: "closeout_reminder", kind: "sent" });
      },
    }).catch(() => log({ source: "plan", op: "closeout_reminder", kind: "failed" }));
    // Plan the week nudges (step 8): once per nudge and week, while that week isn't committed.
    void checkWeekNudges({
      now: () => zonedNow(timeZone),
      times: async () => {
        const c = await configOrNull();
        return c ? { thu: c.plan.weekNudgeThu, fri: c.plan.weekNudgeFri, mon: c.plan.weekNudgeMon } : null;
      },
      committed: (w) => !!store.weekPlan(w).committedAt,
      off: ptoOff,
      workStart: async (d) => {
        const h = await hoursOrNull();
        return h ? (hoursOn(h, d).segments[0]?.start ?? null) : null;
      },
      once: (key, w) => store.markOnce(key, w),
      send: (body) => {
        notifySend("Coopilot", body);
        log({ source: "plan", op: "week_nudge", kind: "sent" });
      },
    }).catch(() => log({ source: "plan", op: "week_nudge", kind: "failed" }));
  };
  // No reminders while demo mode is on (D272): the demo shouldn't pop real nudges.
  setInterval(() => {
    if (demoCtx) return;
    void tick();
    dayReminders();
  }, 30_000).unref();
  void tick();

  // The focus timer (step 6c): ends sessions on time and warns 5 minutes ahead, window open or not.
  const timerTick = () =>
    checkTimer({
      plan: activePlan() ?? store,
      now: () => instantNow(),
      endSound: async () => (await configOrNull())?.plan.endSound ?? false,
      notify: notifyWithActions,
      sound: playEndSound,
      act: (action) => timerAction({ plan: activePlan() ?? store, config: configOrNull, now: () => instantNow().toString(), media }, action, {}),
      // Step 10: a session that ends on its own pauses media too (when Settings > Focus asks for it).
      ended: async (before, after) => void (await media.transition(timerLike(before), timerLike(after), ((await configOrNull())?.focus ?? DEFAULT_FOCUS).pauseMedia)),
    })
      .then((did) => did && log({ source: "plan", op: "timer", kind: did }))
      .catch(() => log({ source: "plan", op: "timer", kind: "failed" }));
  // Fresher warnings (step 6d): while a timer runs, reload today's calendars every 5 minutes (their own cache
  // decides whether that is a live call) and recompute today's warning points.
  let lastCalendar: number | null = null;
  const warningsTick = () => {
    if (demoCtx) return void (lastCalendar = null);
    const s = store.getState<TimerState>(TIMER_KEY);
    const t = Date.now();
    if (!s?.runningSince) return void (lastCalendar = null);
    if (!calendarRefreshDue(s, lastCalendar, t)) return;
    lastCalendar = t;
    void refreshTodayWarnings({ loadConfig, makeOutlook, makeGoogle, plan: store, now: () => instantNow().toString() })
      .then((n) => n !== null && log({ source: "plan", op: "warnings", kind: "refreshed", count: n }))
      .catch(() => log({ source: "plan", op: "warnings", kind: "failed" }));
  };
  setInterval(() => {
    void timerTick();
    warningsTick();
  }, 5_000).unref();
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
