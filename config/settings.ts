// Settings (step 6b): one pure text edit per section of config.toml. Each keeps comments, order and every other
// line (config/edit.ts); writeConfig then validates the result, backs up and writes. Shape problems in the input
// throw SettingsInputError with the field they belong to; value problems come back from parseConfig per field.
import { WEEKDAY_KEYS, type WeekdayKey } from "../week/hours.ts";
import { hoursBody, removeValue, replaceArrayTables, replaceSection, setValue, tomlValue, type TomlValue } from "./edit.ts";
import { NOTIFY_KINDS } from "../plan/notify.ts";
import { AUTOSTART_MINUTES, validAutoStartMinutes } from "../plan/vm-autostart.ts";

export const SETTINGS_SECTIONS = ["hours", "standing", "risk", "planning", "client", "display", "focus", "timebox", "collab", "notify", "vm", "roadmap", "ahead", "asks", "ai", "guidance", "keep_open"] as const;
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

/** Client keys may be any Dataverse nickname ("A&B"); TOML quotes them. */
const clientKey = (v: unknown) => {
  const k = str(v, "key", 100);
  if (!k) throw new SettingsInputError("key", "Missing client");
  return k;
};

/** The text edit for one section. */
export function settingsEdit(section: SettingsSection, input: unknown): (text: string) => string {
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
      // WT-1, ADM-1: which types need breakdown or count hours are Rules per client in Admin › Clients now.
      const keys = ["unsizedMinutes", "minSizes", "carryDays", "reminderOffsetMinutes", "focusMinutes", "breakMinutes", "endSound", "followGraceDays", "closeoutReminderMinutes", "checkinReminderMinutes", "devopsOnDone", "weekNudgeThu", "weekNudgeFri", "weekNudgeMon", "progressOffer", "suggest"];
      only(v, keys, "plan");
      // Each value is written as given; parseConfig checks ranges per field (plan.min_m etc.). Sizes are fixed (E2).
      const values: [string, TomlValue][] = [];
      if (v.minSizes !== undefined) {
        const mz = obj(v.minSizes, "plan.min_sizes");
        only(mz, ["S", "M", "L"], "plan.min_sizes");
        for (const k of ["S", "M", "L"] as const) if (mz[k] !== undefined) values.push([`min_${k.toLowerCase()}`, int(mz[k], `plan.min_${k.toLowerCase()}`)]);
      }
      const num: [string, string][] = [["unsizedMinutes", "unsized_minutes"], ["carryDays", "carry_days"], ["reminderOffsetMinutes", "reminder_offset_minutes"], ["focusMinutes", "focus_minutes"], ["breakMinutes", "break_minutes"], ["followGraceDays", "follow_grace_days"], ["closeoutReminderMinutes", "closeout_reminder_minutes"], ["checkinReminderMinutes", "checkin_reminder_minutes"]];
      for (const [k, toml] of num) if (v[k] !== undefined) values.push([toml, int(v[k], `plan.${toml}`)]);
      // Week nudge times (step 8): written as given ("" is off); parseConfig checks the format.
      for (const [k, toml] of [["weekNudgeThu", "week_nudge_thu"], ["weekNudgeFri", "week_nudge_fri"], ["weekNudgeMon", "week_nudge_mon"]] as const) if (v[k] !== undefined) values.push([toml, str(v[k], `plan.${toml}`, 5)]);
      if (v.endSound !== undefined) {
        if (typeof v.endSound !== "boolean") throw new SettingsInputError("plan.end_sound", "Must be true or false");
        values.push(["end_sound", v.endSound]);
      }
      // PK-1: when I check off a to-do, ask to update DevOps ("ask", the default) or never ask.
      if (v.progressOffer !== undefined) {
        if (typeof v.progressOffer !== "boolean") throw new SettingsInputError("plan.devops_progress_offer", "Must be true or false");
        values.push(["devops_progress_offer", v.progressOffer]);
      }
      // SG-1: Suggest work for empty blocks.
      if (v.suggest !== undefined) {
        if (typeof v.suggest !== "boolean") throw new SettingsInputError("plan.suggest_empty_blocks", "Must be true or false");
        values.push(["suggest_empty_blocks", v.suggest]);
      }
      if (v.devopsOnDone !== undefined) {
        if (v.devopsOnDone !== "ask" && v.devopsOnDone !== "never") throw new SettingsInputError("plan.devops_on_done", 'Must be "ask" or "never"');
        values.push(["devops_on_done", v.devopsOnDone]);
      }
      return (text) => values.reduce((t, [k, val]) => setValue(t, "plan", k, val), text);
    }
    case "timebox": {
      // Step 12: two switches.
      only(v, ["outlookDefault", "confirmOwn", "enabled"], "timebox");
      const values: [string, boolean][] = [];
      for (const [f, k] of [["outlookDefault", "outlook_default"], ["confirmOwn", "confirm_own"], ["enabled", "enabled"]] as const) {
        if (v[f] === undefined) continue;
        if (typeof v[f] !== "boolean") throw new SettingsInputError(`timebox.${k}`, "Must be true or false");
        values.push([k, v[f]]);
      }
      return (text) => values.reduce((t, [k, val], i) => setValue(t, "timebox", k, val, i === 0 ? "Timeboxes (step 12). Creating an Outlook event always asks first; confirm_own = false skips the question for changes to my own timebox events (still logged, still undoable)." : undefined), text);
    }
    case "collab": {
      // Step 13: help session length, Teams, days to search. Domains are edited in the file only.
      only(v, ["meetingMinutes", "teams", "daysAhead", "exclude"], "collab");
      const values: [string, TomlValue][] = [];
      if (v.exclude !== undefined) values.push(["exclude", strList(v.exclude, "collab.exclude").filter(Boolean)]);
      if (v.meetingMinutes !== undefined) {
        if (typeof v.meetingMinutes !== "number") throw new SettingsInputError("collab.meeting_minutes", "Must be a number");
        values.push(["meeting_minutes", v.meetingMinutes]);
      }
      if (v.teams !== undefined) {
        if (typeof v.teams !== "boolean") throw new SettingsInputError("collab.teams", "Must be true or false");
        values.push(["teams", v.teams]);
      }
      if (v.daysAhead !== undefined) {
        if (typeof v.daysAhead !== "number") throw new SettingsInputError("collab.days_ahead", "Must be a number");
        values.push(["days_ahead", v.daysAhead]);
      }
      return (text) => values.reduce((t, [k, val], i) => setValue(t, "collab", k, val, i === 0 ? "Help sessions (step 13). Invites go only to Cooptimize addresses (domains, default: my work email's) and always ask first." : undefined), text);
    }
    case "focus": {
      // Step 10. Written as given; parseConfig checks values and links per field (focus.playlists[0].url etc.).
      only(v, ["sound", "volume", "fadeSeconds", "onBreak", "pauseMedia", "playlists", "teamsStatus", "plainFocusStatus"], "focus");
      const values: [string, TomlValue][] = [];
      if (v.sound !== undefined) values.push(["sound", str(v.sound, "focus.sound", 20)]);
      if (v.volume !== undefined) values.push(["volume", int(v.volume, "focus.volume")]);
      if (v.fadeSeconds !== undefined) values.push(["fade_seconds", int(v.fadeSeconds, "focus.fade_seconds")]);
      if (v.onBreak !== undefined) values.push(["on_break", str(v.onBreak, "focus.on_break", 20)]);
      if (v.pauseMedia !== undefined) {
        if (typeof v.pauseMedia !== "boolean") throw new SettingsInputError("focus.pause_media", "Must be true or false");
        values.push(["pause_media", v.pauseMedia]);
      }
      if (v.teamsStatus !== undefined) {
        if (typeof v.teamsStatus !== "boolean") throw new SettingsInputError("focus.teams_status", "Must be true or false");
        values.push(["teams_status", v.teamsStatus]);
      }
      if (v.plainFocusStatus !== undefined) values.push(["plain_focus_status", str(v.plainFocusStatus, "focus.plain_focus_status", 10)]);
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
    case "notify": {
      // Step 15.5: Settings > Notifications. Written as given; parseConfig checks each value.
      only(v, ["kinds", "quiet", "quietPto", "pushDetails", "asksThroughFocus", "teamsMessages", "fromTestSite", "teams", "status"], "notify");
      const values: [string, TomlValue][] = [];
      if (v.kinds !== undefined) {
        const k = obj(v.kinds, "notify");
        only(k, [...NOTIFY_KINDS], "notify");
        for (const kind of NOTIFY_KINDS) {
          if (k[kind] === undefined) continue;
          if (typeof k[kind] !== "boolean") throw new SettingsInputError(`notify.${kind}`, "Must be true or false");
          values.push([kind, k[kind] as boolean]);
        }
      }
      if (v.quiet !== undefined) values.push(["quiet", str(v.quiet, "notify.quiet", 20)]);
      if (v.quietPto !== undefined) {
        if (typeof v.quietPto !== "boolean") throw new SettingsInputError("notify.quiet_pto", "Must be true or false");
        values.push(["quiet_pto", v.quietPto]);
      }
      if (v.pushDetails !== undefined) {
        if (typeof v.pushDetails !== "boolean") throw new SettingsInputError("notify.push_details", "Must be true or false");
        values.push(["push_details", v.pushDetails]);
      }
      if (v.teamsMessages !== undefined) {
        if (typeof v.teamsMessages !== "boolean") throw new SettingsInputError("notify.teams_messages", "Must be true or false");
        values.push(["teams_messages", v.teamsMessages]);
      }
      if (v.fromTestSite !== undefined) {
        if (typeof v.fromTestSite !== "boolean") throw new SettingsInputError("notify.from_test_site", "Must be true or false");
        values.push(["from_test_site", v.fromTestSite]);
      }
      if (v.asksThroughFocus !== undefined) {
        if (typeof v.asksThroughFocus !== "boolean") throw new SettingsInputError("notify.asks_through_focus", "Must be true or false");
        values.push(["asks_through_focus", v.asksThroughFocus]);
      }
      if (v.teams !== undefined) {
        // TB-2: Settings › Notifications › In Teams. parseConfig checks the times and the minutes.
        const t = obj(v.teams, "notify.teams");
        only(t, ["brief", "checkin", "closeout", "nudges", "status", "meetings", "friday", "briefAt", "checkinAt", "closeoutMinutes"], "notify.teams");
        for (const k of ["brief", "checkin", "closeout", "nudges", "status", "meetings", "friday"] as const) {
          if (t[k] === undefined) continue;
          if (typeof t[k] !== "boolean") throw new SettingsInputError(`notify.teams_${k}`, "Must be true or false");
          values.push([`teams_${k}`, t[k] as boolean]);
        }
        if (t.briefAt !== undefined) values.push(["teams_brief_at", t.briefAt === null ? "start" : str(t.briefAt, "notify.teams_brief_at", 5)]);
        if (t.checkinAt !== undefined) values.push(["teams_checkin_at", str(t.checkinAt, "notify.teams_checkin_at", 5)]);
        if (t.closeoutMinutes !== undefined) values.push(["teams_closeout_minutes", int(t.closeoutMinutes, "notify.teams_closeout_minutes")]);
      }
      if (v.status !== undefined) {
        // SR-1: the status nudge's Sunday option and times. parseConfig checks the times.
        const t = obj(v.status, "notify.status");
        only(t, ["sunday", "fridayAt", "sundayAt"], "notify.status");
        if (t.sunday !== undefined) {
          if (typeof t.sunday !== "boolean") throw new SettingsInputError("notify.status_sunday", "Must be true or false");
          values.push(["status_sunday", t.sunday]);
        }
        if (t.fridayAt !== undefined) values.push(["status_friday_at", str(t.fridayAt, "notify.status_friday_at", 5)]);
        if (t.sundayAt !== undefined) values.push(["status_sunday_at", str(t.sundayAt, "notify.status_sunday_at", 5)]);
      }
      return (text) => values.reduce((t, [k, val], i) => setValue(t, "notify", k, val, i === 0 ? "Notifications (step 15.5): a switch per kind and quiet hours. During focus, all but the timer and meeting warnings wait until it ends." : undefined), text);
    }
    case "roadmap": {
      // Step 17: Settings > Roadmap. Written as given; parseConfig checks the ranges.
      only(v, ["stalledDays", "watchWeeks"], "roadmap");
      const values: [string, number][] = [];
      if (v.stalledDays !== undefined) values.push(["stalled_days", int(v.stalledDays, "roadmap.stalled_days")]);
      if (v.watchWeeks !== undefined) values.push(["watch_weeks", int(v.watchWeeks, "roadmap.watch_weeks")]);
      return (text) => values.reduce((t, [k, val], i) => setValue(t, "roadmap", k, val, i === 0 ? "Backlog states (step 17): Stalled after this many days without a story change; Watch when the forecast lands within this many weeks of the target date." : undefined), text);
    }
    case "ahead": {
      // BH-1: Settings › Ahead. Written as given; parseConfig checks the range.
      only(v, ["staleWeeks"], "ahead");
      const values: [string, number][] = [];
      if (v.staleWeeks !== undefined) values.push(["stale_weeks", int(v.staleWeeks, "ahead.stale_weeks")]);
      return (text) => values.reduce((t, [k, val], i) => setValue(t, "ahead", k, val, i === 0 ? "Backlog (BH-1): an open item with no change in DevOps for this many weeks is stale in Backlog." : undefined), text);
    }
    case "asks": {
      // AP-1: Settings > Clients > Asks. ADM-1: these are the person's own phrases, added on top of the team's (they
      // can't remove a team phrase); how often chats are read is the admins' (the old poll_minutes goes on any save).
      only(v, ["requestPhrases", "ackPhrases", "promisePhrases"], "asks");
      const values: [string, number | string[]][] = [];
      if (v.requestPhrases !== undefined) values.push(["request_phrases", strList(v.requestPhrases, "asks.request_phrases").map((x) => x.trim()).filter(Boolean)]);
      if (v.ackPhrases !== undefined) values.push(["ack_phrases", strList(v.ackPhrases, "asks.ack_phrases").map((x) => x.trim()).filter(Boolean)]);
      if (v.promisePhrases !== undefined) values.push(["promise_phrases", strList(v.promisePhrases, "asks.promise_phrases").map((x) => x.trim()).filter(Boolean)]);
      return (text) => values.reduce((t, [k, val], i) => setValue(t, "asks", k, val, i === 0 ? "Client chats (AP-1, ADM-1): my own phrases, on top of the team's." : undefined), removeValue(text, "asks", "poll_minutes"));
    }
    case "ai": {
      // ADM-1: AI is an admin decision (Admin › AI): only how far back Draft stories looks is a person's own.
      only(v, ["draftMonths"], "ai");
      const values: [string, boolean | number | string[]][] = [];
      if (v.draftMonths !== undefined) {
        const m = v.draftMonths;
        if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 36) throw new SettingsInputError("ai.draft_months", "Must be a whole number of months from 1 to 36");
        values.push(["draft_months", m]);
      }
      return (text) => values.reduce((t, [k, val]) => setValue(t, "ai", k, val), text);
    }
    case "keep_open": {
      // PL-1: one client's Keep open share (Commit mode's client card); null goes back to the level's default.
      only(v, ["key", "percent"], "keep_open");
      const key = clientKey(v.key);
      if (v.percent !== null) {
        const n = int(v.percent, `keep_open.${key}`);
        if (n < 0 || n > 80) throw new SettingsInputError(`keep_open.${key}`, "Must be from 0 to 80 percent");
      }
      const pct = v.percent as number | null;
      return (text) => (pct === null ? removeValue(text, "keep_open", key) : setValue(text, "keep_open", key, pct, "Keep open (PL-1): % of a client's block hours left unplanned for walk-ins."));
    }
    case "guidance": {
      // ADM-1: the person's own choices over their level's defaults; null goes back to the team default.
      only(v, ["draftStories", "readinessNudges", "planShare"], "guidance");
      const edits: [string, boolean | number | null][] = [];
      for (const [k, key] of [["draftStories", "draft_stories"], ["readinessNudges", "readiness_nudges"]] as const) {
        if (v[k] === undefined) continue;
        if (v[k] !== null && typeof v[k] !== "boolean") throw new SettingsInputError(`guidance.${key}`, "Must be true, false or null");
        edits.push([key, v[k] as boolean | null]);
      }
      if (v.planShare !== undefined) {
        if (v.planShare !== null) {
          const n = int(v.planShare, "guidance.plan_share");
          if (n < 50 || n > 100) throw new SettingsInputError("guidance.plan_share", "Must be from 50 to 100 percent");
        }
        edits.push(["plan_share", v.planShare as number | null]);
      }
      return (text) => edits.reduce((t, [k, val]) => (val === null ? removeValue(t, "guidance", k) : setValue(t, "guidance", k, val, "Guidance (ADM-1): my own choices over my level's defaults.")), text);
    }
    case "vm": {
      // Step 15.5 (Q87): "Start without a preview" (was "Start my VM without asking"). VM-2: "Start my VM before my
      // day" (production only), its minutes and the days switched off. Any of them; each written only when given.
      only(v, ["startWithoutAsking", "autoStart", "autoStartMinutes", "autoStartOffDays"], "azure");
      const edits: [string, TomlValue][] = [];
      if (v.startWithoutAsking !== undefined) {
        if (typeof v.startWithoutAsking !== "boolean") throw new SettingsInputError("azure.start_without_asking", "Must be true or false");
        edits.push(["start_without_asking", v.startWithoutAsking]);
      }
      if (v.autoStart !== undefined) {
        if (typeof v.autoStart !== "boolean") throw new SettingsInputError("azure.auto_start", "Must be true or false");
        edits.push(["auto_start", v.autoStart]);
      }
      if (v.autoStartMinutes !== undefined) {
        if (!validAutoStartMinutes(v.autoStartMinutes)) throw new SettingsInputError("azure.auto_start_minutes", `Must be one of ${AUTOSTART_MINUTES.join(", ")}`);
        edits.push(["auto_start_minutes", v.autoStartMinutes]);
      }
      if (v.autoStartOffDays !== undefined) {
        const days = v.autoStartOffDays;
        if (!Array.isArray(days) || days.length > 7 || days.some((d) => !(WEEKDAY_KEYS as readonly unknown[]).includes(d))) throw new SettingsInputError("azure.auto_start_off_days", "Must be a list of days: mon, tue, wed, thu, fri, sat, sun");
        edits.push(["auto_start_off_days", [...new Set(days as string[])]]);
      }
      if (!edits.length) throw new SettingsInputError("azure", "Nothing to save");
      return (text) => edits.reduce((t, [k, val], i) => setValue(t, "azure", k, val, i === 0 ? "My VM (step 15.4)." : undefined), text);
    }
    case "display": {
      only(v, ["theme", "viewRange", "showTimelines"], "ui");
      const theme = str(v.theme, "ui.theme", 40);
      const range = str(v.viewRange, "ui.view_range", 20);
      if (v.showTimelines !== undefined && typeof v.showTimelines !== "boolean") throw new SettingsInputError("ui.show_timelines", "Must be true or false");
      const timelines = v.showTimelines as boolean | undefined;
      return (text) => {
        const t = setValue(setValue(text, "ui", "theme", theme), "ui", "view_range", range);
        return timelines === undefined ? t : setValue(t, "ui", "show_timelines", timelines);
      };
    }
    case "client": {
      only(v, ["key", "color", "name", "openStates", "follow"], "clients");
      const key = clientKey(v.key);
      const f = `clients.${key}`;
      const table: Record<string, TomlValue> = {};
      const color = v.color == null ? "" : str(v.color, `${f}.color`, 20);
      if (color) table.color = color;
      const name = v.name == null ? "" : str(v.name, `${f}.name`, 60);
      if (name) table.name = name;
      // ADM-1: states treated as open are a Rule per client (Admin › Clients); a person's own are no longer kept.
      if (v.openStates != null) strList(v.openStates, `${f}.open_states`);
      if (v.follow !== undefined && v.follow !== null && v.follow !== false) {
        if (v.follow !== true) throw new SettingsInputError(`${f}.follow`, "Must be true or false");
        table.follow = true;
      }
      return (text) => setValue(text, "clients", key, table);
    }
  }
}

