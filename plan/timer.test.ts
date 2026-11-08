import { describe, expect, it } from "vitest";
import { buildWeek } from "../week/build.ts";
import { meeting, NY } from "../week/test-helpers.ts";
import type { WeekConfig } from "../week/types.ts";
import { dueWarnings, elapsedMs, extendTimer, pauseTimer, PRESETS, remainingMs, resumeTimer, startTimer, stopTimer, suggestMinutes, tickTimer, warnPoints } from "./timer.ts";

const T = (hhmm: string) => Temporal.Instant.from(`2026-11-02T${hhmm}:00-05:00`);
const min = (m: number) => m * 60_000;

describe("focus timer state", () => {
  it("counts down while running and freezes while paused", () => {
    let s = startTimer(T("09:00"), { kind: "focus", pickId: 7, label: "Story", minutes: 25 });
    expect(remainingMs(s, T("09:10"))).toBe(min(15));
    const p = pauseTimer(s, T("09:10"));
    s = p.state;
    expect(p.segment).toEqual({ startedAt: T("09:00").toString(), endedAt: T("09:10").toString(), seconds: 600 });
    expect(remainingMs(s, T("09:40"))).toBe(min(15));
    s = resumeTimer(s, T("09:40"));
    expect(elapsedMs(s, T("09:45"))).toBe(min(15));
  });

  it("survives a restart: the state is plain data and time keeps counting from the stored start", () => {
    const s = startTimer(T("09:00"), { kind: "focus", pickId: null, label: "Focus", minutes: 30 });
    const restored = JSON.parse(JSON.stringify(s));
    expect(remainingMs(restored, T("09:20"))).toBe(min(10));
  });

  it("ends exactly at its length, even when noticed late (window closed or server down), and logs only that much", () => {
    const s = startTimer(T("09:00"), { kind: "focus", pickId: 7, label: "Story", minutes: 25 });
    expect(tickTimer(s, T("09:24")).ended).toBe(false);
    const t = tickTimer(s, T("10:30"));
    expect(t.ended).toBe(true);
    expect(t.state).toMatchObject({ ended: true, runningSince: null });
    expect(t.segment).toEqual({ startedAt: T("09:00").toString(), endedAt: T("09:25").toString(), seconds: 1500 });
    expect(remainingMs(t.state, T("10:30"))).toBe(0);
    // Already ended: nothing more to log.
    expect(tickTimer(t.state, T("10:31")).ended).toBe(false);
  });

  it("+15 min after the end runs again from now", () => {
    const ended = tickTimer(startTimer(T("09:00"), { kind: "focus", pickId: 7, label: "Story", minutes: 25 }), T("09:30")).state;
    const s = extendTimer(ended, T("09:31"), 15);
    expect(s).toMatchObject({ ended: false, plannedMinutes: 40 });
    expect(remainingMs(s, T("09:31"))).toBe(min(15));
    // Extending a running timer just adds time.
    const run = extendTimer(startTimer(T("09:00"), { kind: "focus", pickId: null, label: "F", minutes: 25 }), T("09:10"), 15);
    expect(remainingMs(run, T("09:10"))).toBe(min(30));
  });

  it("stop logs the running part", () => {
    const s = startTimer(T("09:00"), { kind: "focus", pickId: 7, label: "Story", minutes: 25 });
    expect(stopTimer(s, T("09:12")).segment?.seconds).toBe(720);
    expect(stopTimer(pauseTimer(s, T("09:05")).state, T("09:12")).segment).toBeNull();
  });

  it("offers presets in 5-minute steps and suggests a pick's length from its size", () => {
    expect(PRESETS.slice(0, 8)).toEqual([5, 10, 15, 20, 25, 30, 45, 60]);
    expect(PRESETS.every((m) => m % 5 === 0)).toBe(true);
    const sizes = { XS: 30, S: 60, M: 120, L: 210, unsized: 60 };
    expect(suggestMinutes("S", sizes)).toBe(60);
    expect(suggestMinutes("L", sizes)).toBe(210);
    expect(suggestMinutes("S", { XS: 30, S: 47, M: 90, L: 180, unsized: 60 })).toBe(45);
    // E2: an unsized pick starts focus like an M, never refused.
    expect(suggestMinutes(null, { XS: 30, S: 60, M: 120, L: 240, unsized: 120 })).toBe(120);
  });
});

describe("warnings 5 minutes ahead", () => {
  const model = { timeZone: NY, lunch: { start: "12:00", end: "12:30" }, weekdays: { mon: [{ start: "09:00", end: "17:00" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, overrides: [] };
  const config: WeekConfig = { hours: model, thresholds: { meetingWatchMinutes: 90, meetingAtRiskMinutes: 150, minFocusWindowMinutes: 90 }, standingBlocks: [] };
  const week = buildWeek({ weekStart: "2026-11-02", patterns: [], events: [meeting("2026-11-02T10:00", "2026-11-02T10:30", { title: "Standup" }), meeting("2026-11-02T14:00", "2026-11-02T15:00", { title: "Free one", showAs: "free" })], config });
  const points = warnPoints(week.days[0]!, NY);

  it("lists busy meeting starts and the ends of working windows, not free events", () => {
    expect(points.map((p) => p.label)).toEqual(["Standup at 10:00 AM", "The morning ends at 12:00 PM", "The afternoon ends at 5:00 PM"]);
  });

  it("warns once, from 5 minutes before, mid-session", () => {
    expect(dueWarnings(points, T("09:54"), [])).toEqual([]);
    const due = dueWarnings(points, T("09:55"), []);
    expect(due.map((p) => p.label)).toEqual(["Standup at 10:00 AM"]);
    expect(dueWarnings(points, T("09:58"), due.map((p) => p.key))).toEqual([]);
    expect(dueWarnings(points, T("11:57"), []).map((p) => p.label)).toEqual(["The morning ends at 12:00 PM"]);
    // Past the point: too late to warn.
    expect(dueWarnings(points, T("10:01"), [])).toEqual([]);
  });
});
