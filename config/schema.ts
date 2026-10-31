// Parse and validate ~/.config/coopilot/config.toml. Pure: text in, config or per-field errors out.
import { parse, TomlError } from "smol-toml";
import { PROFILE_DIR } from "../links/edge.ts";
import type { Half, StandingBlock, WeekConfig, WorkWeekday } from "../week/types.ts";

export type DataverseConfig = {
  environmentUrl: string;
  tenantId: string;
  clientId: string;
  myEmail: string;
  /** null until resolved from myEmail. */
  mySystemUserId: string | null;
};

export type OutlookConfig = { tenantId: string; clientId: string };
export type GoogleConfig = { clientId: string; calendars: string[] };

export type AppConfig = {
  dataverse: DataverseConfig;
  /** null until outlook.client_id is filled in. */
  outlook: OutlookConfig | null;
  /** null until google.client_id is filled in. */
  google: GoogleConfig | null;
  week: WeekConfig;
  /** Client colors keyed by reporting nickname (or account name when there is none). */
  clients: Record<string, string>;
  /** Plan settings (step 5). */
  plan: PlanConfig;
  /** Where work item links open (step 5.5). */
  edge: EdgeConfig;
  /** Display (step 6b). */
  ui: UiConfig;
};

export const THEMES = ["cooptimize-dark", "cooptimize-light", "neutral"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_NAMES: Record<Theme, string> = { "cooptimize-dark": "Cooptimize Dark", "cooptimize-light": "Cooptimize Light", neutral: "Neutral" };
export type UiConfig = { theme: Theme };
export const DEFAULT_UI: UiConfig = { theme: "cooptimize-dark" };

export type EdgeConfig = {
  /** Edge's launch command as an argument array, e.g. ["uwsm-app", "--", "/usr/bin/microsoft-edge-stable"]. Empty: no Edge. */
  command: string[];
  /** clientKey → Edge profile directory ("Default", "Profile 3"). */
  profiles: Record<string, string>;
  /** Runs with the link for clients with no profile. */
  fallbackCommand: string[];
};

export const DEFAULT_FALLBACK_COMMAND = ["omarchy-launch-browser"];

export type PlanConfig = {
  /** Portfolio-level work item types that can still be picked (Q20), matched without regard to case. */
  pickablePortfolioTypes: string[];
};

export type FieldError = { field: string; message: string };
export type ParseResult = { ok: true; config: AppConfig } | { ok: false; errors: FieldError[] };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX = /^#[0-9a-f]{6}$/i;
const EMAIL = /^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/;
const WORK_DAYS: WorkWeekday[] = ["Mon", "Tue", "Wed", "Thu"];

type Table = Record<string, unknown>;
const isTable = (v: unknown): v is Table => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

export function parseConfig(text: string): ParseResult {
  let raw: Table;
  try {
    raw = parse(text) as Table;
  } catch (e) {
    const line = e instanceof TomlError ? ` on line ${e.line}` : "";
    return { ok: false, errors: [{ field: "(file)", message: `Not valid TOML${line}` }] };
  }

  const errors: FieldError[] = [];
  const err = (field: string, message: string) => errors.push({ field, message });

  const section = (name: string, keys: string[]): Table | null => {
    const v = raw[name];
    if (!isTable(v)) {
      err(name, `Missing [${name}] section`);
      return null;
    }
    for (const k of Object.keys(v)) if (!keys.includes(k)) err(`${name}.${k}`, "Unknown field");
    return v;
  };
  const str = (t: Table | null, sec: string, key: string, check: (s: string) => string | null, allowEmpty = false): string => {
    if (!t) return "";
    const v = t[key];
    if (v === undefined) {
      err(`${sec}.${key}`, "Missing");
      return "";
    }
    if (typeof v !== "string") {
      err(`${sec}.${key}`, "Must be a quoted string");
      return "";
    }
    if (allowEmpty && v === "") return "";
    const problem = check(v);
    if (problem) err(`${sec}.${key}`, problem);
    return v;
  };
  const int = (t: Table | null, sec: string, key: string): number => {
    if (!t) return 0;
    const v = t[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0 || v > 600) {
      err(`${sec}.${key}`, v === undefined ? "Missing" : "Must be a whole number of minutes between 1 and 600");
      return 0;
    }
    return v;
  };

  for (const k of Object.keys(raw)) {
    if (!["dataverse", "day_shape", "risk", "standing_blocks", "clients", "outlook", "google", "plan", "edge", "ui"].includes(k)) err(k, "Unknown section");
  }

  // [dataverse]
  const dv = section("dataverse", ["environment_url", "tenant_id", "client_id", "my_email", "my_systemuserid"]);
  const envUrl = str(dv, "dataverse", "environment_url", (s) => {
    try {
      const u = new URL(s);
      if (u.protocol !== "https:") return "Must start with https://";
      if (!u.hostname.endsWith(".dynamics.com")) return "Must be a Dataverse URL ending in .dynamics.com";
      if (u.pathname !== "/" || u.search) return "Use only the environment root, e.g. https://org.crm.dynamics.com";
      return null;
    } catch {
      return "Not a valid URL";
    }
  });
  const guid = (s: string) => (GUID.test(s) ? null : "Must be a GUID like 00000000-0000-0000-0000-000000000000");
  const tenantId = str(dv, "dataverse", "tenant_id", guid);
  const clientId = str(dv, "dataverse", "client_id", guid);
  const myEmail = str(dv, "dataverse", "my_email", (s) => (EMAIL.test(s) ? null : s === "" ? "Fill in your work email" : "Not a valid email address"));
  const sysId = str(dv, "dataverse", "my_systemuserid", guid, true);

  // [day_shape]
  const ds = section("day_shape", ["start", "split", "end", "time_zone"]);
  const time = (s: string) => (HHMM.test(s) ? null : 'Use 24-hour "HH:MM"');
  const start = str(ds, "day_shape", "start", time);
  const split = str(ds, "day_shape", "split", time);
  const end = str(ds, "day_shape", "end", time);
  const timeZone = str(ds, "day_shape", "time_zone", (s) => {
    try {
      Temporal.Now.zonedDateTimeISO(s);
      return null;
    } catch {
      return "Unknown time zone; use an IANA name like America/New_York";
    }
  });
  if (HHMM.test(start) && HHMM.test(split) && HHMM.test(end)) {
    if (!(start < split)) err("day_shape.split", "Must be after start");
    else if (!(split < end)) err("day_shape.end", "Must be after split");
  }

  // [risk]
  const rk = section("risk", ["meeting_watch_minutes", "meeting_at_risk_minutes", "min_focus_window_minutes"]);
  const watch = int(rk, "risk", "meeting_watch_minutes");
  const atRisk = int(rk, "risk", "meeting_at_risk_minutes");
  const window = int(rk, "risk", "min_focus_window_minutes");
  if (watch && atRisk && atRisk < watch) err("risk.meeting_at_risk_minutes", "Must be at least meeting_watch_minutes");

  // [[standing_blocks]] (optional)
  const standingBlocks: StandingBlock[] = [];
  const sb = raw.standing_blocks;
  if (sb !== undefined && !Array.isArray(sb)) err("standing_blocks", "Must be a list of [[standing_blocks]] tables");
  if (Array.isArray(sb)) {
    sb.forEach((b, i) => {
      const f = `standing_blocks[${i}]`;
      if (!isTable(b)) {
        err(f, "Must be a table");
        return;
      }
      for (const k of Object.keys(b)) if (!["day", "half", "client"].includes(k)) err(`${f}.${k}`, "Unknown field");
      const day = b.day, half = b.half, client = b.client;
      let ok = true;
      if (typeof day !== "string" || !WORK_DAYS.includes(day as WorkWeekday)) (ok = false), err(`${f}.day`, "Must be Mon, Tue, Wed or Thu");
      if (half !== "AM" && half !== "PM") (ok = false), err(`${f}.half`, "Must be AM or PM");
      if (typeof client !== "string" || client.trim() === "") (ok = false), err(`${f}.client`, "Must name a client nickname");
      if (ok) standingBlocks.push({ day: day as WorkWeekday, half: half as Half, clientKey: client as string, clientName: client as string });
    });
  }

  // [clients] (optional)
  const clients: Record<string, string> = {};
  const cl = raw.clients;
  if (cl !== undefined && !isTable(cl)) err("clients", "Must be a [clients] table");
  if (isTable(cl)) {
    for (const [k, v] of Object.entries(cl)) {
      if (typeof v !== "string" || !HEX.test(v)) err(`clients.${k}`, 'Must be a color like "#1f9e8f"');
      else clients[k] = v;
    }
  }

  // [plan] (optional)
  const pickablePortfolioTypes: string[] = [];
  if (raw.plan !== undefined) {
    const t = isTable(raw.plan) ? raw.plan : (err("plan", "Must be a [plan] table"), null);
    if (t) for (const k of Object.keys(t)) if (!["pickable_portfolio_types"].includes(k)) err(`plan.${k}`, "Unknown field");
    const list = t?.pickable_portfolio_types;
    if (list !== undefined && !Array.isArray(list)) err("plan.pickable_portfolio_types", 'Must be a list of work item type names, e.g. ["Recurring"]');
    else if (Array.isArray(list))
      list.forEach((v, i) => {
        if (typeof v !== "string" || !v.trim() || v.length > 100) err(`plan.pickable_portfolio_types[${i}]`, "Must be a work item type name");
        else pickablePortfolioTypes.push(v.trim());
      });
  }

  // [edge] (optional): launch command and clientKey → profile directory
  const edge: EdgeConfig = { command: [], profiles: {}, fallbackCommand: DEFAULT_FALLBACK_COMMAND };
  if (raw.edge !== undefined) {
    const t = isTable(raw.edge) ? raw.edge : (err("edge", "Must be an [edge] table"), null);
    if (t) for (const k of Object.keys(t)) if (!["command", "fallback_command", "profiles"].includes(k)) err(`edge.${k}`, "Unknown field");
    const argv = (key: string): string[] | null => {
      const v = t?.[key];
      if (v === undefined) return null;
      if (!Array.isArray(v) || !v.length || v.some((w) => typeof w !== "string" || !w.trim() || w.length > 300)) {
        err(`edge.${key}`, 'Must be a non-empty list of words, e.g. ["uwsm-app", "--", "/usr/bin/microsoft-edge-stable"]');
        return null;
      }
      return v as string[];
    };
    edge.command = argv("command") ?? [];
    edge.fallbackCommand = argv("fallback_command") ?? DEFAULT_FALLBACK_COMMAND;
    const prof = t?.profiles;
    if (prof !== undefined && !isTable(prof)) err("edge.profiles", "Must be an [edge.profiles] table");
    else if (prof)
      for (const [k, v] of Object.entries(prof)) {
        if (typeof v !== "string" || !PROFILE_DIR.test(v)) err(`edge.profiles.${k}`, 'Must be an Edge profile directory, e.g. "Default" or "Profile 3"');
        else edge.profiles[k] = v;
      }
    if (Object.keys(edge.profiles).length && !edge.command.length) err("edge.command", "Missing (needed for edge.profiles)");
  }

  // [ui] (optional): theme
  const ui: UiConfig = { ...DEFAULT_UI };
  if (raw.ui !== undefined) {
    const t = isTable(raw.ui) ? raw.ui : (err("ui", "Must be a [ui] table"), null);
    if (t) for (const k of Object.keys(t)) if (!["theme"].includes(k)) err(`ui.${k}`, "Unknown field");
    const th = t?.theme;
    if (th !== undefined) {
      if (typeof th !== "string" || !(THEMES as readonly string[]).includes(th)) err("ui.theme", `Must be one of ${THEMES.map((x) => `"${x}"`).join(", ")}`);
      else ui.theme = th as Theme;
    }
  }

  // [outlook] and [google] (optional; empty client_id means not set up yet)
  let outlook: OutlookConfig | null = null;
  if (raw.outlook !== undefined) {
    const t = isTable(raw.outlook) ? raw.outlook : (err("outlook", "Must be an [outlook] table"), null);
    if (t) for (const k of Object.keys(t)) if (!["tenant_id", "client_id"].includes(k)) err(`outlook.${k}`, "Unknown field");
    const oClient = str(t, "outlook", "client_id", guid, true);
    const oTenant = str(t, "outlook", "tenant_id", guid);
    if (oClient && GUID.test(oClient) && GUID.test(oTenant)) outlook = { tenantId: oTenant, clientId: oClient };
  }
  let google: GoogleConfig | null = null;
  if (raw.google !== undefined) {
    const t = isTable(raw.google) ? raw.google : (err("google", "Must be a [google] table"), null);
    if (t) for (const k of Object.keys(t)) if (!["client_id", "calendars"].includes(k)) err(`google.${k}`, "Unknown field");
    const gClient = str(t, "google", "client_id", (v) => (/^[\w.-]+\.apps\.googleusercontent\.com$/.test(v) ? null : "Must end in .apps.googleusercontent.com"), true);
    const calendars: string[] = [];
    const cal = t?.calendars;
    if (cal === undefined) calendars.push("primary");
    else if (!Array.isArray(cal) || cal.length === 0) err("google.calendars", 'Must be a non-empty list, e.g. ["primary"]');
    else
      cal.forEach((c, i) => {
        if (typeof c !== "string" || !/^[^\s"'/]{1,254}$/.test(c)) err(`google.calendars[${i}]`, 'Must be "primary" or a calendar ID');
        else calendars.push(c);
      });
    if (gClient) google = { clientId: gClient, calendars };
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    config: {
      dataverse: { environmentUrl: envUrl.replace(/\/+$/, ""), tenantId, clientId, myEmail, mySystemUserId: sysId === "" ? null : sysId },
      outlook,
      google,
      week: {
        dayShape: { start, split, end, timeZone },
        thresholds: { meetingWatchMinutes: watch, meetingAtRiskMinutes: atRisk, minFocusWindowMinutes: window },
        standingBlocks,
      },
      clients,
      plan: { pickablePortfolioTypes },
      edge,
      ui,
    },
  };
}

/** Fill in my_systemuserid in place, keeping every other line and comment. */
export function setSystemUserIdInText(text: string, id: string): string {
  if (!GUID.test(id)) throw new Error("systemuserid must be a GUID");
  const re = /^(\s*my_systemuserid\s*=\s*)"[^"\n]*"/m;
  if (!re.test(text)) throw new Error("my_systemuserid line not found in config");
  return text.replace(re, `$1"${id}"`);
}
