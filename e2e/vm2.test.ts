// VM-2: Stop and the auto-start before the day, in a real browser on the demo (a fictional person and VMs on the fake
// Azure Resource Manager; no Azure calls). The environment is passed in explicitly (FOCUSTIME_DEMO_AUTOSTART_ENV) and the
// demo's clock is moved by demo.vm_tick (verification runs only). As production: on with 5 minutes, the line says the
// next time, the VM starts at it, the chip follows, the log says automatic, Skip this one prevents the next start, and
// Stop has its preview. As dev: the same person opted in, the clock past the time, nothing starts and the form says
// production only. Screenshots at 1440x900, light and dark, when VM2_SHOTS names a folder (docs/ux/vm2).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openSettings, settingsSection, startDemo, type Harness } from "./harness.ts";

const T = 240_000;
const SHOTS = process.env.VM2_SHOTS ?? null;
// Monday Nov 2, 2026, 6:00 AM in New York; the demo's working day starts at 9:00.
const EARLY = "2026-11-02T06:00:00-05:00";
const SPARE = "/subscriptions/00000000-0000-4000-8000-0000000000f1/resourceGroups/rg-demo-dev/providers/Microsoft.Compute/virtualMachines/vm-demo-spare";

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

async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
  }
}
async function myVmSettings(page: Page) {
  await openSettings(page);
  await settingsSection(page, "connections");
  const form = page.locator('[data-setting="vm-autostart"]');
  await form.scrollIntoViewIfNeeded();
  return form;
}
const chip = (page: Page) => page.locator(".topbar .vm-chip");
async function menu(page: Page) {
  await page.keyboard.press("Escape");
  await chip(page).click();
  const m = page.locator('.menu-list[role="menu"]');
  await m.waitFor();
  return m;
}

