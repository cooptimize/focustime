// Start FocusTime: the server (A2: Microsoft sign-in and server-side sessions; the developer loop serves
// http://localhost:<port> and opens an app window on it).
// Usage: node server/main.ts [--dev] [--no-open] [--no-reopen] [--port 5317] [--clock <ISO instant>]
// FOCUSTIME_HOST=local|azure (A1) picks the host: local (the default) is the developer loop on this machine; azure is
// the hosted app's host, a stub until A2 (its secrets, snapshots and plan store are in memory).
// --clock (verification runs only): the server's clock starts at that instant and runs forward from there.
import { createChatsClient, type ChatMessagesClient, type ChatsClient } from "../sources/graph/chats.ts";
import type { Host, KeyProvider, SnapshotStore } from "../host/types.ts";
import { perPerson } from "../host/per-person.ts";
import { createUserSecrets, type UserSecrets } from "../store/user-secrets.ts";
import { createPushDevices } from "../store/push-devices.ts";
import { createPush, type VapidSource } from "./push.ts";
import { keyVaultSecret } from "../host/azure/vapid.ts";
import { openAiProvider } from "../ai/openai.ts";
import { stubProvider } from "../ai/stub.ts";
import type { AiProvider } from "../ai/types.ts";
import type { AiRuntime } from "../actions/ai-actions.ts";
import { appSpendStore } from "../store/ai-spend.ts";
import { takesStore } from "../store/devops-takes.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { WritePats } from "../actions/devops-write-actions.ts";
import { createLocalHost } from "../host/local/index.ts";
import { createAzureHost } from "../host/azure/index.ts";
import { keyVaultDataKey } from "../host/azure/datakey.ts";
import { envSecrets } from "../host/azure/secrets.ts";
import { appKeyStore } from "../store/app-keys.ts";
import { appInsights } from "../log/appinsights.ts";
import { DefaultAzureCredential } from "@azure/identity";
import { noSettingsFile, photoCache, snapshotCache } from "../host/azure/memory.ts";
import { randomBytes } from "node:crypto";
import { readAppSettings, redirectUris } from "./appconfig.ts";
import { createEntraSignIn, type SignedIn } from "./auth/entra.ts";
import { createAccountStore } from "../store/accounts.ts";
import { createUserSettings, type AppKeys, type UserSettings } from "../store/user-settings.ts";
import { exportUser, hardDeleteDue, hardDeleteUser, HARD_DELETE_AFTER_DAYS, recordSoftDelete } from "../store/user-data.ts";
import { starterToml } from "../config/starter.ts";
import { mailboxZone } from "./auth/mailbox.ts";
import { createPeople } from "./people.ts";
import { copiesOwnerSecrets, copyOwnerSecrets, OWNER_SECRETS_MARK, writePatAccount } from "./owner-secrets.ts";
import { personTicks, type PersonTicks } from "./ticks.ts";
import { createScheduler } from "./scheduler.ts";
import { wakeStoreOn } from "../store/wake-store.ts";
import { cancelShutdownRestores } from "../store/vm-restores.ts";
import { keepRoute, takeRoute } from "./open-route.ts";
import { join, resolve } from "node:path";
import type { AppConfig, DataverseConfig, GoogleConfig, OutlookConfig } from "../config/schema.ts";
import { rememberIdentity, storedIdentity, type MicrosoftAccount } from "../actions/account.ts";
import type { SignedInPerson } from "../plan/person-match.ts";
import { createPresenceClient, type PresenceClient } from "../sources/graph/presence.ts";
import { createPhotoClient, type PhotoClient } from "../sources/graph/photos.ts";
import { createAzureClient } from "../sources/azure/client.ts";
import { stderrLogger } from "../log/logger.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import type { CalendarSource } from "../sources/calendar/source.ts";
import { createDataverseSource, type DataverseSource } from "../sources/dataverse/source.ts";
import { createGoogleSource } from "../sources/google/source.ts";
import { createOutlookSource } from "../sources/graph/source.ts";
import type { ProcessOverrides } from "../plan/process.ts";
import { createDevOpsSource, type DevOpsSource } from "../sources/devops/source.ts";
import type { Keyring } from "../sources/oauth/oauth.ts";
import { planStoreOn, type PlanStore } from "../store/plan-store.ts";
import type { Conn } from "../store/sql/conn.ts";
import { openStore, StoreConfigError, type OpenedStore } from "../store/open.ts";
import { createApp } from "./app.ts";
import { moveFromOldName } from "../host/local/rename.ts";
import { createDemoContext, seedDemo, type DemoControl } from "./demo.ts";
import { buildInfo } from "./buildinfo.ts";
import { createFeedbackService } from "../actions/feedback-actions.ts";
import { createFeedbackDevOps, DEVOPS_SCOPE } from "../sources/devops/feedback.ts";
import { execFileSync } from "node:child_process";
import type { ActionContext } from "../actions/dispatch.ts";
import { userZone } from "../week/zone.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { pollCycle, requestsNextDue, type PollDeps, type PollPerson } from "../actions/request-poll.ts";
import { requestContext, aiFor, escalationHours } from "../actions/dispatch.ts";
import { createConversationStore } from "../store/conversation-store.ts";
import { upkeep as upkeepConversations } from "../actions/conversation-upkeep.ts";
import { backfillRequests } from "../actions/conversation-backfill.ts";
import { weekConfig } from "../config/defaults.ts";
import type { RequestsPort } from "../actions/request-actions.ts";
import { createAdminCheck } from "../actions/admin.ts";
import { createOrgRuntime } from "../actions/org.ts";
import { createAdminOps } from "./admin-ops.ts";
import { createAdminStore, FOCUSTIME } from "../store/admin-store.ts";
import { inGroup } from "../sources/graph/groups.ts";
import { orgBootstrap, type BootstrapPerson } from "./org-bootstrap.ts";
import type { FeedbackService } from "../actions/feedback-actions.ts";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const open = !args.includes("--no-open");
/** --headless (the browser tests): no desktop notifications and no windows opened by the server. */
const headless = args.includes("--headless");
const portArg = args.indexOf("--port");
// A4: the hosted app listens on PORT (the container's, 8080) on every interface; the developer loop on 127.0.0.1:5317.
const port = portArg >= 0 ? Number(args[portArg + 1]) : process.env.FOCUSTIME_HOST === "azure" ? Number(process.env.PORT ?? 8080) : 5317;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be 1024-65535");
const clockArg = args.indexOf("--clock");
const clockOffsetMs = clockArg >= 0 ? Temporal.Instant.from(args[clockArg + 1] ?? "").epochMilliseconds - Date.now() : 0;
/** The server's clock: real time, or a pinned start running forward (--clock). */
const instantNow = () => (clockOffsetMs ? Temporal.Instant.fromEpochMilliseconds(Date.now() + clockOffsetMs) : Temporal.Now.instant());
const zonedNow = (tz: string) => instantNow().toZonedDateTimeISO(tz);
const root = resolve(import.meta.dirname, "..");
/** A4: the hosted app's telemetry (Application Insights, from its connection string), on top of stderr. */
const telemetry =
  process.env.FOCUSTIME_HOST === "azure" && process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ? appInsights({ connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING, next: stderrLogger }) : null;
