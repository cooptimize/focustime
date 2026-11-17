// VM-3: what the person sees when the automatic start left the VM off, in a real browser on the demo (a fictional
// person and VMs on the fake Azure Resource Manager; no Azure calls). As production (FOCUSTIME_DEMO_AUTOSTART_ENV), the
// demo's clock moved past the late limit with nobody running FocusTime: the chip's mark and title, the menu's line, one
// notice, and Settings' line say "FocusTime wasn't running at the time", then the next morning's start replaces it with
// "Started today at 8:55 AM". As dev: the same moment says nothing and starts nothing. Dark screenshots when VM3_SHOTS
// names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openSettings, settingsSection, startDemo, type Harness } from "../harness.ts";

const T = 240_000;
const SHOTS = process.env.VM3_SHOTS ?? null;
// Monday Nov 2, 2026, 6:00 AM in New York; the demo's working day starts at 9:00.
const EARLY = "2026-11-02T06:00:00-05:00";

async function post<T = unknown>(page: Page, action: string, input: unknown = {}): Promise<{ ok: boolean; data: T; error?: string }> {
  return page.evaluate(
    async ([a, i]) => {
      const csrf = document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "";
      const r = await fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ action: a, input: i }) });
      return r.json();
    },
    [action, input] as const,
  );
}
const tick = async (page: Page, minutes: number) => (await post<{ outcome: string }>(page, "demo.vm_tick", { advanceMinutes: minutes })).data.outcome;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-dark"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
const chip = (page: Page) => page.locator(".topbar .vm-chip");
/** ⋯ › Notifications: the rows titled "Your VM was left off". */
async function leftOffNotices(page: Page) {
  await page.keyboard.press("Escape");
  await page.locator(".topbar .top-more").click();
  await page.getByRole("menuitem", { name: /Notifications/ }).click();
  const panel = page.locator(".notices-panel");
  await panel.waitFor();
  return panel.locator(".notice-row", { hasText: "Your VM was left off" });
}
async function vmLine(page: Page) {
  await openSettings(page);
  await settingsSection(page, "connections");
  const form = page.locator('[data-setting="vm-autostart"]');
  await form.scrollIntoViewIfNeeded();
  return form.locator(".vm-next");
}

describe.skipIf(!CHROMIUM)("VM-3 as production: the VM left off, and why", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_DEMO_AUTOSTART_ENV: "prod" }, EARLY);
  }, 120_000);
  afterAll(async () => h?.stop());

  it("FocusTime wasn't running at 8:55: the chip, its menu, one notice and Settings say so; the next morning's start replaces it", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    expect((await post(page, "settings.save", { section: "vm", values: { autoStart: true, autoStartMinutes: 5 } })).ok).toBe(true);
    // Nothing ran until 10:01, past the late limit (an hour after the day's start): nothing is started.
    expect(await tick(page, 241)).toBe("not_due");
    await page.reload();
    await chip(page).waitFor();
    const rows = await leftOffNotices(page);
    await expect.poll(() => rows.count(), { timeout: 15_000 }).toBe(1);
    await expect(rows.first().textContent()).resolves.toContain("Left off today: FocusTime wasn't running at the time.");
    await shot(page, "notice-left-off");
    await page.keyboard.press("Escape");
    // The chip: still stopped, with the mark and the reason in its title.
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain("Stopped (deallocated)");
    await chip(page).locator(".vm-attn").waitFor();
    await expect(chip(page).getAttribute("title")).resolves.toContain("Left off today: FocusTime wasn't running at the time");
    // Its menu: the reason first among the auto-start lines; opening it clears the mark, the reason stays.
    await page.keyboard.press("Escape");
    await chip(page).click();
    const m = page.locator('.menu-list[role="menu"]');
    await m.waitFor();
    await m.getByRole("menuitem", { name: /Left off today: FocusTime wasn't running at the time/ }).waitFor();
    await shot(page, "chip-menu-left-off");
    await page.keyboard.press("Escape");
    await expect.poll(() => chip(page).locator(".vm-attn").count(), { timeout: 10_000 }).toBe(0);
    // Settings' line: what happened today, then the next start (never 8:55 today as if still to come).
    const line = await vmLine(page);
    await expect.poll(() => line.textContent(), { timeout: 10_000 }).toBe("Left off today: FocusTime wasn't running at the time. Next: Tue, Nov 3 at 8:55 AM");
    await shot(page, "settings-left-off");
    // One notice: another pass and a reload don't bring it back.
    expect(await tick(page, 5)).toBe("not_due");
    await page.reload();
    await chip(page).waitFor();
    expect(await (await leftOffNotices(page)).count()).toBe(1);
    await page.keyboard.press("Escape");

    // Tuesday 8:55: it starts, and the line says when.
    expect(await tick(page, 1369)).toBe("started");
    await page.reload();
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toMatch(/Starting…|Running/);
    expect(await chip(page).locator(".vm-attn").count()).toBe(0);
    const after = await vmLine(page);
    await expect.poll(() => after.textContent(), { timeout: 10_000 }).toMatch(/^Started today at 8:55 AM\. Next: /);
    await shot(page, "settings-started");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("VM-3 as dev: the same morning says and starts nothing", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_DEMO_AUTOSTART_ENV: "dev" }, EARLY);
  }, 120_000);
  afterAll(async () => h?.stop());

  it("past the late limit: no reason, no notice, no start", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    expect((await post(page, "settings.save", { section: "vm", values: { autoStart: true, autoStartMinutes: 5 } })).ok).toBe(true);
    expect(await tick(page, 241)).toBe("env");
    await page.reload();
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain("Stopped (deallocated)");
    expect(await chip(page).locator(".vm-attn").count()).toBe(0);
    expect(await (await leftOffNotices(page)).count()).toBe(0);
    await page.keyboard.press("Escape");
    const line = await vmLine(page);
    await expect.poll(() => line.textContent(), { timeout: 10_000 }).toBe("Next: never here. It runs only on the production FocusTime.");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
