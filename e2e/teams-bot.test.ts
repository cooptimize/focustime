// TB-1: the app's side of the Teams bot, on a throwaway demo server: Settings › Notifications › In Teams, "Let
// FocusTime message me in Teams", is off by default, turns on, and is still on after a reload. Screenshots at 1920 and
// Text size Larger when FOCUSTIME_SHOTS names a folder (demo data only). The bot itself is tested with fake Teams
// activities (server/teams/*.test.ts); its cards are previewed by scripts/teams-card-previews.ts. TB-1b: the privacy
// and terms page the Teams app links to opens without signing in, with nothing the CSP blocks, on a desktop and a phone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, openSettings, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 300_000;

describe.skipIf(!CHROMIUM)("TB-1: Let FocusTime message me in Teams", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("is off by default, turns on, and stays on", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Notifications", exact: true }).click();
    const box = page.getByRole("checkbox", { name: "Let FocusTime message me in Teams" });
    await box.scrollIntoViewIfNeeded();
    await expect(box.isChecked()).resolves.toBe(false);
    await shotBoth(page, "tb1-settings-teams-off", box);
    await box.check();
    await page.waitForTimeout(1200);
    // The address keeps Settings › Notifications open across the reload (#/settings/notifications).
    await page.reload();
    const again = page.getByRole("checkbox", { name: "Let FocusTime message me in Teams" });
    await again.scrollIntoViewIfNeeded();
    await expect(again.isChecked()).resolves.toBe(true);
    await shotBoth(page, "tb1-settings-teams-on", again);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("TB-2: each kind off by default; a kind, its time and Friday save; a test says where it runs", async () => {
    const { page, errors } = await freshPage(h);
    await page.goto(`${h.url}#/settings/notifications`);
    const master = page.getByRole("checkbox", { name: "Let FocusTime message me in Teams" });
    await master.scrollIntoViewIfNeeded();
    if (!(await master.isChecked())) await master.check();
    // The app's own notifications have a "Close out" too: these are the In Teams ones.
    const teams = page.locator("fieldset.set-teams");
    const brief = teams.getByRole("checkbox", { name: /^Morning brief/ });
    for (const k of [/^Morning brief/, /^Midday check-in/, /^Close out/, /^Nudges/]) await expect(teams.getByRole("checkbox", { name: k }).isChecked()).resolves.toBe(false);
    await brief.check();
    await teams.getByRole("checkbox", { name: /^Midday check-in/ }).check();
    const at = page.getByLabel("Midday check-in at");
    await at.fill("12:30");
    await at.blur();
    await page.getByLabel("Minutes before my day ends").fill("45");
    await page.getByLabel("Minutes before my day ends").blur();
    await page.getByRole("checkbox", { name: "Also on Fridays (catch-up)" }).check();
    await page.waitForTimeout(1200);
    await page.reload();
    const teams2 = page.locator("fieldset.set-teams");
    await teams2.getByRole("checkbox", { name: /^Morning brief/ }).scrollIntoViewIfNeeded();
    await expect(teams2.getByRole("checkbox", { name: /^Morning brief/ }).isChecked()).resolves.toBe(true);
    await expect(teams2.getByRole("checkbox", { name: /^Nudges/ }).isChecked()).resolves.toBe(false);
    await expect(page.getByLabel("Midday check-in at").inputValue()).resolves.toBe("12:30");
    await expect(page.getByLabel("Minutes before my day ends").inputValue()).resolves.toBe("45");
    await expect(page.getByRole("checkbox", { name: "Also on Fridays (catch-up)" }).isChecked()).resolves.toBe(true);
    // The demo has no bot: the status line says so, and a test says why it can't go.
    await expect(page.getByText("runs in the hosted app", { exact: false }).first().isVisible()).resolves.toBe(true);
    await page.getByRole("button", { name: "Send me a test now" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "isn't set up here" }).first().waitFor({ timeout: 5000 })).resolves.toBeUndefined();
    await shotBoth(page, "tb2-settings-in-teams", page.locator("fieldset.set-teams"));
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("serves the privacy and terms page without signing in (TB-1b)", async () => {
    for (const [name, viewport] of [["1920", { width: 1920, height: 1080 }], ["phone", { width: 390, height: 844 }]] as const) {
      const ctx = await h.browser.newContext({ viewport });
      const page = await ctx.newPage();
      const problems: string[] = [];
      page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
      page.on("pageerror", (e) => problems.push(e.message));
      const r = await page.goto(`${new URL(h.url).origin}/legal.html#terms`);
      expect(r?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 }).textContent()).resolves.toBe("Privacy and terms");
      await expect(page.locator("#privacy h2").textContent()).resolves.toBe("Privacy");
      await expect(page.locator("#terms h2").textContent()).resolves.toBe("Terms of use");
      // Its stylesheet applied (the CSP allows only same-origin sheets): the column is narrow.
      expect(await page.locator("main").evaluate((m) => m.getBoundingClientRect().width)).toBeLessThanOrEqual(680);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/tb1b-legal-${name}.png`, fullPage: true });
      expect(problems).toEqual([]);
      await ctx.close();
    }
  }, T);
});
