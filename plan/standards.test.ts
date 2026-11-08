// KB-1: Coop's contract, retrieval and what is done to an answer. Pure.
import { describe, expect, it } from "vitest";
import { articleVerdict, isArticlePath, parseFrontMatter, type StandardsArticle } from "./standards.ts";
import { GENERATED_LAYER_NOTE, linkAcceptance, NOT_IN_STANDARDS, parseRepoUrl, quoteIsIn, retrieveStandards, rewordGeneratedLayer, servesSources, shapeItem, splitOverrides, standardsInput, standardsReply, titleIndex, usedLine, usedOf, validBranch, type StandardsLibrary } from "./standards.ts";
import { STD_COMMIT, STD_FILES, STD_REPO, aStandardsArticle } from "../test/builders/standards.ts";

const articles: StandardsArticle[] = Object.entries(STD_FILES).flatMap(([path, text]) => {
  const v = isArticlePath(path) ? articleVerdict(text) : { kind: "skip" as const };
  return v.kind === "active" ? [{ ...v.fields, path, sha256: "0".repeat(64), commit: STD_COMMIT, body: v.body }] : [];
});
const lib: StandardsLibrary = { repo: STD_REPO, commit: STD_COMMIT, articles };
const titles = (r: { included: { article: { title: string } }[] }) => r.included.map((m) => m.article.title);
const find = (text: string, o: Partial<Parameters<typeof retrieveStandards>[1]> = {}) => retrieveStandards(articles, { text: [text], dataPlatform: null, sourceSystems: [], ...o });

describe("Coop's contract", () => {
  it.each([["SQL/Gold/Fact Tables.md", true], ["Power BI/File Types.md", true], ["Source Systems/D365 Exports.md", true], ["New Domain/Thing.md", true], ["deprecation/x.md", false], ["standards/sql.md", false], ["scripts/assemble.py", false], ["scripts/notes.md", false], ["standards.yml", false], ["README.md", false], ["AGENTS.md", false], [".obsidian/a.md", false], ["SQL/.hidden/a.md", false]])("%s: %s", (p, ok) => expect(isArticlePath(p)).toBe(ok));

  it("needs status: active and complete front matter", () => {
    expect(articleVerdict("# nothing").kind).toBe("skip");
    expect(articleVerdict("---\nstatus: draft\n---\nx").kind).toBe("skip");
    expect(articleVerdict("---\ntitle: T\nstatus: active\n---\nx")).toMatchObject({ kind: "incomplete", missing: ["id", "domain", "layer", "artifact", "technology"] });
  });

  it("reads front matter as plain strings only, CRLF and quotes included", () => {
    expect(parseFrontMatter('---\r\nid: "abc"\r\nnot_known: x\r\n---\r\nbody')).toEqual({ fields: { id: "abc" }, body: "body" });
    expect(parseFrontMatter("---\nid: x\nno closing fence")).toBeNull();
  });

  it("takes only a GitHub repo address and a sane branch", () => {
    expect(parseRepoUrl("https://github.com/cooptimize/coop-standards")).toEqual({ owner: "cooptimize", repo: "coop-standards" });
    expect(parseRepoUrl("https://github.com/a/b.git/")).toEqual({ owner: "a", repo: "b" });
    for (const bad of ["http://github.com/a/b", "https://evil.example/a/b", "https://github.com/a", "https://github.com/a/b/c", "https://github.com/../b"]) expect(parseRepoUrl(bad)).toBeNull();
    expect(validBranch("")).toBe(true);
    expect(validBranch("feature/x")).toBe(true);
    expect(validBranch("../x")).toBe(false);
  });
});

