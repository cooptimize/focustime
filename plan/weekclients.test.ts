import { describe, expect, it } from "vitest";
import { planOpenClient, plannedCount, weekLines } from "./weekclients.ts";
import type { ClientBudget } from "./weekplan.ts";

const fit = (clientKey: string, blocks: [string, "AM" | "PM"][], status: ClientBudget["status"] = "free"): ClientBudget => ({
  clientKey, clientName: clientKey, blocks: blocks.map(([date, half]) => ({ date, half, counts: true, reason: null, open: false })) as unknown as ClientBudget["blocks"], ptoBlocks: [], freeMinutes: blocks.length * 210, borrowedMinutes: 0, plannedMinutes: 0, status, text: "", free: "", planned: null, over: null,
});
const item = (clientKey: string, itemId: number, o: Partial<{ level: "feature" | "story"; parentId: number | null; slots: { date: string; half: "AM" | "PM" }[] }> = {}) => ({ clientKey, itemId, level: o.level ?? "feature", parentId: o.parentId ?? null, slots: o.slots ?? [] });
const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map((date, i) => ({ date, kind: i === 4 ? "overflow" : "work" }));

describe("Plan the week's client lines (U6)", () => {
  it("one line per client with blocks, in the order of its first block; a client without blocks only with a feature pinned to Friday", () => {
    const fits = [fit("Harbor", [["2026-11-10", "AM"]]), fit("Northwind", [["2026-11-09", "PM"], ["2026-11-11", "AM"]]), fit("Cooptimize", [["2026-11-09", "AM"]]), fit("Idle", [])];
    const items = [item("Atlas", 1, { slots: [{ date: "2026-11-13", half: "AM" }] }), item("Ghost", 2)];
    expect(weekLines({ fits, items, days, needs: () => false }).map((l) => l.clientKey)).toEqual(["Cooptimize", "Northwind", "Harbor", "Atlas"]);
  });

  it("counts every feature once (CF-1: no musts; a story under a listed feature goes with it), draft features too, and features that need stories", () => {
    const items = [item("A", 1), item("A", 2, { level: "story", parentId: 1 }), item("A", 3, { level: "story", parentId: 99 }), item("A", 4)];
    const [l] = weekLines({ fits: [fit("A", [["2026-11-09", "AM"]])], items, days, drafts: [{ clientKey: "A" }, { clientKey: "A" }], needs: (i) => i.itemId === 1 });
    expect(l).toMatchObject({ features: 5, needs: 1, trouble: true });
  });

  it("N of M planned counts a client with a feature or one marked Nothing this week", () => {
    const fits = [fit("A", [["2026-11-09", "AM"]]), fit("B", [["2026-11-09", "PM"]]), fit("C", [["2026-11-10", "AM"]])];
    const lines = weekLines({ fits, items: [item("A", 1)], days, quiet: ["C"], needs: () => false });
    expect(plannedCount(lines)).toBe(2);
    expect(lines.find((l) => l.clientKey === "C")?.quiet).toBe(true);
  });

  it("opens on the first client with trouble (over budget or a feature needing stories), else the first", () => {
    const fits = [fit("A", [["2026-11-09", "AM"]]), fit("B", [["2026-11-09", "PM"]], "over"), fit("C", [["2026-11-10", "AM"]])];
    expect(planOpenClient(weekLines({ fits, items: [], days, needs: () => false }))).toBe("B");
    expect(planOpenClient(weekLines({ fits: [fits[0]!, fits[2]!], items: [item("C", 7)], days, needs: (i) => i.itemId === 7 }))).toBe("C");
    expect(planOpenClient(weekLines({ fits: [fits[0]!, fits[2]!], items: [], days, needs: () => false }))).toBe("A");
    expect(planOpenClient([])).toBe(null);
  });
});
