// PK-4: my own Pocket recordings, found by themselves and counted as mine, in demo mode (a fictional person, invented
// recordings on a pretend Pocket). Opening Calls marks a call without a press. On a key where my recordings are under an
// address FocusTime doesn't know me by, next to someone else's and two with no recorder, nothing is kept and the line
// says so in counts; Set my Pocket address refuses an address that isn't on the list and accepts mine, and my
// recordings appear. Check Pocket again says when Pocket was checked. A list that fails is one quiet line, and the list
// and Teams' marks still show. At 390 x 844 the same, every control at least 44 px.
// Clock: Thu Nov 5, 2026 10:00 AM ET.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";
import { DEMO_POCKET_KEYS, DEMO_POCKET_SOLO } from "../../sources/demo/pocket.ts";

const T = 240_000;
const W = 30_000;
let h: Harness;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean }>;
const go = (page: Page, x: string) => page.evaluate((v) => (location.hash = v), x);
const item = (page: Page, name: string | RegExp) => page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: name }) }).first();
const line = (page: Page) => page.locator("[data-pocket-line]");

/** Calls, with my Pocket connected by a demo key first (each demo session is its own). */
async function openCalls(page: Page, key: string) {
  await go(page, "#/week");
  await page.locator(".topbar").first().waitFor({ timeout: W });
  expect((await call(page, "pocket.connect", { key })).ok).toBe(true);
  await go(page, "#/calls");
  await page.locator("[data-call-row]").first().waitFor({ timeout: W });
}

/** Set my Pocket address: a wrong one refused, mine accepted; my recordings appear. */
async function setAddress(page: Page) {
  await page.locator("[data-pocket-set-address]").click();
  const form = page.locator("[data-pocket-address]");
  await form.locator("input").fill("nobody@example.com");
  await form.getByRole("button", { name: "Use this address" }).click();
  await expect.poll(() => form.locator('[role="alert"]').textContent(), { timeout: W }).toBe("That address isn't the recorder on any recording Pocket just listed for your key. Type the address your Pocket account uses");
  await form.locator("input").fill(DEMO_POCKET_SOLO);
  await form.getByRole("button", { name: "Use this address" }).click();
  await expect.poll(() => line(page).textContent(), { timeout: W }).toMatch(/^Pocket address saved\. Your recordings under it are listed now\. 4 of your recordings in the last 14 days\./);
  await expect.poll(() => item(page, "Proposal review with Jordan").locator("[data-call-mark]").textContent(), { timeout: W }).toBe("Pocket recording");
  await expect(form.count()).resolves.toBe(0);
}

describe.skipIf(!CHROMIUM)("PK-4: my Pocket recordings found by themselves (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("opening Calls marks a call without a press; Check Pocket again says when", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openCalls(page, "pk_demo_mine");
    await expect.poll(() => item(page, "Proposal review with Jordan").locator("[data-call-mark]").textContent(), { timeout: W }).toBe("Pocket recording");
    await expect.poll(() => line(page).textContent(), { timeout: W }).toMatch(/Pocket checked at 10:00 AM\.$/);
    await page.locator("[data-pocket-get]").click();
    await expect.poll(() => line(page).textContent(), { timeout: W }).toMatch(/^4 of your recordings in the last 14 days\. .*Pocket checked at 10:00 AM\.$/);
    expect(errors).toEqual([]);
  }, T);

  it("left out as someone else's until I set my Pocket address; then mine appear", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openCalls(page, DEMO_POCKET_KEYS.shared);
    await expect.poll(() => line(page).textContent(), { timeout: W }).toBe("8 listed. 6 are under an address FocusTime doesn't know you by. 2 have no recorder. Pocket checked at 10:00 AM.");
    await expect(page.locator("[data-call-mark='pocket']").count()).resolves.toBe(0);
    await setAddress(page);
    // Settings shows my address and the counts, numbers only.
    await go(page, "#/settings/connections/pocket");
    await page.locator("[data-pocket-addresses]").waitFor({ timeout: W });
    await expect(page.locator("[data-pocket-addresses] li span").textContent()).resolves.toBe(DEMO_POCKET_SOLO);
    const last = (await page.locator("[data-pocket-last]").textContent()) ?? "";
    expect(last).toMatch(/Kept as yours4/);
    expect(last).not.toMatch(/@|Proposal|Sprint|carrier|Someone|digest/);
    expect(errors).toEqual([]);
  }, T);

  it("a list that fails is one quiet line; the list and Teams' marks still show", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    await openCalls(page, DEMO_POCKET_KEYS.flaky);
    await expect.poll(() => page.locator("[data-pocket-failed]").textContent(), { timeout: W }).toBe("Pocket couldn't be checked just now. Check Pocket again");
    await expect.poll(() => item(page, "Northwind data model review").locator("[data-call-mark]").textContent(), { timeout: W }).toBe("Transcript in Teams");
    await expect(page.locator("[data-call-row]").count()).resolves.toBeGreaterThan(0);
    await expect(page.locator('[role="alert"]').count()).resolves.toBe(0);
  }, T);

  it("on the phone (390 x 844) the same, and every control is at least 44 px", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    await openCalls(page, DEMO_POCKET_KEYS.shared);
    await expect.poll(() => line(page).textContent(), { timeout: W }).toMatch(/^8 listed\./);
    for (const sel of ["[data-pocket-get]", "[data-pocket-set-address]"]) expect((await page.locator(sel).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.locator("[data-pocket-set-address]").click();
    const form = page.locator("[data-pocket-address]");
    for (const el of [form.locator("input"), ...(await form.locator("button").all())]) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await form.getByRole("button", { name: "Cancel" }).click();
    await setAddress(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }, T);
});
