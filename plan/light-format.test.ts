import { describe, expect, it } from "vitest";
import { applyMark, editingOf, lightToHtml, sameContent, storedValue } from "./light-format.ts";

const roundTrip = (html: string) => {
  const e = editingOf(html, "html");
  if (!e.editable) throw new Error(`not editable: ${e.why}`);
  return e;
};

describe("light formatting: marks to HTML", () => {
  it("each mark becomes clean HTML", () => {
    expect(lightToHtml("Plain line")).toBe("<div>Plain line</div>");
    expect(lightToHtml("**bold** and *italic*")).toBe("<div><strong>bold</strong> and <em>italic</em></div>");
    expect(lightToHtml("See [the spec](https://example.com/spec)")).toBe('<div>See <a href="https://example.com/spec">the spec</a></div>');
    expect(lightToHtml("# One\n## Two\n### Three")).toBe("<h1>One</h1><h2>Two</h2><h3>Three</h3>");
    expect(lightToHtml("First\n\nSecond")).toBe("<div>First</div><div><br></div><div>Second</div>");
  });
  it("bullets and numbers nest two levels deep, no deeper", () => {
    expect(lightToHtml("- a\n  - b\n- c")).toBe("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
    expect(lightToHtml("1. one\n2. two\n  - sub")).toBe("<ol><li>one</li><li>two<ul><li>sub</li></ul></li></ol>");
    // A third level is written as the second.
    expect(lightToHtml("- a\n  - b\n    - c")).toBe("<ul><li>a<ul><li>b</li><li>c</li></ul></li></ul>");
  });
  it("text that looks like a mark but isn't stays text", () => {
    expect(lightToHtml("2 * 3 = 6")).toBe("<div>2 * 3 = 6</div>");
    expect(lightToHtml("**not closed")).toBe("<div>**not closed</div>");
    expect(lightToHtml("[words](javascript:alert(1))")).toBe("<div>[words](javascript:alert(1))</div>");
    expect(lightToHtml("-no space")).toBe("<div>-no space</div>");
    expect(lightToHtml("#hashtag")).toBe("<div>#hashtag</div>");
    expect(lightToHtml("\\*kept\\*")).toBe("<div>*kept*</div>");
  });
  it("every character typed is escaped, never run as page content", () => {
    const typed = `<script>alert("x")</script> <img src=x onerror=alert(1)> & "quotes" 'single'`;
    const html = lightToHtml(typed);
    expect(html).not.toMatch(/<script|<img/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;quotes&quot;");
    // A link address can't break out of its attribute.
    expect(lightToHtml('[x](https://a.example/"onmouseover="y)')).not.toContain('"onmouseover');
  });
});

describe("light formatting: HTML to text and back", () => {
  it("a simply formatted description survives the round trip unchanged", () => {
    const html = "<div>Customers export orders as <b>CSV</b>.</div><div><br></div><ul><li>By date range</li><li>With <i>totals</i><ul><li>per month</li></ul></li></ul><ol><li>Open orders</li><li>Click Export</li></ol><h2>Notes</h2><div>See <a href=\"https://example.com/x\">the guide</a>.</div>";
    const e = roundTrip(html);
    expect(e.lossy).toBe(false);
    expect(e.text).toBe("Customers export orders as **CSV**.\n\n- By date range\n- With *totals*\n  - per month\n1. Open orders\n2. Click Export\n## Notes\nSee [the guide](https://example.com/x).");
    expect(sameContent(html, storedValue(e.text, "html"), "html")).toBe(true);
  });
  it("plain DevOps divs and paragraphs read as lines", () => {
    expect(roundTrip("<div>One</div><div>Two</div>").text).toBe("One\nTwo");
    expect(roundTrip("<p>One</p><p>Two</p>").text).toBe("One\n\nTwo");
    expect(roundTrip("<div>a<br>b</div>").text).toBe("a\nb");
    expect(roundTrip("").text).toBe("");
  });
  it("text that looks like a mark in HTML is escaped so it stays text", () => {
    const e = roundTrip("<div>- not a bullet</div><div>1. not a number</div><div># not a heading</div><div>a*b*c [x]</div>");
    expect(e.text).toBe("\\- not a bullet\n1\\. not a number\n\\# not a heading\na\\*b\\*c \\[x\\]");
    expect(sameContent("<div>- not a bullet</div><div>1. not a number</div><div># not a heading</div><div>a*b*c [x]</div>", lightToHtml(e.text), "html")).toBe(true);
  });
  it("fonts, sizes and colors are dropped and flagged", () => {
    const e = roundTrip('<div><span style="font-family: Segoe UI; font-size: 14px; color: rgb(0, 0, 0)">Kept words</span></div><div><font color="red">red</font></div>');
    expect(e.lossy).toBe(true);
    expect(e.text).toBe("Kept words\nred");
  });
  it("a table, an image, an embed or a mention is refused", () => {
    expect(editingOf("<table><tr><td>a</td></tr></table>", "html")).toMatchObject({ editable: false, why: "table" });
    expect(editingOf('<div>Look <img src="https://example.com/a.png"></div>', "html")).toMatchObject({ editable: false, why: "image" });
    expect(editingOf('<iframe src="https://example.com"></iframe>', "html")).toMatchObject({ editable: false, why: "embed" });
    expect(editingOf('<div><a href="#" data-vss-mention="version:2.0,abc">@Sam Lee</a> please look</div>', "html")).toMatchObject({ editable: false, why: "mention" });
    expect(editingOf("<div><u>underlined</u></div>", "html")).toMatchObject({ editable: false, why: "other" });
    expect(editingOf("<pre>code</pre>", "html")).toMatchObject({ editable: false, why: "other" });
    expect(editingOf('<div style="text-align: center">centred</div>', "html")).toMatchObject({ editable: false, why: "other" });
    expect(editingOf("<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>", "html")).toMatchObject({ editable: false, why: "other" });
    expect(editingOf("<h4>deep</h4>", "html")).toMatchObject({ editable: false, why: "other" });
  });
  it("a Markdown-stored field is passed through and written back as Markdown", () => {
    const md = "# Plan\n\n- **one**\n- two\n\nSee [x](https://example.com)";
    const e = editingOf(md, "markdown");
    expect(e).toEqual({ editable: true, format: "markdown", text: md, lossy: false });
    expect(storedValue(md + "\n\n", "markdown")).toBe(md);
    expect(editingOf("| a | b |\n|---|---|", "markdown")).toMatchObject({ editable: false, why: "table" });
    expect(editingOf("![pic](https://example.com/a.png)", "markdown")).toMatchObject({ editable: false, why: "image" });
  });
});

describe("format buttons", () => {
  it("wrap a selection and add line marks", () => {
    expect(applyMark("make this bold", 10, 14, "bold")).toEqual({ value: "make this **bold**", start: 12, end: 16 });
    expect(applyMark("a word", 2, 6, "italic").value).toBe("a *word*");
    expect(applyMark("one\ntwo", 0, 7, "bullets").value).toBe("- one\n- two");
    expect(applyMark("- one\n- two", 0, 11, "bullets").value).toBe("one\ntwo");
    expect(applyMark("one\ntwo", 0, 7, "numbers").value).toBe("1. one\n2. two");
    const l = applyMark("see docs", 4, 8, "link");
    expect(l.value).toBe("see [docs](https://)");
    expect(l.value.slice(l.start, l.end)).toBe("https://");
  });
});
