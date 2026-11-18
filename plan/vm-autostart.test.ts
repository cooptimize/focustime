// VM-2: the auto-start's production-only gate and its rule (pure). Fictional data only.
import { describe, expect, it } from "vitest";
import type { TimeModel } from "../week/hours.ts";
import { autoStartDue, autoStartEnvAllowed, autoStartStateOf, DEFAULT_AUTOSTART, EMPTY_AUTOSTART_STATE, nextAutoStart, plannedAt, shouldPause, skipText, stopEndsDays, stopEndsToday, withoutSkip, withSkip, type AutoStartSettings, type AutoStartState, type DueFacts } from "./vm-autostart.ts";

const LA = "America/Los_Angeles";
const BERLIN = "Europe/Berlin";
const day = (s: string) => [{ start: s, end: "17:00" }];
/** Mon to Thu 8:00 to 17:00, Friday off (a four-day week). */
const hours = (zone: string, start = "08:00"): TimeModel => ({ timeZone: zone, weekdays: { mon: day(start), tue: day(start), wed: day(start), thu: day(start), fri: [], sat: [], sun: [] }, lunch: null, overrides: [] });
const on: AutoStartSettings = { on: true, minutes: 5, offDays: [] };
const at = (local: string, zone: string) => Temporal.PlainDateTime.from(local).toZonedDateTime(zone).toInstant();
const state = (o: Partial<AutoStartState> = {}): AutoStartState => ({ ...EMPTY_AUTOSTART_STATE, onSince: "2026-11-09", lastUseOn: "2026-11-10", ...o });
const facts = (o: Partial<DueFacts> & { now: Temporal.Instant }): DueFacts => ({ zone: LA, hours: hours(LA), settings: on, state: state(), pto: false, holiday: false, chip: "deallocated", ...o });

describe("the production-only gate", () => {
  it('only exactly "prod" lets it run', () => {
    expect(autoStartEnvAllowed("prod")).toBe(true);
    for (const env of ["dev", "local", "demo", "", undefined, null, "Prod", "PROD", "production", "prod ", " prod", "prod\n", "pro", "prod,dev", 1, true, {}])
      expect(autoStartEnvAllowed(env), String(env)).toBe(false);
  });
});

