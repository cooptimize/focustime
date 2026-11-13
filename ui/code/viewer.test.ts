// RB-1 4b: each language is picked from its name (or first lines); coloring returns exactly the file's characters and
// never page markup; TMDL colors a table, a column, a measure with DAX and a partition with M; Format lays out squashed
// JSON without changing a value and leaves broken JSON alone; a large file is shown plain.
import { describe, expect, it } from "vitest";
import { languageOf, tooLargeToColor, COLOR_MAX_LINES, type Lang } from "./languages.ts";
import { colorize, pieces, textOf, type Line } from "./highlight.ts";
import { formatJson, looksSquashed } from "./format.ts";

const kindsOf = (lines: Line[], text: string) => lines.flat().filter((s) => s.text.includes(text)).map((s) => s.kinds ?? []);

describe("languages", () => {
  it.each<[string, Lang]>([
    ["vSales.sql", "sql"],
    ["Warehouse.sqlproj", "xml"],
    ["pipeline-content.json", "json"],
    [".platform", "json"],
    ["definition.pbir", "json"],
    ["Sales.tmdl", "tmdl"],
    ["measures.dax", "dax"],
    ["query.pq", "powerquery"],
    ["notebook-content.py", "python"],
    ["azure-pipelines.yml", "yaml"],
    ["a.yaml", "yaml"],
    ["model.xml", "xml"],
    ["Deploy.ps1", "powershell"],
    ["README.md", "markdown"],
    ["logo.svg", "xml"],
    ["notes.txt", "plain"],
    ["Makefile", "plain"],
  ])("%s is %s", (name, lang) => expect(languageOf(name)).toBe(lang));
  it("a file with no telling name by its first lines", () => {
    expect(languageOf("LICENSE", "SELECT 1")).toBe("sql");
    expect(languageOf("data", '{"a":1}')).toBe("json");
    expect(languageOf("model", "table Sales\n\tlineageTag: x\n")).toBe("tmdl");
    expect(languageOf("cell", "# Fabric notebook source\n")).toBe("python");
    expect(languageOf("thing", "<?xml version='1.0'?><a/>")).toBe("xml");
    expect(languageOf("notes", "just words")).toBe("plain");
  });
});

const SAMPLES: [string, Lang][] = [
  ["CREATE VIEW dbo.v AS SELECT a, 'x' FROM t -- c\nWHERE b = 1;\n", "sql"],
  ['{"a": [1, 2.50, true, null], "b": "<script>alert(1)</script>"}\n', "json"],
  ["a:\n  - b: 'c' # d\n", "yaml"],
  ['<?xml version="1.0"?>\n<a b="c"><!-- d --><script>alert(1)</script></a>\n', "xml"],
  ["param([string] $A)\nWrite-Host \"$A\" # c\n", "powershell"],
  ["# T\n\n- a `b` <img src=x onerror=alert(1)>\n", "markdown"],
  ["def f(x):\n    return x + 1  # c\n", "python"],
  ["CALCULATE ( [Total], 'Date'[Year] = 2024 )", "dax"],
  ['let\n    S = Sql.Database("a", "b")\nin\n    S', "powerquery"],
];

