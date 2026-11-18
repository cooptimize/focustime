// VM-3: Admin › Health's background passes on the demo (its person is an admin of their own demo): when the fast and
// slow passes last finished, how long they took and their limit; with the demo's slow pass held (demo.pass_stall,
// verification runs only) and the demo's clock moved past its limit, a plain warning in the table and in "To look at",
// gone once it lets go. Dark screenshots when VM3_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 180_000;
const SHOTS = process.env.VM3_SHOTS ?? null;
const EARLY = "2026-11-02T09:30:00-05:00";

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
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-dark"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
async function openStatus(page: Page) {
  // Away and back: Status is read when it opens.
  await page.evaluate(() => (location.hash = "#/admin/audit"));
  await page.locator('.ps-rail [data-settings-section="audit"][aria-current="page"]').waitFor();
  await page.evaluate(() => (location.hash = "#/admin/health"));
  const table = page.locator('table[data-status="passes"]');
  await table.waitFor({ timeout: 15_000 });
  return table;
}

describe.skipIf(!CHROMIUM)("VM-3: Admin › Health's background passes", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_DEMO_AUTOSTART_ENV: "dev" }, EARLY);
  }, 120_000);
  afterAll(async () => h?.stop());

  it("each pass with when it finished, how long and its limit; a held pass past its limit warns until it lets go", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    let table = await openStatus(page);
    const slow = table.locator('tr[data-pass="slow"]');
    await expect(table.locator('tr[data-pass="fast"]').textContent()).resolves.toMatch(/Fast pass.*Nov 2.*(under a second|\d+ seconds).*2 minutes/);
    await expect(slow.textContent()).resolves.toMatch(/Slow pass.*Nov 2.*10 minutes$/);
    expect(await page.locator(".adm-warnings").filter({ hasText: "slow pass" }).count()).toBe(0);
    await table.scrollIntoViewIfNeeded();
    await shot(page, "admin-passes");

    // Held, then 11 minutes on.
    expect((await post(page, "demo.pass_stall", { on: true })).ok).toBe(true);
    await openStatus(page);
    expect((await post(page, "demo.vm_tick", { advanceMinutes: 11 })).ok).toBe(true);
    table = await openStatus(page);
    await expect.poll(() => table.locator('tr[data-pass="slow"]').textContent(), { timeout: 10_000 }).toMatch(/has been running for 11 minutes, past its 10 minutes limit\. The next pass runs anyway/);
    await page.locator(".adm-warnings", { hasText: "The slow pass" }).waitFor();
    expect(await page.locator(".adm-warnings li").count()).toBe(1);
    await table.scrollIntoViewIfNeeded();
    await shot(page, "admin-passes-warning");

    // Let go: the warning goes.
    expect((await post(page, "demo.pass_stall", { on: false })).ok).toBe(true);
    table = await openStatus(page);
    await expect.poll(() => table.locator('tr[data-pass="slow"]').textContent(), { timeout: 10_000 }).not.toMatch(/limit\. The next/);
    expect(await page.locator(".adm-warnings", { hasText: "The slow pass" }).count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
