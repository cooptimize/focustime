// App-level settings (A2): the same for everyone using one FocusTime, never per person. They come from environment
// variables, over a small app config the host may have (local: ~/.config/focustime/app.toml). Per-person settings are
// rows in the plan store (store/settings.ts). Nothing here is secret: the client secrets live in the host's secret store.
import { parse } from "smol-toml";

import type { DatabaseSettings } from "../store/sql/sqlserver.ts";
import type { AiAppSettings } from "../ai/service.ts";
export type AppSettings = {
  /** Where people reach FocusTime (scheme, host and port, no path): the cookies, Host and Origin checks, redirect URIs. */
  publicUrl: string;
  /** The "FocusTime" Entra web registration (single tenant). Null until set up: no Microsoft sign-in. */
  entra: { tenantId: string; clientId: string } | null;
  /** Dataverse, read with the shared application user (client credentials). Null until set up. */
  dataverse: { environmentUrl: string; tenantId: string; clientId: string } | null;
  /** The Google web OAuth client, for each person's optional Google Calendar. Null: Google isn't offered. */
  google: { clientId: string } | null;
  /** "Try the demo" on the sign-in page. */
  demo: boolean;
  /** A3: where the plan store is. Never per person. */
  database: DatabaseSettings;
  /** The email domains invites may go to (lowercase). Empty: each person's own work email domain. */
  inviteDomains: string[];
  /**
   * Who may register client chats (D522): Entra object ids. Read only by `isAdmin()` (actions/admin.ts), which the
   * next step points at the "FocusTime Admins" Entra group instead. Empty: nobody.
   */
  admins: string[];
  /**
   * ADM-1: the "FocusTime Admins" Entra security group's object id (FOCUSTIME_ADMIN_GROUP_ID, through Bicep); its
   * members are admins (actions/admin.ts). `admins` above stays as the break-glass list. Null: no group yet.
   */
  adminGroupId: string | null;
  /** F1: where ⋯ › Send feedback creates stories (a child of `parentId`), and whether this FocusTime sends (live) or only previews. Null: not set. */
  feedback: FeedbackSettings | null;
  /**
   * AI-0: the AI provider, model, limits and prices, the same for everyone. `provider` null: the host's default
   * (hosted: openai, which needs the ft-openai-key secret; developer loop: the stub, no network).
   */
  ai: Omit<AiAppSettings, "provider"> & { provider: AiAppSettings["provider"] | null };
};

/** AI-0 defaults (D495): OpenAI's most efficient current model at Nov 4 prices (developers.openai.com/api/docs/pricing). */
export const DEFAULT_AI: AppSettings["ai"] = {
  provider: null,
  model: "gpt-6-luna",
  reasoningEffort: "low",
  timeoutMs: 30_000,
  maxOutputTokens: { default: 4000, test_ai: 1000, asks_classify: 2000, promises_extract: 1200, capture_prepare: 1200 },
  prices: { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 },
  appCapUsd: 100,
};
export type FeedbackSettings = { org: string; project: string; parentId: number; live: boolean };

/**
 * A3: the plan store's database. SQL Server (Azure SQL in the hosted app, a local container for development) signs in
 * with the app's managed identity (auth "entra", DefaultAzureCredential) or a SQL login (auth "sql", the container;
 * its password is the host secret sql-password, never in this config). SQLite is the local file (the fallback).
 */
export type { DatabaseSettings };

export type AppSettingsResult = { ok: true; settings: AppSettings } | { ok: false; errors: string[] };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An origin people use: https anywhere, or http on localhost (the developer loop). */
const ORIGIN = /^(https:\/\/[a-z0-9.-]+(:\d{2,5})?|http:\/\/localhost:\d{2,5})$/;

