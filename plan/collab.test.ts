import { describe, expect, it } from "vitest";
import { defaultRange, domainAllowed, freeFor, helpFollowUpText, isExcluded, inviteFields, parseSchedule, rankCandidates, suggestSlots, withinWorkingHours, type Availability, type Teammate } from "./collab.ts";
import { zoneOf } from "./timezones.ts";

const TZ = "America/Chicago";
const ME = { id: "00000000-0000-4000-8000-000000000001", email: "tanner@cooptimize.org" };
const team: Teammate[] = [
  { id: ME.id, name: "Tanner", email: ME.email },
  { id: "u-ana", name: "Ana", email: "ana@cooptimize.org" },
  { id: "u-ben", name: "Ben", email: "Ben@Cooptimize.org" },
  { id: "u-cy", name: "Cy", email: "cy@cooptimize.org" },
  { id: "u-ext", name: "Client Person", email: "pat@wc.example" },
];
const dates = ["2026-11-09", "2026-11-10", "2026-11-11"]; // Mon to Wed
const DOM = ["cooptimize.org"];

describe("candidate tiers (Cooptimize staff only)", () => {
  const rank = (away: { userId: string; date: string }[] = []) =>
    rankCandidates({
      team, meId: ME.id, meEmail: ME.email, domains: DOM, dates, away,
      patterns: [{ userId: "u-ana", startDate: "2026-01-01", endDate: null, days: { Tue: "AM" } }],
      workers: new Set(["u-ben"]),
    });
  it("1 on the client that day, 2 on the client other days, 3 anyone else; me and other domains left out", () => {
    const c = rank();
    expect(c.map((x) => [x.name, x.tier])).toEqual([["Ana", 1], ["Ben", 2], ["Cy", 3]]);
    expect(c[0]!.tierByDate).toEqual({ "2026-11-09": 2, "2026-11-10": 1, "2026-11-11": 2 });
    expect(c[0]!.onClient).toEqual(["2026-11-10"]);
    expect(c[1]!.email).toBe("ben@cooptimize.org");
    expect(c.some((x) => x.email.endsWith("wc.example") || x.email === ME.email)).toBe(false);
  });
  it("PTO shows only as away dates, and an away day doesn't count toward the tier", () => {
    const c = rank([{ userId: "u-ana", date: "2026-11-10" }]);
    const ana = c.find((x) => x.name === "Ana")!;
    expect(ana.away).toEqual(["2026-11-10"]);
    expect(ana.tier).toBe(2);
    expect(Object.keys(ana)).not.toContain("title");
  });
  it("limits attendee domains exactly", () => {
    expect(domainAllowed("ana@cooptimize.org", DOM)).toBe(true);
    expect(domainAllowed("ana@COOPTIMIZE.org", DOM)).toBe(true);
    for (const e of ["ana@evil-cooptimize.org", "ana@cooptimize.org.evil.com", "Ana <ana@cooptimize.org>", "a@b@cooptimize.org", "ana@sub.cooptimize.org"]) expect(domainAllowed(e, DOM)).toBe(false);
  });
});