const log = telemetry?.log ?? stderrLogger;

const hostKind = process.env.FOCUSTIME_HOST ?? "local";
/** A4 (hosted): the data key, wrapped by Key Vault (set once the store is open). */
let dataKeys: KeyProvider | null = null;
if (hostKind !== "local" && hostKind !== "azure") throw new Error("FOCUSTIME_HOST must be local or azure");
const host: Host =
  hostKind === "azure"
    ? createAzureHost({
        // A4: app secrets from Key Vault references (the environment, read once); the data key from Key Vault once the
        // store is open (it keeps the wrapped key).
        secrets: envSecrets(),
        keys: { dataKey: () => (dataKeys ? dataKeys.dataKey() : Promise.reject(new Error("The data key isn't available (no Key Vault set up for this app)"))) },
        config: noSettingsFile(),
        snapshotsFor: perPerson(() => snapshotCache()),
        photos: photoCache(),
        inbox: { add: () => "0", remove: () => {} },
        now: instantNow,
      })
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
type Person = { userId: string; upn: string | null; zone: string; /** ADM-1: each client's process Rules (WT-1's overrides). */ process: Record<string, ProcessOverrides>; openStates: Record<string, string[]>; settings: UserSettings; secrets: UserSecrets; snapshots: SnapshotStore };

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
            web: { login: () => `/auth/microsoft/login${who.upn ? `?hint=${encodeURIComponent(who.upn)}` : ""}`, redirectUri: urls.microsoft },
            clientSecretAccount: "entra-client-secret" as const,
            calendarScope: "Calendars.ReadWrite" as const,
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
const chatsClients = new WeakMap<object, ChatsClient>();
const messageClients = new WeakMap<object, ChatMessagesClient>();
const accountFor = (who: Person) => (cfg: AppConfig): MicrosoftAccount | null => {
  if (!cfg.outlook) return null;
  const src = outlookFor(who)(cfg.outlook, userZone(cfg));
  // Step 16.3: Teams presence on its own token from the same sign-in (one client per sign-in).
  let presence = presenceClients.get(src);
  if (!presence) presenceClients.set(src, (presence = createPresenceClient({ fetch, token: () => src.auth.accessToken("presence"), invalidate: () => src.auth.invalidate(), log })));
  // Step 16.4: profile photos on their own token (ProfilePhoto.Read.All).
  let photos = photoClients.get(src);
  if (!photos) photoClients.set(src, (photos = createPhotoClient({ fetch, token: () => src.auth.accessToken("photo"), invalidate: () => src.auth.invalidate(), log })));
  // T-2: Teams chat names and members on their own token (Chat.ReadBasic).
  let chats = chatsClients.get(src);
  if (!chats) chatsClients.set(src, (chats = createChatsClient({ fetch, token: () => src.auth.accessToken("chats"), invalidate: () => src.auth.invalidate(), log })));
  // AP-1: a registered chat's messages on their own token (Chat.Read, which each person allows when switching Asks on).
  let chatMessages = messageClients.get(src);
  if (!chatMessages) messageClients.set(src, (chatMessages = createChatsClient({ fetch, token: () => src.auth.accessToken("messages"), invalidate: () => src.auth.invalidate(), log })));
  return {
    presence,
    photos,
    chats,
    chatMessages,
    probe: (kind) => src.auth.probe(kind),
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

// DevOps: one source per person and Dataverse config. PATs come from Dataverse per fetch (devopsTargets), not kept.
const devopsSources = new Map<string, DevOpsSource>();
/**
 * AP-2: the AI guard's map of DevOps item id to client, per person (devops_item_clients). Each read's ids go to the
 * store only when some are new since this process last saw them, so a normal read makes no database call.
 */
const knownItems = new Map<string, Set<string>>();
const itemMapOf = (who: Person) => (clientKey: string, ids: number[]) => {
  const known = knownItems.get(who.userId) ?? new Set<string>();
  knownItems.set(who.userId, known);
  const fresh = ids.filter((id) => !known.has(`${clientKey}#${id}`));
  if (!fresh.length) return;
  for (const id of fresh) known.add(`${clientKey}#${id}`);
  planFor(who).rememberItemClient(clientKey, fresh).catch(() => {
    for (const id of fresh) known.delete(`${clientKey}#${id}`);
    log({ source: "plan", op: "item_map", kind: "failed" });
  });
};
const devopsFor = (who: Person) => (cfg: DataverseConfig, timeZone: string) => {
  const key = JSON.stringify([who.userId, cfg, timeZone]);
  let s = devopsSources.get(key);
  if (!s) {
    const dv = dataverseFor(who)(cfg, timeZone);
    s = createDevOpsSource({ fetch, log, snapshots: who.snapshots, timeZone, targets: (keys) => dv.devopsTargets(keys), processOverrides: (k) => who.process[k] ?? {}, openStates: (k) => who.openStates[k] ?? [], onItems: itemMapOf(who) });
    devopsSources.set(key, s);
  }
  return s;
};

// A3: the plan store is SQL Server (the app config's [database]; Azure SQL in the hosted app, the local container
// here), or the SQLite file when the config says sqlite (the fallback, and the store before the switch).
const planPath = host.kind === "local" ? host.paths.planDb : ":memory:";
let opened: OpenedStore | undefined;
try {
  opened = await openStore(app.database, { sqlitePath: planPath, now: () => zonedNow(host.clock.zone()), log, files: host.files.store, password: () => host.secrets.get("sql-password") });
} catch (e) {
  log({ source: "plan", op: "open", kind: e instanceof StoreConfigError ? "config" : "failed" });
  if (e instanceof StoreConfigError) console.error(e.message);
}
if (!opened) {
  console.error("FocusTime couldn't open its plan store, so nobody can sign in. See the log above.");
  process.exit(1);
}
const db: Conn = opened.conn;

// Shared polling (D514 to D517): one store of client chats, messages and Requests for everyone, read by one job with
// the followers' own sign-ins (each person's account, as for every Graph call: access tokens in memory per person,
// refresh tokens sealed in their secrets; the job keeps none). People are built for a cycle on demand.
const teams = createTeamsStore(db, instantNow);
const pollDeps: PollDeps = {
  teams,
  users: async () => (await accounts.users.all()).map((u) => ({ id: u.id, name: u.displayName || u.upn, deleted: !!u.deletedAt })),
  person: async (uid) => {
    const user = await accounts.users.get(uid);
    if (!user || user.deletedAt) return null;
    const ctx = await runtimeFor(uid);
    const loaded = await ctx.loadConfig();
    const config = loaded.parsed.ok ? loaded.parsed.config : null;
    const account = config && ctx.account ? ctx.account(config) : null;
    const rc = await requestContext(ctx);
    return { name: user.displayName || user.upn, config, chatMessages: account?.chatMessages, chats: account?.chats, ai: () => aiFor(ctx), pipelineAi: () => aiFor(ctx, { cap: "app" }), plan: ctx.plan ?? null, openItems: rc.openItems };
  },
  homeTenant: async () => app.entra?.tenantId ?? null,
  now: () => instantNow().toString(),
  log,
  // ADM-2 (D582): the team's Rules, read each cycle (the org runtime holds them 30 seconds).
  rules: async () => {
    const r = (await org.rules()).conversations;
    return { pollMinutes: r.pollMinutes, retentionDays: r.retentionDays };
  },
};
// CV-1: conversations, commitments and suggestions, shared like the chats (D521's viewer gates every read).
const conversations = createConversationStore(db, instantNow, teams);
// PV-1: Take one's notices to the previous assignee (an app table).
const takes = takesStore(db, instantNow);
pollDeps.conversations = conversations;
// CV-1 migration (add-only, D468): AP-1's requests become conversations once; idempotent, so every start may run it.
await backfillRequests(teams, conversations, app.entra?.tenantId ?? null).then(
  (n) => n && log({ source: "plan", op: "requests_moved", count: n }),
  () => log({ source: "plan", op: "requests_moved", kind: "failed" }),
);
pollDeps.upkeep = async (now) => {
  // The person whose sign-in reads for a client (its first chat's registrant): DevOps reads and AI, once per run.
  const memo = new Map<string, Promise<PollPerson | null>>();
  const readerFor = (clientKey: string) =>
    memo.get(clientKey) ??
    memo.set(clientKey, (async () => {
      const chat = (await teams.chats()).find((c) => c.clientKey === clientKey);
      const p = chat ? await pollDeps.person(chat.registeredBy).catch(() => null) : null;
      return p?.config ? p : null;
    })()).get(clientKey)!;
  await upkeepConversations({
    teams,
    convs: conversations,
    now,
    hoursOf: async (uid) => ((await accounts.users.get(uid))?.deletedAt === null ? escalationHours(await runtimeFor(uid)) : null),
    defaultHours: weekConfig.hours,
    items: async (clientKey) => {
      const p = await readerFor(clientKey);
      return p?.config ? p.openItems(p.config, clientKey) : null;
    },
    userByEmail: async (email) => (await accounts.users.all()).find((u) => !u.deletedAt && (u.email ?? "").toLowerCase() === email.toLowerCase())?.id ?? null,
    ai: async (clientKey) => {
      const p = await readerFor(clientKey);
      return p?.pipelineAi ? p.pipelineAi() : null;
    },
    clientName: async (k) => (await readerFor(k))?.config?.clientSettings[k]?.name ?? k,
    log,
  });
};
const requestsPort: RequestsPort = { teams, refresh: (chatIds) => pollCycle(pollDeps, { force: true, chatIds }), conversations, users: pollDeps.users };
// D475: next-morning auto-shutdown restores from before (they'd write the schedule) never run; mark them cancelled.
await cancelShutdownRestores(db, instantNow).then(
  (c) => c.length && log({ source: "azure", op: "restore_cancelled", count: c.length }),
  () => log({ source: "azure", op: "restore_cancelled", kind: "failed" }),
);
/** P1: the app's VAPID key (the hosted app's Key Vault); null in the developer loop, where push isn't offered. */
let vapidSource: VapidSource | null = null;
if (host.kind === "azure" && process.env.FOCUSTIME_KEYVAULT_URL) {
  const credential = new DefaultAzureCredential(process.env.AZURE_CLIENT_ID ? { managedIdentityClientId: process.env.AZURE_CLIENT_ID } : {});
  dataKeys = keyVaultDataKey({
    vaultUrl: process.env.FOCUSTIME_KEYVAULT_URL,
    keyName: process.env.FOCUSTIME_DATA_KEY_NAME ?? "ft-data-key",
    token: async () => (await credential.getToken("https://vault.azure.net/.default")).token,
    store: async () => appKeyStore(db, "data-key", instantNow),
  });
  // P1: the VAPID key for Web Push, read when first needed (none: push says it isn't set up).
  vapidSource = keyVaultSecret({ vaultUrl: process.env.FOCUSTIME_KEYVAULT_URL, secretName: process.env.FOCUSTIME_VAPID_SECRET_NAME ?? "ft-vapid-key", token: async () => (await credential.getToken("https://vault.azure.net/.default")).token });
}
/**
 * AI-0: the AI key, read when needed and held in memory for 10 minutes (a missing one is asked for again after a
 * minute, so adding it with infra/scripts/openai-key.sh takes effect without a restart). Hosted: the Key Vault secret
 * ft-openai-key; the developer loop: the keyring entry openai-api-key. Never logged.
 */
let aiKeySource: () => Promise<string | null> = async () => {
  try {
    return await host.secrets.get("openai-api-key");
  } catch {
    return null;
  }
};
if (host.kind === "azure" && process.env.FOCUSTIME_KEYVAULT_URL) {
  const credential = new DefaultAzureCredential(process.env.AZURE_CLIENT_ID ? { managedIdentityClientId: process.env.AZURE_CLIENT_ID } : {});
  aiKeySource = keyVaultSecret({ vaultUrl: process.env.FOCUSTIME_KEYVAULT_URL, secretName: process.env.FOCUSTIME_OPENAI_SECRET_NAME ?? "ft-openai-key", token: async () => (await credential.getToken("https://vault.azure.net/.default")).token });
}
let aiKeyHeld: { value: string | null; until: number } | null = null;
const aiKey = async (): Promise<string | null> => {
  if (aiKeyHeld && Date.now() < aiKeyHeld.until) return aiKeyHeld.value;
  const value = await aiKeySource().catch(() => {
    log({ source: "ai", op: "key", kind: "unavailable" });
    return null;
  });
  aiKeyHeld = { value, until: Date.now() + (value ? 10 * 60_000 : 60_000) };
  return value;
};
/** AI-0: hosted, OpenAI by default; the developer loop and CI, the stub (no network) unless [ai] provider = "openai". */
const aiProviderKind = app.ai.provider ?? (host.kind === "azure" ? "openai" : "stub");
const openAi = openAiProvider({ key: aiKey });
const stubAi = stubProvider();
const aiRuntime: AiRuntime = {
  app: { ...app.ai, provider: aiProviderKind },
  provider: async (): Promise<AiProvider | null> => (aiProviderKind === "stub" ? stubAi : aiProviderKind === "openai" && (await aiKey()) ? openAi : null),
  appSpend: appSpendStore(db, instantNow),
  logger: log,
};
/** A3: when a signed-in person last used FocusTime (in memory; the idle rule's "someone is active"). */
let lastUse = 0;
const ACTIVE_MS = 15 * 60_000;
const accounts = createAccountStore(db, instantNow);
/** A2: each person's plan store on the one database (every statement scoped to them, store/scope.ts). */
const plans = new Map<string, PlanStore>();
/** The store's clock follows the person's time zone (A1: their setting, else the host clock's). */
const planFor = (who: Person): PlanStore => {
  let p = plans.get(who.userId);
  if (!p) plans.set(who.userId, (p = planStoreOn(db, { userId: who.userId, now: () => zonedNow(who.zone), ...(opened.backup ? { path: planPath, backup: opened.backup } : {}) })));
  return p;
};
const appKeys: AppKeys = { dataverse: app.dataverse, entra: app.entra, google: app.google, inviteDomains: app.inviteDomains };
const settingsFor = (userId: string): UserSettings =>
  createUserSettings({
    db,
    userId,
    app: appKeys,
    person: async () => {
      const u = (await accounts.users.get(userId));
      return { email: u?.email ?? null, upn: u?.upn ?? "", timeZone: u?.timeZone ?? null };
    },
    setZone: (z) => accounts.users.setTimeZone(userId, z),
    defaultZone: host.clock.zone(),
    now: instantNow,
  });

/** A2: a person's encrypted secrets (refresh tokens, write PATs), sealed with the app's data key. */
const secretsFor = (userId: string): UserSecrets => createUserSecrets({ db, userId, keys: host.keys, now: instantNow });
/** P1: a person's Web Push: their devices and the app's VAPID key; the subject is the app's public URL. */
const pushFor = (userId: string) => createPush({ devices: createPushDevices({ db, userId, keys: host.keys, now: instantNow }), vapid: vapidSource, subject: app.publicUrl, fetch, now: () => Date.now(), log });

// ADM-1: the team's settings, people's levels and client leads, and admin audit (app tables), and who is an admin.
const adminStore = createAdminStore(db, instantNow);
// ADM-2 (D577): who signed in, for the one person match: their Entra id, email and UPN, and the Dataverse user their
// sign-in was matched to (what matchMe keeps in ms_identity; else a my_systemuserid set in their settings).
async function signedInPeople(): Promise<SignedInPerson[]> {
  const out: SignedInPerson[] = [];
  for (const u of await accounts.users.all()) {
    if (u.deletedAt) continue;
    const ident = await storedIdentity(storeOf(u.id, u.timeZone)).catch(() => null);
    const kept = ident?.systemUserId ?? null;
    const set = kept ? null : await settingsFor(u.id).load().then((l) => (l.parsed.ok ? l.parsed.config.dataverse.mySystemUserId : null), () => null);
    out.push({ id: u.id, email: u.email, upn: u.upn, systemUserId: kept ?? set });
  }
  return out;
}
const org = createOrgRuntime({ store: adminStore, bootstrap: { model: app.ai.model, appCapUsd: app.ai.appCapUsd, inviteDomains: app.inviteDomains, feedback: app.feedback }, signedIn: signedInPeople });
/** Graph's answer for an admin check, with the person's own token (User.Read; never kept, never logged). */
const groupAnswer = async (userId: string): Promise<boolean | null> => {
  if (!app.adminGroupId) return false;
  const ctx = await runtimeFor(userId);
  const loaded = await ctx.loadConfig();
  const rt = runtimes.get(userId);
  if (!loaded.parsed.ok || !loaded.parsed.config.outlook || !rt) return null;
  const src = outlookFor(rt.who)(loaded.parsed.config.outlook, userZone(loaded.parsed.config));
  return inGroup({ fetch, token: () => src.auth.accessToken("read"), log }, app.adminGroupId);
};
const adminCheck = createAdminCheck({ groupId: app.adminGroupId, breakGlass: app.admins, graph: groupAnswer, now: Date.now, seen: (id, admin, via) => adminStore.seen(id, admin, via) });

const people = createPeople({
  newPerson: async () => (await org.rules()).organization.newPerson,
  db,
  accounts,
  settingsFor,
  configFile: { load: () => host.config.load(), raw: () => host.config.raw() },
  mailboxZone: (accessToken) => mailboxZone({ fetch, accessToken, log }),
  hostZone: () => host.clock.zone(),
  // ADM-2 (D580): guests are refused at sign-in, from the token and the domains Rule (never Dataverse).
  cooptimizeDomains: async () => (await org.rules()).organization.inviteDomains,
  refusedGuest: async (u, why) => {
    const ended = await accounts.sessions.endAllFor(u.oid);
    await adminStore.audit(FOCUSTIME, { area: "people", target: (u.name || "A guest").slice(0, 200), setting: "sign_in", oldValue: null, newValue: null, note: `refused: not a Cooptimize account (${why})${ended ? `, ${ended} session${ended === 1 ? "" : "s"} ended` : ""}` });
  },
  log,
});

/**
 * ADM-2 (D580): ends the sessions of anyone signed in who turns out to be a guest or outside the Cooptimize domains
 * (Dataverse's guest mark, or the Rule changed), with an audit line. At start and after each people refresh.
 */
async function endGuestSessions(): Promise<number> {
  const lv = await org.levels();
  let n = 0;
  for (const e of lv.people.others) {
    if (!e.signedIn || e.notCooptimizer === "automation") continue;
    const ended = await accounts.sessions.endAllFor(e.id);
    if (!ended) continue;
    n += ended;
    const name = (await accounts.users.get(e.id))?.displayName ?? "A guest";
    await adminStore.audit(FOCUSTIME, { area: "people", target: name.slice(0, 200), setting: "sign_in", oldValue: null, newValue: null, note: `sessions ended: not a Cooptimize account (${e.notCooptimizer})` });
  }
  if (n) log({ source: "auth", op: "guest_sessions_ended", count: n });
  return n;
}

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
/** F1 checks (e2e): the demo's pretend feature can be missing or the wrong type, to show the not-set-up state. */
const demoFeedbackParent = ((v) => (v === "missing" || v === "wrong_type" ? v : "ok"))(process.env.FOCUSTIME_DEMO_FEEDBACK_PARENT);
const demoControl = (on: boolean): DemoControl => ({ on, set: async () => {} });
const demoFor = (userId: string): Promise<ActionContext> => {
  let c = demos.get(userId);
  if (!c) {
    c = (async () => {
      const ctx = { ...createDemoContext({ now: () => instantNow().toString(), demo: demoControl(true), feedbackParent: demoFeedbackParent }), env: "demo" };
      await seedDemo(ctx);
      return ctx;
    })();
    demos.set(userId, c);
    c.catch(() => demos.delete(userId));
  }
  return c;
};

// S1 (D452): which build this is (baked into the image; in the developer loop, the source tree's commit).
const build = buildInfo(process.env, () => {
  if (hostKind !== "local") return null;
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 });
  } catch {
    return null;
  }
});

