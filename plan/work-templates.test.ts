// TP-1's work templates, pure, as TP-1b keeps them for later: the seed, an item's request type tag read back, and an
// admin's edit (tags kept on rename, add, reorder, remove, the audit lines, the refusals). TP-1b took out the four lines'
// writing, reading and readiness; what a create writes now is plan/three-questions.test.ts.
import { describe, expect, it } from "vitest";
import { checkTemplates, LINE_KEYS, LINE_NAMES, newTag, SEED, slugOf, TAG_MAX, TAG_PATTERN, templateChanges, typeOfTags, type WorkTemplates } from "./work-templates.ts";

const clone = (t: WorkTemplates): WorkTemplates => JSON.parse(JSON.stringify(t)) as WorkTemplates;

describe("the seed", () => {
  it("has the four names in order, a generic template and every type's tag from its name", () => {
    expect(LINE_KEYS.map((k) => LINE_NAMES[k])).toEqual(["What and where", "What changes", "How we'll check", "How far and who signs off"]);
    expect(SEED.types.length).toBe(14);
    for (const t of SEED.types) {
      expect(t.tag).toBe(slugOf(t.name));
      expect(TAG_PATTERN.test(t.tag)).toBe(true);
      for (const k of LINE_KEYS) expect(t.lines[k].hint).not.toBe("");
    }
    expect(SEED.lists.doneWhen).toEqual(["Built", "In test", "Published", "Signed off"]);
  });
  it("tags never hold what DevOps tags can't (a ; , or @), whatever the name", () => {
    expect(slugOf("Data; fix, @now")).toBe("data-fix-now");
    expect(slugOf("Café réport")).toBe("cafe-report");
    expect(newTag("New measure", ["new-measure", "new-measure-2"])).toBe("new-measure-3");
    expect(newTag("!!!", [])).toBe("type");
  });
});

describe("an item's request type tag", () => {
  it("names the type, removed ones too, whatever the case; other tags and unknown types name none", () => {
    expect(typeOfTags(SEED, ["Blocked", " TYPE:New-Measure "])?.name).toBe("New measure");
    const gone = checkTemplates({ ...clone(SEED), types: clone(SEED).types.filter((t) => t.id !== "deployment") }, SEED);
    expect(typeOfTags(gone, ["type:deployment"])?.removed).toBe(true);
    expect(typeOfTags(SEED, ["type:unknown-one", "Blocked"])).toBeNull();
    expect(typeOfTags(SEED, null)).toBeNull();
  });
});

describe("an admin's edit", () => {
  it("a rename keeps the tag", () => {
    const next = clone(SEED);
    next.types[0]!.name = "Tweak";
    const saved = checkTemplates(next, SEED);
    expect(saved.types[0]).toMatchObject({ id: "small-change", name: "Tweak", tag: "small-change" });
    expect(templateChanges(SEED, saved)).toEqual([{ target: "Tweak", setting: "Name", oldValue: "Small change", newValue: "Tweak" }]);
  });
  it("a tag sent by the client is ignored: the saved one stays", () => {
    const next = clone(SEED);
    next.types[0]!.tag = "evil;tag";
    expect(checkTemplates(next, SEED).types[0]!.tag).toBe("small-change");
  });
  it("add, reorder and remove a type, each on its own audit line", () => {
    const next = clone(SEED);
    const [first, second] = next.types;
    next.types.splice(0, 2, second!, first!);
    next.types.push({ ...clone(SEED).types[0]!, id: "", name: "Report fix", tag: "" });
    next.types = next.types.filter((t) => t.id !== "performance");
    const saved = checkTemplates(next, SEED);
    expect(saved.types.find((t) => t.name === "Report fix")?.tag).toBe("report-fix");
    expect(saved.types.find((t) => t.id === "performance")).toMatchObject({ removed: true, name: "Performance" });
    const lines = templateChanges(SEED, saved);
    expect(lines.map((l) => `${l.target}: ${l.setting}`)).toEqual(["Report fix: Added", "Performance: Removed", "Types: Order"]);
  });
  it("add, rename and remove a choice", () => {
    const next = clone(SEED);
    next.lists.environments = ["Dev", "Test", "Production", "Sandbox"];
    const saved = checkTemplates(next, SEED);
    expect(templateChanges(SEED, saved)).toEqual([{ target: "Choice lists", setting: "Environment", oldValue: "Development, Test, Production", newValue: "Dev, Test, Production, Sandbox" }]);
  });
  it("refuses two types with one name, an empty name, a duplicate choice and an unknown story", () => {
    const dup = clone(SEED);
    dup.types[1]!.name = "small CHANGE";
    expect(() => checkTemplates(dup, SEED)).toThrow(/Two types are called/);
    const empty = clone(SEED);
    empty.types[0]!.name = " ";
    expect(() => checkTemplates(empty, SEED)).toThrow(/can't be empty/);
    const twice = clone(SEED);
    twice.lists.touches = ["Data", "data"];
    expect(() => checkTemplates(twice, SEED)).toThrow(/twice/);
    const story = clone(SEED);
    (story.types[0]!.stories as string[]) = ["Lunch"];
    expect(() => checkTemplates(story, SEED)).toThrow(/typical stories/);
  });
  it("a removed type's tag is never reused by a new one", () => {
    const gone = checkTemplates({ ...clone(SEED), types: clone(SEED).types.filter((t) => t.id !== "deployment") }, SEED);
    const again = clone(gone);
    again.types.push({ ...again.types[0]!, id: "", name: "Deployment", tag: "", removed: false });
    expect(checkTemplates(again, gone).types.find((t) => t.name === "Deployment" && !t.removed)?.tag).toBe("deployment-2");
  });
});

describe("TP-1 review fixes", () => {
  it("a long name's numbered tag still matches the pattern", () => {
    const name = "a".repeat(37) + " b";
    const first = newTag(name, []);
    const second = newTag(name, [first]);
    expect(second).toMatch(TAG_PATTERN);
    expect(second.length).toBeLessThanOrEqual(TAG_MAX);
  });
  it("a choice can't hold a comma or a semicolon (each goes on its own line)", () => {
    const next = JSON.parse(JSON.stringify(SEED)) as WorkTemplates;
    next.lists.touches = ["Data, Model"];
    expect(() => checkTemplates(next, SEED)).toThrow(/comma or semicolon/);
  });
});

