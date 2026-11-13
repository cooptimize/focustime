// U6: the shared planning pieces render one way wherever they are used (WD-1: the Add work panel and the pick rows).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddSection, BoxHint } from "./AddPane.tsx";
import { FoldLine } from "./FoldLine.tsx";
import { PlanRow } from "./PlanRow.tsx";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};

describe("the shared planning pieces (U6; WD-1 kept the row, the sections and the fold line)", () => {
  it("one row: handle, title, badges, the right side, then the hover controls", () => {
    const out = html(h(PlanRow, { title: "Utilization chart", badges: h("span", { className: "b" }, "Needs stories"), right: h("span", { className: "r" }, "1 block"), hover: h("button", null, "⋯") }));
    // RS-1: the handle is the grip icon (it was the characters ⋮⋮).
    expect(out).toMatch(/data-plan="row".*pl-handle.*data-icon="grip".*pl-title.*Utilization chart.*class="b".*class="r".*pl-hover/);
    expect(html(h(PlanRow, { title: "x", handle: null }))).not.toContain("pl-handle");
  });

  it("a section with its label, the box hint; the fold reads its chevron, Label · count", () => {
    expect(html(h(AddSection, { label: "From DevOps" }, "rows"))).toMatch(/pl-sec.*pl-label">From DevOps.*rows/);
    expect(html(h(BoxHint, null, "Enter: a must."))).toMatch(/pl-hint.*Enter: a must\./);
    expect(html(h(FoldLine, { open: false, onToggle: noop, label: "More from Proseware's DevOps", count: 11 }))).toMatch(/aria-expanded="false".*data-icon="closed".*More from Proseware&#x27;s DevOps.*· .*11/);
    expect(html(h(FoldLine, { open: true, onToggle: noop, label: "Nice to have", count: 1 }))).toMatch(/data-icon="open".*Nice to have/);
  });
});
