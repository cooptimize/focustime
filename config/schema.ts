// Parse and validate ~/.config/coopilot/config.toml. Pure: text in, config or per-field errors out.
import { parse, TomlError } from "smol-toml";
import { PROFILE_DIR } from "../links/edge.ts";
import type { MainHalf, StandingBlock, WeekConfig, WorkWeekday } from "../week/types.ts";
import { parseSpan, VIEW_RANGES, WEEKDAY_KEYS, type DayOverride, type Span, type TimeModel, type ViewRange, type WeekdayKey } from "../week/hours.ts";

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
  /** Client colors keyed by reporting nickname (or account name when there is none): a hex or a palette slot's CSS variable. */
  clients: Record<string, string>;
  /** Per-client settings from [clients] (step 6b, Settings): display name, color, link browser and profile, open states. */
  clientSettings: Record<string, ClientSetting>;
  /** Chromium for client links (step 6b). Empty: not set up. */
  chromium: { command: string[] };
  /** Expiry dates Tanner entered for keyring secrets (the keyring doesn't know them). */
  secretExpiry: Partial<Record<"dataverse-client-secret" | "google-client-secret", string>>;
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
export type UiConfig = { theme: Theme; viewRange: ViewRange };
export const DEFAULT_UI: UiConfig = { theme: "cooptimize-dark", viewRange: "business" };

/** The style guide's client palette (tokens --client-<slot> in every theme). */
export const CLIENT_SLOTS = ["teal", "violet", "ochre", "blue", "rose", "earth", "green", "slate"] as const;
export type ClientSlot = (typeof CLIENT_SLOTS)[number];
export const BROWSERS = ["edge", "chromium"] as const;
export type Browser = (typeof BROWSERS)[number];

export type ClientSetting = {
  /** "#rrggbb" or a palette slot. */
  color: string | null;
  /** Shown instead of the Dataverse nickname; null keeps the nickname. */
  name: string | null;
  browser: Browser;
  /** Profile directory in that browser ("Default", "Profile 3"); null: none set here (Edge falls back to [edge.profiles]). */
  profile: string | null;
  /** DevOps states treated as open although DevOps files them as Completed or Removed. */
  openStates: string[];
  /** Keep following this client although it has no current Focus Time (step 6d). */
  follow: boolean;
};

/** A color setting as CSS: a hex as is, a slot as its token. */
export const colorCss = (c: string) => ((CLIENT_SLOTS as readonly string[]).includes(c) ? `var(--client-${c})` : c);

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
  /** Minutes per pick size (step 6c, Q36). */
  sizes: { S: number; M: number; L: number };
  /** How many days back unfinished picks are offered again; 0 turns carry-over off. */
  carryDays: number;
  /** The "not planned yet" reminder: minutes after the day's start it can first fire. */
  reminderOffsetMinutes: number;
  /** Focus timer defaults (step 6c). */
  focusMinutes: number;
  breakMinutes: number;
  /** Play a sound when a focus session ends (default off). */
  endSound: boolean;
  /** Days a client stays followed (DevOps, Open half-days) after its last Focus Time pattern ends (step 6d). */
  followGraceDays: number;
  /** The Close out reminder: minutes before the end of the working day (step 7). */
  closeoutReminderMinutes: number;
  /** The Check-in reminder: minutes after the end of lunch, or midday without one (step 7). */
  checkinReminderMinutes: number;
  /** Plan the week nudges (step 8): "HH:MM" on Thursday and Friday for next week and Monday for this week; "" is off. */
  weekNudgeThu: string;
  weekNudgeFri: string;
  weekNudgeMon: string;
};

