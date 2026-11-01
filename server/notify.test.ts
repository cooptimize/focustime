import { describe, expect, it } from "vitest";
import { CHECKIN_MESSAGE, CLOSEOUT_MESSAGE, checkDayReminder, checkinReminderDue, checkReminder, closeoutReminderDue, reminderDue, checkWeekNudges } from "./notify.ts";

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

  it("starts the window later with an offset from Settings > Planning (step 6c)", () => {
    expect(reminderDue(at("2026-11-02T09:10:00-05:00"), shape, false, 30)).toBe(false);
    expect(reminderDue(at("2026-11-02T09:30:00-05:00"), shape, false, 30)).toBe(true);
    expect(reminderDue(at("2026-11-02T10:59:00-05:00"), shape, false, 30)).toBe(true);
    expect(reminderDue(at("2026-11-02T11:00:00-05:00"), shape, false, 30)).toBe(false);
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

describe("Check-in and Close out reminders (step 7)", () => {
  const lunch = { ...shape, lunch: { start: "12:00", end: "12:45" } };
  it("Close out: from 15 minutes before the day's end for 90 minutes, until closed out; an evening moves it", () => {
    expect(closeoutReminderDue(at("2026-11-02T16:44:00-05:00"), shape, false, 15)).toBe(false);
    expect(closeoutReminderDue(at("2026-11-02T16:45:00-05:00"), shape, false, 15)).toBe(true);
    expect(closeoutReminderDue(at("2026-11-02T18:14:00-05:00"), shape, false, 15)).toBe(true);
    expect(closeoutReminderDue(at("2026-11-02T18:15:00-05:00"), shape, false, 15)).toBe(false);
    expect(closeoutReminderDue(at("2026-11-02T16:50:00-05:00"), shape, true, 15)).toBe(false);
    expect(closeoutReminderDue(at("2026-11-06T16:50:00-05:00"), shape, false, 15)).toBe(false); // Friday has no hours
    const evening = { ...shape, overrides: [{ date: "2026-11-02", segments: [{ start: "09:00", end: "16:00" }, { start: "20:00", end: "22:00" }] }] };
    expect(closeoutReminderDue(at("2026-11-02T16:50:00-05:00"), evening, false, 15)).toBe(false);
    expect(closeoutReminderDue(at("2026-11-02T21:45:00-05:00"), evening, false, 15)).toBe(true);
  });
  it("Check-in: at the end of lunch (or midday) plus the offset, only on a committed day", () => {
    expect(checkinReminderDue(at("2026-11-02T12:44:00-05:00"), lunch, true, 0)).toBe(false);
    expect(checkinReminderDue(at("2026-11-02T12:45:00-05:00"), lunch, true, 0)).toBe(true);
    expect(checkinReminderDue(at("2026-11-02T12:50:00-05:00"), lunch, false, 0)).toBe(false);
    expect(checkinReminderDue(at("2026-11-02T13:00:00-05:00"), lunch, true, 30)).toBe(false);
    expect(checkinReminderDue(at("2026-11-02T13:15:00-05:00"), lunch, true, 30)).toBe(true);
    // No lunch: the middle of the day (9 to 5 splits at 1:00 PM).
    const none = { ...shape, lunch: null };
    expect(checkinReminderDue(at("2026-11-02T12:59:00-05:00"), none, true, 0)).toBe(false);
    expect(checkinReminderDue(at("2026-11-02T13:00:00-05:00"), none, true, 0)).toBe(true);
  });
  it("each fires once a day, across checks and restarts (the store marker), not on a PTO day", async () => {
    const marks = new Set<string>();
    const sent: string[] = [];
    let now = at("2026-11-02T16:46:00-05:00");
    const closeout = {
      now: () => now,
      hours: async () => shape,
      due: (n: Temporal.ZonedDateTime, m: typeof shape) => closeoutReminderDue(n, m, false, 15),
      once: (d: string) => (marks.has(`closeout:${d}`) ? false : (marks.add(`closeout:${d}`), true)),
      send: () => sent.push(CLOSEOUT_MESSAGE),
    };
    expect(await checkDayReminder(closeout)).toBe(true);
    now = at("2026-11-02T16:50:00-05:00");
    expect(await checkDayReminder(closeout)).toBe(false);
    expect(await checkDayReminder({ ...closeout, now: () => at("2026-11-05T16:50:00-05:00"), off: async () => true })).toBe(false);
    const checkin = { ...closeout, now: () => at("2026-11-02T13:05:00-05:00"), hours: async () => ({ ...shape, lunch: null }), due: (n: Temporal.ZonedDateTime, m: typeof shape) => checkinReminderDue(n, m, true, 0), once: (d: string) => (marks.has(`checkin:${d}`) ? false : (marks.add(`checkin:${d}`), true)), send: () => sent.push(CHECKIN_MESSAGE) };
    expect(await checkDayReminder(checkin)).toBe(true);
    expect(await checkDayReminder(checkin)).toBe(false);
    expect(sent).toEqual([CLOSEOUT_MESSAGE, CHECKIN_MESSAGE]);
    expect(sent.join(" ")).not.toMatch(/—/);
  });
});

describe("week nudges (step 8)", () => {
  const times = { thu: "14:00", fri: "09:00", mon: "08:30" };
  const zoned = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[America/New_York]`);
  function deps(now: string, over: Partial<Parameters<typeof checkWeekNudges>[0]> = {}) {
    const marks = new Set<string>();
    const sent: string[] = [];
    return {
      sent,
      d: {
        now: () => zoned(now),
        times: async () => times,
        committed: () => false,
        off: async () => false,
        once: (key: string, week: string) => (marks.has(`${key}:${week}`) ? false : (marks.add(`${key}:${week}`), true)),
        send: (body: string) => void sent.push(body),
        ...over,
      },
    };
  }
  it("fires Thursday's nudge once for next week, naming the key", async () => {
    const { d, sent } = deps("2026-11-05T14:00:00-05:00");
    expect(await checkWeekNudges(d)).toBe(1);
    expect(await checkWeekNudges(d)).toBe(0);
    expect(sent).toEqual(["Next week (Nov 9) isn't planned yet: commit features per client. Open Coopilot and press W."]);
  });
  it("Q50: Thursday's nudge skipped for PTO fires at Friday's working start; several due for one week send one message", async () => {
    const thu = deps("2026-11-05T14:30:00-05:00", { off: async () => true });
    expect(await checkWeekNudges(thu.d)).toBe(0);
    // Friday 9:00 (work starts at 9): Thursday's and Friday's are both due for Nov 9: one notification, both marked.
    const marks = new Set<string>();
    const fri = deps("2026-11-06T09:00:00-05:00", { committed: (w: string) => w === "2026-11-02", workStart: async () => "09:00", once: (k: string, w: string) => (marks.has(`${k}:${w}`) ? false : (marks.add(`${k}:${w}`), true)) });
    expect(await checkWeekNudges(fri.d)).toBe(1);
    expect([...marks].sort()).toEqual(["week_nudge_fri:2026-11-09", "week_nudge_thu:2026-11-09"]);
    expect(await checkWeekNudges(fri.d)).toBe(0);
    expect(fri.sent).toHaveLength(1);
  });
  it("Monday's is about this week; nothing once committed, before the time, or on a PTO day", async () => {
    const mon = deps("2026-11-09T08:45:00-05:00");
    await checkWeekNudges(mon.d);
    expect(mon.sent).toEqual(["This week isn't planned yet: commit features per client. Open Coopilot and press W."]);
    expect(await checkWeekNudges(deps("2026-11-09T08:45:00-05:00", { committed: () => true }).d)).toBe(0);
    expect(await checkWeekNudges(deps("2026-11-09T08:00:00-05:00").d)).toBe(0);
    expect(await checkWeekNudges(deps("2026-11-06T10:00:00-05:00", { off: async () => true }).d)).toBe(0);
  });
});