describe("coloring", () => {
  it.each(SAMPLES)("returns exactly the file's characters, in order (%#)", (text, lang) => {
    expect(textOf(colorize(text, lang))).toBe(text);
  });
  it("draws page markup and script as characters: nothing becomes markup", () => {
    const html = '<!doctype html><img src=x onerror="alert(1)"><script>document.body.dataset.ran="yes"</script>';
    const lines = colorize(html, "xml");
    expect(textOf(lines)).toBe(html);
    // The output is only strings and token names: no element, no HTML string to set as markup.
    for (const s of lines.flat()) {
      expect(typeof s.text).toBe("string");
      for (const k of s.kinds ?? []) expect(k).toMatch(/^[a-z-]+$/);
    }
  });
  it("TMDL: a table with a column, a measure in DAX and a partition in M", () => {
    const tmdl = "/// Sales lines\ntable Sales\n\tlineageTag: abc\n\n\tmeasure 'Total Sales' = SUM ( Sales[Amount] )\n\t\tformatString: 0.00\n\n\tmeasure YTD =\n\t\t\tCALCULATE (\n\t\t\t\t[Total Sales],\n\t\t\t\tDATESYTD ( 'Date'[Date] )\n\t\t\t)\n\t\tdisplayFolder: Revenue\n\n\tcolumn Amount\n\t\tdataType: decimal\n\t\tisHidden\n\n\tpartition Sales = m\n\t\tmode: import\n\t\tsource =\n\t\t\t\tlet\n\t\t\t\t    Source = Sql.Database(\"s\", \"d\")\n\t\t\t\tin\n\t\t\t\t    Source\n\n\tannotation PBI_ResultType = Table\n";
    const lines = colorize(tmdl, "tmdl");
    expect(textOf(lines)).toBe(tmdl);
    expect(kindsOf(lines, "table")[0]).toContain("keyword");
    expect(kindsOf(lines, "Sales").some((k) => k.includes("class-name"))).toBe(true);
    expect(kindsOf(lines, "measure")[0]).toContain("keyword");
    expect(kindsOf(lines, "column")[0]).toContain("keyword");
    expect(kindsOf(lines, "partition")[0]).toContain("keyword");
    expect(kindsOf(lines, "dataType")[0]).toContain("property");
    expect(kindsOf(lines, "/// Sales lines")[0]).toContain("comment");
    // DAX: SUM and CALCULATE are DAX functions; M: "let" and "in" are Power Query keywords, Sql.Database a function.
    expect(kindsOf(lines, "SUM").flat()).toEqual(expect.arrayContaining([expect.stringMatching(/function/)]));
    expect(kindsOf(lines, "CALCULATE").flat()).toEqual(expect.arrayContaining([expect.stringMatching(/function/)]));
    expect(kindsOf(lines, "let").flat()).toContain("keyword");
    expect(kindsOf(lines, "Sql.Database").flat().join(" ")).toMatch(/function/);
    expect(kindsOf(lines, '"s"').flat().join(" ")).toMatch(/string/);
    // The demo's own model files keep every character too.
    expect(textOf(colorize("model Model\n\tculture: en-US\n\nref table Sales\n", "tmdl"))).toBe("model Model\n\tculture: en-US\n\nref table Sales\n");
  });
  it("a file past 5,000 lines or 300 KB is shown plain", () => {
    expect(tooLargeToColor("a\n".repeat(COLOR_MAX_LINES + 1))).toBe(true);
    expect(tooLargeToColor("x".repeat(300 * 1024 + 1))).toBe(true);
    expect(tooLargeToColor("SELECT 1")).toBe(false);
  });
  it("the token tree has no HTML", () => {
    expect(JSON.stringify(pieces("<b>x</b>", "xml"))).not.toMatch(/<span|class=/);
  });
});

describe("Format", () => {
  it("lays out squashed JSON, changing only whitespace outside strings", () => {
    const squashed = JSON.stringify({ a: [1, 2], b: { c: "x, y: {z}", d: [] }, e: {} }).replace("1,", "1.0,").replace("2]", "12345678901234567890]");
    expect(looksSquashed(squashed + " ".repeat(500))).toBe(true);
    const f = formatJson(squashed);
    expect(f).toEqual({ ok: true, text: '{\n  "a": [\n    1.0,\n    12345678901234567890\n  ],\n  "b": {\n    "c": "x, y: {z}",\n    "d": []\n  },\n  "e": {}\n}' });
    expect((f as { text: string }).text.replace(/\s/g, "")).toBe(squashed.replace(/\s/g, ""));
  });
  it("leaves broken JSON alone with a plain reason", () => {
    expect(formatJson('{"a": 1,')).toMatchObject({ ok: false, reason: expect.stringMatching(/^This isn't valid JSON.*shown as it is\.$/) });
  });
  it("a normal file isn't squashed", () => {
    expect(looksSquashed('{\n  "a": 1\n}\n')).toBe(false);
  });
});