describe("when it starts (America/Los_Angeles)", () => {
  // Wed Nov 11, 2026: day starts 8:00, 5 minutes before is 7:55.
  it("at the start of my day less my minutes, in my zone", () => {
    expect(plannedAt(hours(LA), "2026-11-11", LA, 5)?.toString()).toBe(at("2026-11-11T07:55", LA).toString());
    expect(autoStartDue(facts({ now: at("2026-11-11T07:54", LA) }))).toEqual({ due: false, why: "early" });
    expect(autoStartDue(facts({ now: at("2026-11-11T07:55", LA) }))).toMatchObject({ due: true, date: "2026-11-11", late: false });
    for (const m of [0, 10, 15, 30] as const) {
      const s = { ...on, minutes: m };
      expect(autoStartDue(facts({ settings: s, now: at("2026-11-11T08:00", LA).subtract({ minutes: m + 1 }) }))).toEqual({ due: false, why: "early" });
      expect(autoStartDue(facts({ settings: s, now: at("2026-11-11T08:00", LA).subtract({ minutes: m }) }))).toMatchObject({ due: true });
    }
  });

  it("off by default, and only when opted in", () => {
    expect(DEFAULT_AUTOSTART).toEqual({ on: false, minutes: 0, offDays: [] });
    expect(autoStartDue(facts({ settings: DEFAULT_AUTOSTART, now: at("2026-11-11T08:00", LA) }))).toEqual({ due: false, why: "off" });
  });

  it("only on the days I chose that have working hours", () => {
    expect(autoStartDue(facts({ settings: { ...on, offDays: ["wed"] }, now: at("2026-11-11T07:56", LA) }))).toEqual({ due: false, why: "not_chosen" });
    expect(autoStartDue(facts({ settings: { ...on, offDays: ["thu"] }, now: at("2026-11-11T07:56", LA) }))).toMatchObject({ due: true });
    // Friday has no working hours; a Saturday neither.
    expect(autoStartDue(facts({ now: at("2026-11-13T07:56", LA) }))).toEqual({ due: false, why: "no_hours" });
    expect(autoStartDue(facts({ now: at("2026-11-14T07:56", LA) }))).toEqual({ due: false, why: "no_hours" });
    // A day override with no hours.
    const h = { ...hours(LA), overrides: [{ date: "2026-11-11", segments: [] }] };
    expect(autoStartDue(facts({ hours: h, now: at("2026-11-11T07:56", LA) }))).toEqual({ due: false, why: "no_hours" });
  });

  it("not on whole-day PTO, not on a holiday, not on a day I skipped", () => {
    const now = at("2026-11-11T07:56", LA);
    expect(autoStartDue(facts({ now, pto: true }))).toEqual({ due: false, why: "pto" });
    expect(autoStartDue(facts({ now, holiday: true }))).toEqual({ due: false, why: "holiday" });
    expect(autoStartDue(facts({ now, state: state({ skipped: ["2026-11-11"] }) }))).toEqual({ due: false, why: "skipped" });
    expect(autoStartDue(facts({ now, state: state({ skipped: ["2026-11-12"] }) }))).toMatchObject({ due: true });
  });

  it("only when the VM is stopped: never running, starting, stopping or unknown", () => {
    const now = at("2026-11-11T07:56", LA);
    for (const chip of ["running", "starting", "stopping", "unknown"] as const) expect(autoStartDue(facts({ now, chip })), chip).toEqual({ due: false, why: "not_stopped" });
    for (const chip of ["deallocated", "billing"] as const) expect(autoStartDue(facts({ now, chip })), chip).toMatchObject({ due: true });
  });

  it("at most one a day: once attempted (even a failure), never again that day", () => {
    expect(autoStartDue(facts({ now: at("2026-11-11T08:10", LA), state: state({ attemptedOn: "2026-11-11" }) }))).toEqual({ due: false, why: "attempted" });
    expect(autoStartDue(facts({ now: at("2026-11-12T07:56", LA), state: state({ attemptedOn: "2026-11-11", lastUseOn: "2026-11-11" }) }))).toMatchObject({ due: true, date: "2026-11-12" });
  });

  it("running late: still starts until my day has been under way 60 minutes, then leaves it off", () => {
    expect(autoStartDue(facts({ now: at("2026-11-11T08:30", LA) }))).toMatchObject({ due: true, late: true });
    expect(autoStartDue(facts({ now: at("2026-11-11T08:59", LA) }))).toMatchObject({ due: true, late: true });
    expect(autoStartDue(facts({ now: at("2026-11-11T09:00", LA) }))).toEqual({ due: false, why: "too_late" });
    expect(autoStartDue(facts({ now: at("2026-11-11T13:00", LA) }))).toEqual({ due: false, why: "too_late" });
  });
});

describe("it pauses itself after 3 of my working days without FocusTime", () => {
  const h = hours(LA);
  it("counts only days with working hours, strictly between my last use and today", () => {
    // Last used Mon Nov 9: Tue, Wed, Thu pass unused; Fri has no hours; Mon Nov 16 it's paused.
    expect(shouldPause({ today: "2026-11-12", lastUseOn: "2026-11-09", onSince: null, hours: h })).toBe(false);
    expect(shouldPause({ today: "2026-11-13", lastUseOn: "2026-11-09", onSince: null, hours: h })).toBe(true);
    // Last used Wed: Thu, (Fri off, weekend), Mon: 2 days by Tue; 3 by Wed.
    expect(shouldPause({ today: "2026-11-17", lastUseOn: "2026-11-11", onSince: null, hours: h })).toBe(false);
    expect(shouldPause({ today: "2026-11-18", lastUseOn: "2026-11-11", onSince: null, hours: h })).toBe(true);
  });
  it("counts from when it was turned on, not before", () => {
    expect(shouldPause({ today: "2026-11-18", lastUseOn: "2026-10-01", onSince: "2026-11-16", hours: h })).toBe(false);
    expect(shouldPause({ today: "2026-11-18", lastUseOn: null, onSince: null, hours: h })).toBe(false);
  });
  it("paused: no start; Resume (a fresh use) starts it again", () => {
    const now = at("2026-11-18T07:56", LA);
    // The tick decides when to pause (it knows the PTO since); the rule only honours a pause.
    expect(shouldPause({ today: "2026-11-18", lastUseOn: "2026-11-11", onSince: "2026-11-02", hours: hours(LA) })).toBe(true);
    expect(shouldPause({ today: "2026-11-18", lastUseOn: "2026-11-11", onSince: "2026-11-02", hours: hours(LA), off: new Set(["2026-11-12", "2026-11-16"]) })).toBe(false);
    expect(autoStartDue(facts({ now, state: state({ pausedOn: "2026-11-17", lastUseOn: "2026-11-18" }) }))).toEqual({ due: false, why: "paused" });
    expect(autoStartDue(facts({ now, state: state({ pausedOn: null, lastUseOn: "2026-11-18", onSince: "2026-11-02" }) }))).toMatchObject({ due: true });
  });
});

