// ED-2 (browser, demo mode): grooming Atlas Freight's backlog in the Grid. Two titles renamed in place (F2 and the
// hover button, Enter and Tab), an empty one refused where it was typed; a story dragged onto another feature (only the
// rows that can take it light up, a drop between rows or on a wrong row does nothing, Esc cancels) and another moved
// with Move… by the keyboard alone; three rows assigned in bulk, State… on mixed types, Move to… blocked for a mixed
// selection; Review lists Title and Parent; Save writes each item once and never an order field; the ranked list keeps
// its order; one save undone. Then the Gantt's row menu, and E opening the card ready to edit.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { pickLevel } from "../backlog-helpers.ts";

let h: Harness;
const T = 240_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Entry = { id: number; op: string; itemId: number; status: string; ops: { op: string; path: string }[]; before: Record<string, string | null>; after: Record<string, string | null> };
const log = async (page: Page) => (await call(page, "devops.log", {})).data.entries as Entry[];
const FEATURES = ["Shipment tracking dashboard", "Delivery time estimates", "Carrier rate alerts"];

async function atlas(page: Page, level = "Features") {
  await page.evaluate(() => (location.hash = "#/backlog"));
  await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
  const chips = page.locator(".ah-toolbar").getByRole("group", { name: "Clients" });
  for (const b of await chips.getByRole("button").all()) if ((await b.getAttribute("aria-pressed")) === "true") await b.click();
  await chips.getByRole("button", { name: "Atlas Freight", exact: true }).click();
  await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
  await pickLevel(page, level);
}
const row = (page: Page, title: string): Locator => page.locator(".ah-row", { has: page.getByRole("link", { name: title, exact: true }) });
const open = async (page: Page, title: string) => {
  const r = row(page, title);
  if ((await r.getAttribute("aria-expanded")) !== "true") await r.locator(".ah-chev").first().click();
};
const itemCell = (r: Locator) => r.locator("td.ah-col-item");
/** Open a row's menu from the keyboard. The row can redraw as the list settles and drop the focus, so the key is
 * pressed only once the cell holds it, and again if no menu came (it lost one on a loaded machine). */
const openMenu = async (page: Page, r: Locator) => {
  await expect
    .poll(async () => {
      await itemCell(r).focus();
      if (!(await itemCell(r).evaluate((el) => el === document.activeElement))) return false;
      await page.keyboard.press("Shift+F10");
      return page.getByRole("menu").first().isVisible();
    }, { timeout: 20_000 })
    .toBe(true);
};
const order = (page: Page) => page.locator(".ah-row").evaluateAll((rows) => rows.map((r) => `${(r as HTMLElement).dataset.key}@${r.getAttribute("aria-level")}`));
const said = (page: Page) => page.locator("[data-ed2-said]").textContent();
const center = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
async function confirmAll(page: Page) {
  const dlg = page.locator(".write-dialog");
  for (let i = 0; i < 6; i++) {
    const go = dlg.getByRole("button", { name: /in DevOps$/ }).first();
    if (!(await go.waitFor({ timeout: 6000 }).then(() => true, () => false))) break;
    await go.click();
    await go.waitFor({ state: "detached", timeout: 20_000 });
    await page.waitForTimeout(400);
  }
}

