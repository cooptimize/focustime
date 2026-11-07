// UI-8: the Nov 5 bug round, in demo mode. (1) Friday takes a dropped pick while Week's detail panel is open, and
// nothing covers the Friday column at 1920 or 1366. (2) Every screen ⋯ opens has the × at its top right (still in view
// after focus moves to a button at its foot), Send feedback's Back at the top left, and Esc closes. (3) Send feedback:
// one create, and the item's number on Sent. (4) DevOps health offers Break down beside the Coop brief, opening the
// same panel as Ahead's Fix next. Screenshots (dark and light, and Larger text) when FOCUSTIME_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

const T = 120_000;

/** <name>-dark.png and <name>-light.png, then <name>-larger.png (dark, Text size Larger). */
async function shots(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const theme of ["cooptimize-dark", "cooptimize-light"]) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme.replace("cooptimize-", "")}.png` });
  }
  await page.evaluate(() => ((document.documentElement.dataset.theme = "cooptimize-dark"), document.documentElement.setAttribute("data-text-size", "larger")));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}-larger.png` });
  await page.evaluate(() => document.documentElement.removeAttribute("data-text-size"));
  await page.waitForTimeout(100);
}

/** Drags with real mouse moves, so the page sees dragstart, dragover on the way and drop on the target. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 120), { steps: 12 });
  await page.mouse.up();
}

/** Whether the element's own box (its part in the window; the grid scrolls) is what the page shows at a grid of points inside it. */
async function uncovered(el: Locator): Promise<boolean> {
  return el.evaluate((node) => {
    const b = node.getBoundingClientRect();
    const bar = document.querySelector(".statusbar")?.getBoundingClientRect().top ?? innerHeight;
    const r = { left: b.left, width: b.width, right: b.right, top: Math.max(0, b.top), height: Math.min(b.bottom, bar) - Math.max(0, b.top) };
    for (const fx of [0.1, 0.5, 0.9])
      for (const fy of [0.05, 0.3, 0.6, 0.95]) {
        const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        if (!hit || !node.contains(hit)) return false;
      }
    return r.width > 0 && r.right <= innerWidth;
  });
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe.skipIf(!CHROMIUM)("UI-8 bug round", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  for (const vp of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    it(`Friday takes a pick dragged from Monday with the panel open, nothing over it (${vp.width})`, async () => {
      const { page, errors } = await freshPage(h, vp);
      await page.keyboard.press("2");
      const friday = page.locator(".half.whole.catchup");
      await friday.waitFor();
      const mon = page.locator('.half[data-drop="2026-11-02:AM"]');
      // Open Monday AM's panel (Cooptimize): its stories are the drag source.
      await mon.click({ position: { x: 60, y: 140 } });
      const panel = page.getByRole("region", { name: "Your stories for Cooptimize" });
      await panel.waitFor();
      const box = await page.locator("aside.detail-panel").boundingBox();
      expect(overlaps(box!, (await friday.boundingBox())!)).toBe(false);
      await expect(uncovered(friday)).resolves.toBe(true);
      if (vp.width === 1920) await shots(page, "ui8-friday-panel");

      // A story onto Monday AM, then that pick from Monday's card onto Friday.
      await drag(page, panel.locator(".ps-row[data-story]").first(), mon);
      await page.locator(".undo-toast", { hasText: /^Added to Mon/ }).waitFor();
      const pick = mon.locator("li[draggable='true']").first();
      await pick.waitFor();
      const title = (await pick.innerText()).split("\n")[0]!;
      await drag(page, pick, friday);
      await page.locator(".undo-toast", { hasText: /^Moved to Fri/ }).waitFor();
      await friday.locator("li[draggable='true']").first().waitFor();
      expect(await friday.innerText()).toContain(title.replace(/^#\d+\s*/, "").slice(0, 12));
      expect(await mon.locator("li[draggable='true']").count()).toBe(0);
      if (vp.width === 1920) await shots(page, "ui8-friday-dropped");
      // Larger text: still clear of the panel (the undo notice dismissed: it passes over the foot of the grid).
      await page.locator(".undo-toast").getByRole("button", { name: "Dismiss" }).click();
      await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
      await page.waitForTimeout(150);
      expect(overlaps((await page.locator("aside.detail-panel").boundingBox())!, (await friday.boundingBox())!)).toBe(false);
      await expect(uncovered(friday)).resolves.toBe(true);
      expect(errors).toEqual([]);
      await page.close();
    }, T);
  }

  it("every screen ⋯ opens has the × at its top right, Back at the top left where there's one, and Esc closes", async () => {
    // 1366 at Text size Larger: where the feedback preview is taller than its box.
    const { page, errors } = await freshPage(h, { width: 1366, height: 768 });
    await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
    const more = page.getByRole("button", { name: /^More: the Guide/ });
    const screens: [string, string][] = [
      ["Notifications", '[role="dialog"][aria-label="Notifications"]'],
      ["Commands", '[role="dialog"][aria-label="Command menu"]'],
      ["Guide", "main.guide .ps-head"],
      ["Keyboard shortcuts", '[role="dialog"][aria-label="Keyboard shortcuts"]'],
      ["Send feedback", '[role="dialog"][aria-label="Send feedback"]'],
      ["About", '[role="dialog"][aria-label="About FocusTime"]'],
    ];
    const xAtTopRight = async (d: Locator) => {
      const x = d.locator(".x-close").first();
      const [db, xb] = [(await d.boundingBox())!, (await x.boundingBox())!];
      // In view, in the box's top 80 px and its right 80 px, and nothing on top of it.
      expect(xb.y).toBeGreaterThanOrEqual(0);
      expect(xb.y - db.y).toBeLessThan(80);
      expect(db.x + db.width - (xb.x + xb.width)).toBeLessThan(80);
      await expect(uncovered(x)).resolves.toBe(true);
    };
    for (const [name, sel] of screens) {
      await more.click();
      await page.locator(".popup-menu [role=menuitem]", { has: page.locator(".menu-label", { hasText: new RegExp(`^${name}$`) }) }).click();
      const d = page.locator(sel);
      await d.waitFor();
      await xAtTopRight(d);
      await page.keyboard.press("Escape");
      await d.waitFor({ state: "detached" });
    }
    await shots(page, "ui8-more-menu");

    // Send feedback's preview: focus on Send at its foot, the × still at the top; Back at the top left; Esc closes.
    await more.click();
    await page.getByRole("menuitem", { name: "Send feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "Send feedback" });
    const box = dialog.getByRole("textbox", { name: "Your feedback" });
    await box.fill(Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join("\n"));
    await expect(dialog.getByRole("button", { name: "Back" }).count()).resolves.toBe(0);
    await box.press("Enter");
    await dialog.locator(".feedback-title").waitFor();
    await expect(dialog.getByRole("button", { name: /^Send/ }).evaluate((b) => b === document.activeElement)).resolves.toBe(true);
    await xAtTopRight(dialog);
    const back = dialog.getByRole("button", { name: "Back" });
    expect(await back.count()).toBe(1);
    const [db, bb] = [(await dialog.boundingBox())!, (await back.boundingBox())!];
    expect(bb.x - db.x).toBeLessThan(60);
    expect(bb.y - db.y).toBeLessThan(80);
    await shots(page, "ui8-feedback-preview");
    await back.click();
    await expect(box.inputValue()).resolves.toContain("Line 30");
    await box.press("Enter");
    await dialog.locator(".feedback-title").waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Send feedback creates the item once and shows its number", async () => {
    const { page, errors } = await freshPage(h);
    const sends: string[] = [];
    page.on("request", (r) => r.url().includes("/api/") && (r.postData() ?? "").includes('"feedback.send"') && sends.push(r.url()));
    await page.getByRole("button", { name: /^More: the Guide/ }).click();
    await page.getByRole("menuitem", { name: "Send feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "Send feedback" });
    await dialog.getByRole("textbox", { name: "Your feedback" }).fill("Friday should take a pick");
    await page.keyboard.press("Enter");
    await dialog.locator(".feedback-title").waitFor();
    await page.keyboard.press("Control+Enter");
    const done = dialog.locator(".feedback-done");
    await done.waitFor();
    await expect(done.textContent()).resolves.toMatch(/^Sent\. Thanks\. #\d+$/);
    expect(sends).toHaveLength(1);
    await shots(page, "ui8-feedback-sent");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("DevOps health offers Break down beside the Coop brief, opening the same panel as Fix next", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/week/plan/2026-11-02"));
    await page.getByRole("button", { name: /^DevOps health/ }).click();
    const health = page.locator('aside.detail-panel[aria-label="DevOps health"]');
    await health.waitFor();
    const row = health.locator(".pw-flag", { has: page.getByText("Feature with no stories") }).first();
    await row.waitFor();
    const bd = row.locator(".bd-trigger");
    await expect(bd.innerText()).resolves.toMatch(/^Break down/);
    await expect(row.getByRole("button", { name: "Coop brief" }).count()).resolves.toBe(1);
    await shots(page, "ui8-health-break-down");
    await bd.click();
    const bdPanel = page.locator(".bd-panel[role=dialog]");
    await bdPanel.waitFor();
    const steps = async () => (await bdPanel.locator(".bd-steps li").allInnerTexts()).map((t) => t.trim());
    expect(await bdPanel.getAttribute("aria-label")).toMatch(/^Break down/);
    const fromHealth = await steps();
    await shots(page, "ui8-health-break-down-open");
    await bdPanel.locator(".x-close").first().click();
    await bdPanel.waitFor({ state: "detached" });

    // Ahead's Fix next: its Break down opens the same panel, with the same steps.
    await page.evaluate(() => (location.hash = "#/ahead/fix"));
    const fix = page.locator(".ah-fx-row:not(.ctx) .ah-fx-acts button", { hasText: /^Break down$/ }).first();
    await fix.waitFor({ timeout: 30_000 });
    await fix.click();
    await bdPanel.waitFor();
    expect(await bdPanel.getAttribute("aria-label")).toMatch(/^Break down/);
    expect(await steps()).toEqual(fromHealth);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
