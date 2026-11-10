// PK-1 (browser, demo mode, Monday Nov 2, 9:30 AM): since FN-1 a tick opens Wrap it up (e2e/fn1.test.ts); here the
// setting that skips it, and Close out of the last workday asks once for its done to-dos (the todo-done seed's Harbor #2211).
// Screenshots at 1920 and the phone, light and dark, when FOCUSTIME_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 120_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const TODAY = "2026-11-02";

async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  const was = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
  for (const scheme of ["light", "dark"] as const) {
    // The app's own theme (as Settings › Display sets it), so the card stays open.
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), `cooptimize-${scheme}`);
    for (const [w, hh] of [[1920, 1080], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: hh });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/pk1-${name}-${w === 1920 ? "1920" : "phone"}-${scheme}.png` });
    }
  }
  await page.evaluate((t) => (document.documentElement.dataset.theme = t), was);
  await page.setViewportSize({ width: 1920, height: 1080 });
}

/** Today planned and confirmed with two Cooptimize to-dos with DevOps items (both mine, open). */
async function planToday(page: Page) {
  expect((await call(page, "planday.start", { date: TODAY })).ok).toBe(true);
  for (const itemId of [4411, 4412]) expect((await call(page, "pick.add", { date: TODAY, half: "AM", clientKey: "Cooptimize", itemId })).ok).toBe(true);
  expect((await call(page, "planday.commit", { date: TODAY })).ok).toBe(true);
  await page.reload();
  await page.getByRole("checkbox", { name: "Done: Timesheet summary query" }).waitFor();
}
const writes = async (page: Page) => ((await call(page, "devops.log", {})).data.entries as { op: string; itemId: number; status: string }[]).filter((e) => e.op === "state" || e.op === "undo_state");

describe.skipIf(!CHROMIUM)("PK-1 checking off a to-do offers the DevOps update (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  // FN-1: a tick on Today opens Wrap it up now (e2e/fn1.test.ts); Never ask is "Always skip DevOps".
  it("Always skip DevOps in Settings › Planning: a tick opens nothing", async () => {
    const { page } = await freshPage(h);
    await planToday(page);
    expect((await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } })).ok).toBe(true);
    await page.reload();
    await page.getByRole("checkbox", { name: "Done: Utilization chart" }).check();
    await page.waitForTimeout(1500);
    await expect(page.getByRole("dialog", { name: "Wrap it up" }).count()).resolves.toBe(0);
    await page.close();
  }, T);

  it("Close out asks once for the day's done to-dos: Finished or Made progress, time left and a comment per row, one preview, one Confirm", async () => {
    const { page, errors } = await freshPage(h);
    // The last workday before Monday Nov 2 is Wednesday Oct 28 (Thursday is the demo's PTO day): the seed's done
    // to-do, Harbor #2211, still open in DevOps.
    await page.evaluate(() => (location.hash = "#/today/closeout/2026-10-28"));
    const batch = page.getByRole("group", { name: "Wrap up in DevOps" });
    await batch.waitFor({ timeout: 20_000 });
    await expect(batch.locator(".db-ask").textContent()).resolves.toMatch(/^1 to-do done on \w+day\. Wrap it up in DevOps\?$/);
    await expect(batch.getByRole("checkbox").count()).resolves.toBe(1);
    // FN-1: each row asks Finished or Made progress; Made progress asks the time left.
    await batch.getByRole("radio", { name: "Made progress" }).click();
    await batch.getByRole("button", { name: "2h", exact: true }).waitFor();
    await batch.getByRole("radio", { name: "Finished" }).click();
    await batch.getByRole("textbox", { name: "Comment on #2211" }).fill("Ready for review");
    await shots(page, "closeout-batch");
    const before = (await writes(page)).length;
    await batch.getByRole("button", { name: "Preview 1" }).click();
    await expect.poll(() => batch.locator(".db-pv").textContent()).toMatch(/#2211: state \w+ → Closed · add comment/);
    expect((await writes(page)).length).toBe(before);
    await batch.getByRole("button", { name: "Confirm 1" }).click();
    await expect.poll(() => batch.locator(".db-ok").textContent()).toContain("state");
    await shots(page, "closeout-done");
    expect((await writes(page)).some((e) => e.itemId === 2211 && e.status === "confirmed")).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
