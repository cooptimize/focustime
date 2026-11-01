// Settings (step 6b): one pure text edit per section of config.toml. Each keeps comments, order and every other
// line (config/edit.ts); writeConfig then validates the result, backs up and writes. Shape problems in the input
// throw SettingsInputError with the field they belong to; value problems come back from parseConfig per field.
import { WEEKDAY_KEYS, type WeekdayKey } from "../week/hours.ts";
import { hoursBody, removeValue, replaceArrayTables, replaceSection, setValue, tomlValue, type TomlValue } from "./edit.ts";
import { parseConfig } from "./schema.ts";

export const SETTINGS_SECTIONS = ["hours", "standing", "risk", "planning", "client", "display", "focus", "timebox"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export class SettingsInputError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown, field: string): Obj => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new SettingsInputError(field, "Must be an object");
  return v as Obj;
};
const only = (o: Obj, keys: string[], field: string) => {
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new SettingsInputError(`${field}.${k}`, "Unknown field");
};
const str = (v: unknown, field: string, max = 200): string => {
  if (typeof v !== "string" || v.length > max) throw new SettingsInputError(field, `Must be text of at most ${max} characters`);
  return v.trim();
};
const strList = (v: unknown, field: string): string[] => {
  if (!Array.isArray(v)) throw new SettingsInputError(field, "Must be a list");
  return v.map((x, i) => str(x, `${field}[${i}]`));
};
const int = (v: unknown, field: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new SettingsInputError(field, "Must be a whole number");
  return v;
};

/** Client keys may be any Dataverse nickname ("W&C"); TOML quotes them. */
const clientKey = (v: unknown) => {
  const k = str(v, "key", 100);
  if (!k) throw new SettingsInputError("key", "Missing client");
  return k;
};

/**
 * The text edit for one section. `extra.chromiumCommand` is written to [chromium] when a client switches to Chromium
 * and none is set yet.
 */
