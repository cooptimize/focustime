import { describe, expect, it } from "vitest";
import { capFollowUps, dueOrder, dueState, followUpsOnDay } from "./due.ts";

describe("due urgency (step 13.5)", () => {
  const today = "2026-11-03"; // a Tuesday
  it("overdue is red with the days in words", () => {
    expect(dueState("2026-11-01", today)).toEqual({ level: "overdue", text: "Overdue 2 days", days: -2 });
    expect(dueState("2026-11-02", today)).toEqual({ level: "overdue", text: "Overdue 1 day", days: -1 });
  });
  it("due today is orange, due tomorrow is amber, both in words", () => {
    expect(dueState("2026-11-03", today)).toMatchObject({ level: "today", text: "Due today" });
    expect(dueState("2026-11-04", today)).toMatchObject({ level: "tomorrow", text: "Due tomorrow" });
  });
  it("two days or more out is neutral with the day", () => {
    expect(dueState("2026-11-05", today)).toMatchObject({ level: "later", text: "Due Thu, Nov 5" });
    expect(dueState("2026-12-01", today)).toMatchObject({ level: "later", text: "Due Tue, Dec 1" });
  });
  it("no due date: no badge", () => {
    expect(dueState(null, today)).toBeNull();
  });
  it("sorts overdue (oldest first), then due today, due tomorrow, later due dates, then the rest newest first", () => {
    const rows = [
      { id: "none-old", due: null, at: "2026-10-30T10:00:00Z" },
      { id: "later", due: "2026-11-09", at: "2026-11-01T10:00:00Z" },
      { id: "tomorrow", due: "2026-11-04", at: "2026-11-01T10:00:00Z" },
      { id: "over1", due: "2026-11-02", at: "2026-11-01T10:00:00Z" },
      { id: "none-new", due: null, at: "2026-11-02T10:00:00Z" },
      { id: "today", due: "2026-11-03", at: "2026-11-01T10:00:00Z" },
      { id: "over3", due: "2026-10-31", at: "2026-11-01T10:00:00Z" },
      { id: "sooner-later", due: "2026-11-06", at: "2026-11-01T10:00:00Z" },
    ];
    expect(dueOrder(rows, today, (r) => r.due, (r) => r.at).map((r) => r.id)).toEqual(["over3", "over1", "today", "tomorrow", "sooner-later", "later", "none-new", "none-old"]);
  });
});

describe("follow-ups on the week's cards (step 13.5)", () => {
  const f = (id: number, clientKey: string | null, due: string | null = null) => ({ id, clientKey, due, openedAt: `2026-11-01T1${id}:00:00Z` });
  const slots = [{ half: "AM", clientKey: "Adatum", working: true }, { half: "PM", clientKey: "Adatum", working: true }];
  it("puts a client's open follow-ups on that client's first block of the day, once", () => {
    const m = followUpsOnDay("2026-11-03", slots, [f(1, "Adatum"), f(2, "T&S")], "2026-11-02");
    expect(m.get("AM")?.map((x) => x.id)).toEqual([1]);
    expect(m.get("PM")).toBeUndefined();
  });
  it("a dated follow-up also shows on its due day; overdue ones on today", () => {
    const fus = [f(2, "T&S", "2026-11-04"), f(3, null, "2026-10-30"), f(4, "Adatum", "2026-11-04")];
    expect(followUpsOnDay("2026-11-04", [{ half: "AM", clientKey: null, working: true }, { half: "PM", clientKey: "Adatum", working: true }], fus, "2026-11-02").get("AM")?.map((x) => x.id)).toEqual([2]);
    expect(followUpsOnDay("2026-11-02", [{ half: "AM", clientKey: null, working: true }], fus, "2026-11-02").get("AM")?.map((x) => x.id)).toEqual([3]);
    // Not on a day with no working card.
    expect(followUpsOnDay("2026-11-04", [{ half: "AM", clientKey: null, working: false }], fus, "2026-11-02").size).toBe(0);
  });
});

describe("follow-ups per card (step 13.6, Q76, D239)", () => {
  it("shows at most three, keeping their order, and counts the rest", () => {
    expect(capFollowUps([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(capFollowUps([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(capFollowUps([])).toEqual({ shown: [], more: 0 });
  });
  it("overdue and due soon come first because the day's list is already in due order", () => {
    const fus = [
      { id: 1, clientKey: "w", due: null, openedAt: "2026-11-01T09:00:00Z" },
      { id: 2, clientKey: "w", due: "2026-11-09", openedAt: "2026-11-01T09:00:00Z" },
      { id: 3, clientKey: "w", due: "2026-10-30", openedAt: "2026-11-01T09:00:00Z" },
      { id: 4, clientKey: "w", due: "2026-11-03", openedAt: "2026-11-01T09:00:00Z" },
      { id: 5, clientKey: "w", due: null, openedAt: "2026-11-01T10:00:00Z" },
    ];
    const day = followUpsOnDay("2026-11-02", [{ half: "AM", clientKey: "w", working: true }], fus, "2026-11-02").get("AM")!;
    const c = capFollowUps(day);
    expect(c.shown.map((f) => f.id)).toEqual([3, 4, 2]);
    expect(c.more).toBe(2);
  });
});
