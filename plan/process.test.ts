import { describe, expect, it } from "vitest";
import { aClientProcess, anInternalProcess } from "../test/builders/index.ts";
import type { PortfolioItem } from "../week/types.ts";
import { needsBreakdown } from "./weekplan.ts";
import { breakdownText, bucketOf, buildProcessModel, countsAsDone, isClosed, isOpen, isResolved, pickableTypes, planningLevels, stateCategories, typeOf } from "./process.ts";

describe("state categories, one rule", () => {
  it("open is Proposed or In Progress, resolved is Resolved, closed is Completed or Removed", () => {
    expect(["Proposed", "InProgress", "Resolved", "Completed", "Removed"].map(bucketOf)).toEqual(["open", "open", "resolved", "closed", "closed"]);
    expect(isOpen("Unknown")).toBe(true);
    expect(isResolved("Resolved") && !isOpen("Resolved") && !isClosed("Resolved")).toBe(true);
    expect(countsAsDone("Resolved") && countsAsDone("Completed") && !countsAsDone("Removed")).toBe(true);
  });
});

describe("a client process with custom states", () => {
  const m = buildProcessModel(aClientProcess());
  it("takes levels from the team backlogs by rank, not names", () => {
    expect(m.levels).toEqual({ top: ["Epic"], parent: ["Feature"], child: ["User Story"], task: ["Task", "Bug"] });
    expect(m.bugsBehavior).toBe("asTasks");
  });
  it("maps custom states to their categories", () => {
    const c = stateCategories(m);
    expect(c.get("Feature")!.get("09-active")).toBe("InProgress");
    expect(c.get("Feature")!.get("10-completed")).toBe("Resolved");
    expect(c.get("User Story")!.get("05-in uat")).toBe("InProgress");
    expect(c.get("User Story")!.get("approved - ready for crp")).toBe("Completed");
  });
  it("defaults blocked states DevOps maps to Removed to open", () => {
    expect(m.defaultOpenStates).toEqual([{ type: "User Story", state: "07-Blocked" }, { type: "Task", state: "10-Blocked" }]);
    const c = stateCategories(m);
    expect(c.get("User Story")!.get("07-blocked")).toBe("InProgress");
    expect(c.get("Task")!.get("10-blocked")).toBe("InProgress");
    expect(c.get("User Story")!.get("removed")).toBe("Removed");
  });
  it("keeps a client's own treat-as-open states", () => {
    expect(stateCategories(m, ["Approved - Ready for CRP"]).get("User Story")!.get("approved - ready for crp")).toBe("InProgress");
  });
  it("gives valid children and the most common child within them", () => {
    expect(typeOf(m, "Epic")).toMatchObject({ validChildren: ["Feature"], defaultChild: "Feature" });
    expect(typeOf(m, "Feature")).toMatchObject({ validChildren: ["User Story"], defaultChild: "User Story" });
    expect(typeOf(m, "User Story")).toMatchObject({ validChildren: ["Task", "Bug"], defaultChild: "Task" });
  });
  it("leaves out disabled types and keeps icon ids and colors", () => {
    expect(typeOf(m, "Test Case")).toBeUndefined();
    expect(typeOf(m, "Bug")).toMatchObject({ icon: "icon_insect", color: "CC293D", bug: true, level: "task" });
  });
  it("every parent-level type needs breakdown by default; history is information only", () => {
    expect(typeOf(m, "Feature")).toMatchObject({ needsBreakdown: true, breakdownSource: "default", history: { items: 70, withChildren: 41, share: 59 } });
    expect(typeOf(m, "User Story")!.needsBreakdown).toBe(false);
  });
  it("falls back to process configuration when team backlogs are missing", () => {
    const pc = { portfolioBacklogs: [{ workItemTypes: [{ name: "Epic" }] }, { workItemTypes: [{ name: "Feature" }] }], requirementBacklog: { workItemTypes: [{ name: "User Story" }] }, taskBacklog: { workItemTypes: [{ name: "Task" }] }, bugWorkItems: { workItemTypes: [{ name: "Bug" }] } };
    const f = buildProcessModel(aClientProcess({ teamBacklogs: null, processConfig: pc, teamSettings: { bugsBehavior: "asRequirements" } }));
    expect(f.levels).toEqual({ top: ["Epic"], parent: ["Feature"], child: ["User Story", "Bug"], task: ["Task"] });
  });
  it("with bugs off, bugs sit at no level", () => {
    const off = buildProcessModel(aClientProcess({ teamSettings: { bugsBehavior: "off" }, teamBacklogs: { value: [{ type: "portfolio", rank: 3, workItemTypes: [{ name: "Feature" }] }, { type: "requirement", rank: 2, workItemTypes: [{ name: "User Story" }] }, { type: "task", rank: 1, workItemTypes: [{ name: "Task" }] }] } }));
    expect(typeOf(off, "Bug")).toMatchObject({ level: null, bug: true });
  });
});

