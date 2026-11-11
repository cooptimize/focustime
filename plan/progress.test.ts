// TX-1: XS, timeboxes as work sessions, time spent and left, and the check-in's rules.
import { describe, expect, it } from "vitest";
import { DEFAULT_SIZE_SCALE, estimate, plannedMinutesOf, sizeChipText, storyMinutes, STORY_SIZES, validStorySize, type EstItem } from "./estimate.ts";
import { fitToGap } from "./timeline.ts";
import { planMyDay, placeInGap } from "./agenda.ts";
import { timeChoices } from "./picktime.ts";
import { durationText, LEFT_CHOICES, outcomeOf, parseLeft, planOutcome, progressAsk, progressChip, progressComment, inheritedProgress, removedNotice, remainingHours, resizedRemaining, sessionRows, validLeft, weekStoryLeft } from "./progress.ts";
import { pickNeed, SIZES, type Pick } from "./types.ts";
import { planMinutes } from "./fit.ts";
import { dropCheck } from "./weekdrop.ts";
import { suggestMinutes } from "./timer.ts";

describe("TX-1b: the rules behind the review's fixes", () => {
  const scale = DEFAULT_SIZE_SCALE;
  it("bug 7: a re-size never takes the time left past the size, and leaves a number the person set above it alone", () => {
    expect(resizedRemaining(60, "M", "L", scale)).toBe(180);
    expect(resizedRemaining(240, "L", "M", scale)).toBe(120);
    expect(resizedRemaining(180, "M", "L", scale)).toBeNull(); // 3h on a 2h story: the person's own number.
  });
  it("bug 2: one notice names every day", () => {
    expect(removedNotice(["2026-11-03"])).toBe("Removed from Tue, story is done");
    expect(removedNotice(["2026-11-03", "2026-11-04"])).toBe("Removed from Tue and Wed, story is done");
    expect(removedNotice([])).toBeNull();
  });
  it("bug 3: a story's time left is its current state in that week, then its last time left, then nothing", () => {
    const WEEK = ["2026-11-09", "2026-11-15"] as const;
    const row = (date: string, status: string, remaining: number, id = 1) => ({ date, status, remaining, id });
    expect(weekStoryLeft([row("2026-11-02", "done", 90)], ...WEEK)).toBe(90);
    expect(weekStoryLeft([row("2026-11-02", "done", 0)], ...WEEK)).toBeNull();
    expect(weekStoryLeft([row("2026-11-10", "done", 90)], ...WEEK)).toBe(0);
    expect(weekStoryLeft([row("2026-11-10", "done", 90), row("2026-11-12", "planned", 45, 2)], ...WEEK)).toBe(45);
    expect(weekStoryLeft([row("2026-11-02", "planned", 0), row("2026-11-03", "planned", 60, 2)], ...WEEK)).toBe(60);
    expect(weekStoryLeft([], ...WEEK)).toBeNull();
  });
});

describe("TX-1c: the time of a to-do that's gone, and what a new one inherits", () => {
  const scale = DEFAULT_SIZE_SCALE;
  const WEEK = ["2026-11-09", "2026-11-15"] as const;
  const row = (date: string, status: string, remaining: number, id = 1) => ({ date, id, status, remaining });
  it("a to-do taken off the plan keeps its time left for the list, but never decides that the story is done or not", () => {
    expect(weekStoryLeft([row("2026-11-10", "dropped", 90)], ...WEEK)).toBe(90);
    expect(weekStoryLeft([row("2026-11-09", "done", 90, 1), row("2026-11-10", "dropped", 90, 2)], ...WEEK)).toBe(0);
    expect(weekStoryLeft([row("2026-11-09", "planned", 45, 1), row("2026-11-10", "dropped", 45, 2)], ...WEEK)).toBe(45);
  });
  const had = (date: string, remaining: number | null, spent: number | null, size: "S" | "M" | "L" | null = "M", id = 1) => ({ date, id, size, minutes: null, remaining, spent });
  it("takes the latest time left and the most time spent, from any of the story's to-dos", () => {
    expect(inheritedProgress([had("2026-11-02", 60, 120, "M", 1), had("2026-11-03", 90, 60, "M", 2)], { size: "M" }, scale)).toEqual({ remaining: 90, spent: 120 });
    expect(inheritedProgress([had("2026-11-02", 0, 120), had("2026-11-03", null, null, "M", 2)], { size: "M" }, scale)).toBeNull();
    expect(inheritedProgress([], { size: "M" }, scale)).toBeNull();
  });
  it("never more than the new to-do's size, unless the person said more was left than the size it had", () => {
    expect(inheritedProgress([had("2026-11-02", 180, 60, "L")], { size: "S" }, scale)).toEqual({ remaining: 60, spent: 60 });
    expect(inheritedProgress([had("2026-11-02", 180, 60, "S")], { size: "S" }, scale)).toEqual({ remaining: 180, spent: 60 });
    expect(inheritedProgress([had("2026-11-02", 180, 60, "L")], { size: null }, { ...scale, unsized: 120 })).toEqual({ remaining: 120, spent: 60 });
    expect(inheritedProgress([had("2026-11-02", 45, 0, "L")], { size: "S" }, scale)).toEqual({ remaining: 45, spent: 0 });
  });
});

