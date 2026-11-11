// Safari (iPhone included) has no built-in Temporal: ui/boot.ts loads temporal-polyfill first there, and only there.
// On WebKit (Safari's engine, through Playwright) the sign-in page, demo Today and demo Plan the week load with no page
// errors. On Chromium (built-in Temporal) the polyfill is never fetched; with Temporal taken away it is, and the app
// still loads, so the polyfill's path is checked whatever this WebKit build ships.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit, type Page } from "playwright-core";
import { CHROMIUM, startDemo, WEBKIT, type Harness } from "./harness.ts";

const T = 120_000;
const POLYFILL = /temporal-polyfill|global\.esm/;

/** A new page that records page errors and whether the polyfill was fetched. */
async function watched(h: Harness, opts: { noTemporal?: boolean } = {}) {
  const page = await h.browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  const errors: string[] = [];
  const fetched: string[] = [];
  // Vite's dev client reports its websocket (HMR is off in the server): not an app error.
  page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
  page.on("request", (r) => POLYFILL.test(r.url()) && fetched.push(r.url()));
  if (opts.noTemporal) await page.addInitScript(() => delete (globalThis as { Temporal?: unknown }).Temporal);
  return { page, errors, fetched };
}

/** The sign-in page, then "Try the demo": Today, then Plan the week. Returns once each screen has shown. */
async function walk(page: Page, h: Harness) {
  await page.goto(h.url);
  const demo = page.getByRole("button", { name: /Try the demo/ });
  await demo.waitFor({ timeout: 60_000 });
  await demo.click();
  await page.waitForSelector(".demo-tag", { timeout: 30_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
  await page.waitForSelector(".today-view .today-block", { timeout: 30_000 });
  // WD-1: Week with Add work (the old Plan the week address lands there).
  await page.evaluate(() => (location.hash = "#/week/plan"));
  await page.locator("aside.add-work-panel .aw-sec").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
}

/** WebKit installed and able to start here (its build needs Ubuntu's libraries); required in CI. */
const webkitRuns = WEBKIT ? await webkit.launch().then((b) => b.close().then(() => true), () => false) : false;

describe.skipIf(!webkitRuns && process.env.FOCUSTIME_TEST_WEBKIT !== "required")("Safari: WebKit loads the app", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("webkit");
  }, T);
  afterAll(() => h?.stop());

  it("the sign-in page, demo Day and demo Week with Add work, with no page errors", async () => {
    const probe = await h.browser.newPage({ ignoreHTTPSErrors: true });
    await probe.goto("about:blank");
    const native = await probe.evaluate(() => typeof (globalThis as { Temporal?: unknown }).Temporal !== "undefined");
    await probe.close();

    const { page, errors, fetched } = await watched(h);
    await walk(page, h);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => Temporal.PlainDate.from("2026-11-02").dayOfWeek)).toBe(1);
    // The polyfill comes exactly when the engine lacks Temporal.
    expect(fetched.length > 0).toBe(!native);
    await page.close();
  }, T);

  it("with Temporal taken away too (the polyfill's path, whatever this build ships)", async () => {
    const { page, errors, fetched } = await watched(h, { noTemporal: true });
    await walk(page, h);
    expect(errors).toEqual([]);
    expect(fetched.length).toBeGreaterThan(0);
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("Temporal polyfill: only where Temporal is missing (Chromium)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(() => h?.stop());

  it("built-in Temporal: the polyfill is never fetched", async () => {
    const { page, errors, fetched } = await watched(h);
    await walk(page, h);
    expect(errors).toEqual([]);
    expect(fetched).toEqual([]);
    await page.close();
  }, T);

  it("no Temporal: the polyfill loads first and the app runs on it", async () => {
    const { page, errors, fetched } = await watched(h, { noTemporal: true });
    await walk(page, h);
    expect(errors).toEqual([]);
    expect(fetched.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => Temporal.Now.instant().epochMilliseconds > 0)).toBe(true);
    await page.close();
  }, T);
});
