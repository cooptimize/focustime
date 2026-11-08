// AH-7: Readiness you can finish, in demo mode: Start here (the five most urgent, by the rule its "Why these?" states,
// narrowed by the toolbar's filters), the counts by kind (each applies its kind, again clears it), fixing in the row
// (each editor on the row, into the change set, the fixed piece gone, a ready item fading out with Undo, nothing
// written before Save), progress (pending, then fixed this week once saved), and Skip (into Skipped, kept on the
// server so a cleared browser still has it, Unskip). Screenshots go to FOCUSTIME_SHOTS (docs/ux/ah7).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 120_000;

describe.skipIf(!CHROMIUM)("AH-7: Readiness you can finish (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const open = async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    // Nothing goes to DevOps from Readiness: no preview or confirm until "Save N items to DevOps".
    const writes: string[] = [];
    page.on("request", (r) => {
      if (/"action":"devops\.(preview|confirm)"/.test(r.postData() ?? "")) writes.push(r.postData()!);
    });
    await page.evaluate(() => (location.hash = "#/ahead/fix"));
    await page.locator(".ah-fix-mode").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(300);
    return { page, errors, writes };
  };
  const start = (page: Page) => page.locator(".ah-fx-start .ah-fx-row");
  const startIds = (page: Page) => start(page).evaluateAll((rs) => rs.map((r) => Number(r.getAttribute("data-key")!.split(":").pop())));
  /** The full list's entries (not Start here, not Skipped, not context rows). */
  const listed = (page: Page) => page.locator(".ah-fx-client .ah-fx-row:not(.ctx)");
  const listRow = (page: Page, title: string) => page.locator(".ah-fx-client .ah-fx-row", { has: page.getByRole("link", { name: title, exact: true }) });
  const kind = (page: Page, word: string) => page.getByRole("group", { name: "Not ready, by kind" }).getByRole("button", { name: new RegExp(`^${word}`) });
  const shot = async (page: Page, name: string) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };

  it("Start here: the five most urgent by the rule, the rule in Why these?, narrowed by the filters", async () => {
    const { page, errors } = await open();
    // Dated soonest (Oct 30, Nov 4), then the undated by backlog place, mine first, then id.
    await expect(startIds(page)).resolves.toEqual([2240, 2213, 3320, 1100, 1113]);
    await expect(start(page).first().textContent()).resolves.toMatch(/^Harbor Health.*Patient portal login.*Needs stories/);
    const why = page.getByRole("button", { name: "Why these?" });
    await why.hover();
    const tip = page.getByRole("tooltip");
    await expect(tip.textContent()).resolves.toBe("The 5 most urgent here. Dated soonest first (target, else start; undated last), then nearest the top of its backlog, then yours.");
    await expect(why.getAttribute("aria-describedby")).resolves.toBe("ah-why-tip");
    await shot(page, "start-here");
    // The toolbar's filters narrow it: Atlas Freight only.
    await page.getByRole("button", { name: "Atlas Freight", exact: true }).click();
    await expect.poll(() => startIds(page)).toEqual([3320, 3350]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the counts by kind match the list; one applies that kind, again clears it", async () => {
    const { page, errors } = await open();
    const n = async (word: string) => Number((await kind(page, word).locator("strong").textContent())!.trim());
    const counts = { stories: await n("Needs stories"), dates: await n("No target date"), sized: await n("Unsized") };
    expect(counts).toEqual({ stories: 4, dates: 5, sized: 2 });
    await expect(kind(page, "Unassigned").getAttribute("aria-disabled")).resolves.toBe("true");
    await kind(page, "No target date").click();
    await expect.poll(() => kind(page, "No target date").getAttribute("aria-pressed")).toBe("true");
    await expect.poll(() => listed(page).count()).toBe(counts.dates);
    await expect(page.locator(".ah-tb-sumtext").textContent()).resolves.toContain("Not ready: No target date");
    await expect(page.locator("h2").first().textContent()).resolves.toContain(`${counts.dates} not ready yet`);
    // The other counts stay what each would show.
    await expect(n("Needs stories")).resolves.toBe(counts.stories);
    await shot(page, "counts");
    await kind(page, "No target date").click();
    await expect.poll(() => kind(page, "No target date").getAttribute("aria-pressed")).toBe("false");
    await expect.poll(() => listed(page).count()).toBe(8);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("fixing in the row: each editor opens on the row into the change set, the piece goes, a ready item fades out with Undo; Break down opens its panel; nothing written before Save", async () => {
    const { page, errors, writes } = await open();
    const pending = () => page.locator(".ah-pending").textContent();
    const before = Number((await pending())!.match(/(\d+) changes?/)![1]);
    // Supplier onboarding misses stories and a target date: both fixes are on the row. Set dates first.
    const supplier = listRow(page, "Supplier onboarding");
    await expect(supplier.getByRole("button").allTextContents()).resolves.toEqual(expect.arrayContaining(["Break down", "Set dates", "Skip"]));
    await supplier.getByRole("button", { name: "Set dates: Supplier onboarding" }).click();
    const pop = page.locator(".cell-pop");
    await pop.waitFor();
    // On the row: the popover sits by it.
    const [p, r] = [(await pop.boundingBox())!, (await supplier.boundingBox())!];
    expect(Math.abs(p.y - (r.y + r.height)) < 80 || Math.abs(p.y + p.height - r.y) < 80).toBe(true);
    await shot(page, "editor-open");
    // It has no start either, so Start comes first, then Target (AH-1's order).
    await pop.getByRole("textbox", { name: "Start date" }).fill("2026-11-23");
    await pop.getByRole("button", { name: "Save" }).click();
    await page.getByRole("textbox", { name: "Target date" }).fill("2026-12-11");
    await page.locator(".cell-pop").getByRole("button", { name: "Save" }).click();
    await expect.poll(pending).toContain(`${before + 2} changes to save`);
    // The piece went; the item is still here for its stories.
    await expect.poll(() => supplier.locator(".ah-fx-side").textContent()).not.toContain("No target date");
    await expect(supplier.locator(".ah-fx-side").textContent()).resolves.toContain("Needs stories");
    await expect(page.locator(".ah-fx-progress").textContent()).resolves.toMatch(/1 pending save/);
    // Size on a story with only that gap: it's ready, so it fades out with Undo.
    const exportRow = listRow(page, "Export button on the order page");
    await exportRow.getByRole("button", { name: "Size: Export button on the order page" }).click();
    await page.getByRole("textbox", { name: "Story Points" }).fill("3");
    await page.locator(".cell-pop").getByRole("button", { name: "Save" }).click();
    const toast = page.locator(".undo-toast");
    await expect.poll(() => toast.textContent()).toContain("#1113 is ready");
    await expect(page.locator(".ah-fx-row.leaving").count()).resolves.toBeGreaterThan(0);
    await shot(page, "undo-toast");
    await expect.poll(() => listRow(page, "Export button on the order page").count(), { timeout: 5_000 }).toBe(0);
    await expect(page.locator(".ah-fx-progress").textContent()).resolves.toMatch(/2 pending save/);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => listRow(page, "Export button on the order page").count()).toBe(1);
    await expect.poll(() => toast.textContent()).toContain("Undone");
    // Break down opens the existing Break down panel.
    await supplier.getByRole("button", { name: "Break down: Supplier onboarding" }).click();
    await page.getByRole("dialog", { name: /Break down/ }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("progress: a fix counts as pending until it's saved to DevOps, then as fixed this week", async () => {
    const { page, errors } = await open();
    // Leave only the change about to be made, so the review saves just it.
    await page.locator(".ah-pending").getByRole("button", { name: "Review" }).click();
    let panel = page.getByRole("dialog", { name: "Review changes" });
    await panel.getByRole("button", { name: "Discard all" }).click();
    await panel.getByRole("button", { name: "Discard all" }).click();
    await expect.poll(() => page.locator(".ah-pending").count()).toBe(0);
    if (await panel.count()) await panel.getByRole("button", { name: "Close" }).click();
    await expect.poll(() => panel.count()).toBe(0);
    const carrier = listRow(page, "Carrier rate alerts");
    await carrier.getByRole("button", { name: "Set dates: Carrier rate alerts" }).click();
    const pop = page.locator(".cell-pop");
    await pop.waitFor();
    if (await pop.getByRole("textbox", { name: "Start date" }).count()) {
      await pop.getByRole("textbox", { name: "Start date" }).fill("2026-12-01");
      await pop.getByRole("button", { name: "Save" }).click();
    }
    await page.getByRole("textbox", { name: "Target date" }).fill("2026-12-18");
    await page.locator(".cell-pop").getByRole("button", { name: "Save" }).click();
    await expect.poll(() => page.locator(".ah-fx-progress").textContent()).toBe("1 pending save");
    await page.locator(".ah-pending").getByRole("button", { name: "Review" }).click();
    panel = page.getByRole("dialog", { name: "Review changes" });
    await panel.getByRole("button", { name: /^Save (\d items? )?to DevOps$/ }).click();
    // The write framework's own preview, then Confirm.
    const confirm = page.locator(".wd-actions button.commit");
    await confirm.waitFor({ timeout: 15_000 });
    await confirm.click();
    await expect.poll(() => page.locator(".ah-fx-progress").textContent(), { timeout: 30_000 }).toBe("1 fixed this week");
    if (await panel.count()) await panel.getByRole("button", { name: "Close" }).click();
    await expect.poll(() => panel.count()).toBe(0);
    // A second fix, pending: both numbers.
    await listRow(page, "Export button on the order page").getByRole("button", { name: "Size: Export button on the order page" }).click();
    await page.getByRole("textbox", { name: "Story Points" }).fill("2");
    await page.locator(".cell-pop").getByRole("button", { name: "Save" }).click();
    await expect.poll(() => page.locator(".ah-fx-progress").textContent()).toBe("1 fixed this week · 1 pending save");
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "progress");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Skip: into Skipped (folded), not in Start here, kept on the server (a cleared browser still has it), Unskip", async () => {
    const { page, errors } = await open();
    await expect(startIds(page)).resolves.toContain(2240);
    await start(page).first().getByRole("button", { name: "Skip Patient portal login for now" }).click();
    await expect.poll(() => startIds(page)).not.toContain(2240);
    await expect(listRow(page, "Patient portal login").count()).resolves.toBe(0);
    const head = page.getByRole("button", { name: /Skipped \(1\)/ });
    await expect(head.getAttribute("aria-expanded")).resolves.toBe("false");
    // Stored in FocusTime's data, not the browser: cleared storage and a reload keep it.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator(".ah-fix-mode").waitFor({ timeout: 60_000 });
    await expect.poll(() => page.getByRole("button", { name: /Skipped \(1\)/ }).count()).toBe(1);
    await page.getByRole("button", { name: /Skipped \(1\)/ }).click();
    const skipped = page.locator(".ah-fx-skipped .ah-fx-row");
    await expect(skipped.textContent()).resolves.toMatch(/Harbor Health.*Patient portal login.*back Nov 16/);
    await skipped.scrollIntoViewIfNeeded();
    await shot(page, "skipped");
    await skipped.getByRole("button", { name: "Unskip Patient portal login" }).click();
    await expect.poll(() => startIds(page)).toContain(2240);
    await expect(page.getByRole("button", { name: /Skipped/ }).count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it.skipIf(!SHOTS)("screenshot: Readiness after, at 1440", async () => {
    const { page } = await open();
    await shot(page, "after-1440");
    await page.close();
  }, T);
});