/** Environment variable names (each overrides the app config's key of the same meaning). */
export const APP_ENV = {
  publicUrl: "FOCUSTIME_PUBLIC_URL",
  entraTenantId: "FOCUSTIME_ENTRA_TENANT_ID",
  entraClientId: "FOCUSTIME_ENTRA_CLIENT_ID",
  dataverseUrl: "FOCUSTIME_DATAVERSE_URL",
  dataverseTenantId: "FOCUSTIME_DATAVERSE_TENANT_ID",
  dataverseClientId: "FOCUSTIME_DATAVERSE_CLIENT_ID",
  googleClientId: "FOCUSTIME_GOOGLE_CLIENT_ID",
  demo: "FOCUSTIME_DEMO",
  inviteDomains: "FOCUSTIME_INVITE_DOMAINS",
  admins: "FOCUSTIME_ADMINS",
  adminGroupId: "FOCUSTIME_ADMIN_GROUP_ID",
  dbDriver: "FOCUSTIME_DB_DRIVER",
  dbServer: "FOCUSTIME_DB_SERVER",
  dbPort: "FOCUSTIME_DB_PORT",
  dbName: "FOCUSTIME_DB_NAME",
  dbAuth: "FOCUSTIME_DB_AUTH",
  dbUser: "FOCUSTIME_DB_USER",
  dbIdentity: "FOCUSTIME_DB_MANAGED_IDENTITY_CLIENT_ID",
  feedbackOrg: "FOCUSTIME_FEEDBACK_ORG",
  feedbackProject: "FOCUSTIME_FEEDBACK_PROJECT",
  feedbackParentId: "FOCUSTIME_FEEDBACK_PARENT_ID",
  feedbackLive: "FOCUSTIME_FEEDBACK_LIVE",
  aiProvider: "FOCUSTIME_AI_PROVIDER",
  aiModel: "FOCUSTIME_AI_MODEL",
  aiEffort: "FOCUSTIME_AI_REASONING_EFFORT",
  aiTimeoutMs: "FOCUSTIME_AI_TIMEOUT_MS",
  aiMaxTokens: "FOCUSTIME_AI_MAX_OUTPUT_TOKENS",
  aiInputPrice: "FOCUSTIME_AI_INPUT_USD_PER_MILLION",
  aiCachedPrice: "FOCUSTIME_AI_CACHED_INPUT_USD_PER_MILLION",
  aiOutputPrice: "FOCUSTIME_AI_OUTPUT_USD_PER_MILLION",
  aiAppCap: "FOCUSTIME_AI_APP_CAP_USD",
} as const;

