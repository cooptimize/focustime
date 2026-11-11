// QC-1: the New form's pure rules: levels from the process (two processes, one with a level above epic), the parent
// rule, titles, required fields, each place's defaults, and Ahead showing what I just created whatever the filters say.
import { describe, expect, it } from "vitest";
import { anAheadClient, anAheadItem, anAheadLoad, anAssignee } from "../test/builders/index.ts";
import { DEFAULT_FILTERS, groups, hiddenBy } from "./ahead-model.ts";
import { childTypesOf, cleanTitle, createLevels, createLevelsOf, draftLevelOf, formDefaults, missingRequired, parentProblem, parentTypesOf, TITLE_MAX, type CreateLevel } from "./quick-create.ts";

const agile = {
  requirementBacklog: { name: "Stories", workItemTypes: [{ name: "User Story" }] },
  taskBacklog: { name: "Tasks", workItemTypes: [{ name: "Task" }] },
  portfolioBacklogs: [
    { name: "Epics", workItemTypes: [{ name: "Epic" }] },
    { name: "Features", workItemTypes: [{ name: "Feature" }] },
  ],
};
// A Scrum-like process with a level above epics and two types at the requirement level.
const withDomain = {
  requirementBacklog: { name: "Backlog items", workItemTypes: [{ name: "Product Backlog Item" }, { name: "Bug" }] },
  taskBacklog: { name: "Tasks", workItemTypes: [{ name: "Task" }] },
  portfolioBacklogs: [
    { name: "Domains", workItemTypes: [{ name: "Domain" }] },
    { name: "Epics", workItemTypes: [{ name: "Epic" }] },
    { name: "Features", workItemTypes: [{ name: "Feature" }, { name: "Capability" }] },
  ],
};

describe("levels come from the process, never from type names", () => {
  it("an Agile-like process: Epic, Feature, User Story; tasks left out", () => {
    expect(createLevels(agile)).toEqual([
      { rung: 0, types: ["Epic"], kind: "portfolio" },
      { rung: 1, types: ["Feature"], kind: "portfolio" },
      { rung: 2, types: ["User Story"], kind: "requirement" },
    ]);
  });
  it("a process with a level above epic and two types per level", () => {
    const l = createLevels(withDomain);
    expect(l.map((x) => x.types)).toEqual([["Domain"], ["Epic"], ["Feature", "Capability"], ["Product Backlog Item", "Bug"]]);
    expect(l.map((x) => x.kind)).toEqual(["portfolio", "portfolio", "portfolio", "requirement"]);
  });
  it("an unreadable process has no levels", () => {
    expect(createLevels(null)).toEqual([]);
    expect(createLevelsOf([])).toEqual([]);
  });
});

describe("the parent rule: one level up, or none", () => {
  const ladder = [["Domain"], ["Epic"], ["Feature", "Capability"], ["Product Backlog Item", "Bug"], ["Task"]];
  it("allows the next level down and says what goes under otherwise", () => {
    expect(parentProblem(ladder, "Domain", "Epic")).toBeNull();
    expect(parentProblem(ladder, "Epic", "Capability")).toBeNull();
    expect(parentProblem(ladder, "Feature", "Bug")).toBeNull();
    expect(parentProblem(ladder, "Epic", "Product Backlog Item")).toBe("A Product Backlog Item doesn't go under an Epic in this process. Under an Epic go: Feature, Capability");
    expect(parentProblem(ladder, "Product Backlog Item", "Feature")).toBe("Nothing goes under a Product Backlog Item in this process's backlogs");
    expect(parentProblem(ladder, "Epic", "Initiative")).toBe("Initiative isn't a level in this project's process");
  });
  it("parents and children of a type", () => {
    expect(parentTypesOf(ladder, "Epic")).toEqual(["Domain"]);
    expect(parentTypesOf(ladder, "Domain")).toEqual([]);
    expect(childTypesOf(ladder, "Feature")).toEqual(["Product Backlog Item", "Bug"]);
    // A story's children are tasks: not offered.
    expect(childTypesOf(ladder, "Bug")).toEqual([]);
  });
});

describe("titles", () => {
  it("one line, spaces collapsed, required, at most 255", () => {
    expect(cleanTitle("  Billing \n export  ")).toEqual({ title: "Billing export" });
    expect(cleanTitle("   ")).toEqual({ problem: "Type a title" });
    expect(cleanTitle(undefined)).toEqual({ problem: "Type a title" });
    expect(cleanTitle("x".repeat(TITLE_MAX))).toEqual({ title: "x".repeat(TITLE_MAX) });
    expect(cleanTitle("x".repeat(300))).toEqual({ problem: "A DevOps title is at most 255 characters. This one is 300" });
  });
});