describe("time zones and daylight saving", () => {
  it("one zone ahead of UTC (Europe/Berlin): 7:55 Berlin time", () => {
    const facts1 = facts({ zone: BERLIN, hours: hours(BERLIN), now: at("2026-11-11T07:55", BERLIN) });
    expect(autoStartDue(facts1)).toMatchObject({ due: true, date: "2026-11-11" });
    expect(autoStartDue({ ...facts1, now: at("2026-11-11T07:54", BERLIN) })).toEqual({ due: false, why: "early" });
    // The same instant is the previous evening in Los Angeles: no start for an LA person.
    expect(autoStartDue({ ...facts1, zone: LA, hours: hours(LA) })).toEqual({ due: false, why: "too_late" });
  });

  it("someone who changes time zone: the day and time follow the zone they have now", () => {
    const now = at("2026-11-11T07:55", BERLIN);
    expect(autoStartDue(facts({ zone: BERLIN, hours: hours(BERLIN), now, state: state({ attemptedOn: "2026-11-10" }) }))).toMatchObject({ due: true, date: "2026-11-11" });
    // Moved to Los Angeles after starting in Berlin that day: already attempted for that local date there.
    expect(autoStartDue(facts({ now: at("2026-11-11T07:55", LA), state: state({ attemptedOn: "2026-11-11" }) }))).toEqual({ due: false, why: "attempted" });
  });

  it("spring forward and fall back in Los Angeles (Mar 8 and Nov 1, 2026, both Sundays: a working Sunday)", () => {
    const sunday = (zone: string): TimeModel => ({ ...hours(zone), weekdays: { ...hours(zone).weekdays, sun: day("08:00") } });
    // Mar 8: 8:00 PDT; 30 minutes before is 7:30 PDT.
    expect(plannedAt(sunday(LA), "2026-03-08", LA, 30)?.toString()).toBe("2026-03-08T14:30:00Z");
    expect(autoStartDue(facts({ hours: sunday(LA), settings: { ...on, minutes: 30 }, now: Temporal.Instant.from("2026-03-08T14:30:00Z"), state: state({ lastUseOn: "2026-03-06", onSince: "2026-03-01" }) }))).toMatchObject({ due: true, date: "2026-03-08" });
    // Nov 1: 8:00 PST; 30 minutes before is 7:30 PST.
    expect(plannedAt(sunday(LA), "2026-11-01", LA, 30)?.toString()).toBe("2026-11-01T15:30:00Z");
    expect(autoStartDue(facts({ hours: sunday(LA), settings: { ...on, minutes: 30 }, now: Temporal.Instant.from("2026-11-01T15:29:00Z"), state: state({ lastUseOn: "2026-10-30", onSince: "2026-10-01" }) }))).toEqual({ due: false, why: "early" });
    // A day starting inside the clock change: 2:30 doesn't exist on Mar 8; it is read as 3:30 PDT, less 30 minutes.
    const early: TimeModel = { ...sunday(LA), weekdays: { ...sunday(LA).weekdays, sun: day("02:30") } };
    expect(plannedAt(early, "2026-03-08", LA, 30)?.toString()).toBe("2026-03-08T10:00:00Z");
  });

  it("the Monday after each change in Berlin (Mar 29 and Oct 25, 2026) starts at 7:55 local", () => {
    expect(plannedAt(hours(BERLIN), "2026-03-30", BERLIN, 5)?.toString()).toBe("2026-03-30T05:55:00Z");
    expect(plannedAt(hours(BERLIN), "2026-10-26", BERLIN, 5)?.toString()).toBe("2026-10-26T06:55:00Z");
  });
});

