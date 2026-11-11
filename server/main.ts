// Start FocusTime: the server (A2: Microsoft sign-in and server-side sessions; the developer loop serves
// http://localhost:<port> and opens an app window on it).
// Usage: node server/main.ts [--dev] [--no-open] [--no-reopen] [--port 5317] [--clock <ISO instant>]
// FOCUSTIME_HOST=local|azure (A1) picks the host: local (the default) is the developer loop on this machine; azure is
// the hosted app's host, a stub until A2 (its secrets, snapshots and plan store are in memory).
// --clock (verification runs only): the server's clock starts at that instant and runs forward from there.
import { createSendClient, type SendClient } from "../sources/graph/send.ts";
import { createChatsClient, type ChatMessagesClient, type ChatsClient } from "../sources/graph/chats.ts";
import type { Host, KeyProvider, SnapshotStore } from "../host/types.ts";
import { perPerson } from "../host/per-person.ts";
import { createUserSecrets, type UserSecrets } from "../store/user-secrets.ts";
import { createPushDevices } from "../store/push-devices.ts";
import { createCalendarLinks } from "../store/calendar-links.ts";
import { createLinkCalendars } from "../sources/ics/source.ts";
import { createIcsGet } from "./ics-fetch.ts";
import { createPush, type VapidSource } from "./push.ts";
import { keyVaultSecret } from "../host/azure/vapid.ts";
import { openAiProvider } from "../ai/openai.ts";
import { createAssistantHub } from "./assistant.ts";
import { stubProvider } from "../ai/stub.ts";
import type { AiProvider } from "../ai/types.ts";
import type { AiRuntime } from "../actions/ai-actions.ts";
import { appSpendStore } from "../store/ai-spend.ts";
import { takesStore } from "../store/devops-takes.ts";
import { notesStore } from "../store/devops-notes.ts";
import { teamStore } from "../store/team-store.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { WritePats } from "../actions/devops-write-actions.ts";
import { createLocalHost } from "../host/local/index.ts";
import { createAzureHost } from "../host/azure/index.ts";
import { keyVaultDataKey } from "../host/azure/datakey.ts";
import { envSecrets } from "../host/azure/secrets.ts";
import { appKeyStore } from "../store/app-keys.ts";
import { appInsights } from "../log/appinsights.ts";
import { DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";
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
import { retentionJob } from "./retention-job.ts";
import { ownershipBackfillJob } from "../actions/ownership-backfill.ts";
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
import { jobRunner, plainJob, type JobRunner } from "../log/operation.ts";
import { cycleCounts, telemetryStatusSource } from "./telemetry-status.ts";
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
import { createDemoContext, seedDemo, type DemoControl, type DemoRealAi } from "./demo.ts";
import { buildInfo } from "./buildinfo.ts";
import { backgroundPolicy, type BackgroundName } from "../config/background-policy.ts";
import { backgroundStatusSource } from "./background-status.ts";
import { execFileSync } from "node:child_process";
import type { ActionContext } from "../actions/dispatch.ts";
import { userZone } from "../week/zone.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { pollCycle, requestsNextDue, type PollDeps, type PollPerson } from "../actions/request-poll.ts";
import { requestContext, aiFor, escalationHours, dispatch, meetingPerson, audienceRulesOf } from "../actions/dispatch.ts";
import { createTeamsEndpoint } from "./teams/sdk.ts";
import { BLOCKED_KEY, createRhythm, pacedSender, type Rhythm, type Takeover } from "./teams/rhythm.ts";
import { createTeamsRhythmStore } from "../store/teams-rhythm-store.ts";
import { takeoversOf } from "../plan/teams-rhythm.ts";
import type { ActionName } from "../actions/registry.ts";
import { createBotCore } from "./teams/bot.ts";
import { teamsAssistant } from "./teams/assistant.ts";
import { createTeamsBotStore } from "../store/teams-bot-store.ts";
import { TEAMS_APP_IDS } from "./teams/app-ids.ts";
import { teamsAppLink } from "../plan/invite.ts";
import { createConversationStore } from "../store/conversation-store.ts";
import { createMeetingStore } from "../store/meeting-store.ts";
import { createMeetingsClient, type MeetingsClient } from "../sources/graph/meetings.ts";
import { canView, graphReadable } from "../plan/meetings.ts";
import { meetingJob } from "./meeting-job.ts";
import { inviteDomains } from "../config/schema.ts";
import type { MeetingUser } from "../actions/meeting-actions.ts";
import { whoRepair, type WhoRepairPerson } from "./who-repair.ts";
import { heldRecheckOnce, recheckHeld } from "../actions/held-recheck.ts";
import { upkeep as upkeepConversations } from "../actions/conversation-upkeep.ts";
import { backfillRequests } from "../actions/conversation-backfill.ts";
import { weekConfig } from "../config/defaults.ts";
import type { RequestsPort } from "../actions/request-actions.ts";
import { createAdminCheck } from "../actions/admin.ts";
import { createOrgRuntime } from "../actions/org.ts";
import { scopeDepsOf } from "../actions/scope-deps.ts";
import { assigneesOf } from "../actions/identities.ts";
import type { ClientScopeFacts } from "../actions/admin-actions.ts";
import { createAdminOps } from "./admin-ops.ts";
import { standardsJob } from "./standards-job.ts";
import { createStandardsReader } from "../sources/github/standards.ts";
import { standardsStoreOn } from "../store/standards-store.ts";
import { parseRepoUrl } from "../plan/standards.ts";
import type { StandardsPort } from "../actions/standards.ts";
import { createDevOpsPoller, createLimiter, devopsStatusSource, NO_SNAPSHOTS, pollAccounts, type DevOpsPoller } from "../actions/devops-poll.ts";
import { clientAccountsStatusSource } from "../actions/client-accounts-status.ts";
import { createStatusRegistry } from "../actions/status-rows.ts";
import { createDevOpsStore } from "../store/devops-store.ts";
import { DEFAULT_MINUTES } from "../plan/devops-pace.ts";
import { ORG_SPECS, type OrgRules } from "../config/org.ts";
import { createUseSignal } from "./use.ts";
import type { TimeModel } from "../week/hours.ts";
import { createAdminStore, FOCUSTIME } from "../store/admin-store.ts";
import { inGroup } from "../sources/graph/groups.ts";
import { orgBootstrap, type BootstrapPerson } from "./org-bootstrap.ts";

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
  process.env.FOCUSTIME_HOST === "azure" && process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ? appInsights({ connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING, next: stderrLogger, root }) : null;
const log = telemetry?.log ?? stderrLogger;
/** HK-1: background work as job operations (each run its own, with outcome and counts); a plain call without telemetry. */
const jobs: JobRunner = telemetry ? jobRunner({ done: telemetry.job, onError: (e) => telemetry.exception(e, "job") }) : plainJob;
// HK-1: an error that would end the process is reported first (best effort; this listener changes nothing about it).
if (telemetry) process.on("uncaughtExceptionMonitor", (e) => telemetry.exception(e, "uncaught"));

const hostKind = process.env.FOCUSTIME_HOST ?? "local";
// ENV-1: outside production, nothing happens on its own. The one decision from the environment about background work
// (config/background-policy.ts), made once here and handed to the scheduler, everyone's ticks and the on-demand paths.
const background = backgroundPolicy(process.env);
/**
 * ENV-1: work at server start, under its policy name: it runs only where the policy allows it (a test checks that every
 * top-level start-up call in this file goes through here).
 */
function atStart(name: BackgroundName, run: () => Promise<unknown>): Promise<void> {
  if (!background.allows(name)) return Promise.resolve(void log({ source: "plan", op: "startup", kind: `off:${name}` }));
  return run().then(() => undefined);
}
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
const meetingClients = new WeakMap<object, MeetingsClient>();
const sendClients = new WeakMap<object, SendClient>();
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
  // MC-1: registered meetings only: the calendar token for the series and its instances, the meetings token
  // (OnlineMeetings.Read, OnlineMeetingTranscript.Read.All) for the transcript, which the gate allows only for a
  // registered, Automatic call organized at Cooptimize (checked before every request).
  let meetings = meetingClients.get(src);
  if (!meetings)
    meetingClients.set(src, (meetings = createMeetingsClient({
      fetch,
      calendarToken: () => src.auth.accessToken("read"),
      meetingsToken: () => src.auth.accessToken("meetings"),
      invalidate: () => src.auth.invalidate(),
      gate: { allowed: async (q) => { const s = await meetingStore.registered(q).catch(() => null); return !!s && graphReadable(s); } },
      homeDomains: inviteDomains(cfg),
      log,
    })));
  // LP-1: Close the loop's sends as me, each on its own consented token (sources/graph/send.ts).
  let sender = sendClients.get(src);
  if (!sender)
    sendClients.set(src, (sender = createSendClient({
      fetch,
      chatToken: () => src.auth.accessToken("send"),
      chatReadToken: () => src.auth.accessToken("messages"),
      mailToken: () => src.auth.accessToken("mail"),
      mailSendToken: () => src.auth.accessToken("mail_send"),
      invalidate: () => src.auth.invalidate(),
      log,
    })));
  return {
    sender,
    meetings,
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

// DevOps: one source per person and Dataverse config. DV-1: they read the central poller's store (set up below, once
// the plan store is open); without it, PATs come from Dataverse per fetch (devopsTargets), not kept.
const devopsSources = new Map<string, DevOpsSource>();
/** DV-1: each client's limits, shared by the poller and everyone's reads on demand. */
const devopsLimiter = createLimiter(() => Temporal.Now.instant());
let devopsPoller: DevOpsPoller | null = null;
/** DV-1's store (the poller writes it); TB-2 reads its change log for the takeover nudge. */
let devopsStoreRef: ReturnType<typeof createDevOpsStore> | null = null;
/** TB-2: the bot's rhythm in Teams, once the bot is up (hosted app only). */
let rhythm: Rhythm | null = null;
/** DV-1: Admin › Status's rows registry (actions/status-rows.ts). */
const statusRows = createStatusRegistry();
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
/** AH-2: each client's DevOps scope and who is a Cooptimizer (read when a screen reads the store). */
const devopsScope = (clientKey: string) => scopeDepsOf(org)(clientKey);
/** AH-3: this person's linked client logins and Cooptimizers' FocusTime names, for the DevOps source. */
const devopsIdentitiesOf = (who: Person) => async (clientKey: string) => {
  const [ix, writes] = await Promise.all([org.identities(), planFor(who).devopsIdentities().catch(() => [])]);
  return {
    mine: [...ix.emailsOf(clientKey, who.userId), ...writes.filter((w) => w.clientKey === clientKey).map((w) => w.email)],
    nameOf: (e: string) => ix.personOf(clientKey, e)?.name ?? null,
  };
};
const devopsFor = (who: Person) => (cfg: DataverseConfig, timeZone: string) => {
  const key = JSON.stringify([who.userId, cfg, timeZone]);
  let s = devopsSources.get(key);
  if (!s) {
    const dv = dataverseFor(who)(cfg, timeZone);
    // DV-1: with the central poller, screens read its store: Dataverse here says only which clients this person may
    // see (active Account Worker) and their DevOps identity, never the PAT. Without it (no app Dataverse), as before.
    s = devopsPoller
      ? createDevOpsSource({ fetch, log, snapshots: who.snapshots, timeZone, targets: (keys) => dv.devopsTargets(keys, { withPat: false }), processOverrides: (k) => who.process[k] ?? {}, openStates: (k) => who.openStates[k] ?? [], onItems: itemMapOf(who), central: devopsPoller.reads, limiter: devopsLimiter, scope: devopsScope, identities: devopsIdentitiesOf(who) })
      : createDevOpsSource({ fetch, log, snapshots: who.snapshots, timeZone, targets: (keys) => dv.devopsTargets(keys), processOverrides: (k) => who.process[k] ?? {}, openStates: (k) => who.openStates[k] ?? [], onItems: itemMapOf(who) });
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
    return { name: user.displayName || user.upn, config, chatMessages: account?.chatMessages, chats: account?.chats, ai: () => aiFor(ctx), pipelineAi: () => aiFor(ctx, { cap: "app" }), plan: ctx.plan ?? null, openItems: rc.openItems, ...(rc.boundary ? { boundary: rc.boundary } : {}) };
  },
  homeTenant: async () => app.entra?.tenantId ?? null,
  // GD-2: a chat's audience from its members, by the people rule (guests, automation accounts, other domains).
  audienceRules: (home) => audienceRulesOf(org, home),
  now: () => instantNow().toString(),
  log,
  // ADM-2 (D604): the team's Rules, read each cycle (the org runtime holds them 30 seconds).
  rules: async () => {
    const r = (await org.rules()).conversations;
    return { pollMinutes: r.pollMinutes, retentionDays: r.retentionDays };
  },
};
// CV-1: conversations, commitments and suggestions, shared like the chats (D521's viewer gates every read).
// MC-1: the registered client calls (app tables). A call's shared commitments live in conversations under the pseudo
// chat meeting:<series>, seen only by its reviewers and attendees.
const meetingStore = createMeetingStore(db, instantNow);
const meetingUsers = async (): Promise<MeetingUser[]> => (await accounts.users.all()).filter((u) => !u.deletedAt).map((u) => ({ id: u.id, name: u.displayName || u.upn, emails: [u.email, u.upn].filter((e): e is string => !!e) }));
const conversations = createConversationStore(db, instantNow, teams, async (chatId, userId) => {
  const s = await meetingStore.series(Number(chatId.slice("meeting:".length)));
  return !!s && !s.removedAt && canView(s, userId);
});
// PV-1: Take one's notices to the previous assignee (an app table).
const takes = takesStore(db, instantNow);
const devopsNotes = notesStore(db, instantNow);
// SW-1: sends, week commitments, client priorities and Ask to look, shared by everyone (app tables).
const team = teamStore(db, instantNow);
pollDeps.conversations = conversations;
// CV-1 migration (add-only, D468): AP-1's requests become conversations once; idempotent, so every start may run it.
await atStart("startup_upkeep", () =>
  backfillRequests(teams, conversations, app.entra?.tenantId ?? null).then(
    (n) => n && log({ source: "plan", op: "requests_moved", count: n }),
    () => log({ source: "plan", op: "requests_moved", kind: "failed" }),
  ),
);
pollDeps.upkeep = (now) => jobs("conversations_upkeep", {}, () => upkeep(now));
async function upkeep(now: string): Promise<void> {
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
}
// ENV-1: outside production, Refresh reads only with the sign-in of the person who pressed it and runs no upkeep.
const requestsPort: RequestsPort = {
  teams,
  refresh: (chatIds, by) => jobs("requests_refresh", {}, async (job) => cycleCounts(job, await pollCycle(pollDeps, { force: true, chatIds, ...(background.production ? {} : { onlyAs: by ?? "", upkeep: false }) }))),
  conversations,
  users: pollDeps.users,
};
// D475: next-morning auto-shutdown restores from before (they'd write the schedule) never run; mark them cancelled.
await atStart("startup_upkeep", () =>
  cancelShutdownRestores(db, instantNow).then(
    (c) => c.length && log({ source: "azure", op: "restore_cancelled", count: c.length }),
    () => log({ source: "azure", op: "restore_cancelled", kind: "failed" }),
  ),
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
/**
 * A3: when a signed-in person last used FocusTime (in memory; the idle rule's "someone is active"). HK-3: real use only
 * (the page marks timer calls as background), for the team's Rule's minutes (org.idle_minutes, read from memory).
 */
const use = createUseSignal({ now: () => Date.now(), idleMinutes: () => orgRulesNow?.organization.idleMinutes ?? ORG_SPECS["org.idle_minutes"].builtin });
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
/** CAL-1: the guarded getter every calendar link is fetched through (https only, DNS answers checked at connect). */
const icsGet = createIcsGet();
const pushFor = (userId: string) => createPush({ devices: createPushDevices({ db, userId, keys: host.keys, now: instantNow }), vapid: vapidSource, subject: app.publicUrl, fetch, now: () => Date.now(), log });

// ADM-1: the team's settings, people's levels and client leads, and admin audit (app tables), and who is an admin.
const adminStore = createAdminStore(db, instantNow);
// ADM-2 (D599): who signed in, for the one person match: their Entra id, email and UPN, and the Dataverse user their
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
  // ADM-2 (D602): guests are refused at sign-in, from the token and the domains Rule (never Dataverse).
  cooptimizeDomains: async () => (await org.rules()).organization.inviteDomains,
  refusedGuest: async (u, why) => {
    const ended = await accounts.sessions.endAllFor(u.oid);
    await adminStore.audit(FOCUSTIME, { area: "people", target: (u.name || "A guest").slice(0, 200), setting: "sign_in", oldValue: null, newValue: null, note: `refused: not a Cooptimize account (${why})${ended ? `, ${ended} session${ended === 1 ? "" : "s"} ended` : ""}` });
  },
  log,
});

/**
 * ADM-2 (D602): ends the sessions of anyone signed in who turns out to be a guest or outside the Cooptimize domains
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
const demoFeedbackParent = ((v) => (v === "missing" || v === "wrong_type" || v === "no_pat" || v === "no_access" || v === "fail" ? v : "ok"))(process.env.FOCUSTIME_DEMO_FEEDBACK_PARENT);
const demoControl = (on: boolean): DemoControl => ({ on, set: async () => {} });
/** DM-1: the app's real AI, lent to the demo for its fictional data: only while the team's switch is on and under the app's cap. */
const demoRealAi: DemoRealAi = {
  runtime: aiRuntime,
  allowed: async () => {
    const r = (await org.rules().catch(() => null))?.ai;
    if (!r?.on) return false;
    return (await aiRuntime.appSpend.get(new Date().toISOString().slice(0, 7))) < Math.round((r.appCapUsd ?? app.ai.appCapUsd) * 1_000_000);
  },
};
/** A demo session's context, seeded. Reset demo (DM-1) builds a new one the same way and puts it in place. */
const buildDemo = async (userId: string): Promise<ActionContext> => {
  const ctx = createDemoContext({ now: () => instantNow().toString(), demo: { on: true, set: async () => {}, reset: () => resetDemo(userId) }, feedbackParent: demoFeedbackParent, realAi: demoRealAi, publicUrl: app.publicUrl });
  ctx.env = "demo";
  await seedDemo(ctx);
  return ctx;
};
const resetDemo = async (userId: string): Promise<void> => {
  const next = buildDemo(userId);
  await next;
  const old = demos.get(userId);
  demos.set(userId, next);
  // The old one's store closes once the request that asked for the reset has answered.
  setTimeout(() => void old?.then((c) => c.plan?.close()).catch(() => {}), 10_000).unref();
};
const demoFor = (userId: string): Promise<ActionContext> => {
  let c = demos.get(userId);
  if (!c) {
    c = buildDemo(userId);
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

// F1, FB-1: Send feedback goes to the org.feedback Rule (Admin › Organization; the app config's [feedback] bootstraps
// it). Each person's story is created through the write framework with their own DevOps write PAT (actions/dispatch.ts);
// there is no app identity for DevOps.
const feedbackTarget = async () => {
  const f = (await org.rules().catch(() => null))?.organization.feedback ?? app.feedback ?? null;
  return f ? { org: f.org, project: f.project, parentId: f.parentId } : null;
};

/** AS-1: the assistant by person (Entra object id), for TB-1's Teams bot: their own context, absolute links. */
export const assistants = createAssistantHub({ ctxFor: (userId) => runtimeFor(userId) });

// TB-1: the FocusTime bot in Teams, in the hosted app only (the Azure Bot reaches the public URL; its identity's token
// exists only there). FOCUSTIME_BOT_APP_ID is the bot's Microsoft App ID, its user-assigned identity's client id
// (infra/modules/bot.bicep); replies use that identity's token for the Bot Framework scope, held in memory by the
// credential. The assistant (AS-1) answers through the hub below, for the person the gate let in.
const botAppId = (process.env.FOCUSTIME_BOT_APP_ID ?? "").trim();
const teamsBot =
  host.kind === "azure" && botAppId && app.entra
    ? await (async () => {
        const credential = new ManagedIdentityCredential({ clientId: botAppId });
        const tenantId = app.entra!.tenantId;
        return createTeamsEndpoint({
          appId: botAppId,
          tenantId,
          token: async (scope) => (await credential.getToken(scope)).token,
          log,
          core: (sender) => {
            // TB-2: the rhythm sends through the same connector client, paced (10 a second, retries with backoff).
            const paced = pacedSender(sender);
            const botStoreOf = (userId: string) => createTeamsBotStore({ db, userId, now: instantNow });
            const configOf = async (userId: string) => {
              const r = await (await runtimeFor(userId)).loadConfig().catch(() => null);
              return r?.parsed.ok ? r.parsed.config : null;
            };
            rhythm = createRhythm({
              publicUrl: app.publicUrl,
              sender: paced,
              botStore: botStoreOf,
              store: (userId) => createTeamsRhythmStore({ db, userId, now: instantNow }),
              plan: async (userId) => (await runtimeFor(userId)).plan,
              run: async (userId, action, input) => dispatch(await runtimeFor(userId), { action: action as ActionName, input }),
              config: configOf,
              assistant: teamsAssistant(assistants, app.publicUrl),
              takeovers: (userId, since) => takeoversFor(userId, since),
              blocked: async (userId) => {
                // 403 MessageWritesBlocked: nothing more goes to that chat until they add the app or message again.
                const ctx = await runtimeFor(userId);
                await botStoreOf(userId).chatRemoved();
                await ctx.plan?.setState(BLOCKED_KEY, instantNow().toString());
                await dispatch(ctx, { action: "settings.save", input: { section: "notify", values: { teamsMessages: false } } });
              },
              log: (r) => log({ source: "server", ...r, op: `teams_${r.op}` }),
              now: instantNow,
            });
            return createBotCore({
              publicUrl: app.publicUrl,
              gate: {
                tenantId,
                user: async (oid) => {
                  const u = await accounts.users.get(oid);
                  return u ? { id: u.id, upn: u.upn, email: u.email, deletedAt: u.deletedAt } : null;
                },
                isCooptimizer: async (oid) => (await org.levels()).people.isCooptimizer(oid),
              },
              assistant: teamsAssistant(assistants, app.publicUrl),
              store: (userId) => createTeamsBotStore({ db, userId, now: instantNow }),
              sender,
              log: (r) => log({ source: "server", ...r, op: `teams_${r.op}` }),
              now: instantNow,
              onUse: () => use.used(),
              rhythm,
              onChat: async (userId) => {
                const plan = (await runtimeFor(userId)).plan;
                if (plan && (await plan.getState(BLOCKED_KEY))) await plan.setState(BLOCKED_KEY, null);
              },
            });
          },
        });
      })().catch(() => {
        log({ source: "server", op: "teams_bot", kind: "not_started" });
        return null;
      })
    : null;

/**
 * TB-2: items assigned to me that someone else gave to another person, from DV-1's change log, on my clients: my
 * names are my sign-in name and my DevOps identities' names (the log keeps the assignee's display name only).
 */
async function takeoversFor(userId: string, since: string): Promise<Takeover[]> {
  const store = devopsStoreRef;
  if (!store) return [];
  const ctx = await runtimeFor(userId);
  const loaded = await ctx.loadConfig().catch(() => null);
  const c = loaded?.parsed.ok ? loaded.parsed.config : null;
  if (!c || !ctx.plan) return [];
  const me = await storedIdentity(ctx.plan).catch(() => null);
  const ids = await ctx.plan.devopsIdentities().catch(() => []);
  const signed = await ctx.signedInAs?.().catch(() => undefined);
  const names = [me?.name ?? "", ...ids.map((i) => i.name)];
  const emails = [me?.email ?? "", me?.username ?? "", signed?.email ?? "", signed?.upn ?? "", ...ids.map((i) => i.email)];
  const out: Takeover[] = [];
  for (const clientKey of Object.keys(c.clientSettings)) {
    const changes = await store.changes(clientKey, since).catch(() => []);
    const hits = takeoversOf(changes, { names, emails });
    if (!hits.length) continue;
    const items = new Map((await store.items(clientKey).catch(() => [])).map((i) => [i.id, i]));
    for (const h of hits) {
      const t = items.get(h.itemId)?.fields["System.Title"];
      out.push({ key: `${clientKey}-${h.key}`.replace(/[^A-Za-z0-9_.:+-]/g, "_").slice(0, 100), itemId: h.itemId, title: typeof t === "string" ? t.slice(0, 200) : null, clientName: c.clientSettings[clientKey]?.name ?? clientKey, byName: h.byName, at: h.at });
    }
  }
  return out;
}

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
  ...(telemetry ? { onRequest: telemetry.request, onError: telemetry.exception } : {}),
  ctx: (s) => (s.demo ? demoFor(s.userId) : runtimeFor(s.userId)),
  teams: teamsBot,
  // HK-3: only real use keeps the server awake; the Rule's minutes go back to the page. A demo session never counts.
  onUse: (s) => {
    if (s.demo) return null;
    const wasIdle = !use.active();
    use.used(s.userId);
    if (wasIdle) void refreshRules();
    return use.minutes();
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
    background,
    loadConfig,
    makeDataverse: dataverseFor(who),
    makeOutlook: outlookFor(who),
    makeGoogle: googleFor(who),
    linkCalendars: createLinkCalendars({ store: createCalendarLinks({ db, userId, keys: host.keys, now: instantNow }), get: icsGet, log, timeZone: () => who.zone, now: instantNow }),
    makeDevOps: devopsFor(who),
    feedback: {
      target: feedbackTarget,
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
    standards: standardsPort,
    links: host.links,
    media,
    // A2: no `secrets`: the app's client secrets (Dataverse, Google, Entra) are set up outside FocusTime
    // (infra/scripts, the host's secret store or Key Vault), never from a person's Settings.
    // Step 14: personal DevOps write PATs (the host's secret store) and the writer (dev.azure.com of one client per call).
    writePats: writePatsOf(who),
    devopsWriter: createDevOpsWriter({ fetch, log }),
    takes,
    devopsNotes,
    devopsStored: async (k, v) => devopsPoller?.reads.stored?.(k, v),
    team,
    // ENV-1: Check now looks once with this person's sign-in (the job below; production and test sites alike).
    meetings: { store: meetingStore, users: meetingUsers, checkNow: (seriesId, uid) => meetings.checkNow(seriesId, uid) },
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
  // TB-2: the rhythm in Teams for this person (only where the bot runs), and Settings › Notifications › In Teams.
  // Read at call time: a runtime may be built before the bot finishes starting.
  const botHere = host.kind === "azure" && !!botAppId;
  const teams = botHere
    ? { tick: async (f: Parameters<Rhythm["tick"]>[1]) => void (await rhythm?.tick(userId, f)), wake: async (c: Parameters<Rhythm["wake"]>[1]) => (rhythm ? rhythm.wake(userId, c) : null) }
    : undefined;
  if (botHere)
    liveCtx.teams = {
      status: async () => {
        const chat = await createTeamsBotStore({ db, userId, now: instantNow }).chat().catch(() => null);
        return { chat: !!chat && !chat.removedAt, blocked: !!(await plan?.getState(BLOCKED_KEY).catch(() => null)) };
      },
      test: async (kind) => (rhythm ? rhythm.test(userId, kind) : { ok: false, message: "FocusTime in Teams isn't running right now. Try again in a minute." }),
    };
  const ticks = personTicks({ log, policy: background, now: instantNow, notifications: host.notifications, media: host.media, openRoute: (route) => void openRouteFor(userId, route).catch(() => undefined), push, ...(teams ? { teams } : {}) }, plan, liveCtx, who);
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
// KB-1: Cooptimize's standards, read from public GitHub (GET only, no token) and kept as data. FOCUSTIME_DEMO servers
// (the e2e harness) and FOCUSTIME_STANDARDS_SYNC=off make no outside request; demo sessions have their own library.
const standardsStore = standardsStoreOn(db);
const standardsSyncOn = process.env.FOCUSTIME_STANDARDS_SYNC !== "off" && !process.env.FOCUSTIME_DEMO;
const standards = standardsJob({ store: standardsStore, reader: createStandardsReader({ fetch }), source: async () => (await org.rules()).standards, now: instantNow, log });
const standardsPort: StandardsPort = { library: () => standardsStore.library(parseRepoUrl), state: () => standardsStore.state(), syncNow: () => (standardsSyncOn ? standards.syncNow() : Promise.resolve({ ok: false, changed: false, error: "The sync is off on this server" })) };
const adminOps = createAdminOps({
  standards: standardsPort,
  statusRows,
  check: adminCheck,
  org,
  groupId: app.adminGroupId,
  breakGlass: app.admins,
  tenantId: app.entra?.tenantId ?? null,
  users: () => accounts.users.all(),
  personStore: storeOf,
  // IN-1: Who's set up. The Teams app is known only where the bot runs (its 1:1 chat row, not removed); the invite links
  // to the app in Teams only there, by this environment's fixed app id.
  teamsApp: teamsBot
    ? async (id) => {
        const chat = await createTeamsBotStore({ db, userId: id, now: instantNow }).chat();
        return !!chat && !chat.removedAt;
      }
    : null,
  lastSeen: () => accounts.sessions.lastSeenByUser(),
  invite: { appUrl: `${app.publicUrl}/`, teamsAppLink: teamsBot && (build.env === "dev" || build.env === "prod") ? teamsAppLink(TEAMS_APP_IDS[build.env]) : null },
  hasSecret: (id, account) => secretsFor(id).has(account),
  chats: () => teams.chats(),
  conversationCounts: (day) => conversations.counts(day),
  ai: async () => ({ provider: aiProviderKind, keyConfigured: aiProviderKind === "stub" ? true : !!(await aiKey()) }),
  appSpentMicros: () => aiRuntime.appSpend.get(new Date().toISOString().slice(0, 7)),
  feedback: feedbackTarget,
  build,
  directory: directorySource ? () => directorySource.directory() : null,
  removePerson: async (id) => {
    await deleteData(id);
    await hardDeleteUser(db, id, instantNow());
  },
  // The scheduler starts below; Status asks only once a person opens it.
  lastRuns: () => scheduler.lastRuns(),
  // AH-2: counts per area path and team from the central store (the poller and its app source are set up below).
  scope: async (keys) => {
    if (!devopsPoller || !devopsApp) return {};
    const deps = scopeDepsOf(org);
    const rows = await Promise.all(
      keys.map(async (k) => {
        const [view, d0] = await Promise.all([devopsPoller!.reads.view(k, { force: false }), deps(k)]);
        const facts: ClientScopeFacts = { counts: d0 ? devopsApp!.internal.scopeCounts(view, k, d0.isCooptimizer) : null, areasProblem: view.areas?.areasProblem ?? null, teamsProblem: view.areas ? view.areas.teamsProblem : null, readAt: view.areas?.readAt ?? null };
        return [k, facts] as const;
      }),
    );
    return Object.fromEntries(rows);
  },
  // AH-3: who is assigned work on each client, by DevOps email and display name (for client-login matching only).
  assignees: async (keys) => {
    if (!devopsPoller) return {};
    const rows = await Promise.all(keys.map(async (k) => [k, assigneesOf((await devopsPoller!.reads.view(k, { force: false })).values)] as const));
    return Object.fromEntries(rows);
  },
  log,
});
const refreshPeople = () => adminOps.refreshPeople();

// DV-1: central DevOps polling (actions/devops-poll.ts): one job reads each client account's DevOps once for everyone
// into the store (devops_items, devops_changes, devops_poll); screens read the store. The read PAT comes from Dataverse
// with the app's own access and stays in the poller's memory (10 minutes). Built only where the app has Dataverse.
let orgRulesNow: OrgRules | null = null;
const refreshRules = async () => (orgRulesNow = await org.rules().catch(() => orgRulesNow));
const devopsApp = directorySource
  ? createDevOpsSource({
      fetch,
      log,
      snapshots: NO_SNAPSHOTS,
      timeZone: host.clock.zone(),
      targets: (keys) => directorySource.accountTargets(keys),
      processOverrides: (k) => ({ noBreakdown: orgRulesNow?.clients[k]?.noBreakdown ?? [], background: orgRulesNow?.clients[k]?.background ?? [] }),
      openStates: (k) => orgRulesNow?.clients[k]?.openStates ?? [],
      limiter: devopsLimiter,
    })
  : null;
/** A client's followers who use FocusTime (live users who work on the client). */
const followerIds = async (clientKey: string) => {
  const users = new Map((await accounts.users.all()).filter((u) => !u.deletedAt).map((u) => [u.id.toLowerCase(), u.id]));
  return [...new Set((await adminStore.peopleClients()).filter((p) => p.clientKey === clientKey).map((p) => users.get(p.personId.toLowerCase())).filter((x): x is string => !!x))];
};
/** DV-2: followers per client, kept 5 minutes, so "is a follower working late?" is a memory read on most ticks. */
const followersMemo = new Map<string, { at: number; ids: string[] }>();
const activeFollower = async (clientKey: string) => {
  // Nobody active at all: no read (the database stays asleep, D431).
  if (!use.active()) return false;
  let hit = followersMemo.get(clientKey);
  if (!hit || Date.now() - hit.at >= 5 * 60_000) followersMemo.set(clientKey, (hit = { at: Date.now(), ids: await followerIds(clientKey).catch(() => hit?.ids ?? []) }));
  return hit.ids.some((id) => use.activeUser(id));
};
/** The union of a client's followers' own working hours (people who use FocusTime and work on the client). */
const followerHours = async (clientKey: string) => {
  const ids = await followerIds(clientKey);
  const hours: TimeModel[] = [];
  for (const id of ids) {
    const loaded = await (await runtimeFor(id)).loadConfig().catch(() => null);
    if (loaded?.parsed.ok) hours.push(loaded.parsed.config.week.hours);
  }
  return hours;
};
devopsPoller = devopsApp && directorySource
  ? createDevOpsPoller({
      store: (devopsStoreRef = createDevOpsStore(db, instantNow)),
      source: () => devopsApp.internal,
      limiter: devopsLimiter,
      accounts: (asked) =>
        pollAccounts({
          peopleClients: () => adminStore.peopleClients(),
          users: async () => (await accounts.users.all()).map((u) => ({ id: u.id, deleted: !!u.deletedAt })),
          targets: (keys) => directorySource.accountTargets(keys, { withPat: false }),
          asked,
        }),
      targets: (keys) => directorySource.accountTargets(keys),
      hours: followerHours,
      ruleMinutes: async () => (await refreshRules())?.devops.pollMinutes ?? DEFAULT_MINUTES,
      active: use.active,
      activeFor: activeFollower,
      now: instantNow,
      log,
      job: jobs,
    })
  : null;
if (devopsPoller) statusRows.register(devopsStatusSource(devopsPoller));
// CV-3b: whether account types are read (the client rule fails closed until they are), with Refresh.
statusRows.register(clientAccountsStatusSource({ accounts: () => org.clientAccounts(), refreshedAt: () => adminStore.directoryRefreshedAt(), refresh: () => refreshPeople() }));
// HK-1: telemetry's own health in Admin › Status: one row, a warning once anything was dropped or refused.
if (telemetry) statusRows.register(telemetryStatusSource(telemetry));
// ENV-1: on a test site, what runs only on a button, and a declared chat watch period (production: nothing added).
const backgroundRows = backgroundStatusSource(background);
if (backgroundRows) statusRows.register(backgroundRows);

// ADM-1: the one-time move of team settings out of people's own settings, at the first start of this build.
// ADM-2: once at start, so a guest who signed in before this build is signed out.
void atStart("startup_upkeep", () => endGuestSessions()).catch(() => 0);

void atStart("startup_upkeep", () => orgBootstrap({
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
}).then((r) => r.ran && org.invalidate(), () => log({ source: "plan", op: "org_bootstrap", kind: "failed" })));

// CV-3b: the one-time repair of Who (a follow-up's Who that is its owner, a promise or commitment "to" its author).
void atStart("startup_upkeep", () => whoRepair({
  store: adminStore,
  log,
  people: async () => {
    const chats = await teams.chats().catch(() => []);
    const out: WhoRepairPerson[] = [];
    for (const u of await accounts.users.all()) {
      if (u.deletedAt) continue;
      const inChats = chats.flatMap((c) => c.members ?? []).filter((m) => m.userId?.toLowerCase() === u.id.toLowerCase()).map((m) => m.displayName);
      const plan = storeOf(u.id, u.timeZone);
      out.push({ owner: { id: u.id, names: [u.displayName, ...inChats] }, clear: (o) => plan.clearOwnWho(o) });
    }
    return out;
  },
  commitments: () => conversations.clearSelfTo(),
})).catch(() => log({ source: "plan", op: "who_repair", kind: "failed" }));

// GD-3: every held message checked once under GD-2's rules, at the first start of this build; and a client's again when
// an admin edits its names.
// ENV-1: it spends AI, so production only (an admin's name edit included); outside production held messages stay held.
void atStart("held_recheck", () => heldRecheckOnce({ store: adminStore, log, run: () => recheckHeld(pollDeps) })).catch(() => log({ source: "plan", op: "held_recheck", kind: "failed" }));
if (background.allows("held_recheck")) adminOps.recheckHeld = async (clientKey) => void (await recheckHeld(pollDeps, { clientKey }));

// Everyone who has signed in before gets their background work back (a timer that was running ends on time), all of it
// run by one scheduler (server/scheduler.ts) that reads what is due from each person's rows. A3, the idle rule: the
// passes run while someone has really used FocusTime in the last 10 minutes (HK-3: the Rule org.idle_minutes); otherwise the scheduler sleeps until the stored
// next-due time and makes no database call before it. Everyone's runtimes are built on the first pass (not at start,
// so an idle start reads nothing), and the app's own upkeep (hard deletes, ended sessions) rides on the slow pass.
let everyone = false;
// D514, Option A: the chats are read in the background every 5 minutes inside the union of followers' working hours in
// prod; elsewhere only on Refresh, unless FOCUSTIME_REQUESTS_POLL=on declares a watch period (ENV-1: the policy decides).
log({ source: "plan", op: "requests_poll_mode", kind: background.allows("requests_poll") ? (background.watchPeriod ? "watch_period" : "background") : "on_demand" });
log({ source: "plan", op: "background_policy", kind: background.production ? "production" : "test_site" });
// ADM-1: people's levels and client leads from Dataverse, once a day (the stored refresh time says when it's due).
const PEOPLE_EVERY_MS = 24 * 3600_000;
/** After a failed or impossible read, the next try is an hour on (in memory), so the scheduler can still sleep. */
let peopleRetryAt: Temporal.Instant | null = null;
/** CV-3b: no account has a relationship type yet (in memory: one read at start, then after each refresh). */
const noTypes = async () => !(await adminStore.accounts()).some((a) => a.type !== null);
let typesMissing: boolean | null = null;
const peopleDue = async (): Promise<Temporal.Instant> => {
  const at = await adminStore.directoryRefreshedAt();
  if (typesMissing === null) {
    typesMissing = await noTypes().catch(() => false);
    if (typesMissing) log({ source: "dataverse", op: "account_types", kind: "missing" });
  }
  // CV-3b: account types missing (checked once at start, and after each read) make the read due now.
  const due = at && !typesMissing ? Temporal.Instant.from(at).add({ milliseconds: PEOPLE_EVERY_MS }) : instantNow();
  return peopleRetryAt && Temporal.Instant.compare(peopleRetryAt, due) > 0 ? peopleRetryAt : due;
};
const peopleJob = {
  name: "people_refresh",
  run: async () => {
    if (Temporal.Instant.compare(await peopleDue(), instantNow()) > 0) return;
    const r = await jobs("people_refresh", {}, async (job) => {
      const r = await refreshPeople();
      job.set({ outcome: r.ok ? "ok" : "failed", counts: { people: r.people ?? 0 } });
      return r;
    });
    typesMissing = await noTypes().catch(() => typesMissing ?? false);
    // A read that still brings no types tries again in an hour, never in a loop.
    peopleRetryAt = r.ok && !typesMissing ? null : instantNow().add({ hours: 1 });
    if (r.ok) await endGuestSessions().catch(() => 0);
    log({ source: "dataverse", op: "people_refresh", kind: r.ok ? "done" : "failed", count: r.people });
  },
  wake: peopleDue,
};
// HK-4: the retention purge, once a UTC day for everyone (claimed, so one replica runs it), counts only.
const retention = retentionJob({ db, now: instantNow, log, expireChats: (olderThan) => teams.expire(olderThan), chatRetentionDays: async () => (await pollDeps.rules!()).retentionDays });
// MC-1: registered client calls: occurrences laid out from the registrant's calendar, transcripts looked for after
// each one with a reviewer's own delegated token, then the AI pass (Flex). Its wake is the next check or call end.
const meetings = meetingJob({
  store: meetingStore,
  now: instantNow,
  log,
  users: meetingUsers,
  person: async (uid) => ((await accounts.users.get(uid))?.deletedAt === null ? meetingPerson(await runtimeFor(uid)) : null),
});
const ownershipBackfill = ownershipBackfillJob({ db, convs: conversations, teams, homeTenant: async () => app.entra?.tenantId ?? null, now: instantNow, log });
const scheduler = createScheduler({
  jobs: [
    peopleJob,
    retention,
    { name: ownershipBackfill.name, run: () => ownershipBackfill.run(), wake: ownershipBackfill.wake },
    { name: meetings.name, run: () => jobs("meeting_capture", {}, () => meetings.run()), wake: meetings.wake },
    ...(standardsSyncOn ? [{ name: standards.name, run: () => standards.run(), wake: standards.wake }] : []),
    ...(devopsPoller ? [{ name: "devops_poll", run: async () => void (await devopsPoller!.tick()), wake: () => devopsPoller!.wake() }] : []),
    {
      name: "requests_poll",
      run: () => jobs("requests_poll", {}, async (job) => void cycleCounts(job, await pollCycle(pollDeps))),
      wake: async () => {
        const due = await requestsNextDue(pollDeps);
        return due ? Temporal.Instant.from(due) : null;
      },
    },
  ],
  policy: background,
  people: async () => {
    if (!everyone) {
      for (const u of await accounts.users.all()) if (!u.deletedAt) await runtimeFor(u.id);
      everyone = true;
    }
    return [...runtimes.values()].map((r) => r.ticks);
  },
  log,
  active: use.active,
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
// KB-1: once at startup; a failure is recorded for Admin and the last good copy stays.
if (standardsSyncOn) void atStart("standards_sync", () => standards.run()).catch(() => log({ source: "server", op: "sync", kind: "failed" }));

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