describe("required fields", () => {
  it("only required fields with no default that DevOps doesn't set and the create doesn't write", () => {
    const f = (ref: string, required = true, hasDefault = false) => ({ ref, name: ref.split(".").pop()!, required, hasDefault });
    const info = [f("System.Title"), f("System.State"), f("System.AreaPath"), f("Custom.CostCenter"), f("Custom.Team", true, true), f("Custom.Optional", false), f("System.AssignedTo")];
    expect(missingRequired(info, new Set(["System.Title"])).map((x) => x.ref)).toEqual(["Custom.CostCenter", "System.AssignedTo"]);
    expect(missingRequired(info, new Set(["System.Title", "System.AssignedTo", "Custom.CostCenter"]))).toEqual([]);
  });
});

describe("each place's defaults", () => {
  const levels: CreateLevel[] = createLevels(withDomain);
  const def = (r: number) => (r === 2 ? "Capability" : (levels.find((l) => l.rung === r)?.types[0] ?? null));
  it("Ahead's toolbar and the panel: the feature tier's default; the panel keeps the typed title and places it", () => {
    expect(formDefaults({ from: "ahead", clientKey: "Northwind" }, levels, def)).toEqual({ clientKey: "Northwind", type: "Capability", parentId: null, title: "", placeOnBlock: false });
    expect(formDefaults({ from: "panel", clientKey: "Northwind", title: "Export", at: { date: "2026-11-03", half: "AM" } }, levels, def)).toMatchObject({ type: "Capability", title: "Export", placeOnBlock: true });
  });
  it("a row's New under this: one level down, the row as parent", () => {
    expect(formDefaults({ from: "ahead_row", clientKey: "Northwind", parent: { id: 7, type: "Domain", title: "D" } }, levels, def)).toMatchObject({ type: "Epic", parentId: 7 });
    expect(formDefaults({ from: "ahead_row", clientKey: "Northwind", parent: { id: 8, type: "Capability", title: "C" } }, levels, def)).toMatchObject({ type: "Product Backlog Item", parentId: 8 });
    expect(formDefaults({ from: "breakdown", clientKey: "Northwind", parent: { id: 9, type: "Epic", title: "E" } }, levels, def)).toMatchObject({ type: "Capability", parentId: 9 });
  });
  it("the command menu: the named level when the client has it, else the feature tier", () => {
    expect(formDefaults({ from: "command", clientKey: null, level: "Domain" }, levels, def)).toMatchObject({ type: "Domain", clientKey: null });
    expect(formDefaults({ from: "command", clientKey: "Northwind", level: "Initiative" }, levels, def)).toMatchObject({ type: "Capability" });
  });
  it("Capture: a story or a feature, by its kind", () => {
    expect(formDefaults({ from: "capture", clientKey: "Northwind", title: "T", draftId: 3, level: "story" }, levels, def)).toMatchObject({ type: "Product Backlog Item", title: "T" });
    expect(formDefaults({ from: "capture", clientKey: "Northwind", title: "T", draftId: 3, level: "feature" }, levels, def)).toMatchObject({ type: "Capability" });
  });
  it("levels not read yet: no type", () => {
    expect(formDefaults({ from: "ahead", clientKey: null }, null).type).toBeNull();
  });
  it("a draft is stored at story or feature, with its exact type beside it", () => {
    expect(draftLevelOf(levels, "Domain")).toBe("feature");
    expect(draftLevelOf(levels, "Epic")).toBe("feature");
    expect(draftLevelOf(levels, "Bug")).toBe("story");
  });
});

describe("Ahead shows what I just created, and says which filters would hide it", () => {
  const me = anAssignee("You Person", "you@cooptimize.example");
  const mine = anAheadItem({ id: 10, title: "Mine", assignee: me });
  const made = anAheadItem({ id: 11, title: "Just made", assignee: null });
  const load = anAheadLoad([anAheadClient({ items: [mine, made] })]);
  const f = { ...DEFAULT_FILTERS, owner: { Northwind: "mine" as const } };
  it("Assigned to me hides an unassigned item; keep shows it anyway", () => {
    const ids = (k?: Set<string>) => groups(load, f, { stories: true, ...(k ? { keep: k } : {}) }).flatMap((g) => ("rows" in g ? g.rows : [])).map((r) => r.item.id);
    expect(ids()).not.toContain(11);
    expect(ids(new Set(["Northwind:11"]))).toContain(11);
    expect(hiddenBy(load, f, "Northwind:11")).toEqual(["Assigned to me"]);
    expect(hiddenBy(load, f, "Northwind:10")).toEqual([]);
  });
  it("search and scope are named too", () => {
    expect(hiddenBy(load, { ...DEFAULT_FILTERS, owner: { Northwind: "all" }, q: "zzz" }, "Northwind:11")).toEqual(["Search"]);
    const out = anAheadLoad([anAheadClient({ items: [anAheadItem({ id: 12, inScope: false })] })]);
    expect(hiddenBy(out, { ...DEFAULT_FILTERS, owner: { Northwind: "all" } }, "Northwind:12")).toContain("Cooptimize's scope (Show the whole project)");
  });
});