const S = DEFAULT_SIZE_SCALE;
const D = "2026-11-02";
const at = (t: string) => `${D}T${t}:00-05:00`;
const pick = (o: Partial<Pick> = {}): Pick => ({ id: 1, date: D, half: "AM", clientKey: "Contoso", kind: "item", itemId: 7, draftId: null, title: "Export", itemType: "User Story", itemUrl: null, size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, notes: null, followUpId: null, position: 1, createdAt: "", updatedAt: "", ...o });
const box = (id: number, pickId: number | null, a: string, b: string, o: object = {}) => ({ id, date: D, pickId, start: at(a), end: at(b), removedAt: null, ...o });
const slotOf = (gaps: [string, string][]) => ({ date: D, half: "AM", start: at("08:00"), end: at("12:00"), view: { start: at("08:00"), end: at("12:00") }, windows: [{ start: at("08:00"), end: at("12:00") }], pto: false, off: false, focus: [], events: [], freeGaps: gaps.map(([a, b]) => ({ start: at(a), end: at(b), minutes: (Date.parse(at(b)) - Date.parse(at(a))) / 60000 })), longestFreeMinutes: 0 }) as never;

describe("XS", () => {
  it("is 30 minutes and is on the scale everywhere sizes are picked", () => {
    expect(STORY_SIZES).toEqual(["XS", "S", "M", "L"]);
    expect(SIZES).toEqual(["XS", "S", "M", "L"]);
    expect(storyMinutes("XS", S)).toBe(30);
    expect(validStorySize("XS")).toBe(true);
    expect(sizeChipText("XS", S)).toBe("XS · 30 min");
  });
});

describe("a timebox's length is its own thing", () => {
  const twoH = pick({ size: "M" });
  it("placing a 2h item in a 1h gap makes a 1h timebox and leaves the size alone", () => {
    const r = planMyDay([twoH], { AM: slotOf([["09:00", "10:00"]]) }, [], S);
    expect(r.placed).toHaveLength(1);
    expect(r.placed[0]).toMatchObject({ minutes: 60, trimmed: true });
    expect(twoH.size).toBe("M");
    expect(timeChoices(slotOf([["09:00", "10:00"]]), [], twoH, S)[0]).toMatchObject({ kind: "gap", minutes: 60 });
  });
  it("a drop takes the smaller of what's left and the free gap, on the 15 minute grid", () => {
    const gaps = [{ start: at("09:00"), end: at("09:50") }];
    expect(fitToGap({ start: at("09:00"), end: at("11:00") }, gaps)).toMatchObject({ start: at("09:00") });
    expect((Date.parse(fitToGap({ start: at("09:00"), end: at("11:00") }, gaps).end) - Date.parse(at("09:00"))) / 60000).toBe(45);
    expect(fitToGap({ start: at("09:00"), end: at("09:30") }, gaps)).toEqual({ start: at("09:00"), end: at("09:30") });
    // Landing on a meeting (no free gap there) keeps the length.
    expect(fitToGap({ start: at("10:00"), end: at("11:00") }, gaps)).toEqual({ start: at("10:00"), end: at("11:00") });
  });
  it("a trimmed placement lands on 15 minute steps", () => {
    expect(placeInGap({ start: at("09:00"), end: at("09:50"), minutes: 50 }, 120, 30)).toMatchObject({ minutes: 45, trimmed: true });
  });
  it("placing uses the time left, not the size", () => {
    const r = planMyDay([pick({ size: "L", remainingMinutes: 60, spentMinutes: 180 })], { AM: slotOf([["09:00", "12:00"]]) }, [], S);
    expect(r.placed[0]).toMatchObject({ minutes: 60, trimmed: false });
  });
});

