// PL-1: Keep open, resolved musts and Watching check-ins in the one budget Commit, the Board and Today share.
import { describe, expect, it } from "vitest";
import { aClient, aFocusBlock, aPick, aWeek, aWeekFeature, WEEK } from "../test/builders/index.ts";
import { budgetWords } from "./estimate.ts";
import type { PlanBits } from "./carry.ts";
import { plannedWithTimeboxes } from "./timebox.ts";
import { pickNeed } from "./types.ts";
import { planBudget } from "./weekplan.ts";

const H = 60;
const SIZES = { S: 60, M: 120, L: 240 };
const week = aWeek({ patterns: [aFocusBlock({ client: aClient({ name: "Adatum" }), days: { Tue: "PM", Wed: "AM" } })] });
const bits = (o: Partial<PlanBits> = {}): PlanBits => ({ planShare: 100, keepOpenDefault: 0, keepOpen: {}, resolved: [], checkins: {}, ...o });
const adatum = (b: PlanBits | null, items = [aWeekFeature({ itemId: 11, estimate: 4 * H })]) =>
  planBudget(week, items, { borrowed: [], weekStart: WEEK, work: null, bits: b }).find((c) => c.clientKey === "adatum")!;

describe("Keep open (PL-1)", () => {
  it("plans up to free × share × (1 − keep open), and the over line uses the reduced hours", () => {
    expect(budgetWords(10 * H, 0, 80, 25).line).toBe(6 * H);
    expect(budgetWords(10 * H, 0, 80, 25).text).toBe("10h free · plan up to 6h");
    // 7h planned fits 10h, but not the 5h left with half kept open.
    expect(budgetWords(10 * H, 7 * H).kind).toBe("free");
    expect(budgetWords(10 * H, 7 * H, 100, 50)).toMatchObject({ kind: "over", over: "about 2h over", line: 5 * H });
  });

  it("reduces a client's plannable hours in the week budget, by its own share or the default", () => {
    const free = adatum(bits()).freeMinutes;
    expect(free).toBeGreaterThan(4 * H);
    expect(adatum(bits()).planUpTo).toBe(free);
    expect(adatum(bits({ keepOpen: { adatum: 30 } }))).toMatchObject({ keepOpen: 30, planUpTo: Math.round(free * 0.7) });
    expect(adatum(bits({ keepOpenDefault: 20 })).planUpTo).toBe(Math.round(free * 0.8));
    // A client's own 0 wins over the default.
    expect(adatum(bits({ keepOpenDefault: 20, keepOpen: { adatum: 0 } })).planUpTo).toBe(free);
    // Enough kept open turns a fitting week amber.
    const big = [aWeekFeature({ itemId: 11, estimate: free - H })];
    expect(adatum(bits(), big).status).not.toBe("over");
    expect(adatum(bits({ keepOpen: { adatum: 50 } }), big).status).toBe("over");
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
    const only = planBudget(week, [], { borrowed: [], weekStart: WEEK, work: null, bits: bits({ checkins: { fabrikam: 30 } }) });
    expect(only.find((c) => c.clientKey === "fabrikam")).toMatchObject({ plannedMinutes: 30, checkinMinutes: 30 });
  });
});
