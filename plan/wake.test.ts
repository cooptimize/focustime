// A3: the idle rule's next wake for one person (plan/wake.ts).
import { describe, expect, it } from "vitest";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import { startTimer } from "./timer.ts";
import { nextWake, type WakeFacts } from "./wake.ts";

const NY = "America/New_York";
const cfg = parseConfig(setValue(starterToml(NY), "dataverse", "my_email", "ana@cooptimize.example"));
if (!cfg.ok) throw new Error("starter");
const hours = cfg.config.week.hours;
const base = (now: string): WakeFacts => ({
  now: Temporal.Instant.from(now),
  zone: NY,
  hours,
  offsets: { reminderMinutes: 0, checkinMinutes: 0, closeoutMinutes: 15, weekNudges: ["14:00", "09:00", "08:30"] },
  timer: null,
  warnPoints: [],
  pending: false,
});
const local = (i: Temporal.Instant) => i.toZonedDateTimeISO(NY).toPlainDateTime().toString().slice(0, 16);
/** The starter's Monday hours. */
const day = hours.weekdays.mon;

describe("the idle rule's next wake (A3)", () => {
  it("before work on a workday: the start of work (the plan reminder's window opens then)", () => {
    expect(day.length).toBeGreaterThan(0);
    const f = base("2026-11-02T10:00:00Z"); // Monday 5:00 AM in New York
    expect(local(nextWake({ ...f, offsets: { ...f.offsets, weekNudges: [] } }))).toBe(`2026-11-02T${day[0]!.start}`);
    // The Monday nudge (8:30) comes first when it is set.
    expect(local(nextWake(f))).toBe("2026-11-02T08:30");
  });

  it("never sleeps past the next midnight, even with no hours set up", () => {
    const w = nextWake({ ...base("2026-11-02T22:00:00Z"), hours: null, offsets: { reminderMinutes: 0, checkinMinutes: 0, closeoutMinutes: 0, weekNudges: [] } });
    expect(local(w)).toBe("2026-11-03T00:01");
  });

  it("a running timer wakes it at the latest when the session ends, and within 5 minutes for the calendar", () => {
    const now = Temporal.Instant.from("2026-11-02T15:00:00Z");
    const timer = startTimer(now.subtract({ minutes: 23 }), { kind: "focus", pickId: null, label: "Focus", minutes: 25 });
    expect(nextWake({ ...base(now.toString()), timer }).toString()).toBe("2026-11-02T15:02:00Z");
    const long = startTimer(now, { kind: "focus", pickId: null, label: "Focus", minutes: 50 });
    expect(nextWake({ ...base(now.toString()), timer: long }).toString()).toBe("2026-11-02T15:05:00Z");
    // A meeting warning 5 minutes before it.
    const warn = [{ key: "m1", at: "2026-11-02T15:07:00Z", label: "Standup" }];
    expect(nextWake({ ...base(now.toString()), timer: long, warnPoints: warn }).toString()).toBe("2026-11-02T15:02:00Z");
    expect(nextWake({ ...base(now.toString()), timer: { ...long, warned: ["m1"] }, warnPoints: warn }).toString()).toBe("2026-11-02T15:05:00Z");
  });

  it("an ended or paused timer doesn't keep it awake; something pending wakes it now", () => {
    const now = "2026-11-02T22:30:00Z"; // 5:30 PM
    const paused = { ...startTimer(Temporal.Instant.from(now), { kind: "focus", pickId: null, label: "F", minutes: 25 }), runningSince: null };
    expect(Temporal.Instant.compare(nextWake({ ...base(now), timer: paused }), Temporal.Instant.from(now).add({ minutes: 5 }))).toBeGreaterThan(0);
    expect(nextWake({ ...base(now), pending: true }).toString()).toBe(now);
  });

  it("always after now", () => {
    for (let h = 0; h < 48; h++) {
      const now = Temporal.Instant.from("2026-11-02T00:00:00Z").add({ minutes: h * 30 + 7 });
      expect(Temporal.Instant.compare(nextWake(base(now.toString())), now)).toBe(1);
    }
  });
});
