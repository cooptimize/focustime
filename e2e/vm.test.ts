// Step 15.4: the signed-in person, my VM chip, the morning prompt, auto-shutdown delay and restore, Settings > You and
// the Inbox's kind chips, clicked in a real browser on demo data (a fictional person and VM, no Azure calls).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness, openSettings } from "./harness.ts";

let h: Harness;
const T = 90_000;

describe.skipIf(!CHROMIUM)("My VM and the sign-in (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const today = async (page: import("playwright-core").Page) => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("1");
    await page.locator(".today-view").waitFor();
  };

  it("shows who is signed in and the VM chip; the morning prompt asks to start it, Not today hides it", async () => {
    const { page, errors } = await freshPage(h);
    await today(page);
    await expect(page.locator(".person-chip").textContent()).resolves.toBe("AR");
    await expect(page.locator(".person-chip").getAttribute("title")).resolves.toContain("Alex Rivera");
    const chip = page.locator(".topbar .vm-chip");
    await expect.poll(() => chip.textContent(), { timeout: 10_000 }).toContain("Stopped (deallocated)");
    await expect(page.locator(".today-view .vm-chip").textContent()).resolves.toContain("Auto-shutdown 7:00 PM");
    const prompt = page.locator(".vm-banner", { hasText: "Your VM is off. Start it?" });
    await prompt.waitFor();
    await prompt.getByRole("button", { name: "Not today" }).click();
    await expect.poll(() => prompt.count(), { timeout: 5000 }).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Start from the prompt: Starting… then Running, logged in Settings > Data", async () => {
    const { page, errors } = await freshPage(h);
    await today(page);
    const prompt = page.locator(".vm-banner", { hasText: "Your VM is off" });
    await prompt.getByRole("button", { name: "Start" }).click();
    const chip = page.locator(".topbar .vm-chip");
    await expect.poll(() => chip.textContent(), { timeout: 10_000 }).toContain("Starting…");
    await expect.poll(() => chip.textContent(), { timeout: 45_000, interval: 1000 }).toContain("Running");
    await page.keyboard.press(",");
    await page.getByRole("button", { name: "Data", exact: true }).click();
    const log = page.locator('[aria-label="Azure write log"]');
    await expect.poll(() => log.textContent(), { timeout: 10_000 }).toMatch(/Started vm-demo-alex.*Confirmed/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Delay shutdown 2h from the chip: the preview shows 7:00 PM → 9:00 PM, then the chip says it's changed", async () => {
    const { page, errors } = await freshPage(h);
    await today(page);
    const chip = page.locator(".topbar .vm-chip");
    await expect.poll(() => chip.textContent(), { timeout: 10_000 }).toContain("Stopped");
    await chip.click();
    await page.getByRole("menuitem", { name: /Delay shutdown 2h/ }).click();
    const dlg = page.getByRole("dialog", { name: "Delay auto-shutdown 2 hours" });
    await dlg.waitFor();
    await expect(dlg.locator(".vm-change").textContent()).resolves.toMatch(/7:00 PM.*9:00 PM/);
    await expect(dlg.textContent()).resolves.toContain("back to 7:00 PM tomorrow morning");
    await dlg.getByRole("button", { name: "Delay" }).click();
    await expect.poll(() => page.locator(".today-view .vm-chip").textContent(), { timeout: 10_000 }).toContain("Auto-shutdown set to 9:00 PM; normally 7:00 PM");
    await chip.click();
    await page.getByRole("menuitem", { name: /Restore auto-shutdown/ }).click();
    await page.getByRole("dialog", { name: "Restore auto-shutdown" }).getByRole("button", { name: "Restore" }).click();
    await expect.poll(() => page.locator(".today-view .vm-chip").textContent(), { timeout: 10_000 }).toContain("Auto-shutdown 7:00 PM");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Settings > You: signed in, Find my VM by the Owner tag, the confirmed VM", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    const you = page.locator(".set-account");
    await expect(you.textContent()).resolves.toContain("Alex Rivera");
    await expect(you.getByRole("button", { name: "Sign out" }).count()).resolves.toBe(1);
    await you.getByRole("button", { name: "Find my VM" }).click();
    await expect.poll(() => you.locator(".vm-found").textContent(), { timeout: 10_000 }).toMatch(/Owner = “Alex Rivera”.*vm-demo-alex.*Your VM/);
    // A typed ID that isn't a VM is refused in plain words.
    await you.getByLabel("VM resource ID").fill("vm-demo-alex");
    await you.getByRole("button", { name: "Use this VM" }).click();
    await expect.poll(() => you.locator(".set-problem").textContent(), { timeout: 5000 }).toContain("isn't a VM resource ID");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Inbox sorting uses the capture box's kind chips", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("4");
    const sort = page.locator(".cap-sort").first();
    await sort.waitFor();
    await expect(sort.getByRole("radio").allTextContents()).resolves.toEqual(["Sort later", "Follow-up", "Draft story", "Draft feature"]);
    await sort.getByRole("radio", { name: "Follow-up" }).click();
    await expect(sort.getByRole("group", { name: "Follow-up details" }).count()).resolves.toBe(1);
    // "Ask Harbor about single sign-on…" has no name to owe it to: Who stays empty (Q84).
    await expect(sort.getByLabel("Who").inputValue()).resolves.toBe("");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("an out-of-date window (old launch token) says Reopen Coopilot with a button, never Session expired", async () => {
    const { page } = await freshPage(h);
    await today(page);
    const port = new URL(page.url()).port;
    await page.context().addCookies([{ name: `coopilot_${port}`, value: "an-old-token", url: `http://127.0.0.1:${port}/`, httpOnly: true, sameSite: "Strict" }]);
    await openSettings(page);
    const banner = page.locator(".stale-banner");
    await banner.waitFor({ timeout: 15_000 });
    await expect(banner.textContent()).resolves.toContain("Coopilot was restarted, so this window is out of date.");
    await expect(page.getByText(/session expired/i).count()).resolves.toBe(0);
    // The test server can't open windows, so the button says how to reopen by hand.
    await banner.getByRole("button", { name: "Reopen Coopilot" }).click();
    await expect.poll(() => banner.textContent(), { timeout: 5000 }).toContain("Super + Alt + C");
    await page.close();
  }, T);
});
