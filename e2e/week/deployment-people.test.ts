// DP-3: other people on a deployment, in demo mode with the clock on Monday Nov 2 2026 9:30 AM ET. Alex plans a
// Saturday deployment from Quick capture with Jordan on it (the shared picker, Cooptimizers only); it shows on Alex's
// Week with a count, its details say who a change is for; then the demo becomes Jordan (demo.be, a second signed-in
// person): it is in Jordan's own Week at once, counts in Jordan's after hours, and Take me off (with Undo) touches only
// Jordan. The phone at 390 shows the names and Jordan's own Outlook line with no sideways scroll. Nothing is written to
// Outlook. With FOCUSTIME_SHOTS the report's screenshots go there.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, NOW, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";
import { SHOTS } from "../shots.ts";

const T = 240_000;
const SAT = "2026-11-07";
const JORDAN = "a4d00000-0000-4000-8000-000000000011";

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const week = async (page: Page) => {
  await page.evaluate(() => (location.hash = "#/week"));
  await page.reload();
  await page.locator("main.grid").waitFor();
  await page.locator('main.grid [data-drop="2026-11-02:AM"]').waitFor();
};
const row = (page: Page) => page.locator(`main.grid .pick-row:has(.deploy-window)`, { hasText: "Release 4.2" });

describe.skipIf(!CHROMIUM)("DP-3: other people on a deployment", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, NOW);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("planned with Jordan from Quick capture, it shows for Jordan at once; Take me off touches only Jordan", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const jordan = ((await call(page, "people.picker", { clientKey: "Northwind" })).data as { groups: { people: { name: string; ref: { kind: string; id: string } }[] }[] }).groups.flatMap((g) => g.people).find((p) => p.name === "Jordan Lee");
    expect(jordan?.ref).toMatchObject({ kind: "cooptimizer", id: JORDAN });
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    const box = page.locator(".cap-dialog .cap-box");
    await box.locator("textarea[aria-label='Quick capture']").fill("Release 4.2");
    await expect.poll(() => box.locator("[role=radio][aria-checked=true]").textContent()).toMatch(/^Deployment/);
    await box.locator(".cap-client").click();
    await box.locator(".cap-choose").getByRole("button", { name: "Northwind" }).click();
    // The People field: the shared picker, chosen from the list.
    const add = box.getByRole("combobox", { name: "Add someone" });
    await add.fill("Jordan");
    await page.getByRole("option", { name: /Jordan Lee/ }).click();
    await expect.poll(() => box.locator(".dp-chip").allInnerTexts()).toEqual(["You", "Jordan Lee"]);
    await shot(page, "dp3-capture-1440-dark");
    await box.locator("textarea[aria-label='Quick capture']").press("Enter");
    await expect.poll(() => page.locator(".cap-saved, .app-undo, [role=status]", { hasText: /for all 2 on it/ }).first().isVisible()).toBe(true);
    await page.keyboard.press("Escape");

    await week(page);
    await expect.poll(() => row(page).isVisible()).toBe(true);
    await expect.poll(() => row(page).locator(".deploy-people").innerText()).toMatch(/2/);
    await shot(page, "dp3-week-1440-dark");
    // Its details say who a change is for.
    await row(page).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Deployment details/ }).click();
    await expect.poll(() => page.locator(".menu-form-intro").innerText()).toBe("This changes it for Jordan Lee too");
    await shot(page, "dp3-details-1440-dark");
    await page.keyboard.press("Escape");

    // Jordan, a second signed-in person: it's on Jordan's own Week, and counts in Jordan's after hours.
    expect((await call(page, "demo.be", { who: JORDAN })).ok).toBe(true);
    await week(page);
    await expect.poll(() => row(page).isVisible()).toBe(true);
    await expect.poll(() => page.locator(".after-hours-chip").innerText()).toMatch(/2h/);
    await shot(page, "dp3-week-jordan-1440-dark");
    await row(page).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Take me off/ }).click();
    await expect.poll(() => row(page).count()).toBe(0);
    await page.locator(".app-undo", { hasText: /Took you off/ }).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => row(page).isVisible()).toBe(true);
    // Alex's own plan never changed.
    expect((await call(page, "demo.be", { who: "me" })).ok).toBe(true);
    await week(page);
    await expect.poll(() => row(page).locator(".deploy-people").innerText()).toMatch(/2/);
    // Nothing went to Outlook: being added writes nothing; there's no hold for anyone yet.
    expect(JSON.stringify((await call(page, "write.log", {})).data)).not.toMatch(/Release 4\.2/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the phone at 390: the names and my own Outlook line in the sheet, with no sideways scroll", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    const planned = await call(page, "deploy.add", { clientKey: "Atlas", date: SAT, start: "13:00", end: "15:00", title: "Release 5.0", people: [JORDAN] });
    expect(planned.ok).toBe(true);
    expect((await call(page, "demo.be", { who: JORDAN })).ok).toBe(true);
    await page.evaluate((d) => (location.hash = `#/today/${d}`), SAT);
    await page.reload();
    await page.waitForSelector(".topbar", { timeout: 60_000 });
    await page.getByRole("button", { name: "More for Release 5.0" }).first().tap();
    const sheet = page.locator(".todo-sheet");
    await expect.poll(() => sheet.locator(".deploy-people-line").innerText()).toMatch(/On it: Alex Rivera and You[\s\S]*Added by Alex/);
    await expect.poll(() => sheet.locator(".deploy-hold").innerText()).toMatch(/Not on your Outlook[\s\S]*Put on my Outlook/);
    await expect.poll(() => sheet.getByRole("button", { name: "Take me off" }).isVisible()).toBe(true);
    await shot(page, "dp3-sheet-390-dark");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    expect((await call(page, "demo.be", { who: "me" })).ok).toBe(true);
    await page.close();
  }, T);
});
