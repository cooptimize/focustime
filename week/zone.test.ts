// A1 time zone groundwork: one accessor for the person's zone, a neutral default from the host clock, no hard-coded
// zones in product code, and the week's times right in each US zone and across a daylight-saving change.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import { buildWeek } from "./build.ts";
import { localToday, todayTarget } from "./dates.ts";
import { noStanding } from "./test-helpers.ts";
import type { WeekConfig } from "./types.ts";
import { knownZone, NEUTRAL_ZONE, userZone } from "./zone.ts";

const ROOT = resolve(import.meta.dirname, "..");
const valid = (zone: string) => starterToml(zone).replace('my_email = ""', 'my_email = "me@example.com"');
const withoutZone = (text: string) => text.replace(/^time_zone = .*\n/m, "");

describe("userZone", () => {
  it("reads the zone from settings, a payload with hours, or a week", () => {
    const hours = { ...noStanding.hours, timeZone: "America/Denver" };
    expect(userZone({ week: { ...noStanding, hours } })).toBe("America/Denver");
    expect(userZone({ hours })).toBe("America/Denver");
    expect(userZone({ timeZone: "America/Chicago" })).toBe("America/Chicago");
  });

  it("is the neutral zone when nothing is known", () => {
    expect(userZone(null)).toBe(NEUTRAL_ZONE);
    expect(userZone(undefined)).toBe(NEUTRAL_ZONE);
    expect(userZone({ timeZone: "" })).toBe(NEUTRAL_ZONE);
    expect(knownZone(NEUTRAL_ZONE)).toBe(true);
    expect(knownZone("Mars/Olympus")).toBe(false);
  });
});