type Table = Record<string, unknown>;
const isTable = (v: unknown): v is Table => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Reads the app settings: env first, then the app config text (TOML: public_url and demo at the top, [entra],
 * [dataverse] and [google] tables). `defaultUrl` applies when neither names one (local: http://localhost:<port>).
 */
export function readAppSettings(env: Record<string, string | undefined>, text: string | null, defaultUrl: string): AppSettingsResult {
  const errors: string[] = [];
  let raw: Table = {};
  if (text) {
    try {
      raw = parse(text) as Table;
    } catch {
      return { ok: false, errors: ["The app config isn't valid TOML"] };
    }
  }
  const sec = (k: string): Table => (isTable(raw[k]) ? (raw[k] as Table) : {});
  const val = (envName: string, from: unknown): string => {
    const e = env[envName];
    if (e !== undefined && e !== "") return e.trim();
    return typeof from === "string" ? from.trim() : "";
  };
  const publicUrl = (val(APP_ENV.publicUrl, raw.public_url) || defaultUrl).replace(/\/$/, "");
  if (!ORIGIN.test(publicUrl)) errors.push("public_url must be an https origin, or http://localhost:<port>");

  const e = sec("entra");
  const entraTenant = val(APP_ENV.entraTenantId, e.tenant_id);
  const entraClient = val(APP_ENV.entraClientId, e.client_id);
  if ((entraTenant || entraClient) && !(GUID.test(entraTenant) && GUID.test(entraClient))) errors.push("[entra] tenant_id and client_id must both be GUIDs");

  const d = sec("dataverse");
  const dvUrl = val(APP_ENV.dataverseUrl, d.environment_url).replace(/\/$/, "");
  const dvTenant = val(APP_ENV.dataverseTenantId, d.tenant_id);
  const dvClient = val(APP_ENV.dataverseClientId, d.client_id);
  if ((dvUrl || dvTenant || dvClient) && !(/^https:\/\/[a-z0-9.-]+$/i.test(dvUrl) && GUID.test(dvTenant) && GUID.test(dvClient)))
    errors.push("[dataverse] environment_url must be an https origin, and tenant_id and client_id GUIDs");

  const g = sec("google");
  const googleClient = val(APP_ENV.googleClientId, g.client_id);
  if (googleClient && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(googleClient)) errors.push("[google] client_id must end in .apps.googleusercontent.com");

  const demoRaw = env[APP_ENV.demo] ?? (typeof raw.demo === "boolean" ? String(raw.demo) : "true");
  const demo = !["0", "false", "off", "no"].includes(demoRaw.trim().toLowerCase());

  const database = readDatabase(sec("database"), val, errors);

  // invite_domains (or FOCUSTIME_INVITE_DOMAINS, comma separated): who invites may go to, the same for everyone.
  const domainsRaw = env[APP_ENV.inviteDomains] ?? (Array.isArray(raw.invite_domains) ? raw.invite_domains.join(",") : typeof raw.invite_domains === "string" ? raw.invite_domains : "");
  const inviteDomains = [...new Set(String(domainsRaw).split(",").map((d) => d.trim().toLowerCase()).filter(Boolean))];
  if (inviteDomains.some((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d))) errors.push("invite_domains must be domain names like example.com");

  // admins (or FOCUSTIME_ADMINS, comma separated): Entra object ids of the people who register client chats.
  const adminsRaw = env[APP_ENV.admins] ?? (Array.isArray(raw.admins) ? raw.admins.join(",") : typeof raw.admins === "string" ? raw.admins : "");
  const admins = [...new Set(String(adminsRaw).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (admins.some((x) => !GUID.test(x))) errors.push("admins must be Entra object ids (GUIDs)");
  // admin_group_id (or FOCUSTIME_ADMIN_GROUP_ID): the "FocusTime Admins" group's object id (ADM-1).
  const adminGroupId = val(APP_ENV.adminGroupId, raw.admin_group_id).toLowerCase() || null;
  if (adminGroupId && !GUID.test(adminGroupId)) errors.push("admin_group_id must be the FocusTime Admins group's object id (a GUID)");

  // [feedback] (F1): org, project, parent_id and live. No org: not set (the dialog says it isn't set up).
  const f = sec("feedback");
  const fbOrg = val(APP_ENV.feedbackOrg, f.org);
  const fbProject = val(APP_ENV.feedbackProject, f.project);
  const fbParentText = val(APP_ENV.feedbackParentId, typeof f.parent_id === "number" ? String(f.parent_id) : f.parent_id);
  const fbLiveRaw = env[APP_ENV.feedbackLive] ?? (typeof f.live === "boolean" ? String(f.live) : "false");
  const fbParent = Number(fbParentText);
  let feedback: FeedbackSettings | null = null;
  if (fbOrg || fbProject || fbParentText) {
    if (!/^[a-z0-9][a-z0-9-]{0,49}$/i.test(fbOrg) || !fbProject || fbProject.length > 64 || !/^\d{1,9}$/.test(fbParentText) || fbParent < 1)
      errors.push("[feedback] needs org (a DevOps organization name), project and parent_id (a work item number)");
    else feedback = { org: fbOrg, project: fbProject, parentId: fbParent, live: ["1", "true", "on", "yes"].includes(fbLiveRaw.trim().toLowerCase()) };
  }
  const ai = readAi(sec("ai"), env, errors);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      publicUrl,
      entra: entraTenant ? { tenantId: entraTenant.toLowerCase(), clientId: entraClient.toLowerCase() } : null,
      dataverse: dvUrl ? { environmentUrl: dvUrl, tenantId: dvTenant, clientId: dvClient } : null,
      google: googleClient ? { clientId: googleClient } : null,
      demo,
      database,
      inviteDomains,
      admins,
      adminGroupId,
      feedback,
      ai,
    },
  };
}

/**
 * [ai] (and FOCUSTIME_AI_*), AI-0: provider ("openai", "stub" or "off"), model, reasoning_effort ("" for the model's
 * default), timeout_ms, max_output_tokens (a table by task name with a default; env: "default=4000,test_ai=1000"),
 * input_usd_per_million, cached_input_usd_per_million, output_usd_per_million, app_cap_usd.
 */
function readAi(t: Table, env: Record<string, string | undefined>, errors: string[]): AppSettings["ai"] {
  const out: AppSettings["ai"] = { ...DEFAULT_AI, maxOutputTokens: { ...DEFAULT_AI.maxOutputTokens }, prices: { ...DEFAULT_AI.prices } };
  const pick = (envName: string, from: unknown): unknown => {
    const e = env[envName];
    return e !== undefined && e !== "" ? e.trim() : from;
  };
  const num = (envName: string, from: unknown, key: string, min: number, max: number): number | undefined => {
    const v = pick(envName, from);
    if (v === undefined) return undefined;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < min || n > max) {
      errors.push(`[ai] ${key} must be a number from ${min} to ${max}`);
      return undefined;
    }
    return n;
  };
  const provider = pick(APP_ENV.aiProvider, t.provider);
  if (provider !== undefined) {
    if (provider === "openai" || provider === "stub" || provider === "off") out.provider = provider;
    else errors.push('[ai] provider must be "openai", "stub" or "off"');
  }
  const model = pick(APP_ENV.aiModel, t.model);
  if (model !== undefined) {
    if (typeof model === "string" && /^[\w.:-]{1,100}$/.test(model)) out.model = model;
    else errors.push("[ai] model must be a model name");
  }
  const effort = pick(APP_ENV.aiEffort, t.reasoning_effort);
  if (effort !== undefined) {
    if (effort === "") out.reasoningEffort = null;
    else if (typeof effort === "string" && /^[a-z]{2,10}$/.test(effort)) out.reasoningEffort = effort;
    else errors.push("[ai] reasoning_effort must be a word like low, or empty");
  }
  const timeout = num(APP_ENV.aiTimeoutMs, t.timeout_ms, "timeout_ms", 1000, 300_000);
  if (timeout !== undefined) out.timeoutMs = Math.round(timeout);
  const envTokens = env[APP_ENV.aiMaxTokens];
  const tokens: Record<string, unknown> | null = envTokens
    ? Object.fromEntries(envTokens.split(",").map((p) => p.split("=").map((x) => x.trim())).map(([k, v]) => [k ?? "", Number(v)]))
    : isTable(t.max_output_tokens) ? (t.max_output_tokens as Table) : t.max_output_tokens === undefined ? null : (errors.push("[ai] max_output_tokens must be a table of task = tokens"), null);
  for (const [k, v] of Object.entries(tokens ?? {})) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(k) || typeof v !== "number" || !Number.isInteger(v) || v < 16 || v > 128_000) errors.push(`[ai] max_output_tokens.${k} must be a whole number from 16 to 128000`);
    else out.maxOutputTokens[k] = v;
  }
  for (const [key, envName, field] of [["input_usd_per_million", APP_ENV.aiInputPrice, "inputPerMillion"], ["cached_input_usd_per_million", APP_ENV.aiCachedPrice, "cachedInputPerMillion"], ["output_usd_per_million", APP_ENV.aiOutputPrice, "outputPerMillion"]] as const) {
    const n = num(envName, t[key], key, 0, 1000);
    if (n !== undefined) out.prices[field] = n;
  }
  const cap = num(APP_ENV.aiAppCap, t.app_cap_usd, "app_cap_usd", 0, 100_000);
  if (cap !== undefined) out.appCapUsd = cap;
  return out;
}

