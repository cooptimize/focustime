// WD-1: one Week, in a real browser on the demo (Monday Nov 2, 9:30 AM; Tuesday for the unfinished to-do). The
// scenarios from the step: + Add and Undo, a feature placed as a placeholder then broken down, the panel following the
// selected block, Confirm week and Changed since you confirmed, the To place line, the star and the remove rule, every
// old address, no Plan buttons, Team hidden, Status's count, the phone's sheet, and the first block's height at 1440×900.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 180_000;
const block = (page: Page, date: string, half: string) => page.locator(`[data-drop="${date}:${half}"]`).first();
const panel = (page: Page) => page.locator("aside.add-work-panel");
const panelTitle = (page: Page) => panel(page).locator(".aw-title").innerText();
const room = (page: Page) => panel(page).locator(".aw-room").first().innerText();
const hash = (page: Page) => page.evaluate(() => location.hash);
async function openWeek(page: Page) {
  await page.keyboard.press("2");
  await page.locator(".half.card").first().waitFor({ timeout: 30_000 });
}
async function addOn(page: Page, date: string, half: string) {
  await block(page, date, half).locator(".add-work.add-row").click();
  await panel(page).waitFor();
  await expect.poll(() => panel(page).getAttribute("data-add-panel")).toBe(`${date}|${half}`);
}
/** The first story row in the panel's own sections (not To place) that isn't on this block yet. */
const freeRow = (page: Page) => panel(page).locator(".aw-sec .aw-row:not(.placed)").filter({ has: page.locator("button.aw-plus") }).first();
const tag = (page: Page) => page.locator(".week-tag").innerText();

