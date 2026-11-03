// Start FocusTime: the server (A2: Microsoft sign-in and server-side sessions; the developer loop serves
// http://localhost:<port> and opens an app window on it).
// Usage: node server/main.ts [--dev] [--no-open] [--no-reopen] [--port 5317] [--clock <ISO instant>]
// FOCUSTIME_HOST=local|azure (A1) picks the host: local (the default) is the developer loop on this machine; azure is
// the hosted app's host, a stub until A2 (its secrets, snapshots and plan store are in memory).
// --clock (verification runs only): the server's clock starts at that instant and runs forward from there.
import type { Host, SnapshotStore } from "../host/types.ts";
import { perPerson } from "../host/per-person.ts";
import { createUserSecrets, type UserSecrets } from "../store/user-secrets.ts";
import { Pat } from "../sources/devops/pat.ts";
import { cacheKey } from "../sources/devops/source.ts";
import type { WritePats } from "../actions/devops-write-actions.ts";
import { createLocalHost } from "../host/local/index.ts";
import { createAzureHost } from "../host/azure/index.ts";
import { memoryConfig, memoryPhotos, memorySecrets, memorySnapshots } from "../host/fakes.ts";
import { randomBytes } from "node:crypto";
import { readAppSettings, redirectUris } from "./appconfig.ts";
import { createEntraSignIn, type SignedIn } from "./auth/entra.ts";
import { createAccountStore } from "../store/accounts.ts";
import { createUserSettings, type AppKeys, type UserSettings } from "../store/user-settings.ts";
import { exportUser, hardDeleteDue, HARD_DELETE_AFTER_DAYS, recordSoftDelete } from "../store/user-data.ts";
import { starterToml } from "../config/starter.ts";
import { mailboxZone } from "./auth/mailbox.ts";
import { createPeople } from "./people.ts";
import { personTicks, type PersonTicks } from "./ticks.ts";
import { createScheduler } from "./scheduler.ts";
import { keepRoute, takeRoute } from "./open-route.ts";
import { join, resolve } from "node:path";
import type { AppConfig, DataverseConfig, GoogleConfig, OutlookConfig } from "../config/schema.ts";
import { rememberIdentity, type MicrosoftAccount } from "../actions/account.ts";
import { createPresenceClient, type PresenceClient } from "../sources/graph/presence.ts";
import { createPhotoClient, type PhotoClient } from "../sources/graph/photos.ts";
import { createAzureClient } from "../sources/azure/client.ts";
import { stderrLogger } from "../log/logger.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import type { CalendarSource } from "../sources/calendar/source.ts";
import { createDataverseSource, type DataverseSource } from "../sources/dataverse/source.ts";
import { createGoogleSource } from "../sources/google/source.ts";
import { createOutlookSource } from "../sources/graph/source.ts";
import { createDevOpsSource, type DevOpsSource } from "../sources/devops/source.ts";
import type { Keyring } from "../sources/oauth/oauth.ts";
import { openPlanDb, planStoreOn, type PlanStore } from "../store/plan-store.ts";
import type { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.ts";
import { moveFromOldName } from "../host/local/rename.ts";
import { createDemoContext, seedDemo, type DemoControl } from "./demo.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { userZone } from "../week/zone.ts";

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
const log = stderrLogger;

const hostKind = process.env.FOCUSTIME_HOST ?? "local";
if (hostKind !== "local" && hostKind !== "azure") throw new Error("FOCUSTIME_HOST must be local or azure");
const host: Host =
  hostKind === "azure"
    ? createAzureHost({ secrets: memorySecrets(), config: memoryConfig(), snapshotsFor: perPerson(() => memorySnapshots()), photos: memoryPhotos(), inbox: { add: () => "0", remove: () => {} }, now: instantNow })
    : createLocalHost({ port, headless, open, noReopen: args.includes("--no-reopen"), now: instantNow });

// A2: app-level settings (public URL, the Entra and Google registrations, Dataverse, the demo): env over the host's app
// config. Per-person settings are rows in the plan store.
const appRead = readAppSettings(process.env, await host.config.app().catch(() => null), `http://localhost:${port}`);
if (!appRead.ok) {
  console.error(`FocusTime's app config has problems:\n- ${appRead.errors.join("\n- ")}`);
  process.exit(1);
}
const app = appRead.settings;

// R1: the one-time move from Coopilot's folders and keyring entries, before anything reads config, the store or a secret.
const renamed = host.kind === "local" ? await moveFromOldName({ today: Temporal.Now.plainDateISO().toString(), log: stderrLogger }) : { note: null };
/** Where settings live, for the start line: the config file (local), or in memory (the hosted stub, until A2). */
const cfgPath = host.facts().configPath ?? "in memory";

/**
 * A2: what the server keeps in memory for a signed-in person: their settings and what it uses from them (zone, DevOps
 * choices), their encrypted secrets and their own snapshot cache.
 */
type Person = { userId: string; zone: string; pickableTypes: string[]; openStates: Record<string, string[]>; settings: UserSettings; secrets: UserSecrets; snapshots: SnapshotStore };

// One Dataverse source per person and config, so the in-memory token and results survive between requests.
const sources = new Map<string, DataverseSource>();
const dataverseFor = (who: Person) => (cfg: DataverseConfig, timeZone: string) => {
  const key = JSON.stringify([who.userId, cfg, timeZone]);
  let s = sources.get(key);
  if (!s) {
    s = createDataverseSource({ config: cfg, timeZone, getSecret: () => host.secrets.get("dataverse-client-secret"), fetch, snapshots: who.snapshots, log });
    sources.set(key, s);
  }
  return s;
};

/**
 * A2: a person's keyring for the calendar sign-ins: their refresh tokens from their own encrypted secrets, the app's
 * client secrets (Entra, Google) from the host's secret store. Nothing is written to the host's store from here.
 */
const keyringOf = (who: Person): Keyring => ({
  get: (a) => (a === "outlook-refresh-token" || a === "google-refresh-token" ? who.secrets.get(a) : host.secrets.get(a)),
  set: (a, v) => who.secrets.set(a, v),
  delete: (a) => who.secrets.delete(a),
});
/** Opens a page in the default browser (the old loopback sign-in only; the web sign-in happens in the tab). */
const openBrowser = async (url: string) => void (await host.links.open(url).catch(() => null));
// Calendar sources: one per person and config, so access tokens and results stay in memory, each person's apart.
const calendars = new Map<string, CalendarSource>();
function memo<T extends CalendarSource>(who: Person, kind: "outlook" | "google", cfg: OutlookConfig | GoogleConfig, timeZone: string, make: () => T): T {
  const key = JSON.stringify([who.userId, kind, cfg, timeZone]);
  let s = calendars.get(key) as T | undefined;
  if (!s) calendars.set(key, (s = make()));
  return s;
}
/** A2: forget a person's calendar sources (a new sign-in, a delete): the next use starts from their stored tokens. */
const forgetCalendars = (userId: string) => {
  for (const k of [...calendars.keys()]) if (k.startsWith(`[${JSON.stringify(userId)},`)) calendars.delete(k);
};
const urls = redirectUris(app);
const calendarDeps = (who: Person, timeZone: string) => ({ fetch, keyring: keyringOf(who), openBrowser, loopback: host.loopback, snapshots: who.snapshots, log, timeZone });
/** The Outlook config is the web registration's (the settings put its ids in): sign-in through the server's routes. */
const isWebApp = (cfg: OutlookConfig) => !!app.entra && cfg.clientId === app.entra.clientId;
const outlookFor = (who: Person) => (cfg: OutlookConfig, timeZone: string) =>
  memo(who, "outlook", cfg, timeZone, () =>
    createOutlookSource({
      ...calendarDeps(who, timeZone),
      config: cfg,
      ...(isWebApp(cfg)
        ? {
            web: { login: () => { const u = accounts.users.get(who.userId); return `/auth/microsoft/login${u ? `?hint=${encodeURIComponent(u.upn)}` : ""}`; }, redirectUri: urls.microsoft },
            clientSecretAccount: "entra-client-secret" as const,
          }
        : {}),
    }),
  );
/**
 * Step 15.4: the Microsoft sign-in is the Outlook source's auth client; the calendar, Teams, photos and the Azure token
 * all come from it. A2: the refresh token is the one the web sign-in returned, kept in the person's secrets.
 */
const presenceClients = new WeakMap<object, PresenceClient>();
const photoClients = new WeakMap<object, PhotoClient>();
const accountFor = (who: Person) => (cfg: AppConfig): MicrosoftAccount | null => {
  if (!cfg.outlook) return null;
  const src = outlookFor(who)(cfg.outlook, userZone(cfg));
  // Step 16.3: Teams presence on its own token from the same sign-in (one client per sign-in).
  let presence = presenceClients.get(src);
  if (!presence) presenceClients.set(src, (presence = createPresenceClient({ fetch, token: () => src.auth.accessToken("presence"), invalidate: () => src.auth.invalidate(), log })));
  // Step 16.4: profile photos on their own token (ProfilePhoto.Read.All).
  let photos = photoClients.get(src);
  if (!photos) photoClients.set(src, (photos = createPhotoClient({ fetch, token: () => src.auth.accessToken("photo"), invalidate: () => src.auth.invalidate(), log })));
  return {
    presence,
    photos,
    signIn: (o) => src.connect(o),
    identity: () => src.auth.identity(),
    armToken: () => src.auth.accessToken("arm"),
    writeAccess: () => src.auth.writeAccess(),
    signOut: () => src.disconnect(),
  };
};
const azureFor = (token: () => Promise<string>) => createAzureClient({ fetch, token, log });
const googleFor = (who: Person) => (cfg: GoogleConfig, timeZone: string) =>
  memo(who, "google", cfg, timeZone, () => createGoogleSource({ ...calendarDeps(who, timeZone), config: cfg, web: { login: () => "/auth/google/login", redirectUri: urls.google } }));

/**
 * A2: a person's DevOps write PATs, one per client, in their encrypted secrets (account devops-write-pat:<cache key>).
 * Read back only wrapped in Pat. Never logged, cached, exported or returned to the UI.
 */
const writePatsOf = (who: Person): WritePats => ({
  get: async (clientKey) => new Pat(await who.secrets.get(writePatAccount(clientKey))),
  set: async (clientKey, value) => {
    if (!value || value.length > 1024 || /[\r\n\s]/.test(value)) throw new Error("A PAT is one line of 1 to 1024 characters with no spaces");
    await who.secrets.set(writePatAccount(clientKey), value);
  },
  clear: (clientKey) => who.secrets.delete(writePatAccount(clientKey)),
});
const writePatAccount = (clientKey: string) => `devops-write-pat:${cacheKey(clientKey)}` as const;

// DevOps: one source per person and Dataverse config. PATs come from Dataverse per fetch (devopsTargets), not kept.
const devopsSources = new Map<string, DevOpsSource>();
const devopsFor = (who: Person) => (cfg: DataverseConfig, timeZone: string) => {
  const key = JSON.stringify([who.userId, cfg, timeZone]);
  let s = devopsSources.get(key);
  if (!s) {
    const dv = dataverseFor(who)(cfg, timeZone);
    s = createDevOpsSource({ fetch, log, snapshots: who.snapshots, timeZone, targets: (keys) => dv.devopsTargets(keys), pickableTypes: () => who.pickableTypes, openStates: (k) => who.openStates[k] ?? [] });
    devopsSources.set(key, s);
  }
  return s;
};

let planDb: DatabaseSync | undefined;
const planPath = host.kind === "local" ? host.paths.planDb : ":memory:";
try {
  planDb = openPlanDb({ path: planPath, now: () => zonedNow(host.clock.zone()), log, files: host.files.store });
} catch {
  log({ source: "plan", op: "open", kind: "failed" });
}
if (!planDb) {
  console.error("FocusTime couldn't open its plan store, so nobody can sign in. See the log above.");
  process.exit(1);
}
const accounts = createAccountStore(planDb, instantNow);
const db = planDb;
/** A2: each person's plan store on the one database (every statement scoped to them, store/scope.ts). */
const plans = new Map<string, PlanStore>();
/** The store's clock follows the person's time zone (A1: their setting, else the host clock's). */
const planFor = (who: Person): PlanStore => {
  let p = plans.get(who.userId);
  if (!p) plans.set(who.userId, (p = planStoreOn(db, { userId: who.userId, path: planPath, now: () => zonedNow(who.zone), files: host.files.store })));
  return p;
};
const appKeys: AppKeys = { dataverse: app.dataverse, entra: app.entra, google: app.google };
const settingsFor = (userId: string): UserSettings =>
  createUserSettings({
    db,
    userId,
    app: appKeys,
    person: () => {
      const u = accounts.users.get(userId);
      return { email: u?.email ?? null, upn: u?.upn ?? "", timeZone: u?.timeZone ?? null };
    },
    setZone: (z) => accounts.users.setTimeZone(userId, z),
    defaultZone: host.clock.zone(),
    now: instantNow,
  });

/** A2: a person's encrypted secrets (refresh tokens, write PATs), sealed with the app's data key. */
const secretsFor = (userId: string): UserSecrets => createUserSecrets({ db, userId, keys: host.keys, now: instantNow });

const people = createPeople({
  db,
  accounts,
  settingsFor,
  configFile: { load: () => host.config.load(), raw: () => host.config.raw() },
  mailboxZone: (accessToken) => mailboxZone({ fetch, accessToken, log }),
  hostZone: () => host.clock.zone(),
  log,
});

// Microsoft sign-in (A2): the "FocusTime" web registration, single tenant, confidential client.
const entra = app.entra
  ? createEntraSignIn({ tenantId: app.entra.tenantId, clientId: app.entra.clientId, redirectUri: redirectUris(app).microsoft, clientSecret: () => host.secrets.get("entra-client-secret"), log })
  : null;

let devMiddleware: Parameters<typeof createApp>[0]["devMiddleware"];
if (dev) {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, configFile: join(root, "vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "spa" });
  devMiddleware = vite.middlewares;
}

/** Media control for focus (step 10): the host's (local: playerctl when installed, playlist links through xdg-open). */
const media = host.media;

// The demo (A2, was D272's switch): "Try the demo" starts a demo session with its own fictional person, plan store
// in memory and data, built on first use and dropped when the session ends. Never mixed with anyone's real data.
const demos = new Map<string, Promise<ActionContext>>();
const demoControl = (on: boolean): DemoControl => ({ on, set: async () => {} });
const demoFor = (userId: string): Promise<ActionContext> => {
  let c = demos.get(userId);
  if (!c) {
    c = (async () => {
      const ctx = createDemoContext({ now: () => instantNow().toString(), demo: demoControl(true) });
      await seedDemo(ctx);
      return ctx;
    })();
    demos.set(userId, c);
    c.catch(() => demos.delete(userId));
  }
  return c;
};

const server = createApp({
  publicUrl: app.publicUrl,
  log,
  accounts,
  auth: {
    microsoft: entra,
    signedIn: async (u, tokens) => {
      const r = await people.signedIn(u, tokens);
      if ("refused" in r) return r;
      await keepSignIn(r.userId, u, tokens.refreshToken, r.owner);
      return r;
    },
    google: app.google
      ? {
          start: async (userId) => {
            const src = await googleOf(userId);
            if (!src) throw new Error("Google isn't set up");
            return src.auth.webStart();
          },
          finish: async (userId, callback, pending) => {
            const src = await googleOf(userId);
            const r = src ? await src.auth.webFinish(callback, pending) : null;
            if (r?.status === "connected") forgetCalendars(userId);
            return r?.status === "connected" ? "connected" : "failed";
          },
        }
      : null,
    demo: app.demo ? async () => {
      const id = `demo-${randomBytes(12).toString("base64url")}`;
      await demoFor(id);
      return id;
    } : null,
    ended: (s) => {
      if (!s.demo) return;
      void demos.get(s.userId)?.then((c) => c.plan?.close());
      demos.delete(s.userId);
    },
  },
  // FOCUSTIME_DIST: a verification build elsewhere, so checking work never swaps the UI the service serves.
  ...(devMiddleware ? { devMiddleware } : { distDir: process.env.FOCUSTIME_DIST ?? join(root, "dist") }),
  // The launcher's request (capture), else the view a clicked notification asked for (step 15.5), taken once.
  takeOpenRequest: async (s) => (s.demo ? null : ((await host.launch.takeOpenRequest()) ?? takeRouteFor(s.userId))),
  reopen: reopenWindow,
  ctx: (s) => (s.demo ? demoFor(s.userId) : runtimeFor(s.userId)),
});
setInterval(() => void accounts.sessions.sweep(), 15 * 60_000).unref();
/**
 * A2: one person's runtime: their action context (their plan store; config, sources and secrets are still this
 * machine's until the settings and secrets steps) and their background ticks (reminders, the focus timer, Teams status),
 * started once per process for each person who signs in, and at start for everyone with a store (so a running timer
 * ends on time after a restart without anyone signing in).
 */
const runtimes = new Map<string, { ctx: ActionContext; who: Person; ticks: PersonTicks }>();
function runtimeFor(userId: string): ActionContext {
  const known = runtimes.get(userId);
  if (known) return known.ctx;
  const settings = settingsFor(userId);
  if (!settings.has()) settings.seed(starterToml(accounts.users.get(userId)?.timeZone ?? host.clock.zone()));
  const who: Person = { userId, zone: accounts.users.get(userId)?.timeZone ?? host.clock.zone(), pickableTypes: [], openStates: {}, settings, secrets: secretsFor(userId), snapshots: host.snapshotsFor(userId) };
  /** Their settings, with what the server keeps from them refreshed. */
  const loadConfig = async () => {
    const r = await settings.load();
    if (r.parsed.ok) {
      who.zone = userZone(r.parsed.config);
      who.pickableTypes = r.parsed.config.plan.pickablePortfolioTypes;
      who.openStates = Object.fromEntries(Object.entries(r.parsed.config.clientSettings).map(([k, v]) => [k, v.openStates]));
    }
    return r;
  };
  void loadConfig().catch(() => null);
  const plan = planFor(who);
  const liveCtx: ActionContext = {
    renameNote: renamed.note,
    demo: demoControl(false),
    loadConfig,
    makeDataverse: dataverseFor(who),
    makeOutlook: outlookFor(who),
    makeGoogle: googleFor(who),
    makeDevOps: devopsFor(who),
    saveSystemUserId: (id) => settings.saveSystemUserId(id),
    get signedInAs() {
      const u = accounts.users.get(userId);
      return u ? { email: u.email, upn: u.upn } : undefined;
    },
    writeConfig: (edit) => settings.write(edit),
    now: () => instantNow().toString(),
    plan,
    links: host.links,
    media,
    secrets: { state: (a) => host.secrets.state(a), set: (a, v) => host.secrets.setApp(a, v) },
    // Step 14: personal DevOps write PATs (the host's secret store) and the writer (dev.azure.com of one client per call).
    writePats: writePatsOf(who),
    devopsWriter: createDevOpsWriter({ fetch, log }),
    account: accountFor(who),
    photoCache: host.photos,
    azure: azureFor,
    exportPlan: (json) => host.files.exportPlan(json),
    myData: {
      export: async () => {
        const u = accounts.users.get(userId);
        if (!u) throw new Error("Not signed in");
        log({ source: "plan", op: "data_export" });
        return exportUser(db, u, instantNow());
      },
      remove: async () => deleteData(userId),
    },
  };
  const ticks = personTicks({ log, now: instantNow, notifications: host.notifications, media: host.media, openRoute: (route) => openRouteFor(userId, route) }, plan, liveCtx, who);
  runtimes.set(userId, { ctx: liveCtx, who, ticks });
  return liveCtx;
}

/**
 * A2: after a Microsoft sign-in, the person's refresh token goes into their encrypted secrets (the Outlook source and
 * everything on that sign-in use it), who they are is remembered in their store (as the Outlook sign-in did), and
 * their calendar sources start fresh. The store's owner, the first time: the DevOps write PATs this machine's keyring
 * holds for their clients are copied into their secrets (the keyring entries stay).
 */
async function keepSignIn(userId: string, u: SignedIn, refreshToken: string, owner: boolean): Promise<void> {
  const ctx = runtimeFor(userId);
  const mine = secretsFor(userId);
  await mine.set("outlook-refresh-token", refreshToken).catch(() => log({ source: "auth", op: "refresh_token", kind: "not_kept" }));
  forgetCalendars(userId);
  rememberIdentity(ctx.plan, { oid: u.oid, tid: u.tid, name: u.name, username: u.upn, email: u.email }, instantNow().toString());
  if (!owner || !ctx.plan || !ctx.writePats) return;
  let copied = 0;
  for (const { clientKey } of ctx.plan.devopsIdentities()) {
    const pat = await host.secrets.writePat.get(clientKey).catch(() => null);
    if (!pat || mine.has(writePatAccount(clientKey))) continue;
    await mine.set(writePatAccount(clientKey), patValue(pat)).then(() => copied++, () => null);
  }
  log({ source: "plan", op: "write_pats_moved", count: copied });
}

/** A person's Google source for the web sign-in, from their settings (null without [google]). */
async function googleOf(userId: string) {
  runtimeFor(userId);
  const rt = runtimes.get(userId)!;
  const r = await rt.ctx.loadConfig();
  if (!r.parsed.ok || !r.parsed.config.google) return null;
  return googleFor(rt.who)(r.parsed.config.google, userZone(r.parsed.config));
}

/** The value inside a Pat, for the one copy from the keyring into the person's secrets (Pat has no getter on purpose). */
const patValue = (p: Pat) => Buffer.from(p.basicAuth().slice("Basic ".length), "base64").toString("utf8").slice(1);

/**
 * Settings > Data > Delete my data (A2): soft now (sign-in refused, sessions ended, background work stopped; the rows
 * stay), hard after 30 days (hardDeleteDue). Both are logged without the person's id.
 */
async function deleteData(userId: string): Promise<{ hardDeleteOn: string }> {
  const at = instantNow();
  accounts.users.setDeleted(userId, at.toString());
  recordSoftDelete(db, userId, at);
  accounts.sessions.endAllFor(userId);
  // Their refresh tokens and write PATs go now (the rows of their data wait for the hard delete).
  secretsFor(userId).clear();
  forgetCalendars(userId);
  runtimes.delete(userId);
  plans.delete(userId);
  log({ source: "plan", op: "data_delete", kind: "soft" });
  return { hardDeleteOn: at.add({ hours: 24 * HARD_DELETE_AFTER_DAYS }).toString().slice(0, 10) };
}
const hardDeletes = () => {
  const n = hardDeleteDue(db, instantNow());
  if (n) log({ source: "plan", op: "data_delete", kind: "hard", count: n });
};
hardDeletes();
setInterval(hardDeletes, 3600_000).unref();

/** Step 15.5, A2: a clicked notification's view, kept in the person's store for their window, which is brought up. */
function openRouteFor(userId: string, route: string): void {
  const plan = plans.get(userId);
  if (!plan || !keepRoute(plan, route, instantNow())) return;
  log({ source: "plan", op: "notify_route", kind: route.split(":")[0]! });
  void reopenWindow().then((ok) => log({ source: "plan", op: "notify_window", kind: ok ? "opened" : "unavailable" }));
}
function takeRouteFor(userId: string): string | null {
  const plan = plans.get(userId);
  const r = plan ? takeRoute(plan, instantNow()) : null;
  if (r) log({ source: "plan", op: "notify_route", kind: "taken" });
  return r;
}

/** "Reopen FocusTime" from a window whose launch token is old (the host's; --no-reopen turns it off). */
function reopenWindow(): Promise<boolean> {
  return host.launch.reopen();
}



// Everyone who has signed in before gets their background work back at start (a timer that was running ends on time),
// all of it run by one scheduler (server/scheduler.ts) that reads what is due from each person's rows.
for (const u of accounts.users.all()) if (!u.deletedAt) runtimeFor(u.id);
const scheduler = createScheduler({ people: () => [...runtimes.values()].map((r) => r.ticks), log });
const stopScheduler = scheduler.start();

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`FocusTime is already running on port ${port} (perhaps as the focustime service). Open its window with: node scripts/open-window.ts`);
    process.exit(1);
  }
  throw e;
});
server.listen(port, "127.0.0.1", async () => {
  // A2: the launch link is the public URL; signing in is what lets a window in, not the link.
  const url = `${app.publicUrl}/`;
  const launchFile = await host.launch.publish(url);
  process.stdout.write(`FocusTime running on ${app.publicUrl} (${dev ? "dev" : "built"} UI, ${host.kind} host)\nSettings: each person's, in the plan store (${cfgPath} only seeds its owner's once)\nSign-in: ${entra ? "Microsoft" : "not set up (add [entra] to the app config)"}${app.demo ? ", demo" : ""}\n${launchFile ? `Launch link: ${launchFile}\n` : ""}`);
  host.launch.openWindow(url);
});

const stop = async () => {
  stopScheduler();
  await host.launch.unpublish();
  planDb?.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