describe('the "Next:" line', () => {
  const base = { env: "prod", zone: LA, hours: hours(LA), settings: on, state: state(), pto: () => false, holiday: () => false, on: false };
  it('says the next start: "Next: Thu, Nov 12 at 7:55 AM"', () => {
    expect(nextAutoStart({ ...base, now: at("2026-11-11T12:00", LA) })).toMatchObject({ kind: "next", date: "2026-11-12", text: "Next: Thu, Nov 12 at 7:55 AM", short: "Thu 7:55 AM" });
    expect(nextAutoStart({ ...base, now: at("2026-11-11T06:00", LA) })).toMatchObject({ kind: "next", date: "2026-11-11", text: "Next: Wed, Nov 11 at 7:55 AM" });
    // Thursday's hours end the week (Friday off): Monday next.
    expect(nextAutoStart({ ...base, now: at("2026-11-12T12:00", LA) })).toMatchObject({ text: "Next: Mon, Nov 16 at 7:55 AM" });
  });
  it("names a day left out, then the next one", () => {
    expect(nextAutoStart({ ...base, now: at("2026-11-11T12:00", LA), pto: (d) => d === "2026-11-12" })).toMatchObject({ kind: "next", text: "Thu is PTO. Next: Mon, Nov 16 at 7:55 AM" });
    expect(nextAutoStart({ ...base, now: at("2026-11-11T12:00", LA), holiday: (d) => d === "2026-11-12" })).toMatchObject({ kind: "next", text: "Thu is a holiday. Next: Mon, Nov 16 at 7:55 AM" });
    expect(nextAutoStart({ ...base, now: at("2026-11-11T12:00", LA), state: state({ skipped: ["2026-11-12"] }) })).toMatchObject({ text: "Thu is skipped. Next: Mon, Nov 16 at 7:55 AM" });
  });
  it("today is left out once attempted, while the VM is on, or after the late limit", () => {
    expect(nextAutoStart({ ...base, now: at("2026-11-11T07:00", LA), state: state({ attemptedOn: "2026-11-11" }) })).toMatchObject({ date: "2026-11-12" });
    expect(nextAutoStart({ ...base, now: at("2026-11-11T07:00", LA), on: true })).toMatchObject({ date: "2026-11-12" });
  });
  it("off, paused, no days, and outside production", () => {
    expect(nextAutoStart({ ...base, settings: DEFAULT_AUTOSTART, now: at("2026-11-11T12:00", LA) })).toEqual({ kind: "off" });
    expect(nextAutoStart({ ...base, now: at("2026-11-11T12:00", LA), state: state({ pausedOn: "2026-11-11" }) })).toMatchObject({ kind: "paused", text: expect.stringMatching(/^Paused/) });
    expect(nextAutoStart({ ...base, settings: { ...on, offDays: ["mon", "tue", "wed", "thu"] }, now: at("2026-11-11T12:00", LA) })).toMatchObject({ kind: "none" });
    for (const env of ["dev", "local", "demo", "", undefined, "Prod", "production", "prod "])
      expect(nextAutoStart({ ...base, env, now: at("2026-11-11T12:00", LA) }), String(env)).toEqual({ kind: "prod_only", text: "Auto-start runs only on the production FocusTime. Here it never starts your VM." });
  });
});

describe("VM-5: a Stop and the day's start", () => {
  const TOKYO = "Asia/Tokyo";
  const ends = (local: string, zone: string, minutes = 5) => stopEndsToday({ now: at(local, zone), zone, hours: hours(zone), minutes });

  it("before today's planned time it doesn't end today's start; at it and after it, it does", () => {
    for (const zone of [LA, BERLIN, TOKYO]) {
      expect(ends("2026-11-11T02:51", zone), zone).toBe(false);
      expect(ends("2026-11-11T07:54", zone), zone).toBe(false);
      expect(ends("2026-11-11T07:55", zone), zone).toBe(true);
      expect(ends("2026-11-11T13:00", zone), zone).toBe(true);
      // With 30 minutes: planned 7:30.
      expect(ends("2026-11-11T07:29", zone, 30), zone).toBe(false);
      expect(ends("2026-11-11T07:30", zone, 30), zone).toBe(true);
    }
  });

  it("across midnight in my zone, east and west of the server's: the date is mine, not the server's", () => {
    // Tokyo 12:30 AM Wed is still Tue in UTC: Wednesday's start is ahead, so it isn't ended.
    expect(ends("2026-11-11T00:30", TOKYO)).toBe(false);
    // Tokyo 11:50 PM Tue: past Tuesday's planned time (ends Tuesday's, which is over).
    expect(ends("2026-11-10T23:50", TOKYO)).toBe(true);
    // Los Angeles 11:50 PM Tue is already Wed in UTC: still Tuesday here, past its planned time.
    expect(ends("2026-11-10T23:50", LA)).toBe(true);
    // Los Angeles 12:10 AM Wed: before Wednesday's planned time.
    expect(ends("2026-11-11T00:10", LA)).toBe(false);
  });

  it("review: hours that start at midnight put tomorrow's planned time this evening; a Stop after it ends tomorrow's too", () => {
    const midnight = hours(LA, "00:00");
    const days = (local: string) => stopEndsDays({ now: at(local, LA), zone: LA, hours: midnight, minutes: 15 });
    // Thursday's start is planned Wed 11:45 PM: a Stop at 11:50 PM Wed ends Wednesday's and Thursday's.
    expect(days("2026-11-11T23:50")).toEqual(["2026-11-11", "2026-11-12"]);
    expect(days("2026-11-11T23:40")).toEqual(["2026-11-11"]);
    // Ordinary hours: only today, as stopEndsToday says.
    expect(stopEndsDays({ now: at("2026-11-11T23:50", LA), zone: LA, hours: hours(LA), minutes: 5 })).toEqual(["2026-11-11"]);
    expect(stopEndsDays({ now: at("2026-11-11T02:51", LA), zone: LA, hours: hours(LA), minutes: 5 })).toEqual([]);
  });

  it("a day with no planned time (no working hours) is skipped as before: there is no start to keep", () => {
    expect(ends("2026-11-13T06:00", LA)).toBe(true);
  });
});

