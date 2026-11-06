// PK-1 (browser, demo mode, Monday Nov 2, 9:30 AM): checking off a to-do on Today offers "Set #<id> to <done state>?"
// with the write's preview; Confirm writes it (the demo's simulated DevOps), Not now writes nothing; unchecking offers
// the write's Undo; Close out of the last workday asks once for its done to-dos (the todo-done seed's Harbor #2211).
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

  it("Today: a tick offers the done state with its preview; Confirm writes once; unchecking offers Undo; Not now writes nothing", async () => {
    const { page, errors } = await freshPage(h);
    await planToday(page);
    const before = (await writes(page)).length;
    await page.getByRole("checkbox", { name: "Done: Timesheet summary query" }).check();
    const card = page.getByRole("region", { name: "DevOps update" });
    await card.waitFor();
    await expect(card.locator(".do-title").textContent()).resolves.toBe("Set #4411 to Closed?");
    // The demo process has Resolved too: both are offered, Closed (Completed) first.
    await expect(card.getByRole("radio").allTextContents()).resolves.toEqual(["Closed", "Resolved"]);
    await expect(card.locator(".do-preview").textContent()).resolves.toContain("Active → Closed");
    await shots(page, "offer");
    expect((await writes(page)).length).toBe(before);
    await card.getByRole("button", { name: "Confirm" }).click();
    const done = page.getByRole("status", { name: "DevOps update" });
    await expect.poll(() => done.textContent()).toContain("#4411 is Closed in DevOps");
    expect((await writes(page)).length).toBe(before + 1);
    // Unchecking offers that write's own Undo (the write framework's preview), never silently.
    await page.getByRole("checkbox", { name: "Done: Timesheet summary query" }).uncheck();
    await expect.poll(() => card.locator(".do-title").textContent()).toBe("You set #4411 to Closed in DevOps. Undo that too?");
    await shots(page, "undo-offer");
    await card.getByRole("button", { name: "Undo in DevOps" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator(".wd-actions .commit").click();
    await expect.poll(async () => (await writes(page)).filter((e) => e.op === "undo_state").length).toBe(1);
    // Not now: nothing written.
    await page.getByRole("checkbox", { name: "Done: Utilization chart" }).check();
    await expect.poll(() => card.locator(".do-title").textContent()).toBe("Set #4412 to Closed?");
    const n = (await writes(page)).length;
    await card.getByRole("button", { name: "Not now" }).click();
    await expect(card.count()).resolves.toBe(0);
    expect((await writes(page)).length).toBe(n);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Never ask in Settings › Planning turns the offer off", async () => {
    const { page } = await freshPage(h);
    await planToday(page);
    expect((await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } })).ok).toBe(true);
    await page.reload();
    await page.getByRole("checkbox", { name: "Done: Utilization chart" }).check();
    await page.waitForTimeout(1500);
    await expect(page.getByRole("region", { name: "DevOps update" }).count()).resolves.toBe(0);
    await page.close();
  }, T);

  it("Close out asks once for the day's done to-dos: a checkbox per item, one Confirm, a result per item", async () => {
    const { page, errors } = await freshPage(h);
    // The last workday before Monday Nov 2 is Wednesday Oct 28 (Thursday is the demo's PTO day): the seed's done
    // to-do, Harbor #2211, still open in DevOps.
    await page.evaluate(() => (location.hash = "#/today/closeout/2026-10-28"));
    const batch = page.getByRole("group", { name: "Set items to done in DevOps" });
    await batch.waitFor({ timeout: 20_000 });
    await expect(batch.locator(".db-ask").textContent()).resolves.toMatch(/^1 to-do done on \w+day; set its item to Closed\?$/);
    await expect(batch.getByRole("checkbox").count()).resolves.toBe(1);
    await shots(page, "closeout-batch");
    await batch.getByRole("button", { name: "Confirm 1" }).click();
    await expect.poll(() => batch.locator(".db-ok").textContent()).toContain("Closed in DevOps");
    await shots(page, "closeout-done");
    expect((await writes(page)).some((e) => e.itemId === 2211 && e.status === "confirmed")).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