describe("retrieval", () => {
  it("a Gold fact feature pulls Gold Fact Tables and the general SQL articles, not Power BI", () => {
    const t = titles(find("Build the Gold fact for sales orders"));
    expect(t).toEqual(expect.arrayContaining(["Gold Fact Tables", "SQL Conventions", "SQL Layout"]));
    expect(t.indexOf("Gold Fact Tables")).toBe(0);
    expect(t.some((x) => x.startsWith("Power BI"))).toBe(false);
  });

  it("a semantic model feature pulls the semantic-model articles", () => {
    const t = titles(find("Build the semantic model for finance"));
    expect(t).toEqual(expect.arrayContaining(["Power BI Fact Tables", "Power BI DAX"]));
    expect(t.some((x) => x.startsWith("Gold"))).toBe(false);
  });

  it("matches the parent's title and exact keys in snake_case or spaces", () => {
    expect(titles(retrieveStandards(articles, { text: ["Add margin", "Parent: Gold dimension tables"], dataPlatform: null, sourceSystems: [] }))).toContain("Gold Dimension Tables");
    expect(titles(find("stored_procedure and fact_table in gold"))).toContain("Gold Fact Tables");
  });

  it("a Fabric client adds Fabric Warehouse once the work is SQL; another platform doesn't", () => {
    expect(titles(find("Gold fact table", { dataPlatform: "fabric" }))).toContain("Fabric Warehouse Target");
    expect(titles(find("Gold fact table", { dataPlatform: "azure" }))).not.toContain("Fabric Warehouse Target");
    expect(titles(find("Gold fact table warehouse", { dataPlatform: "azure" }))).not.toContain("Fabric Warehouse Target");
    expect(titles(find("Update the onboarding doc", { dataPlatform: "fabric" }))).toEqual([]);
  });

  it("source systems select the right D365 articles, d365 serves both, None excludes them", () => {
    const sql = "Gold fact table";
    expect(titles(find(sql, { sourceSystems: ["d365_fo"] }))).toEqual(expect.arrayContaining(["D365 Finance and Operations Source Tables", "D365 Exports"]));
    expect(titles(find(sql, { sourceSystems: ["d365_fo"] }))).not.toContain("D365 Dataverse Source Tables");
    expect(titles(find(sql, { sourceSystems: ["d365_dataverse"] }))).toEqual(expect.arrayContaining(["D365 Dataverse Source Tables", "D365 Exports"]));
    expect(titles(find(sql, { sourceSystems: null }))).toEqual(expect.arrayContaining(["D365 Finance and Operations Source Tables", "D365 Dataverse Source Tables"]));
    expect(titles(find(sql, { sourceSystems: [] })).some((t) => t.startsWith("D365"))).toBe(false);
    expect(titles(find("Fix the d365_fo source_table export", { sourceSystems: [] })).some((t) => t.startsWith("D365"))).toBe(false);
    expect(servesSources("d365", [])).toBe(false);
  });

  it("source-system articles ride only on SQL or model work, or when named", () => {
    expect(titles(find("Plan the kickoff", { sourceSystems: null }))).toEqual([]);
    expect(titles(find("Check the d365_fo source tables", { sourceSystems: null }))).toContain("D365 Finance and Operations Source Tables");
  });

  it("an ordinary word doesn't bring a domain in: a customer view isn't Gold Views", () => {
    expect(titles(find("Add a customer view and a new visual to the portal page"))).toEqual([]);
  });

  it("keeps the narrowest scope inside the budget and lists what was left out", () => {
    const big = (title: string, o: Partial<StandardsArticle>) => aStandardsArticle({ title, body: "x".repeat(4000), ...o });
    const lib2 = [big("General One", {}), big("Layer One", { layer: "gold", artifact: "view" }), big("Exact One", { layer: "gold", artifact: "fact_table" })];
    const r = retrieveStandards(lib2, { text: ["gold fact table"], dataPlatform: null, sourceSystems: [], budget: 2200 });
    expect(titles(r)).toEqual(["Exact One", "Layer One"]);
    expect(r.leftOut.map((m) => m.article.title)).toEqual(["General One"]);
    expect(r.tokens).toBeLessThanOrEqual(2200);
    expect(r.included[0]!.scope).toBe("artifact");
    expect(r.included[1]!.scope).toBe("layer");
  });

  it("always has the title index, with no article text", () => {
    const r = find("nothing here");
    const input = standardsInput(articles, r);
    expect(input.index).toHaveLength(articles.length);
    expect(input.index[0]).toEqual({ title: expect.any(String), domain: expect.any(String), layer: expect.any(String), artifact: expect.any(String) });
    expect(titleIndex(articles).some((x) => JSON.stringify(x).includes("PascalCase"))).toBe(false);
    expect(input.articles).toEqual([]);
  });

  it("puts a whole domain in when it has fewer than three articles", () => {
    const few = [aStandardsArticle({ title: "Alpha Rules", domain: "python", artifact: "script", path: "Python/Alpha.md" }), aStandardsArticle({ title: "Beta Rules", domain: "python", artifact: "notebook", path: "Python/Beta.md" })];
    expect(titles(retrieveStandards(few, { text: ["python notebook"], dataPlatform: null, sourceSystems: [] }))).toEqual(["Beta Rules", "Alpha Rules"]);
  });

  it("drops email addresses from article text", () => {
    const a = aStandardsArticle({ title: "Gold Fact Tables", layer: "gold", artifact: "fact_table", body: "Ask someone@outside.example first" });
    const r = retrieveStandards([a], { text: ["gold fact table"], dataPlatform: null, sourceSystems: [] });
    expect(JSON.stringify(standardsInput([a], r))).not.toContain("someone@outside.example");
  });
});

