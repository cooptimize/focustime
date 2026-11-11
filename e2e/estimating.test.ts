// E2 (D446): estimating in hours. WD-1: a client's fit is its chip on Week ("Northwind 9h of 5h", amber when over, the
// popover's "5h free · 9h planned · about 4h over"); a feature's estimate is its ⋯ › Estimate in Add work, in whole
// hours; a story's size is its to-do's chip (S 1h, M 2h, L 4h, unsized 1h by default). The load rules themselves are
// unit tests (plan/). Profile photos, in demo mode (fictional data, generated avatars, no Graph calls). The scans read
// every view for decimals and fractions, and Week, Add work and Plan ahead for blocks used as an amount (hours are the unit).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, openPlanDay, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
/** Decimals and fractions: "0.8 blocks", "1.5 h", "½", "¼", "¾". Times (9:30) and dates are fine. */
const FRACTION = /(?<![\d:])\d+[.,]\d+(?![\d:])|½|¼|¾/i;
/** A block as an amount of work: "2 blocks", "1½ blocks", "half a block free", "blocks planned". A block as the place is fine. */
const BLOCK_AMOUNT = /\d\s*(½\s*)?blocks?\b|½\s*blocks?|half a block\b|\bblocks? (free|planned|available|over|left)\b|\bof \d+ blocks?/i;

