import { describe, expect, it } from "vitest";
import { migrateDayShapeText } from "./edit.ts";
import { DEFAULT_PLAN, legacyHours, parseConfig, setSystemUserIdInText } from "./schema.ts";
import { STARTER_TOML } from "./starter.ts";

const valid = `
[dataverse]
environment_url = "https://example.crm.dynamics.com"
tenant_id = "11111111-1111-4111-8111-111111111111"
client_id = "22222222-2222-4222-8222-222222222222"
my_email = "me@example.com"
my_systemuserid = "33333333-3333-4333-8333-333333333333"

[day_shape]
start = "09:00"
split = "12:30"
end = "17:00"
time_zone = "America/New_York"

[risk]
meeting_watch_minutes = 90
meeting_at_risk_minutes = 150
min_focus_window_minutes = 90

[[standing_blocks]]
day = "Mon"
half = "AM"
client = "Internal"

[clients]
WC = "#1f9e8f"
Internal = "#4a7fd4"
`;

const fields = (text: string) => {
  const r = parseConfig(text);
  return r.ok ? [] : r.errors.map((e) => e.field);
};

describe("parseConfig", () => {
  it("accepts a complete config and maps it to the app shape", () => {
    const r = parseConfig(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.dataverse).toEqual({
      environmentUrl: "https://example.crm.dynamics.com",
      tenantId: "11111111-1111-4111-8111-111111111111",
      clientId: "22222222-2222-4222-8222-222222222222",
      myEmail: "me@example.com",
      mySystemUserId: "33333333-3333-4333-8333-333333333333",
    });
    expect(r.config.week.standingBlocks).toEqual([{ day: "Mon", half: "AM", clientKey: "Internal", clientName: "Internal" }]);
    expect(r.config.week.hours).toEqual(legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: "America/New_York" }));
    expect(r.config.clients).toEqual({ WC: "#1f9e8f", Internal: "#4a7fd4" });
  });

  it("treats an empty systemuserid as not resolved yet", () => {
    const r = parseConfig(valid.replace(/my_systemuserid = ".*"/, 'my_systemuserid = ""'));
    expect(r.ok && r.config.dataverse.mySystemUserId).toBe(null);
  });

  it("strips a trailing slash from the environment URL", () => {
    const r = parseConfig(valid.replace("dynamics.com\"", 'dynamics.com/"'));
    expect(r.ok && r.config.dataverse.environmentUrl).toBe("https://example.crm.dynamics.com");
  });

  it.each([
    ["dataverse.environment_url", 'environment_url = "http://example.crm.dynamics.com"'],
    ["dataverse.environment_url", 'environment_url = "https://evil.example.com"'],
    ["dataverse.tenant_id", 'tenant_id = "not-a-guid"'],
    ["dataverse.client_id", 'client_id = ""'],
    ["dataverse.my_email", 'my_email = "nope"'],
    ["dataverse.my_systemuserid", 'my_systemuserid = "abc"'],
    ["day_shape.start", 'start = "9am"'],
    ["day_shape.time_zone", 'time_zone = "Mars/Olympus"'],
    ["risk.meeting_watch_minutes", "meeting_watch_minutes = -5"],
    ["standing_blocks[0].day", 'day = "Fri"'],
    ["standing_blocks[0].half", 'half = "Noon"'],
    ["clients.WC", 'WC = "teal"'],
  ])("names %s when it is invalid", (field, line) => {
    const key = line.split(" = ")[0]!;
    const text = valid.replace(new RegExp(`^${key} = .*$`, "m"), line);
    expect(fields(text)).toContain(field);
  });

  it("requires start < split < end", () => {
    expect(fields(valid.replace('split = "12:30"', 'split = "08:00"'))).toContain("day_shape.split");
  });

  it("requires the at-risk threshold to be at least the watch threshold", () => {
    expect(fields(valid.replace("meeting_at_risk_minutes = 150", "meeting_at_risk_minutes = 60"))).toContain("risk.meeting_at_risk_minutes");
  });

  it("names missing sections and fields", () => {
    expect(fields(valid.replace(/\[dataverse\][\s\S]*?\n\n/, ""))).toContain("dataverse");
    expect(fields(valid.replace(/^tenant_id = .*$/m, ""))).toContain("dataverse.tenant_id");
  });

  it("rejects unknown fields so typos are caught", () => {
    expect(fields(valid.replace("[risk]", "[risk]\nmeeting_wach_minutes = 3"))).toContain("risk.meeting_wach_minutes");
  });

  it("reports TOML syntax errors with a line", () => {
    const r = parseConfig("[dataverse\nfoo = 1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.field).toBe("(file)");
    expect(r.errors[0]?.message).toMatch(/line/i);
  });

  it("parses the starter file, which only lacks my_email", () => {
    expect(fields(STARTER_TOML)).toEqual(["dataverse.my_email"]);
  });
});