describe("what is done to an answer", () => {
  const used = usedOf(lib, find("Gold fact table"));
  const url = `https://github.com/contoso/standards/blob/${STD_COMMIT}/SQL/Gold/Fact%20Tables.md`;

  it("links a citation at the synced commit, whatever link the model wrote", () => {
    expect(linkAcceptance("Follows Gold Fact Tables: fact schema, PascalCase, FK{Dimension} keys", used.used)).toBe(`Follows Gold Fact Tables: fact schema, PascalCase, FK{Dimension} keys (${url})`);
    expect(linkAcceptance("- Follows Gold Fact Tables: x (https://example.com/made-up)", used.used)).toBe(`- Follows Gold Fact Tables: x (${url})`);
    expect(linkAcceptance("Exports match the source", used.used)).toBe("Exports match the source");
  });

  it("drops a citation of a standard it wasn't given, keeps ordinary Follows lines", () => {
    expect(linkAcceptance("Follows Made Up Standard: be nice", used.used)).toBeNull();
    expect(linkAcceptance("Follows the standard for naming", used.used)).toBeNull();
    expect(linkAcceptance("Follows the existing layout", used.used)).toBe("Follows the existing layout");
  });

  it.each([["Write Silver SQL for CustTable", "Configure or regenerate Silver for CustTable"], ["Hand-write Bronze SQL", "Configure or regenerate Bronze"], ["Create the Silver tables for sales", "Configure or regenerate Silver for sales"], ["Alter Silver view definitions", "Configure or regenerate Silver definitions"]])("%s", (from, to) => {
    expect(rewordGeneratedLayer(from)).toEqual({ text: to, changed: true });
  });

  it.each(["Create fact.Sales from Silver tables", "Build Gold fact from Silver SQL", "Regenerate Silver tables", "Configure Silver for CustTable", "Write Gold SQL"])("leaves %s", (t) => expect(rewordGeneratedLayer(t).changed).toBe(false));

  it("shapes a whole item", () => {
    const x = shapeItem({ title: "Write Silver SQL for sales", description: "Then write Silver SQL again", acceptance: ["Follows Gold Fact Tables: fact schema", "Follows Nope: x"] }, used.used);
    expect(x.title).toBe("Configure or regenerate Silver for sales");
    expect(x.acceptance).toEqual([`Follows Gold Fact Tables: fact schema (${url})`]);
    expect(x.changed).toBe(true);
    expect(GENERATED_LAYER_NOTE).toMatch(/generated/);
  });

  it("lifts client overrides out of the rationale", () => {
    expect(splitOverrides("Why these.\nClient override: Gold Fact Tables: the client wants snake_case")).toEqual({ rest: "Why these.", overrides: ["Client override: Gold Fact Tables: the client wants snake_case"] });
  });

  it("says what was used with the short commit", () => expect(usedLine(used)).toMatch(/^Standards used: Gold Fact Tables.*\(commit 0123456\)$/));
});

describe("Ask's answer", () => {
  const r = find("fact table naming");
  const good = { found: true, article_title: "Gold Fact Tables", answer: "Use the fact schema and PascalCase.", quote: "Use fact and PascalCase table and column names." };
  it("shows the rule, the quote and the link", () => {
    expect(standardsReply(good, lib, r)).toMatchObject({ found: true, title: "Gold Fact Tables", url: expect.stringContaining(`/blob/${STD_COMMIT}/SQL/Gold/Fact%20Tables.md`) });
  });
  it("is Not in the standards when the model says so, or cites anything it wasn't given", () => {
    expect(standardsReply({ found: false, article_title: null, answer: "", quote: "" }, lib, r)).toEqual({ found: false, text: NOT_IN_STANDARDS });
    expect(standardsReply({ ...good, article_title: "Invented Article" }, lib, r).found).toBe(false);
  });
  it("is Not in the standards when the quote isn't in the article", () => {
    expect(standardsReply({ ...good, quote: "Always use snake_case." }, lib, r).found).toBe(false);
    expect(quoteIsIn("Use **fact**  and PascalCase", "Use `fact` and PascalCase table")).toBe(true);
  });
});