describe.skipIf(!CHROMIUM)("estimating in hours and photos (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  /** WD-1: Week with Add work open on Monday PM (a Northwind block in the demo). */
  const addWork = async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("2");
    await page.locator('[data-drop="2026-11-02:PM"] .add-work.add-row').first().click();
    await page.locator("aside.add-work-panel").waitFor();
    return { page, errors };
  };
  const watch = (page: import("playwright-core").Page) => page.evaluate(() => { const d = document.createElement("span"); d.style.color = "var(--watch)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });

  it("each client chip: the room left in hours, amber when over, never red; its popover says the same total in hours", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("2");
    const chips = page.locator(".client-chips button.cc-chip");
    await chips.first().waitFor({ timeout: 30_000 });
    for (const t of await chips.allInnerTexts()) expect(t).toMatch(/^\S.* · (\d+h free|Full|\d+h over)/);
    const over = page.locator(".client-chips button.cc-chip.over").first();
    await expect(over.evaluate((e) => getComputedStyle(e).color)).resolves.toBe(await watch(page));
    await over.click();
    const pop = page.locator(".cc-pop");
    await expect(pop.locator("p.cc-over").textContent()).resolves.toMatch(/^\d+h over · \d+h planned · \d+h free in its blocks$/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a feature's ⋯ › Estimate: whole hours, out of range changes nothing; a story's size from its to-do's chip", async () => {
    const { page, errors } = await addWork();
    const feats = page.locator("aside.add-work-panel .aw-feature");
    await feats.first().waitFor();
    const est = feats.filter({ has: page.locator(".aw-feat-head") }).first();
    const name = (await est.locator(".aw-feat-name").first().innerText()).trim();
    const more = () => est.locator(".aw-feat-head").getByRole("button", { name: /^More for / }).click();
    const hint = async () => {
      await more();
      const t = await page.getByRole("menuitem", { name: /^Estimate/ }).textContent();
      await page.keyboard.press("Escape");
      return t;
    };
    const estimate = async (v: string) => {
      await more();
      await page.getByRole("menuitem", { name: /^Estimate/ }).click();
      const box = page.locator(".menu-prompt input");
      await box.fill(v);
      await box.press("Enter");
    };
    await more();
    const derived = await page.getByRole("menuitem", { name: /^Estimate/ }).isDisabled();
    await page.keyboard.press("Escape");
    if (!derived) {
      await estimate("6");
      await expect.poll(hint, { message: name }).toMatch(/about 6h/);
      // A typed value out of range changes nothing.
      await estimate("81");
      await page.waitForTimeout(400);
      await expect(hint()).resolves.toMatch(/about 6h/);
    }
    // A to-do's size chip on its card (shown on hover): XS, S, M, L or Clear.
    const row = page.locator(".half.card li", { has: page.locator("button.size-chip") }).first();
    await row.hover();
    await row.locator("button.size-chip").first().click();
    await expect(page.getByRole("menuitem").allTextContents()).resolves.toEqual([expect.stringContaining("XS · 30 min"), expect.stringContaining("S · 1h"), expect.stringContaining("M · 2h"), expect.stringContaining("L · 4h"), expect.stringContaining("Clear")]);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("SZ-1: Count unsized work as has its scale beside it, and an unsized to-do's chip follows it", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/settings/planning"));
    const select = page.getByRole("combobox", { name: "Count unsized work as" });
    await expect.poll(() => select.inputValue()).toBe("60");
    await expect(select.locator("option").allTextContents()).resolves.toEqual(["30 min", "1h", "2h", "3h"]);
    await expect(page.locator("[data-size-scale]").textContent()).resolves.toBe("XS 30 min · S 1h · M 2h · L 4h");
    await select.selectOption("120");
    await page.getByText("Saved").first().waitFor();
    await page.keyboard.press("Escape");
    // A plain to-do from Add work's type box is unsized.
    await openPlanDay(page);
    const box = page.locator("aside.add-work-panel .aw-box input");
    await box.fill("Unsized check for SZ-1");
    await box.press("Shift+Enter");
    const unsized = page.locator(".half.card li", { hasText: "Unsized check for SZ-1" }).locator(".size-chip.unsized").first();
    await expect.poll(() => unsized.getAttribute("title"), { timeout: 20_000 }).toMatch(/^Not sized: counts as 2h/);
    // Back to the default, for the tests after this one.
    await page.evaluate(() => (location.hash = "#/settings/planning"));
    await page.getByRole("combobox", { name: "Count unsized work as" }).selectOption("60");
    await page.getByText("Saved").first().waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("photos: generated avatars with presence on the corner; initials when someone has none", async () => {
    const { page, errors } = await addWork();
    await expect.poll(() => page.locator(".topbar .person-chip .avatar img").count(), { timeout: 10_000 }).toBe(1);
    await page.locator("aside.add-work-panel .aw-feat-head").first().getByRole("button", { name: /^More for / }).click();
    await page.getByRole("menuitem", { name: /Ask to collaborate/ }).click();
    const dlg = page.getByRole("dialog", { name: /Ask to collaborate/ });
    await expect.poll(() => dlg.locator(".help-people .avatar img").count(), { timeout: 10_000 }).toBe(3);
    await expect(dlg.locator(".help-people .avatar-initials").allTextContents()).resolves.toEqual(["TK"]);
    // Presence comes from its own call (presence.people), after the photos: wait for it as for them.
    await expect.poll(() => dlg.locator(".help-people .avatar .pres").count(), { timeout: 10_000 }).toBe(4);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("no decimals or fractions anywhere: Week with Add work, Day, Check-in, Close out, Status, Ahead's Grid and Gantt", async () => {
    for (const bad of ["Room for about 1.5 blocks more", "0.8 blocks", "¼ block", "¾ blocks", "1.5 h", "½ block", "2½ planned"]) expect(bad).toMatch(FRACTION);
    for (const ok of ["9:30 AM", "Nov 2, 2026", "8h free · 10h planned", "about 6h", "1:30 PM to 5:00 PM"]) expect(ok).not.toMatch(FRACTION);
    const { page } = await freshPage(h);
    const views: [string, string][] = [
      ["#/week/2026-11-02/add", "aside.add-work-panel .aw-sec"],
      ["#/week", ".half.card"],
      ["#/day", ".today-view"],
      ["#/day/checkin", "main"],
      ["#/day/closeout", "main"],
      ["#/status", "main"],
      ["#/ahead", ".ah-row"],
      ["#/ahead/gantt", ".pa-cap"],
    ];
    for (const [hash, ready] of views) {
      await page.evaluate((x) => (location.hash = x), hash);
      await page.locator(ready).first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(600);
      const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
      const titles = await page.locator("[title]").evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
      for (const t of [text, ...titles]) expect(t.match(FRACTION)?.[0] ?? null, `${hash}: ${t.slice(Math.max(0, (t.search(FRACTION) ?? 0) - 40), (t.search(FRACTION) ?? 0) + 40)}`).toBeNull();
    }
    await page.close();
  }, T);

  it("no block as an amount on Week, in Add work, the client chips or Plan ahead: estimates are hours, with about where estimated", async () => {
    for (const bad of ["2 blocks", "1½ blocks", "½ block", "half a block free", "2 blocks free", "1 of 2 blocks", "blocks planned"]) expect(bad).toMatch(BLOCK_AMOUNT);
    for (const ok of ["One focus block", "Pinned to this block", "No block", "Click a block to plan", "8h free · 10h planned", "Free focus time in Northwind's blocks this week"]) expect(ok).not.toMatch(BLOCK_AMOUNT);
    const { page, errors } = await freshPage(h);
    const scan = async (where: string) => {
      const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
      const titles = await page.locator("[title], [aria-label]").evaluateAll((els) => els.flatMap((e) => [e.getAttribute("title") ?? "", e.getAttribute("aria-label") ?? ""]));
      for (const t of [text, ...titles]) expect(t.match(BLOCK_AMOUNT)?.[0] ?? null, `${where}: ${t.slice(Math.max(0, t.search(BLOCK_AMOUNT) - 40), t.search(BLOCK_AMOUNT) + 40)}`).toBeNull();
      // Every estimate a stepper shows is whole hours, "about" unless it comes from sized stories.
      for (const v of await page.locator(".hours-stepper .hs-value").allTextContents()) expect(v, where).toMatch(/^(about )?\d+h$/);
      for (const v of await page.locator(".size-chip").allTextContents()) expect(v, where).toMatch(/^(S|M|L|Size\?)( · \d+h)?$/);
    };
    await openPlanDay(page);
    await page.waitForTimeout(600);
    await scan("Week with Add work");
    const chips = page.locator(".client-chips button.cc-chip");
    for (let i = 0; i < (await chips.count()); i++) {
      await chips.nth(i).click();
      await page.locator(".cc-pop").waitFor();
      await scan(`client chip ${i + 1}`);
      await page.keyboard.press("Escape");
    }
    await page.evaluate(() => (location.hash = "#/ahead/gantt"));
    await page.locator(".pa-cap").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(600);
    await scan("Plan ahead");
    // AH-6: a feature's hours per week are in its marker's popover.
    await page.locator(".pa-marker").first().focus();
    await page.locator(".pa-pop").waitFor();
    await scan("Plan ahead, a marker's popover");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
