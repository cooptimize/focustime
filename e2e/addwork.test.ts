// WD-1, WD-2: the scenarios of Plan the day and Plan the week (planday-add, planday-pane, planning, planweek), moved
// to the block panel beside Week, on the demo (Monday Nov 2, 9:30 AM). Each one adds through the panel's own rows, its
// ⋯, a drag or the one Add box, and reads the result on Week's cards. What was dropped with Plan mode and with the two
// old panels, and why, is in docs/ux/wd1/inventory.md and docs/ux/wd2/inventory.md.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 120_000;
const block = (page: Page, date: string, half: string) => page.locator(`[data-drop="${date}:${half}"]`).first();
const panel = (page: Page) => page.locator("aside.block-panel");
const section = (page: Page, label: string) => panel(page).locator(".aw-sec").filter({ has: page.locator(".pl-label, .pl-fold, h4, h3", { hasText: new RegExp(`^\\W*${label}`, "i") }) }).first();
const cardTitles = (page: Page, date: string, half: string) => block(page, date, half).locator(".pr-title").allInnerTexts();
async function openOn(page: Page, date: string, half: string) {
  await page.keyboard.press("2");
  await block(page, date, half).locator(".add-work.add-row").click();
  await expect.poll(() => panel(page).getAttribute("data-block-panel")).toBe(`${date}|${half}`);
}
async function dayMenu(page: Page, dow: string) {
  const head = page.locator("header.day-head", { has: page.locator(".dow", { hasText: dow }) }).first();
  await head.hover();
  await head.getByRole("button", { name: new RegExp(`^Actions for ${dow}`) }).click();
}
const free = (s: ReturnType<typeof section>) => s.locator(".aw-row:not(.placed)").filter({ has: s.page().locator("button.aw-plus") }).first();

