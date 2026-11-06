// Parse and validate ~/.config/focustime/config.toml. Pure: text in, config or per-field errors out.
import { parse, TomlError } from "smol-toml";
import type { MainHalf, StandingBlock, WeekConfig, WorkWeekday } from "../week/types.ts";
import { DEFAULT_THRESHOLDS, type RoadmapThresholds } from "../plan/roadmap.ts";
import { DEFAULT_ASK_SETTINGS, type AskSettings } from "../plan/asks.ts";
import { DEFAULT_AI_PERSON, DEFAULT_AI_RULES, type AiPersonSettings, type AiRules } from "../ai/types.ts";
import type { Guidance, OrgView } from "./org-apply.ts";
import { DEFAULT_NOTIFY, NOTIFY_KINDS, type NotifyKind, type NotifySettings } from "../plan/notify.ts";
import { CLOSEOUT_MINUTES, HM, type TeamsRhythm } from "../plan/teams-rhythm.ts";

/** TB-2: the In Teams switches as [notify] keys. */
const TEAMS_SWITCH: Record<string, keyof Pick<TeamsRhythm, "brief" | "checkin" | "closeout" | "nudges" | "status" | "friday">> = { teams_brief: "brief", teams_checkin: "checkin", teams_closeout: "closeout", teams_nudges: "nudges", teams_status: "status", teams_friday: "friday" };
import { DEFAULT_FOCUS, MAX_PLAYLISTS, playlistLink, SOUNDS, type FocusSettings, type SoundKind } from "../plan/focussound.ts";
import { parseSpan, VIEW_RANGES, WEEKDAY_KEYS, type DayOverride, type Span, type TimeModel, type ViewRange, type WeekdayKey } from "../week/hours.ts";
import { NEUTRAL_ZONE } from "../week/zone.ts";

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
  /** Per-client settings from [clients] (step 6b, Settings): display name, color, open states. */
  clientSettings: Record<string, ClientSetting>;
  /** Expiry dates I entered for keyring secrets (the keyring doesn't know them). */
  secretExpiry: Partial<Record<"dataverse-client-secret" | "google-client-secret", string>>;
  /** Plan settings (step 5). */
  plan: PlanConfig;
  /** Display (step 6b). */
  ui: UiConfig;
  /** Focus sounds, playlists and media control (step 10). */
  focus: FocusSettings;
  /** Timeboxes (step 12): "Put on Outlook" on by default, and whether changes to my own timebox events ask first. */
  timebox: TimeboxSettings;
  /** The collaboration finder (step 13): help session length, Teams, days to search, invite domains. */
  collab: CollabSettings;
  /** My VM (step 15.4): the tag that marks a VM as mine. The chosen VM itself is per signed-in person, in the plan store. */
  azure: AzureSettings;
  /** Settings > Notifications (step 15.5): a switch per kind, quiet hours. */
  notify: NotifySettings;
  /** Step 17: Settings > Roadmap thresholds (whole numbers). */
  roadmap: RoadmapThresholds;
  /** AP-1: Asks: how often delivery chats are read in working hours, and the phrase lists the rules use. */
  asks: AskSettings;
  /** AI-0: the person's [ai] values. Since ADM-1 only draft_months is theirs; the rest is read for the one-time migration. */
  ai: AiPersonSettings;
  /** ADM-1: the admins' AI rules, filled in when the org settings are applied (off until then). */
  aiRules: AiRules;
  /** ADM-1: the person's own choices over their level's defaults ([guidance]); unset keys follow the level. */
  guidance: Partial<Guidance>;
  /** PL-1: the person's own Keep open share per client ([keep_open], client key = percent 0 to 80); unset: the level's. */
  keepOpen: Record<string, number>;
  /** ADM-1: what the person's own rows say, before built-in defaults fill in: their phrases and excludes (null: none set). */
  mine: { requestPhrases: string[] | null; ackPhrases: string[] | null; promisePhrases: string[] | null; exclude: string[] | null };
  /** ADM-1: the team's settings as they apply to this person (null until applied, config/org-apply.ts). */
  org: OrgView | null;
};
/** `ownerValue` empty means the signed-in person's UPN (A2), then their display name. `startWithoutAsking` (step 15.5, Q87): the morning box's Start runs at once. */
export type AzureSettings = { ownerTag: string; ownerValue: string; startWithoutAsking: boolean };
export const DEFAULT_AZURE: AzureSettings = { ownerTag: "Owner", ownerValue: "", startWithoutAsking: true };
/** `domains` empty means my work email's domain. */
/** Step 13.5: `exclude` lists people (names or addresses) who are never candidates or Who suggestions, like bots. */
export type CollabSettings = { meetingMinutes: number; teams: boolean; daysAhead: number; domains: string[]; exclude: string[] };
export const DEFAULT_EXCLUDE: readonly string[] = ["Kat 🤖"];
export const DEFAULT_COLLAB: CollabSettings = { meetingMinutes: 30, teams: true, daysAhead: 3, domains: [], exclude: [...DEFAULT_EXCLUDE] };
export const COLLAB_LENGTHS = [15, 30, 45, 60, 90] as const;
/** The domains invites may go to: config, else my work email's. */
export const inviteDomains = (cfg: Pick<AppConfig, "collab" | "dataverse">) => (cfg.collab.domains.length ? cfg.collab.domains : [cfg.dataverse.myEmail.split("@")[1] ?? ""].filter(Boolean)).map((d) => d.toLowerCase());
export type TimeboxSettings = { outlookDefault: boolean; confirmOwn: boolean; /** Step 14.5 (D261): "Use timeboxing"; off hides time controls, timeboxes are kept. */ enabled: boolean };
export const DEFAULT_TIMEBOX: TimeboxSettings = { outlookDefault: false, confirmOwn: true, enabled: true };

