// VM-4: an action that fails in a way the server didn't expect, in a real browser on the demo. Nov 17 in production a
// Close out answer showed only "bad request"; now Day, Week and the capture box show the plain words (it didn't work,
// try again, tell an admin if it keeps happening) with a short reference. The failure is made by a verification-only
// demo switch (demo.fail_next) for one call. Pictures at 1440x900 and 390x844 when VM4_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 180_000;
const TODAY = "2026-11-02";
const SHOTS = process.env.VM4_SHOTS ?? null;
const WORDS = /That didn't work: FocusTime ran into a problem it didn't expect\. Try again, and if it keeps happening, tell an admin \(reference [A-Z0-9]{6}\)\./;

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const [w, hgt, tag] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-${tag}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

describe.skipIf(!CHROMIUM)("VM-4: an unexpected failure says so in plain words (browser, demo mode)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Day: ticking a to-do that fails unexpectedly shows the words and a reference, never 'bad request'", async () => {
    const { page } = await freshPage(h);
    await page.setViewportSize({ width: 1440, height: 900 });
    await call(page, "planday.start", { date: TODAY });
    const added = await call(page, "pick.add", { date: TODAY, half: "AM", clientKey: "Cooptimize", itemId: 4411 });
    expect(added.ok).toBe(true);
    await page.reload();
    const box = page.getByRole("checkbox", { name: "Done: Timesheet summary query" });
    await box.waitFor({ timeout: 30_000 });
    expect((await call(page, "demo.fail_next", { action: "pick.mark_done" })).ok).toBe(true);
    await box.click();
    const view = page.locator("body");
    await expect.poll(() => view.innerText(), { timeout: 15_000 }).toMatch(WORDS);
    expect(await page.locator("body").innerText()).not.toMatch(/bad request/i);
    await shot(page, "day-unexpected");
    // Trying again works.
    await call(page, "pick.mark_done", { id: added.data.pick.id, done: false }).catch(() => null);
    await page.close();
  }, T);

  it("the capture box: a capture that fails unexpectedly shows the words in the box", async () => {
    const { page } = await freshPage(h);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".today-view").waitFor({ timeout: 30_000 });
    expect((await call(page, "demo.fail_next", { action: "capture.add" })).ok).toBe(true);
    await page.keyboard.press("n");
    const box = page.getByRole("dialog").locator("textarea").first();
    await box.waitFor();
    await box.fill("Ask about the export format");
    await box.press("Enter");
    await expect.poll(() => page.getByRole("dialog").innerText(), { timeout: 15_000 }).toMatch(WORDS);
    await shot(page, "capture-unexpected");
    await page.close();
  }, T);

  it("a malformed request keeps its own answer (a 400), not the server error", async () => {
    const { page } = await freshPage(h);
    const r = await page.evaluate(() => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: "{oops" }).then(async (x) => ({ status: x.status, body: await x.json() })));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("malformed");
    await page.close();
  }, T);
});

// The action that failed in production: a check-in answer. Midday on a confirmed Monday with ended timeboxes.
describe.skipIf(!CHROMIUM)("VM-4: the check-in answer that failed on Nov 17 (browser, demo mode)", () => {
  let h: Harness;
  const at = (t: string) => `${TODAY}T${t}:00-05:00`;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, at("16:40"));
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Check-in: Done on a timebox works (the fix), and an unexpected failure says the words", async () => {
    const { page, errors } = await freshPage(h);
    await page.setViewportSize({ width: 1440, height: 900 });
    expect((await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } })).ok).toBe(true);
    expect((await call(page, "planday.start", { date: TODAY })).ok).toBe(true);
    const add = async (input: object) => (await call(page, "pick.add", { date: TODAY, ...input })).data.pick.id as number;
    const a = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4411 });
    const b = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4412 });
    for (const [pickId, s, e] of [[a, "09:00", "10:00"], [b, "10:00", "11:00"]] as const) expect((await call(page, "timebox.add", { pickId, date: TODAY, start: at(s), end: at(e) })).ok).toBe(true);
    await page.evaluate(() => (location.hash = "#/today/checkin"));
    await page.reload();
    await page.locator(".tc-box").waitFor({ timeout: 30_000 });
    // Partly with time left: the answer that failed on SQL Server in production (the settled time's length).
    const first = page.locator(".tc-row").first();
    await first.getByRole("button", { name: "Partly" }).click();
    await first.getByRole("button", { name: "1h", exact: true }).click();
    await page.locator(".tc-said").first().waitFor({ timeout: 15_000 });
    expect(await page.locator(".tc-box").innerText()).not.toMatch(/bad request/i);
    // And a failure the server didn't expect says so in plain words.
    expect((await call(page, "demo.fail_next", { action: "checkin.answer" })).ok).toBe(true);
    const second = page.locator(".tc-row").filter({ hasNot: page.locator(".tc-said") }).first();
    await second.getByRole("button", { name: "Done" }).first().click();
    await expect.poll(() => page.locator("body").innerText(), { timeout: 15_000 }).toMatch(WORDS);
    await shot(page, "checkin-unexpected");
    expect(errors.filter((e) => !/500/.test(e))).toEqual([]);
    await page.close();
  }, T);
});
