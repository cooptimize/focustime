import { describe, expect, it } from "vitest";
import { checkReminder, reminderDue } from "./notify.ts";

import { legacyHours } from "../config/schema.ts";
const shape = legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: "America/New_York" });
const at = (s: string) => Temporal.ZonedDateTime.from(`${s}[America/New_York]`);

describe("Plan the day reminder", () => {
  it("is due on Mon–Thu from the day start until 90 minutes after it, only when today isn't committed (Q23)", () => {
    expect(reminderDue(at("2026-11-02T08:59:00-05:00"), shape, false)).toBe(false);
    expect(reminderDue(at("2026-11-02T09:00:00-05:00"), shape, false)).toBe(true);
    expect(reminderDue(at("2026-11-02T10:29:59-05:00"), shape, false)).toBe(true);
    expect(reminderDue(at("2026-11-02T10:30:00-05:00"), shape, false)).toBe(false);
    expect(reminderDue(at("2026-11-02T14:00:00-05:00"), shape, false)).toBe(false); // server started late: no reminder
    expect(reminderDue(at("2026-11-02T09:00:00-05:00"), shape, true)).toBe(false);
    expect(reminderDue(at("2026-11-06T09:00:00-05:00"), shape, false)).toBe(false); // Friday
    expect(reminderDue(at("2026-11-07T09:00:00-05:00"), shape, false)).toBe(false);
  });

  it("sends once per day, never repeating, and again on the next workday", async () => {
    const sent: string[] = [];
    const marks = new Set<string>();
    let now = at("2026-11-02T09:00:30-05:00");
    const deps = {
      now: () => now,
      hours: async () => shape,
      committed: () => false,
      once: (d: string) => (marks.has(d) ? false : (marks.add(d), true)),
      send: (_t: string, b: string) => sent.push(b),
    };
    expect(await checkReminder(deps)).toBe(true);
    now = at("2026-11-02T09:01:30-05:00");
    expect(await checkReminder(deps)).toBe(false);
    now = at("2026-11-03T09:00:10-05:00"); // day rollover while running
    expect(await checkReminder(deps)).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toMatch(/—/);
  });

  it("uses the time model's zone, not the machine's", async () => {
    const sent: string[] = [];
    const utc = Temporal.ZonedDateTime.from("2026-11-02T14:05:00+00:00[UTC]"); // 9:05 New York
    expect(await checkReminder({ now: () => utc, hours: async () => shape, committed: () => false, once: () => true, send: (t) => sent.push(t) })).toBe(true);
  });

  it("sends nothing without a usable config", async () => {
    expect(await checkReminder({ now: () => at("2026-11-02T10:00:00-05:00"), hours: async () => null, committed: () => false, once: () => true, send: () => { throw new Error("no"); } })).toBe(false);
  });

  it("sends nothing on a PTO day, and a failed PTO check doesn't block it (D106)", async () => {
    const base = { now: () => at("2026-11-05T09:10:00-05:00"), hours: async () => shape, committed: () => false, once: () => true };
    const sent: string[] = [];
    expect(await checkReminder({ ...base, off: async (d) => d === "2026-11-05", send: (_t, b) => sent.push(b) })).toBe(false);
    expect(await checkReminder({ ...base, off: async () => { throw new Error("offline"); }, send: (_t, b) => sent.push(b) })).toBe(true);
    expect(sent).toEqual(["Today isn't planned yet. Open Coopilot and press P to plan the day."]);
  });
});