describe.skipIf(!CHROMIUM)("ED-2 rename, move and bulk edit in Backlog's Grid (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("rename two, drag one and Move… another, assign three in bulk, Review, Save, Undo one; the order never changes", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    // Start from an empty change set (the demo seeds a few changes of its own).
    await call(page, "ahead.discard", { confirm: true });
    await atlas(page);
    for (const f of FEATURES) await open(page, f);
    const before = await order(page);

    // --- Rename, in place. F2 on the focused Item cell; Enter stages.
    const typo = row(page, "Shipmnt list filter by region");
    await itemCell(typo).focus();
    await page.keyboard.press("F2");
    const box = page.getByRole("textbox", { name: "Title of #3313" });
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Title of #3313");
    // An empty title is refused where it was typed; nothing is staged.
    await box.fill("   ");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator(".ah-rename-why").textContent()).toBe("Type a title");
    await box.fill("Shipment list filter by region");
    await page.keyboard.press("Enter");
    const fixed = row(page, "Shipment list filter by region");
    await expect.poll(() => fixed.locator("[data-unsaved=title]").textContent()).toBe("Renamed, not saved");
    await expect(said(page)).resolves.toContain("Title of #3313 staged");
    await expect(itemCell(fixed).getAttribute("aria-label")).resolves.toContain("Renamed, not saved yet. DevOps has Shipmnt list filter by region");
    // Focus is back on the cell.
    await expect.poll(() => page.evaluate(() => document.activeElement?.className ?? "")).toContain("ah-col-item");
    // Esc cancels: nothing more staged.
    await page.keyboard.press("F2");
    await page.keyboard.type("thrown away");
    await page.keyboard.press("Escape");
    await expect(row(page, "Shipment list filter by region").count()).resolves.toBe(1);

    // The hover button; Tab stages and moves on to the row's next editable cell.
    const copy = row(page, "estimate accuracy report (copy)");
    await copy.hover();
    await copy.getByRole("button", { name: "Rename estimate accuracy report (copy)" }).click();
    await page.getByRole("textbox", { name: "Title of #3342" }).fill("Estimate accuracy report");
    await page.keyboard.press("Tab");
    await expect.poll(() => row(page, "Estimate accuracy report").locator("[data-unsaved=title]").count()).toBe(1);
    await expect.poll(() => page.evaluate(() => document.activeElement?.className ?? "")).toContain("ah-col-state");
    // Clicking a title still opens the story card.
    await row(page, "Delay alerts").getByRole("link", { name: "Delay alerts", exact: true }).click();
    await page.getByRole("dialog", { name: /#3312/ }).locator(".sc-facts").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: /#3312/ }).waitFor({ state: "detached" });

    // --- Move by drag: a story onto another feature. Only the rows that can take it light up.
    const late = row(page, "Late delivery alerts for dispatchers");
    const from = await center(late.locator(".ah-title"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 4, from.y - 12, { steps: 3 });
    await expect.poll(() => page.locator(".ah-row.ah-drop-ok, .ah-row.ah-drop-on").count()).toBe(2);
    await expect(page.locator(".ah-row.ah-drop-ok .ah-title").allTextContents().then((t) => t.map((x) => x.replace(/\s*#\d+$/, "").trim()).sort())).resolves.toEqual(["Delivery time estimates", "Shipment tracking dashboard"]);
    await expect(said(page)).resolves.toContain("2 rows can take it");
    // Over a story (a row that can't take it): nothing is lit under the pointer, and the pointer says so.
    const wrong = await center(row(page, "Rate change feed").locator(".ah-title"));
    await page.mouse.move(wrong.x, wrong.y, { steps: 4 });
    await expect(page.locator(".ah-row.ah-drop-on").count()).resolves.toBe(0);
    await expect(page.locator(".ah-drag-say").textContent()).resolves.toBe("Drag onto a lit row to move #3354");
    // Dropped there: nothing happens.
    await page.mouse.up();
    await expect(page.locator("[data-unsaved=parent]").count()).resolves.toBe(0);
    await expect(order(page)).resolves.toEqual(before);
    // Esc cancels a drag in progress.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const target = await center(row(page, "Shipment tracking dashboard").locator(".ah-title"));
    await page.mouse.move(target.x, target.y, { steps: 6 });
    await expect.poll(() => page.locator(".ah-row.ah-drop-on").count()).toBe(1);
    await expect(page.locator(".ah-drag-say").textContent()).resolves.toBe("Move under Shipment tracking dashboard");
    await expect(page.locator(".ah-row.ah-drop-on .ah-drop-say").textContent()).resolves.toBe("Move under Shipment tracking dashboard");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".ah-row.ah-drop-on, .ah-row.ah-drop-ok").count()).resolves.toBe(0);
    await expect(page.locator("[data-unsaved=parent]").count()).resolves.toBe(0);
    await expect(said(page)).resolves.toContain("Move cancelled");
    // Letting go over a title after Esc isn't a click on it: no card opens (review 2).
    await page.waitForTimeout(300);
    await expect(page.getByRole("dialog").count()).resolves.toBe(0);
    // Now for real: dropped on the feature, the move is staged and the story shows under it, marked.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => row(page, "Late delivery alerts for dispatchers").locator("[data-unsaved=parent]").textContent()).toBe("Moved, not saved");
    await expect(said(page)).resolves.toContain("moves under Shipment tracking dashboard. Not saved until you save.");
    const after = await order(page);
    // Under its new parent: right after the dashboard's own stories, before the next feature. The features didn't move.
    expect(after.indexOf("Atlas:3354@2")).toBeLessThan(after.indexOf("Atlas:3340@1"));
    expect(after.filter((k) => k.endsWith("@1"))).toEqual(before.filter((k) => k.endsWith("@1")));
    // The drop didn't open the story card or a cell's editor.
    await expect(page.getByRole("dialog").count()).resolves.toBe(0);

    // --- Move… by the keyboard alone: M, type, Enter.
    const digest = row(page, "Weekly rate digest");
    await itemCell(digest).focus();
    await page.keyboard.press("m");
    const pick = page.getByRole("combobox", { name: "Move #3353 under" });
    await pick.waitFor();
    // Only open items one level up, and No parent; the parent it has now is marked; never a story, an epic or the resolved feature.
    const opts = await page.locator(".ah-pop-move [role=option]").allTextContents();
    expect(opts.map((o) => o.replace(/\s+/g, " ").trim())).toEqual(["–No parent", "Shipment tracking dashboard#3310 · Active", "Delivery time estimates#3340 · New", "Carrier rate alerts#3350 · Activenow"]);
    await page.keyboard.type("delivery time");
    await page.keyboard.press("Enter");
    await pick.waitFor({ state: "detached" });
    await expect.poll(() => row(page, "Weekly rate digest").locator("[data-unsaved=parent]").count()).toBe(1);
    await expect.poll(() => page.evaluate(() => document.activeElement?.className ?? "")).toContain("ah-col-item");
    // An epic has no level above it: Move… says why, where it was tried.
    await pickLevel(page, "Epics");
    // (The Filter popover gives focus back to its button as it closes: wait for that before focusing the row.)
    await page.waitForTimeout(400);
    await itemCell(row(page, "Carrier relations")).focus();
    await expect.poll(() => page.evaluate(() => document.activeElement?.className ?? "")).toContain("ah-col-item");
    await page.keyboard.press("m");
    await expect(said(page)).resolves.toContain("Epic has no level above it in Logistics's process");
    await page.locator(".error[role=alert]").waitFor();
    await pickLevel(page, "Features");
    for (const f of FEATURES) await open(page, f);

    // --- Bulk: three rows assigned at once.
    for (const t of ["Map of active shipments", "Delay alerts", "Rate change feed"]) await row(page, t).getByRole("checkbox").check({ force: true });
    const bar = page.getByRole("toolbar", { name: "Selected items" });
    await bar.getByRole("button", { name: "Assign to…" }).click();
    await page.getByRole("combobox", { name: "Assign 3 items to" }).fill("priya");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator(".bl-result").first().textContent()).toContain("Assign to Priya Shah: staged 3, skipped 0. Nothing is written until you save.");
    // The three stay ticked for a next action (review 1).
    await expect(bar.locator("strong").textContent()).resolves.toBe("3 selected");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    // A mixed selection (a feature and a story): Move to… says why it can't; State… lists only what both types take.
    await row(page, "Carrier rate alerts").getByRole("checkbox").check({ force: true });
    await row(page, "Alert settings page").getByRole("checkbox").check({ force: true });
    const moveTo = bar.getByRole("button", { name: "Move to…" });
    await expect(moveTo.getAttribute("aria-disabled")).resolves.toBe("true");
    // It stays reachable so its reason can be heard: Enter on it says why.
    await moveTo.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".bl-why").textContent()).resolves.toBe("Move to… needs rows at one level, so one parent fits them all");
    // State… on the same mixed selection: only what a Feature and a User Story both take can be picked; the state only
    // features have is listed with the rows it fits.
    await bar.getByRole("button", { name: "State…" }).click();
    const sp = page.locator(".ah-pop-bulk-state");
    await sp.waitFor();
    await expect(sp.locator("[role=option] .fl-label").allTextContents()).resolves.toEqual(["New", "Active", "Resolved", "Closed", "Removed"]);
    await expect(sp.getByRole("listitem").allTextContents()).resolves.toEqual(["On hold fits 1 of 2: Feature"]);
    await page.keyboard.press("Escape");
    // The keyboard alone: Size… from the bar (Enter opens it, type, Enter stages); the feature has no size and is skipped with why.
    await bar.getByRole("button", { name: "Size…" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Size for 2 items" }).waitFor().catch(() => null);
    await page.keyboard.type("5");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator(".bl-result").first().textContent()).toContain("Size 5: staged 1, skipped 1. Nothing is written until you save.");
    await page.locator(".bl-result summary").click();
    await expect(page.locator(".bl-result li").textContent()).resolves.toContain("Feature has no size in Logistics's process");
    // The rows stay ticked for the next action (review 1); take the size back so the count below is the grooming's own.
    await expect(bar.locator("strong").textContent()).resolves.toBe("2 selected");
    await call(page, "ahead.unstage", { clientKey: "Atlas", itemId: 3352, field: "size" });
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("button", { name: "Refresh" }).first().click();

    // --- Review: title and parent beside the others, grouped by item.
    await expect.poll(() => page.locator(".ah-pending strong").textContent(), { timeout: 20_000 }).toBe("7 changes to save");
    await page.getByRole("button", { name: "Review" }).click();
    const rv = page.getByRole("dialog", { name: "Review changes" });
    await rv.getByRole("group", { name: "Title: Shipmnt list filter by region to Shipment list filter by region" }).waitFor();
    await rv.getByRole("group", { name: "Parent: #3350 Carrier rate alerts to #3310 Shipment tracking dashboard" }).waitFor();
    await rv.getByRole("group", { name: "Parent: #3350 Carrier rate alerts to #3340 Delivery time estimates" }).waitFor();
    // The item is named as DevOps has it; the new title is its Title row.
    await expect(rv.getByRole("listitem", { name: "#3313 Shipmnt list filter by region" }).count()).resolves.toBe(1);
    // A staged move can be taken back here: Weekly rate digest stays where it is.
    await rv.getByRole("button", { name: "Remove the parent change on #3353" }).click();
    await expect.poll(() => rv.getByRole("group", { name: /^Parent: .* Delivery time estimates$/ }).count()).toBe(0);
    await rv.getByRole("button", { name: "Save 6 items to DevOps" }).click();
    await confirmAll(page);
    await expect.poll(() => rv.locator(".ah-landed li").count(), { timeout: 30_000 }).toBe(6);
    const entries = (await log(page)).filter((e) => e.op === "fields" && e.status === "confirmed");
    expect(entries.length).toBe(6);
    // One write per item, and never an order, area or iteration field.
    expect(new Set(entries.map((e) => e.itemId)).size).toBe(6);
    expect(entries.flatMap((e) => e.ops.map((o) => o.path)).some((p) => /StackRank|BacklogPriority|AreaPath|IterationPath/.test(p))).toBe(false);
    expect(entries.find((e) => e.itemId === 3354)!.after).toEqual({ Parent: "#3310 Shipment tracking dashboard" });
    expect(entries.find((e) => e.itemId === 3313)!.after).toEqual({ Title: "Shipment list filter by region" });

    // --- Undo one from the saved list: the old title comes back.
    // A saved rename is listed by its new title, and the foot no longer says nothing is written.
    await expect(rv.locator(".ah-landed li", { hasText: "#3342 Estimate accuracy report" }).count()).resolves.toBe(1);
    await expect(rv.locator(".ah-review-note").textContent()).resolves.toContain("Nothing is waiting to be saved.");
    await rv.getByRole("button", { name: "Undo #3342 estimate accuracy report (copy)" }).click();
    await confirmAll(page);
    await expect.poll(async () => (await log(page)).some((e) => e.op === "undo_fields" && e.itemId === 3342 && e.status === "confirmed"), { timeout: 30_000 }).toBe(true);
    await rv.getByRole("button", { name: "Close" }).click();
    await expect.poll(() => row(page, "estimate accuracy report (copy)").count()).toBe(1);
    // Saved: no marks left, the story is under its new feature, and every feature is where it was.
    await expect(page.locator("[data-unsaved]").count()).resolves.toBe(0);
    await expect(page.locator(".ah-pending").count()).resolves.toBe(0);
    const end = await order(page);
    expect(end.indexOf("Atlas:3354@2")).toBeLessThan(end.indexOf("Atlas:3340@1"));
    expect(end.filter((k) => k.endsWith("@1"))).toEqual(before.filter((k) => k.endsWith("@1")));
    // The ranked list of stories is in the same order as before any of it.
    await pickLevel(page, "Stories");
    const ranks = await page.locator(".ah-row.depth-0").evaluateAll((rows) => rows.map((r) => `${r.querySelector(".bl-rank")?.textContent}:${(r as HTMLElement).dataset.key}`));
    expect(ranks.filter((x) => /Atlas:33(11|12|13|41|42|51|52|53|54)$/.test(x)).map((x) => x.split(":").slice(1).join(":"))).toEqual(["Atlas:3311", "Atlas:3312", "Atlas:3341", "Atlas:3351", "Atlas:3352", "Atlas:3353", "Atlas:3354", "Atlas:3313", "Atlas:3342"]);
    // The moved story's parent label is its new parent, with no mark now.
    await expect(row(page, "Late delivery alerts for dispatchers").locator(".ah-parent").textContent()).resolves.toBe("Shipment tracking dashboard");
    expect(errors).toEqual([]);
  }, T);

  it("in the ranked list a staged move changes the parent label, marked, and not the row's place; reduced motion makes the drag's feedback instant", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await call(page, "ahead.discard", { confirm: true });
    await atlas(page, "Stories");
    const before = await order(page);
    const r = row(page, "Estimate from carrier history");
    await openMenu(page, r);
    await page.getByRole("menuitem", { name: /^Move…/ }).click();
    await page.getByRole("combobox", { name: "Move #3341 under" }).fill("carrier rate");
    await page.keyboard.press("Enter");
    await expect.poll(() => r.locator(".ah-parent.pend").textContent()).toBe("Carrier rate alerts");
    await expect(r.locator("[data-unsaved=parent]").getAttribute("title")).resolves.toContain("In DevOps it is under #3340 Delivery time estimates. Its place in the backlog order doesn't change");
    await expect(order(page)).resolves.toEqual(before);
    // Undo from the row's menu.
    await openMenu(page, r);
    await page.getByRole("menuitem", { name: "Undo move" }).click();
    await expect.poll(() => r.locator("[data-unsaved]").count()).toBe(0);
    await expect(r.locator(".ah-parent").textContent()).resolves.toBe("Delivery time estimates");
    // Stories have nothing one level up among the rows here: a drag lights nothing and says to use Move….
    const at = await center(r.locator(".ah-title"));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y + 60, { steps: 4 });
    await expect(page.locator(".ah-drag-say").textContent()).resolves.toBe("No row here can take it. Use Move… (M)");
    await expect(page.locator(".ah-row.ah-drop-ok").count()).resolves.toBe(0);
    await page.mouse.up();
    await expect(order(page)).resolves.toEqual(before);
    // Reduced motion: the rows' highlight has no transition.
    await expect(r.evaluate((el) => getComputedStyle(el).transitionDuration)).resolves.not.toBe("0s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(r.evaluate((el) => getComputedStyle(el).transitionDuration)).resolves.toBe("0s");
    expect(errors).toEqual([]);
  }, T);

  it("the Gantt's rows have Rename and Move… in their menu, staged into the same change set; E on a Grid row opens its card ready to edit", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await call(page, "ahead.discard", { confirm: true });
    await atlas(page, "Stories");
    await page.getByRole("button", { name: "Gantt", exact: true }).click();
    const g = (title: string) => page.locator(".pa-item", { has: page.getByRole("link", { name: title, exact: true }) });
    await g("Alert settings page").locator(".pa-label").waitFor();
    // Rename by the keyboard: F2 on the row, Enter stages.
    await g("Alert settings page").locator(".pa-label").focus();
    await page.keyboard.press("F2");
    await page.getByRole("textbox", { name: "Title of #3352" }).fill("Rate alert settings page");
    await page.keyboard.press("Enter");
    await expect.poll(() => g("Rate alert settings page").locator(".pa-unsaved").textContent()).toBe("Renamed, not saved");
    // Move… from the row's menu.
    await g("Rate change feed").hover();
    await g("Rate change feed").getByRole("button", { name: "More for Rate change feed: rename, move, edit" }).click();
    await page.getByRole("menuitem", { name: /^Move…/ }).click();
    await page.getByRole("combobox", { name: "Move #3351 under" }).fill("tracking");
    await page.keyboard.press("Enter");
    await expect.poll(() => g("Rate change feed").locator(".pa-unsaved").textContent()).toBe("Moved, not saved");
    // The Gantt's bars still drag dates, never a parent: its rows have no drop targets.
    await expect(page.locator(".ah-drop-ok, .ah-drop-on").count()).resolves.toBe(0);
    // The same change set: the Grid shows both, and Review lists them.
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await expect.poll(() => row(page, "Rate alert settings page").locator("[data-unsaved=title]").count()).toBe(1);
    await expect(row(page, "Rate change feed").locator(".ah-parent.pend").textContent()).resolves.toBe("Shipment tracking dashboard");
    await expect(page.locator(".ah-pending strong").textContent()).resolves.toBe("2 changes to save");
    // E on a focused row: its story card, with Edit already open and the title box focused. Nothing staged is lost.
    await itemCell(row(page, "Delay alerts")).focus();
    await page.keyboard.press("e");
    const card = page.getByRole("dialog", { name: /#3312/ });
    await card.getByRole("textbox", { name: "Title" }).waitFor();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Title");
    // Esc leaves the edit (nothing typed), Esc again closes the card.
    await page.keyboard.press("Escape");
    await card.getByRole("textbox", { name: "Title" }).waitFor({ state: "detached" });
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe("Edit");
    await page.keyboard.press("Escape");
    await card.waitFor({ state: "detached" });
    await expect(page.locator(".ah-pending strong").textContent()).resolves.toBe("2 changes to save");
    // The row's menu has Edit description… for the same.
    await itemCell(row(page, "Delay alerts")).focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: /^Edit description…/ }).click();
    await card.getByRole("textbox", { name: "Description", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe("Edit");
    await page.keyboard.press("Escape");
    await card.waitFor({ state: "detached" });
    await call(page, "ahead.discard", { confirm: true });
    expect(errors).toEqual([]);
  }, T);
});
