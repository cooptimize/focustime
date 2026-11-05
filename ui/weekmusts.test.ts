// PL-1: Commit and the Board read one budget (planBudget), so they never disagree.
import { describe, expect, it } from "vitest";
import type { WeekLoadData } from "../actions/types.ts";
import type { PlanBits } from "../plan/carry.ts";
import { weekBudget } from "../plan/weekplan.ts";
import { aClient, aFocusBlock, aWeek, aWeekFeature, WEEK } from "../test/builders/index.ts";
import { boardFits, commitFits } from "./WeekMusts.tsx";

const H = 60;
const week = aWeek({ patterns: [aFocusBlock({ client: aClient({ name: "Adatum" }), days: { Tue: "PM", Wed: "AM" } })] });
const bits = (o: Partial<PlanBits> = {}): PlanBits => ({ planShare: 100, keepOpenDefault: 0, keepOpen: {}, resolved: [], checkins: {}, ...o });

describe("Commit and the Board show the same numbers (PL-1)", () => {
  it("for the same week, with plan share, Keep open, resolved items and check-ins", () => {
    const features = [aWeekFeature({ itemId: 11, estimate: 4 * H }), aWeekFeature({ itemId: 12, estimate: 8 * H }), aWeekFeature({ itemId: 13, tier: "nice", estimate: 2 * H })];
    const data = {
      week,
      weekStart: WEEK,
      borrowed: [{ clientKey: "adatum", minutes: 30, paidAt: null, paybackDate: null }],
      devops: null,
      guidance: { planShare: 80 },
      planBits: bits({ planShare: 80, keepOpen: { adatum: 20 }, resolved: ["adatum\u000012"], checkins: { adatum: 30 } }),
    } as unknown as WeekLoadData;
    const board = boardFits(data, features);
    expect(commitFits(data, features)).toEqual(board);
    const a = board.find((c) => c.clientKey === "adatum")!;
    expect(a).toMatchObject({ plannedMinutes: 4 * H + 30, keepOpen: 20, planUpTo: Math.round(a.freeMinutes * 0.8 * 0.8) });
    // The plain weekBudget without these inputs (what the Board used to show) disagrees.
    expect(weekBudget(week, features, { borrowedMinutes: { adatum: 30 } }).find((c) => c.clientKey === "adatum")!.plannedMinutes).toBe(12 * H);
  });
});