describe("the person's zone setting", () => {
  it("is optional: left out, the host clock's zone applies", () => {
    const r = parseConfig(withoutZone(valid("America/Chicago")), { defaultZone: "America/Los_Angeles" });
    expect(r.ok && userZone(r.config)).toBe("America/Los_Angeles");
  });

  it("left out with no host zone given, the neutral zone applies", () => {
    const r = parseConfig(withoutZone(valid("America/Chicago")));
    expect(r.ok && userZone(r.config)).toBe(NEUTRAL_ZONE);
  });

  it("set, it wins over the host clock's zone", () => {
    const r = parseConfig(valid("America/Denver"), { defaultZone: "America/Los_Angeles" });
    expect(r.ok && userZone(r.config)).toBe("America/Denver");
  });

  it("an unknown name is refused on its own field", () => {
    const r = parseConfig(valid("Mars/Olympus"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.map((e) => e.field)).toContain("hours.time_zone");
  });

  it("a new person's starter file names the zone it was made with", () => {
    expect(starterToml("America/Chicago")).toContain('time_zone = "America/Chicago"');
    expect(starterToml("America/Chicago")).not.toContain("@TIME_ZONE@");
  });
});

/** The four US zones the team works in, with their standard and daylight offsets. */
const ZONES = [
  { zone: "America/New_York", std: "-05:00", dst: "-04:00" },
  { zone: "America/Chicago", std: "-06:00", dst: "-05:00" },
  { zone: "America/Denver", std: "-07:00", dst: "-06:00" },
  { zone: "America/Los_Angeles", std: "-08:00", dst: "-07:00" },
] as const;

const inZone = (zone: string): WeekConfig => {
  const hours = { ...noStanding.hours, timeZone: zone, weekdays: { ...noStanding.hours.weekdays, fri: [{ start: "09:00", end: "17:00" }], sun: [{ start: "09:00", end: "11:00" }] } };
  return { ...noStanding, hours };
};

describe.each(ZONES)("the week in $zone", ({ zone, std, dst }) => {
  it("working hours are 9:00 local in standard time", () => {
    const w = buildWeek({ weekStart: "2026-11-02", patterns: [], events: [], config: inZone(zone) });
    expect(w.days[0]!.am.start).toBe(`2026-11-02T09:00:00${std}`);
    expect(w.days[4]!.pm.end).toBe(`2026-11-06T17:00:00${std}`);
  });

  it("working hours are 9:00 local in daylight time", () => {
    const w = buildWeek({ weekStart: "2026-07-13", patterns: [], events: [], config: inZone(zone) });
    expect(w.days[0]!.am.start).toBe(`2026-07-13T09:00:00${dst}`);
  });

  it("the daylight-saving week: Monday in daylight time, Sunday Nov 1 after the change in standard time", () => {
    const w = buildWeek({ weekStart: "2026-10-26", patterns: [], events: [], config: inZone(zone) });
    expect(w.days[0]!.am.start).toBe(`2026-10-26T09:00:00${dst}`);
    const sun = w.days.find((d) => d.date === "2026-11-01");
    expect(sun?.am.start).toBe(`2026-11-01T09:00:00${std}`);
  });

  it("today is the local date, even when it is already tomorrow in UTC", () => {
    // 11:30 PM on Monday Nov 2 in each zone is Tuesday in UTC.
    const late = Temporal.PlainDateTime.from("2026-11-02T23:30").toZonedDateTime(zone).toInstant().toString();
    expect(localToday(late, zone)).toBe("2026-11-02");
    expect(todayTarget(late, inZone(zone).hours)).toMatchObject({ weekStart: "2026-11-02", dayIndex: 0, half: "PM" });
  });
});

// ---- No hard-coded zones and no reads around the accessor ----

/** A Region/City zone name in a string: "America/Chicago", 'Europe/London', `[Asia/Tokyo]`. */
const ZONE_NAME = /["'`[](?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z_+-]+/;
/** A read of the setting that skips userZone. */
const DIRECT_READ = /\b(?:hours|week)\??\.timeZone\b/;
/** Files allowed to name zones: the Windows-to-IANA map, demo and style guide sample data, and test support. */
const MAY_NAME_ZONES = (f: string) =>
  f === "plan/timezones.ts" || f === "sources/demo/data.ts" || f === "ui/StyleGuide.tsx" || f.startsWith("fixtures/") || f.startsWith("test/") || f === "week/test-helpers.ts";
const SOURCE = /\.(ts|tsx|mjs|js)$/;
const TEST = /\.test\.tsx?$|(^|\/)test-[\w-]+\.ts$|^e2e\//;

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter((f) => f && SOURCE.test(f) && !TEST.test(f) && !f.startsWith("node_modules/") && !f.startsWith("docs/") && !f.endsWith(".config.ts"));
}

function scan(re: RegExp, allowed: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const f of sourceFiles()) {
    if (allowed(f)) continue;
    let text: string;
    try {
      text = readFileSync(resolve(ROOT, f), "utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, i) => {
      if (re.test(line)) out.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return out;
}

describe("zones in product code (A1)", () => {
  it("the patterns find what they are for", () => {
    for (const s of ['const z = "America/Chicago";', "x ?? 'Europe/London'", "`2026-11-02T08:00-05:00[America/New_York]`"]) expect(ZONE_NAME.test(s), s).toBe(true);
    for (const s of ['"UTC"', "Region/City", "userZone(cfg)"]) expect(ZONE_NAME.test(s), s).toBe(false);
    for (const s of ["cfg.week.hours.timeZone", "data.hours.timeZone", "week.timeZone", "cfg?.week.hours?.timeZone"]) expect(DIRECT_READ.test(s), s).toBe(true);
    for (const s of ["userZone(cfg)", "deps.timeZone", "model.timeZone = z"]) expect(DIRECT_READ.test(s), s).toBe(false);
  });

  it("no product file names a time zone; the person's setting or the host clock decides", () => {
    expect(scan(ZONE_NAME, MAY_NAME_ZONES)).toEqual([]);
  });

  it("every read of the person's zone goes through userZone", () => {
    expect(scan(DIRECT_READ, (f) => f === "week/zone.ts")).toEqual([]);
  });
});
