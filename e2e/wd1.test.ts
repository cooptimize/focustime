// WD-1: one Week, in a real browser on the demo (Monday Nov 2, 9:30 AM; Tuesday for the unfinished to-do). The
// scenarios from the step: + Add and Undo, a feature placed as a placeholder then broken down, the panel following the
// selected block, no Confirm (CF-1), the To place line, no star and the remove rule, every
// old address, no Plan buttons, Team hidden, Status on the tabs, the phone's sheet, and the first block's height at 1440×900.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 180_000;
const block = (page: Page, date: string, half: string) => page.locator(`[data-drop="${date}:${half}"]`).first();
const panel = (page: Page) => page.locator("aside.block-panel");
const panelTitle = (page: Page) => panel(page).locator(".bp-title h2").innerText();
const room = (page: Page) => panel(page).locator(".bp-when").first().innerText();
const hash = (page: Page) => page.evaluate(() => location.hash);
async function openWeek(page: Page) {
  await page.keyboard.press("2");
  await page.locator(".half.card").first().waitFor({ timeout: 30_000 });
}
async function addOn(page: Page, date: string, half: string) {
  await block(page, date, half).locator(".add-work.add-row").click();
  await panel(page).waitFor();
  await expect.poll(() => panel(page).getAttribute("data-block-panel")).toBe(`${date}|${half}`);
}
/** The first story row in the panel's own sections (not To place) that isn't on this block yet. */
const freeRow = (page: Page) => panel(page).locator(".aw-sec .aw-row:not(.placed)").filter({ has: page.locator("button.aw-plus") }).first();

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
    await expect(panelTitle(page)).resolves.toMatch(/^\S.* · Tue AM$/);
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
    await expect.poll(() => panel(page).getAttribute("data-block-panel")).toBe("2026-11-03|PM");
    await expect(panelTitle(page)).resolves.toMatch(/· Tue PM$/);
    expect(await panelTitle(page)).not.toBe(before.title);
    await expect(hash(page)).resolves.toBe("#/week/day/2026-11-03/PM");
    await page.keyboard.press("Escape");
    await panel(page).waitFor({ state: "detached" });
    await expect(hash(page)).resolves.toBe("#/week");
    await page.close();
  }, T);

  it("CF-1: add, take off, add again: no Confirm, Confirmed, Draft or Changed anywhere on Week", async () => {
    const { page } = await freshPage(h);
    await openWeek(page);
    const words = /\bConfirm|\bConfirmed\b|\bDraft\b(?! story| feature)|Changed since/;
    const header = () => page.locator(".week-head").first().innerText();
    expect(await page.locator(".week-tag").count()).toBe(0);
    expect(await header()).not.toMatch(words);
    await addOn(page, "2026-11-03", "PM");
    const placedHere = (t: string) => panel(page).locator(".aw-row.placed", { hasText: t }).count();
    const row = freeRow(page);
    const title = (await row.locator(".aw-row-title").innerText()).trim();
    await row.locator("button.aw-plus").click();
    await expect.poll(() => placedHere(title)).toBeGreaterThan(0);
    expect(await header()).not.toMatch(words);
    // Off again (Undo of the add), then on again: each change stands at once.
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => placedHere(title)).toBe(0);
    expect(await header()).not.toMatch(words);
    await panel(page).locator(".aw-row:not(.placed)", { hasText: title }).first().locator("button.aw-plus").click();
    await expect.poll(() => placedHere(title)).toBeGreaterThan(0);
    expect(await header()).not.toMatch(words);
    expect(await page.getByRole("button", { name: /Confirm/ }).count()).toBe(0);
    await page.close();
  }, T);

  it("review fix: the panel opened on next week closes onto next week (Esc, + Add, W)", async () => {
    const { page } = await freshPage(h);
    await openWeek(page);
    await page.keyboard.press("]");
    await page.locator(".week-head h2", { hasText: "Nov 9" }).waitFor();
    for (const close of ["Escape", "head", "w"] as const) {
      await addOn(page, "2026-11-10", "AM");
      // WD-2: + Add puts the cursor in the Add box, where W is a letter: leave the box first.
      if (close === "w") await panel(page).locator(".bp-title h2").click();
      if (close === "head") await page.locator(".add-work-head").click();
      else await page.keyboard.press(close);
      await panel(page).waitFor({ state: "detached" });
      await expect(page.locator(".week-head h2").innerText(), close).resolves.toContain("Nov 9");
      await expect(hash(page), close).resolves.toBe("#/week/2026-11-09");
    }
    await page.close();
  }, T);

  it("no star (CF-1); Remove from this week is refused while one of its stories is placed", async () => {
    const { page } = await freshPage(h);
    await openWeek(page);
    await addOn(page, "2026-11-02", "PM");
    expect(await panel(page).locator(".aw-star").count()).toBe(0);
    // A feature with a story placed: the remove item names where it's placed instead of removing it.
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
    await expect.poll(() => panel(page).getAttribute("data-block-panel")).toBe("2026-11-10|AM");
    await page.getByRole("heading", { name: /^Week of Nov 9/ }).waitFor();
    await page.evaluate(() => (location.hash = "#/week/team"));
    await page.locator(".team-view, [aria-label^='Team']").first().waitFor({ timeout: 30_000 });
    await page.close();
  }, T);

  it("no button or link on Day, Week, Inbox or Status reads Plan, Plan it, Plan the day or Plan the week", async () => {
    const { page } = await freshPage(h);
    const PLAN = /^(Plan|Plan it|Plan the day|Plan the week|Plan today)$/;
    const words = () => page.locator("button:visible, a:visible").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
    for (const [key, ready] of [["1", ".today-view"], ["2", ".half.card"], ["4", "main"], ["5", ".status-view, main"]] as const) {
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

  it("Team isn't in the tabs, the command menu or the keys list; Status has no count on the tab (RF-1: a dot)", async () => {
    const { page } = await freshPage(h);
    await expect(page.locator("nav.views .view-tab").allInnerTexts()).resolves.toEqual(expect.arrayContaining([expect.stringMatching(/^Day/), expect.stringMatching(/^Status/)]));
    const tabs = (await page.locator("nav.views .view-tab").allInnerTexts()).map((t) => t.replace(/\d+/g, "").trim());
    expect(tabs).toEqual(["Day", "Week", "Ahead", "Status", "Inbox"]);
    // RF-1: no number on Status (its dot is e2e/rf1.test.ts's).
    expect(await page.locator("nav.views .view-tab", { hasText: "Status" }).locator(".count").count()).toBe(0);
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
    const sheet = page.locator("aside.block-panel.sheet");
    await sheet.waitFor();
    const at = (await sheet.getAttribute("data-block-panel"))!.split("|");
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

  it("WD-2: from a block, Assigned to you comes first; To place and You sent are folded at the bottom; Review opens To place", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openWeek(page);
    await page.locator(".to-place-line").waitFor({ timeout: 30_000 });
    // A Northwind block (it has features this week).
    const nw = page.locator("[data-drop]", { has: page.locator(".card-client", { hasText: "Northwind" }) }).last();
    await nw.locator(".add-work.add-row").click();
    await panel(page).waitFor();
    const line = panel(page).locator(".aw-toplace-line");
    await line.waitFor();
    await expect(line.getAttribute("aria-expanded")).resolves.toBe("false");
    expect(await line.innerText()).toMatch(/^▸ \d+ to place$/);
    expect(await line.getAttribute("title")).toMatch(/\d+ (unfinished|from last week|sent to you)/);
    expect(await panel(page).locator("section.carry-summary, section.carry").count()).toBe(0);
    // Order: On this block, the meetings line, Add with Assigned to you first, then Promises and More in the client;
    // To place and You sent folded at the bottom.
    const order = await panel(page).evaluate((el) =>
      [...el.querySelectorAll(".bp-on, .bp-add, .aw-toplace, .aw-sec")].map((x) => (x.classList.contains("bp-on") ? "on" : x.classList.contains("bp-add") ? "add" : x.classList.contains("aw-toplace") ? "place" : x.classList.contains("aw-features") ? "features" : x.classList.contains("aw-sends") ? "sends" : x.classList.contains("bp-other") ? "other" : (x.querySelector("h3, h4, .pl-label")?.textContent ?? "").trim())),
    );
    expect(order.slice(0, 3)).toEqual(["on", "add", "features"]);
    expect(order.at(-2)).toBe("place");
    expect(order.at(-1)).toBe("sends");
    expect(order.indexOf("other")).toBeGreaterThan(order.indexOf("features"));
    const sends = panel(page).locator(".aw-sends > .pl-fold");
    await expect(sends.innerText()).resolves.toMatch(/^▸ You sent/);
    expect(await panel(page).locator(".aw-sends section.team-group").count()).toBe(0);
    await sends.click();
    await panel(page).locator(".aw-sends section.team-group").waitFor();
    // A click on a block: the same folded line.
    await page.keyboard.press("Escape");
    await panel(page).waitFor({ state: "detached" });
    await nw.locator(".card-client").first().click();
    await panel(page).waitFor();
    await expect(panel(page).locator(".aw-toplace-line").getAttribute("aria-expanded")).resolves.toBe("false");
    await page.keyboard.press("Escape");
    await panel(page).waitFor({ state: "detached" });
    // Review: To place is open.
    await page.locator(".to-place-line").getByRole("button", { name: "Review" }).click();
    await panel(page).locator("section.carry-summary").waitFor();
    await expect(panel(page).locator(".aw-toplace-line").getAttribute("aria-expanded")).resolves.toBe("true");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  for (const [w, ht] of [[1440, 900], [1280, 720]] as const)
    it(`review fix: ${w} with the panel open: day headers keep a short date and Today; each card's status chip is on its header row`, async () => {
      const { page, errors } = await freshPage(h, { width: w, height: ht });
      await openWeek(page);
      await page.locator(".add-work-head").click();
      await panel(page).waitFor();
      await page.waitForTimeout(300);
      const today = page.locator(".day.today .day-head");
      await expect(today.locator(".date-short").isVisible()).resolves.toBe(true);
      await expect(today.locator(".date-short").innerText()).resolves.toBe("3");
      await expect(today.locator(".dow").innerText()).resolves.toBe("Tue");
      await expect(today.locator(".today-pill").isVisible()).resolves.toBe(true);
      for (const head of await page.locator("main.grid .half.card .card-head").all()) {
        const pill = head.locator(".status-pill");
        if (!(await pill.count())) continue;
        const [c, p] = await Promise.all([head.locator(".card-client").boundingBox(), pill.boundingBox()]);
        // On the same row: the chip's middle within the client's line.
        expect(Math.abs(c!.y + c!.height / 2 - (p!.y + p!.height / 2)), await head.innerText()).toBeLessThan(c!.height);
        // The time is still shown.
        await expect(head.locator(".card-when").isVisible()).resolves.toBe(true);
      }
      expect(errors).toEqual([]);
      await page.close();
    }, T);

  it("review fix: phone (390×844): the week title, + Add and ⋯ share one row; the notice is one line, \"N to place · Review\"", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator(".half.card").first().waitFor({ timeout: 30_000 });
    const head = page.locator(".week-head.wd1-head");
    const [t, add, more] = await Promise.all([head.locator("h2").boundingBox(), head.locator(".add-work-head").boundingBox(), head.getByRole("button", { name: "View options for Week" }).boundingBox()]);
    const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
    expect(Math.abs(mid(t!) - mid(add!))).toBeLessThan(t!.height);
    expect(Math.abs(mid(add!) - mid(more!))).toBeLessThan(add!.height);
    const notice = page.locator(".to-place-line");
    await expect(notice.innerText()).resolves.toMatch(/^\d+ to place · Review$/);
    // One line: the text and Review sit on the same line box.
    const spread = await notice.evaluate((e) => {
      const r = document.createRange();
      r.selectNodeContents(e);
      const mids = [...r.getClientRects()].filter((x) => x.width > 0).map((x) => x.top + x.height / 2);
      return Math.max(...mids) - Math.min(...mids);
    });
    expect(spread).toBeLessThan(8);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("WD-2: a past block and a PTO day open the panel to read and tick, with no Add; a day's header opens Day on that date", async () => {
    const { page, errors } = await freshPage(h);
    await openWeek(page);
    // Monday is past: its block opens the panel on itself, with no Add section and no + Add on the card.
    expect(await block(page, "2026-11-02", "AM").locator(".add-work.add-row").count()).toBe(0);
    await block(page, "2026-11-02", "AM").locator(".card-client").first().click();
    await expect.poll(() => panel(page).getAttribute("data-block-panel")).toBe("2026-11-02|AM");
    await expect.poll(() => hash(page)).toBe("#/week/day/2026-11-02/AM");
    await panel(page).getByText("A past day: tick what got done, or move what didn't to today.").waitFor();
    expect(await panel(page).locator(".bp-add, input.bp-box").count()).toBe(0);
    // A PTO day's address opens that day, read only.
    await page.evaluate(() => (location.hash = "#/week/day/2026-11-05/AM"));
    await expect.poll(() => panel(page).getAttribute("data-block-panel")).toBe("2026-11-05|AM");
    await expect(panelTitle(page)).resolves.toMatch(/^PTO · Thu$/);
    expect(await panel(page).locator(".bp-add, input.bp-box").count()).toBe(0);
    await page.keyboard.press("Escape");
    await panel(page).waitFor({ state: "detached" });
    // A day's header opens Day on that date.
    const wed = page.locator("header.day-head", { has: page.locator(".dow", { hasText: "Wed" }) }).first();
    await wed.locator(".day-open").click();
    await expect.poll(() => hash(page)).toBe("#/day/2026-11-04");
    await page.locator(".day-view .day-bar h1", { hasText: "Wed, Nov 4" }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