describe("remaining time", () => {
  it('reads "1h of 2h left"; no chip before there is progress; more left than the size says so', () => {
    expect(progressChip(pick(), S)).toBeNull();
    expect(progressChip(pick({ remainingMinutes: 60, spentMinutes: 60 }), S)).toBe("1h of 2h left");
    expect(progressChip(pick({ size: "S", remainingMinutes: 30, spentMinutes: 30 }), S)).toBe("30m of 1h left");
    expect(progressChip(pick({ remainingMinutes: 180 }), S)).toBe("3h left · was 2h");
    expect(progressChip(pick({ size: null, remainingMinutes: 30 }), S)).toBe("30m of 1h left");
  });
  it("what a to-do needs is the time left", () => {
    expect(pickNeed(pick(), S)).toBe(120);
    expect(pickNeed(pick({ remainingMinutes: 45 }), S)).toBe(45);
    expect(pickNeed(pick({ remainingMinutes: 0 }), S)).toBe(0);
  });
  it("week capacity counts a story's time left", () => {
    const item = (itemId: number, o: Partial<EstItem> = {}): EstItem => ({ clientKey: "C", itemId, level: "story", estimate: null, size: "M", parentId: null, ...o });
    const e = estimate([item(1), item(2, { remainingMinutes: 60 })], S);
    expect(plannedMinutesOf(e, "C")).toBe(180);
  });
  it("a block's planned minutes count what's left of an untimed to-do", () => {
    const slot = { date: D, start: at("08:00"), end: at("12:00") };
    expect(planMinutes([pick({ remainingMinutes: 30, spentMinutes: 90 })], S, [], slot)).toBe(30);
    expect(planMinutes([pick()], S, [], slot)).toBe(120);
  });
  it("dragging a story to a block counts what's left", () => {
    const free = slotOf([["09:00", "09:45"]]);
    const base = { slot: free, ptoDay: false, catchUp: false, now: Temporal.Instant.from(at("07:00")), today: D, picks: [], sizes: S, timeboxes: [] };
    const dragged = { clientKey: "Contoso", itemId: 7, size: "M" as const, title: "Export" };
    // QT-1, QT-2: the tip never says over; it says the block's free time (an hour here).
    expect(dropCheck({ ...base, dragged } as never)).toMatchObject({ over: false, text: "1h free", freeMinutes: 45 });
    expect(dropCheck({ ...base, dragged: { ...dragged, remainingMinutes: 30 } } as never)).toMatchObject({ over: false, text: "30 min of 1h free" });
  });
  it("the focus timer suggests what's left", () => {
    expect(suggestMinutes("L", S, 45)).toBe(45);
    expect(suggestMinutes("L", S)).toBe(240);
  });
  it("a re-size moves the time left, at least 15 minutes; no progress: nothing to move", () => {
    expect(resizedRemaining(60, "M", "L", S)).toBe(180);
    expect(resizedRemaining(30, "L", "XS", S)).toBe(15);
    expect(resizedRemaining(null, "M", "L", S)).toBeNull();
  });
});

describe("who a check-in asks about", () => {
  const NOW = at("12:30");
  it("timeboxes that ended, on planned to-dos, unanswered, one row per to-do", () => {
    const picks = [pick({ id: 1 }), pick({ id: 2, itemId: 8, title: "Done one", status: "done" }), pick({ id: 3, itemId: 9, title: "Still going" })];
    const rows = sessionRows(D, [box(1, 1, "09:00", "10:00"), box(2, 1, "10:00", "10:30"), box(3, 2, "10:30", "11:00"), box(4, 3, "12:00", "13:00"), box(5, null, "08:00", "09:00")], picks, NOW, S);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pickId: 1, timeboxIds: [1, 2], minutes: 90, remaining: 120, covers: false });
  });
  it("skips one already answered, removed, on another day or done in DevOps", () => {
    const picks = [pick({ id: 1 }), pick({ id: 2, itemId: 8, resolved: true })];
    const rows = sessionRows(D, [box(1, 1, "09:00", "10:00", { settled: "partly" }), box(2, 1, "09:00", "10:00", { removedAt: "x" }), box(3, 1, "09:00", "10:00", { date: "2026-11-01" }), box(4, 2, "09:00", "10:00")], picks, NOW, S);
    expect(rows).toEqual([]);
  });
});

describe("what an answer does", () => {
  const row = { minutes: 60, remaining: 120 };
  it("Done spends the timebox and leaves nothing; Partly takes the time left; Didn't get to it changes nothing", () => {
    expect(outcomeOf("done", row, 30)).toEqual({ as: "done", spent: 90, remaining: 0 });
    expect(outcomeOf("partly", row, 0, 60)).toEqual({ as: "partly", spent: 60, remaining: 60 });
    expect(outcomeOf("none", row, 15)).toEqual({ as: "none", spent: 15, remaining: 120 });
  });
  it('"All went to plan": a timebox that covered the time left is done; any other counts as spent', () => {
    expect(planOutcome({ minutes: 120, remaining: 120, covers: true }, 0)).toEqual({ as: "done", spent: 120, remaining: 0 });
    expect(planOutcome({ minutes: 60, remaining: 120, covers: false }, 30)).toEqual({ as: "partly", spent: 90, remaining: 60 });
  });
  it("the time left: quick picks and typed", () => {
    expect(LEFT_CHOICES.map(durationText)).toEqual(["30m", "1h", "1.5h", "2h"]);
    expect(["45", "45m", "1h", "1.5h", "1h 30m", "2"].map(parseLeft)).toEqual([45, 45, 60, 90, 90, 120]);
    expect([parseLeft("soon"), parseLeft("0"), parseLeft("1000h")]).toEqual([null, null, null]);
    expect(validLeft(7)).toBe(false);
  });
  it("the DevOps words and units", () => {
    expect(progressComment(60, 60)).toBe("Worked 1h today, about 1h left");
    expect(remainingHours(90)).toBe(1.5);
    expect(progressAsk(2, 0)).toBe("Update Remaining Work on 2 stories?");
    expect(progressAsk(0, 1)).toBe("Add a short comment on 1 story?");
    expect(progressAsk(1, 2)).toBe("Update Remaining Work on 1 story and comment on 2 stories?");
  });
});