describe.skipIf(!CHROMIUM)("Add work: the moved Plan scenarios (browser, demo)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("+ in Assigned to you and in Promises: each lands on the block and says so (More in <client> is in e2e/wd2.test.ts)", async () => {
    const { page, errors } = await freshPage(h);
    await openOn(page, "2026-11-02", "PM");
    for (const label of ["Assigned to you", "Promises"]) {
      const row = section(page, label).locator(".aw-row:not(.placed):not(:has(.aw-where))").filter({ has: page.locator("button.aw-plus") }).first();
      const title = (await row.locator(".aw-row-title").innerText()).trim().replace(/^[^:]+: /, "");
      await row.locator("button.aw-plus").click();
      await expect.poll(async () => (await cardTitles(page, "2026-11-02", "PM")).some((t) => t.includes(title)), { message: label }).toBe(true);
      await expect.poll(() => panel(page).locator(".aw-row.placed", { hasText: title }).getByRole("img", { name: "On this block" }).count(), { message: label }).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("⋯ → Add to the plan offers the selected block first; another client's block is under Different client and asks first", async () => {
    const { page } = await freshPage(h);
    await openOn(page, "2026-11-02", "PM");
    const row = section(page, "Assigned to you").locator(".aw-feature > ul > .aw-row:not(.placed):not(:has(.aw-where))").filter({ has: page.locator("button.aw-plus") }).first();
    const title = (await row.locator(".aw-row-title").innerText()).trim();
    await row.getByRole("button", { name: `More for ${title}` }).click();
    await page.getByRole("menuitem", { name: /^Add to the plan/ }).click();
    await expect(page.getByRole("menuitem").first().textContent()).resolves.toMatch(/^Mon, Nov 2 PM/);
    await expect(page.locator(".menu-group", { hasText: "Different client" }).count()).resolves.toBe(1);
    await page.getByRole("menuitem").first().click();
    await expect.poll(() => cardTitles(page, "2026-11-02", "PM")).toContain(title);
    expect(await cardTitles(page, "2026-11-02", "AM")).not.toContain(title);
    await page.close();
  }, T);

  it("drag a row onto its client's block adds it there; another client's block refuses it", async () => {
    const { page } = await freshPage(h);
    await openOn(page, "2026-11-02", "PM");
    const row = section(page, "Assigned to you").locator(".aw-row[draggable=true]:not(:has(.aw-where))").first();
    const title = (await row.locator(".aw-row-title").innerText()).trim();
    // Tuesday AM is another client's: nothing lands there.
    await row.dragTo(block(page, "2026-11-03", "AM"));
    await page.waitForTimeout(500);
    expect(await cardTitles(page, "2026-11-03", "AM")).not.toContain(title);
    // Wednesday AM is the same client's.
    await row.dragTo(block(page, "2026-11-04", "AM"));
    await expect.poll(() => cardTitles(page, "2026-11-04", "AM")).toContain(title);
    await page.close();
  }, T);

  it("A on a selected card opens the panel on it; Esc closes it and the keys still work after a click on +", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    await block(page, "2026-11-04", "PM").locator(".card-client").first().click();
    await page.keyboard.press("a");
    await expect.poll(() => panel(page).getAttribute("data-block-panel")).toBe("2026-11-04|PM");
    await free(section(page, "Assigned to you")).locator("button.aw-plus").click();
    await page.keyboard.press("Escape");
    await panel(page).waitFor({ state: "detached" });
    // W opens it again, on the selected block.
    await page.keyboard.press("w");
    await panel(page).waitFor();
    await page.close();
  }, T);

  it("the Add box: with no match Enter makes a plain to-do on the block; Down then Enter makes a draft story, not in DevOps yet", async () => {
    const { page } = await freshPage(h);
    await openOn(page, "2026-11-02", "PM");
    const box = panel(page).locator("input.bp-box");
    await box.fill("Call the warehouse about labels");
    await panel(page).getByRole("option", { name: "New to-do: Call the warehouse about labels" }).waitFor();
    await expect(panel(page).locator(".bp-result.hl").innerText()).resolves.toContain("New to-do: Call the warehouse about labels");
    await box.press("Enter");
    await expect.poll(() => cardTitles(page, "2026-11-02", "PM")).toContain("Call the warehouse about labels");
    await expect(box.inputValue()).resolves.toBe("");
    await box.fill("Write the supplier import notes");
    await box.press("ArrowDown");
    await expect(panel(page).locator(".bp-result.hl").innerText()).resolves.toContain("New draft story: Write the supplier import notes");
    await box.press("Enter");
    await expect.poll(() => cardTitles(page, "2026-11-02", "PM")).toContain("Write the supplier import notes");
    await page.close();
  }, T);

  it("the Add box searches this client's work: results replace the list and end with the two New rows; Esc clears the text first, then closes the panel", async () => {
    const { page } = await freshPage(h);
    await openOn(page, "2026-11-02", "PM");
    const box = panel(page).locator("input.bp-box");
    const first = (await section(page, "Assigned to you").locator(".aw-row .aw-row-title").first().innerText()).trim();
    await box.fill(first.split(" ")[0]!);
    const results = panel(page).locator("#bp-results");
    await results.waitFor();
    // The list is replaced while typing.
    await expect(section(page, "Assigned to you").count()).resolves.toBe(0);
    await expect(results.locator(".bp-result", { hasText: first }).count()).resolves.toBeGreaterThan(0);
    await expect(results.locator(".bp-result").last().innerText()).resolves.toMatch(/^\+?\s*New draft story: /);
    await box.fill("zzzz no such item");
    await expect(results.locator(".bp-result").count()).resolves.toBe(2);
    await expect(results.locator(".bp-result.hl").innerText()).resolves.toContain("New to-do: zzzz no such item");
    await box.press("Escape");
    await expect(box.inputValue()).resolves.toBe("");
    await expect(panel(page).count()).resolves.toBe(1);
    await section(page, "Assigned to you").waitFor();
    // With the box empty, Esc closes the panel.
    await box.press("Escape");
    await panel(page).waitFor({ state: "detached" });
    await page.close();
  }, T);

  it("the client chips: the room left from one total, amber only when over; the popover says the same; Keep open on the app's menu; Break down", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    const chips = page.locator(".client-chips button.cc-chip:not(.cc-more)");
    await chips.first().waitFor({ timeout: 30_000 });
    for (const t of await chips.allInnerTexts()) expect(t).toMatch(/^\S.* · (\d+h free|Full|\d+h over)/);
    // Amber only when over.
    for (const c of await chips.all()) expect(await c.evaluate((e) => e.classList.contains("over")), await c.innerText()).toBe(/ over/.test(await c.innerText()));
    const over = page.locator(".client-chips button.cc-chip.over").first();
    const room = (await over.innerText()).split(" · ")[1]!.replace(/\s*\d+$/, "").trim();
    await over.click();
    const pop = page.locator(".cc-pop");
    await pop.waitFor();
    // One total: the popover's first line starts with the chip's room, then the planned (musts and nice to have) and free hours.
    await expect(pop.locator("p").first().textContent()).resolves.toMatch(new RegExp(`^${room} · \\d+h planned · \\d+h free in its blocks$`));
    expect(await pop.locator("select").count()).toBe(0);
    await pop.getByRole("button", { name: /^Keep open for walk-ins/ }).click();
    await page.getByRole("menuitem", { name: "20%" }).click();
    await page.getByText(/Keeping 20% of .* open for walk-ins/).first().waitFor();
    await page.keyboard.press("Escape");
    // A client with a feature that isn't ready says so, with Break down beside it.
    const badge = page.locator(".client-chips button.cc-chip", { has: page.locator(".cc-badge") }).first();
    await badge.click();
    await pop.getByText("Needs stories").first().waitFor();
    await expect(pop.getByRole("button", { name: /Break down/ }).first().innerText()).resolves.toBe("Break down");
    await page.close();
  }, T);

  it("review fix: with the panel open the chips never clip: the ones that don't fit are under +N, which opens the rest", async () => {
    const { page } = await freshPage(h, { width: 1280, height: 720 });
    await openOn(page, "2026-11-02", "PM");
    const row = page.locator(".client-chips");
    const more = row.locator("button.cc-more");
    await more.waitFor();
    const box = (await row.boundingBox())!;
    for (const c of await row.locator("button.cc-chip").all()) {
      const b = (await c.boundingBox())!;
      expect(b.x + b.width, await c.innerText()).toBeLessThanOrEqual(box.x + box.width + 1);
    }
    const shown = await row.locator("button.cc-chip:not(.cc-more)").count();
    const n = Number((await more.innerText()).replace("+", ""));
    expect(n).toBeGreaterThan(0);
    await more.click();
    const rest = page.locator(".cc-rest");
    await expect(rest.locator("button.cc-chip").count()).resolves.toBe(n);
    // A chip from the list opens its popover.
    await rest.locator("button.cc-chip").first().click();
    await page.locator(".cc-pop:not(.cc-rest) h3").waitFor();
    expect(shown + n).toBeGreaterThan(1);
    await page.close();
  }, T);

  it("rows show their type as an icon named for the type; the panel is 380 px wide and nothing in it overflows sideways", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    await openOn(page, "2026-11-02", "PM");
    const icons = panel(page).locator(".aw-sec .type-icon");
    await icons.first().waitFor();
    for (const t of await icons.evaluateAll((els) => els.map((e) => e.getAttribute("data-type")))) expect(t).toBeTruthy();
    const box = (await panel(page).boundingBox())!;
    expect(Math.round(box.width)).toBe(380);
    const over = await panel(page).evaluate((el) => [...el.querySelectorAll<HTMLElement>("*")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === "visible" && e.clientWidth > 0).map((e) => e.className).slice(0, 5));
    expect(over).toEqual([]);
    await page.close();
  }, T);

  it("type scale: Week's header, the cards and the panel use only 11, 12, 13 and 15 px at 400, 500 and 600", async () => {
    const { page } = await freshPage(h);
    await openOn(page, "2026-11-02", "PM");
    const seen = await page.evaluate(() => {
      const out = new Set<string>();
      for (const el of document.querySelectorAll<HTMLElement>(".wd1-head *, .half.card *, aside.block-panel *")) {
        if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
        const s = getComputedStyle(el);
        out.add(`${s.fontSize} ${s.fontWeight}`);
      }
      return [...out];
    });
    for (const x of seen) expect(x, x).toMatch(/^(11|12|13|15)px (400|500|600)$/);
    await page.close();
  }, T);

  it("a day header's ⋯: no Confirm (CF-1), and Timebox my day goes to Day's timeline with no popup", async () => {
    const { page } = await freshPage(h);
    await openOn(page, "2026-11-02", "PM");
    await free(section(page, "Assigned to you")).locator("button.aw-plus").click();
    await dayMenu(page, "Mon");
    expect(await page.getByRole("menuitem", { name: /Confirm/ }).count()).toBe(0);
    await page.getByRole("menuitem", { name: "Timebox my day" }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/day/);
    expect(await page.locator("[role=dialog]").count()).toBe(0);
    await page.close();
  }, T);
});
