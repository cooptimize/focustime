// U6: the shared planning components render one way, whichever screen uses them (component level; the browser test
// checks both screens use them with the same computed styles).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddPane, AddSection, BoxHint } from "./AddPane.tsx";
import { FoldLine } from "./FoldLine.tsx";
import { PlanFrame } from "./PlanFrame.tsx";
import { PlanHeader } from "./PlanHeader.tsx";
import { PlanRow } from "./PlanRow.tsx";
import { PlanLabel, UnitCard, UnitLine } from "./UnitCard.tsx";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};

describe("the planning layout's components (U6)", () => {
  it("the header puts ‹ ›, title, summary, secondary, ⋯ and the mode area in that order", () => {
    const out = html(h(PlanHeader, { step: { prev: noop, next: noop, prevLabel: "Previous week", nextLabel: "Next week" }, title: "Plan the week of Nov 9", summary: "next week · 1 of 4 clients planned", secondary: h("button", null, "DevOps health · 2"), more: { label: "More", onClick: noop }, mode: h("div", { className: "mode-area" }, "Done") }));
    expect(out).toContain('data-plan="header"');
    const order = ["Previous week", "Plan the week of Nov 9", "1 of 4 clients planned", "pl-spacer", "DevOps health", "pl-more", "mode-area"].map((s) => out.indexOf(s));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("a frame with a right pane is two panes; without one, a single column", () => {
    expect(html(h(PlanFrame, { label: "x", header: null, left: "L", right: h(AddPane, { color: "#123", client: "Northwind", children: "rows" }) }))).toMatch(/class="pl-panes"[^>]*>.*pl-left.*data-plan="add"/);
    expect(html(h(PlanFrame, { label: "x", header: null, left: "L" }))).toContain('class="pl-panes single"');
  });

  it("a unit card: the client's edge color, the name, a muted detail and the fit words with their tone", () => {
    const out = html(h(UnitCard, { color: "#0a0", label: "Cooptimize", name: "Cooptimize", detail: "2 musts", fit: "Over by 1 block", tone: "over", sub: "DevOps: from cache" }, h(PlanLabel, null, "Must")));
    expect(out).toContain('data-plan="unit"');
    expect(out).toContain("--c:#0a0");
    expect(out).toMatch(/pl-unit-name">Cooptimize.*pl-unit-detail">2 musts.*pl-fit over ">Over by 1 block.*pl-unit-sub">DevOps: from cache.*pl-label ">Must/);
    // Nothing empty is drawn.
    expect(html(h(UnitCard, { color: "#0a0", label: "x", name: "x", detail: "", fit: "" }))).not.toMatch(/pl-unit-detail|pl-fit|pl-unit-sub/);
  });

  it("a collapsed unit is one line on the same columns: name · detail · fit · Open (Planning when open)", () => {
    const line = html(h(UnitLine, { color: "#00a", name: "Harbor", detail: "No musts yet", fit: "1 block free", onOpen: noop }));
    expect(line).toMatch(/data-plan="line".*pl-line-name.*Harbor.*pl-line-detail">No musts yet.*pl-fit fits">1 block free.*>Open</);
    expect(html(h(UnitLine, { color: "#00a", name: "Harbor", detail: "", fit: "", open: true, onOpen: noop }))).toContain(">Planning<");
  });

  it("one row: handle, title, badges, the right side, then the hover controls", () => {
    const out = html(h(PlanRow, { title: "Utilization chart", badges: h("span", { className: "b" }, "Needs stories"), right: h("span", { className: "r" }, "1 block"), hover: h("button", null, "⋯") }));
    expect(out).toMatch(/data-plan="row".*pl-handle.*⋮⋮.*pl-title.*Utilization chart.*class="b".*class="r".*pl-hover/);
    expect(html(h(PlanRow, { title: "x", handle: null }))).not.toContain("pl-handle");
  });

  it("the right pane: Add to <client> with a count, the sections, the type box pinned last; the fold reads ▸ Label · count", () => {
    const out = html(h(AddPane, { color: "#123", client: "Northwind", count: "4 of yours not on the list", box: h(BoxHint, null, "Enter: a must."), children: h(AddSection, { label: "From DevOps" }, "rows") }));
    expect(out).toMatch(/pl-add-title.*Add to .*pl-add-client">Northwind.*4 of yours not on the list.*pl-add-scroll.*pl-label">From DevOps.*pl-add-box.*Enter: a must\./);
    expect(html(h(FoldLine, { open: false, onToggle: noop, label: "More from Proseware's DevOps", count: 11 }))).toMatch(/aria-expanded="false".*▸.*More from Proseware&#x27;s DevOps.*· .*11/);
    expect(html(h(FoldLine, { open: true, onToggle: noop, label: "Nice to have", count: 1 }))).toMatch(/▾.*Nice to have/);
  });
});
