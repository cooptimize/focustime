// WK-3: weekends you can see, the Evening band and Deployment to-dos, in demo mode with the clock on Monday Nov 2 2026
// 9:30 AM ET. The test plans Northwind's Release 4.2 on Saturday 9 to 11 AM and Harbor's Portal hotfix on Friday 7 to
// 9 PM first (deploy.add, as the app does), so the week starts with a Saturday column, Friday's Evening band and "4h after hours this week".
// With FOCUSTIME_SHOTS the report's screenshots go there (demo data only).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, NOW, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";
import { SHOTS } from "./shots.ts";

const T = 240_000;
const FRI = "2026-11-06";
const SAT = "2026-11-07";
const SUN = "2026-11-08";

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** DP-2: Quick capture's date and time pickers (no native inputs). */
const pickDate = async (page: Page, box: Locator, label: string, d: string) => {
  await box.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.locator(".dp-pop input.dp-box").fill(d);
  await page.locator(".dp-pop input.dp-box").press("Enter");
  await page.locator(".dp-pop").waitFor({ state: "detached" });
};
const pickTime = async (page: Page, box: Locator, label: string, t: string) => {
  await box.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.locator(".tp-pop input").fill(t);
  await page.locator(".tp-pop input").press("Enter");
  await page.locator(".tp-pop").waitFor({ state: "detached" });
};

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/**
 * The two fictional Deployments, through deploy.add as the app plans them (not a demo seed, so every other Week test
 * keeps its Monday to Friday week). Each page is its own demo session.
 */
async function planDeployments(page: Page): Promise<void> {
  const sat = await call(page, "deploy.add", { clientKey: "Northwind", date: SAT, start: "09:00", end: "11:00", title: "Release 4.2", note: "Order export, the SQL views and the sales model", itemIds: [1111], items: [] });
  const fri = await call(page, "deploy.add", { clientKey: "Harbor", date: FRI, start: "19:00", end: "21:00", title: "Portal hotfix", note: "The insurance card upload fix", items: [] });
  if (!sat.ok || !fri.ok) throw new Error(`deploy.add: ${sat.error ?? fri.error}`);
}

async function board(page: Page): Promise<void> {
  await page.evaluate(() => (location.hash = "#/week"));
  await page.reload();
  await page.locator("main.grid").waitFor();
  await page.locator('main.grid [data-drop="2026-11-02:AM"]').waitFor();
  await page.waitForTimeout(300);
}

const sat = (page: Page) => page.locator(`main.grid [data-drop="${SAT}:AM"].weekend-cell`);
const sun = (page: Page) => page.locator(`main.grid [data-drop="${SUN}:AM"].weekend-cell`);

/** Week's ⋯ › Weekend (the Show weekend switch). */
async function switchWeekend(page: Page): Promise<void> {
  await page.locator(".week-head .more-btn, .week-head [aria-label='More for Week'], .week-head button[aria-haspopup=menu]").first().click();
  await page.getByRole("menuitem", { name: /Weekend/ }).click();
  await page.waitForTimeout(500);
}

async function pickMenu(page: Page, title: string): Promise<void> {
  const row = page.locator("main.grid .pick-row", { hasText: title }).first();
  await row.hover();
  await row.getByRole("button", { name: `More for ${title}` }).click();
}

