// TX-1b: what the assistant is told about a to-do once there's progress: the time left, the same number as the totals.
import { describe, expect, it } from "vitest";
import { SIZE_MINUTES } from "../plan/types.ts";
import { buildContext, periodOf } from "./context.ts";

const MON = "2026-11-02";
const NONE = { ahead: false, status: false, inbox: false, calls: false };
const slot = (half: "AM" | "PM") => ({ half, windows: [], freeGaps: [], focus: [], events: [], timeboxes: [], meetings: [], pto: false });
const pick = (over: object) => ({ id: 1, date: MON, half: "AM", clientKey: "Adatum", kind: "item", itemId: 7, title: "Mapping", status: "planned", size: "M", ...over });

function deps(picks: object[]) {
  return {
    today: MON,
    isMine: () => true,
    clientName: (k: string) => k,
    link: (href: string, label: string) => ({ href, label }),
    run: async (action: string) =>
      action === "week.load"
        ? { ok: true as const, data: { week: { days: [{ date: MON, kind: "work", am: slot("AM"), pm: slot("PM") }] }, plan: { [MON]: { picks } }, planning: { sizes: SIZE_MINUTES }, weekCommitted: {} } }
        : { ok: true as const, data: {} },
  } as never;
}

describe("the assistant's to-dos (AS-3) use the time left", () => {
  it("bug 10: a 2h story with 30m left is 30 minutes, matching the day's total", async () => {
    const ctx = await buildContext(deps([pick({ remainingMinutes: 30, spentMinutes: 90 })]), periodOf("day", MON, MON), null, NONE);
    expect(ctx.todos[0]!.minutes).toBe(30);
    expect(ctx.days[0]!.plannedMinutes).toBe(30);
  });

  it("a done to-do still reports what it took, and an untouched one its size", async () => {
    const ctx = await buildContext(deps([pick({ status: "done", remainingMinutes: 0 }), pick({ id: 2, itemId: 8, size: "L" })]), periodOf("day", MON, MON), null, NONE);
    expect(ctx.todos.map((t) => t.minutes)).toEqual([SIZE_MINUTES.M, SIZE_MINUTES.L]);
  });
});
