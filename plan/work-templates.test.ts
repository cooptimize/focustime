// TP-1: the four lines, pure: the description built from every mix of lines and choices, the words choices become,
// acceptance and the tag only when they should, reading the lines back (this step's own, with text around, the earlier
// names), the Ready and Missing chip, and an admin's edit (tags kept on rename, add, reorder, remove, the audit lines).
import { describe, expect, it } from "vitest";
import { aBrief } from "../test/builders/index.ts";
import {
  acceptanceText, briefEmpty, briefFromJson, BriefError, checkTemplates, descriptionHtml, descriptionText, fullExample, LINE_KEYS, LINE_NAMES, lineWords, linesHtml, newTag, parseBrief,
  readFilled, readiness, readinessText, readLines, SEED, slugOf, TAG_PATTERN, templateChanges, typeOfTags, typeTag, type WorkTemplates,
} from "./work-templates.ts";

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

describe("what a line's choices become", () => {
  it("What and where: the text, then Environment and Touches", () => {
    expect(lineWords(aBrief({ where: "The Sales model", env: "Test", touches: ["Data", "Model"] }), "where")).toEqual(["The Sales model", "Environment: Test. Touches: Data, Model."]);
  });
  it("How we'll check: the text, then who checks", () => {
    expect(lineWords(aBrief({ check: "October shows 31.2%", checkedBy: { name: "Sam Lee", email: "sam@contoso.example" } }), "check")).toEqual(["October shows 31.2%", "Checked by: Sam Lee."]);
  });
  it("How far: the choices first in plain words, then anything else", () => {
    const b = aBrief({ doneWhen: "Published", signedOffBy: { name: "the finance lead", email: null }, notWithout: ["Deploy to production", "Rerun or reload data"], done: "Reviewed in test first." });
    expect(lineWords(b, "done")).toEqual(["Done when it is: published. Signed off by: the finance lead. Not without asking: deploy to production, rerun or reload data.", "Reviewed in test first."]);
  });
  it("keeps words that are all capitals as typed", () => {
    expect(lineWords(aBrief({ doneWhen: "SQL deployed" }), "done")).toEqual(["Done when it is: SQL deployed."]);
  });
});

describe("the description a create writes", () => {
  it("nothing: null", () => {
    expect(descriptionHtml(null, null)).toBeNull();
    expect(descriptionHtml("  ", aBrief())).toBeNull();
  });
  it("only the typed description, as DevOps keeps plain text", () => {
    expect(descriptionHtml("Line one\nLine two", null)).toBe("<div>Line one</div><div>Line two</div>");
  });
  it("only some lines: the empty ones are left out, the rest in order under their headings", () => {
    const html = descriptionHtml(null, aBrief({ check: "One <row>", where: "Orders report" }))!;
    expect(html).toBe("<h3>What and where</h3><p>Orders report</p><h3>How we&#39;ll check</h3><p>One &lt;row&gt;</p>".replace("&#39;", "'"));
  });
  it("a line with only choices has its heading and the choices", () => {
    expect(linesHtml(aBrief({ env: "Production" }))).toBe("<h3>What and where</h3><p>Environment: Production.</p>");
  });
  it("the typed description first, then the four lines; newlines kept", () => {
    const b = aBrief({ where: "A\nB", change: "C", check: "D", doneWhen: "Built" });
    const html = descriptionHtml("Mine", b)!;
    expect(html.startsWith("<div>Mine</div><h3>What and where</h3><p>A<br>B</p>")).toBe(true);
    expect(descriptionText("Mine", b)).toBe("Mine\n\nWhat and where\nA\nB\n\nWhat changes\nC\n\nHow we'll check\nD\n\nHow far and who signs off\nDone when it is: built.");
  });
});

describe("acceptance and the tag", () => {
  it("acceptance only when How we'll check has text, with who checks", () => {
    expect(acceptanceText(null)).toBeNull();
    expect(acceptanceText(aBrief({ checkedBy: { name: "Sam", email: null } }))).toBeNull();
    expect(acceptanceText(aBrief({ check: "October: 31.2%" }))).toBe("October: 31.2%");
    expect(acceptanceText(aBrief({ check: "October: 31.2%", checkedBy: { name: "Sam", email: null } }))).toBe("October: 31.2%\nChecked by: Sam.");
  });
  it("the tag only when a type is chosen", () => {
    expect(typeTag(SEED, aBrief())).toBeNull();
    expect(typeTag(SEED, aBrief({ type: "new-measure" }))).toBe("type:new-measure");
  });
});