// F1: Send feedback, one service for this FocusTime. Locally: preview only, nothing checked or sent. Hosted: the app's
// managed identity (a bearer token for Azure DevOps; never logged or returned) creates the story under the parent
// feature, when this environment's live switch is on; otherwise preview only. The setup check runs at start.
// ADM-1: the destination and live switch are a Rule (Admin › Organization; the app config's values bootstrap it), so
// the service is rebuilt when an admin changes them.
type FeedbackTarget = { org: string; project: string; parentId: number; live: boolean } | null;
const feedbackCredential = host.kind === "local" ? null : new DefaultAzureCredential(process.env.AZURE_CLIENT_ID ? { managedIdentityClientId: process.env.AZURE_CLIENT_ID } : {});
const makeFeedback = (f: FeedbackTarget): FeedbackService => {
  const local = host.kind === "local";
  if (local || !f || !feedbackCredential) return createFeedbackService({ devops: null, mode: "preview_only", env: build.env, local, now: Date.now, log });
  const credential = feedbackCredential;
  const devops = createFeedbackDevOps({ fetch, log, token: async () => (await credential.getToken(DEVOPS_SCOPE)).token, target: { org: f.org, project: f.project, parentId: f.parentId } });
  return createFeedbackService({ devops, mode: f.live ? "live" : "preview_only", env: build.env, local: false, now: Date.now, log });
};
let feedbackHeld: { key: string; service: FeedbackService } = { key: JSON.stringify(app.feedback ?? null), service: makeFeedback(app.feedback ?? null) };
const currentFeedback = async (): Promise<FeedbackService> => {
  const f = (await org.rules().catch(() => null))?.organization.feedback ?? app.feedback ?? null;
  const key = JSON.stringify(f);
  if (key !== feedbackHeld.key) feedbackHeld = { key, service: makeFeedback(f) };
  return feedbackHeld.service;
};
const feedbackService: FeedbackService = {
  get mode() {
    return feedbackHeld.service.mode;
  },
  env: build.env,
  demo: false,
  check: async (force) => (await currentFeedback()).check(force),
  send: async (p) => (await currentFeedback()).send(p),
};
void feedbackService.check().catch(() => undefined);

