// VM-6: Azure's reason in the VM chip's menu, in a real browser on the demo (a fictional person and VM on the fake
// Azure Resource Manager; no Azure calls). Still refused after 2 minutes, the menu says under the state Azure's reason
// in plain words and when the state was last read; a 403 asking for the sign-in again is the sign-in item; the state
// read and the auto-shutdown read refused, the state stays and the menu says the time couldn't be read.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 180_000;
const post = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;
const chip = (page: Page) => page.locator(".topbar .vm-chip");
const note = (page: Page) => page.locator('.popup-menu .menu-note[role="note"]');
const nudge = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
/** Reads fail this way, and 3 minutes pass on the server's clock: the chip says the reason. */
async function failFor(page: Page, kind: string | null) {
  await post(page, "demo.vm_fail", { kind });
  // One read fails first (the failing starts then), and 3 minutes pass before the next.
  await page.waitForTimeout(9_000);
  await nudge(page);
  if (kind !== "schedule") await expect.poll(() => chip(page).getAttribute("class"), { timeout: 15_000 }).toContain("vm-checking");
  await post(page, "demo.vm_tick", { advanceMinutes: 3 });
  await page.waitForTimeout(9_000);
  await nudge(page);
}

describe.skipIf(!CHROMIUM)("VM-6: Azure's reason in the VM chip's menu (browser, demo mode)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("not allowed, not found, the sign-in asked again, and the auto-shutdown unread", async () => {
    const { page, errors } = await freshPage(h);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain("Stopped (deallocated)");

    for (const [kind, short, words] of [
      ["refused", "Azure refused", "isn't allowed to read this VM right now. If your access is switched on for a time, switch it on again in Azure."],
      ["not_found", "VM not found", "Azure can't find this VM. It may have been moved or deleted."],
    ] as const) {
      await failFor(page, kind);
      await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain(short);
      // The face stays short: the state's word and the reason's few words.
      expect(await chip(page).textContent()).not.toContain("switch it on");
      await chip(page).click();
      await note(page).waitFor();
      expect(await note(page).textContent()).toContain(words);
      expect(await note(page).textContent()).toMatch(/Last read (\w{3} )?\d{1,2}:\d\d [AP]M/);
      await page.keyboard.press("Escape");
    }

    // A 403 asking for the sign-in again: the sign-in item, not "Azure refused".
    await failFor(page, "challenge");
    await expect.poll(() => chip(page).textContent(), { timeout: 15_000 }).toContain("Sign in to Azure again");
    await chip(page).click();
    await page.getByRole("menuitem", { name: /Sign in to Azure again/ }).waitFor();
    await page.keyboard.press("Escape");

    // The state read, the auto-shutdown not: the state shows, and the menu says the time couldn't be read.
    await failFor(page, "schedule");
    await expect.poll(() => chip(page).getAttribute("class"), { timeout: 15_000 }).not.toContain("vm-checking");
    expect(await chip(page).textContent()).toContain("Stopped (deallocated)");
    await chip(page).click();
    await note(page).waitFor();
    expect(await note(page).textContent()).toContain("FocusTime couldn't read your VM's auto-shutdown time.");
    await page.keyboard.press("Escape");

    await post(page, "demo.vm_fail", { kind: null });
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
