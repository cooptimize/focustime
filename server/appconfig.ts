// App-level settings (A2): the same for everyone using one FocusTime, never per person. They come from environment
// variables, over a small app config the host may have (local: ~/.config/focustime/app.toml). Per-person settings are
// rows in the plan store (store/settings.ts). Nothing here is secret: the client secrets live in the host's secret store.
import { parse } from "smol-toml";

import type { DatabaseSettings } from "../store/sql/sqlserver.ts";
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
};

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
  dbDriver: "FOCUSTIME_DB_DRIVER",
  dbServer: "FOCUSTIME_DB_SERVER",
  dbPort: "FOCUSTIME_DB_PORT",
  dbName: "FOCUSTIME_DB_NAME",
  dbAuth: "FOCUSTIME_DB_AUTH",
  dbUser: "FOCUSTIME_DB_USER",
  dbIdentity: "FOCUSTIME_DB_MANAGED_IDENTITY_CLIENT_ID",
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
    },
  };
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
