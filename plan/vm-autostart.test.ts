// VM-2: the auto-start's production-only gate and its rule (pure). Fictional data only.
import { describe, expect, it } from "vitest";
import type { TimeModel } from "../week/hours.ts";
import { autoStartDue, autoStartEnvAllowed, DEFAULT_AUTOSTART, EMPTY_AUTOSTART_STATE, nextAutoStart, plannedAt, shouldPause, type AutoStartSettings, type AutoStartState, type DueFacts } from "./vm-autostart.ts";

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