export const THEMES = ["cooptimize-dark", "cooptimize-light", "neutral"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_NAMES: Record<Theme, string> = { "cooptimize-dark": "Cooptimize Dark", "cooptimize-light": "Cooptimize Light", neutral: "Neutral" };
/** showTimelines (step 15.1, D276): the compact time ruler on medium-width cards. */
/** Text size (U5, D401): three presets off one base, not a slider. Default is 11/12/13/15 px, Large 13/14/15/17, Larger 15/16/17/19. */
export const TEXT_SIZES = ["default", "large", "larger"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
/** reduceMotion (step 17.5): no sweep, unroll, hop or bob; the still pose shows and open and close cut straight to the result. */
/** showPersonal (U5.1, D408): personal (Google) events shown on Week and Today; hidden ones still count in risk and free time. */
/** IB-1: the Inbox's remembered view, clients (none: all) and grouping. */
export const INBOX_VIEW_NAMES = ["needs_you", "promises", "waiting", "in_progress", "captures", "teammates", "done", "chatter"] as const;
export const INBOX_GROUPS = ["client", "due", "kind"] as const;
export type InboxPrefs = { view: (typeof INBOX_VIEW_NAMES)[number]; clients: string[]; group: (typeof INBOX_GROUPS)[number] };
export const DEFAULT_INBOX: InboxPrefs = { view: "needs_you", clients: [], group: "client" };
export type UiConfig = { theme: Theme; viewRange: ViewRange; showTimelines: boolean; reduceMotion: boolean; textSize: TextSize; showPersonal: boolean; inbox: InboxPrefs };
export const DEFAULT_UI: UiConfig = { theme: "cooptimize-dark", viewRange: "business", showTimelines: true, reduceMotion: false, textSize: "default", showPersonal: true, inbox: DEFAULT_INBOX };

/** The style guide's client palette (tokens --client-<slot> in every theme). */
export const CLIENT_SLOTS = ["teal", "violet", "ochre", "blue", "rose", "earth", "green", "slate"] as const;
export type ClientSlot = (typeof CLIENT_SLOTS)[number];

export type ClientSetting = {
  /** "#rrggbb" or a palette slot. */
  color: string | null;
  /** Shown instead of the Dataverse nickname; null keeps the nickname. */
  name: string | null;
  /** DevOps states treated as open although DevOps files them as Completed or Removed. */
  openStates: string[];
  /** Keep following this client although it has no current Focus Time (step 6d). */
  follow: boolean;
};

/** A color setting as CSS: a hex as is, a slot as its token. */
export const colorCss = (c: string) => ((CLIENT_SLOTS as readonly string[]).includes(c) ? `var(--client-${c})` : c);


export type PlanConfig = {
  /**
   * Retired (ADM-1): parent or top types that could be picked, and types that don't count hours. Still parsed so older
   * text reads; only the org bootstrap reads them, to move them into each client's Rules (no_breakdown, background).
   */
  pickablePortfolioTypes: string[];
  backgroundTypes: string[];
  /** Minutes per pick size: fixed since E2 (S 1h, M 2h, L 4h, D446); old size_s/m/l values are read and ignored. */
  sizes: { S: number; M: number; L: number };
  /** Shortest useful time per size (step 15.1, D273): Timebox my day never places or trims a pick below it. */
  minSizes: { S: number; M: number; L: number };
  /** How many days back unfinished picks are offered again; 0 turns carry-over off. */
  carryDays: number;
  /** The "not planned yet" reminder: minutes after the day's start it can first fire. */
  reminderOffsetMinutes: number;
  /** Focus timer defaults (step 6c). */
  focusMinutes: number;
  breakMinutes: number;
  /** Play a sound when a focus session ends (default off). */
  endSound: boolean;
  /** PK-1: when I check off a to-do with a DevOps item, ask to update DevOps ("ask", the default) or never ask. */
  devopsOnDone: "ask" | "never";
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

export const DEFAULT_PLAN: Omit<PlanConfig, "pickablePortfolioTypes" | "backgroundTypes"> = { sizes: { S: 60, M: 120, L: 240 }, minSizes: { S: 30, M: 60, L: 90 }, carryDays: 7, reminderOffsetMinutes: 0, focusMinutes: 50, breakMinutes: 10, endSound: false, devopsOnDone: "ask", followGraceDays: 14, closeoutReminderMinutes: 15, checkinReminderMinutes: 0, weekNudgeThu: "14:00", weekNudgeFri: "09:00", weekNudgeMon: "08:30" };
const PLAN_KEYS = ["pickable_portfolio_types", "background_types", "size_s", "size_m", "size_l", "min_s", "min_m", "min_l", "carry_days", "reminder_offset_minutes", "focus_minutes", "break_minutes", "end_sound", "devops_on_done", "follow_grace_days", "closeout_reminder_minutes", "checkin_reminder_minutes", "week_nudge_thu", "week_nudge_fri", "week_nudge_mon"];

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

/** defaultZone: the zone for someone whose settings don't name one (the host clock's); the neutral zone without it. */
export type ParseOptions = { defaultZone?: string };

export function parseConfig(text: string, opts: ParseOptions = {}): ParseResult {
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

  // Section and key names are unchanged by the rename (R1), so existing config files keep working.
  for (const k of Object.keys(raw)) {
    if (!["dataverse", "day_shape", "risk", "standing_blocks", "clients", "outlook", "google", "plan", "edge", "ui", "hours", "chromium", "secrets", "focus", "timebox", "collab", "azure", "notify", "roadmap", "asks", "ai", "guidance", "keep_open"].includes(k)) err(k, "Unknown section");
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
      return "Unknown time zone; use an IANA name like Region/City";
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
    hours = parseHours(raw.hours, err, zone, opts.defaultZone ?? NEUTRAL_ZONE);
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
        else (clients[k] = v), (clientSettings[k] = { color: v, name: null, openStates: [], follow: false });
        continue;
      }
      if (!isTable(v)) {
        err(`clients.${k}`, 'Must be a color like "#1f9e8f" or a table like { color = "teal" }');
        continue;
      }
      const f = `clients.${k}`;
      for (const x of Object.keys(v)) if (!["color", "name", "browser", "profile", "open_states", "follow"].includes(x)) err(`${f}.${x}`, "Unknown field");
      // browser and profile (A1): the removed browser profiles, accepted and ignored in older files.
      const c: ClientSetting = { color: null, name: null, openStates: [], follow: false };
      if (v.color !== undefined) {
        if (!colorOk(v.color)) err(`${f}.color`, `Must be a palette color (${CLIENT_SLOTS.join(", ")}) or "#rrggbb"`);
        else c.color = v.color as string;
      }
      if (v.name !== undefined) {
        if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 60) err(`${f}.name`, "Must be 1 to 60 characters");
        else c.name = v.name.trim();
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
  const backgroundTypes: string[] = [];
  const planOpts = { ...DEFAULT_PLAN, sizes: { ...DEFAULT_PLAN.sizes }, minSizes: { ...DEFAULT_PLAN.minSizes } };
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
    // E2 (D446): S, M and L are fixed shortcuts for 1h, 2h and 4h. Sizes a person set before stay in their settings
    // text, unread: never an error, never used.
    for (const z of ["S", "M", "L"] as const) {
      const key = `min_${z.toLowerCase()}`;
      const v = minutes(key, 15, 480);
      if (v === undefined) {
        // Without its own value, a minimum never exceeds a smaller configured size.
        planOpts.minSizes[z] = Math.min(planOpts.minSizes[z], planOpts.sizes[z]);
        continue;
      }
      if (v > planOpts.sizes[z]) err(`plan.${key}`, `Must be at most size ${z} (${planOpts.sizes[z]})`);
      else planOpts.minSizes[z] = v;
    }
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
    if (t?.devops_on_done !== undefined) {
      if (t.devops_on_done !== "ask" && t.devops_on_done !== "never") err("plan.devops_on_done", 'Must be "ask" or "never"');
      else planOpts.devopsOnDone = t.devops_on_done;
    }
    const list = t?.pickable_portfolio_types;
    if (list !== undefined && !Array.isArray(list)) err("plan.pickable_portfolio_types", 'Must be a list of work item type names, e.g. ["Recurring"]');
    else if (Array.isArray(list))
      list.forEach((v, i) => {
        if (typeof v !== "string" || !v.trim() || v.length > 100) err(`plan.pickable_portfolio_types[${i}]`, "Must be a work item type name");
        else pickablePortfolioTypes.push(v.trim());
      });
    const bg = t?.background_types;
    if (bg !== undefined && !Array.isArray(bg)) err("plan.background_types", "Must be a list of work item type names");
    else if (Array.isArray(bg))
      bg.forEach((v, i) => {
        if (typeof v !== "string" || !v.trim() || v.length > 100) err(`plan.background_types[${i}]`, "Must be a work item type name");
        else backgroundTypes.push(v.trim());
      });
  }

  // [edge] and [chromium] (A1): browser profiles were removed; links open in the person's browser. Older files keep
  // the sections, accepted and ignored.
  for (const k of ["edge", "chromium"] as const) if (raw[k] !== undefined && !isTable(raw[k])) err(k, `Must be a [${k}] table`);

  // [ui] (optional): theme
  const ui: UiConfig = { ...DEFAULT_UI, inbox: { ...DEFAULT_INBOX, clients: [] } };
  if (raw.ui !== undefined) {
    const t = isTable(raw.ui) ? raw.ui : (err("ui", "Must be a [ui] table"), null);
    if (t) for (const k of Object.keys(t)) if (!["theme", "view_range", "show_timelines", "reduce_motion", "text_size", "show_personal", "inbox_view", "inbox_clients", "inbox_group"].includes(k)) err(`ui.${k}`, "Unknown field");
    const rm = t?.reduce_motion;
    if (rm !== undefined) {
      if (typeof rm !== "boolean") err("ui.reduce_motion", "Must be true or false");
      else ui.reduceMotion = rm;
    }
    const ts = t?.text_size;
    if (ts !== undefined) {
      if (typeof ts !== "string" || !(TEXT_SIZES as readonly string[]).includes(ts)) err("ui.text_size", `Must be one of ${TEXT_SIZES.map((x) => `"${x}"`).join(", ")}`);
      else ui.textSize = ts as TextSize;
    }
    // IB-1: the Inbox's view, clients and grouping, remembered per person.
    const iv = t?.inbox_view;
    if (iv !== undefined) {
      if (typeof iv !== "string" || !(INBOX_VIEW_NAMES as readonly string[]).includes(iv)) err("ui.inbox_view", `Must be one of ${INBOX_VIEW_NAMES.map((x) => `"${x}"`).join(", ")}`);
      else ui.inbox.view = iv as InboxPrefs["view"];
    }
    const ic = t?.inbox_clients;
    if (ic !== undefined) {
      if (!Array.isArray(ic) || ic.length > 50 || ic.some((x) => typeof x !== "string" || !x || x.length > 100)) err("ui.inbox_clients", "Must be a list of client keys");
      else ui.inbox.clients = [...new Set(ic as string[])];
    }
    const ig = t?.inbox_group;
    if (ig !== undefined) {
      if (typeof ig !== "string" || !(INBOX_GROUPS as readonly string[]).includes(ig)) err("ui.inbox_group", `Must be one of ${INBOX_GROUPS.map((x) => `"${x}"`).join(", ")}`);
      else ui.inbox.group = ig as InboxPrefs["group"];
    }
    const sp = t?.show_personal;
    if (sp !== undefined) {
      if (typeof sp !== "boolean") err("ui.show_personal", "Must be true or false");
      else ui.showPersonal = sp;
    }
    const st = t?.show_timelines;
    if (st !== undefined) {
      if (typeof st !== "boolean") err("ui.show_timelines", "Must be true or false");
      else ui.showTimelines = st;
    }
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

  // [focus] (optional, step 10): sound, volume, fade, on-break behavior, media pause, playlists
  const focus: FocusSettings = { ...DEFAULT_FOCUS, playlists: [] };
  if (raw.focus !== undefined) {
    const t = isTable(raw.focus) ? raw.focus : (err("focus", "Must be a [focus] table"), null);
    if (t) for (const k of Object.keys(t)) if (!["sound", "volume", "fade_seconds", "on_break", "pause_media", "playlists", "teams_status", "plain_focus_status"].includes(k)) err(`focus.${k}`, "Unknown field");
    const snd = t?.sound;
    if (snd !== undefined) {
      if (typeof snd !== "string" || !(SOUNDS as readonly string[]).includes(snd)) err("focus.sound", `Must be one of ${SOUNDS.map((x) => `"${x}"`).join(", ")}`);
      else focus.sound = snd as SoundKind;
    }
    const whole = (key: string, min: number, max: number): number | undefined => {
      const v = t?.[key];
      if (v === undefined) return undefined;
      if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return void err(`focus.${key}`, `Must be a whole number from ${min} to ${max}`);
      return v;
    };
    const vol = whole("volume", 0, 100);
    if (vol !== undefined) focus.volume = vol;
    const fade = whole("fade_seconds", 0, 30);
    if (fade !== undefined) focus.fadeSeconds = fade;
    const ob = t?.on_break;
    if (ob !== undefined) {
      if (ob !== "silence" && ob !== "chime") err("focus.on_break", 'Must be "silence" or "chime"');
      else focus.onBreak = ob;
    }
    if (t?.pause_media !== undefined) {
      if (typeof t.pause_media !== "boolean") err("focus.pause_media", "Must be true or false");
      else focus.pauseMedia = t.pause_media;
    }
    // Step 16.3: my Teams status during focus.
    if (t?.teams_status !== undefined) {
      if (typeof t.teams_status !== "boolean") err("focus.teams_status", "Must be true or false");
      else focus.teamsStatus = t.teams_status;
    }
    if (t?.plain_focus_status !== undefined) {
      if (t.plain_focus_status !== "busy" && t.plain_focus_status !== "none") err("focus.plain_focus_status", 'Must be "busy" or "none"');
      else focus.plainFocusStatus = t.plain_focus_status;
    }
    const pl = t?.playlists;
    if (pl !== undefined) {
      if (!Array.isArray(pl) || pl.length > MAX_PLAYLISTS) err("focus.playlists", `Must be a list of at most ${MAX_PLAYLISTS} { name, url } entries`);
      else
        pl.forEach((x, i) => {
          const name = isTable(x) && typeof x.name === "string" ? x.name.trim() : "";
          const url = isTable(x) && typeof x.url === "string" ? x.url.trim() : "";
          if (!isTable(x) || Object.keys(x).some((k) => k !== "name" && k !== "url")) err(`focus.playlists[${i}]`, "Must be { name, url }");
          else if (!name || name.length > 60) err(`focus.playlists[${i}].name`, "Must be a name of 1 to 60 characters");
          else if (focus.playlists.some((p) => p.name === name)) err(`focus.playlists[${i}].name`, "Each playlist needs its own name");
          else if (!playlistLink(url)) err(`focus.playlists[${i}].url`, "Must be a Spotify or YouTube link (https)");
          else focus.playlists.push({ name, url });
        });
    }
  }

  // [timebox] (optional, step 12): outlook_default (new timeboxes go on Outlook), confirm_own (ask before updating or
  // removing my own timebox events; creating always asks)
  const timebox: TimeboxSettings = { ...DEFAULT_TIMEBOX };
  if (raw.timebox !== undefined) {
    const t = isTable(raw.timebox) ? raw.timebox : (err("timebox", "Must be a [timebox] table"), null);
    if (t) {
      for (const k of Object.keys(t)) if (!["outlook_default", "confirm_own", "enabled"].includes(k)) err(`timebox.${k}`, "Unknown field");
      for (const [k, f] of [["outlook_default", "outlookDefault"], ["confirm_own", "confirmOwn"], ["enabled", "enabled"]] as const) {
        if (t[k] === undefined) continue;
        if (typeof t[k] !== "boolean") err(`timebox.${k}`, "Must be true or false");
        else timebox[f] = t[k];
      }
    }
  }

  // [collab] (optional, step 13): meeting_minutes (15, 30, 45, 60 or 90), teams, days_ahead (1 to 10), domains
  const mine: AppConfig["mine"] = { requestPhrases: null, ackPhrases: null, promisePhrases: null, exclude: null };
  const collab: CollabSettings = { ...DEFAULT_COLLAB, domains: [], exclude: [...DEFAULT_EXCLUDE] };
  if (raw.collab !== undefined) {
    const t = isTable(raw.collab) ? raw.collab : (err("collab", "Must be a [collab] table"), null);
    if (t) {
      for (const k of Object.keys(t)) if (!["meeting_minutes", "teams", "days_ahead", "domains", "exclude"].includes(k)) err(`collab.${k}`, "Unknown field");
      if (t.meeting_minutes !== undefined) {
        if (typeof t.meeting_minutes !== "number" || !(COLLAB_LENGTHS as readonly number[]).includes(t.meeting_minutes)) err("collab.meeting_minutes", `Must be one of ${COLLAB_LENGTHS.join(", ")}`);
        else collab.meetingMinutes = t.meeting_minutes;
      }
      if (t.teams !== undefined) {
        if (typeof t.teams !== "boolean") err("collab.teams", "Must be true or false");
        else collab.teams = t.teams;
      }
      if (t.days_ahead !== undefined) {
        if (typeof t.days_ahead !== "number" || !Number.isInteger(t.days_ahead) || t.days_ahead < 1 || t.days_ahead > 10) err("collab.days_ahead", "Must be a whole number from 1 to 10");
        else collab.daysAhead = t.days_ahead;
      }
      if (t.domains !== undefined) {
        if (!Array.isArray(t.domains) || t.domains.length > 5 || t.domains.some((d) => typeof d !== "string" || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(d))) err("collab.domains", "Must be a list of up to 5 domains, like \"cooptimize.example\"");
        else collab.domains = (t.domains as string[]).map((d) => d.toLowerCase());
      }
      if (t.exclude !== undefined) {
        if (!Array.isArray(t.exclude) || t.exclude.length > 50 || t.exclude.some((d) => typeof d !== "string" || !d.trim() || d.length > 200)) err("collab.exclude", "Must be a list of up to 50 names or addresses");
        else mine.exclude = collab.exclude = (t.exclude as string[]).map((d) => d.trim());
      }
    }
  }

  // [azure] (optional, step 15.4): owner_tag (default Owner), owner_value (default: the signed-in person's name)
  const azure: AzureSettings = { ...DEFAULT_AZURE };
  if (raw.azure !== undefined) {
    const t = isTable(raw.azure) ? raw.azure : (err("azure", "Must be an [azure] table"), null);
    if (t) {
      for (const k of Object.keys(t)) if (!["owner_tag", "owner_value", "start_without_asking"].includes(k)) err(`azure.${k}`, "Unknown field");
      if (t.start_without_asking !== undefined) {
        if (typeof t.start_without_asking !== "boolean") err("azure.start_without_asking", "Must be true or false");
        else azure.startWithoutAsking = t.start_without_asking;
      }
      if (t.owner_tag !== undefined) {
        if (typeof t.owner_tag !== "string" || !/^[^<>%&\\?/'"]{1,128}$/.test(t.owner_tag)) err("azure.owner_tag", "Must be a tag name of 1 to 128 characters");
        else azure.ownerTag = t.owner_tag;
      }
      if (t.owner_value !== undefined) {
        if (typeof t.owner_value !== "string" || t.owner_value.length > 256 || /[\r\n]/.test(t.owner_value)) err("azure.owner_value", "Must be one line of up to 256 characters");
        else azure.ownerValue = t.owner_value.trim();
      }
    }
  }

  // [notify] (optional, step 15.5): one switch per kind, quiet hours (outside working hours, PTO days)
  const notify: NotifySettings = { ...DEFAULT_NOTIFY, kinds: { ...DEFAULT_NOTIFY.kinds }, teams: { ...DEFAULT_NOTIFY.teams }, status: { ...DEFAULT_NOTIFY.status } };
  if (raw.notify !== undefined) {
    const t = isTable(raw.notify) ? raw.notify : (err("notify", "Must be a [notify] table"), null);
    if (t) {
      for (const k of Object.keys(t)) {
        if ((NOTIFY_KINDS as readonly string[]).includes(k)) {
          if (typeof t[k] !== "boolean") err(`notify.${k}`, "Must be true or false");
          else notify.kinds[k as NotifyKind] = t[k] as boolean;
        } else if (k === "quiet") {
          if (t.quiet !== "outside_hours" && t.quiet !== "off") err("notify.quiet", 'Must be "outside_hours" or "off"');
          else notify.quiet = t.quiet;
        } else if (k === "quiet_pto") {
          if (typeof t.quiet_pto !== "boolean") err("notify.quiet_pto", "Must be true or false");
          else notify.quietPto = t.quiet_pto;
        } else if (k === "push_details") {
          if (typeof t.push_details !== "boolean") err("notify.push_details", "Must be true or false");
          else notify.pushDetails = t.push_details;
        } else if (k === "teams_messages") {
          if (typeof t.teams_messages !== "boolean") err("notify.teams_messages", "Must be true or false");
          else notify.teamsMessages = t.teams_messages;
        } else if (k === "asks_through_focus") {
          if (typeof t.asks_through_focus !== "boolean") err("notify.asks_through_focus", "Must be true or false");
          else notify.asksThroughFocus = t.asks_through_focus;
        } else if (TEAMS_SWITCH[k]) {
          // TB-2: Settings › Notifications › In Teams.
          if (typeof t[k] !== "boolean") err(`notify.${k}`, "Must be true or false");
          else notify.teams[TEAMS_SWITCH[k]] = t[k] as boolean;
        } else if (k === "teams_brief_at") {
          if (t.teams_brief_at !== "start" && (typeof t.teams_brief_at !== "string" || !HM.test(t.teams_brief_at))) err("notify.teams_brief_at", 'Must be "start" or a time like "09:00"');
          else notify.teams.briefAt = t.teams_brief_at === "start" ? null : t.teams_brief_at;
        } else if (k === "teams_checkin_at") {
          if (typeof t.teams_checkin_at !== "string" || !HM.test(t.teams_checkin_at)) err("notify.teams_checkin_at", 'Must be a time like "12:00"');
          else notify.teams.checkinAt = t.teams_checkin_at;
        } else if (k === "status_sunday") {
          // SR-1: the status nudge's Sunday evening option and its times.
          if (typeof t.status_sunday !== "boolean") err("notify.status_sunday", "Must be true or false");
          else notify.status.sunday = t.status_sunday;
        } else if (k === "status_friday_at" || k === "status_sunday_at") {
          if (typeof t[k] !== "string" || !HM.test(t[k] as string)) err(`notify.${k}`, 'Must be a time like "15:00"');
          else notify.status[k === "status_friday_at" ? "fridayAt" : "sundayAt"] = t[k] as string;
        } else if (k === "teams_closeout_minutes") {
          const v = t.teams_closeout_minutes;
          if (typeof v !== "number" || !Number.isInteger(v) || v < CLOSEOUT_MINUTES.min || v > CLOSEOUT_MINUTES.max) err("notify.teams_closeout_minutes", `Must be a whole number from ${CLOSEOUT_MINUTES.min} to ${CLOSEOUT_MINUTES.max}`);
          else notify.teams.closeoutMinutes = v;
        } else err(`notify.${k}`, "Unknown field");
      }
    }
  }

  // [roadmap] (optional, step 17): stalled_days (3 to 60), watch_weeks (0 to 4)
  const roadmap: RoadmapThresholds = { ...DEFAULT_THRESHOLDS };
  if (raw.roadmap !== undefined) {
    const t = isTable(raw.roadmap) ? raw.roadmap : (err("roadmap", "Must be a [roadmap] table"), null);
    if (t) {
      for (const k of Object.keys(t)) if (!["stalled_days", "watch_weeks"].includes(k)) err(`roadmap.${k}`, "Unknown field");
      const sd = t.stalled_days, ww = t.watch_weeks;
      if (sd !== undefined) {
        if (typeof sd !== "number" || !Number.isInteger(sd) || sd < 3 || sd > 60) err("roadmap.stalled_days", "Must be a whole number from 3 to 60");
        else roadmap.stalledDays = sd;
      }
      if (ww !== undefined) {
        if (typeof ww !== "number" || !Number.isInteger(ww) || ww < 0 || ww > 4) err("roadmap.watch_weeks", "Must be a whole number from 0 to 4");
        else roadmap.watchWeeks = ww;
      }
    }
  }

  // [asks] (optional, AP-1): poll_minutes (1 to 60), request_phrases and ack_phrases (lists of up to 50 phrases), and
  // (AP-2) promise_phrases: commitment phrasing in my own messages
  const asks: AskSettings = { ...DEFAULT_ASK_SETTINGS, requestPhrases: [...DEFAULT_ASK_SETTINGS.requestPhrases], ackPhrases: [...DEFAULT_ASK_SETTINGS.ackPhrases], promisePhrases: [...DEFAULT_ASK_SETTINGS.promisePhrases] };
  if (raw.asks !== undefined) {
    const t = isTable(raw.asks) ? raw.asks : (err("asks", "Must be an [asks] table"), null);
    if (t) {
      for (const k of Object.keys(t)) if (!["poll_minutes", "request_phrases", "ack_phrases", "promise_phrases"].includes(k)) err(`asks.${k}`, "Unknown field");
      const pm = t.poll_minutes;
      if (pm !== undefined) {
        if (typeof pm !== "number" || !Number.isInteger(pm) || pm < 1 || pm > 60) err("asks.poll_minutes", "Must be a whole number from 1 to 60");
        else asks.pollMinutes = pm;
      }
      for (const [k, key] of [["request_phrases", "requestPhrases"], ["ack_phrases", "ackPhrases"], ["promise_phrases", "promisePhrases"]] as const) {
        const v = t[k];
        if (v === undefined) continue;
        if (!Array.isArray(v) || v.length > 50 || v.some((x) => typeof x !== "string" || x.length > 60)) err(`asks.${k}`, "Must be a list of up to 50 phrases, each at most 60 characters");
        else mine[key] = asks[key] = (v as string[]).map((x) => x.trim().toLowerCase()).filter(Boolean);
      }
    }
  }

  // [ai] (optional, AI-0): use (true or false), monthly_cap_usd (0 to 1000), allowed_clients (client keys)
  const ai: AiPersonSettings = { ...DEFAULT_AI_PERSON, allowedClients: [] };
  if (raw.ai !== undefined) {
    const t = isTable(raw.ai) ? raw.ai : (err("ai", "Must be an [ai] table"), null);
    if (t) {
      for (const k of Object.keys(t)) if (!["use", "monthly_cap_usd", "allowed_clients", "draft_months"].includes(k)) err(`ai.${k}`, "Unknown field");
      if (t.use !== undefined) {
        if (typeof t.use !== "boolean") err("ai.use", "Must be true or false");
        else ai.use = t.use;
      }
      if (t.monthly_cap_usd !== undefined) {
        const c = t.monthly_cap_usd;
        if (typeof c !== "number" || !Number.isFinite(c) || c < 0 || c > 1000) err("ai.monthly_cap_usd", "Must be a number of dollars from 0 to 1000");
        else ai.monthlyCapUsd = c;
      }
      // DS-1: draft_months (1 to 36): how far back Draft stories looks for examples.
      if (t.draft_months !== undefined) {
        const m = t.draft_months;
        if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 36) err("ai.draft_months", "Must be a whole number of months from 1 to 36");
        else ai.draftMonths = m;
      }
      if (t.allowed_clients !== undefined) {
        const v = t.allowed_clients;
        if (!Array.isArray(v) || v.length > 200 || v.some((x) => typeof x !== "string" || !x.trim() || x.length > 100)) err("ai.allowed_clients", "Must be a list of client names");
        else ai.allowedClients = [...new Set((v as string[]).map((x) => x.trim()))];
      }
    }
  }

  // [guidance] (optional, ADM-1): draft_stories and readiness_nudges (true or false), plan_share (50 to 100, percent).
  // Each is the person's own override of their level's default; left out, the level's default applies.
  const guidance: Partial<Guidance> = {};
  if (raw.guidance !== undefined) {
    const t = isTable(raw.guidance) ? raw.guidance : (err("guidance", "Must be a [guidance] table"), null);
    if (t) {
      for (const k of Object.keys(t)) if (!["draft_stories", "readiness_nudges", "plan_share"].includes(k)) err(`guidance.${k}`, "Unknown field");
      for (const [k, key] of [["draft_stories", "draftStories"], ["readiness_nudges", "readinessNudges"]] as const) {
        if (t[k] === undefined) continue;
        if (typeof t[k] !== "boolean") err(`guidance.${k}`, "Must be true or false");
        else guidance[key] = t[k] as boolean;
      }
      if (t.plan_share !== undefined) {
        const v = t.plan_share;
        if (typeof v !== "number" || !Number.isInteger(v) || v < 50 || v > 100) err("guidance.plan_share", "Must be a whole number of percent from 50 to 100");
        else guidance.planShare = v;
      }
    }
  }

  // [keep_open] (optional, PL-1): "<client key>" = percent of that client's block hours left open for walk-ins, 0 to 80.
  const keepOpen: Record<string, number> = {};
  if (raw.keep_open !== undefined) {
    const t = isTable(raw.keep_open) ? raw.keep_open : (err("keep_open", "Must be a [keep_open] table"), null);
    if (t)
      for (const [k, v] of Object.entries(t)) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 80) err(`keep_open.${k}`, "Must be a whole number of percent from 0 to 80");
        else keepOpen[k] = v;
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
      secretExpiry,
      plan: { pickablePortfolioTypes, backgroundTypes, ...planOpts },
      ui,
      focus,
      timebox,
      collab,
      azure,
      notify,
      roadmap,
      asks,
      ai,
      aiRules: { ...DEFAULT_AI_RULES, allowedClients: [] },
      guidance,
      keepOpen,
      mine,
      org: null,
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
function parseHours(v: unknown, err: (field: string, message: string) => void, zone: (s: string) => string | null, defaultZone: string): TimeModel {
  const model: TimeModel = { timeZone: defaultZone, weekdays: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, lunch: null, overrides: [] };
  if (!isTable(v)) {
    err("hours", v === undefined ? "Missing [hours] section" : "Must be an [hours] table");
    return model;
  }
  for (const k of Object.keys(v)) if (!["time_zone", "lunch", "override", ...WEEKDAY_KEYS].includes(k)) err(`hours.${k}`, "Unknown field");
  // A1: the zone is the person's own setting; left out, the host clock's zone (the neutral default) applies.
  if (v.time_zone === undefined) model.timeZone = defaultZone;
  else if (typeof v.time_zone !== "string") err("hours.time_zone", "Must be a quoted string");
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