const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

/** [database] (and FOCUSTIME_DB_*): no [database] means the SQLite file. */
function readDatabase(d: Table, val: (envName: string, from: unknown) => string, errors: string[]): DatabaseSettings {
  const driver = val(APP_ENV.dbDriver, d.driver) || "sqlite";
  if (driver === "sqlite") return { driver: "sqlite" };
  if (driver !== "sqlserver") {
    errors.push('[database] driver must be "sqlserver" or "sqlite"');
    return { driver: "sqlite" };
  }
  const server = val(APP_ENV.dbServer, d.server);
  const portText = val(APP_ENV.dbPort, typeof d.port === "number" ? String(d.port) : d.port) || "1433";
  const port = Number(portText);
  const database = val(APP_ENV.dbName, d.database);
  const auth = val(APP_ENV.dbAuth, d.auth) || "entra";
  const user = val(APP_ENV.dbUser, d.user) || null;
  const identity = val(APP_ENV.dbIdentity, d.managed_identity_client_id) || null;
  if (!HOST.test(server)) errors.push("[database] server must be a host name");
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("[database] port must be a port number");
  if (!/^[\w-]{1,128}$/.test(database)) errors.push("[database] database must be a database name");
  if (auth !== "entra" && auth !== "sql") errors.push('[database] auth must be "entra" (the app\'s identity) or "sql" (a SQL login, local only)');
  if (auth === "sql" && !user) errors.push("[database] a SQL login needs user");
  if (identity && !GUID.test(identity)) errors.push("[database] managed_identity_client_id must be a GUID");
  const local = server === "localhost" || server === "127.0.0.1";
  if (auth === "sql" && !local) errors.push("[database] a SQL login is for the local container only; Azure SQL uses the app's identity");
  return {
    driver: "sqlserver",
    server,
    port,
    database,
    auth: auth === "sql" ? "sql" : "entra",
    user,
    managedIdentityClientId: identity,
    encrypt: d.encrypt === false ? false : true,
    // The local container's certificate is its own (self-signed); Azure SQL's is checked.
    trustServerCertificate: local && d.trust_server_certificate !== false,
  };
}

/** The redirect URIs to register for these settings (Entra and Google). */
export const redirectUris = (s: Pick<AppSettings, "publicUrl">) => ({
  microsoft: `${s.publicUrl}/auth/microsoft/callback`,
  google: `${s.publicUrl}/auth/google/callback`,
});