export const DEFAULT_PLAN: Omit<PlanConfig, "pickablePortfolioTypes"> = { sizes: { S: 60, M: 120, L: 210 }, carryDays: 7, reminderOffsetMinutes: 0, focusMinutes: 50, breakMinutes: 10, endSound: false, followGraceDays: 14, closeoutReminderMinutes: 15, checkinReminderMinutes: 0, weekNudgeThu: "14:00", weekNudgeFri: "09:00", weekNudgeMon: "08:30" };
const PLAN_KEYS = ["pickable_portfolio_types", "size_s", "size_m", "size_l", "carry_days", "reminder_offset_minutes", "focus_minutes", "break_minutes", "end_sound", "follow_grace_days", "closeout_reminder_minutes", "checkin_reminder_minutes", "week_nudge_thu", "week_nudge_fri", "week_nudge_mon"];

export type FieldError = { field: string; message: string };
/** `legacyDayShape`: the file still has the old [day_shape] section (read as hours; migrated on load, D124). */
export type ParseResult = { ok: true; config: AppConfig; legacyDayShape?: boolean } | { ok: false; errors: FieldError[] };

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
    if (!["dataverse", "day_shape", "risk", "standing_blocks", "clients", "outlook", "google", "plan", "edge", "ui", "hours", "chromium", "secrets"].includes(k)) err(k, "Unknown section");
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

  // [hours] (step 6b, D122), or the old [day_shape] read as Mon–Thu hours with the split as lunch (D124).
  const time = (v: string) => (HHMM.test(v) ? null : 'Use 24-hour "HH:MM"');
  const zone = (v: string) => {
    try {
      Temporal.Now.zonedDateTimeISO(v);
      return null;
    } catch {
      return "Unknown time zone; use an IANA name like America/New_York";
    }
  };
  let hours: TimeModel;
  if (raw.hours !== undefined && raw.day_shape !== undefined) err("day_shape", "Replaced by [hours]; remove [day_shape]");
  if (raw.hours === undefined && raw.day_shape !== undefined) {
    const ds = section("day_shape", ["start", "split", "end", "time_zone"]);
    const start = str(ds, "day_shape", "start", time);
    const split = str(ds, "day_shape", "split", time);
    const end = str(ds, "day_shape", "end", time);
    const timeZone = str(ds, "day_shape", "time_zone", zone);
    if (HHMM.test(start) && HHMM.test(split) && HHMM.test(end)) {
      if (!(start < split)) err("day_shape.split", "Must be after start");
      else if (!(split < end)) err("day_shape.end", "Must be after split");
    }
    hours = legacyHours({ start, split, end, timeZone });
  } else {
    hours = parseHours(raw.hours, err, zone);
  }
  // [risk]
  const rk = section("risk", ["meeting_watch_minutes", "meeting_at_risk_minutes", "min_focus_window_minutes"]);
  const watch = int(rk, "risk", "meeting_watch_minutes");
  const atRisk = int(rk, "risk", "meeting_at_risk_minutes");
  const window = int(rk, "risk", "min_focus_window_minutes");
  if (watch && atRisk && atRisk < watch) err("risk.meeting_at_risk_minutes", "Must be at least the Watch value (meeting_watch_minutes)");

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
      if (ok) standingBlocks.push({ day: day as WorkWeekday, half: half as MainHalf, clientKey: client as string, clientName: client as string });
    });
  }

  // [clients] (optional): "#hex" (the step 4 form) or an inline table with the Settings fields.
  const clients: Record<string, string> = {};
  const clientSettings: Record<string, ClientSetting> = {};
  const cl = raw.clients;
  if (cl !== undefined && !isTable(cl)) err("clients", "Must be a [clients] table");
  if (isTable(cl)) {
    const colorOk = (v: unknown) => typeof v === "string" && (HEX.test(v) || (CLIENT_SLOTS as readonly string[]).includes(v));
    for (const [k, v] of Object.entries(cl)) {
      if (typeof v === "string") {
        if (!HEX.test(v)) err(`clients.${k}`, 'Must be a color like "#1f9e8f" or a table');
        else (clients[k] = v), (clientSettings[k] = { color: v, name: null, browser: "edge", profile: null, openStates: [], follow: false });
        continue;
      }
      if (!isTable(v)) {
        err(`clients.${k}`, 'Must be a color like "#1f9e8f" or a table like { color = "teal" }');
        continue;
      }
      const f = `clients.${k}`;
      for (const x of Object.keys(v)) if (!["color", "name", "browser", "profile", "open_states", "follow"].includes(x)) err(`${f}.${x}`, "Unknown field");
      const c: ClientSetting = { color: null, name: null, browser: "edge", profile: null, openStates: [], follow: false };
      if (v.color !== undefined) {
        if (!colorOk(v.color)) err(`${f}.color`, `Must be a palette color (${CLIENT_SLOTS.join(", ")}) or "#rrggbb"`);
        else c.color = v.color as string;
      }
      if (v.name !== undefined) {
        if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 60) err(`${f}.name`, "Must be 1 to 60 characters");
        else c.name = v.name.trim();
      }
      if (v.browser !== undefined) {
        if (typeof v.browser !== "string" || !(BROWSERS as readonly string[]).includes(v.browser)) err(`${f}.browser`, 'Must be "edge" or "chromium"');
        else c.browser = v.browser as Browser;
      }
      if (v.profile !== undefined) {
        if (typeof v.profile !== "string" || !PROFILE_DIR.test(v.profile)) err(`${f}.profile`, 'Must be a profile directory, e.g. "Default" or "Profile 3"');
        else c.profile = v.profile;
      }
      if (v.open_states !== undefined) {
        if (!Array.isArray(v.open_states) || v.open_states.some((s) => typeof s !== "string" || !s.trim() || s.length > 60)) err(`${f}.open_states`, 'Must be a list of DevOps state names, e.g. ["Resolved"]');
        else c.openStates = (v.open_states as string[]).map((s) => s.trim());
      }
      if (v.follow !== undefined) {
        if (typeof v.follow !== "boolean") err(`${f}.follow`, "Must be true or false");
        else c.follow = v.follow;
      }
      clientSettings[k] = c;
      if (c.color) clients[k] = colorCss(c.color);
    }
  }

  // [chromium] (optional): launch command for clients whose links open in Chromium.
  const chromium = { command: [] as string[] };
  if (raw.chromium !== undefined) {
    const t = isTable(raw.chromium) ? raw.chromium : (err("chromium", "Must be a [chromium] table"), null);
    if (t) for (const k of Object.keys(t)) if (k !== "command") err(`chromium.${k}`, "Unknown field");
    const v = t?.command;
    if (v !== undefined) {
      if (!Array.isArray(v) || !v.length || v.some((w) => typeof w !== "string" || !w.trim() || w.length > 300)) err("chromium.command", 'Must be a non-empty list of words, e.g. ["uwsm-app", "--", "/usr/bin/chromium"]');
      else chromium.command = v as string[];
    }
  }

  // [secrets] (optional): expiry dates only. Never secret values.
  const secretExpiry: AppConfig["secretExpiry"] = {};
  if (raw.secrets !== undefined) {
    const t = isTable(raw.secrets) ? raw.secrets : (err("secrets", "Must be a [secrets] table"), null);
    const names = { dataverse_client_secret_expires: "dataverse-client-secret", google_client_secret_expires: "google-client-secret" } as const;
    if (t)
      for (const [k, v] of Object.entries(t)) {
        if (!Object.hasOwn(names, k)) {
          err(`secrets.${k}`, "Unknown field (only expiry dates belong here; secrets go in the keyring)");
          continue;
        }
        if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) err(`secrets.${k}`, 'Must be a date like "2027-03-01"');
        else secretExpiry[names[k as keyof typeof names]] = v;
      }
  }

  // [plan] (optional)
  const pickablePortfolioTypes: string[] = [];
  const planOpts = { ...DEFAULT_PLAN, sizes: { ...DEFAULT_PLAN.sizes } };
  if (raw.plan !== undefined) {
    const t = isTable(raw.plan) ? raw.plan : (err("plan", "Must be a [plan] table"), null);
    if (t) for (const k of Object.keys(t)) if (!PLAN_KEYS.includes(k)) err(`plan.${k}`, "Unknown field");
    /** Whole minutes in 5-minute steps between min and max. */
    const minutes = (key: string, min: number, max: number, step = 5): number | undefined => {
      const v = t?.[key];
      if (v === undefined) return undefined;
      if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max || v % step !== 0) {
        err(`plan.${key}`, `Must be ${min} to ${max}${step > 1 ? ` in steps of ${step}` : ""}`);
        return undefined;
      }
      return v;
    };
    const sS = minutes("size_s", 5, 480), sM = minutes("size_m", 5, 480), sL = minutes("size_l", 5, 480);
    if (sS !== undefined) planOpts.sizes.S = sS;
    if (sM !== undefined) planOpts.sizes.M = sM;
    if (sL !== undefined) planOpts.sizes.L = sL;
    if (planOpts.sizes.M <= planOpts.sizes.S) err("plan.size_m", "Must be more than S");
    if (planOpts.sizes.L <= planOpts.sizes.M) err("plan.size_l", "Must be more than M");
    const cd = minutes("carry_days", 0, 30, 1);
    if (cd !== undefined) planOpts.carryDays = cd;
    const ro = minutes("reminder_offset_minutes", 0, 240);
    if (ro !== undefined) planOpts.reminderOffsetMinutes = ro;
    const fm = minutes("focus_minutes", 5, 240);
    if (fm !== undefined) planOpts.focusMinutes = fm;
    const bm = minutes("break_minutes", 0, 60);
    if (bm !== undefined) planOpts.breakMinutes = bm;
    const fg = minutes("follow_grace_days", 0, 90, 1);
    if (fg !== undefined) planOpts.followGraceDays = fg;
    const cr = minutes("closeout_reminder_minutes", 0, 120);
    if (cr !== undefined) planOpts.closeoutReminderMinutes = cr;
    const kr = minutes("checkin_reminder_minutes", 0, 120);
    if (kr !== undefined) planOpts.checkinReminderMinutes = kr;
    for (const [toml, key] of [["week_nudge_thu", "weekNudgeThu"], ["week_nudge_fri", "weekNudgeFri"], ["week_nudge_mon", "weekNudgeMon"]] as const) {
      const v = t?.[toml];
      if (v === undefined) continue;
      if (typeof v !== "string" || (v !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))) err(`plan.${toml}`, 'Must be a time like "14:00", or "" for off');
      else planOpts[key] = v;
    }
    if (t?.end_sound !== undefined) {
      if (typeof t.end_sound !== "boolean") err("plan.end_sound", "Must be true or false");
      else planOpts.endSound = t.end_sound;
    }
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
    if (t) for (const k of Object.keys(t)) if (!["theme", "view_range"].includes(k)) err(`ui.${k}`, "Unknown field");
    const vr = t?.view_range;
    if (vr !== undefined) {
      if (typeof vr !== "string" || !(VIEW_RANGES as readonly string[]).includes(vr)) err("ui.view_range", `Must be one of ${VIEW_RANGES.map((x) => `"${x}"`).join(", ")}`);
      else ui.viewRange = vr as ViewRange;
    }
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
    ...(raw.hours === undefined && raw.day_shape !== undefined ? { legacyDayShape: true } : {}),
    config: {
      dataverse: { environmentUrl: envUrl.replace(/\/+$/, ""), tenantId, clientId, myEmail, mySystemUserId: sysId === "" ? null : sysId },
      outlook,
      google,
      week: {
        hours,
        thresholds: { meetingWatchMinutes: watch, meetingAtRiskMinutes: atRisk, minFocusWindowMinutes: window },
        standingBlocks,
      },
      clients,
      clientSettings,
      chromium,
      secretExpiry,
      plan: { pickablePortfolioTypes, ...planOpts },
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

/** The old soft day shape as a time model: Mon–Thu start to end, Fri and the weekend off, the split as a lunch with no break. */
export function legacyHours(ds: { start: string; split: string; end: string; timeZone: string }): TimeModel {
  const day = [{ start: ds.start, end: ds.end }];
  return { timeZone: ds.timeZone, weekdays: { mon: day, tue: day, wed: day, thu: day, fri: [], sat: [], sun: [] }, lunch: { start: ds.split, end: ds.split }, overrides: [] };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SPAN_HINT = 'Use "HH:MM-HH:MM", e.g. "09:00-17:00"';

/** Parses [hours]: time_zone, lunch, mon..sun span lists and [[hours.override]] tables. */
function parseHours(v: unknown, err: (field: string, message: string) => void, zone: (s: string) => string | null): TimeModel {
  const model: TimeModel = { timeZone: "UTC", weekdays: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, lunch: null, overrides: [] };
  if (!isTable(v)) {
    err("hours", v === undefined ? "Missing [hours] section" : "Must be an [hours] table");
    return model;
  }
  for (const k of Object.keys(v)) if (!["time_zone", "lunch", "override", ...WEEKDAY_KEYS].includes(k)) err(`hours.${k}`, "Unknown field");
  if (typeof v.time_zone !== "string") err("hours.time_zone", v.time_zone === undefined ? "Missing" : "Must be a quoted string");
  else {
    const z = zone(v.time_zone);
    if (z) err("hours.time_zone", z);
    else model.timeZone = v.time_zone;
  }
  const spans = (val: unknown, field: string): Span[] | null => {
    if (!Array.isArray(val)) {
      err(field, `Must be a list of spans, e.g. ["09:00-17:00"], or [] for a day off`);
      return null;
    }
    const out: Span[] = [];
    val.forEach((x, i) => {
      const sp = typeof x === "string" ? parseSpan(x) : null;
      if (!sp) err(`${field}[${i}]`, SPAN_HINT);
      else out.push(sp);
    });
    // Overlaps would double count capacity: refuse them.
    const sorted = [...out].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < sorted.length; i++) if (sorted[i]!.start < sorted[i - 1]!.end) err(field, "Spans overlap");
    return out;
  };
  const lunch = (val: unknown, field: string): Span | null | undefined => {
    if (val === undefined) return undefined;
    if (val === "") return null;
    const sp = typeof val === "string" ? parseSpan(val) : null;
    if (!sp) err(field, `${SPAN_HINT}, or "" for no lunch`);
    return sp;
  };
  for (const k of WEEKDAY_KEYS) {
    if (v[k] === undefined) continue;
    const s = spans(v[k], `hours.${k}`);
    if (s) model.weekdays[k as WeekdayKey] = s;
  }
  model.lunch = lunch(v.lunch, "hours.lunch") ?? null;
  const ov = v.override;
  if (ov !== undefined && !Array.isArray(ov)) err("hours.override", "Must be a list of [[hours.override]] tables");
  if (Array.isArray(ov)) {
    const seen = new Set<string>();
    ov.forEach((o, i) => {
      const f = `hours.override[${i}]`;
      if (!isTable(o)) return err(f, "Must be a table");
      for (const k of Object.keys(o)) if (!["date", "segments", "lunch"].includes(k)) err(`${f}.${k}`, "Unknown field");
      let date = "";
      try {
        if (typeof o.date === "string" && DATE.test(o.date)) date = Temporal.PlainDate.from(o.date, { overflow: "reject" }).toString();
      } catch {
        date = "";
      }
      if (!date) return err(`${f}.date`, 'Must be a date like "2026-11-05"');
      if (seen.has(date)) return err(`${f}.date`, "Another override has this date");
      seen.add(date);
      const d: DayOverride = { date };
      if (o.segments !== undefined) {
        const s = spans(o.segments, `${f}.segments`);
        if (s) d.segments = s;
      }
      const l = lunch(o.lunch, `${f}.lunch`);
      if (l !== undefined) d.lunch = l;
      model.overrides.push(d);
    });
  }
  return model;
}
