// WK-5: which days Week shows, the hidden days' note, the arrows over shown days, the focus day and the fold order.
import { describe, expect, it } from "vitest";
import { catchUpWord, focusIndex, foldOrder, hiddenBy, hiddenNote, SHOW_ALL, shownDays, stepShown, type DayLite } from "./weekdays.ts";

const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const KINDS = ["work", "work", "work", "work", "overflow", "weekend", "weekend"] as const;
/** Mon Nov 9 to Sun Nov 15, 2026 (a fictional week). */
const WEEK: DayLite[] = KINDS.map((kind, i) => ({ kind, weekday: NAMES[i]!, date: `2026-11-${String(9 + i).padStart(2, "0")}` }));
const THU = "2026-11-12";
const FRI = "2026-11-13";
const SAT = "2026-11-14";

describe("which days Week shows", () => {
  it("goes by the day's kind, each setting on its own", () => {
    expect(shownDays(WEEK, SHOW_ALL)).toEqual([true, true, true, true, true, true, true]);
    expect(shownDays(WEEK, { catchUp: false, weekend: true })).toEqual([true, true, true, true, false, true, true]);
    expect(shownDays(WEEK, { catchUp: true, weekend: false })).toEqual([true, true, true, true, true, false, false]);
    expect(shownDays(WEEK, { catchUp: false, weekend: false })).toEqual([true, true, true, true, false, false, false]);
    expect(hiddenBy({ kind: "work" }, { catchUp: false, weekend: false })).toBe(false);
  });
  it("brings every day back for the visit with Show", () => {
    expect(shownDays(WEEK, { catchUp: false, weekend: false }, true).every(Boolean)).toBe(true);
  });
  it("never goes by a weekday's name: a week whose catch-up day is another weekday hides that one", () => {
    const odd: DayLite[] = [{ date: "2026-11-09", kind: "overflow", weekday: "Monday" }, { date: "2026-11-10", kind: "work", weekday: "Tuesday" }];
    expect(shownDays(odd, { catchUp: false, weekend: true })).toEqual([false, true]);
  });
});

describe("the hidden days' note", () => {
  const open = (counts: Record<string, number>) => (d: string) => counts[d] ?? 0;
  const hidden = shownDays(WEEK, { catchUp: false, weekend: false });
  it("counts the open to-dos on hidden days", () => {
    expect(hiddenNote(WEEK, hidden, THU, open({ [FRI]: 2 }))).toBe("Fri hidden · 2 to-dos");
    expect(hiddenNote(WEEK, hidden, THU, open({ [FRI]: 2, [SAT]: 1 }))).toBe("Fri, Sat hidden · 3 to-dos");
    expect(hiddenNote(WEEK, hidden, THU, open({ [SAT]: 1 }))).toBe("Sat hidden · 1 to-do");
  });
  it("says when today is hidden", () => {
    expect(hiddenNote(WEEK, hidden, FRI, open({}))).toBe("Today (Fri) is hidden");
    expect(hiddenNote(WEEK, hidden, FRI, open({ [FRI]: 2 }))).toBe("Today (Fri) is hidden · 2 to-dos");
    expect(hiddenNote(WEEK, hidden, FRI, open({ [SAT]: 1 }))).toBe("Today (Fri) is hidden · Sat hidden · 1 to-do");
  });
  it("says nothing when no hidden day has a to-do or is today, or nothing is hidden", () => {
    expect(hiddenNote(WEEK, hidden, THU, open({}))).toBeNull();
    expect(hiddenNote(WEEK, hidden, THU, open({ [THU]: 4 }))).toBeNull();
    expect(hiddenNote(WEEK, shownDays(WEEK, SHOW_ALL), FRI, open({ [FRI]: 2 }))).toBeNull();
  });
});

describe("the arrow keys over shown days", () => {
  const shown = shownDays(WEEK, { catchUp: false, weekend: true });
  it("skips hidden days", () => {
    expect(stepShown(shown, 3, 1)).toBe(5);
    expect(stepShown(shown, 5, -1)).toBe(3);
    expect(stepShown(shown, 0, -1)).toBe(0);
    expect(stepShown(shown, 6, 1)).toBe(6);
  });
  it("from a hidden day, goes to the nearest shown day", () => {
    expect(stepShown(shown, 4, 1)).toBe(5);
    expect(stepShown(shownDays(WEEK, { catchUp: false, weekend: false }), 4, 1)).toBe(3);
    expect(stepShown([false, false], 0, 1)).toBe(-1);
  });
});

describe("the day in focus", () => {
  const all = shownDays(WEEK, SHOW_ALL);
  it("is the panel's day while the panel is open", () => {
    expect(focusIndex(WEEK, all, { panel: "2026-11-10", chosen: null, today: THU })).toBe(1);
    expect(focusIndex(WEEK, all, { panel: "2026-11-10", chosen: "2026-11-11", today: THU })).toBe(1);
  });
  it("with the panel closed, a folded day opened, else today", () => {
    expect(focusIndex(WEEK, all, { panel: null, chosen: "2026-11-11", today: THU })).toBe(2);
    expect(focusIndex(WEEK, all, { panel: null, chosen: null, today: THU })).toBe(3);
  });
  it("is none in a week without today", () => {
    expect(focusIndex(WEEK, all, { panel: null, chosen: null, today: "2026-11-19" })).toBe(-1);
    expect(focusIndex(WEEK, all, { panel: null, chosen: null, today: "" })).toBe(-1);
  });
  it("is never a hidden day", () => {
    const hidden = shownDays(WEEK, { catchUp: false, weekend: false });
    expect(focusIndex(WEEK, hidden, { panel: null, chosen: null, today: FRI })).toBe(-1);
    expect(focusIndex(WEEK, hidden, { panel: FRI, chosen: null, today: THU })).toBe(3);
  });
});

describe("the fold order", () => {
  const all = shownDays(WEEK, SHOW_ALL);
  it("folds weekend days, the catch-up day, past days farthest from the focus day, then future days farthest from it", () => {
    expect(foldOrder(WEEK, all, 3, THU)).toEqual([6, 5, 4, 0, 1, 2]);
    // Focus on Tuesday (the panel on a past day): the weekend, Friday, Monday and Wednesday (past, as far), then Thursday (today).
    expect(foldOrder(WEEK, all, 1, THU)).toEqual([6, 5, 4, 0, 2, 3]);
  });
  it("never lists the focus day or a hidden day", () => {
    const shown = shownDays(WEEK, { catchUp: false, weekend: false });
    const order = foldOrder(WEEK, shown, 2, THU);
    expect(order).not.toContain(2);
    expect(order).not.toContain(4);
    expect(order).not.toContain(5);
  });
  it("with no focus day: past days from the earliest, future days from the latest", () => {
    expect(foldOrder(WEEK.slice(0, 5), [true, true, true, true, true], -1, "2026-11-20")).toEqual([4, 0, 1, 2, 3]);
    expect(foldOrder(WEEK.slice(0, 5), [true, true, true, true, true], -1, "2026-11-01")).toEqual([4, 3, 2, 1, 0]);
  });
});

describe("the catch-up day's name", () => {
  it("is the full weekday of the week's catch-up day, never a fixed name", () => {
    expect(catchUpWord(WEEK)).toBe("Friday");
    expect(catchUpWord([{ date: "2026-11-09", kind: "overflow", weekday: "Mon" }])).toBe("Monday");
    expect(catchUpWord(WEEK.slice(0, 4))).toBe("catch-up day");
  });
});
