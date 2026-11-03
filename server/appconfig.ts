// App-level settings (A2): the same for everyone using one FocusTime, never per person. They come from environment
// variables, over a small app config the host may have (local: ~/.config/focustime/app.toml). Per-person settings are
// rows in the plan store (store/settings.ts). Nothing here is secret: the client secrets live in the host's secret store.
import { parse } from "smol-toml";

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
};

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

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      publicUrl,
      entra: entraTenant ? { tenantId: entraTenant.toLowerCase(), clientId: entraClient.toLowerCase() } : null,
      dataverse: dvUrl ? { environmentUrl: dvUrl, tenantId: dvTenant, clientId: dvClient } : null,
      google: googleClient ? { clientId: googleClient } : null,
      demo,
    },
  };
}

/** The redirect URIs to register for these settings (Entra and Google). */
export const redirectUris = (s: Pick<AppSettings, "publicUrl">) => ({
  microsoft: `${s.publicUrl}/auth/microsoft/callback`,
  google: `${s.publicUrl}/auth/google/callback`,
});
