// NV-1: Today's urgent strip: each urgent kind, mine only, and nothing (hidden) when empty. CV-3: a promise only when
// overdue or due within 2 hours (untimed: in the day's last 2 working hours); the sources are pluggable.
import { describe, expect, it } from "vitest";
import { aDayPromise } from "../test/builders/index.ts";
import type { UrgentAsk } from "../actions/types.ts";
import { conversationSource, promiseSource, promiseUrgent, untimedDue, urgentLines, type UrgentSource } from "./urgent.ts";

const TODAY = "2026-11-05";
const ZONE = "America/New_York";
const NOW = "2026-11-05T15:00:00Z"; // 10:00 AM
const DAY_END = "2026-11-05T22:00:00Z"; // 5:00 PM
const anUrgentAsk = (o: Partial<UrgentAsk> = {}): UrgentAsk => ({ chatId: "c1", messageId: "m1", clientKey: "contoso", clientName: "Contoso", title: "Login is down for the client", at: "2026-11-05T14:00:00Z", ...o });
const strip = (sources: UrgentSource[], now = NOW) => urgentLines(sources, now, ZONE);

describe("the urgent strip", () => {
  it("shows a conversation that needs me now, a promise overdue and one due within 2 hours, in that order", () => {
    const lines = strip([conversationSource([anUrgentAsk()]), promiseSource([aDayPromise({ id: 2, dueDate: TODAY, dueAt: "2026-11-05T16:30:00Z" }), aDayPromise({ id: 3, dueDate: "2026-11-03", overdue: true, what: "Reply to Lee", toName: "Lee" })], { today: TODAY, dayEnd: DAY_END })]);
    expect(lines.map((l) => [l.kind, l.who, l.what])).toEqual([
      ["conversation", "Contoso", "Login is down for the client"],
      ["promise", "Lee", "Reply to Lee"],
      ["promise", "Dana", "Send the export"],
    ]);
  });

  it("a promise due today more than 2 hours away stays in the agenda only", () => {
    const at4 = aDayPromise({ dueDate: TODAY, dueAt: "2026-11-05T21:00:00Z" });
    expect(strip([promiseSource([at4], { today: TODAY, dayEnd: DAY_END })])).toEqual([]);
    expect(strip([promiseSource([at4], { today: TODAY, dayEnd: DAY_END })], "2026-11-05T19:00:00Z")).toHaveLength(1);
    expect(promiseUrgent(aDayPromise({ dueDate: "2026-11-06", dueAt: "2026-11-06T15:00:00Z" }), { now: NOW, today: TODAY, dayEnd: DAY_END })).toBe(false);
  });

  it("one due today with no time is in the attention line until the day's last 2 working hours, then in the strip", () => {
    const untimed = aDayPromise({ dueDate: TODAY, dueAt: null, toName: null });
    expect(strip([promiseSource([untimed], { today: TODAY, dayEnd: DAY_END })])).toEqual([]);
    expect(untimedDue([untimed], { now: NOW, today: TODAY, dayEnd: DAY_END })).toEqual([untimed]);
    const late = "2026-11-05T20:30:00Z"; // 3:30 PM
    expect(strip([promiseSource([untimed], { today: TODAY, dayEnd: DAY_END })], late)[0]).toMatchObject({ kind: "promise", who: "Contoso" });
    expect(untimedDue([untimed], { now: late, today: TODAY, dayEnd: DAY_END })).toEqual([]);
    // No working time today: never early, only once overdue.
    expect(strip([promiseSource([untimed], { today: TODAY, dayEnd: null })], late)).toEqual([]);
  });

  it("another source's lines (a sends-style test source) show after conversations and promises", () => {
    const sends: UrgentSource = { kind: "sends", lines: (now) => [{ kind: "other", source: "sends", key: "s:1", who: "Avery", what: `Musts for Friday (${now.slice(11, 16)})`, tag: "Sent to you" }] };
    const lines = strip([conversationSource([anUrgentAsk()]), promiseSource([], { today: TODAY, dayEnd: DAY_END }), sends]);
    expect(lines.map((l) => [l.kind, l.what])).toEqual([["conversation", "Login is down for the client"], ["other", "Musts for Friday (15:00)"]]);
  });

  it("is empty (the strip hides) with nothing urgent", () => {
    expect(strip([conversationSource([]), promiseSource([], { today: TODAY, dayEnd: DAY_END })])).toEqual([]);
  });
});
