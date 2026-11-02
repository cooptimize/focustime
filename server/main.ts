// Start Coopilot: local server on 127.0.0.1, per-launch token, opens a Chromium app window.
// Usage: node server/main.ts [--dev] [--no-open] [--no-reopen] [--port 5317] [--clock <ISO instant>]
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
import type { AppConfig, DataverseConfig, GoogleConfig, OutlookConfig } from "../config/schema.ts";
import type { MicrosoftAccount } from "../actions/account.ts";
import { vmContext } from "../actions/dispatch.ts";
import { restoreTick, vmAction, type VmStatus } from "../actions/vm-actions.ts";
import { CHECKIN_DONE_MARK } from "../actions/closeout-actions.ts";
import { createAzureClient } from "../sources/azure/client.ts";
import { localToday } from "../week/dates.ts";
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
import { calendarRefreshDue, checkTimer, playEndSound, TIMER_BUTTONS } from "./timer.ts";
import { refreshTodayWarnings } from "../actions/warnings.ts";
import { TIMER_KEY, timerAction, timerLike } from "../actions/timer-actions.ts";
import { DEFAULT_FOCUS } from "../plan/focussound.ts";
import { mediaControl } from "./media.ts";
import type { TimerState } from "../plan/timer.ts";
import { checkDayReminder, checkinReminderDue, checkReminder, checkWeekNudges, closeDesktopNotification, closeoutReminderDue, desktopNotify, notifySend } from "./notify.ts";
import { DEFAULT_NOTIFY, dueFollowUps, inWorkingHours, noticeDone, notices, parseRoute, type Notice } from "../plan/notify.ts";
import { createNotifier } from "../actions/notifier.ts";
import { expiringFor } from "../actions/dispatch.ts";
import { mondayOf } from "../week/dates.ts";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const open = !args.includes("--no-open");
/** --headless (the browser tests): no desktop notifications and no windows opened by the server. */
const headless = args.includes("--headless");
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
function memo<T extends CalendarSource>(kind: "outlook" | "google", cfg: OutlookConfig | GoogleConfig, timeZone: string, make: () => T): T {
  const key = JSON.stringify([kind, cfg, timeZone]);
  let s = calendars.get(key) as T | undefined;
  if (!s) calendars.set(key, (s = make()));
  return s;
}
const calendarDeps = (timeZone: string) => ({ fetch, keyring, openBrowser, cacheDir: cacheRoot(), log, timeZone });
const makeOutlook = (cfg: OutlookConfig, timeZone: string) => memo("outlook", cfg, timeZone, () => createOutlookSource({ ...calendarDeps(timeZone), config: cfg }));
/**
 * Step 15.4: the Microsoft sign-in is the Outlook source's auth client (one refresh token, one keyring entry); the
 * app's user, the calendar and the Azure token all come from it.
 */
const accountFor = (cfg: AppConfig): MicrosoftAccount | null => {
  if (!cfg.outlook) return null;
  const src = makeOutlook(cfg.outlook, cfg.week.hours.timeZone);
  return {
    signIn: (o) => src.connect(o),
    identity: () => src.auth.identity(),
    armToken: () => src.auth.accessToken("arm"),
    writeAccess: () => src.auth.writeAccess(),
    signOut: () => src.disconnect(),
  };
};
const azureFor = (token: () => Promise<string>) => createAzureClient({ fetch, token, log });
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
  // The launcher's request (capture), else the view a clicked notification asked for (step 15.5), taken once.
  takeOpenRequest: async () => (await takeOpenRequest(runtimeDir)) ?? takeRoute(),
  reopen: reopenWindow,
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
    account: accountFor,
    azure: azureFor,
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

/**
 * Step 15.5: clicking a notification opens Coopilot on its view. The route waits here (validated, 2 minutes) for the
 * window to take it when it loads or gains focus; coopilot-open focuses the window or opens one.
 */
let pendingRoute: { route: string; at: number } | null = null;
function openRoute(route: string): void {
  if (!parseRoute(route)) return;
  pendingRoute = { route, at: Date.now() };
  log({ source: "plan", op: "notify_route", kind: route.split(":")[0]! });
  void reopenWindow().then((ok) => log({ source: "plan", op: "notify_window", kind: ok ? "opened" : "unavailable" }));
}
function takeRoute(): string | null {
  const p = pendingRoute;
  pendingRoute = null;
  const r = p && Date.now() - p.at < 120_000 ? p.route : null;
  if (r) log({ source: "plan", op: "notify_route", kind: "taken" });
  return r;
}

