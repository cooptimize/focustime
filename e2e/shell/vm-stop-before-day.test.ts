// VM-5: a Stop before the day no longer cancels the morning's automatic start, in a real browser on the demo told it
// is production (a fictional person and VM on the fake Azure Resource Manager; no Azure calls; the clock moved by
// demo.vm_tick). A Stop at 2:51 AM: the preview says when it starts again, with "Skip today's start too" unticked; the
// message after says it; at 8:55 it starts. A skip says why in the chip's menu and Settings, with Don't skip before its
// time. Screenshots (dark) when VM5_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openSettings, settingsSection, startDemo, type Harness } from "../harness.ts";

const T = 240_000;
const SHOTS = process.env.VM5_SHOTS ?? null;
// Monday Nov 2, 2026, 2:51 AM in New York; the demo's working day starts at 9:00, so with 5 minutes the start is 8:55.
const NIGHT = "2026-11-02T02:51:00-05:00";

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
async function menu(page: Page) {
  await page.keyboard.press("Escape");
  await chip(page).click();
  const m = page.locator('.menu-list[role="menu"]');
  await m.waitFor();
  return m;
}
async function myVm(page: Page) {
  // A reload may land with Settings already open (its address is kept).
  await page.waitForTimeout(500);
  if (!(await page.locator(".ps-rail").first().isVisible())) await openSettings(page);
  await settingsSection(page, "connections");
  const form = page.locator('[data-setting="vm-autostart"]');
  await form.scrollIntoViewIfNeeded();
  return form;
}
async function autoStartOn(page: Page) {
  expect((await post(page, "settings.save", { section: "vm", values: { autoStart: true, autoStartMinutes: 5 } })).ok).toBe(true);
}

describe.skipIf(!CHROMIUM)("VM-5 as production (the demo told it is prod)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_DEMO_AUTOSTART_ENV: "prod" }, NIGHT);
  }, 120_000);
  afterAll(async () => h?.stop());

  it("a Stop at 2:51 AM: the preview says it starts again at 8:55 with the box unticked, the message says so, and it starts at 8:55", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await autoStartOn(page);
    // Working late: the VM is on.
    const sp = await post<{ previewId: string }>(page, "vm.preview", { op: "start" });
    expect((await post(page, "vm.confirm", { previewId: sp.data.previewId })).ok).toBe(true);
    await page.reload();
    await expect.poll(() => chip(page).textContent(), { timeout: 60_000, interval: 1000 }).toContain("Running");

    const m = await menu(page);
    await m.getByRole("menuitem", { name: /^Stop/ }).click();
    const dlg = page.getByRole("dialog", { name: "Stop your VM" });
    await dlg.waitFor();
    await expect(dlg.textContent()).resolves.toContain("It will start again today at 8:55 AM.");
    const box = dlg.getByLabel("Skip today's start too");
    await expect(box.isChecked()).resolves.toBe(false);
    await shot(page, "1-stop-preview");
    await dlg.getByRole("button", { name: "Stop" }).click();
    await page.getByText("Stopped. It will start again at 8:55 AM.").waitFor({ timeout: 15_000 });
    await shot(page, "2-stop-message");
    await expect.poll(() => chip(page).textContent(), { timeout: 60_000, interval: 1000 }).toContain("Stopped (deallocated)");

    // 8:55: started, as Nov 18 should have.
    expect(await tick(page, 6 * 60 + 4)).toBe("started");
    await page.reload();
    await expect.poll(() => chip(page).textContent(), { timeout: 60_000, interval: 1000 }).toMatch(/Starting…|Running/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

});

// Its own demo server: the clock that demo.vm_tick moves is the server's, shared by its sessions.
describe.skipIf(!CHROMIUM)("VM-5 as production: a skip says why", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_DEMO_AUTOSTART_ENV: "prod" }, NIGHT);
  }, 120_000);
  afterAll(async () => h?.stop());

  it("a skip says why in the chip's menu and Settings; Don't skip before its time, gone after it", async () => {
    // 2:51 AM, the VM off.
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await autoStartOn(page);
    await page.reload();
    let m = await menu(page);
    await m.getByRole("menuitem", { name: /^Skip this one/ }).click();
    m = await menu(page);
    await expect.poll(() => m.getByRole("menuitem").allTextContents(), { timeout: 10_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^Skipped today: you pressed Skip this one/), expect.stringMatching(/^Don't skip/)]));
    await shot(page, "3-chip-menu-skipped");
    // Don't skip: today's start is back.
    await m.getByRole("menuitem", { name: /^Don't skip/ }).click();
    m = await menu(page);
    await expect.poll(() => m.getByRole("menuitem", { name: /^Auto-start/ }).textContent(), { timeout: 10_000 }).toMatch(/Auto-start: Mon 8:55 AM/);
    await page.keyboard.press("Escape");

    // Not today on Day: Settings says so, with Don't skip.
    expect((await post(page, "vm.dismiss_prompt")).ok).toBe(true);
    await page.reload();
    const form = await myVm(page);
    await expect.poll(() => form.locator(".vm-next").textContent(), { timeout: 10_000 }).toBe("Skipped today: you chose Not today on Day. Next: Tue, Nov 3 at 8:55 AMDon't skip");
    await shot(page, "4-settings-skipped");

    // After its time: the same words, and the way on is Start.
    expect(await tick(page, 6 * 60 + 5)).toBe("not_due");
    await page.reload();
    const after = await myVm(page);
    await expect.poll(() => after.locator(".vm-next").textContent(), { timeout: 10_000 }).toBe("Skipped today: you chose Not today on Day. Next: Tue, Nov 3 at 8:55 AM");
    await expect(after.getByRole("button", { name: "Don't skip" }).count()).resolves.toBe(0);
    await shot(page, "5-settings-after-time");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