describe("Cooptimize's own process", () => {
  const m = buildProcessModel(anInternalProcess());
  it("follows DevOps exactly: Domain at top with Epic, Ongoing and Recurring at parent", () => {
    expect(m.levels).toEqual({ top: ["Domain", "Epic"], parent: ["Feature", "Ongoing", "Recurring"], child: ["User Story"], task: ["Task", "Bug"] });
    expect(typeOf(m, "Domain")!.validChildren).toEqual(["Feature", "Ongoing", "Recurring"]);
    expect(typeOf(m, "Domain")!.defaultChild).toBe("Feature");
  });
  it("needs breakdown is on for every parent type unless overridden", () => {
    expect(typeOf(m, "Recurring")!.needsBreakdown).toBe(true);
    const o = buildProcessModel(anInternalProcess(), { noBreakdown: ["recurring"] });
    expect(typeOf(o, "Recurring")).toMatchObject({ needsBreakdown: false, breakdownSource: "override" });
    expect(pickableTypes(o).has("Recurring")).toBe(true);
    expect(pickableTypes(m).has("Recurring")).toBe(false);
  });
  it("tells Admin the history in words", () => {
    expect(breakdownText(typeOf(m, "Recurring")!)).toBe("Recurring: 75% broken down, 12 items");
    expect(breakdownText(typeOf(m, "User Story")!)).toBeNull();
  });
  it("a background type doesn't count against hours", () => {
    const o = buildProcessModel(anInternalProcess(), { background: ["Ongoing"] });
    expect(typeOf(o, "Ongoing")!.countsHours).toBe(false);
    expect(typeOf(o, "Feature")!.countsHours).toBe(true);
  });
  it("gives the planning shapes: feature tier = parent, epic tier = top", () => {
    const p = planningLevels(buildProcessModel(anInternalProcess(), { noBreakdown: ["Recurring"] }));
    expect([...p.tiers.feature]).toEqual(["Feature", "Ongoing", "Recurring"]);
    expect([...p.tiers.epic]).toEqual(["Domain", "Epic"]);
    expect(p.story.has("Recurring") && !p.portfolio.has("Recurring")).toBe(true);
    expect(p.portfolio.has("Feature")).toBe(true);
  });
});

describe("Needs stories uses levels and the type's setting", () => {
  const m = buildProcessModel(anInternalProcess(), { noBreakdown: ["Recurring"] });
  const feature = (type: string, children: PortfolioItem["children"] = []) => ({ type, children, needsBreakdown: typeOf(m, type)!.needsBreakdown });
  it("a Recurring with no children doesn't need stories when its type is off; a Feature with none does", () => {
    expect(needsBreakdown(feature("Recurring"))).toBe(false);
    expect(needsBreakdown(feature("Feature"))).toBe(true);
    expect(needsBreakdown(feature("Ongoing"))).toBe(true);
  });
  it("a resolved story doesn't count as an open child", () => {
    const kid = { id: 1, title: "t", type: "User Story", state: "Resolved", stateCategory: "Resolved", open: isOpen("Resolved"), level: "story" as const, order: null, url: "", assignedTo: null, mine: false };
    expect(needsBreakdown(feature("Feature", [kid]))).toBe(true);
  });
});