describe.skipIf(!CHROMIUM)("WK-3: weekends, the Evening band and Deployment to-dos", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, NOW);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("Board at 1440: a quiet Saturday column, Friday's Evening band, the after-hours total; Show weekend is remembered", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await planDeployments(page);
    await board(page);
    // Saturday shows (a Deployment lands there); Sunday has nothing, so it doesn't.
    await sat(page).waitFor();
    expect(await sun(page).count()).toBe(0);
    const head = page.locator("main.grid section.day.weekend .weekend-head");
    expect((await head.innerText()).replace(/\s+/g, " ")).toMatch(/^Sat 7 · weekend/);
    // No blocks, Open half-days, capacity or risk on a weekend day.
    expect(await page.locator("main.grid section.day.weekend :is(.card, .open-cell, .status-pill, .fit-line, .risk)").count()).toBe(0);
    // The Deployment: its icon, window and title, readable in the narrow column.
    const dep = sat(page).locator(".pick-row", { hasText: "Release 4.2" });
    await expect(dep.locator(".deploy-icon").count()).resolves.toBe(1);
    await expect(dep.locator(".deploy-window").textContent()).resolves.toBe("9:00–11:00");
    expect((await dep.locator(".pr-title").boundingBox())!.width).toBeGreaterThan(60);
    // Friday's Evening band, under its day, with the 7 PM deployment.
    const band = page.locator("main.grid .evening-band").filter({ hasText: "Portal hotfix" });
    await band.waitFor();
    await expect(band.locator(".deploy-window").textContent()).resolves.toBe("19:00–21:00");
    // After hours: 2h on Saturday plus 2h on Friday evening.
    await expect(page.getByTestId("after-hours").textContent()).resolves.toBe("4h after hours this week");
    // Readable at 1440 with a weekend column: no horizontal page scroll.
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, "wk3-board-weekend-1440");
    if (SHOTS) {
      await band.screenshot({ path: `${SHOTS}/wk3-friday-evening.png` });
      await page.locator(".week-head").screenshot({ path: `${SHOTS}/wk3-after-hours.png` });
    }
    // Show weekend: Sunday too, and after a reload.
    await switchWeekend(page);
    await sun(page).waitFor();
    await page.reload();
    await sun(page).waitFor();
    await switchWeekend(page);
    await expect.poll(() => sun(page).count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Done on a Deployment offers Tell <client> (a draft, never sent by itself) or Not now", async () => {
    const { page, errors } = await freshPage(h, { width: 1920, height: 1080 });
    await planDeployments(page);
    await board(page);
    // The deployment's own menu: Deployment details and Kind.
    await pickMenu(page, "Portal hotfix");
    await page.getByRole("menuitem", { name: /Deployment details/ }).waitFor();
    await page.getByRole("menuitem", { name: /^Kind/ }).waitFor();
    await shot(page, "wk3-deployment-menu");
    await page.keyboard.press("Escape");
    // Done → the offer.
    await page.locator("main.grid .pick-row", { hasText: "Portal hotfix" }).getByRole("checkbox").check();
    const dlg = page.getByRole("dialog", { name: "Tell Harbor it's deployed" });
    await dlg.waitFor();
    // Who to tell: anyone typed (a picked person when the directory has one).
    const who = dlg.locator(".deployed-who input").first();
    await who.fill("Jordan Lee");
    await page.waitForTimeout(400);
    if (await dlg.locator("[role=option]").count()) await dlg.locator("[role=option]").first().click();
    await dlg.getByRole("button", { name: "Tell Harbor it's deployed" }).click();
    // LP-1's draft: the text from the note, editable, sent only from its preview.
    const draft = dlg.locator("textarea").first();
    await draft.waitFor();
    await expect.poll(() => draft.inputValue()).toContain("Portal hotfix is deployed.");
    expect(await draft.inputValue()).toContain("What went: The insurance card upload fix");
    await shot(page, "wk3-tell-client");
    // Backing out removes the promise it opened; the to-do stays done.
    await dlg.getByRole("button", { name: /Cancel|Close/ }).first().click();
    await expect.poll(() => dlg.count()).toBe(0);
    const promises = await call(page, "week.load", { weekStart: "2026-11-02" });
    expect(JSON.stringify(promises.data.followUps)).not.toContain("it's deployed");
    // Not now just marks it done.
    await sat(page).locator(".pick-row", { hasText: "Release 4.2" }).getByRole("checkbox").check();
    const d2 = page.getByRole("dialog", { name: "Tell Northwind it's deployed" });
    await d2.waitFor();
    await d2.getByRole("button", { name: "Not now" }).click();
    await expect.poll(() => d2.count()).toBe(0);
    await expect.poll(() => sat(page).locator(".pick-row.done", { hasText: "Release 4.2" }).count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("plans a Deployment from Capture, the day menu and the command menu; a window is required", async () => {
    const { page, errors } = await freshPage(h, { width: 1920, height: 1080 });
    await board(page);
    // Capture: Deployment needs a client and a window.
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    const box = page.locator(".cap-dialog .cap-box");
    await box.locator("textarea[aria-label='Quick capture']").fill("deploy the order export");
    await expect.poll(() => box.locator("[role=radio][aria-checked=true]").textContent()).toMatch(/^Deployment/);
    await box.locator(".cap-client").click();
    await box.locator(".cap-choose").getByRole("button", { name: "Northwind" }).click();
    await pickDate(page, box, "Deployment date", FRI);
    await pickTime(page, box, "Starts at", "18:00");
    await pickTime(page, box, "Ends at", "17:00");
    await expect.poll(() => box.locator(".cap-send").isDisabled().then(async (d) => d || (await box.innerText()).includes("end must be after"))).toBe(true);
    await pickTime(page, box, "Ends at", "20:00");
    await box.locator(".cap-send").click();
    await page.locator(".cap-dialog .cap-toast, .cap-toast").first().waitFor();
    await page.keyboard.press("Escape");
    await board(page);
    await page.locator("main.grid .evening-band .pick-row", { hasText: "deploy the order export" }).waitFor();
    // The day menu: Plan a deployment… on Wednesday.
    await page.locator("main.grid section.day[aria-label^='Wed'] .day-head").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Plan a deployment/ }).click();
    const form = page.locator("form:has(input[name=start])");
    await form.locator("input[name=title]").fill("Ledger views");
    await form.locator("input[name=start]").fill("18:00");
    await form.locator("input[name=end]").fill("19:30");
    await form.getByRole("button", { name: "Plan it" }).click();
    await page.locator(".app-undo", { hasText: /Deployment planned/ }).waitFor();
    await page.locator("main.grid .evening-band .pick-row", { hasText: "Ledger views" }).waitFor();
    // The command menu.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Plan a deployment");
    await page.getByRole("menuitem", { name: /Plan a deployment/ }).first().click();
    const f2 = page.locator("form:has(input[name=start])");
    await f2.locator("input[name=title]").fill("Weekend cutover");
    await f2.locator("input[name=date]").fill(SUN);
    await f2.locator("input[name=start]").fill("08:00");
    await f2.locator("input[name=end]").fill("10:00");
    await f2.getByRole("button", { name: "Plan it" }).click();
    await sun(page).locator(".pick-row", { hasText: "Weekend cutover" }).waitFor();
    // Changing a to-do's kind: Kind › Deployment asks for the window.
    await pickMenu(page, "Export orders to CSV");
    await page.getByRole("menuitem", { name: /^Kind/ }).click();
    await page.getByRole("menuitem", { name: /Deployment/ }).click();
    const f3 = page.locator("form:has(input[name=start])");
    await f3.getByRole("button", { name: "Save" }).click();
    await page.locator(".app-undo", { hasText: /Now a deployment/ }).waitFor();
    await expect.poll(() => page.locator("main.grid .pick-row", { hasText: "Export orders to CSV" }).first().locator(".deploy-icon").count()).toBe(1);
    await page.locator(".app-undo").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => page.locator("main.grid .pick-row", { hasText: "Export orders to CSV" }).first().locator(".deploy-icon").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("moves a to-do onto Saturday by the menu and by drag, each with Undo", async () => {
    const { page, errors } = await freshPage(h, { width: 1920, height: 1080 });
    const added = await call(page, "pick.add", { date: "2026-11-04", half: "PM", clientKey: "Northwind", intention: "Weekend move test", size: "S" });
    expect(added.ok).toBe(true);
    await planDeployments(page);
    await board(page);
    await pickMenu(page, "Weekend move test");
    await page.getByRole("menuitem", { name: /^Move/ }).click();
    await page.getByRole("menuitem", { name: /To Saturday/ }).click();
    await sat(page).locator(".pick-row", { hasText: "Weekend move test" }).waitFor();
    await page.locator(".app-undo, .undo-toast").filter({ hasText: /Saturday/ }).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => sat(page).locator(".pick-row", { hasText: "Weekend move test" }).count()).toBe(0);
    // Drag onto Saturday, as WK-1's drag: nudging while it rests so the target answers.
    const row = page.locator("main.grid .pick-row", { hasText: "Weekend move test" }).first();
    const a = (await row.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
    const b = (await sat(page).boundingBox())!;
    const at = { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 120) };
    await page.mouse.move(at.x, at.y, { steps: 8 });
    await expect.poll(async () => {
      await page.mouse.move(at.x + 1, at.y + 1);
      await page.mouse.move(at.x, at.y);
      return /drop-(over|no)/.test((await sat(page).getAttribute("class")) ?? "");
    }).toBe(true);
    await page.mouse.up();
    await sat(page).locator(".pick-row", { hasText: "Weekend move test" }).waitFor();
    await page.locator(".undo-toast").filter({ hasText: /Sat/ }).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => sat(page).locator(".pick-row", { hasText: "Weekend move test" }).count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Today steps onto a weekend day with something on it, as a Weekend day with no planning prompts", async () => {
    const { page, errors } = await freshPage(h, { width: 1920, height: 1080 });
    await planDeployments(page);
    await page.evaluate((d) => (location.hash = `#/today/${d}`), FRI);
    await page.reload();
    await page.locator(".today-nav, [aria-label='Next day']").first().waitFor();
    await page.getByRole("button", { name: "Next day" }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/today/${SAT}`);
    const we = page.locator("section.today-weekend");
    await we.waitFor();
    await expect(we.locator(".today-weekend-head").textContent()).resolves.toMatch(/^Weekend/);
    await we.locator(".pick-row", { hasText: "Release 4.2" }).locator(".deploy-window", { hasText: "9:00–11:00" }).waitFor();
    // No planning prompts: no Plan link, moment card or blocks.
    expect(await page.locator(":is(.moment-card, .today-block, .today-other, .plan-link)").count()).toBe(0);
    expect(await page.getByRole("button", { name: /^Plan / }).count()).toBe(0);
    await shot(page, "wk3-today-saturday");
    // Sunday has nothing: the next step goes on to Monday.
    await page.getByRole("button", { name: "Next day" }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/today/2026-11-09");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the phone at 360: Saturday's chip and the after-hours total, no horizontal scroll", async () => {
    const page = await phonePage(h, 360);
    await planDeployments(page);
    await page.evaluate(() => (location.hash = "#/week"));
    await page.reload();
    await page.locator(".day-tab").first().waitFor();
    await expect.poll(() => page.locator(".day-tab", { hasText: /Sat/ }).count()).toBe(1);
    expect(await page.locator(".day-tab", { hasText: /Sun/ }).count()).toBe(0);
    await page.getByTestId("after-hours").waitFor();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    const tabs = await page.locator(".day-tab").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    expect(Math.max(...tabs)).toBeLessThanOrEqual(360);
    await shot(page, "wk3-phone-week");
    await page.locator(".day-tab", { hasText: /Sat/ }).click();
    await page.waitForTimeout(400);
    await page.locator(".weekend-cell .pick-row", { hasText: "Release 4.2" }).scrollIntoViewIfNeeded();
    await shot(page, "wk3-phone-saturday");
    await page.close();
  }, T);

  it("with nothing on the weekend, Week at 1440 is Monday to Friday", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await board(page);
    await expect.poll(() => page.locator("main.grid section.day.weekend").count()).toBe(0);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, "wk3-board-no-weekend-1440");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
