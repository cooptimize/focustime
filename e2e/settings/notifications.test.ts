// Was e2e/notify.test.ts until BT-1.
// Step 15.5: Settings > Notifications (switches, quiet hours, saved), Settings > My VM's "Start without a preview"
// and the morning box: one click when on, the preview when off. Demo mode (fictional data; no desktop notifications).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness, openSettings, settingsSection } from "../harness.ts";

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
    await settingsSection(page, "notifications");
    const form = page.locator(".ps-body", { hasText: "Ritual reminders" });
    await form.waitFor();
    for (const name of ["Add work to today", "Midday check-in", "Close out", "Add work to the week", "Look ahead", "Focus timer", "Meeting warnings", "My VM", "Promises due", "Expiring secrets"])
      await expect(form.locator(".sp-row", { hasText: name }).count()).resolves.toBeGreaterThan(0);
    // TB-2's In Teams kinds sit in the same page, also "Midday check-in": these are the app's own (SA-2: the kind's
    // name is "Midday check-in" everywhere).
    await form.locator('[data-setting="notify-checkin"]').getByRole("switch").uncheck();
    await form.locator('[data-setting="quiet"]').getByRole("radio", { name: "Never quiet" }).check();
    // Fix/settings-autosave: each change saves itself; no Save button.
    await expect(form.getByRole("button", { name: "Save" }).count()).resolves.toBe(0);
    await expect.poll(() => form.textContent(), { timeout: 5000 }).toContain("Saved");
    const saved = await page.evaluate(() => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "settings.load", input: {} }) }).then((r) => r.json()));
    expect(saved.data.notify).toMatchObject({ quiet: "off", kinds: { checkin: false, closeout: true } });
    await expect(form.locator('[data-setting="test-notification"]').getByRole("button", { name: "Send now" }).count()).resolves.toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("NT-1: Days off says PTO and company holidays, and saves the same stored value", async () => {
    const { page, errors } = await freshPage(h);
    const load = () => page.evaluate(() => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "settings.load", input: {} }) }).then((r) => r.json()).then((j) => j.data.notify.quietPto as boolean));
    await openSettings(page);
    await settingsSection(page, "notifications");
    const field = page.locator('[data-setting="quiet-pto"]');
    await field.waitFor();
    await expect(field.textContent()).resolves.toContain("Quiet on days off");
    await expect(field.textContent()).resolves.toContain("PTO and company holidays from Dataverse.");
    const box = field.getByRole("switch");
    await expect(box.isChecked()).resolves.toBe(true);
    await box.uncheck();
    await expect.poll(load, { timeout: 5000 }).toBe(false);
    await box.check();
    await expect.poll(load, { timeout: 5000 }).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Start without a preview off: the morning box's Start shows the preview instead", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    await settingsSection(page, "connections");
    const toggle = page.locator(".set-field", { hasText: "Start without a preview" }).locator("input");
    await toggle.waitFor();
    await expect(toggle.isChecked()).resolves.toBe(true);
    await toggle.uncheck();
    await expect.poll(() => page.locator(".set-field", { hasText: "Start without a preview" }).textContent(), { timeout: 5000 }).toContain("Saved");
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
    await expectView("planday", "aside.block-panel");
    await expectView("planweek:2026-11-09", "aside.block-panel");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/week/2026-11-09/add");
    await expectView("focus", ".focus-screen");
    await expectView("inbox", 'main[aria-label="Inbox"]');
    await expectView("settings:notifications", '.ps-body [data-setting^="notify-"]');
    await expectView("today", ".today-view");
    // A promise I added (a follow-up before IB-1) opens the Inbox with it open in the detail pane.
    const id = await page.evaluate(() => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "followups.list", input: {} }) }).then((r) => r.json()).then((j) => j.data.followUps[0].id as number));
    await expectView(`followup:${id}`, `li.ib4-row.open[data-key="f${id}"]`);
    // My VM: Today with the VM chip's menu open.
    await expectView("vm", '.menu-list[role="menu"]');
    await expect(page.locator(".menu-list").textContent()).resolves.toContain("Choose another VM");
    // Anything unknown does nothing.
    await go("javascript:alert(1)");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});

