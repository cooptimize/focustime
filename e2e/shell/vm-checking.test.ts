// VM-4: the VM chip while reads of the VM's state fail, in a real browser on the demo (a fictional person and VM on
// the fake Azure Resource Manager; no Azure calls). One failed read keeps the last state with a quiet checking mark;
// still failing after 2 minutes, the chip says the reason on its face and its menu says the same words and what to
// do; Azure answering with no state is the one case that says Unknown; reads working again clear it. Pictures at
// 1440x900 and 390x844 when VM4_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 180_000;
const SHOTS = process.env.VM4_SHOTS ?? null;

const post = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;
const chip = (page: Page) => page.locator(".topbar .vm-chip");
const menu = (page: Page) => page.locator('.menu-list[role="menu"]');
/** Ask the chip to read again now (as coming back to the tab does), instead of waiting for its 10 s. */
const nudge = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const [w, hgt, tag] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-${tag}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

describe.skipIf(!CHROMIUM)("VM-4: the VM chip while reads fail (browser, demo mode)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("one failure: the last state, checking; after 2 minutes the reason, in the menu too; working again clears it", async () => {
    const { page, errors } = await freshPage(h);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain("Stopped (deallocated)");
    expect((await post(page, "demo.vm_fail", { kind: "refused" })).ok).toBe(true);
    // A read fails: the state stays, marked checking. Never Unknown.
    await page.waitForTimeout(9_000);
    await nudge(page);
    await expect.poll(() => chip(page).getAttribute("class"), { timeout: 15_000 }).toContain("vm-checking");
    expect(await chip(page).textContent()).toContain("Stopped (deallocated)");
    expect(await chip(page).textContent()).not.toContain("Unknown");
    // On the page's own clock (the demo's server clock is days off): seconds ago, not hours.
    expect(await chip(page).getAttribute("title")).toMatch(/Last read (just now|\d+ seconds ago|1 minute ago)/);
    await shot(page, "chip-checking");
    await chip(page).click();
    await menu(page).waitFor();
    expect(await menu(page).getByRole("menuitem").first().textContent()).toMatch(/^Checking…/);
    await shot(page, "menu-checking");
    await page.keyboard.press("Escape");

    // Two minutes later, still failing: the reason on the chip's face, the same words and what to do in its menu.
    for (const [kind, short] of [["refused", "Azure refused"], ["network", "Can't reach Azure"], ["busy", "Azure is busy"], ["sign_in", "Sign in to Azure again"]] as const) {
      await post(page, "demo.vm_fail", { kind });
      await post(page, "demo.vm_tick", { advanceMinutes: 3 });
      await page.waitForTimeout(9_000);
      await nudge(page);
      await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain(short);
      expect(await chip(page).textContent()).toContain("Stopped (deallocated)");
      await chip(page).click();
      await menu(page).waitFor();
      const first = menu(page).getByRole("menuitem").first();
      expect(await first.textContent()).toContain(short);
      if (kind === "sign_in") expect(await menu(page).getByRole("menuitem", { name: /Allow Azure access/ }).count()).toBe(1);
      await shot(page, `menu-${kind}`);
      await page.keyboard.press("Escape");
      await shot(page, `chip-${kind}`);
    }

    // Reads work again: the chip says the state, nothing else.
    await post(page, "demo.vm_fail", { kind: null });
    await page.waitForTimeout(9_000);
    await nudge(page);
    await expect.poll(() => chip(page).getAttribute("class"), { timeout: 15_000 }).not.toContain("vm-checking");
    expect(await chip(page).textContent()).not.toMatch(/Azure|Checking/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Azure answering with no state is the one case that says Unknown", async () => {
    const { page, errors } = await freshPage(h);
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toMatch(/Stopped|Running/);
    await post(page, "demo.vm_fail", { kind: "no_state" });
    await page.waitForTimeout(9_000);
    await nudge(page);
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain("Unknown");
    await post(page, "demo.vm_fail", { kind: null });
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
