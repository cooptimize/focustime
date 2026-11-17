// PH-1: the phone's Now screen, pure: the block's line and bar, Next, and the one thing that needs you.
import { describe, expect, it } from "vitest";
import { blockGone, blockLine, nextLines, oneThing, span } from "./phone-now.ts";
import type { InboxItemView } from "./inbox-items.ts";

const T = (hm: string) => `2026-11-02T${hm}:00-05:00`;
const clock = (iso: string) => {
  const d = new Date(Date.parse(iso) - 5 * 3600_000);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const row = (key: string, o: Partial<InboxItemView>): InboxItemView => ({ key, kind: "promise", clientKey: null, at: T("08:00"), views: ["needs_you"], title: key, who: null, where: null, due: null, dueAt: null, itemId: null, late: false, done: false, snoozedUntil: null, ...o });

describe("PH-1: the Now card's block line", () => {
  it("time left, the meeting in the block, or the meeting under way", () => {
    expect(blockLine(120, T("12:30"), null, clock)).toBe("2h left");
    expect(blockLine(120, T("12:30"), { id: "m", title: "Sprint planning", start: T("11:00"), end: T("11:30"), underWay: false, minutes: 30 }, clock)).toBe("2h left · a 30 min meeting at 11:00");
    // A meeting after the block ends doesn't matter to it.
    expect(blockLine(30, T("12:30"), { id: "m", title: "Later", start: T("13:00"), end: T("14:00"), underWay: false, minutes: 60 }, clock)).toBe("30 min left");
    expect(blockLine(85, T("12:30"), { id: "m", title: "Sprint planning", start: T("10:30"), end: T("11:30"), underWay: true, minutes: 25 }, clock)).toBe("In Sprint planning until 11:30");
  });
  it("the bar: how much of the block has gone", () => {
    expect(blockGone(T("08:00"), T("12:00"), T("10:00"))).toBe(0.5);
    expect(blockGone(T("08:00"), T("12:00"), T("07:00"))).toBe(0);
    expect(blockGone(T("08:00"), T("12:00"), T("13:00"))).toBe(1);
  });
  it("spans in the app's words", () => {
    expect([span(45), span(60), span(90)]).toEqual(["45 min", "1h", "1h 30m"]);
  });
});

describe("PH-1: Next", () => {
  it("the next meeting and the next block with its risk, in time order; nothing that has started", () => {
    const lines = nextLines(
      [{ title: "Started", start: T("09:00"), end: T("10:00") }, { title: "Review", start: T("14:00"), end: T("14:45") }, { title: "Later", start: T("16:00"), end: T("17:00") }],
      [{ start: T("08:00"), name: "Now block", risk: null }, { start: T("13:00"), name: "Northwind", risk: "At risk · Dentist 3:00" }],
      T("09:30"),
      clock,
    );
    // In time order: the block at 1:00 before the meeting at 2:00.
    expect(lines).toEqual([
      { kind: "block", at: "1:00", text: "Northwind", detail: "At risk · Dentist 3:00" },
      { kind: "meeting", at: "2:00", text: "Review", detail: "45 min" },
    ]);
    expect(nextLines([], [], T("09:30"), clock)).toEqual([]);
  });
});

describe("PH-1: the one thing that needs you", () => {
  const today = "2026-11-02";
  it("late promise, then due today, then a chat's suggestion, then the rest", () => {
    const rows = [
      row("send", { kind: "send", sendState: "waiting" }),
      row("chat", { kind: "conversation" }),
      row("today", { due: today }),
      row("late", { late: true, due: "2026-10-28" }),
    ];
    expect(oneThing(rows, 4, today)).toMatchObject({ key: "late", why: "late", of: 4 });
    expect(oneThing(rows.slice(0, 3), 3, today)).toMatchObject({ key: "today", why: "due_today" });
    expect(oneThing(rows.slice(0, 2), 2, today)).toMatchObject({ key: "chat", why: "from_chat" });
    expect(oneThing(rows.slice(0, 1), 1, today)).toMatchObject({ key: "send", why: "other" });
  });
  it("inside one kind, the Inbox's own order", () => {
    expect(oneThing([row("a", { late: true }), row("b", { late: true })], 2, today)?.key).toBe("a");
  });
  it("nothing waiting: no card", () => {
    expect(oneThing([], 0, today)).toBeNull();
    expect(oneThing([row("x", {})], 0, today)).toBeNull();
    expect(oneThing([row("x", { done: true })], 1, today)).toBeNull();
  });
});
