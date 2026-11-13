// WD-2: one panel, one Day, in a real browser on the demo (Monday Nov 2, 9:30 AM; Tuesday for a past day with an
// unfinished to-do). The step's scenarios: + Add and the Add box (a match, no match), a click on a block and moving to
// another, Take off the plan by drag and by ⋯ (and Undo), the panel opening as the drop area, the trimmed block menu,
// Day on tomorrow, on today (the wrap-up sheet), on yesterday, without the old chips and line, Timeline's + Add, a day
// header opening Day, one panel however it is opened, and the phone's sheet. Edge cases are unit tests
// (plan/blockpanel.test.ts, plan/dayview.test.ts, actions/plan-actions.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, unfoldAddWork, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";

const T = 180_000;
const MON = "2026-11-02";
const TUE = "2026-11-03";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: { pick?: { id: number } } & Record<string, unknown>; error?: string }>;
const hash = (page: Page) => page.evaluate(() => location.hash);
const block = (page: Page, date: string, half: string) => page.locator(`[data-drop="${date}:${half}"]`).first();
const panel = (page: Page) => page.locator("aside.block-panel");
const at = (page: Page) => panel(page).getAttribute("data-block-panel");
const cardTitles = (page: Page, date: string, half: string) => block(page, date, half).locator(".pr-title").allInnerTexts();
const onBlock = (page: Page) => panel(page).locator(".bp-on .pr-title").allInnerTexts();
const inBox = (page: Page) => page.evaluate(() => !!document.activeElement?.classList.contains("bp-box"));
const toast = (page: Page) => page.locator(".undo-toast");
/**
 * Go to an address and wait for its page. By its address, not the 2 key: after a reload the key can land before the app
 * listens (Day has cards too). The address alone has the same gap: set between the app's first render and its effects,
 * the app's own address is pushed over it and no hashchange follows (seen in CI under load, a different test each run).
 * So it is set again, while the page hasn't shown, whenever the address isn't the one asked for.
 */
async function goTo(page: Page, address: string, ready: Locator) {
  const set = () => page.evaluate((a) => void (location.hash !== a && (location.hash = a)), address);
  await set();
  await expect
    .poll(async () => (await ready.isVisible()) || (await set(), false), { timeout: 30_000, interval: 250 })
    .toBe(true);
}
async function week(page: Page) {
  await goTo(page, "#/week", page.locator(".week-head").first());
  await page.locator("main.grid .half.card").first().waitFor({ timeout: 30_000 });
}
async function day(page: Page, date?: string) {
  await goTo(page, date ? `#/day/${date}` : "#/day", page.locator(".day-view .day-bar").first());
}
/** A real pointer drag (the HTML5 drag starts once the pointer moves), ending over `to`. */
async function drag(page: Page, from: Locator, to: Locator, mid?: () => Promise<void>) {
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + Math.min(40, a.width / 2), a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + Math.min(40, a.width / 2) + 12, a.y + a.height / 2 + 12, { steps: 4 });
  await mid?.();
  await to.waitFor();
  const b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 2);
  await page.mouse.up();
}

