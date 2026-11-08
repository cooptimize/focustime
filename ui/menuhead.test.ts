// D459: a row menu's header names the row it was opened on, and is a label, not an action.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Pick } from "../plan/types.ts";
import { buildWeek } from "../week/build.ts";
import { config } from "../week/test-helpers.ts";
import type { ClientWork, WorkItem } from "../week/types.ts";
import { PopupMenu } from "./Menus.tsx";
import { itemMenu, pickMenu, roadmapRowMenu, rowHead, weekItemMenu, withoutClient, type MenuEnv, type MenuStep, type RoadmapRowOps, type WeekItemFacts, type WeekItemOps } from "./menu.ts";

const week = buildWeek({ weekStart: "2026-11-02", patterns: [], events: [], config, pto: {} });
const wi = (id: number, title: string): WorkItem => ({ id, title, type: "User Story", state: "New", stateCategory: "Proposed", level: "story", order: id, parentId: null, changedAt: "", url: `https://dev.azure.com/contoso/P/_workitems/edit/${id}` });
const work = new Map<string, ClientWork>([["northwind", { clientKey: "northwind", clientName: "Northwind", status: "ok", fetchedAt: null, fromCache: false, items: [wi(412, "Northwind - Order export"), wi(413, "Invoice import")], children: [] }]]);
// Only what the row menus read; the rest of MenuEnv is never touched by them.
const env = { week, work, today: "2026-11-03", timer: null, planState: null, planning: { sizes: { XS: 30, S: 60, M: 120, L: 240, unsized: 60 }, focusMinutes: 50 } } as unknown as MenuEnv;
const pick = (id: number, itemId: number | null, title: string): Pick => ({ id, date: "2026-11-03", half: "AM", clientKey: "northwind", kind: itemId ? "item" : "intention", itemId, draftId: null, title, itemType: "User Story", itemUrl: null, size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, followUpId: null, notes: null, position: 1, createdAt: "", updatedAt: "" });
const facts = (itemId: number, title: string): WeekItemFacts => ({ itemId, title, clientName: "Northwind", tier: "must", level: "feature", first: false, last: false, past: false, done: null, minutes: 240, places: [], pinned: [], openStories: 0, targetDate: null, drafts: 0, canWrite: true });
const noop = () => {};
const wops: WeekItemOps = { move: noop, tier: noop, pin: noop, hours: noop, done: noop, help: noop, targetDate: noop, brief: noop, createDrafts: noop, enableWrites: noop, remove: noop };
const rops: RoadmapRowOps = { open: noop, brief: noop, help: noop, addToWeek: noop, targetDate: noop, enableWrites: noop };
const head = (s: MenuStep) => ("items" in s ? s.head?.text : undefined);

describe("row menu header (D459)", () => {
  it("drops a leading client name, and only a whole one", () => {
    expect(withoutClient("Northwind - Order export", "Northwind")).toBe("Order export");
    expect(withoutClient("northwind: Order export", "Northwind")).toBe("Order export");
    expect(withoutClient("Northwinds rollout", "Northwind")).toBe("Northwinds rollout");
    expect(withoutClient("Northwind", "Northwind")).toBe("Northwind");
    expect(withoutClient("Order export", null)).toBe("Order export");
  });
  it("puts the DevOps id first, and keeps the full title for the tooltip", () => {
    expect(rowHead({ id: 412, title: "Northwind - Order export", client: "Northwind" })).toEqual({ text: "#412 · Order export", full: "#412 Northwind - Order export" });
    expect(rowHead({ id: null, title: "Write the release notes" })).toEqual({ text: "Write the release notes", full: "Write the release notes" });
  });

  // Each place with a row menu: built for row A, then for row B, the header is B's (nothing captured from A).
  it("Plan the week: follows the row", () => {
    expect(head(weekItemMenu(facts(412, "Northwind - Order export"), wops))).toBe("#412 · Order export");
    expect(head(weekItemMenu(facts(500, "Business development and legal"), wops))).toBe("#500 · Business development and legal");
  });
  it("Plan the day and Today (picks): follows the row", () => {
    expect(head(pickMenu(env, pick(1, 412, "Northwind - Order export")))).toBe("#412 · Order export");
    expect(head(pickMenu(env, pick(2, null, "Call the vendor back")))).toBe("Call the vendor back");
  });
  it("Plan the day and Week's detail panel (DevOps items): follows the row", () => {
    expect(head(itemMenu(env, "northwind", wi(412, "Northwind - Order export")))).toBe("#412 · Order export");
    expect(head(itemMenu(env, "northwind", wi(413, "Invoice import")))).toBe("#413 · Invoice import");
  });
  it("Roadmap: follows the row", () => {
    const f = { tier: "feature" as const, targetDate: null, open: 0, onWeek: false, canWrite: true, hasLink: true, clientName: "Northwind" };
    expect(head(roadmapRowMenu({ ...f, id: 412, title: "Order export" }, rops))).toBe("#412 · Order export");
    expect(head(roadmapRowMenu({ ...f, id: 413, title: "Invoice import" }, rops))).toBe("#413 · Invoice import");
  });

  it("renders as a label outside the list: not focusable, not a menu item, full title on hover", () => {
    const html = (s: MenuStep) => renderToStaticMarkup(createElement(PopupMenu, { at: { x: 0, y: 0 }, step: s, onClose: noop }));
    const a = html(weekItemMenu(facts(412, "Northwind - Order export"), wops));
    const b = html(weekItemMenu(facts(500, "Business development and legal"), wops));
    const headTag = /<div class="menu-head"[^>]*>([^<]*)<\/div>/;
    expect(a.match(headTag)?.[1]).toBe("#412 · Order export");
    expect(b.match(headTag)?.[1]).toBe("#500 · Business development and legal");
    const tag = a.match(/<div class="menu-head"[^>]*>/)![0];
    expect(tag).toContain('title="#412 Northwind - Order export"');
    expect(tag).not.toMatch(/tabindex|role=/);
    // The head sits before the list; the first menu item is the first action.
    expect(a.indexOf("menu-head")).toBeLessThan(a.indexOf('role="menu"'));
    expect(a.match(/role="menuitem"[^>]*>.*?<span class="menu-label">([^<]*)/)?.[1]).toBe("Move up");
  });
});
