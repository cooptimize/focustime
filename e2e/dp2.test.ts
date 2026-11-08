// DP-2: Deployment items by data platform, in demo mode with the clock on Monday Nov 2 2026 9:30 AM ET. Northwind is
// on Fabric, Harbor on Azure and Atlas is unset (server/demo.ts). With FOCUSTIME_SHOTS the report's screenshots go there.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, NOW, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 240_000;
const SAT = "2026-11-07";

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const board = async (page: Page) => {
  await page.evaluate(() => (location.hash = "#/week"));
  await page.reload();
  await page.locator("main.grid").waitFor();
  await page.locator('main.grid [data-drop="2026-11-02:AM"]').waitFor();
  await page.waitForTimeout(300);
};
async function openDeployment(page: Page, client: string): Promise<Locator> {
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const box = page.locator(".cap-dialog .cap-box");
  await box.locator("textarea[aria-label='Quick capture']").fill("Deploy the release");
  await expect.poll(() => box.locator("[role=radio][aria-checked=true]").textContent()).toMatch(/^Deployment/);
  await chooseClient(box, client);
  return box;
}
async function chooseClient(box: Locator, client: string): Promise<void> {
  await box.locator(".cap-client").click();
  await box.locator(".cap-choose").getByRole("button", { name: client }).click();
  await box.page().waitForTimeout(400);
}
const ticked = (box: Locator) => box.locator(".dep-check:has(input:checked)").allInnerTexts().then((x) => x.map((s) => s.trim()));
const labels = (box: Locator) => box.locator(".dep-check").allInnerTexts().then((x) => x.map((s) => s.trim()));
async function setTime(page: Page, box: Locator, label: string, typed: string): Promise<void> {
  const button = box.getByRole("button", { name: new RegExp(`^${label}:`) });
  await button.click();
  const pop = page.locator(".tp-pop");
  await pop.locator("input").fill(typed);
  await pop.locator("input").press("Enter");
  await expect.poll(() => pop.count()).toBe(0);
  // The picker hands focus back to its button a frame after it closes.
  await expect.poll(() => button.evaluate((b) => b === document.activeElement)).toBe(true);
}

