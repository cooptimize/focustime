// PL-1: resolved musts and Watching check-ins in the one budget (QT-2: Keep open and Plan up to are no longer read).
import { DEFAULT_SIZE_SCALE } from "./estimate.ts";
import { describe, expect, it } from "vitest";
import { aClient, aFocusBlock, aPick, aWeek, aWeekFeature, WEEK } from "../test/builders/index.ts";
import { budgetWords } from "./estimate.ts";
import type { PlanBits } from "./carry.ts";
import { plannedWithTimeboxes } from "./timebox.ts";
import { pickNeed } from "./types.ts";
import { planBudget } from "./weekplan.ts";

const H = 60;
const SIZES = { XS: 30, S: 60, M: 120, L: 240, unsized: 60 };
const week = aWeek({ patterns: [aFocusBlock({ client: aClient({ name: "Adatum" }), days: { Tue: "PM", Wed: "AM" } })] });
const bits = (o: Partial<PlanBits> = {}): PlanBits => ({ resolved: [], checkins: {}, ...o });
const adatum = (b: PlanBits | null, items = [aWeekFeature({ itemId: 11, estimate: 4 * H })]) =>
  planBudget(week, items, { sizes: DEFAULT_SIZE_SCALE, borrowed: [], weekStart: WEEK, work: null, bits: b }).find((c) => c.clientKey === "adatum")!;

describe("QT-2: free time as it is (Plan up to and Keep open are no longer read)", () => {
  it("the week's free time is the line: amber only when what's on it needs more than its free time", () => {
    const free = adatum(bits()).freeMinutes;
    expect(free).toBeGreaterThan(4 * H);
    expect(adatum(bits()).text).toBe(`${Math.round(free / H)}h free · 4h planned`);
    expect(adatum(bits(), [aWeekFeature({ itemId: 11, estimate: free - H })]).status).not.toBe("over");
    expect(adatum(bits(), [aWeekFeature({ itemId: 11, estimate: free + 2 * H })]).status).toBe("over");
    expect(budgetWords(10 * H, 7 * H)).toMatchObject({ kind: "free", text: "10h free · 7h planned" });
  });
});

describe("a resolved must counts zero everywhere (PL-1)", () => {
  it("in the week budget, with its stories", () => {
    const items = [aWeekFeature({ itemId: 11, estimate: 4 * H }), aWeekFeature({ itemId: 12, level: "story", parentId: 11, size: "L" }), aWeekFeature({ itemId: 13, estimate: 2 * H })];
    expect(adatum(bits(), items).plannedMinutes).toBe(6 * H);
    expect(adatum(bits({ resolved: ["adatum\u000011"] }), items).plannedMinutes).toBe(2 * H);
    // Its only sized story resolved: the envelope's load goes with it.
    expect(adatum(bits({ resolved: ["adatum\u000012"] }), items).plannedMinutes).toBe(2 * H);
  });

  it("in a pick's fit on Today and Plan today", () => {
    const p = aPick({ itemId: 11, size: "L" });
    expect(pickNeed(p, SIZES)).toBe(4 * H);
    expect(pickNeed({ ...p, resolved: true }, SIZES)).toBe(0);
    expect(plannedWithTimeboxes([{ ...p, resolved: true }, aPick({ size: "S" })], SIZES, [], { start: `${WEEK}T13:00:00-05:00`, end: `${WEEK}T17:00:00-05:00` })).toBe(H);
  });
});

describe("Watching check-ins in the budget (PL-1)", () => {
  it("count their minutes at once, even for a client with no list", () => {
    expect(adatum(bits({ checkins: { adatum: 30 } })).plannedMinutes).toBe(4 * H + 30);
    const only = planBudget(week, [], { sizes: DEFAULT_SIZE_SCALE, borrowed: [], weekStart: WEEK, work: null, bits: bits({ checkins: { fabrikam: 30 } }) });
    expect(only.find((c) => c.clientKey === "fabrikam")).toMatchObject({ plannedMinutes: 30, checkinMinutes: 30 });
  });
});