describe("setSystemUserIdInText", () => {
  it("fills in my_systemuserid and keeps comments and other lines", () => {
    const text = '# keep me\n[dataverse]\nmy_email = "me@example.com"\nmy_systemuserid = ""  # auto\n';
    const out = setSystemUserIdInText(text, "33333333-3333-4333-8333-333333333333");
    expect(out).toBe('# keep me\n[dataverse]\nmy_email = "me@example.com"\nmy_systemuserid = "33333333-3333-4333-8333-333333333333"  # auto\n');
  });

  it("refuses a value that is not a GUID", () => {
    expect(() => setSystemUserIdInText('my_systemuserid = ""\n', 'x" \n evil = "1')).toThrow();
  });
});

describe("calendar sections", () => {
  const withCal = `${valid}
[outlook]
tenant_id = "11111111-1111-4111-8111-111111111111"
client_id = "44444444-4444-4444-8444-444444444444"

[google]
client_id = "123456-abc.apps.googleusercontent.com"
calendars = ["primary", "family123@group.calendar.google.com"]
`;

  it("are optional: without them Outlook and Google are not configured", () => {
    const r = parseConfig(valid);
    expect(r.ok && [r.config.outlook, r.config.google]).toEqual([null, null]);
  });

  it("parse client IDs and the calendar list", () => {
    const r = parseConfig(withCal);
    expect(r.ok && r.config.outlook).toEqual({ tenantId: "11111111-1111-4111-8111-111111111111", clientId: "44444444-4444-4444-8444-444444444444" });
    expect(r.ok && r.config.google).toEqual({ clientId: "123456-abc.apps.googleusercontent.com", calendars: ["primary", "family123@group.calendar.google.com"] });
  });

  it("treat an empty client_id as not set up yet", () => {
    const r = parseConfig(withCal.replace('client_id = "44444444-4444-4444-8444-444444444444"', 'client_id = ""').replace('client_id = "123456-abc.apps.googleusercontent.com"', 'client_id = ""'));
    expect(r.ok && [r.config.outlook, r.config.google]).toEqual([null, null]);
  });

  it.each([
    ["outlook.client_id", 'client_id = "44444444-4444-4444-8444-444444444444"', 'client_id = "nope"'],
    ["google.client_id", 'client_id = "123456-abc.apps.googleusercontent.com"', 'client_id = "123456"'],
    ["google.calendars", 'calendars = ["primary", "family123@group.calendar.google.com"]', "calendars = []"],
    ["google.calendars[0]", 'calendars = ["primary", "family123@group.calendar.google.com"]', 'calendars = ["has space"]'],
  ])("name %s when invalid", (field, from, to) => {
    expect(fields(withCal.replace(from, to))).toContain(field);
  });

  it("the starter file has both sections, not yet set up", () => {
    const r = parseConfig(STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"'));
    expect(r.ok && [r.config.outlook, r.config.google]).toEqual([null, null]);
    expect(STARTER_TOML).toContain("[outlook]");
    expect(STARTER_TOML).toContain('calendars = ["primary"]');
  });
});

describe("[plan] pickable portfolio types (Q20)", () => {
  it("is optional and empty by default", () => {
    const r = parseConfig(valid);
    expect(r.ok && r.config.plan).toEqual({ pickablePortfolioTypes: [], ...DEFAULT_PLAN });
  });
  it("reads a list of type names", () => {
    const r = parseConfig(`${valid}\n[plan]\npickable_portfolio_types = ["Recurring", " Ongoing "]\n`);
    expect(r.ok && r.config.plan.pickablePortfolioTypes).toEqual(["Recurring", "Ongoing"]);
  });
  it("names bad values and unknown fields", () => {
    expect(fields(`${valid}\n[plan]\npickable_portfolio_types = "Recurring"\n`)).toEqual(["plan.pickable_portfolio_types"]);
    expect(fields(`${valid}\n[plan]\npickable_portfolio_types = ["", 3]\n`)).toEqual(["plan.pickable_portfolio_types[0]", "plan.pickable_portfolio_types[1]"]);
    expect(fields(`${valid}\n[plan]\ntypes = []\n`)).toEqual(["plan.types"]);
  });
});

describe("[plan] planning settings (step 6c, Q36)", () => {
  it("reads sizes, carry-over days, the reminder offset and timer defaults", () => {
    const r = parseConfig(`${valid}\n[plan]\nsize_s = 45\nsize_m = 90\nsize_l = 180\ncarry_days = 0\nreminder_offset_minutes = 30\nfocus_minutes = 25\nbreak_minutes = 5\nend_sound = true\nfollow_grace_days = 30\ncloseout_reminder_minutes = 30\ncheckin_reminder_minutes = 15\nweek_nudge_thu = "15:30"\nweek_nudge_fri = ""\nweek_nudge_mon = "08:00"\n`);
    expect(r.ok && r.config.plan).toEqual({ pickablePortfolioTypes: [], sizes: { S: 45, M: 90, L: 180 }, carryDays: 0, reminderOffsetMinutes: 30, focusMinutes: 25, breakMinutes: 5, endSound: true, followGraceDays: 30, closeoutReminderMinutes: 30, checkinReminderMinutes: 15, weekNudgeThu: "15:30", weekNudgeFri: "", weekNudgeMon: "08:00" });
    // Old configs get 14 days of grace.
    expect(parseConfig(valid).ok && (parseConfig(valid) as { config: { plan: { followGraceDays: number } } }).config.plan.followGraceDays).toBe(14);
  });
  it("refuses sizes out of order or off the 5-minute steps, per field", () => {
    expect(fields(`${valid}\n[plan]\nsize_s = 47\n`)).toEqual(["plan.size_s"]);
    expect(fields(`${valid}\n[plan]\nsize_m = 50\n`)).toEqual(["plan.size_m"]);
    expect(fields(`${valid}\n[plan]\ncarry_days = 31\nfocus_minutes = 0\nend_sound = "yes"\n`)).toEqual(["plan.carry_days", "plan.focus_minutes", "plan.end_sound"]);
    expect(fields(`${valid}\n[plan]\nfollow_grace_days = 91\n`)).toEqual(["plan.follow_grace_days"]);
    expect(fields(`${valid}\n[plan]\ncloseout_reminder_minutes = 125\ncheckin_reminder_minutes = 7\n`)).toEqual(["plan.closeout_reminder_minutes", "plan.checkin_reminder_minutes"]);
    expect(fields(`${valid}\n[plan]\nweek_nudge_thu = "2pm"\nweek_nudge_fri = 9\nweek_nudge_mon = "24:00"\n`)).toEqual(["plan.week_nudge_thu", "plan.week_nudge_fri", "plan.week_nudge_mon"]);
  });

  it("reads Keep following per client (step 6d)", () => {
    const r = parseConfig(valid.replace("[clients]\n", "[clients]\nHME = { follow = true }\nKEEP = \"#d2892a\"\n"));
    expect(r.ok && r.config.clientSettings.HME?.follow).toBe(true);
    expect(r.ok && r.config.clientSettings.KEEP?.follow).toBe(false);
    expect(fields(valid.replace("[clients]\n", "[clients]\nHME = { follow = \"yes\" }\n"))).toEqual(["clients.HME.follow"]);
  });
});

describe("[edge] link profiles (step 5.5)", () => {
  it("is optional: no Edge, links fall back to the default browser", () => {
    const r = parseConfig(valid);
    expect(r.ok && r.config.edge).toEqual({ command: [], profiles: {}, fallbackCommand: ["omarchy-launch-browser"] });
  });
  it("reads the launch command and client profiles", () => {
    const r = parseConfig(`${valid}\n[edge]\ncommand = ["uwsm-app", "--", "/usr/bin/microsoft-edge-stable"]\n[edge.profiles]\nCSC = "Profile 3"\n"W&C" = "Default"\n`);
    expect(r.ok && r.config.edge).toEqual({ command: ["uwsm-app", "--", "/usr/bin/microsoft-edge-stable"], profiles: { CSC: "Profile 3", "W&C": "Default" }, fallbackCommand: ["omarchy-launch-browser"] });
  });
  it("names bad values: a shell string, a flag as a profile, profiles with no command", () => {
    expect(fields(`${valid}\n[edge]\ncommand = "microsoft-edge-stable --x"\n`)).toEqual(["edge.command"]);
    expect(fields(`${valid}\n[edge]\ncommand = ["edge"]\n[edge.profiles]\nCSC = "--user-data-dir=/tmp"\n`)).toEqual(["edge.profiles.CSC"]);
    expect(fields(`${valid}\n[edge.profiles]\nCSC = "Default"\n`)).toEqual(["edge.command"]);
    expect(fields(`${valid}\n[edge]\nbrowser = "x"\n`)).toEqual(["edge.browser"]);
  });
  it("the starter file mentions it, commented out", () => {
    const r = parseConfig(STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"'));
    expect(r.ok && r.config.edge.command).toEqual([]);
    expect(STARTER_TOML).toContain("# [edge]");
  });
});

describe("working hours (step 6b)", () => {
  const hoursToml = (extra = "") =>
    valid.replace(/\[day_shape\][^[]*/, `[hours]
time_zone = "America/New_York"
lunch = "12:00-13:00"
mon = ["09:00-17:00"]
tue = ["09:00-17:00"]
wed = ["09:00-17:00"]
thu = ["09:00-17:00"]
fri = []
sat = []
sun = []
${extra}
`);

  it("reads per-weekday spans, the lunch and a split-day override", () => {
    const r = parseConfig(hoursToml(`[[hours.override]]
date = "2026-11-05"
segments = ["09:00-16:00", "20:00-22:00"]
lunch = ""
`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.legacyDayShape).toBeUndefined();
    expect(r.config.week.hours.lunch).toEqual({ start: "12:00", end: "13:00" });
    expect(r.config.week.hours.weekdays.fri).toEqual([]);
    expect(r.config.week.hours.overrides).toEqual([{ date: "2026-11-05", segments: [{ start: "09:00", end: "16:00" }, { start: "20:00", end: "22:00" }], lunch: null }]);
  });

  it("refuses overlapping spans, bad spans, duplicate override dates and both sections at once", () => {
    const fields = (t: string) => {
      const r = parseConfig(t);
      return r.ok ? [] : r.errors.map((e) => e.field);
    };
    expect(fields(hoursToml().replace('mon = ["09:00-17:00"]', 'mon = ["09:00-13:00", "12:00-17:00"]'))).toContain("hours.mon");
    expect(fields(hoursToml().replace('tue = ["09:00-17:00"]', 'tue = ["9-5"]'))).toContain("hours.tue[0]");
    expect(fields(hoursToml(`[[hours.override]]
date = "2026-11-05"
[[hours.override]]
date = "2026-11-05"
`))).toContain("hours.override[1].date");
    expect(fields(`${hoursToml()}\n[day_shape]\nstart = "09:00"\nsplit = "12:30"\nend = "17:00"\ntime_zone = "America/New_York"\n`)).toContain("day_shape");
  });

  it("migrates the old day shape to the same hours, keeping comments and other sections", () => {
    const r = parseConfig(valid);
    expect(r.ok && r.legacyDayShape).toBe(true);
    if (!r.ok) return;
    const text = `# my note\n${valid}`;
    const next = migrateDayShapeText(text, r.config.week.hours)!;
    expect(next).toContain("# my note");
    expect(next).not.toContain("[day_shape]");
    expect(next).toContain('mon = ["09:00-17:00"]');
    expect(next).toContain("fri = []");
    const again = parseConfig(next);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.legacyDayShape).toBeUndefined();
    expect(again.config.week.hours).toEqual(r.config.week.hours);
    expect({ ...again.config, week: null }).toEqual({ ...r.config, week: null });
    expect(migrateDayShapeText(next, again.config.week.hours)).toBeNull();
  });

  it("starts new configs with [hours]", () => {
    const r = parseConfig(STARTER_TOML);
    expect(r.ok && r.legacyDayShape).toBeFalsy();
    expect(STARTER_TOML).not.toContain("[day_shape]");
  });
});

describe("loading a config with the old day shape", () => {
  it("rewrites it as [hours] once, with a backup of the old file", async () => {
    const { mkdtemp, readFile, readdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadConfigFile } = await import("./load.ts");
    const dir = await mkdtemp(join(tmpdir(), "coopilot-cfg-"));
    const path = join(dir, "config.toml");
    await writeFile(path, valid, { mode: 0o600 });
    const r = await loadConfigFile(path);
    expect(r.parsed.ok).toBe(true);
    const text = await readFile(path, "utf8");
    expect(text).toContain("[hours]");
    expect(text).not.toContain("[day_shape]");
    const backups = await readdir(join(dir, "backups"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(dir, "backups", backups[0]!), "utf8")).toBe(valid);
    await loadConfigFile(path);
    expect(await readdir(join(dir, "backups"))).toHaveLength(1);
  });
});