describe("reading the four lines back", () => {
  const b = aBrief({ type: "new-measure", where: "Sales model", change: "Margin percent", check: "Oct: 31.2%", doneWhen: "In test", signedOffBy: { name: "the finance lead", email: null } });
  it("out of a description this step wrote, with the typed text kept as the rest", () => {
    const r = readLines(descriptionHtml("Context first", b));
    expect(r.found).toBe(true);
    expect(r.lines).toEqual({ where: "Sales model", change: "Margin percent", check: "Oct: 31.2%", done: "Done when it is: in test. Signed off by: the finance lead." });
    expect(r.rest).toBe("<div>Context first</div>");
    expect(readFilled(r)).toEqual({ where: true, change: true, check: true, done: true });
  });
  it("out of one with other text around them and another heading after", () => {
    const html = `<p>Intro</p><p><b>What and where:</b></p><div>The orders table</div><h2>Notes</h2><p>Later</p><p><strong>What changes</strong></p><p>Add a column</p>`;
    const r = readLines(html);
    expect(r.lines.where).toBe("The orders table");
    expect(r.lines.change).toBe("Add a column");
    expect(r.rest).toBe("<p>Intro</p><h2>Notes</h2><p>Later</p>");
  });
  it("out of one using the earlier names, where Boundary's text counts as How far", () => {
    const r = readLines("<h3>Target</h3><p>Sales model</p><h3>Change</h3><p>x</p><h3>Control</h3><p>y</p><h3>Boundary</h3><p>Test only</p>");
    expect(r.earlier).toBe(true);
    expect(readiness(r, null)).toEqual({ ready: true });
  });
  it("a description with no headings reads nothing", () => {
    const r = readLines("<div>Just words about the target</div>");
    expect(r).toEqual({ lines: {}, found: false, earlier: false, rest: "<div>Just words about the target</div>" });
  });
});

describe("the Ready and Missing chip", () => {
  const mk = (b: Partial<Parameters<typeof aBrief>[0]>) => readLines(descriptionHtml(null, aBrief(b)));
  it("Ready when all four have something", () => {
    expect(readiness(mk({ where: "a", change: "b", check: "c", doneWhen: "Built" }), null)).toEqual({ ready: true });
  });
  it("How far counts only once Done when it is is chosen", () => {
    const x = readiness(mk({ where: "a", change: "b", check: "c", done: "Some words", signedOffBy: { name: "Sam", email: null } }), null)!;
    expect(readinessText(x)).toBe("Missing: How far and who signs off");
  });
  it("names every empty line", () => {
    expect(readinessText(readiness(mk({ where: "a", doneWhen: "Built" }), null)!)).toBe("Missing: What changes, How we'll check");
  });
  it("a type tag and no headings: all four are missing", () => {
    const t = typeOfTags(SEED, ["Blocked", "Type:New-Measure"]);
    expect(t?.name).toBe("New measure");
    expect(readinessText(readiness(readLines(""), t)!)).toBe("Missing: What and where, What changes, How we'll check, How far and who signs off");
  });
  it("no chip on an item with neither headings nor a known tag", () => {
    expect(readiness(readLines("<p>Hello</p>"), typeOfTags(SEED, ["type:someone-elses", "Blocked"]))).toBeNull();
  });
});

describe("a brief from the client", () => {
  it("everything optional; an empty one is no brief", () => {
    expect(parseBrief(undefined, SEED)).toBeNull();
    expect(parseBrief({ where: "  " }, SEED)).toBeNull();
    expect(briefEmpty(aBrief())).toBe(true);
  });
  it("refuses an unknown type, field or a too-long line", () => {
    expect(() => parseBrief({ type: "not-a-type" }, SEED)).toThrow(BriefError);
    expect(() => parseBrief({ title: "x" }, SEED)).toThrow(/unknown field title/);
    expect(() => parseBrief({ where: "x".repeat(2001) }, SEED)).toThrow(/at most 2000/);
  });
  it("Other choices are kept as typed; duplicates dropped", () => {
    expect(parseBrief({ env: "  QA  box ", touches: ["Data", "data", "Notebook"] }, SEED)).toMatchObject({ env: "QA box", touches: ["Data", "Notebook"] });
  });
  it("a draft's JSON keeps a removed or unknown type as it was", () => {
    expect(briefFromJson(JSON.stringify(aBrief({ type: "gone-type", where: "x" })), SEED)).toMatchObject({ type: "gone-type", where: "x" });
    expect(briefFromJson("not json", SEED)).toBeNull();
  });
  it("the full example fills every line", () => {
    const { brief } = fullExample(SEED, "new-measure");
    expect(readiness(readLines(descriptionHtml(null, brief)), null)).toEqual({ ready: true });
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