describe.skipIf(!CHROMIUM)("DP-2: Deployment items by data platform", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, NOW);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("Quick capture: the client's list with its defaults, a switch, the unset client, no native inputs, the warning", async () => {
    const { page, errors } = await freshPage(h);
    await board(page);
    const box = await openDeployment(page, "Northwind");
    expect(await labels(box)).toContain("Lakehouse SQL");
    expect(await ticked(box)).toEqual(["Warehouse SQL", "Framework Tables", "Semantic Models", "Reports"]);
    await shotBoth(page, "dp2-capture-fabric");
    // No native date or time input anywhere in the box, for any kind.
    expect(await box.locator("input[type=date], input[type=time]").count()).toBe(0);

    // A hand tick on an item only Fabric has goes with the switch; the defaults become Azure's.
    await box.locator(".dep-check", { hasText: "Notebooks" }).locator("input").check();
    await chooseClient(box, "Harbor");
    expect(await labels(box)).toContain("ADF Pipelines");
    expect(await ticked(box)).toEqual(["Data Warehouse SQL", "Semantic Models", "Reports"]);
    await shotBoth(page, "dp2-capture-azure");

    // No platform set: both groups, nothing ticked, and the link for someone who may set it.
    await chooseClient(box, "Atlas");
    expect(await box.locator(".dep-group-label").allInnerTexts()).toEqual(["Fabric", "Azure"]);
    expect(await ticked(box)).toEqual([]);
    await box.locator(".dep-set-platform", { hasText: "Set Atlas's data platform" }).waitFor();
    await shotBoth(page, "dp2-capture-unset");

    // The pickers, and Ends before Starts warns and won't save.
    await chooseClient(box, "Northwind");
    await box.getByRole("button", { name: /^Deployment date:/ }).click();
    await page.locator(".dp-pop").waitFor();
    await shot(page, "dp2-date-picker");
    await page.locator(".dp-pop input").press("Escape");
    await box.getByRole("button", { name: /^Starts at:/ }).click();
    await page.locator(".tp-pop .tp-step.on").waitFor({ timeout: 5000 });
    await shot(page, "dp2-time-picker");
    await page.locator(".tp-pop input").press("Escape");
    await setTime(page, box, "Starts at", "8pm");
    await setTime(page, box, "Ends at", "6pm");
    await box.locator(".dep-warn", { hasText: "end must be after" }).waitFor();
    await box.locator("textarea[aria-label='Quick capture']").press("Enter");
    await box.locator(".set-problem").waitFor();
    await setTime(page, box, "Ends at", "22:30");
    expect(await box.locator(".dep-warn").count()).toBe(0);

    // Keyboard: Tab reaches a checkbox and Space ticks it; Enter saves from the checkbox.
    await box.locator(".dep-check", { hasText: "Warehouse SQL" }).locator("input").focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).type)).toBe("checkbox");
    await page.keyboard.press("Space");
    await expect.poll(() => ticked(box)).toContain("Pipelines");
    // The Note, then save.
    await box.getByLabel("Note", { exact: true }).fill("date dimension fix");
    await box.getByLabel("Note", { exact: true }).press("Enter");
    await page.locator(".cap-toast", { hasText: "items" }).waitFor();
    await page.keyboard.press("Escape");
    const w = await call(page, "week.load", { weekStart: "2026-11-02" });
    const saved = JSON.stringify(w.data);
    expect(saved).toContain("date dimension fix");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Week's summary, editing keeps the ticks, and the done draft lists them through Close the loop's preview", async () => {
    const { page, errors } = await freshPage(h);
    const add = await call(page, "deploy.add", { clientKey: "Northwind", date: SAT, start: "19:00", end: "21:00", title: "Release 4.2", note: "date dimension fix" });
    expect(add.ok).toBe(true);
    await board(page);
    const row = page.locator("main.grid .pick-row", { hasText: "Release 4.2" }).first();
    const chip = row.locator(".deploy-items-chip");
    expect(await chip.innerText()).toBe("4 items");
    expect(await chip.getAttribute("title")).toContain("Warehouse SQL, Framework Tables, Semantic Models, Reports");
    await chip.click();
    await page.locator(".deploy-items-pop li", { hasText: "Framework Tables" }).waitFor();
    await shot(page, "dp2-week-summary");
    await page.keyboard.press("Escape");

    // Deployment details: the same checkboxes and Note, the ticks as planned.
    await row.hover();
    await row.getByRole("button", { name: "More for Release 4.2" }).click();
    await page.getByRole("menuitem", { name: /Deployment details/ }).click();
    const form = page.locator("form:has(input[name=start])");
    await form.locator(".dep-check input:checked").first().waitFor();
    expect(await ticked(form)).toEqual(["Warehouse SQL", "Framework Tables", "Semantic Models", "Reports"]);
    expect(await form.locator("textarea[name=note]").inputValue()).toBe("date dimension fix");
    await form.locator(".dep-check", { hasText: "Notebooks" }).locator("input").check();
    await form.getByRole("button", { name: "Save" }).click();
    await page.locator(".app-undo", { hasText: /Deployment saved/ }).waitFor();
    await expect.poll(() => row.locator(".deploy-items-chip").innerText()).toBe("5 items");

    // Done → Tell: the draft lists what went and the Note; only the preview sends.
    await row.getByRole("checkbox").check();
    const dlg = page.getByRole("dialog", { name: "Tell Northwind it's deployed" });
    await dlg.waitFor();
    await dlg.locator(".deployed-who input").first().fill("Jordan Lee");
    await page.waitForTimeout(400);
    if (await dlg.locator("[role=option]").count()) await dlg.locator("[role=option]").first().click();
    await dlg.getByRole("button", { name: "Tell Northwind it's deployed" }).click();
    const draft = dlg.locator("textarea").first();
    await expect.poll(() => draft.inputValue()).toContain("Warehouse SQL, Framework Tables, Notebooks, Semantic Models, Reports. Also: date dimension fix");
    await shot(page, "dp2-done-draft");
    // GD-2's exit check on the way out: another client's name is flagged in the preview.
    const check = await call(page, "boundary.check", { clientKey: "Northwind", texts: [`${await draft.inputValue()} Harbor Health too`] });
    expect(check.ok).toBe(true);
    expect(JSON.stringify(check.data)).toMatch(/Harbor/);
    await dlg.getByRole("button", { name: /Cancel|Close/ }).first().click();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Admin › Clients: the platform and the list; a change reaches new deployments only", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/settings/admin-clients"));
    const card = page.locator(".adm-client", { hasText: "Atlas" }).first();
    const set = card.locator(".dep-settings");
    await set.waitFor({ timeout: 60_000 });
    await set.getByRole("radio", { name: "Fabric" }).click();
    await expect.poll(() => set.getByRole("radio", { name: "Fabric" }).getAttribute("aria-checked")).toBe("true");
    await expect.poll(() => set.locator(".dep-list h4").count()).toBe(0);
    await set.getByLabel("Add a Fabric item for Atlas").fill("Dataflows");
    await set.getByLabel("Add a Fabric item for Atlas").press("Enter");
    await set.locator(".dep-name", { hasText: "Dataflows" }).waitFor();
    await set.getByLabel("Dataflows: ticked by default").check();
    await set.locator("li", { hasText: "Lakehouse SQL" }).getByRole("button", { name: "Hide" }).click();
    await set.locator("li", { hasText: "Lakehouse SQL" }).getByText("hidden").waitFor();
    await set.getByRole("button", { name: "Move Dataflows up" }).click();
    await page.waitForTimeout(400);
    await set.scrollIntoViewIfNeeded();
    await shotBoth(page, "dp2-admin-clients");
    const v = await call(page, "deploy.items", { clientKey: "Atlas" });
    const items = (v.data as { groups: { items: { name: string; on: boolean }[] }[] }).groups[0]!.items;
    expect(items.map((i) => i.name)).not.toContain("Lakehouse SQL");
    expect(items.map((i) => i.name).indexOf("Dataflows")).toBe(items.length - 2);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the phone at 390: Quick capture and the summary with no sideways scroll", async () => {
    const page = await phonePage(h, 390);
    const add = await call(page, "deploy.add", { clientKey: "Northwind", date: SAT, start: "19:00", end: "21:00", title: "Evening release" });
    expect(add.ok).toBe(true);
    await page.evaluate((d) => (location.hash = `#/today/${d}`), SAT);
    await page.reload();
    await page.waitForSelector(".topbar", { timeout: 60_000 });
    await page.locator(".deploy-items-chip").first().waitFor({ timeout: 20_000 });
    await page.locator(".deploy-items-chip").first().tap();
    await page.locator(".deploy-items-pop li", { hasText: "Reports" }).waitFor();
    await shot(page, "dp2-phone-summary");
    const scroll = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await scroll()).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    // The to-do's sheet opens the same details: the ticks as planned, inside the phone's width.
    await page.getByRole("button", { name: "More for Evening release" }).tap();
    await page.getByRole("button", { name: "Deployment details" }).tap();
    const form = page.locator("form:has(input[name=start])");
    await expect.poll(() => ticked(form)).toEqual(["Warehouse SQL", "Framework Tables", "Semantic Models", "Reports"]);
    await form.locator("textarea[name=note]").waitFor();
    await shot(page, "dp2-phone-edit");
    expect(await scroll()).toBeLessThanOrEqual(0);
    // However long the list, Save can be reached.
    const save = form.locator("button[type=submit]");
    await save.scrollIntoViewIfNeeded();
    const b = (await save.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await page.locator(".bb-capture").tap();
    const box = page.locator(".cap-dialog .cap-box");
    await box.locator("textarea[aria-label='Quick capture']").fill("Deploy the release");
    await expect.poll(() => box.locator("[role=radio][aria-checked=true]").textContent()).toMatch(/^Deployment/);
    await box.locator(".cap-client").tap();
    await box.locator(".cap-choose").getByRole("button", { name: "Northwind" }).tap();
    await expect.poll(() => ticked(box)).toEqual(["Warehouse SQL", "Framework Tables", "Semantic Models", "Reports"]);
    await shot(page, "dp2-phone-capture");
    const over = await page.evaluate(() => { const d = document.querySelector(".cap-dialog")!; return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, dlg: d.scrollWidth - d.clientWidth }; });
    expect(over.doc).toBeLessThanOrEqual(0);
    expect(over.dlg).toBeLessThanOrEqual(0);
    await page.close();
  }, T);
});