/**
 * Step 15.4 fix (host adapter): "Reopen Coopilot" from a window whose launch token is old. Under the service,
 * coopilot-open replaces a window opened for an earlier server run; with npm start, a new app window opens with the
 * launch link. --no-reopen (the browser tests) turns it off.
 */
async function reopenWindow(): Promise<boolean> {
  const script = join(homedir(), ".local", "bin", "coopilot-open");
  if (headless || args.includes("--no-reopen")) return false;
  const argv = process.env.INVOCATION_ID && existsSync(script) ? [script] : open ? ["chromium", `--app=http://127.0.0.1:${port}/?token=${token}`] : null;
  if (!argv) return false;
  return launchDetached(argv).then(() => true, () => false);
}

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

// Notifications (step 15.5): every reminder, the timer, my VM, follow-ups due and expiring secrets go through one
// notifier, which applies Settings > Notifications (switches, quiet hours, holding during focus) and routes clicks.
// Checked every 30 s (the timer every 5 s), so day rollover is handled while running for days.
if (plan) {
  const store = plan;
  const configOrNull = async () => {
    const r = await loadConfig();
    return r.parsed.ok ? r.parsed.config : null;
  };
  const hoursOrNull = async () => (await configOrNull())?.week.hours ?? null;
  // PTO for a date, kept for 30 minutes (the gate asks every tick; the Dataverse read has its own cache too).
  const ptoMemo = new Map<string, { at: number; off: boolean }>();
  const ptoOff = async (d: string) => {
    const hit = ptoMemo.get(d);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.off;
    const c = await configOrNull();
    if (!c?.dataverse.mySystemUserId) return false;
    const off = (await makeDataverse(c.dataverse, c.week.hours.timeZone).pto(d, d)).items.some((e) => e.date === d);
    ptoMemo.set(d, { at: Date.now(), off });
    return off;
  };
  const focusRunning = () => {
    const s = store.getState<TimerState>(TIMER_KEY);
    return !!s && s.kind === "focus" && !s.ended && !!s.runningSince;
  };
  const todayOf = (c: AppConfig) => localToday(instantNow().toString(), c.week.hours.timeZone);
  const vmCtx = () => vmContext(liveCtx);
  const icon = existsSync(join(root, "system", "coopilot-icon.png")) ? join(root, "system", "coopilot-icon.png") : null;

  /** A button on a notification: the VM's Start and Restore (the timer's buttons go to checkTimer). */
  const act = async (n: Notice, key: string) => {
    const sample = n.key.startsWith("sample:");
    if (n.kind === "vm" && (key === "start" || key === "restore")) {
      // Samples never touch Azure unless asked for live (notify.sample { live: true }): they open the VM menu.
      if (sample && !n.key.startsWith("sample:live:")) return openRoute("vm");
      const r = await vmAction(await vmCtx(), key === "start" ? "vm.start_now" : "vm.restore", {});
      log({ source: "azure", op: key === "start" ? "notify_start" : "notify_restore", kind: r.ok ? "ok" : (r.code ?? "refused") });
      // Start asks first (Settings > You), or it couldn't: open the VM menu, where the preview and the reason show.
      if (!r.ok) {
        openRoute("vm");
        if (r.code !== "ask_first") notifySend("Coopilot", `Couldn't ${key === "start" ? "start your VM" : "restore auto-shutdown"}: ${r.error}.`);
      }
    }
  };
  /** Whether a held notification still matters when focus ends. */
  const still = async (n: Notice) => {
    const c = await configOrNull();
    if (!c) return true;
    const today = todayOf(c);
    if (n.kind === "plan_day") return !store.day(today)?.committedAt;
    if (n.kind === "closeout") return !store.day(today)?.closedOutAt;
    if (n.kind === "checkin") return !!store.day(today)?.committedAt && !store.day(today)?.closedOutAt;
    if (n.kind === "plan_week" || n.kind === "look_ahead") return !store.weekPlan(n.route.slice("planweek:".length)).committedAt;
    if (n.kind === "followups") return dueFollowUps(store.openFollowUps(), today).length > 0;
    if (n.kind === "vm" && n.key.startsWith("vm_off:")) {
      const st = await vmAction(await vmCtx(), "vm.status", {});
      return st.ok && (st.data as VmStatus).prompt;
    }
    return true;
  };
  /** Q91: whether a shown notification's occasion was handled since (it is then closed). The VM is read at most once a minute. */
  let vmSeen: { at: number; st: VmStatus | null } | null = null;
  const vmNow = async () => {
    if (vmSeen && Date.now() - vmSeen.at < 60_000) return vmSeen.st;
    const r = await vmAction(await vmCtx(), "vm.status", {}).catch(() => null);
    vmSeen = { at: Date.now(), st: r?.ok ? (r.data as VmStatus) : null };
    return vmSeen.st;
  };
  const done = async (n: Notice) => {
    const c = await configOrNull();
    const today = c ? todayOf(c) : null;
    const vs = n.kind === "vm" ? await vmNow() : null;
    return noticeDone(n, {
      committed: (d) => !!store.day(d)?.committedAt,
      checkedIn: (d) => store.marked(CHECKIN_DONE_MARK, d),
      closedOut: (d) => !!store.day(d)?.closedOutAt,
      weekCommitted: (w) => !!store.weekPlan(w).committedAt,
      followUpOpen: (id) => store.openFollowUps().some((f) => f.id === id && !f.closedAt),
      dueCount: () => (today ? dueFollowUps(store.openFollowUps(), today).length : 1),
      timerWaiting: (startedAt) => {
        const t = store.getState<TimerState>(TIMER_KEY);
        return !!t && t.ended && t.startedAt === startedAt;
      },
      vmOff: () => (vs ? vs.prompt : null),
      vmChanged: () => (vs ? !!vs.change : null),
    });
  };
  const notifier = createNotifier({
    plan: store,
    host: { show: (n, shown) => (headless ? Promise.resolve(null) : desktopNotify(n, icon, shown)), close: closeDesktopNotification },
    done,
    facts: async () => {
      const c = await configOrNull();
      const settings = c?.notify ?? DEFAULT_NOTIFY;
      if (!c) return { settings, inHours: false, pto: false, focusRunning: focusRunning() };
      const today = todayOf(c);
      return { settings, inHours: inWorkingHours(c.week.hours, zonedNow(c.week.hours.timeZone)), pto: await ptoOff(today).catch(() => false), focusRunning: focusRunning() };
    },
    now: () => instantNow().toString(),
    open: (route) => openRoute(route),
    act,
    still,
    log: (op, kind) => log({ source: "plan", op, kind }),
  });

  // Settings > Notifications > Send a test notification, and one sample per kind for the live check.
  const samples = (c: AppConfig, live: boolean): Record<string, Notice | null> => {
    const at = instantNow().toString();
    const today = todayOf(c);
    const monday = Temporal.PlainDate.from(today).subtract({ days: Temporal.PlainDate.from(today).dayOfWeek - 1 });
    const pfx = (n: Notice | null): Notice | null => (n ? { ...n, key: `sample:${live ? "live:" : ""}${n.key}:${at}` } : null);
    const open = dueFollowUps(store.openFollowUps(), today);
    return {
      plan_day: pfx(notices.planDay(today, at)),
      checkin: pfx(notices.checkin(today, at)),
      closeout: pfx(notices.closeout(today, at)),
      plan_week: pfx(notices.week(monday.toString(), true, at)),
      look_ahead: pfx(notices.week(monday.add({ days: 7 }).toString(), false, at)),
      timer: pfx(notices.timerEnd(false, "Sample: a focus session", at, at)),
      meeting: pfx(notices.meeting(["Sample: a meeting at 10:00"], ["sample"], at)),
      vm: pfx(notices.vmOff(today, live ? "Your VM" : "Your VM (sample: Start opens the VM menu)", at)),
      vm_changed: pfx(notices.vmChanged(today, live ? "Auto-shutdown set to 9:00 PM" : "Sample: auto-shutdown set to 9:00 PM (Restore opens the VM menu)", at)),
      // With none due, a made-up one that opens the Inbox (there is no follow-up to open).
      followups: pfx(open.length ? notices.followUps(today, open, at) : { ...notices.followUps(today, [{ id: 1, what: "Sample: reply about the proposal", overdue: false }], at)!, route: "inbox" }),
      expiry: pfx(notices.expiry(today, [{ text: "Sample: a DevOps write access expires in 9 days. Update in Settings", section: "clients" }], at)),
    };
  };
  liveCtx.notifications = {
    test: () => notifier.test(),
    sample: async (kind, live, gated) => {
      const c = await configOrNull();
      const n = c ? samples(c, live)[kind] : null;
      if (!n) return false;
      // Gated: through Settings > Notifications like a real one (switch, quiet hours, held during focus).
      if (gated) {
        await notifier.refresh();
        log({ source: "plan", op: "notify_sample", kind: await notifier.offer(n) });
        return true;
      }
      // A sample's timer buttons run the real timer actions (local; refused when no timer has ended).
      notifier.show(n, n.kind === "timer" ? async (key) => void (key in TIMER_BUTTONS && (await timerAction(timerCtx(), TIMER_BUTTONS[key as keyof typeof TIMER_BUTTONS], {}).catch(() => null))) : undefined);
      return true;
    },
  };

  const send = (n: Notice | null) => (n ? notifier.offer(n).catch(() => log({ source: "plan", op: "notify", kind: "failed" })) : undefined);
  const dayReminders = async () => {
    const c = await configOrNull();
    if (!c) return;
    const at = instantNow().toString();
    await checkReminder({
      now: () => zonedNow(timeZone),
      hours: hoursOrNull,
      offsetMinutes: async () => c.plan.reminderOffsetMinutes,
      committed: (d) => !!store.day(d)?.committedAt,
      off: ptoOff,
      once: (d) => notifier.allows("plan_day") && store.markOnce("reminder", d),
      send: () => void send(notices.planDay(todayOf(c), at)),
    }).catch(() => log({ source: "plan", op: "reminder", kind: "failed" }));
    // Check-in and Close out (step 7): once a day each.
    await checkDayReminder({
      now: () => zonedNow(timeZone),
      hours: hoursOrNull,
      due: (n, m) => checkinReminderDue(n, m, !!store.day(n.toPlainDate().toString())?.committedAt, c.plan.checkinReminderMinutes),
      off: ptoOff,
      once: (d) => notifier.allows("checkin") && store.markOnce("checkin_reminder", d),
      send: () => void send(notices.checkin(todayOf(c), at)),
    }).catch(() => log({ source: "plan", op: "checkin_reminder", kind: "failed" }));
    await checkDayReminder({
      now: () => zonedNow(timeZone),
      hours: hoursOrNull,
      due: (n, m) => closeoutReminderDue(n, m, !!store.day(n.toPlainDate().toString())?.closedOutAt, c.plan.closeoutReminderMinutes),
      off: ptoOff,
      once: (d) => notifier.allows("closeout") && store.markOnce("closeout_reminder", d),
      send: () => void send(notices.closeout(todayOf(c), at)),
    }).catch(() => log({ source: "plan", op: "closeout_reminder", kind: "failed" }));
    // Plan the week (Monday, this week) and Look ahead (Thursday and Friday, next week), step 8.
    const thisWeek = mondayOf(todayOf(c));
    await checkWeekNudges({
      now: () => zonedNow(timeZone),
      times: async () => ({ thu: c.plan.weekNudgeThu, fri: c.plan.weekNudgeFri, mon: c.plan.weekNudgeMon }),
      committed: (w) => !!store.weekPlan(w).committedAt,
      off: ptoOff,
      workStart: async (d) => hoursOn(c.week.hours, d).segments[0]?.start ?? null,
      once: (key, w) => notifier.allows(w === thisWeek ? "plan_week" : "look_ahead") && store.markOnce(key, w),
      send: (_body, w) => void send(notices.week(w, w === thisWeek, at)),
    }).catch(() => log({ source: "plan", op: "week_nudge", kind: "failed" }));
  };
  // Once a workday from work start (working hours, not PTO): follow-ups due or overdue, and expiring secrets.
  const workdayNotices = async () => {
    const c = await configOrNull();
    if (!c) return;
    const today = todayOf(c);
    const ws = hoursOn(c.week.hours, today).segments[0]?.start ?? null;
    if (!ws || zonedNow(c.week.hours.timeZone).toPlainTime().toString().slice(0, 5) < ws) return;
    const at = instantNow().toString();
    if (notifier.allows("followups") && store.markOnce("followups_notice", today)) await send(notices.followUps(today, dueFollowUps(store.openFollowUps(), today), at));
    if (notifier.allows("expiry") && store.markOnce("expiry_notice", today)) await send(notices.expiry(today, expiringFor(store, c, today), at));
  };
  // My VM (step 15.4): put back a changed auto-shutdown the next morning (first run after midnight, retried, and at work
  // start), and once a workday at work start say so when the VM is off. Never starts anything by itself.
  const vmTick = async () => {
    const c = await configOrNull();
    if (!c) return;
    const tz = c.week.hours.timeZone;
    const n = zonedNow(tz);
    const today = todayOf(c);
    const ws = hoursOn(c.week.hours, today).segments[0]?.start ?? null;
    const afterStart = !!ws && n.toPlainTime().toString().slice(0, 5) >= ws;
    const vc = await vmCtx();
    if (!vc.account) return;
    const atWorkStart = afterStart && store.markOnce("vm_restore_workstart", today);
    const r = await restoreTick(vc, { atWorkStart });
    if (r) log({ source: "azure", op: "shutdown_restore", kind: r });
    const at = instantNow().toString();
    if (r === "failed" && atWorkStart) {
      const st = await vmAction(vc, "vm.status", {});
      await send(notices.vmChanged(today, st.ok ? ((st.data as VmStatus).change?.text ?? "Auto-shutdown is changed") : "Auto-shutdown is changed", at));
    }
    if (afterStart && notifier.allows("vm") && store.markOnce("vm_prompt_notice", today)) {
      const st = await vmAction(vc, "vm.status", {});
      if (st.ok && (st.data as VmStatus).prompt) await send(notices.vmOff(today, (st.data as VmStatus).vm?.name ?? "Your VM", at));
    }
  };
  // No reminders while demo mode is on (D272): the demo shouldn't pop real nudges.
  const tick = async () => {
    if (demoCtx) return;
    await notifier.refresh().catch(() => null);
    await dayReminders();
    await workdayNotices().catch(() => log({ source: "plan", op: "notify", kind: "failed" }));
    await vmTick().catch(() => log({ source: "azure", op: "vm_tick", kind: "failed" }));
  };
  setInterval(() => void tick(), 30_000).unref();
  void tick();

  // The focus timer (step 6c): ends sessions on time and warns 5 minutes ahead, window open or not.
  const timerCtx = () => ({ plan: activePlan() ?? store, config: configOrNull, now: () => instantNow().toString(), media });
  const timerTick = () =>
    checkTimer({
      plan: activePlan() ?? store,
      now: () => instantNow(),
      endSound: async () => (await configOrNull())?.plan.endSound ?? false,
      // Through the notifier (its switch); the buttons come back here, where the session is checked.
      notify: (n) =>
        demoCtx
          ? Promise.resolve(null)
          : new Promise((resolve) => {
              void notifier.offer(n, (key) => resolve(key || null)).then((g) => g !== "send" && resolve(null), () => resolve(null));
            }),
      sound: playEndSound,
      act: (action) => timerAction(timerCtx(), action, {}),
      // Step 10: a session that ends on its own pauses media too (when Settings > Focus asks for it).
      ended: async (before, after) => void (await media.transition(timerLike(before), timerLike(after), ((await configOrNull())?.focus ?? DEFAULT_FOCUS).pauseMedia)),
    })
      .then((did) => did && log({ source: "plan", op: "timer", kind: did }))
      .catch(() => log({ source: "plan", op: "timer", kind: "failed" }));
  // Held notifications go out once the focus session is over (collapsed into one when there are several).
  const flushHeld = async () => {
    if (demoCtx || !notifier.held().length || focusRunning()) return;
    await notifier.refresh();
    const n = await notifier.flush();
    if (n) log({ source: "plan", op: "notify", kind: "held_delivered", count: n });
  };
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
    void flushHeld().catch(() => log({ source: "plan", op: "notify", kind: "failed" }));
    // Q91: close notifications on screen whose occasion was handled (the day planned, the follow-up closed...).
    if (notifier.onScreen().length) void notifier.sweep().catch(() => log({ source: "plan", op: "notify", kind: "failed" }));
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