export function settingsEdit(section: SettingsSection, input: unknown, extra: { chromiumCommand?: string[] | null } = {}): (text: string) => string {
  const v = obj(input, section);
  switch (section) {
    case "hours": {
      only(v, ["timeZone", "lunch", "weekdays"], "hours");
      const timeZone = str(v.timeZone, "hours.time_zone", 80);
      const lunch = str(v.lunch ?? "", "hours.lunch", 11);
      const wd = obj(v.weekdays, "hours.weekdays");
      only(wd, [...WEEKDAY_KEYS], "hours");
      const weekdays = Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, strList(wd[k] ?? [], `hours.${k}`)])) as Record<WeekdayKey, string[]>;
      return (text) => {
        // hoursBody wants spans; write the strings as given so parseConfig reports bad ones on their own field.
        const body = hoursBody({ timeZone, lunch: null, weekdays: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, overrides: [] })
          .map((l) => (l.startsWith("lunch = ") ? `lunch = ${tomlValue(lunch)}` : l))
          .map((l) => {
            const k = WEEKDAY_KEYS.find((d) => l.startsWith(`${d} = `));
            return k ? `${k} = ${tomlValue(weekdays[k])}` : l;
          });
        let t = text;
        // A file still on [day_shape] can't have both: drop it (the loader migrates on its own otherwise).
        if (/^\s*\[day_shape\]/m.test(t)) t = t.replace(/^\s*\[day_shape\][^[]*/m, "");
        return replaceSection(t, "hours", body, "Working hours (step 6b). Used for capacity, risks, planning and the view range.");
      };
    }
    case "standing": {
      only(v, ["blocks"], "standing_blocks");
      if (!Array.isArray(v.blocks)) throw new SettingsInputError("standing_blocks", "Must be a list");
      const tables = v.blocks.map((b, i) => {
        const o = obj(b, `standing_blocks[${i}]`);
        only(o, ["day", "half", "client"], `standing_blocks[${i}]`);
        return [`day = ${tomlValue(str(o.day, `standing_blocks[${i}].day`, 3))}`, `half = ${tomlValue(str(o.half, `standing_blocks[${i}].half`, 2))}`, `client = ${tomlValue(str(o.client, `standing_blocks[${i}].client`, 100))}`];
      });
      return (text) => replaceArrayTables(text, "standing_blocks", tables, "Standing blocks: half-days you keep for a client every week.");
    }
    case "risk": {
      only(v, ["meetingWatchMinutes", "meetingAtRiskMinutes", "minFocusWindowMinutes"], "risk");
      const watch = int(v.meetingWatchMinutes, "risk.meeting_watch_minutes");
      const atRisk = int(v.meetingAtRiskMinutes, "risk.meeting_at_risk_minutes");
      const window = int(v.minFocusWindowMinutes, "risk.min_focus_window_minutes");
      return (text) => setValue(setValue(setValue(text, "risk", "meeting_watch_minutes", watch), "risk", "meeting_at_risk_minutes", atRisk), "risk", "min_focus_window_minutes", window);
    }
    case "planning": {
      const keys = ["pickablePortfolioTypes", "sizes", "carryDays", "reminderOffsetMinutes", "focusMinutes", "breakMinutes", "endSound", "followGraceDays", "closeoutReminderMinutes", "checkinReminderMinutes", "weekNudgeThu", "weekNudgeFri", "weekNudgeMon"];
      only(v, keys, "plan");
      const types = strList(v.pickablePortfolioTypes ?? [], "plan.pickable_portfolio_types").filter(Boolean);
      // Each value is written as given; parseConfig checks ranges and order per field (plan.size_m etc.).
      const values: [string, TomlValue][] = [["pickable_portfolio_types", types]];
      if (v.sizes !== undefined) {
        const sz = obj(v.sizes, "plan.sizes");
        only(sz, ["S", "M", "L"], "plan.sizes");
        for (const k of ["S", "M", "L"] as const) if (sz[k] !== undefined) values.push([`size_${k.toLowerCase()}`, int(sz[k], `plan.size_${k.toLowerCase()}`)]);
      }
      const num: [string, string][] = [["carryDays", "carry_days"], ["reminderOffsetMinutes", "reminder_offset_minutes"], ["focusMinutes", "focus_minutes"], ["breakMinutes", "break_minutes"], ["followGraceDays", "follow_grace_days"], ["closeoutReminderMinutes", "closeout_reminder_minutes"], ["checkinReminderMinutes", "checkin_reminder_minutes"]];
      for (const [k, toml] of num) if (v[k] !== undefined) values.push([toml, int(v[k], `plan.${toml}`)]);
      // Week nudge times (step 8): written as given ("" is off); parseConfig checks the format.
      for (const [k, toml] of [["weekNudgeThu", "week_nudge_thu"], ["weekNudgeFri", "week_nudge_fri"], ["weekNudgeMon", "week_nudge_mon"]] as const) if (v[k] !== undefined) values.push([toml, str(v[k], `plan.${toml}`, 5)]);
      if (v.endSound !== undefined) {
        if (typeof v.endSound !== "boolean") throw new SettingsInputError("plan.end_sound", "Must be true or false");
        values.push(["end_sound", v.endSound]);
      }
      return (text) => values.reduce((t, [k, val]) => setValue(t, "plan", k, val), text);
    }
    case "timebox": {
      // Step 12: two switches.
      only(v, ["outlookDefault", "confirmOwn"], "timebox");
      const values: [string, boolean][] = [];
      for (const [f, k] of [["outlookDefault", "outlook_default"], ["confirmOwn", "confirm_own"]] as const) {
        if (v[f] === undefined) continue;
        if (typeof v[f] !== "boolean") throw new SettingsInputError(`timebox.${k}`, "Must be true or false");
        values.push([k, v[f]]);
      }
      return (text) => values.reduce((t, [k, val], i) => setValue(t, "timebox", k, val, i === 0 ? "Timeboxes (step 12). Creating an Outlook event always asks first; confirm_own = false skips the question for changes to my own timebox events (still logged, still undoable)." : undefined), text);
    }
    case "focus": {
      // Step 10. Written as given; parseConfig checks values and links per field (focus.playlists[0].url etc.).
      only(v, ["sound", "volume", "fadeSeconds", "onBreak", "pauseMedia", "playlists"], "focus");
      const values: [string, TomlValue][] = [];
      if (v.sound !== undefined) values.push(["sound", str(v.sound, "focus.sound", 20)]);
      if (v.volume !== undefined) values.push(["volume", int(v.volume, "focus.volume")]);
      if (v.fadeSeconds !== undefined) values.push(["fade_seconds", int(v.fadeSeconds, "focus.fade_seconds")]);
      if (v.onBreak !== undefined) values.push(["on_break", str(v.onBreak, "focus.on_break", 20)]);
      if (v.pauseMedia !== undefined) {
        if (typeof v.pauseMedia !== "boolean") throw new SettingsInputError("focus.pause_media", "Must be true or false");
        values.push(["pause_media", v.pauseMedia]);
      }
      if (v.playlists !== undefined) {
        if (!Array.isArray(v.playlists)) throw new SettingsInputError("focus.playlists", "Must be a list");
        values.push(["playlists", v.playlists.map((x, i) => {
          const o = obj(x, `focus.playlists[${i}]`);
          only(o, ["name", "url"], `focus.playlists[${i}]`);
          return { name: str(o.name, `focus.playlists[${i}].name`, 60), url: str(o.url, `focus.playlists[${i}].url`, 500) };
        })]);
      }
      return (text) => values.reduce((t, [k, val], i) => setValue(t, "focus", k, val, i === 0 ? "Focus sounds and playlists (step 10). Sounds are made in the app; playlists open in Spotify or the browser." : undefined), text);
    }
    case "display": {
      only(v, ["theme", "viewRange"], "ui");
      const theme = str(v.theme, "ui.theme", 40);
      const range = str(v.viewRange, "ui.view_range", 20);
      return (text) => setValue(setValue(text, "ui", "theme", theme), "ui", "view_range", range);
    }
    case "client": {
      only(v, ["key", "color", "name", "browser", "profile", "openStates", "follow"], "clients");
      const key = clientKey(v.key);
      const f = `clients.${key}`;
      const table: Record<string, TomlValue> = {};
      const color = v.color == null ? "" : str(v.color, `${f}.color`, 20);
      if (color) table.color = color;
      const name = v.name == null ? "" : str(v.name, `${f}.name`, 60);
      if (name) table.name = name;
      const browser = v.browser == null ? "edge" : str(v.browser, `${f}.browser`, 20);
      table.browser = browser;
      const profile = v.profile == null ? "" : str(v.profile, `${f}.profile`, 64);
      if (profile) table.profile = profile;
      const open = v.openStates == null ? [] : strList(v.openStates, `${f}.open_states`).filter(Boolean);
      if (open.length) table.open_states = open;
      if (v.follow !== undefined && v.follow !== null && v.follow !== false) {
        if (v.follow !== true) throw new SettingsInputError(`${f}.follow`, "Must be true or false");
        table.follow = true;
      }
      return (text) => {
        let t = setValue(text, "clients", key, table);
        if (browser === "chromium" && extra.chromiumCommand?.length) {
          const now = parseConfig(t);
          if (now.ok && !now.config.chromium.command.length) t = setValue(t, "chromium", "command", extra.chromiumCommand, "Chromium for client links (Settings > Clients).");
        }
        return t;
      };
    }
  }
}

/** The expiry date of an app secret in [secrets] (null removes it). Never the secret itself. */
export function secretExpiryEdit(account: "dataverse-client-secret" | "google-client-secret", expires: string | null): (text: string) => string {
  const key = account === "dataverse-client-secret" ? "dataverse_client_secret_expires" : "google_client_secret_expires";
  return (text) => (expires ? setValue(text, "secrets", key, expires, "Expiry dates of keyring secrets (the secrets themselves are only in the keyring).") : removeValue(text, "secrets", key));
}