/** getSchedule as Graph returns it, with details Coopilot must never keep. */
function scheduleBody(view: Record<string, string>, wh: Record<string, { tz: unknown; start?: string; end?: string }>) {
  return {
    value: Object.entries(view).map(([id, v]) => ({
      scheduleId: id,
      availabilityView: v,
      scheduleItems: [{ isPrivate: false, status: "busy", subject: "SECRET-SUBJECT board review", location: "SECRET-ROOM 4", start: { dateTime: "2026-11-09T15:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-09T16:00:00.0000000", timeZone: "UTC" } }],
      workingHours: wh[id] ? { daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"], startTime: `${wh[id]!.start ?? "08:00"}:00.0000000`, endTime: `${wh[id]!.end ?? "17:00"}:00.0000000`, timeZone: wh[id]!.tz } : undefined,
    })),
  };
}

describe("free/busy from getSchedule", () => {
  const start = "2026-11-09T14:00:00Z", end = "2026-11-09T18:00:00Z"; // 8:00 to 12:00 Central
  it("keeps only free/busy and working hours, never subjects or locations", () => {
    const av = parseSchedule(scheduleBody({ "ana@cooptimize.org": "0022000000000000" }, { "ana@cooptimize.org": { tz: { name: "Eastern Standard Time" } } }), start, end, 15);
    expect(JSON.stringify(av)).not.toMatch(/SECRET/);
    expect(av[0]!.busy).toEqual([[Date.parse("2026-11-09T14:30:00Z"), Date.parse("2026-11-09T15:00:00Z")]]);
    expect(av[0]!.workingHours).toEqual({ days: ["monday", "tuesday", "wednesday", "thursday", "friday"], start: "08:00", end: "17:00", zone: "America/New_York" });
  });
  it("tentative and away count as busy; working elsewhere as free; errors and missing hours make a person unknown", () => {
    const av = parseSchedule({ value: [{ scheduleId: "a@x.org", availabilityView: "01234", workingHours: { daysOfWeek: ["monday"], startTime: "00:00:00", endTime: "23:59:00", timeZone: { name: "UTC" } } }, { scheduleId: "b@x.org", error: { message: "not found", responseCode: "x" } }, { scheduleId: "c@x.org", availabilityView: "0000" }] }, start, end, 15);
    const t = (m: number) => Date.parse(start) + m * 60_000;
    expect(av[0]!.busy).toEqual([[t(15), t(60)]]);
    expect(av[1]!.problem).toBe("no free/busy shared");
    // Step 13.5: no working hours shared means 9:00 to 5:00 in my zone, labelled "hours unknown".
    expect(av[2]!.problem).toBeNull();
    expect(av[2]!.hoursUnknown).toBe(true);
    expect(av[2]!.workingHours).toEqual({ days: ["monday", "tuesday", "wednesday", "thursday", "friday"], start: "09:00", end: "17:00", zone: "UTC" });
    expect(av[0]!.hoursUnknown).toBe(false);
  });
  it("reads working hours in each person's own zone (Windows names, IANA names, custom bias)", () => {
    expect(zoneOf({ name: "Pacific Standard Time" })).toBe("America/Los_Angeles");
    expect(zoneOf({ name: "Europe/London" })).toBe("Europe/London");
    expect(zoneOf({ "@odata.type": "#microsoft.graph.customTimeZone", name: "Customized Time Zone", bias: 360 })).toBe("-06:00");
    expect(zoneOf({ name: "Nowhere Standard Time" })).toBeNull();
    const east = { days: ["monday"], start: "09:00", end: "17:00", zone: "America/New_York" };
    // 8:00 Central is 9:00 Eastern: inside. 3:30 to 4:30 PM Central is 4:30 to 5:30 Eastern: outside.
    expect(withinWorkingHours(Date.parse("2026-11-09T14:00:00Z"), Date.parse("2026-11-09T15:00:00Z"), east)).toBe(true);
    expect(withinWorkingHours(Date.parse("2026-11-09T21:30:00Z"), Date.parse("2026-11-09T22:30:00Z"), east)).toBe(false);
    expect(withinWorkingHours(Date.parse("2026-11-09T13:30:00Z"), Date.parse("2026-11-09T14:30:00Z"), east)).toBe(false);
    // Monday only: Tuesday is out.
    expect(withinWorkingHours(Date.parse("2026-11-10T15:00:00Z"), Date.parse("2026-11-10T16:00:00Z"), east)).toBe(false);
  });
});

describe("slot suggestions", () => {
  const day = (d: string, a: string, b: string) => ({ date: d, start: Temporal.ZonedDateTime.from(`${d}T${a}[${TZ}]`).epochMilliseconds, end: Temporal.ZonedDateTime.from(`${d}T${b}[${TZ}]`).epochMilliseconds });
  const myWindows = [day("2026-11-09", "08:00", "12:00"), day("2026-11-10", "08:00", "12:00"), day("2026-11-11", "08:00", "12:00")];
  const rangeStart = "2026-11-09T14:00:00Z", rangeEnd = "2026-11-11T18:00:00Z";
  const quarters = (Date.parse(rangeEnd) - Date.parse(rangeStart)) / 900_000;
  const freeAll = "0".repeat(quarters);
  const cands = rankCandidates({ team, meId: ME.id, meEmail: ME.email, domains: DOM, dates, away: [{ userId: "u-cy", date: "2026-11-09" }], patterns: [{ userId: "u-ana", startDate: "2026-01-01", endDate: null, days: { Wed: "AM" } }], workers: new Set(["u-ben"]) });
  const av = (views: Record<string, string>, tz: Record<string, string> = {}): Availability[] => parseSchedule(scheduleBody(views, Object.fromEntries(Object.keys(views).map((k) => [k, { tz: { name: tz[k] ?? "Central Standard Time" } }]))), rangeStart, rangeEnd, 15);
  const base = { minutes: 30, myWindows, myBusy: [] as [number, number][], myBoxes: [] as [number, number][], candidates: cands, now: Date.parse("2026-11-09T13:00:00Z"), tz: TZ };

  it("auto: ranks the top tier first (Ana on the client Wednesday), then Ben (tier 2), at most two a day, up to 5", () => {
    const s = suggestSlots({ ...base, chosen: null, availability: av({ "ana@cooptimize.org": freeAll, "ben@cooptimize.org": freeAll, "cy@cooptimize.org": freeAll }) });
    expect(s.length).toBe(5);
    expect(s.slice(0, 2).map((x) => [x.date, x.people[0]!.name, x.tier])).toEqual([["2026-11-11", "Ana", 1], ["2026-11-11", "Ana", 1]]);
    expect(s.slice(2).every((x) => x.tier === 2)).toBe(true);
    const perDay = s.reduce<Record<string, number>>((m, x) => ((m[x.date] = (m[x.date] ?? 0) + 1), m), {});
    expect(Math.max(...Object.values(perDay))).toBeLessThanOrEqual(2);
    // No two overlap.
    const ms = (x: string) => Temporal.Instant.from(x).epochMilliseconds;
    for (const a of s) for (const b of s) if (a !== b) expect(ms(a.start) < ms(b.end) && ms(a.end) > ms(b.start)).toBe(false);
  });

  it("chosen people must all be free in their own working hours, not away, and I must be free too", () => {
    // Cy is away Monday; Ana works 9 to 5 Eastern (8 to 4 Central) so 8:00 Central is fine; I'm busy 8:00 to 9:00 Tuesday.
    const myBusy: [number, number][] = [[day("2026-11-10", "08:00", "09:00").start, day("2026-11-10", "08:00", "09:00").end]];
    const s = suggestSlots({ ...base, myBusy, chosen: ["ana@cooptimize.org", "cy@cooptimize.org"], availability: av({ "ana@cooptimize.org": freeAll, "cy@cooptimize.org": freeAll }, { "ana@cooptimize.org": "Eastern Standard Time" }), max: 20, perDay: 20 });
    expect(s.some((x) => x.date === "2026-11-09")).toBe(false);
    expect(s.some((x) => x.date === "2026-11-10" && x.start < "2026-11-10T09:00")).toBe(false);
    expect(s.every((x) => x.people.length === 2)).toBe(true);
  });

  it("a person in a zone whose day ends earlier only gets slots inside it", () => {
    // Ana works 8 to 9 London time only (2:00 to 3:00 AM Central): no overlap with my 8 to 12.
    const views = { "ana@cooptimize.org": freeAll };
    const body = scheduleBody(views, { "ana@cooptimize.org": { tz: { name: "GMT Standard Time" }, start: "08:00", end: "09:00" } });
    expect(suggestSlots({ ...base, chosen: ["ana@cooptimize.org"], availability: parseSchedule(body, rangeStart, rangeEnd, 15) })).toEqual([]);
  });

  it("avoids my timeboxes where possible: overlapping slots rank after clear ones", () => {
    const box = day("2026-11-11", "08:00", "10:00");
    const s = suggestSlots({ ...base, myBoxes: [[box.start, box.end]], chosen: ["ana@cooptimize.org"], availability: av({ "ana@cooptimize.org": freeAll }) });
    expect(s[0]!.date).toBe("2026-11-11");
    expect(s[0]!.overTimebox).toBe(0);
    expect(s[0]!.start >= "2026-11-11T10:00").toBe(true);
  });

  it("step 13.5: slots inside my focus blocks for that client come first, then other free time", () => {
    const block = day("2026-11-10", "10:00", "12:00");
    const s = suggestSlots({ ...base, focus: [[block.start, block.end]], chosen: ["ana@cooptimize.org"], availability: av({ "ana@cooptimize.org": freeAll }) });
    expect(s[0]!.inFocus).toBe(true);
    expect(s[0]!.date).toBe("2026-11-10");
    expect(s[0]!.start >= "2026-11-10T10:00").toBe(true);
    expect(s.filter((x) => x.inFocus).length).toBeGreaterThan(0);
    expect(s.findIndex((x) => !x.inFocus)).toBeGreaterThan(s.findLastIndex((x) => x.inFocus));
  });

  it("step 13.5: a teammate with no working hours shared gets 9:00 to 5:00 in my zone, marked hours unknown", () => {
    const body = { value: [{ scheduleId: "ana@cooptimize.org", availabilityView: freeAll }] };
    const s = suggestSlots({ ...base, chosen: ["ana@cooptimize.org"], availability: parseSchedule(body, rangeStart, rangeEnd, 15, TZ) });
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => x.start.slice(11, 16) >= "09:00")).toBe(true);
    expect(s[0]!.people[0]!.hoursUnknown).toBe(true);
  });

  it("busy in Graph is busy", () => {
    const busyAll = "2".repeat(quarters);
    expect(suggestSlots({ ...base, chosen: null, availability: av({ "ana@cooptimize.org": busyAll, "ben@cooptimize.org": busyAll, "cy@cooptimize.org": busyAll }) })).toEqual([]);
    expect(freeFor(undefined, 0, 1)).toBe(false);
  });
});

