// Parse and validate ~/.config/coopilot/config.toml. Pure: text in, config or per-field errors out.
import { parse, TomlError } from "smol-toml";
import type { Half, StandingBlock, WeekConfig, WorkWeekday } from "../week/types.ts";

export type DataverseConfig = {
  environmentUrl: string;
  tenantId: string;
  clientId: string;
  myEmail: string;
  /** null until resolved from myEmail. */
  mySystemUserId: string | null;
};

export type AppConfig = {
  dataverse: DataverseConfig;
  week: WeekConfig;
  /** Client colors keyed by reporting nickname (or account name when there is none). */
  clients: Record<string, string>;
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
    if (!["dataverse", "day_shape", "risk", "standing_blocks", "clients"].includes(k)) err(k, "Unknown section");
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

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    config: {
      dataverse: { environmentUrl: envUrl.replace(/\/+$/, ""), tenantId, clientId, myEmail, mySystemUserId: sysId === "" ? null : sysId },
      week: {
        dayShape: { start, split, end, timeZone },
        thresholds: { meetingWatchMinutes: watch, meetingAtRiskMinutes: atRisk, minFocusWindowMinutes: window },
        standingBlocks,
      },
      clients,
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
