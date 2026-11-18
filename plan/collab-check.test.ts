// CO-1: the check for one time (me and each chosen person), its words, and suggestions on the hour or half hour.
import { describe, expect, it } from "vitest";
import { checkTime, checkWords, parseSchedule, rankCandidates, suggestSlots, type CheckInput, type Teammate } from "./collab.ts";

const TZ = "America/Chicago";
const D = "2026-11-10"; // Tue
const at = (hm: string, d = D) => Temporal.ZonedDateTime.from(`${d}T${hm}[${TZ}]`).epochMilliseconds;
const dayStart = Temporal.ZonedDateTime.from(`${D}T00:00[${TZ}]`).toInstant().toString();
const dayEnd = Temporal.ZonedDateTime.from(`2026-11-11T00:00[${TZ}]`).toInstant().toString();
const QUARTERS = 96;
/** A free/busy view for my whole day: busy between two times (Chicago). */
const view = (busy: [string, string][] = []) => {
  let v = "";
  for (let i = 0; i < QUARTERS; i++) {
    const t = at("00:00") + i * 900_000;
    v += busy.some(([a, b]) => t >= at(a) && t < at(b)) ? "2" : "0";
  }
  return v;
};
type WH = { tz: string; start?: string; end?: string } | null;
const sched = (people: Record<string, { view?: string; hours?: WH; error?: boolean }>) =>
  parseSchedule({
    value: Object.entries(people).map(([id, p]) => ({
      scheduleId: id,
      ...(p.error ? { error: { message: "no access" } } : { availabilityView: p.view ?? view() }),
      scheduleItems: [{ status: "busy", subject: "SECRET-SUBJECT pay review", location: "SECRET-ROOM", start: { dateTime: `${D}T16:00:00-06:00`, timeZone: "UTC" }, end: { dateTime: `${D}T17:00:00-06:00`, timeZone: "UTC" } }],
      ...(p.hours === null ? {} : { workingHours: { daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"], startTime: `${p.hours?.start ?? "09:00"}:00.0000000`, endTime: `${p.hours?.end ?? "17:00"}:00.0000000`, timeZone: { name: p.hours?.tz ?? "Central Standard Time" } } }),
    })),
  }, dayStart, dayEnd, 15, TZ);

const ANA = { email: "ana@cooptimize.example", name: "Ana", away: false };
const BEN = { email: "ben@cooptimize.example", name: "Ben", away: false };
const base = (o: Partial<CheckInput> = {}): CheckInput => ({
  start: at("10:30"), end: at("11:00"), tz: TZ,
  me: { off: false, windows: [[at("08:00"), at("17:00")]], lunch: [at("12:00"), at("13:00")], busy: [] },
  people: [ANA, BEN],
  availability: sched({ [ANA.email]: {}, [BEN.email]: {} }),
  ...o,
});

describe("checking one time (CO-1)", () => {
  it("everyone free", () => {
    const c = checkTime(base());
    expect(c.me).toEqual({ state: "free" });
    expect(c.people.map((p) => p.state)).toEqual(["free", "free"]);
    expect(checkWords(c)).toMatchObject({ me: "You: free", summary: "Everyone is free", notFree: [] });
    expect(checkWords(c).people.map((p) => p.text)).toEqual(["Ana: Free", "Ben: Free"]);
  });

  it("one busy for part of it: the busy time, never a subject", () => {
    const c = checkTime(base({ availability: sched({ [ANA.email]: { view: view([["10:45", "11:30"]]) }, [BEN.email]: {} }) }));
    expect(c.people[0]).toEqual({ email: ANA.email, name: "Ana", state: "busy", busy: [{ start: `${D}T10:45:00-06:00`, end: `${D}T11:30:00-06:00` }] });
    const w = checkWords(c);
    expect(w.people[0]!.text).toBe("Ana: Busy 10:45–11:30");
    expect(w.summary).toBe("2 of 3 are free");
    expect(JSON.stringify(c)).not.toMatch(/SECRET/);
  });

  it("one outside their hours in another time zone: their hours, and the same hours in mine", () => {
    // Ben works 9:00 to 5:00 Pacific: 11:00 to 7:00 Chicago, so 10:30 Chicago is 8:30 for him.
    const c = checkTime(base({ availability: sched({ [ANA.email]: {}, [BEN.email]: { hours: { tz: "Pacific Standard Time" } } }) }));
    expect(c.people[1]).toMatchObject({ state: "outside", hours: { start: "09:00", end: "17:00", zone: "America/Los_Angeles", workday: true, mine: { start: `${D}T11:00:00-06:00`, end: `${D}T19:00:00-06:00` } } });
    expect(checkWords(c).people[1]!.text).toBe("Ben: Outside their working hours (9:00–5:00 Pacific Time, 11:00–7:00 your time)");
    // 11:00 to 11:30 Chicago is inside his day.
    expect(checkTime(base({ start: at("11:00"), end: at("11:30"), availability: sched({ [ANA.email]: {}, [BEN.email]: { hours: { tz: "Pacific Standard Time" } } }) })).people[1]!.state).toBe("free");
  });

  it("one away: only away, nothing else read", () => {
    const c = checkTime(base({ people: [ANA, { ...BEN, away: true }], availability: sched({ [ANA.email]: {} }) }));
    expect(c.people[1]).toEqual({ email: BEN.email, name: "Ben", state: "away" });
    expect(checkWords(c).people[1]!.text).toBe("Ben: Away that day");
  });

  it("one whose calendar can't be read", () => {
    const c = checkTime(base({ availability: sched({ [ANA.email]: {}, [BEN.email]: { error: true } }) }));
    expect(c.people[1]!.state).toBe("unknown");
    expect(checkWords(c).people[1]!.text).toBe("Ben: Couldn't read their calendar");
    // Nobody answered at all: the same.
    expect(checkTime(base({ availability: [] })).people.map((p) => p.state)).toEqual(["unknown", "unknown"]);
  });

  it("my own meeting in the way, by its own name and time", () => {
    const c = checkTime(base({ me: { ...base().me, busy: [{ title: "Design review", start: at("10:00"), end: at("10:45") }, { title: "Elsewhere", start: at("14:00"), end: at("15:00") }] } }));
    expect(c.me).toEqual({ state: "busy", things: [{ title: "Design review", start: `${D}T10:00:00-06:00`, end: `${D}T10:45:00-06:00` }] });
    expect(checkWords(c)).toMatchObject({ me: "You: Design review 10:00–10:45", summary: "2 of 3 are free", notFree: ["You: Design review 10:00–10:45"] });
  });

  it("outside my hours", () => {
    const c = checkTime(base({ start: at("16:30"), end: at("17:30") }));
    expect(c.me).toMatchObject({ state: "outside" });
    expect(checkWords(c).me).toBe("You: outside your working hours (8:00–5:00)");
  });

  it("across lunch: lunch is in the way, by name", () => {
    const c = checkTime(base({ start: at("11:30"), end: at("12:30") }));
    expect(c.me).toEqual({ state: "busy", things: [{ title: "Lunch", start: `${D}T12:00:00-06:00`, end: `${D}T13:00:00-06:00` }] });
    expect(checkWords(c).me).toBe("You: Lunch 12:00–1:00");
  });

  it("a day off", () => {
    expect(checkWords(checkTime(base({ me: { ...base().me, off: true } }))).me).toBe("You: a day off");
    expect(checkTime(base({ me: { ...base().me, windows: [] } })).me).toEqual({ state: "off" });
  });

  it("a teammate whose day it isn't, and one who shares no hours (9:00 to 5:00 in my zone assumed)", () => {
    const sat = "2026-11-14";
    const c = checkTime(base({ start: at("10:30", sat), end: at("11:00", sat), people: [ANA], availability: parseSchedule({ value: [{ scheduleId: ANA.email, availabilityView: "0".repeat(QUARTERS), workingHours: { daysOfWeek: ["monday"], startTime: "09:00:00", endTime: "17:00:00", timeZone: { name: "Central Standard Time" } } }] }, Temporal.ZonedDateTime.from(`${sat}T00:00[${TZ}]`).toInstant().toString(), Temporal.ZonedDateTime.from(`2026-11-15T00:00[${TZ}]`).toInstant().toString(), 15, TZ) }));
    expect(checkWords(c).people[0]!.text).toBe("Ana: Outside their working hours (not a working day for them)");
    const u = checkTime(base({ people: [ANA], availability: sched({ [ANA.email]: { hours: null } }) }));
    expect(checkWords(u).people[0]!.text).toBe("Ana: Free (hours not shared, 9:00–5:00 assumed)");
  });

  it("returns only the fields it names: busy times and working hours, nothing else of a teammate's calendar", () => {
    const c = checkTime(base({ availability: sched({ [ANA.email]: { view: view([["10:00", "11:00"]]) }, [BEN.email]: { hours: { tz: "Pacific Standard Time" } } }) }));
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(c)).toEqual(["end", "free", "me", "of", "people", "start"]);
    expect(keys(c.people[0]!)).toEqual(["busy", "email", "name", "state"]);
    expect(keys((c.people[0] as { busy: object[] }).busy[0]!)).toEqual(["end", "start"]);
    expect(keys(c.people[1]!)).toEqual(["email", "hours", "name", "state"]);
    expect(keys((c.people[1] as { hours: object }).hours)).toEqual(["end", "mine", "start", "workday", "zone"]);
  });
});

describe("suggestions on the hour or half hour (CO-1)", () => {
  const team: Teammate[] = [{ id: "me", name: "Avery", email: "avery@cooptimize.example" }, { id: "u-ana", name: "Ana", email: ANA.email }];
  const cands = rankCandidates({ team, meId: "me", meEmail: "avery@cooptimize.example", domains: ["cooptimize.example"], dates: [D], away: [], patterns: [], workers: new Set() });
  const run = (o: { now: string; window?: [string, string]; busy?: [string, string][]; minutes?: number }) =>
    suggestSlots({
      minutes: o.minutes ?? 60, myWindows: [{ date: D, start: at(o.window?.[0] ?? "08:00"), end: at(o.window?.[1] ?? "17:00") }], myBusy: (o.busy ?? []).map(([a, b]) => [at(a), at(b)]), myBoxes: [],
      candidates: cands, availability: sched({ [ANA.email]: { hours: { tz: "Central Standard Time", start: "08:00", end: "17:00" } } }), chosen: [ANA.email], now: at(o.now), tz: TZ, max: 10, perDay: 10,
    });
  const mins = (s: { start: string }) => Number(s.start.slice(14, 16));

  it("start on :00 or :30 when one fits, never before now, and never overlap", () => {
    const s = run({ now: "10:06" });
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => mins(x) % 30 === 0)).toBe(true);
    expect(s.every((x) => x.start >= `${D}T10:06`)).toBe(true);
    expect(s.map((x) => x.start).sort()[0]).toBe(`${D}T10:30:00-06:00`);
    const ms = (x: string) => Temporal.Instant.from(x).epochMilliseconds;
    for (const a of s) for (const b of s) if (a !== b) expect(ms(a.start) < ms(b.end) && ms(a.end) > ms(b.start)).toBe(false);
  });

  it("on :15 or :45 only when no hour or half hour fits", () => {
    // Free only 10:15 to 10:45 (me busy around it): a 30 minute session fits only at 10:15.
    const s = run({ now: "08:00", minutes: 30, busy: [["08:00", "10:15"], ["10:45", "17:00"]] });
    expect(s.map((x) => x.start)).toEqual([`${D}T10:15:00-06:00`]);
  });
});