describe("the invite and its range", () => {
  it("names the client and item, carries the DevOps link and note, lowercases attendee emails", () => {
    const f = inviteFields({ clientName: "W&C", itemTitle: "#4512 Import mapping", url: "https://dev.azure.com/wc/p/_workitems/edit/4512", note: "  stuck on the lookup  ", start: "2026-11-10T09:00:00-06:00", end: "2026-11-10T09:30:00-06:00", people: [{ name: "Ana", email: "Ana@cooptimize.org" }], teams: true });
    expect(f).toMatchObject({ subject: "W&C: help on #4512 Import mapping", start: "2026-11-10T15:00:00Z", attendees: [{ name: "Ana", email: "ana@cooptimize.org" }], teams: true, showAs: "busy" });
    expect(f.body).toBe("https://dev.azure.com/wc/p/_workitems/edit/4512\n\nstuck on the lookup\n\nHelp session planned in Coopilot.");
    expect(helpFollowUpText(["Ana", "Ben", "Cy"], "#4512 Import mapping")).toBe("Help session with Ana, Ben and Cy on #4512 Import mapping");
  });
  it("defaults to the pinned day, else the next 3 workdays", () => {
    const wd = (d: string) => Temporal.PlainDate.from(d).dayOfWeek <= 4;
    expect(defaultRange("2026-11-05", "2026-11-10", wd, 3)).toEqual({ from: "2026-11-10", to: "2026-11-10" });
    expect(defaultRange("2026-11-05", "2026-11-02", wd, 3)).toEqual({ from: "2026-11-05", to: "2026-11-10" });
  });
});

describe("people to exclude (step 13.5)", () => {
  it("matches a name or an address, any case, and is never a candidate", () => {
    expect(isExcluded({ name: "Kat 🤖", email: "kat@cooptimize.org" }, ["Kat 🤖"])).toBe(true);
    expect(isExcluded({ name: "Kat", email: "KAT-BOT@cooptimize.org" }, ["kat-bot@cooptimize.org"])).toBe(true);
    expect(isExcluded({ name: "Ana", email: "ana@cooptimize.org" }, ["Kat 🤖"])).toBe(false);
    const bot = { id: "u-kat", name: "Kat 🤖", email: "kat@cooptimize.org" };
    const r = rankCandidates({ team: [...team, bot], meId: ME.id, meEmail: ME.email, domains: DOM, dates, away: [], patterns: [], workers: new Set(), exclude: ["Kat 🤖"] });
    expect(r.some((c) => c.name === "Kat 🤖")).toBe(false);
  });
});
