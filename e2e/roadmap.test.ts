// Step 17: Roadmap (the status board) and Plan ahead, in demo mode (fictional features covering every state).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, weekRow, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
/** Decimals and fractions (as in e2e/estimating.test.ts): none may show. Times (9:30) and dates are fine. */
const FRACTION = /(?<![\d:])\d+[.,]\d+(?![\d:])|half a block|½|¼|¾/i;

describe.skipIf(!CHROMIUM)("Roadmap and Plan ahead (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const roadmap = async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/roadmap"));
    await page.locator(".rm-row").first().waitFor({ timeout: 30_000 });
    return { page, errors };
  };
  const rowOf = (page: Awaited<ReturnType<typeof roadmap>>["page"], title: string) => page.locator(".rm-row", { has: page.getByRole("link", { name: title, exact: true }) });

  it("every state shows as a word with its plain reason; the summary counts them", async () => {
    const { page, errors } = await roadmap();
    const badge = async (title: string) => (await rowOf(page, title).locator(".rm-top .rm-badge").textContent())?.trim();
    expect(await badge("Patient intake form")).toBe("Blocked");
    expect(await badge("Order history export")).toBe("At risk");
    expect(await badge("Supplier onboarding")).toBe("Not scoped");
    expect(await badge("Shipment tracking dashboard")).toBe("Stalled");
    expect(await badge("Internal reporting refresh")).toBe("Watch");
    expect(await badge("Customer portal redesign")).toBe("Needs a date");
    expect(await badge("Knowledge base search")).toBe("On track");
    expect(await badge("Patient portal login")).toBe("Done");
    await expect(rowOf(page, "Order history export").locator(".rm-reason").textContent()).resolves.toBe("3 stories open, about 1 closes every 3 weeks, 11 days left, needs about 9 weeks");
    await page.locator(".rm-sum.rm-over").waitFor();
    const sums = await page.locator(".rm-sum").allTextContents();
    // Eight states, then Over-booked weeks (Northwind's and Atlas's week 1).
    expect(sums.length).toBe(9);
    expect(sums[8]).toMatch(/^2\s*Over-booked weeks$/);
    expect(sums.every((t) => /^\d+/.test(t))).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("filters combine (state, whose, client, search) and last for the session; Clear filters resets them", async () => {
    const { page } = await roadmap();
    await page.locator(".rm-sum.st-watch").click();
    await expect.poll(() => page.locator(".rm-row").count()).toBe(3);
    await page.locator(".rm-sum.st-at_risk").click();
    await expect.poll(() => page.locator(".rm-row").count()).toBe(4);
    await page.getByRole("button", { name: "Northwind Foods" }).click();
    await expect.poll(() => page.locator(".rm-row").count()).toBe(3);
    await page.getByRole("searchbox", { name: "Search the Roadmap" }).fill("loyalty");
    await expect.poll(() => page.locator(".rm-row").count()).toBe(1);
    // Back to Today and here again: the filters are still on.
    await page.evaluate(() => (location.hash = "#/today"));
    await page.locator(".today-view").waitFor();
    await page.evaluate(() => (location.hash = "#/roadmap"));
    await page.locator(".rm-row").first().waitFor();
    await expect(page.locator(".rm-row").count()).resolves.toBe(1);
    await expect(page.locator(".rm-sum.st-watch").getAttribute("aria-pressed")).resolves.toBe("true");
    await page.getByRole("button", { name: "Clear filters" }).click();
    // Over-booked weeks: only the features with blocks in a week that has more musts than blocks.
    await page.locator(".rm-sum.rm-over").click();
    await expect.poll(async () => (await page.locator(".rm-row .dl-title a").allTextContents()).sort()).toEqual(["Customer portal redesign", "Order history export", "Supplier onboarding"]);
    await page.locator(".rm-sum.rm-over").click();
    await expect.poll(() => page.locator(".rm-row").count()).toBeGreaterThan(10);
    // Contributing: only the parents of my stories.
    await page.getByRole("button", { name: "Contributing", exact: true }).click();
    await expect.poll(async () => (await page.locator(".rm-row .rm-rel").count()) === (await page.locator(".rm-row").count())).toBe(true);
    await page.getByRole("button", { name: "Both", exact: true }).click();
    await page.close();
  }, T);

  it("sorts by risk by default (state order), by target date on request", async () => {
    const { page } = await roadmap();
    const states = async () => (await page.locator(".dl-client").first().locator(".rm-top .rm-badge").allTextContents()).map((t) => t.trim());
    expect(await states()).toEqual(["Watch", "On track"]);
    await page.getByRole("combobox").selectOption("target");
    await expect.poll(async () => (await page.locator('.dl-client[aria-label="Northwind Foods"] .dl-title a').allTextContents())[0]).toBe("Order history export");
    await page.getByRole("combobox").selectOption("risk");
    await page.close();
  }, T);

  it("a row expands to its stories grouped by state with assignees; each state says what it means on hover (U5: no legend)", async () => {
    const { page } = await roadmap();
    const row = rowOf(page, "Patient intake form");
    await row.getByRole("button", { name: /Show stories of Patient intake form/ }).click();
    await expect.poll(() => row.locator(".rm-group h4").allTextContents()).toEqual(["Blocked 1", "In progress 1", "Not started 1", "Done 3"]);
    await expect(row.locator(".rm-group.g-blocked li").textContent()).resolves.toContain("Validate date of birth");
    await expect(row.locator(".rm-badge").getAttribute("title")).resolves.toMatch(/\w+ \w+/);
    await expect(page.locator(".rm-sum").first().getAttribute("title")).resolves.toMatch(/\w+ \w+/);
    await expect(page.getByRole("button", { name: "What do these mean?" }).count()).resolves.toBe(0);
    await page.close();
  }, T);

  const ahead = async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/roadmap/ahead"));
    await page.locator(".pa-item").first().waitFor({ timeout: 30_000 });
    return { page, errors };
  };
  const barRow = (page: Awaited<ReturnType<typeof ahead>>["page"], title: string) => page.locator(".pa-item", { has: page.getByRole("link", { name: title, exact: true }) });
  const cell = (page: Awaited<ReturnType<typeof ahead>>["page"], title: string, week: string) => page.getByRole("gridcell", { name: new RegExp(`^${title}, week of ${week}:`) });

  it("Plan ahead: weeks 1 to 4 then months, solid and estimated bars, target diamonds, a ghost past the target, a crowded month", async () => {
    const { page, errors } = await ahead();
    await expect(page.locator(".pa-head .pa-col-main").allTextContents()).resolves.toEqual(["Oct 19", "Oct 26", "Nov 2", "Nov 9", "Nov 16", "Nov 23", "Dec", "Jan"]);
    // DevOps Start Date and Target Date: solid. No start: estimated.
    await expect(barRow(page, "Patient intake form").locator(".pa-bar").getAttribute("class")).resolves.not.toContain(" est");
    await expect(barRow(page, "Loyalty points").locator(".pa-bar").getAttribute("class")).resolves.toContain(" est");
    await expect(barRow(page, "Loyalty points").locator(".pa-diamond").count()).resolves.toBe(1);
    // The pace forecast lands after the target: a ghost past the diamond, and the row reads At risk.
    await expect(barRow(page, "Order history export").locator(".pa-ghost").count()).resolves.toBe(1);
    await expect(barRow(page, "Order history export").locator(".rm-badge").textContent()).resolves.toContain("At risk");
    // Atlas: two features due in December with few blocks.
    const atlasCap = page.locator('.pa-cap[aria-label="Atlas Freight: blocks per week and month"]');
    await expect(atlasCap.locator(".pa-capcell.crowded").textContent()).resolves.toMatch(/^Crowded month\s*\d+ blocks, 2 features due$/);
    await expect(page.locator('.pa-cap[aria-label="Northwind Foods: blocks per week and month"] .pa-capcell:not(.past)').first().textContent()).resolves.toBe("3 planned, 2 available");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a week cell sets whole blocks, the same blocks Plan the week shows; a change there shows here", async () => {
    const { page, errors } = await ahead();
    await cell(page, "Store locator", "Nov 9").click();
    await page.getByRole("menuitem", { name: "2 blocks" }).click();
    await expect.poll(() => cell(page, "Store locator", "Nov 9").getAttribute("aria-label")).toContain(": 2 blocks.");
    // Plan the week (next week, Nov 9): the feature is there as a must with 2 blocks.
    await page.evaluate(() => (location.hash = "#/week/plan/2026-11-09"));
    const row = await weekRow(page, "Store locator");
    await expect.poll(() => row.locator(".pw-stepper .pw-chip-btn").first().textContent()).toBe("2 blocks");
    await row.hover();
    await row.getByRole("button", { name: "One block less" }).first().click();
    await expect.poll(() => row.locator(".pw-stepper .pw-chip-btn").first().textContent()).toBe("1 block");
    await page.evaluate(() => (location.hash = "#/roadmap/ahead"));
    await page.locator(".pa-item").first().waitFor();
    await expect.poll(() => cell(page, "Store locator", "Nov 9").getAttribute("aria-label")).toContain(": 1 block.");
    // None removes it from the week again.
    await cell(page, "Store locator", "Nov 9").click();
    await page.getByRole("menuitem", { name: "None" }).click();
    await expect.poll(() => cell(page, "Store locator", "Nov 9").getAttribute("aria-label")).toContain(": no blocks.");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("keyboard: arrows move between weeks and rows, + and − change the focused week's blocks", async () => {
    const { page } = await ahead();
    await cell(page, "Loyalty points", "Nov 9").focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).toMatch(/^Loyalty points, week of Nov 16:/);
    await page.keyboard.press("+");
    await expect.poll(() => cell(page, "Loyalty points", "Nov 16").getAttribute("aria-label")).toContain(": 1 block.");
    await page.keyboard.press("-");
    await expect.poll(() => cell(page, "Loyalty points", "Nov 16").getAttribute("aria-label")).toContain(": no blocks.");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).toMatch(/^Store locator, week of Nov 16:/);
    // Enter on an epic's row hides its features, and again shows them.
    await cell(page, "Customer portal redesign", "Nov 2").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => barRow(page, "Loyalty points").count()).toBe(0);
    await page.keyboard.press("Enter");
    await expect.poll(() => barRow(page, "Loyalty points").count()).toBe(1);
    await page.close();
  }, T);

  it("dragging across weeks gives each empty week 1 block; dragging a bar keeps estimated dates locally until reset", async () => {
    const { page } = await ahead();
    const a = (await cell(page, "Supplier onboarding", "Nov 9").boundingBox())!;
    const b = (await cell(page, "Supplier onboarding", "Nov 23").boundingBox())!;
    await page.mouse.move(a.x + 10, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width + 10, a.y + a.height / 2, { steps: 4 });
    await page.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 4 });
    await page.mouse.up();
    for (const w of ["Nov 9", "Nov 16", "Nov 23"]) await expect.poll(() => cell(page, "Supplier onboarding", w).getAttribute("aria-label")).toContain(": 1 block.");
    for (const w of ["Nov 9", "Nov 16", "Nov 23"]) {
      await cell(page, "Supplier onboarding", w).click();
      await page.getByRole("menuitem", { name: "None" }).click();
    }
    // A bar's body: both dates move; Save dates and Reset appear.
    const bar = barRow(page, "Appointment reminders").locator(".pa-bar");
    const box = (await bar.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const row = barRow(page, "Appointment reminders");
    await expect.poll(() => row.locator(".pa-save").count()).toBe(1);
    await expect(row.locator(".pa-save").textContent()).resolves.toContain("Not yours to save");
    await row.getByRole("button", { name: "Reset" }).click();
    await expect.poll(() => row.locator(".pa-save").count()).toBe(0);
    await page.close();
  }, T);

  it("readiness: each flag with its next steps; Ask owner adds a follow-up; the last 2 weeks read planned against worked", async () => {
    const { page, errors } = await ahead();
    // Planned against worked, in words (demo: Northwind's export planned 2 last week, about 1 worked).
    await expect(barRow(page, "Order history export").locator(".pa-past").allTextContents()).resolves.toEqual(["planned 1,worked about 1", "planned 2,worked about 1"]);
    await expect(page.locator('.pa-cap[aria-label="Cooptimize: blocks per week and month"] .pa-capcell.past').allTextContents()).resolves.toEqual(["nothing planned", "planned 1,no focus time"]);
    // Supplier onboarding: planned this week, no stories yet.
    await barRow(page, "Supplier onboarding").locator(".pa-flags").click();
    await expect(page.getByRole("menuitem").allTextContents()).resolves.toEqual(expect.arrayContaining(["Starts this week, not scoped: Break it down", "Starts this week, not scoped: Copy Coop brief", "No target date: Set target date"]));
    await page.keyboard.press("Escape");
    // The stalled dashboard: Ask owner as a follow-up adds one to the Inbox.
    await barRow(page, "Shipment tracking dashboard").locator(".pa-flags").click();
    await page.getByRole("menuitem", { name: "Stalled: Ask owner as a follow-up" }).click();
    await expect.poll(() => page.locator(".notice").textContent()).toContain("ask about Shipment tracking dashboard");
    await page.evaluate(() => (location.hash = "#/inbox"));
    await expect.poll(() => page.locator("body").textContent()).toContain("Ask about Shipment tracking dashboard: stalled");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("no fractional amounts in either Roadmap mode", async () => {
    const { page } = await freshPage(h);
    for (const [hash, ready] of [["#/roadmap", ".rm-row"], ["#/roadmap/ahead", ".roadmap"]] as const) {
      await page.evaluate((x) => (location.hash = x), hash);
      await page.locator(ready).first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(800);
      for (const b of await page.locator(".rm-expand:not([disabled])").all()) await b.click();
      const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
      const titles = await page.locator("[title], [aria-label]").evaluateAll((els) => els.map((e) => `${e.getAttribute("title") ?? ""} ${e.getAttribute("aria-label") ?? ""}`));
      for (const t of [text, ...titles]) expect(t.match(FRACTION)?.[0] ?? null, `${hash}: ${t.slice(Math.max(0, t.search(FRACTION) - 40), t.search(FRACTION) + 40)}`).toBeNull();
    }
    await page.close();
  }, T);
});