describe.skipIf(!CHROMIUM)("VM-2 as production (the demo told it is prod)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_DEMO_AUTOSTART_ENV: "prod" }, EARLY);
  }, 120_000);
  afterAll(async () => h?.stop());

  it("on with 5 minutes: the next time, the start at it, the chip and the log; Skip this one; Stop with its preview", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const form = await myVmSettings(page);
    await shots(page, "autostart-off");
    await form.getByLabel("Start my VM before my day").click();
    await form.getByLabel("Minutes before my day starts").selectOption("5");
    await expect.poll(() => form.locator(".vm-next").textContent(), { timeout: 10_000 }).toBe("Next: Mon, Nov 2 at 8:55 AM");
    await expect(form.textContent()).resolves.toContain("Its auto-shutdown: off at 7:00 PM (read only");
    await expect(form.textContent()).resolves.not.toContain("only on the production FocusTime");
    await shots(page, "autostart-on");

    // The clock to 8:55: the VM starts.
    expect(await tick(page, 175)).toBe("started");
    await page.reload();
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain("Starting…");
    await expect.poll(() => chip(page).textContent(), { timeout: 60_000, interval: 1000 }).toContain("Running");
    // One a day: another pass does nothing.
    expect(await tick(page, 1)).toBe("not_due");

    // The chip's menu: Stop, and tomorrow's start with Skip this one.
    let m = await menu(page);
    await expect(m.getByRole("menuitem").allTextContents()).resolves.toEqual([expect.stringMatching(/^Stop/), expect.stringMatching(/^Auto-start: Tue 8:55 AM/), expect.stringMatching(/^Skip this one/), expect.stringMatching(/^Refresh/), expect.stringMatching(/^Choose another VM/)]);
    await shots(page, "chip-menu-stop-autostart");
    await m.getByRole("menuitem", { name: /^Skip this one/ }).click();
    m = await menu(page);
    await expect.poll(() => m.getByRole("menuitem", { name: /^Auto-start/ }).textContent(), { timeout: 10_000 }).toMatch(/Auto-start: Wed 8:55 AM/);

    // Stop: the preview first, then deallocated.
    await m.getByRole("menuitem", { name: /^Stop/ }).click();
    const dlg = page.getByRole("dialog", { name: "Stop your VM" });
    await dlg.waitFor();
    const text = await dlg.textContent();
    expect(text).toContain("vm-demo-alex");
    expect(text).toMatch(/deallocated: it shuts down and stops billing/);
    expect(text).toMatch(/remote session, Coop/);
    expect(text).toContain("Its auto-shutdown isn't changed.");
    await shots(page, "stop-preview");
    await dlg.getByRole("button", { name: "Stop" }).click();
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain("Stopping…");
    await expect.poll(() => chip(page).textContent(), { timeout: 60_000, interval: 1000 }).toContain("Stopped (deallocated)");

    // Tuesday 8:55, skipped: nothing starts.
    expect(await tick(page, 1440)).toBe("not_due");
    await page.reload();
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain("Stopped (deallocated)");

    // The log: an automatic start and my stop.
    await page.keyboard.press(",");
    await settingsSection(page, "activity");
    const log = page.locator('[aria-label="Azure write log"]');
    await expect.poll(() => log.textContent(), { timeout: 10_000 }).toMatch(/Stopped \(deallocated\) vm-demo-alex · by Alex Rivera.*Confirmed.*Started vm-demo-alex · automatic.*Confirmed/s);
    await log.scrollIntoViewIfNeeded();
    await shots(page, "write-log");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("after 3 working days without FocusTime it pauses: said once with Resume; the form says paused", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    // A new demo session (its own store and clock): on, then the days pass with nobody using FocusTime.
    expect((await post(page, "settings.save", { section: "vm", values: { autoStart: true } })).ok).toBe(true);
    // Its first pass (Tuesday) notes it on; three working days later with no use, a pass pauses it.
    const seen: string[] = [];
    for (let i = 0; i < 10 && seen.at(-1) !== "paused"; i++) seen.push(await tick(page, 1440));
    expect(seen.at(-1)).toBe("paused");
    await page.reload();
    const notice = page.getByRole("status", { name: "VM auto-start paused" });
    await notice.waitFor({ timeout: 15_000 });
    const form = await myVmSettings(page);
    await expect.poll(() => form.locator(".vm-next").textContent(), { timeout: 10_000 }).toMatch(/^Paused/);
    await shots(page, "autostart-paused");
    await notice.getByRole("button", { name: "Resume" }).click();
    await expect.poll(() => notice.count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => form.locator(".vm-next").textContent(), { timeout: 10_000 }).toMatch(/^(.* )?Next: /);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("VM-2 as dev (the demo told it is dev)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_DEMO_AUTOSTART_ENV: "dev" }, EARLY);
  }, 120_000);
  afterAll(async () => h?.stop());

  it("opted in, the clock past the time: nothing starts; the form says production only; no auto-start in the menu", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const form = await myVmSettings(page);
    await form.getByLabel("Start my VM before my day").click();
    await expect.poll(() => form.locator(".vm-prod-only").textContent(), { timeout: 10_000 }).toBe("Auto-start runs only on the production FocusTime. Here it never starts your VM.");
    await expect.poll(() => form.locator(".vm-next").textContent()).toBe("Next: never here. It runs only on the production FocusTime.");
    await shots(page, "autostart-dev");
    expect(await tick(page, 175)).toBe("env");
    expect(await tick(page, 30)).toBe("env");
    await page.reload();
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain("Stopped (deallocated)");
    const m = await menu(page);
    await expect(m.getByRole("menuitem", { name: /Auto-start|Skip this one/ }).count()).resolves.toBe(0);
    const log = await post<{ entries: unknown[] }>(page, "vm.log");
    expect(log.data.entries).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Start and Stop pressed by a person work on dev too, each with its preview", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.keyboard.press("1");
    let m = await menu(page);
    await m.getByRole("menuitem", { name: /^Start/ }).click();
    await page.getByRole("dialog", { name: "Start your VM" }).getByRole("button", { name: "Start" }).click();
    await expect.poll(() => chip(page).textContent(), { timeout: 60_000, interval: 1000 }).toContain("Running");
    m = await menu(page);
    await m.getByRole("menuitem", { name: /^Stop/ }).click();
    await page.getByRole("dialog", { name: "Stop your VM" }).getByRole("button", { name: "Stop" }).click();
    await expect.poll(() => chip(page).textContent(), { timeout: 60_000, interval: 1000 }).toContain("Stopped (deallocated)");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a VM with no auto-shutdown asks for one more tick before auto-start turns on", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    expect((await post(page, "settings.save", { section: "vm", values: { autoStart: false } })).ok).toBe(true);
    expect((await post(page, "vm.choose", { vmId: SPARE })).ok).toBe(true);
    await page.reload();
    const form = await myVmSettings(page);
    await form.getByLabel("Start my VM before my day").click();
    const warn = form.locator(".vm-warning");
    await expect.poll(() => warn.textContent(), { timeout: 10_000 }).toContain("This VM has no auto-shutdown. Once started it runs until you stop it.");
    const saved = await post<{ vm: { autoStart: { on: boolean } } }>(page, "settings.load");
    expect(saved.ok && (saved.data as unknown as { vm: { autoStart: { on: boolean } } }).vm.autoStart.on).toBe(false);
    await shots(page, "autostart-no-shutdown");
    await warn.getByLabel("I understand: turn auto-start on").click();
    await expect.poll(async () => ((await post(page, "settings.load")).data as { vm: { autoStart: { on: boolean } } }).vm.autoStart.on, { timeout: 10_000 }).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
