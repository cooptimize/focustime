// Was e2e/notify.test.ts until BT-1.
// Step 15.5, SA-3: Settings › Reminders and notices (each reminder's row, quiet, the kinds folded), Settings > My VM's "Start without a preview"
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

  // SA-3 tests 3 and 6: each reminder is one row whose switch, time and Also in Teams write the keys they always did;
  // Also in Teams keeps its value while In Teams is off; Quiet's switch stores what the old select stored.
  it("Reminders and notices: each reminder's switch, time and Also in Teams save their own keys; Quiet stores its two values", async () => {
    const { page, errors } = await freshPage(h);
    const load = () => page.evaluate(() => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "settings.load", input: {} }) }).then((r) => r.json()).then((j) => j.data));
    await openSettings(page);
    await settingsSection(page, "notifications");
    await page.locator(".ps-head h2", { hasText: "Reminders and notices" }).waitFor();
    const body = page.locator(".ps-body");
    for (const id of ["teams-kind-brief", "notify-plan-day", "notify-checkin", "notify-closeout", "week-nudges", "notify-status-report", "notify-plan-ahead", "notify-direction"]) await body.locator(`[data-setting="${id}"]`).first().waitFor();
    // The kinds are folded, with their count; the seven new switches are inside.
    const fold = body.locator(".sp-fold > summary", { hasText: "Each kind of notice" });
    await expect(fold.textContent()).resolves.toMatch(/Each kind of notice · 17 more/);
    await fold.click();
    for (const name of ["Someone took your story", "Someone assigned you an item", "Someone moved your dates", "Someone edited your item"]) await expect(body.locator(".sp-row", { hasText: name }).count(), name).resolves.toBeGreaterThan(0);

    // The row's switch is the reminder's own kind; its time is the [plan] key.
    const checkin = body.locator('[data-setting="notify-checkin"]');
    await checkin.getByRole("switch").first().uncheck();
    await expect.poll(async () => (await load()).notify.kinds.checkin, { timeout: 5000 }).toBe(false);
    const minutes = checkin.locator('[data-setting="checkin-reminder"] input');
    await minutes.fill("20");
    await minutes.press("Enter");
    await expect.poll(async () => (await load()).planning.checkinReminderMinutes, { timeout: 5000 }).toBe(20);
    // Plan next week: two switches, three times.
    await body.locator('[data-setting="notify-plan-week"]').getByRole("switch").uncheck();
    await expect.poll(async () => (await load()).notify.kinds.plan_week, { timeout: 5000 }).toBe(false);

    // Also in Teams: greyed with the reason while In Teams is off, its value kept; on, it saves teams_checkin.
    const also = checkin.locator('[data-setting="teams-kind-checkin"] input');
    await expect(also.isDisabled()).resolves.toBe(true);
    await expect(checkin.textContent()).resolves.toContain("Teams messages are off");
    await body.locator('[data-setting="teams-messages"]').getByRole("switch").check();
    await expect(also.isDisabled()).resolves.toBe(false);
    await also.check();
    await expect.poll(async () => (await load()).notify.teams.checkin, { timeout: 5000 }).toBe(true);
    await body.locator('[data-setting="teams-messages"]').getByRole("switch").uncheck();
    await expect.poll(async () => (await load()).notify.teamsMessages, { timeout: 5000 }).toBe(false);
    expect((await load()).notify.teams.checkin).toBe(true);
    await expect(also.isChecked()).resolves.toBe(true);

    // Quiet: off stores "off" (Never quiet), on stores "outside_hours".
    const quiet = body.locator('[data-setting="quiet"]').getByRole("switch");
    await quiet.uncheck();
    await expect.poll(async () => (await load()).notify.quiet, { timeout: 5000 }).toBe("off");
    await quiet.check();
    await expect.poll(async () => (await load()).notify.quiet, { timeout: 5000 }).toBe("outside_hours");
    // No Save button; one Send a test for this device.
    await expect(body.getByRole("button", { name: "Save" }).count()).resolves.toBe(0);
    await expect(body.locator('[data-setting="test-notification"]').getByRole("button", { name: "Send a test" }).count()).resolves.toBe(1);
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

