// Step 15.5: Settings > Notifications (switches, quiet hours, saved), Settings > You's "Start my VM without asking"
// and the morning box: one click when on, the preview when off. Demo mode (fictional data; no desktop notifications).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness, openSettings } from "./harness.ts";

let h: Harness;
const T = 90_000;

describe.skipIf(!CHROMIUM)("Notifications and the VM start setting (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Settings > Notifications: a switch per kind and quiet hours, saved", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Notifications" }).click();
    const form = page.locator(".set-form", { hasText: "Ritual reminders" });
    await form.waitFor();
    for (const name of ["Plan the day", "Check-in", "Close out", "Plan the week", "Look ahead", "Focus timer", "Meeting warnings", "My VM", "Follow-ups due", "Expiring secrets"])
      await expect(form.locator(".set-notify-row", { hasText: name }).count()).resolves.toBeGreaterThan(0);
    await form.locator(".set-notify-row", { hasText: "Check-in" }).locator("input").uncheck();
    await form.locator("select").selectOption("off");
    // Fix/settings-autosave: each change saves itself; no Save button.
    await expect(form.getByRole("button", { name: "Save" }).count()).resolves.toBe(0);
    await expect.poll(() => form.textContent(), { timeout: 5000 }).toContain("Saved");
    const saved = await page.evaluate(() => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "settings.load", input: {} }) }).then((r) => r.json()));
    expect(saved.data.notify).toMatchObject({ quiet: "off", kinds: { checkin: false, closeout: true } });
    await expect(form.getByRole("button", { name: "Send a test notification" }).count()).resolves.toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Start my VM without asking off: the morning box's Start shows the preview instead", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    const toggle = page.locator(".set-field", { hasText: "Start my VM without asking" }).locator("input");
    await toggle.waitFor();
    await expect(toggle.isChecked()).resolves.toBe(true);
    await toggle.uncheck();
    await expect.poll(() => page.locator(".set-field", { hasText: "Start my VM without asking" }).textContent(), { timeout: 5000 }).toContain("Saved");
    await page.keyboard.press("Escape");
    await page.keyboard.press("1");
    const prompt = page.locator(".att-chip.vm", { hasText: "VM is off" });
    await prompt.waitFor({ timeout: 10_000 });
    await prompt.getByRole("button", { name: "Start" }).click();
    const dialog = page.locator(".vm-preview");
    await dialog.waitFor({ timeout: 5000 });
    await expect(dialog.textContent()).resolves.toContain("Start your VM");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("clicking a notification opens its view: each route", async () => {
    const { page, errors } = await freshPage(h);
    const go = (route: string) => page.evaluate((r) => window.dispatchEvent(new CustomEvent("focustime:open-route", { detail: r })), route);
    const expectView = async (route: string, selector: string) => {
      await page.keyboard.press("Escape");
      await go(route);
      await page.locator(selector).first().waitFor({ timeout: 10_000 });
    };
    await expectView("checkin", "main.mode-checkin");
    await expectView("closeout", ".closeout-panel");
    await expectView("planday", ".pd2-left");
    await expectView("planweek:2026-11-09", 'main[aria-label="Plan the week"]');
    await expectView("focus", ".focus-screen");
    await expectView("inbox", 'main[aria-label="Captures"]');
    await expectView("settings:notifications", ".set-notify");
    await expectView("today", ".today-view");
    // A follow-up opens the Inbox with that follow-up outlined.
    const id = await page.evaluate(() => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "followups.list", input: {} }) }).then((r) => r.json()).then((j) => j.data.followUps[0].id as number));
    await expectView(`followup:${id}`, `[data-follow-up="${id}"].followup-highlight`);
    // My VM: Today with the VM chip's menu open.
    await expectView("vm", '.menu-list[role="menu"]');
    await expect(page.locator(".menu-list").textContent()).resolves.toContain("Choose another VM");
    // Anything unknown does nothing.
    await go("javascript:alert(1)");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});

