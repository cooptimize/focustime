import { describe, expect, it } from "vitest";
import { parseConfig, setSystemUserIdInText } from "./schema.ts";
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
    expect(r.config.week.dayShape).toEqual({ start: "09:00", split: "12:30", end: "17:00", timeZone: "America/New_York" });
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
    expect(r.ok && r.config.plan).toEqual({ pickablePortfolioTypes: [] });
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
