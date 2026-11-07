// NV-1: Today's urgent strip: each urgent kind, mine only, and nothing (hidden) when empty. CV-3: a promise only when
// overdue or due within 2 hours (untimed: in the day's last 2 working hours); the sources are pluggable. IB-1 slice 4:
// the lines are the Inbox's own rows (inbox.today), so each is a Needs you item and opens that item.
import { describe, expect, it } from "vitest";
import { aDayPromise, anInboxRow } from "../test/builders/index.ts";
import type { UrgentAsk } from "../actions/types.ts";
import { inboxSource, moreInInbox, promiseUrgent, untimedDue, urgentLines, type UrgentSource } from "./urgent.ts";

const TODAY = "2026-11-05";
const ZONE = "America/New_York";
const NOW = "2026-11-05T15:00:00Z"; // 10:00 AM
const DAY_END = "2026-11-05T22:00:00Z"; // 5:00 PM
const anUrgentAsk = (o: Partial<UrgentAsk> = {}): UrgentAsk => ({ chatId: "c1", messageId: "m1", clientKey: "contoso", clientName: "Contoso", title: "Login is down for the client", at: "2026-11-05T14:00:00Z", conversationId: 9, ...o });
const strip = (sources: UrgentSource[], now = NOW) => urgentLines(sources, now, ZONE);
const keys = (sources: UrgentSource[], now = NOW) => strip(sources, now).map((l) => l.key);
const inbox = (rows: Parameters<typeof inboxSource>[0], dayEnd: string | null = DAY_END) => inboxSource(rows, { today: TODAY, dayEnd });

describe("the urgent strip", () => {
  it("shows a conversation needed now, a promise late and one due within 2 hours, then sends waiting, in that order", () => {
    const rows = [
      anInboxRow({ key: "s4", kind: "send", sendState: "waiting", title: "Order export", who: "Lee", due: null }),
      anInboxRow({ key: "c2", dueAt: "2026-11-05T16:30:00Z" }),
      anInboxRow({ key: "f3", due: "2026-11-03", late: true, title: "Reply to Lee", who: "Lee" }),
      anInboxRow({ key: "v9", kind: "conversation", views: ["needs_you"], due: null, title: "Login trouble", urgent: anUrgentAsk() }),
      anInboxRow({ key: "s5", kind: "send", sendState: "waiting", must: true, title: "Musts", who: "Avery", due: null }),
    ];
    // At most 3 lines, the most urgent first; the rest are "N more in Inbox".
    expect(keys([inbox(rows)])).toEqual(["v9", "f3", "c2"]);
    expect(moreInInbox(strip([inbox(rows)]), 5)).toBe(2);
    expect(keys([inbox(rows.filter((r) => r.kind === "send"))])).toEqual(["s5", "s4"]);
  });

  it("N more in Inbox is the badge's number less the Inbox lines shown; none when nothing is left or the count isn't known", () => {
    const shown = strip([inbox([anInboxRow({ key: "c1", late: true }), anInboxRow({ key: "c2", late: true })])]);
    expect(moreInInbox(shown, 7)).toBe(5);
    expect(moreInInbox(shown, 2)).toBeNull();
    expect(moreInInbox(shown, null)).toBeNull();
    const other: UrgentSource = { kind: "other", lines: () => [{ kind: "other", source: "other", key: "o:1", who: "", what: "x", tag: "Other" }] };
    expect(moreInInbox(strip([inbox([anInboxRow({ key: "c1", late: true })]), other]), 3)).toBe(2);
  });

  it("only Needs you items: a conversation that isn't urgent, a snoozed or done promise, a send already answered stay out", () => {
    const rows = [
      anInboxRow({ key: "v1", kind: "conversation", views: ["needs_you"], due: null }),
      anInboxRow({ key: "c2", late: true, due: "2026-11-03", views: [] }),
      anInboxRow({ key: "c3", late: true, due: "2026-11-03", views: ["done"], done: true }),
      anInboxRow({ key: "s4", kind: "send", sendState: "accepted", views: ["in_progress"], due: null }),
      anInboxRow({ key: "v5", kind: "conversation", views: ["teammates"], due: null, urgent: anUrgentAsk() }),
    ];
    expect(strip([inbox(rows)])).toEqual([]);
  });

  it("a promise due today more than 2 hours away stays in the agenda only", () => {
    const at4 = anInboxRow({ dueAt: "2026-11-05T21:00:00Z" });
    expect(strip([inbox([at4])])).toEqual([]);
    expect(strip([inbox([at4])], "2026-11-05T19:00:00Z")).toHaveLength(1);
    expect(promiseUrgent(aDayPromise({ dueDate: "2026-11-06", dueAt: "2026-11-06T15:00:00Z" }), { now: NOW, today: TODAY, dayEnd: DAY_END })).toBe(false);
  });

  it("one due today with no time is in the attention line until the day's last 2 working hours, then in the strip", () => {
    const row = anInboxRow({ key: "c1", dueAt: null });
    const untimed = aDayPromise({ id: 1, dueDate: TODAY, dueAt: null, toName: null });
    expect(strip([inbox([row])])).toEqual([]);
    expect(untimedDue([untimed], { now: NOW, today: TODAY, dayEnd: DAY_END })).toEqual([untimed]);
    const late = "2026-11-05T20:30:00Z"; // 3:30 PM
    expect(keys([inbox([row])], late)).toEqual(["c1"]);
    expect(untimedDue([untimed], { now: late, today: TODAY, dayEnd: DAY_END })).toEqual([]);
    // No working time today: never early, only once late.
    expect(strip([inbox([row], null)], late)).toEqual([]);
  });

  it("another source's lines show after the Inbox's", () => {
    const other: UrgentSource = { kind: "other", lines: (now) => [{ kind: "other", source: "other", key: "o:1", who: "Avery", what: `Something (${now.slice(11, 16)})`, tag: "Other" }] };
    expect(keys([inbox([anInboxRow({ key: "c1", late: true })]), other])).toEqual(["c1", "o:1"]);
  });

  it("is empty (the strip hides) with nothing urgent", () => {
    expect(strip([inbox([])])).toEqual([]);
  });
});