describe.skipIf(!CHROMIUM)("WD-2: one panel, one Day (browser, demo)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("Week › + Add on a block: the cursor is in the box; part of a story's title then Enter adds it; it's under On this block and on the card; Undo", async () => {
    const { page, errors } = await freshPage(h);
    await week(page);
    await block(page, MON, "PM").locator(".add-work.add-row").click();
    await expect.poll(() => at(page)).toBe(`${MON}|PM`);
    await expect.poll(() => inBox(page)).toBe(true);
    await page.keyboard.type("Filter orders");
    const hl = panel(page).locator(".bp-result.hl");
    await expect(hl.innerText()).resolves.toContain("Filter orders by date range");
    await page.keyboard.press("Enter");
    await expect.poll(() => cardTitles(page, MON, "PM")).toContain("Filter orders by date range");
    await expect.poll(() => onBlock(page)).toContain("Filter orders by date range");
    // The box is empty again, the cursor still in it, and the list is back with the story marked as here.
    await expect.poll(() => panel(page).locator("input.bp-box").inputValue()).toBe("");
    await expect.poll(() => inBox(page)).toBe(true);
    await panel(page).locator(".aw-row.placed", { hasText: "Filter orders by date range" }).getByRole("img", { name: "On this block" }).waitFor();
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => cardTitles(page, MON, "PM")).not.toContain("Filter orders by date range");
    await expect.poll(() => onBlock(page)).not.toContain("Filter orders by date range");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("text that matches nothing: the highlight is on New to-do, and Enter makes a plain to-do on the block", async () => {
    const { page, errors } = await freshPage(h);
    await week(page);
    await block(page, MON, "PM").locator(".add-work.add-row").click();
    await expect.poll(() => inBox(page)).toBe(true);
    await page.keyboard.type("Ring the print shop about proofs");
    const rows = panel(page).locator("#bp-results .bp-result");
    await expect.poll(() => rows.allInnerTexts().then((t) => t.map((x) => x.replace(/^\+\s*/, "").split("\n")[0]))).toEqual(["New to-do: Ring the print shop about proofs", "New draft story: Ring the print shop about proofs", "New feature: Ring the print shop about proofs"]);
    await expect(panel(page).locator(".bp-result.hl").innerText()).resolves.toContain("New to-do: Ring the print shop about proofs");
    await page.keyboard.press("Enter");
    await expect.poll(() => cardTitles(page, MON, "PM")).toContain("Ring the print shop about proofs");
    const st = await call(page, "planday.start", { date: MON });
    const made = (st.data.picks as { title: string; kind: string; itemId: number | null; draftId: number | null }[]).find((p) => p.title === "Ring the print shop about proofs")!;
    expect(made).toMatchObject({ kind: "intention", itemId: null, draftId: null });
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a click on a block's header opens the panel with what's on it and the meetings line; a click on another block moves it there; a click on a row doesn't open it", async () => {
    const { page, errors } = await freshPage(h);
    const added = await call(page, "pick.add", { date: MON, half: "AM", clientKey: "Cooptimize", itemId: 4411, size: "M" });
    expect(added.ok).toBe(true);
    const onIt = (added.data.pick as unknown as { title: string }).title;
    await page.reload();
    await week(page);
    // A click on a to-do's row or its checkbox never opens the panel.
    await block(page, MON, "AM").locator(".pick-row .type-icon").first().click();
    await page.waitForTimeout(300);
    expect(await panel(page).count()).toBe(0);
    await block(page, MON, "AM").locator(".card-client").first().click();
    await expect.poll(() => at(page)).toBe(`${MON}|AM`);
    await expect(panel(page).locator(".bp-title h2").innerText()).resolves.toBe("Cooptimize · Mon AM");
    await expect(panel(page).locator(".bp-when").innerText()).resolves.toMatch(/^9:00–12:30 · /);
    await expect.poll(() => onBlock(page)).toContain(onIt);
    await expect(panel(page).locator(".bp-meet-line").innerText()).resolves.toMatch(/^\s*3 meetings · 1h 30m$/);
    // Opened by a click, the cursor is not put in the box.
    expect(await inBox(page)).toBe(false);
    // Another block: the same panel moves there (its empty space this time).
    await block(page, TUE, "PM").click({ position: { x: 30, y: 200 } });
    await expect.poll(() => at(page)).toBe(`${TUE}|PM`);
    await expect(panel(page).locator(".bp-title h2").innerText()).resolves.toMatch(/ · Tue PM$/);
    await panel(page).getByText("Nothing here yet.").waitFor();
    expect(await panel(page).count()).toBe(1);
    await expect.poll(() => hash(page)).toBe(`#/week/day/${TUE}/PM`);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("drag a to-do from a block onto the panel: it's off the block and back in its feature's list as not placed; Undo puts it back. The same with ⋯ › Take off the plan", async () => {
    const { page, errors } = await freshPage(h);
    expect((await call(page, "pick.add", { date: MON, half: "PM", clientKey: "Northwind", itemId: 1112, size: "M" })).ok).toBe(true);
    await page.reload();
    await week(page);
    await block(page, MON, "PM").locator(".card-client").first().click();
    const row = () => panel(page).locator(".aw-features .aw-row", { hasText: "Filter orders by date range" }).first();
    await row().getByRole("img", { name: "On this block" }).waitFor();
    const todo = () => block(page, MON, "PM").locator("li.pick-row", { hasText: "Filter orders by date range" });
    // While it drags, the panel is one drop area.
    await drag(page, todo(), panel(page).locator(".bp-takeoff"), async () => {
      await expect(panel(page).locator(".bp-takeoff strong").innerText()).resolves.toBe("Take off the plan");
    });
    await toast(page).getByText("Taken off Mon PM: Filter orders by date range").waitFor();
    await expect.poll(() => todo().count()).toBe(0);
    await expect.poll(() => onBlock(page)).not.toContain("Filter orders by date range");
    // Back in its feature's list, not placed: a + again, no "On this block", no other block named.
    await row().locator("button.aw-plus").waitFor();
    expect(await row().locator(".aw-where").count()).toBe(0);
    // It isn't dropped: the day keeps no dropped to-do.
    const st = await call(page, "planday.start", { date: MON });
    expect((st.data.picks as { title: string }[]).some((p) => p.title === "Filter orders by date range")).toBe(false);
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => todo().count()).toBe(1);
    await row().getByRole("img", { name: "On this block" }).waitFor();
    // The same from the to-do's own menu.
    await todo().hover();
    await todo().getByRole("button", { name: /^More for/ }).click();
    await page.getByRole("menuitem", { name: /^Take off the plan/ }).click();
    await toast(page).getByText("Taken off Mon PM: Filter orders by date range").waitFor();
    await expect.poll(() => todo().count()).toBe(0);
    await row().locator("button.aw-plus").waitFor();
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => todo().count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a plain to-do taken off isn't destroyed: it waits under To place, and + puts it back on a block", async () => {
    const { page, errors } = await freshPage(h);
    expect((await call(page, "pick.add", { date: MON, half: "PM", clientKey: "Northwind", intention: "Tidy the export notes" })).ok).toBe(true);
    await page.reload();
    await week(page);
    await block(page, MON, "PM").locator(".card-client").first().click();
    const todo = block(page, MON, "PM").locator("li.pick-row", { hasText: "Tidy the export notes" });
    await todo.hover();
    await todo.getByRole("button", { name: /^More for/ }).click();
    await page.getByRole("menuitem", { name: /^Take off the plan/ }).click();
    await toast(page).getByText("Taken off Mon PM: Tidy the export notes · kept under To place").waitFor();
    await expect.poll(() => todo.count()).toBe(0);
    const place = panel(page).locator(".aw-toplace-line");
    if ((await place.getAttribute("aria-expanded")) === "false") await place.click();
    const kept = panel(page).locator(".bp-loose .aw-row", { hasText: "Tidy the export notes" });
    await kept.waitFor();
    await kept.locator("button.aw-plus").click();
    await expect.poll(() => cardTitles(page, MON, "PM")).toContain("Tidy the export notes");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("with the panel closed, starting to drag a to-do out opens the panel as the drop area; dropped on another block instead, the panel closes again", async () => {
    const { page, errors } = await freshPage(h);
    expect((await call(page, "pick.add", { date: MON, half: "PM", clientKey: "Northwind", itemId: 1112, size: "M" })).ok).toBe(true);
    await page.reload();
    await week(page);
    expect(await panel(page).count()).toBe(0);
    const todo = (date: string, half: string) => block(page, date, half).locator("li.pick-row", { hasText: "Filter orders by date range" });
    // Dragged to Wednesday morning (the same client's): the panel was only the drop area, so it goes again.
    await drag(page, todo(MON, "PM"), block(page, "2026-11-04", "AM"), async () => {
      await panel(page).locator(".bp-takeoff").waitFor();
      await expect.poll(() => at(page)).toBe(`${MON}|PM`);
    });
    await toast(page).getByText(/^Moved to Wed AM/).waitFor();
    await expect.poll(() => panel(page).count()).toBe(0);
    // Dragged out and dropped on the panel: off the plan, and the panel stays on the block it came from.
    await drag(page, todo("2026-11-04", "AM"), panel(page).locator(".bp-takeoff"), async () => {
      await panel(page).locator(".bp-takeoff").waitFor();
    });
    await toast(page).getByText("Taken off Wed AM: Filter orders by date range").waitFor();
    await expect.poll(() => todo("2026-11-04", "AM").count()).toBe(0);
    await expect.poll(() => at(page)).toBe("2026-11-04|AM");
    expect(await panel(page).locator(".bp-takeoff").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the block's ⋯ menu has no Details, Add work…, Add an intention or Add a work item: it opens the block, and has the calls", async () => {
    const { page, errors } = await freshPage(h);
    await week(page);
    const card = block(page, MON, "PM");
    await card.click({ button: "right", position: { x: 60, y: 14 } });
    const menu = page.locator(".popup-menu").last();
    await menu.waitFor();
    const labels = (await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.split("\n")[0]!.trim());
    for (const gone of ["Details", "Add work…", "Add an intention", "Add a work item"]) expect(labels).not.toContain(gone);
    expect(labels[0]).toBe("Open");
    expect(labels.slice(1).every((l) => /^(Join the call in|Start a call in) /.test(l)), labels.join(" | ")).toBe(true);
    await menu.getByRole("menuitem", { name: /^Open/ }).click();
    await expect.poll(() => at(page)).toBe(`${MON}|PM`);
    // The command menu has one entry for it, which still answers to the old words.
    await page.keyboard.press("Escape");
    for (const words of ["details", "add work"]) {
      await page.keyboard.press("Control+k");
      await page.keyboard.type(words);
      await page.getByRole("menuitem", { name: /^Open the selected block/ }).first().waitFor();
      expect(await page.getByRole("menuitem", { name: /^(Details of the selected half-day|Add work to the selected block)/ }).count()).toBe(0);
      await page.keyboard.press("Escape");
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Day › → to tomorrow › + Add on the PM block › add a story › Week shows it on tomorrow PM", async () => {
    const { page, errors } = await freshPage(h);
    await day(page);
    await page.getByRole("button", { name: "Next day" }).click();
    await expect.poll(() => hash(page)).toBe(`#/day/${TUE}`);
    await expect(page.locator(".day-bar h1").innerText()).resolves.toBe("Tue, Nov 3");
    const pm = page.locator(`.day-view [data-drop="${TUE}:PM"]`);
    await pm.locator(".add-work.add-row").click();
    await expect.poll(() => at(page)).toBe(`${TUE}|PM`);
    await expect.poll(() => hash(page)).toBe(`#/day/${TUE}/PM`);
    await expect.poll(() => inBox(page)).toBe(true);
    await unfoldAddWork(page);
    const row = panel(page).locator(".bp-add .aw-row:not(.placed):not(:has(.aw-where))").filter({ has: page.locator("button.aw-plus") }).first();
    await row.waitFor();
    const title = (await row.locator(".aw-row-title").innerText()).trim().replace(/^[^:]+: /, "");
    await row.locator("button.aw-plus").click();
    await expect.poll(async () => (await pm.locator(".pr-title").allInnerTexts()).some((t) => t.includes(title))).toBe(true);
    await week(page);
    await expect.poll(async () => (await cardTitles(page, TUE, "PM")).some((t) => t.includes(title))).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Day today: ticking a to-do on the card and in the panel opens the wrap-up sheet each time", async () => {
    const { page, errors } = await freshPage(h);
    expect((await call(page, "pick.add", { date: MON, half: "AM", clientKey: "Cooptimize", itemId: 4411, size: "M" })).ok).toBe(true);
    expect((await call(page, "pick.add", { date: MON, half: "AM", clientKey: "Cooptimize", itemId: 4412, size: "S" })).ok).toBe(true);
    await page.reload();
    await day(page);
    const am = page.locator(`.day-view [data-drop="${MON}:AM"]`);
    const sheet = page.getByRole("dialog", { name: "Wrap it up" });
    await am.locator("li.pick-row.planned").first().locator("input[type=checkbox]").check();
    await sheet.waitFor();
    await sheet.getByRole("button", { name: /^(Not now|Close)/ }).first().click();
    await expect.poll(() => sheet.count()).toBe(0);
    await am.locator(".card-client").first().click();
    await expect.poll(() => at(page)).toBe(`${MON}|AM`);
    const second = panel(page).locator(".bp-on li.pick-row.planned").first();
    await second.locator("input[type=checkbox]").check();
    await sheet.waitFor();
    await sheet.getByRole("button", { name: /^(Not now|Close)/ }).first().click();
    await expect.poll(() => sheet.count()).toBe(0);
    await expect.poll(() => am.locator("li.pick-row.done").count()).toBe(2);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Day has no This week chips and no A day ahead line; Day's Timeline has + Add on each block, opening the same panel", async () => {
    const { page, errors } = await freshPage(h);
    await day(page);
    await page.locator(".day-view .half.card").first().waitFor();
    expect(await page.locator(".this-week, .tw-chip, .phone-now").count()).toBe(0);
    expect(await page.locator(".day-view").getByText("This week", { exact: true }).count()).toBe(0);
    await day(page, TUE);
    await page.locator(`.day-view [data-drop="${TUE}:AM"]`).waitFor();
    expect(await page.locator(".day-view").getByText(/A day ahead/).count()).toBe(0);
    expect(await page.locator(".today-other").count()).toBe(0);
    await day(page);
    await page.locator(".day-switch").getByRole("button", { name: "Timeline" }).click();
    await page.locator(".today-tl .tt-block").first().waitFor();
    const blocks = page.locator(".today-tl .tt-block");
    expect(await blocks.count()).toBe(2);
    for (const b of await blocks.all()) expect(await b.locator(".add-work.tt-add").count()).toBe(1);
    await blocks.nth(1).locator(".add-work.tt-add").click();
    await expect.poll(() => at(page)).toBe(`${MON}|PM`);
    await expect.poll(() => inBox(page)).toBe(true);
    await panel(page).locator(".bp-title h2", { hasText: "Northwind · Mon PM" }).waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator(".day-switch").getByRole("button", { name: "Cards" }).click();
    await page.locator(".day-view .day-cards").waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Week › a click on Wednesday's header › Day on Wednesday; Today comes back", async () => {
    const { page, errors } = await freshPage(h);
    await week(page);
    await page.locator("header.day-head", { has: page.locator(".dow", { hasText: "Wed" }) }).first().locator(".day-open").click();
    await expect.poll(() => hash(page)).toBe("#/day/2026-11-04");
    await expect(page.locator(".day-bar h1").innerText()).resolves.toBe("Wed, Nov 4");
    await page.locator('.day-view [data-drop="2026-11-04:AM"]').waitFor();
    await page.locator(".day-bar").getByRole("button", { name: "Today", exact: true }).click();
    await expect.poll(() => hash(page)).toBe("#/day");
    await expect(page.locator(".day-bar .day-today").innerText()).resolves.toBe("Today");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("only one side panel exists: + Add, a click and the keyboard open the same panel, on Week and on Day; Esc closes it and gives focus back to the block", async () => {
    const { page, errors } = await freshPage(h);
    const shape = () =>
      panel(page).evaluate((el) => ({
        sections: [...el.querySelectorAll(".bp-sec > h3, .bp-meet-line")].map((x) => (x.matches(".bp-meet-line") ? "meetings" : (x.textContent ?? "").trim())),
        title: el.querySelector(".bp-title h2")?.textContent,
        box: !!el.querySelector("input.bp-box"),
      }));
    const one = async () => {
      await panel(page).locator(".aw-features").waitFor();
      expect(await page.locator("aside.block-panel").count()).toBe(1);
      expect(await page.locator("aside.detail-panel, aside.add-work-panel, dialog.details").count()).toBe(0);
      return shape();
    };
    const seen: Awaited<ReturnType<typeof shape>>[] = [];
    for (const screen of ["week", "day"] as const) {
      if (screen === "week") await week(page);
      else await day(page);
      const scope = screen === "week" ? "main.grid" : ".day-view";
      const card = page.locator(`${scope} [data-drop="${MON}:PM"]`).first();
      // + Add.
      await card.locator(".add-work.add-row").click();
      seen.push(await one());
      await page.keyboard.press("Escape");
      await panel(page).waitFor({ state: "detached" });
      // Esc gave focus back to the block.
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-drop"))).toBe(`${MON}:PM`);
      // A click on its header.
      await card.locator(".card-when").click();
      seen.push(await one());
      await page.keyboard.press("Escape");
      await panel(page).waitFor({ state: "detached" });
      // The keyboard: Enter, then A (which puts the cursor in the box).
      await card.focus();
      await page.keyboard.press("Enter");
      seen.push(await one());
      expect(await inBox(page)).toBe(false);
      await page.keyboard.press("Escape");
      await panel(page).waitFor({ state: "detached" });
      await page.keyboard.press("a");
      seen.push(await one());
      await expect.poll(() => inBox(page)).toBe(true);
      // With it open, arrowing from the block to another block moves it there (the arrows do nothing from inside the panel).
      await panel(page).locator(".bp-title h2").click();
      await card.focus();
      await page.keyboard.press(screen === "week" ? "ArrowUp" : "ArrowLeft");
      await expect.poll(() => at(page)).toBe(`${MON}|AM`);
      await page.keyboard.press("Escape");
      await panel(page).waitFor({ state: "detached" });
    }
    expect(seen).toHaveLength(8);
    for (const s of seen) expect(s).toEqual(seen[0]);
    expect(seen[0]).toMatchObject({ title: "Northwind · Mon PM", box: true });
    expect(seen[0]!.sections).toEqual(["On this block", "meetings", "Add"]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("review: inside the panel the block keys stay out of the way: Space ticks a to-do's checkbox, the arrows don't move the panel, and typing a doesn't reopen it", async () => {
    const { page, errors } = await freshPage(h);
    expect((await call(page, "pick.add", { date: MON, half: "PM", clientKey: "Northwind", intention: "Tidy the export notes" })).ok).toBe(true);
    await page.reload();
    await day(page);
    await page.locator(`.day-view [data-drop="${MON}:PM"] .card-when`).click();
    const box = panel(page).locator(".bp-on li.pick-row input[type=checkbox]").first();
    await box.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => panel(page).locator(".bp-on li.pick-row.done").count()).toBe(1);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(300);
    expect(await at(page)).toBe(`${MON}|PM`);
    // The text typed while the first to-do saves is kept.
    const input = panel(page).locator("input.bp-box");
    await input.click();
    await page.keyboard.type("a plain one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("and the next");
    await expect.poll(() => cardTitles(page, MON, "PM")).toContain("a plain one");
    expect(await input.inputValue()).toBe("and the next");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("follow-up: More in <client> opens the rest of the client's open work; a teammate's story there adds to the block", async () => {
    const { page, errors } = await freshPage(h);
    // A teammate's feature with one story, in the session's own demo DevOps.
    const fid = (await call(page, "demo.devops_change", { clientKey: "Northwind", change: { create: { type: "Feature", title: "Gift cards", parent: 1100, assignee: null } } })).data.id as unknown as number;
    expect(fid).toBeGreaterThan(0);
    expect((await call(page, "demo.devops_change", { clientKey: "Northwind", change: { create: { type: "User Story", title: "Gift card balance page", parent: fid, assignee: null } } })).ok).toBe(true);
    await page.reload();
    await week(page);
    await block(page, MON, "PM").locator(".card-when").click();
    const assigned = panel(page).locator(".bp-assigned");
    await assigned.locator(".aw-feature").first().waitFor();
    // Not mine: it isn't under Assigned to you.
    expect(await assigned.getByText("Gift cards").count()).toBe(0);
    const fold = panel(page).locator(".bp-other > .pl-fold");
    await expect(fold.innerText()).resolves.toMatch(/^\s*More in Northwind/);
    await fold.click();
    const group = panel(page).locator(".bp-other .aw-group", { hasText: "Gift cards" });
    await group.waitFor();
    await expect(fold.innerText()).resolves.toMatch(/^\s*More in Northwind · \d+$/);
    await group.locator(".aw-row", { hasText: "Gift card balance page" }).locator("button.aw-plus").click();
    await expect.poll(() => cardTitles(page, MON, "PM")).toContain("Gift card balance page");
    await expect.poll(() => onBlock(page)).toContain("Gift card balance page");
    // The Add box's search covers it too.
    await panel(page).locator("input.bp-box").fill("Gift card");
    await panel(page).locator("#bp-results .bp-result", { hasText: "Gift card balance page" }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("follow-up: the panel's ⋯ sorts the list by target date or backlog order, remembered across a reload; a row's hover has its state, target date and size", async () => {
    const { page, errors } = await freshPage(h);
    await week(page);
    await block(page, MON, "PM").locator(".card-when").click();
    const names = () => panel(page).locator(".bp-assigned .aw-feature .aw-feat-name").allInnerTexts();
    await panel(page).locator(".bp-assigned .aw-feature").first().waitFor();
    const backlog = await names();
    // Hover: the type and number, the state, the target date and the size; nothing of that is on the row itself.
    const tips = await panel(page).locator(".bp-assigned .aw-feature .aw-feat-name[title]").evaluateAll((els) => els.map((e) => e.getAttribute("title")!));
    expect(tips.length).toBeGreaterThan(1);
    // A feature's size is its estimate when it is on the week's list; a story's is the letter and its hours, never the DevOps value.
    for (const t of tips) expect(t).toMatch(/^\S.* \d+ · \S.* · (target \w+ \d+|no target date)( · about \d+h)?$/);
    const storyTips = await panel(page).locator(".bp-assigned .aw-row .aw-row-title[title]").evaluateAll((els) => els.map((e) => e.getAttribute("title")!).filter((t) => /(target|no target date)/.test(t)));
    expect(storyTips.length).toBeGreaterThan(0);
    for (const t of storyTips) expect(t).toMatch(/ · (XS|S|M|L|Size\?) · \d+ ?(h|min)$/);
    expect(tips.some((t) => /target \w+ \d+/.test(t))).toBe(true);
    expect(await panel(page).locator(".bp-assigned").innerText()).not.toMatch(/target/i);
    const more = panel(page).locator(".bp-head").getByRole("button", { name: /^More for/ });
    await more.click();
    await page.getByRole("menuitem", { name: /^Sort by target date/ }).click();
    await expect.poll(names).not.toEqual(backlog);
    const byTarget = await names();
    expect([...byTarget].sort()).toEqual([...backlog].sort());
    await page.reload();
    await panel(page).locator(".bp-assigned .aw-feature").first().waitFor({ timeout: 30_000 });
    expect(await names()).toEqual(byTarget);
    await more.click();
    await page.getByRole("menuitem", { name: /^Sort by backlog order/ }).click();
    await expect.poll(names).toEqual(backlog);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("follow-up: the header has one status line; no browser select anywhere in the panel or on Day", async () => {
    const { page, errors } = await freshPage(h);
    await day(page);
    await page.locator(`.day-view [data-drop="${MON}:PM"] .card-when`).click();
    await panel(page).locator(".bp-assigned").waitFor();
    expect(await panel(page).locator(".bp-head .bp-risk").count()).toBe(1);
    expect(await panel(page).locator(".bp-risks, .status-pill").count()).toBe(0);
    await panel(page).locator("input.bp-box").fill("A new draft");
    await panel(page).locator("button.bp-parent").click();
    await page.locator(".popup-menu").getByText("Order history export").click();
    await panel(page).locator("button.bp-parent", { hasText: "under Order history export" }).waitFor();
    expect(await page.locator("aside.block-panel select, .day-view select").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Day remembers on this device whether its panel was left open, and its address names the block", async () => {
    const { page, errors } = await freshPage(h);
    await day(page);
    expect(await panel(page).count()).toBe(0);
    await page.locator(`.day-view [data-drop="${MON}:PM"] .card-when`).click();
    await expect.poll(() => hash(page)).toBe(`#/day/${MON}/PM`);
    // Left open: another day opens with it, on that day's block; back on Day later, it is still open.
    await page.getByRole("button", { name: "Next day" }).click();
    await expect.poll(() => at(page)).toMatch(new RegExp(`^${TUE}\\|`));
    await week(page);
    await page.keyboard.press("1");
    await expect.poll(() => at(page)).toMatch(new RegExp(`^${MON}\\|`));
    // Closed: it stays closed.
    await panel(page).getByRole("button", { name: /Close/ }).first().click();
    await panel(page).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Next day" }).click();
    await page.locator(`.day-view [data-drop="${TUE}:AM"]`).waitFor();
    expect(await panel(page).count()).toBe(0);
    // The address alone opens it.
    await page.evaluate((d) => (location.hash = `#/day/${d}/AM`), TUE);
    await expect.poll(() => at(page)).toBe(`${TUE}|AM`);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("phone (390×844): + Add on a block opens the sheet; a story added from it is on the block, on Week and on Day", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    // Day today: + Add under a block.
    await page.locator(".ph-todos .ph-add").last().click();
    const sheet = page.locator("aside.block-panel.sheet");
    await sheet.waitFor();
    await expect.poll(() => sheet.getAttribute("data-block-panel")).toBe(`${MON}|PM`);
    const row = sheet.locator(".aw-features .aw-row:not(.placed):not(:has(.aw-where))").filter({ has: page.locator("button.aw-plus") }).first();
    await row.waitFor();
    const title = (await row.locator(".aw-row-title").innerText()).trim();
    await row.locator("button.aw-plus").click();
    await sheet.locator(".aw-row.placed", { hasText: title }).first().waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await sheet.getByRole("button", { name: /Close/ }).first().click();
    await sheet.waitFor({ state: "detached" });
    await page.locator(".ph-todos .ph-todo-title", { hasText: title }).waitFor();
    // Week: the same sheet from a block's + Add.
    await page.evaluate(() => (location.hash = "#/week"));
    const card = page.locator(".half.card .add-work.add-row").first();
    await card.waitFor({ timeout: 30_000 });
    await card.click();
    await sheet.waitFor();
    await sheet.locator(".bp-title h2").waitFor();
    expect(await page.locator("aside.block-panel").count()).toBe(1);
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("WD-2: a past day (browser, demo on Tuesday)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-03T09:30:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  it("Day on yesterday: the block opens the panel with no + Add; an unfinished to-do can be ticked, and moved to today", async () => {
    const { page, errors } = await freshPage(h);
    await day(page);
    await page.getByRole("button", { name: "Previous day" }).click();
    await expect.poll(() => hash(page)).toBe(`#/day/${MON}`);
    await expect(page.locator(".day-bar .day-when").innerText()).resolves.toBe("past");
    const cards = page.locator(".day-view .half.card");
    await cards.first().waitFor();
    // No + Add anywhere on a past day (the header, the cards).
    expect(await page.locator(".day-view .add-work").count()).toBe(0);
    // WK-5: a past day's card lists its to-dos again (QT-1's one-line fold undone); the panel has them as rows too.
    const withWork = page.locator(".day-view .half.card.past", { has: page.locator(".past-rows li.pick-row.planned") }).first();
    await withWork.locator(".card-head").click();
    await panel(page).waitFor();
    expect(await panel(page).locator(".bp-add, input.bp-box").count()).toBe(0);
    await panel(page).getByText("A past day: tick what got done, or move what didn't to today.").waitFor();
    const todo = panel(page).locator(".bp-on li.pick-row.planned").first();
    const title = (await todo.locator(".pr-title").innerText()).trim();
    // Tick it (the wrap-up sheet may ask about DevOps), then untick: a past day's to-do still ticks.
    await todo.locator("input[type=checkbox]").check();
    const sheet = page.getByRole("dialog", { name: "Wrap it up" });
    await Promise.race([sheet.waitFor().then(() => sheet.getByRole("button", { name: /^(Not now|Close)/ }).first().click()), panel(page).locator(".bp-on li.pick-row.done", { hasText: title }).waitFor()]);
    const done = panel(page).locator(".bp-on li.pick-row.done", { hasText: title });
    await done.waitFor();
    await done.locator("input[type=checkbox]").uncheck();
    const again = panel(page).locator(".bp-on li.pick-row.planned", { hasText: title });
    await again.waitFor();
    // Move it forward: one button, to the client's next block (today when it has one).
    const forward = again.locator("button.bp-forward");
    const label = (await forward.innerText()).trim();
    // The demo's Monday clients have no block on Tuesday, so it names the next block that can take it.
    expect(label).toMatch(/^Move to (today|\S.*)$/);
    await forward.click();
    await toast(page).getByText(/^Moved to /).waitFor();
    const st = await call(page, "week.load", {});
    const plan = st.data.plan as Record<string, { picks: { title: string; status: string; date: string }[] }>;
    const moved = Object.values(plan).flatMap((d) => d.picks).filter((p) => p.title === title && p.status === "planned");
    expect(moved).toHaveLength(1);
    expect(moved[0]!.date >= TUE).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