describe("VM-5: a skip says why", () => {
  it("each way keeps its reason; an old skip with none says only Skipped today", () => {
    let s = withSkip(state(), "2026-11-11", "stop");
    s = withSkip(s, "2026-11-12", "skip");
    s = withSkip(s, "2026-11-16", "not_today");
    expect(s.skipHow).toEqual({ "2026-11-11": "stop", "2026-11-12": "skip", "2026-11-16": "not_today" });
    // A day already skipped keeps its first reason.
    expect(withSkip(s, "2026-11-11", "skip").skipHow["2026-11-11"]).toBe("stop");
    expect(skipText("skip")).toBe("Skipped today: you pressed Skip this one");
    expect(skipText("not_today")).toBe("Skipped today: you chose Not today on Day");
    expect(skipText("stop")).toBe("Skipped today: you skipped it when you stopped the VM");
    expect(skipText(undefined)).toBe("Skipped today");
    // Read from storage: a state kept before VM-5 has no reasons; a reason for a day not skipped is dropped.
    expect(autoStartStateOf({ skipped: ["2026-11-11"] }).skipHow).toEqual({});
    expect(autoStartStateOf({ skipped: ["2026-11-11"], skipHow: { "2026-11-11": "stop", "2026-11-12": "skip", "2026-11-13": "nonsense" } }).skipHow).toEqual({ "2026-11-11": "stop" });
    expect(autoStartStateOf({ skipped: ["2026-11-11"], skipHow: { "2026-11-11": "bogus" } }).skipHow).toEqual({});
    // Don't skip takes the day and its reason away.
    expect(withoutSkip(s, "2026-11-11")).toMatchObject({ skipped: ["2026-11-12", "2026-11-16"], skipHow: { "2026-11-12": "skip", "2026-11-16": "not_today" } });
  });

  it("the line says Skipped today and why, before its time and after it", () => {
    const base = { env: "prod", zone: LA, hours: hours(LA), settings: on, pto: () => false, holiday: () => false, on: false } as const;
    const skippedWed = (how?: "skip" | "not_today" | "stop") => state({ skipped: ["2026-11-11"], skipHow: how ? { "2026-11-11": how } : {} });
    expect(nextAutoStart({ ...base, now: at("2026-11-11T06:00", LA), state: skippedWed("stop") })).toMatchObject({ text: "Skipped today: you skipped it when you stopped the VM. Next: Thu, Nov 12 at 7:55 AM" });
    expect(nextAutoStart({ ...base, now: at("2026-11-11T06:00", LA), state: skippedWed() })).toMatchObject({ text: "Skipped today. Next: Thu, Nov 12 at 7:55 AM" });
    // After its time, from the recorded outcome.
    const after = { ...skippedWed("not_today"), outcome: { date: "2026-11-11", reason: "skipped" as const, at: at("2026-11-11T07:55", LA).toString(), notes: [], seen: false } };
    expect(nextAutoStart({ ...base, now: at("2026-11-11T09:00", LA), state: after })).toMatchObject({ text: "Skipped today: you chose Not today on Day. Next: Thu, Nov 12 at 7:55 AM" });
    // A PTO day says PTO, not skipped.
    expect(nextAutoStart({ ...base, pto: (d: string) => d === "2026-11-11", now: at("2026-11-11T06:00", LA), state: skippedWed("skip") })).toMatchObject({ text: expect.stringMatching(/^Wed is PTO\./) });
  });
});
