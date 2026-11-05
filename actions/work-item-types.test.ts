// CV-1 on WT-1's model: the draft offers only the valid child types under the suggested parent, the most common first;
// the write path accepts a chosen type only where the process puts it.
import { describe, expect, it } from "vitest";
import { buildProcessModel } from "../plan/process.ts";
import { aClientProcess, anInternalProcess } from "../test/builders/index.ts";
import { typeChoices, typeInfo } from "./work-item-types.ts";

const client = buildProcessModel(aClientProcess());
const internal = buildProcessModel(anInternalProcess());
const [epic, feature] = [client.levels.top[0]!, client.levels.parent[0]!];
const story = client.levels.child[0]!;
const bug = client.types.find((t) => t.bug)!.name;

describe("typeChoices", () => {
  it("under a feature: its valid children only, the most common default", () => {
    const r = typeChoices(client, { parentType: feature, level: "story" });
    expect(r.choices.map((c) => c.type)).toEqual(client.types.find((t) => t.name === feature)!.validChildren);
    expect(r.type).toBe(story);
  });
  it("under an epic: the most common child from history, never a type outside its children", () => {
    const r = typeChoices(client, { parentType: epic, level: "story" });
    expect(r.choices.map((c) => c.type)).toEqual(client.levels.parent);
    expect(r.type).toBe(feature);
    // The internal process's top level has three parent types; history says the first is most common.
    const top = internal.levels.top.find((t) => internal.types.find((x) => x.name === t)?.history)!;
    const ri = typeChoices(internal, { parentType: top, level: "feature" });
    expect(ri.choices[0]!.type).toBe(ri.type);
    expect(ri.choices.map((c) => c.type).sort()).toEqual([...internal.levels.parent].sort());
  });
  it("a bug draft with no bug type under the parent falls back to the most common child", () => {
    expect(typeChoices(client, { parentType: feature, level: "bug" }).type).toBe(story);
  });
  it("no model: no choices", () => expect(typeChoices(null, { parentType: null, level: "story" })).toEqual({ choices: [], type: null }));
});

describe("typeInfo (write path, process configuration)", () => {
  const pc = { portfolioBacklogs: [{ workItemTypes: [{ name: epic }] }, { workItemTypes: [{ name: feature }], defaultWorkItemType: { name: feature } }], requirementBacklog: { workItemTypes: [{ name: story }], defaultWorkItemType: { name: story } }, bugWorkItems: { workItemTypes: [{ name: bug }] } };
  it("defaults per level", () => {
    expect(typeInfo(pc, "story")).toEqual({ type: story, level: "story" });
    expect(typeInfo(pc, "feature")).toEqual({ type: feature, level: "feature" });
    expect(typeInfo(pc, "bug")).toEqual({ type: bug, level: "bug" });
  });
  it("a chosen type must go under the parent", () => {
    expect(typeInfo(pc, "story", { type: story, parentType: feature })).toEqual({ type: story, level: "story" });
    expect(typeInfo(pc, "story", { type: feature, parentType: feature })).toBeNull();
    expect(typeInfo(pc, "story", { type: feature, parentType: epic })).toEqual({ type: feature, level: "feature" });
  });
});