describe.skipIf(!CHROMIUM)("WD-1: one Week (browser, demo)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("+ Add on Tuesday AM: add a story with +, it's on the card and the room updates, then Undo takes it off", async () => {
    const { page, errors } = await freshPage(h);
    await openWeek(page);
    await addOn(page, "2026-11-03", "AM");
    await expect(panelTitle(page)).resolves.toMatch(/^Add to \S.* · Tue AM$/);
    const before = await room(page);
    const row = freeRow(page);
    const title = (await row.locator(".aw-row-title").innerText()).trim();
    await row.locator("button.aw-plus").click();
    await expect.poll(() => block(page, "2026-11-03", "AM").innerText()).toContain(title);
    await expect.poll(() => room(page)).not.toBe(before);
    // The row now says it's here.
    await expect.poll(() => panel(page).locator(".aw-row.placed", { hasText: title }).count()).toBeGreaterThan(0);
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => block(page, "2026-11-03", "AM").innerText()).not.toContain(title);
    await expect.poll(() => room(page)).toBe(before);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a feature dragged onto a block is a placeholder with Needs stories · Break down; breaking it down brings its stories", async () => {
    const { page, errors } = await freshPage(h);
    await openWeek(page);
    await addOn(page, "2026-11-02", "PM");
    const feature = panel(page).locator(".aw-feature", { hasText: "Supplier onboarding" }).first();
    await feature.locator(".aw-feat-head").dragTo(block(page, "2026-11-02", "PM"));
    const placed = block(page, "2026-11-02", "PM").locator(".placed-feature", { hasText: "Supplier onboarding" });
    await placed.waitFor({ timeout: 15_000 });
    await expect(placed.innerText()).resolves.toContain("Needs stories");
    // In the panel the feature is now on this block.
    await feature.getByRole("img", { name: "On this block as a placeholder" }).waitFor();
    await placed.getByRole("button", { name: /Break down/ }).click();
    const bd = page.getByRole("dialog", { name: /^Break down Feature: / });
    await bd.getByRole("button", { name: "Run" }).click();
    await bd.getByRole("listitem", { name: "Card Supplier sign-up form" }).waitFor({ timeout: 30_000 });
    await bd.getByRole("button", { name: /^Preview \d+ items/ }).click();
    await bd.getByRole("button", { name: "Create all" }).click();
    await bd.getByText(/Created \d+|\d+ created|in DevOps/).first().waitFor({ timeout: 30_000 });
    await bd.getByRole("button", { name: "Done" }).click();
    await expect.poll(() => placed.innerText(), { timeout: 30_000 }).toMatch(/\d+ stor(y|ies)/);
    await expect.poll(() => feature.locator(".aw-row").count(), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("with the panel open, clicking another block moves it there: title and room change, the panel stays; Esc closes it", async () => {
    const { page } = await freshPage(h);
    await openWeek(page);
    await addOn(page, "2026-11-03", "AM");
    const before = { title: await panelTitle(page), room: await room(page) };
    await block(page, "2026-11-03", "PM").locator(".card-client").first().click();
    await expect.poll(() => panel(page).getAttribute("data-add-panel")).toBe("2026-11-03|PM");
    await expect(panelTitle(page)).resolves.toMatch(/· Tue PM$/);
    expect(await panelTitle(page)).not.toBe(before.title);
    await expect(hash(page)).resolves.toBe("#/week/day/2026-11-03/PM");
    await page.keyboard.press("Escape");
    await panel(page).waitFor({ state: "detached" });
    await expect(hash(page)).resolves.toBe("#/week");
    await page.close();
  }, T);

  it("Confirm week, add a story: the tag reads Changed since you confirmed; Confirm again", async () => {
    const { page } = await freshPage(h);
    await openWeek(page);
    if ((await tag(page)) === "Draft") await page.getByRole("button", { name: "Confirm week" }).click();
    await expect.poll(() => tag(page)).toBe("Confirmed");
    await addOn(page, "2026-11-03", "PM");
    await freeRow(page).locator("button.aw-plus").click();
    await expect.poll(() => tag(page)).toBe("Changed since you confirmed");
    await page.getByRole("button", { name: "Confirm again" }).click();
    await expect.poll(() => tag(page)).toBe("Confirmed");
    await expect(page.getByRole("button", { name: "Confirm again" }).count()).resolves.toBe(0);
    await page.close();
  }, T);

  it("review fix: Confirm week, add a story, Undo: the week reads Confirmed again and the add's feature is gone", async () => {
    const { page } = await freshPage(h);
    await openWeek(page);
    if ((await tag(page)) === "Draft") await page.getByRole("button", { name: "Confirm week" }).click();
    await expect.poll(() => tag(page)).toBe("Confirmed");
    await addOn(page, "2026-11-03", "PM");
    const features = () => panel(page).locator(".aw-feature .aw-feat-name").allInnerTexts();
    const before = await features();
    // A story under More from DevOps whose feature isn't on the week yet, else any free row.
    await freeRow(page).locator("button.aw-plus").click();
    await expect.poll(() => tag(page)).toBe("Changed since you confirmed");
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => tag(page)).toBe("Confirmed");
    await expect.poll(features).toEqual(before);
    await page.close();
  }, T);

  it("review fix: the panel opened on next week closes onto next week (Esc, + Add, W)", async () => {
    const { page } = await freshPage(h);
    await openWeek(page);
    await page.keyboard.press("]");
    await page.locator(".week-head h2", { hasText: "Nov 9" }).waitFor();
    for (const close of ["Escape", "head", "w"] as const) {
      await addOn(page, "2026-11-10", "AM");
      if (close === "head") await page.locator(".add-work-head").click();
      else await page.keyboard.press(close);
      await panel(page).waitFor({ state: "detached" });
      await expect(page.locator(".week-head h2").innerText(), close).resolves.toContain("Nov 9");
      await expect(hash(page), close).resolves.toBe("#/week/2026-11-09");
    }
    await page.close();
  }, T);

  it("star a feature and reload: still a must; Remove from this week is refused while one of its stories is placed", async () => {
    const { page } = await freshPage(h);
    await openWeek(page);
    await addOn(page, "2026-11-02", "PM");
    const feature = panel(page).locator(".aw-feature", { has: page.locator(".aw-star:not(.on)") }).first();
    const name = (await feature.locator(".aw-feat-name").innerText()).trim();
    const row = () => panel(page).locator(".aw-feature", { hasText: name }).first();
    await row().locator(".aw-star").click();
    await expect.poll(() => row().locator(".aw-star").getAttribute("aria-pressed")).toBe("true");
    await page.reload();
    await panel(page).waitFor({ timeout: 30_000 });
    await expect.poll(() => row().locator(".aw-star").getAttribute("aria-pressed"), { timeout: 30_000 }).toBe("true");
    // A must with a story placed: the remove item names where it's placed instead of removing it.
    const placedFeature = panel(page).locator(".aw-feature", { has: page.locator(".aw-where") }).first();
    const fname = (await placedFeature.locator(".aw-feat-name").innerText()).trim();
    await placedFeature.getByRole("button", { name: `More for ${fname}` }).click();
    await page.getByRole("menuitem", { name: "Remove from this week" }).click();
    await page.getByText(new RegExp(`${fname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is placed on .+\\. Take those off first\\.`)).first().waitFor();
    await expect(panel(page).locator(".aw-feature", { hasText: fname }).count()).resolves.toBeGreaterThan(0);
    await page.close();
  }, T);

  it("every old address lands where it should", async () => {
    const { page } = await freshPage(h);
    const lands: [string, string, boolean][] = [
      ["#/today", "#/day", false],
      ["#/today/2026-11-03", "#/day/2026-11-03", false],
      ["#/today/checkin", "#/day/checkin", false],
      ["#/today/closeout/2026-10-30", "#/day/closeout/2026-10-30", false],
      ["#/week/status", "#/status", false],
      ["#/week/status/needs", "#/status/needs", false],
      ["#/week/commit", "#/week/add", true],
      ["#/week/commit/2026-11-09", "#/week/2026-11-09/add", true],
      ["#/week/plan/2026-11-09", "#/week/2026-11-09/add", true],
      ["#/today/plan/2026-11-03/PM", "#/week/day/2026-11-03/PM", true],
      ["#/week/day/2026-11-04/AM", "#/week/day/2026-11-04/AM", true],
      ["#/week/team", "#/week/team", false],
      ["#/roadmap", "#/ahead", false],
    ];
    for (const [old, now, withPanel] of lands) {
      await page.evaluate((h) => (location.hash = h), old);
      await expect.poll(() => hash(page), { message: old }).toBe(now);
      await expect.poll(() => panel(page).count(), { message: `${old}: the panel` }).toBe(withPanel ? 1 : 0);
    }
    // The panel on a block opens that week and selects the block; the team address opens Team.
    await page.evaluate(() => (location.hash = "#/week/day/2026-11-10/AM"));
    await expect.poll(() => panel(page).getAttribute("data-add-panel")).toBe("2026-11-10|AM");
    await page.getByRole("heading", { name: /^Week of Nov 9/ }).waitFor();
    await page.evaluate(() => (location.hash = "#/week/team"));
    await page.locator(".team-view, [aria-label^='Team']").first().waitFor({ timeout: 30_000 });
    await page.close();
  }, T);

  it("no button or link on Day, Week, Inbox or Status reads Plan, Plan it, Plan the day or Plan the week", async () => {
    const { page } = await freshPage(h);
    const PLAN = /^(Plan|Plan it|Plan the day|Plan the week|Plan today)$/;
    const words = () => page.locator("button:visible, a:visible").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
    for (const [key, ready] of [["1", ".today-view, .today-next"], ["2", ".half.card"], ["4", "main"], ["5", ".status-view, main"]] as const) {
      await page.keyboard.press(key);
      await page.locator(ready).first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(300);
      expect((await words()).filter((w) => PLAN.test(w)), key).toEqual([]);
    }
    // Week with the panel open too.
    await page.keyboard.press("2");
    await page.keyboard.press("a");
    await panel(page).waitFor();
    expect((await words()).filter((w) => PLAN.test(w))).toEqual([]);
    await page.close();
  }, T);

  it("Team isn't in the tabs, the command menu or the keys list; Status shows its count on the tab", async () => {
    const { page } = await freshPage(h);
    await expect(page.locator("nav.views .view-tab").allInnerTexts()).resolves.toEqual(expect.arrayContaining([expect.stringMatching(/^Day/), expect.stringMatching(/^Status/)]));
    const tabs = (await page.locator("nav.views .view-tab").allInnerTexts()).map((t) => t.replace(/\d+/g, "").trim());
    expect(tabs).toEqual(["Day", "Week", "Ahead", "Inbox", "Status"]);
    // Status's count is the features needing my update.
    const count = page.locator("nav.views .view-tab", { hasText: "Status" }).locator(".count");
    await count.waitFor({ timeout: 30_000 });
    expect(Number(await count.innerText())).toBeGreaterThan(0);
    // The command menu: nothing named Team.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Team");
    await page.waitForTimeout(300);
    expect(await page.getByRole("menuitem", { name: /^Team$/ }).count()).toBe(0);
    await page.keyboard.press("Escape");
    // The keys list (the Guide's shortcuts, ?): no Team row.
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press("?");
    await page.locator("main.guide").waitFor({ timeout: 15_000 });
    expect(await page.locator("main.guide").innerText()).not.toMatch(/\bTeam\b/);
    await page.close();
  }, T);

  it("1440×900 with the notice line: the first block starts within 200 px of the top; Review opens the panel", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    await openWeek(page);
    await page.locator(".to-place-line").waitFor({ timeout: 30_000 });
    const top = (await page.locator(".half.card").first().boundingBox())!.y;
    expect(top).toBeLessThanOrEqual(200);
    await page.locator(".to-place-line").getByRole("button", { name: "Review" }).click();
    await panel(page).locator(".aw-toplace").waitFor();
    await page.close();
  }, T);

  it("phone (390×844): + Add on a block opens the sheet; add a story from it", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await page.evaluate(() => (location.hash = "#/week"));
    const card = page.locator(".half.card", { has: page.locator(".add-work.add-row") }).nth(1);
    await card.waitFor({ timeout: 30_000 });
    await card.locator(".add-work.add-row").click();
    const sheet = page.locator("aside.add-work-panel.sheet");
    await sheet.waitFor();
    const at = (await sheet.getAttribute("data-add-panel"))!.split("|");
    const row = sheet.locator(".aw-sec .aw-row:not(.placed)").filter({ has: page.locator("button.aw-plus") }).first();
    const title = (await row.locator(".aw-row-title").innerText()).trim();
    await row.locator("button.aw-plus").click();
    await expect.poll(() => sheet.locator(".aw-row.placed", { hasText: title }).count()).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect.poll(() => block(page, at[0]!, at[1]!).innerText()).toContain(title);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("review fix: phone: ⋯ › Status opens Status (the bottom bar has no room for it)", async () => {
    const { page } = await freshPage(h, { width: 390, height: 844 });
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator(".top-more").click();
    await page.getByRole("menuitem", { name: /^Status/ }).click();
    await expect.poll(() => hash(page)).toMatch(/^#\/status/);
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("WD-1: the To place line (browser, demo on Tuesday)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-03T09:30:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  it("an unfinished to-do from yesterday shows in the notice line; Review, keep it: the count drops, and the line goes at zero", async () => {
    const { page, errors } = await freshPage(h);
    await openWeek(page);
    const line = page.locator(".to-place-line");
    await line.waitFor({ timeout: 30_000 });
    const n0 = Number((await line.innerText()).match(/^(\d+) to place/)![1]);
    expect(await line.innerText()).toMatch(/\d+ unfinished/);
    await line.getByRole("button", { name: "Review" }).click();
    const summary = panel(page).locator("section.carry-summary");
    await summary.waitFor();
    await summary.getByRole("button", { name: "Review" }).click();
    await summary.locator(".flw-row").first().getByRole("button", { name: "Keep" }).click();
    await expect.poll(async () => ((await line.count()) ? Number((await line.innerText()).match(/^(\d+)/)![1]) : 0)).toBeLessThan(n0);
    // Keep all: the suggestions are placed and the count drops again (what has no block left this week stays in its fold,
    // and the line goes only when nothing at all waits: plan/addwork.test.ts).
    const n1 = Number((await line.innerText()).match(/^(\d+)/)![1]);
    if (await summary.getByRole("button", { name: "Keep all" }).count()) {
      await summary.getByRole("button", { name: "Keep all" }).click();
      await expect.poll(async () => ((await line.count()) ? Number((await line.innerText()).match(/^(\d+)/)![1]) : 0)).toBeLessThan(n1);
    }
    await expect.poll(() => summary.getByRole("button", { name: "Keep all" }).count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("review fix: a past day's header, a PTO day and a weekend address open the panel on a block that can take work, and the address says which", async () => {
    const { page, errors } = await freshPage(h);
    await openWeek(page);
    // Monday is past: its header opens the next block that can take work, not a full Monday.
    const mon = page.locator("header.day-head", { has: page.locator(".dow", { hasText: "Mon" }) }).first();
    await mon.locator(".day-open").click({ force: true });
    await panel(page).waitFor();
    const at = (await panel(page).getAttribute("data-add-panel"))!;
    expect(at.startsWith("2026-11-02")).toBe(false);
    await expect.poll(() => hash(page)).toBe(`#/week/day/${at.replace("|", "/")}`);
    for (const typed of ["#/week/day/2026-11-05/AM", "#/week/day/2026-11-07/AM"]) {
      await page.evaluate((x) => (location.hash = x), typed);
      await expect.poll(() => hash(page), { message: typed }).not.toBe(typed);
      const now = (await panel(page).getAttribute("data-add-panel"))!;
      expect(now.startsWith("2026-11-05"), typed).toBe(false);
      await expect.poll(() => hash(page), { message: typed }).toBe(`#/week/day/${now.replace("|", "/")}`);
      await expect(panel(page).getByText("PTO · anything added").count()).resolves.toBe(0);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
