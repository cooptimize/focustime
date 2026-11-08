// SR-2: the client report in Week › Status on the demo, Thursday Nov 5: the switch (My features · <Client> report),
// Northwind's report as Kat will send it, No update yet, a line added on a feature there with who it shows as, Push
// all, and the report reading it back. The phone at 390 (17px and 21px root fonts, as on iPhone): the report reads
// with no horizontal scroll (SR-3: and can be written). With FOCUSTIME_SHOTS: the report, No update yet, adding a line, the phone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, startDemo, freshPage, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 300_000;
const THURSDAY = "2026-11-05T10:00:00-05:00";

async function openReport(page: Page, client: string) {
  await page.goto(`${new URL(page.url()).origin}/#/week/status`);
  await page.locator(".st-count").waitFor({ timeout: 30_000 });
  await page.getByRole("combobox", { name: "Client report" }).selectOption({ label: `${client} report` });
  await page.getByRole("heading", { name: `${client} report` }).waitFor({ timeout: 30_000 });
  await page.locator(".st-report").waitFor();
}

describe.skipIf(!CHROMIUM)("the client report (SR-2)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, THURSDAY);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("shows Northwind's whole report, and a line added from No update yet lands in it after Push all", async () => {
    const { page, errors } = await freshPage(h);
    await openReport(page, "Northwind");
    await expect.poll(() => page.locator(".st-sends").textContent()).toBe("Draft for Monday, Nov 9 · Kat sends it at 7:00 AM · last sent Nov 2");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const titles = page.locator(".st-report .st-feature h4");
    await expect.poll(() => titles.allTextContents()).toEqual(["Order history export", "Loyalty points"]);
    await expect.poll(() => page.getByRole("article", { name: "Loyalty points" }).locator(".st-bullets li").first().textContent()).toContain("· Sam Ortiz");
    await expect.poll(() => page.locator(".st-pto li").allTextContents()).toEqual(["Priya Shah · Tue, Nov 10 to Wed, Nov 11", "Founders Day (observed) · Thu, Nov 12", "Alex Rivera · Fri, Nov 13", "Holiday · Mon, Nov 16", "Sam Ortiz · Fri, Nov 20"]);
    await page.locator(".st-pto .st-note").waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sr2-report-1920.png`, fullPage: true });
    await shotBoth(page, "sr2-report-view-1920", page.locator(".st-report"));
    // No update yet, folded below the report: open it and add a line to Supplier onboarding.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const nu = page.locator(".st-noupdate");
    await nu.locator("summary").click();
    await expect.poll(() => nu.locator(".st-nu-head .st-title").allTextContents()).toEqual(["Supplier onboarding", "Store locator"]);
    await expect.poll(() => nu.locator(".st-nu").first().locator(".st-meta").textContent()).toContain("Owner Alex Rivera");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sr2-no-update-1920.png`, fullPage: true });
    await nu.locator(".st-nu").first().getByRole("button", { name: "+ Add a line" }).click();
    await nu.getByRole("textbox", { name: "New line for Supplier onboarding" }).fill("Sign-up form designed; purchasing reviews it Friday.");
    await expect.poll(() => nu.locator(".st-box-foot .muted").first().textContent()).toContain("Shows as Alex Rivera");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sr2-add-line-1920.png`, fullPage: true });
    await page.getByRole("button", { name: "Push all" }).click();
    const dialog = page.getByRole("dialog", { name: "Push 1 line to DevOps" });
    await dialog.getByRole("button", { name: "Push 1 line to DevOps" }).click();
    await dialog.locator(".dw-ok").waitFor({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
    // Read back: Supplier onboarding is in the report now (backlog order), out of No update yet.
    await expect.poll(() => titles.allTextContents()).toEqual(["Order history export", "Supplier onboarding", "Loyalty points"]);
    await expect.poll(() => page.locator(".st-noupdate .st-nu").count()).toBe(1);
    await page.locator(".st-push").getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => page.locator(".st-fresh").textContent()).toMatch(/^Refreshed /);
    // Back to My features: SR-1's view, unchanged.
    await page.getByRole("button", { name: "My features" }).click();
    await page.getByRole("heading", { name: /Status report · for Monday, Nov 9/ }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("on the phone at 390 the report reads with no horizontal scroll", async () => {
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    await page.addInitScript(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      localStorage.setItem("focustime.hint.picktime", "1");
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".demo-tag", { timeout: 30_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await openReport(page, "Northwind");
    for (const px of [17, 21]) {
      await page.addStyleTag({ content: `html { font-size: ${px}px; }` });
      await page.waitForTimeout(300);
      // The page and Status's own scroll area (it scrolls inside the frame): neither wider than the phone.
      const m = await page.evaluate(() => {
        const v = document.querySelector(".status-view")!;
        const right = Math.max(...[...v.querySelectorAll("*")].map((el) => el.getBoundingClientRect().right));
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, view: v.scrollWidth - v.clientWidth, right: right - innerWidth };
      });
      expect(m, `${px}px root font`).toEqual({ page: 0, view: 0, right: expect.any(Number) });
      expect(m.right, `${px}px root font: something reaches past the screen`).toBeLessThanOrEqual(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/sr2-phone-390-${px}px.png`, fullPage: true });
    }
    // SR-3: the phone writes too (Add a line and Push all are there); No update yet still reads.
    expect(await page.getByRole("button", { name: "Push all" }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "+ Add a line" }).count()).toBeGreaterThan(0);
    await page.locator(".st-noupdate summary").waitFor();
    await page.close();
  }, T);
});
