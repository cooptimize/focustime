// AH-7, BL-1: Needs attention you can finish (was Readiness), in demo mode: Start here (the five most urgent, by the
// rule its tooltip states, narrowed by the toolbar's filters), the counts by kind (each applies its kind, again clears
// it), fixing in the row (each editor on the row, into the change set, the fixed piece gone, a ready item fading out
// with Undo, nothing written before Save), progress (pending, then fixed this week once saved), and Skip (into
// Skipped, kept on the server so a cleared browser still has it, Unskip). Screenshots go to FOCUSTIME_SHOTS.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 120_000;

describe.skipIf(!CHROMIUM)("AH-7, BL-1: Needs attention you can finish (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const open = async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    // Nothing goes to DevOps from Needs attention: no preview or confirm until "Save N items to DevOps".
    const writes: string[] = [];
    page.on("request", (r) => {
      if (/"action":"devops\.(preview|confirm)"/.test(r.postData() ?? "")) writes.push(r.postData()!);
    });
    await page.evaluate(() => (location.hash = "#/backlog/attention"));
    await page.locator(".ah-att-line").waitFor({ timeout: 60_000 });
    await page.locator(".ah-client .ah-row").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(300);
    return { page, errors, writes };
  };
  /** The entries listed (not rows shown only for what's under them). */
  const listed = (page: Page) => page.locator(".ah-client .ah-row:not(.context)");
  const ids = (page: Page) => listed(page).evaluateAll((rs) => rs.map((r) => Number(r.getAttribute("data-key")!.split(":").pop())).sort((a, b) => a - b));
  const listRow = (page: Page, title: string) => page.locator(".ah-client .ah-row", { has: page.getByRole("link", { name: title, exact: true }) });
  const line = (page: Page) => page.getByRole("group", { name: "Needs attention, by kind" });
  const kind = (page: Page, word: string) => line(page).getByRole("button", { name: new RegExp(`^${word}`) });
  const shot = async (page: Page, name: string) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };
  /** A fix button in its row's Status cell. */
  const fix = (page: Page, title: string, action: string) => listRow(page, title).getByRole("button", { name: `${action}: ${title}` });

  it("Start here: the five most urgent by the rule, the rule in its tooltip, narrowed by the filters", async () => {
    const { page, errors } = await open();
    const start = kind(page, "Start here");
    await expect(start.locator("strong").textContent()).resolves.toBe("5");
    await expect(start.getAttribute("title")).resolves.toContain("Dated soonest first (target, else start; undated last), then nearest the top of its backlog, then yours.");
    await start.click();
    await expect.poll(() => start.getAttribute("aria-pressed")).toBe("true");
    // Dated soonest (Oct 30, Nov 4), then the undated by backlog place, mine first, then id. BL-1: Stale is one of Needs
    // attention's reasons, so the stale #4434 near the top of its backlog takes a place.
    await expect.poll(() => ids(page)).toEqual([1100, 2213, 2240, 3320, 4434]);
    const why = line(page).getByRole("button", { name: "Why these?" });
    await why.hover();
    await expect(page.locator("#ah-why-tip").textContent()).resolves.toContain("In backlog order");
    await expect(why.getAttribute("aria-describedby")).resolves.toBe("ah-why-tip");
    await shot(page, "start-here");
    // The toolbar's filters narrow it: Atlas Freight only.
    await page.locator(".ah-toolbar").getByRole("button", { name: "Atlas Freight", exact: true }).click();
    await expect.poll(() => ids(page)).toEqual([3320, 3330, 3350, 3353]);
    await kind(page, "Start here").click();
    await expect.poll(() => kind(page, "Start here").getAttribute("aria-pressed")).toBe("false");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the counts by kind match the list; one applies that kind, again clears it", async () => {
    const { page, errors } = await open();
    const n = async (word: string) => Number((await kind(page, word).locator("strong").textContent())!.trim());
    const all = await listed(page).count();
    const counts = { stories: await n("Needs stories"), dates: await n("No target date"), sized: await n("Unsized") };
    expect(counts).toEqual({ stories: 4, dates: 5, sized: 2 });
    await expect(kind(page, "Unassigned").getAttribute("aria-disabled")).resolves.toBe("true");
    await kind(page, "No target date").click();
    await expect.poll(() => kind(page, "No target date").getAttribute("aria-pressed")).toBe("true");
    await expect.poll(() => listed(page).count()).toBe(counts.dates);
    // One chip per meaning: Needs attention, then the kind.
    await expect(page.locator(".ah-tb-summary .ah-tb-chip").allTextContents()).resolves.toEqual([expect.stringContaining("Needs attention"), expect.stringContaining("No target date")]);
    await expect(page.locator(".follow-ups-head h2").textContent()).resolves.toContain(`${counts.dates} need attention`);
    // The other counts stay what each would show.
    await expect(n("Needs stories")).resolves.toBe(counts.stories);
    await shot(page, "counts");
    await kind(page, "No target date").click();
    await expect.poll(() => kind(page, "No target date").getAttribute("aria-pressed")).toBe("false");
    await expect.poll(() => listed(page).count()).toBe(all);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("fixing in the row: each editor opens on the row into the change set, the piece goes, a ready item fades out with Undo; Break down opens its panel; nothing written before Save", async () => {
    const { page, errors, writes } = await open();
    const pending = () => page.locator(".ah-pending").textContent();
    const before = Number((await pending())!.match(/(\d+) changes?/)![1]);
    // Supplier onboarding misses stories and a target date: its first fix (Break down) and Skip are on the row; its
    // Dates cell takes the date.
    const supplier = listRow(page, "Supplier onboarding");
    await expect(supplier.locator(".ah-fix").getByRole("button").allTextContents()).resolves.toEqual(["Break down", "Skip"]);
    await supplier.locator(".ah-col-dates").click();
    const pop = page.locator(".cell-pop");
    await pop.waitFor();
    // On the row: the popover sits by it.
    const [p, r] = [(await pop.boundingBox())!, (await supplier.boundingBox())!];
    // (Too tall for either side, the Dates editor sits over its row, all on screen: AH-5's rule.)
    expect(Math.abs(p.y - (r.y + r.height)) < 80 || Math.abs(p.y + p.height - r.y) < 80 || (p.y <= r.y + 1 && p.y + p.height >= r.y + r.height)).toBe(true);
    await shot(page, "editor-open");
    // One Dates editor: Start, then Target, one Save.
    await pop.getByRole("textbox", { name: "Start date" }).fill("2026-11-23");
    await pop.getByRole("radio", { name: /^Target/ }).click();
    await pop.getByRole("textbox", { name: "Target date" }).fill("2026-12-11");
    await pop.getByRole("button", { name: "Save" }).click();
    await expect.poll(pending).toContain(`${before + 2} changes to save`);
    // The piece went; the item is still here for its stories.
    await expect.poll(() => supplier.locator(".ah-col-status").getAttribute("aria-label")).not.toContain("No target date");
    await expect(supplier.count()).resolves.toBe(1);
    await expect(page.locator(".ah-fx-progress").textContent()).resolves.toMatch(/1 pending save/);
    // Size on a story with only that gap: it's ready, so it fades out with Undo.
    await fix(page, "Export button on the order page", "Size").click();
    await page.getByRole("textbox", { name: "Story Points" }).fill("3");
    await page.locator(".cell-pop").getByRole("button", { name: "Save" }).click();
    const toast = page.locator(".undo-toast");
    await expect.poll(() => toast.textContent()).toContain("#1113 is ready");
    await expect(page.locator(".ah-row.leaving").count()).resolves.toBeGreaterThan(0);
    await shot(page, "undo-toast");
    await expect.poll(() => listRow(page, "Export button on the order page").count(), { timeout: 5_000 }).toBe(0);
    await expect(page.locator(".ah-fx-progress").textContent()).resolves.toMatch(/2 pending save/);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => listRow(page, "Export button on the order page").count()).toBe(1);
    await expect.poll(() => toast.textContent()).toContain("Undone");
    // Break down opens the existing Break down panel.
    await fix(page, "Supplier onboarding", "Break down").click();
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
    await fix(page, "Carrier rate alerts", "Set dates").click();
    const pop = page.locator(".cell-pop");
    await pop.waitFor();
    if (await pop.getByRole("radio", { name: /^Target/ }).count()) await pop.getByRole("radio", { name: /^Target/ }).click();
    await pop.getByRole("textbox", { name: "Target date" }).fill("2026-12-18");
    await pop.getByRole("button", { name: "Save" }).click();
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
    await fix(page, "Export button on the order page", "Size").click();
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
    await expect.poll(() => ids(page)).toContain(2240);
    await listRow(page, "Patient portal login").getByRole("button", { name: "Skip Patient portal login for now" }).click();
    await expect.poll(() => ids(page)).not.toContain(2240);
    await kind(page, "Start here").click();
    await expect.poll(() => ids(page)).not.toContain(2240);
    await kind(page, "Start here").click();
    const head = page.getByRole("button", { name: /Skipped \(1\)/ });
    await expect(head.getAttribute("aria-expanded")).resolves.toBe("false");
    // Stored in FocusTime's data, not the browser: cleared storage and a reload keep it.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator(".ah-att-line").waitFor({ timeout: 60_000 });
    await expect.poll(() => page.getByRole("button", { name: /Skipped \(1\)/ }).count()).toBe(1);
    await page.getByRole("button", { name: /Skipped \(1\)/ }).click();
    const skipped = page.locator(".ah-fx-skipped .ah-fx-row");
    await expect(skipped.textContent()).resolves.toMatch(/Harbor Health.*Patient portal login.*back Nov 16/);
    await skipped.scrollIntoViewIfNeeded();
    await shot(page, "skipped");
    await skipped.getByRole("button", { name: "Unskip Patient portal login" }).click();
    await expect.poll(() => ids(page)).toContain(2240);
    await expect(page.getByRole("button", { name: /Skipped/ }).count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
