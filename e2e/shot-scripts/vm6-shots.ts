// VM-6: the four pictures for the pull request, only when VM6_SHOTS names a folder; nothing runs otherwise. Demo data
// only (a fictional person and VM on the fake Azure), dark, 1440 by 900, the top right where the chip and its menu are:
// the menu for "not allowed right now" and "not found" with Last read, the sign-in asked again, and the state shown
// with the auto-shutdown time unread.
import { afterAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.VM6_SHOTS ?? null;
const T = 600_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean }>;
const chip = (page: Page) => page.locator(".topbar .vm-chip");
const nudge = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

describe.skipIf(!CHROMIUM || !DIR)("VM-6 screenshots", () => {
  let h: Harness | null = null;
  afterAll(async () => h?.stop());

  it("the chip's menu for each reason", async () => {
    h = await startDemo();
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    await page.locator(".topbar").first().waitFor({ timeout: 30_000 });
    await call(page, "ui.set_theme", { theme: "cooptimize-dark" });
    await page.reload();
    await expect.poll(() => chip(page).textContent(), { timeout: 30_000 }).toContain("Stopped");
    const failFor = async (kind: string) => {
      await call(page, "demo.vm_fail", { kind });
      await page.waitForTimeout(9_000);
      await nudge(page);
      await page.waitForTimeout(1_500);
      await call(page, "demo.vm_tick", { advanceMinutes: 3 });
      await page.waitForTimeout(9_000);
      await nudge(page);
      await page.waitForTimeout(1_500);
    };
    const shot = async (name: string) => {
      const r = await chip(page).boundingBox();
      await chip(page).click();
      await page.locator(".popup-menu").waitFor();
      await page.waitForTimeout(500);
      const x = Math.max(0, Math.round((r?.x ?? 900) - 420));
      await page.screenshot({ path: `${DIR}/${name}.png`, clip: { x, y: 0, width: 1440 - x, height: 520 } });
      await page.keyboard.press("Escape");
    };
    await failFor("refused");
    await shot("1-not-allowed");
    await failFor("not_found");
    await shot("2-not-found");
    await failFor("challenge");
    await shot("3-sign-in");
    await failFor("schedule");
    await shot("4-auto-shutdown-unread");
    await call(page, "demo.vm_fail", { kind: null });
  }, T);
});
