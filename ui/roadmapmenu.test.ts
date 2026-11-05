// Step 16 (D282): a Roadmap row's ⋯ menu. Only Set target date writes, and only through the DevOps write flow.
import { describe, expect, it } from "vitest";
import { roadmapRowMenu, type RoadmapRowFacts, type RoadmapRowOps } from "./menu.ts";

const ran: string[] = [];
const ops: RoadmapRowOps = { open: () => void ran.push("open"), brief: () => void ran.push("brief"), help: () => void ran.push("help"), addToWeek: () => void ran.push("week"), targetDate: () => void ran.push("target"), enableWrites: () => void ran.push("enable") };
const facts = (x: Partial<RoadmapRowFacts> = {}): RoadmapRowFacts => ({ title: "Export to CSV", tier: "feature", targetDate: null, open: 3, onWeek: false, canWrite: true, hasLink: true, ...x });
const items = (f: RoadmapRowFacts) => { const s = roadmapRowMenu(f, ops); return "items" in s ? s.items : []; };
const item = (f: RoadmapRowFacts, id: string) => items(f).find((i) => i.id === id)!;

describe("Roadmap row menu (D282)", () => {
  it("offers open, brief, help, add to this week and the target date, in that order", () => {
    expect(items(facts()).map((i) => i.label)).toEqual(["Open in browser", "Copy Coop brief", "Ask to collaborate", "Add to this week's plan", "Set target date"]);
    expect(item(facts({ targetDate: "2026-11-30" }), "target").label).toBe("Change target date");
  });
  it("adds a feature as a nice to have, never an epic, and not twice", () => {
    expect(item(facts(), "week")).toMatchObject({ action: "weekplan.add", hint: "as a nice to have" });
    expect(item(facts({ tier: "epic" }), "week").disabled).toBe("Add its features instead");
    expect(item(facts({ onWeek: true }), "week").disabled).toBe("Already on this week's plan");
    expect(item(facts({ tier: "epic" }), "brief").disabled).toBe("Briefs are for features");
  });
  it("asks to enable DevOps writes before a target date when there is no write access", () => {
    ran.length = 0;
    const t = item(facts({ canWrite: false }), "target");
    expect(t.hint).toBe("Enable DevOps writes first");
    void t.run?.();
    expect(ran).toEqual(["enable"]);
  });
});