const server = createApp({
  publicUrl: app.publicUrl,
  build,
  log,
  accounts,
  auth: {
    microsoft: entra,
    signedIn: async (u, tokens) => {
      const r = await people.signedIn(u, tokens);
      if ("refused" in r) return r;
      await adminCheck.signedIn(r.userId, u.groups ?? { kind: "none" }).catch(() => undefined);
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
  takeOpenRequest: async (s) => (s.demo ? null : ((await host.launch.takeOpenRequest()) ?? (await takeRouteFor(s.userId)))),
  reopen: reopenWindow,
  dbStatus: () => opened.status?.() ?? "ok",
  ...(telemetry ? { onRequest: telemetry.request } : {}),
  ctx: (s) => {
    if (s.demo) return demoFor(s.userId);
    lastUse = Date.now();
    return runtimeFor(s.userId);
  },
});
/**
 * A2: one person's runtime: their action context (their plan store; config, sources and secrets are still this
 * machine's until the settings and secrets steps) and their background ticks (reminders, the focus timer, Teams status),
 * started once per process for each person who signs in, and at start for everyone with a store (so a running timer
 * ends on time after a restart without anyone signing in).
 */
const runtimes = new Map<string, { ctx: ActionContext; who: Person; ticks: PersonTicks }>();
/** Runtimes being built (the store is async, so two requests at once must not build two). */
const starting = new Map<string, Promise<ActionContext>>();
function runtimeFor(userId: string): Promise<ActionContext> {
  const known = runtimes.get(userId);
  if (known) return Promise.resolve(known.ctx);
  let p = starting.get(userId);
  if (!p) {
    p = buildRuntime(userId).finally(() => starting.delete(userId));
    starting.set(userId, p);
  }
  return p;
}
async function buildRuntime(userId: string): Promise<ActionContext> {
  const settings = settingsFor(userId);
  const user = await accounts.users.get(userId);
  if (!(await settings.has())) await settings.seed(starterToml(user?.timeZone ?? host.clock.zone(), (await org.rules().catch(() => null))?.organization.newPerson));
  const who: Person = { userId, upn: user?.upn ?? null, zone: user?.timeZone ?? host.clock.zone(), process: {}, openStates: {}, settings, secrets: secretsFor(userId), snapshots: host.snapshotsFor(userId) };
  /** Their settings, with what the server keeps from them refreshed. */
  const loadConfig = async () => {
    const r = await settings.load();
    // ADM-1: the team's Rules, Defaults and Defaults by level over the person's own settings.
    if (r.parsed.ok) {
      const applied = await org.apply(r.parsed.config, userId).catch(() => null);
      if (applied) r.parsed = { ...r.parsed, config: applied };
    }
    if (r.parsed.ok) {
      who.zone = userZone(r.parsed.config);
      who.process = Object.fromEntries(Object.entries(r.parsed.config.org?.clients ?? {}).map(([k, c]) => [k, { noBreakdown: c.noBreakdown, background: c.background }]));
      who.openStates = Object.fromEntries(Object.entries(r.parsed.config.clientSettings).map(([k, v]) => [k, v.openStates]));
    }
    return r;
  };
  void loadConfig().catch(() => null);
  const plan = planFor(who);
  const push = pushFor(userId);
  const liveCtx: ActionContext = {
    log,
    ai: aiRuntime,
    renameNote: renamed.note,
    demo: demoControl(false),
    env: build.env,
    loadConfig,
    makeDataverse: dataverseFor(who),
    makeOutlook: outlookFor(who),
    makeGoogle: googleFor(who),
    makeDevOps: devopsFor(who),
    feedback: {
      service: feedbackService,
      sender: async () => {
        const u = await accounts.users.get(userId);
        return u ? { name: u.displayName, email: u.email ?? u.upn } : null;
      },
    },
    saveSystemUserId: (id) => settings.saveSystemUserId(id),
    signedInAs: async () => {
      const u = await accounts.users.get(userId);
      return u ? { email: u.email, upn: u.upn } : undefined;
    },
    writeConfig: (edit) => settings.write(edit),
    now: () => instantNow().toString(),
    plan,
    requests: requestsPort,
    org,
    adminOps,
    links: host.links,
    media,
    // A2: no `secrets`: the app's client secrets (Dataverse, Google, Entra) are set up outside FocusTime
    // (infra/scripts, the host's secret store or Key Vault), never from a person's Settings.
    // Step 14: personal DevOps write PATs (the host's secret store) and the writer (dev.azure.com of one client per call).
    writePats: writePatsOf(who),
    devopsWriter: createDevOpsWriter({ fetch, log }),
    takes,
    account: accountFor(who),
    photoCache: host.photos,
    push,
    azure: azureFor,
    exportPlan: (json) => host.files.exportPlan(json),
    myData: {
      export: async () => {
        const u = await accounts.users.get(userId);
        if (!u) throw new Error("Not signed in");
        log({ source: "plan", op: "data_export" });
        return exportUser(db, u, instantNow());
      },
      remove: async () => deleteData(userId),
    },
  };
  const ticks = personTicks({ log, now: instantNow, notifications: host.notifications, media: host.media, openRoute: (route) => void openRouteFor(userId, route).catch(() => undefined), push }, plan, liveCtx, who);
  runtimes.set(userId, { ctx: liveCtx, who, ticks });
  return liveCtx;
}

/**
 * A2: after a Microsoft sign-in, the person's refresh token goes into their encrypted secrets (the Outlook source and
 * everything on that sign-in use it), who they are is remembered in their store (as the Outlook sign-in did), and
 * their calendar sources start fresh. The store's owner, once (their first sign-in, or their first after an import as the
 * store's only person): the DevOps write PATs and the Google refresh token this machine's keyring holds are copied into
 * their secrets (server/owner-secrets.ts; the keyring entries stay).
 */
async function keepSignIn(userId: string, u: SignedIn, refreshToken: string, owner: boolean): Promise<void> {
  const ctx = (await runtimeFor(userId));
  const mine = secretsFor(userId);
  await mine.set("outlook-refresh-token", refreshToken).catch(() => log({ source: "auth", op: "refresh_token", kind: "not_kept" }));
  forgetCalendars(userId);
  await rememberIdentity(ctx.plan, { oid: u.oid, tid: u.tid, name: u.name, username: u.upn, email: u.email }, instantNow().toString());
  if (!ctx.plan) return;
  const copiedBefore = (await ctx.plan.markedDates(OWNER_SECRETS_MARK)).size > 0;
  if (!copiesOwnerSecrets({ owner, people: await accounts.users.count(), copiedBefore })) return;
  await ctx.plan.markOnce(OWNER_SECRETS_MARK, instantNow().toZonedDateTimeISO("UTC").toPlainDate().toString());
  const r = await copyOwnerSecrets({
    clientKeys: (await ctx.plan.devopsIdentities()).map((i) => i.clientKey),
    mine,
    keyring: { writePat: (k) => host.secrets.writePat.get(k), googleRefreshToken: () => host.secrets.get("google-refresh-token") },
  });
  log({ source: "plan", op: "owner_secrets_copied", kind: r.google ? "with_google" : "without_google", count: r.pats });
}

/** A person's Google source for the web sign-in, from their settings (null without [google]). */
async function googleOf(userId: string) {
  await runtimeFor(userId);
  const rt = runtimes.get(userId)!;
  const r = await rt.ctx.loadConfig();
  if (!r.parsed.ok || !r.parsed.config.google) return null;
  return googleFor(rt.who)(r.parsed.config.google, userZone(r.parsed.config));
}

/**
 * Settings > Data > Delete my data (A2): soft now (sign-in refused, sessions ended, background work stopped; the rows
 * stay), hard after 30 days (hardDeleteDue). Both are logged without the person's id.
 */
async function deleteData(userId: string): Promise<{ hardDeleteOn: string }> {
  const at = instantNow();
  await accounts.users.setDeleted(userId, at.toString());
  await recordSoftDelete(db, userId, at);
  await accounts.sessions.endAllFor(userId);
  // Their refresh tokens and write PATs go now (the rows of their data wait for the hard delete).
  await secretsFor(userId).clear();
  forgetCalendars(userId);
  runtimes.delete(userId);
  plans.delete(userId);
  log({ source: "plan", op: "data_delete", kind: "soft" });
  return { hardDeleteOn: at.add({ hours: 24 * HARD_DELETE_AFTER_DAYS }).toString().slice(0, 10) };
}
const hardDeletes = async () => {
  const n = await hardDeleteDue(db, instantNow()).catch(() => 0);
  if (n) log({ source: "plan", op: "data_delete", kind: "hard", count: n });
};

/** Step 15.5, A2: a clicked notification's view, kept in the person's store for their window, which is brought up. */
async function openRouteFor(userId: string, route: string): Promise<void> {
  const plan = plans.get(userId);
  if (!plan || !(await keepRoute(plan, route, instantNow()))) return;
  log({ source: "plan", op: "notify_route", kind: route.split(":")[0]! });
  void reopenWindow().then((ok) => log({ source: "plan", op: "notify_window", kind: ok ? "opened" : "unavailable" }));
}
async function takeRouteFor(userId: string): Promise<string | null> {
  const plan = plans.get(userId);
  const r = plan ? await takeRoute(plan, instantNow()) : null;
  if (r) log({ source: "plan", op: "notify_route", kind: "taken" });
  return r;
}

/** "Reopen FocusTime" from a window whose launch token is old (the host's; --no-reopen turns it off). */
function reopenWindow(): Promise<boolean> {
  return host.launch.reopen();
}



// ADM-1: the admin console's view of this FocusTime (server/admin-ops.ts): names, dates, counts and yes or no only.
/** A person's store for a short admin or bootstrap read (not their runtime's; that one follows their settings' zone). */
const storeOf = (userId: string, zone: string | null): PlanStore => plans.get(userId) ?? planStoreOn(db, { userId, now: () => zonedNow(zone ?? host.clock.zone()) });
const directorySource = app.dataverse
  ? createDataverseSource({ config: { ...app.dataverse, myEmail: "", mySystemUserId: null }, timeZone: host.clock.zone(), getSecret: () => host.secrets.get("dataverse-client-secret"), fetch, snapshots: host.snapshotsFor("focustime-app"), log })
  : null;
const adminOps = createAdminOps({
  check: adminCheck,
  org,
  groupId: app.adminGroupId,
  breakGlass: app.admins,
  tenantId: app.entra?.tenantId ?? null,
  users: () => accounts.users.all(),
  personStore: storeOf,
  hasSecret: (id, account) => secretsFor(id).has(account),
  chats: () => teams.chats(),
  conversationCounts: (day) => conversations.counts(day),
  ai: async () => ({ provider: aiProviderKind, keyConfigured: aiProviderKind === "stub" ? true : !!(await aiKey()) }),
  appSpentMicros: () => aiRuntime.appSpend.get(new Date().toISOString().slice(0, 7)),
  feedback: () => feedbackService.check(),
  build,
  directory: directorySource ? () => directorySource.directory() : null,
  removePerson: async (id) => {
    await deleteData(id);
    await hardDeleteUser(db, id, instantNow());
  },
  // The scheduler starts below; Status asks only once a person opens it.
  lastRuns: () => scheduler.lastRuns(),
  log,
});
const refreshPeople = () => adminOps.refreshPeople();

// ADM-1: the one-time move of team settings out of people's own settings, at the first start of this build.
// ADM-2: once at start, so a guest who signed in before this build is signed out.
void endGuestSessions().catch(() => 0);

void orgBootstrap({
  store: adminStore,
  log,
  people: async () => {
    const out: BootstrapPerson[] = [];
    for (const u of await accounts.users.all()) {
      if (u.deletedAt) continue;
      const settings = settingsFor(u.id);
      const loaded = await settings.load().catch(() => null);
      const plan = storeOf(u.id, u.timeZone);
      out.push({
        id: u.id,
        name: u.displayName || u.upn,
        config: loaded?.parsed.ok ? loaded.parsed.config : null,
        houseStyles: await plan.houseStyles().catch(() => []),
        write: async (edit) => !!(await settings.write(edit).then(() => true, () => false)),
      });
    }
    return out;
  },
}).then((r) => r.ran && org.invalidate(), () => log({ source: "plan", op: "org_bootstrap", kind: "failed" }));

// Everyone who has signed in before gets their background work back (a timer that was running ends on time), all of it
// run by one scheduler (server/scheduler.ts) that reads what is due from each person's rows. A3, the idle rule: the
// passes run while someone has used FocusTime in the last 15 minutes; otherwise the scheduler sleeps until the stored
// next-due time and makes no database call before it. Everyone's runtimes are built on the first pass (not at start,
// so an idle start reads nothing), and the app's own upkeep (hard deletes, ended sessions) rides on the slow pass.
let everyone = false;
// D514, Option A: the chats are read in the background every 5 minutes inside the union of followers' working hours in
// prod; dev (and the developer loop) read them only on Refresh, unless FOCUSTIME_REQUESTS_POLL says otherwise.
const pollInBackground = (process.env.FOCUSTIME_REQUESTS_POLL?.trim().toLowerCase() || (build.env === "prod" ? "on" : "off")) === "on";
log({ source: "plan", op: "requests_poll_mode", kind: pollInBackground ? "background" : "on_demand" });
// ADM-1: people's levels and client leads from Dataverse, once a day (the stored refresh time says when it's due).
const PEOPLE_EVERY_MS = 24 * 3600_000;
/** After a failed or impossible read, the next try is an hour on (in memory), so the scheduler can still sleep. */
let peopleRetryAt: Temporal.Instant | null = null;
const peopleDue = async (): Promise<Temporal.Instant> => {
  const at = await adminStore.directoryRefreshedAt();
  const due = at ? Temporal.Instant.from(at).add({ milliseconds: PEOPLE_EVERY_MS }) : instantNow();
  return peopleRetryAt && Temporal.Instant.compare(peopleRetryAt, due) > 0 ? peopleRetryAt : due;
};
const peopleJob = {
  name: "people_refresh",
  run: async () => {
    if (Temporal.Instant.compare(await peopleDue(), instantNow()) > 0) return;
    const r = await refreshPeople();
    peopleRetryAt = r.ok ? null : instantNow().add({ hours: 1 });
    if (r.ok) await endGuestSessions().catch(() => 0);
    log({ source: "dataverse", op: "people_refresh", kind: r.ok ? "done" : "failed", count: r.people });
  },
  wake: peopleDue,
};
const scheduler = createScheduler({
  jobs: [
    peopleJob,
    ...(pollInBackground
      ? [{
          name: "requests_poll",
          run: async () => void (await pollCycle(pollDeps)),
          wake: async () => {
            const due = await requestsNextDue(pollDeps);
            return due ? Temporal.Instant.from(due) : null;
          },
        }]
      : []),
  ],
  people: async () => {
    if (!everyone) {
      for (const u of await accounts.users.all()) if (!u.deletedAt) await runtimeFor(u.id);
      everyone = true;
    }
    return [...runtimes.values()].map((r) => r.ticks);
  },
  log,
  active: () => Date.now() - lastUse < ACTIVE_MS,
  wakeStore: wakeStoreOn(db, instantNow),
  maintenance: {
    everyMs: 3600_000,
    run: async () => {
      await hardDeletes();
      await accounts.sessions.sweep();
    },
  },
});
const stopScheduler = scheduler.start();

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`FocusTime is already running on port ${port} (perhaps as the focustime service). Open its window with: node scripts/open-window.ts`);
    process.exit(1);
  }
  throw e;
});
server.listen(port, host.kind === "azure" ? "0.0.0.0" : "127.0.0.1", async () => {
  // A2: the launch link is the public URL; signing in is what lets a window in, not the link.
  const url = `${app.publicUrl}/`;
  const launchFile = await host.launch.publish(url);
  process.stdout.write(`FocusTime running on ${app.publicUrl} (${dev ? "dev" : "built"} UI, ${host.kind} host)\nSettings: each person's, in the plan store (${cfgPath} only seeds its owner's once)\nSign-in: ${entra ? "Microsoft" : "not set up (add [entra] to the app config)"}${app.demo ? ", demo" : ""}\n${launchFile ? `Launch link: ${launchFile}\n` : ""}`);
  host.launch.openWindow(url);
});

const stop = async () => {
  stopScheduler();
  await telemetry?.flush();
  await host.launch.unpublish();
  await opened.close().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
