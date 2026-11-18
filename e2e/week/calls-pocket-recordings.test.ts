// MC-2b: my own Pocket recordings in Calls, in demo mode (a fictional person, invented recordings on a pretend Pocket).
// Without Pocket connected, one quiet line with its link and no button. Connected: PK-4: Pocket is asked as Calls
// opens; the last-checked line and the count left out; a call a recording goes with says Pocket recording
// found and its setup has Use my Pocket recording preselected with who will see it; a recording much longer than its
// call asks which part; a recording with no call is its own row whose setup makes a call only I see; a client call with
// no transcript offers it on its page; the call's page says whose recording it was. Nothing of a recording is kept in
// the browser's storage. At 390 x 844 the controls are at least 44 px. Clock: Thu Nov 5, 2026 10:00 AM ET.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";

const T = 240_000;
let h: Harness;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = (page: Page, x: string) => page.evaluate((v) => (location.hash = v), x);
/** This week's row by its name (the demo's calendar repeats some calls a week earlier). */
const row = (page: Page, name: string | RegExp) => page.locator("[data-calls-list] [data-call-row]").filter({ has: page.locator(".calls-name", { hasText: name }) }).first();
/** MC-4: the row's whole line (its mark is beside the button that opens it). */
const item = (page: Page, name: string | RegExp) => page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: name }) }).first();
const pocketMark = (page: Page, name: string | RegExp) => item(page, name).locator("[data-call-mark='pocket']");
const storage = (page: Page) => page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));

/** Calls, with my Pocket connected first unless asked not to (a demo key; each demo session is its own). */
async function openCalls(page: Page, connect = true) {
  await go(page, "#/week");
  await page.locator(".topbar").first().waitFor({ timeout: 30_000 });
  if (connect) expect((await call(page, "pocket.connect", { key: "pk_demo_fine" })).ok).toBe(true);
  await go(page, "#/calls");
  await page.locator("[data-call-row]").first().waitFor({ timeout: 30_000 });
}

describe.skipIf(!CHROMIUM)("my Pocket recordings in Calls (MC-2b, browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => {
    await h?.stop();
  });

  it("not connected: one line with its link, no button; connected: listed as Calls opens, matched, the rest counted", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openCalls(page, false);
    const bar = page.locator("[data-calls-pocket]");
    await expect.poll(() => bar.textContent(), { timeout: 30_000 }).toBe("Record calls on a Pocket? Connect it in Settings.");
    await expect(bar.locator("a").getAttribute("href")).resolves.toBe("#/settings/connections/pocket");
    await expect(page.locator("[data-pocket-get]").count()).resolves.toBe(0);
    expect((await call(page, "pocket.connect", { key: "pk_demo_fine" })).ok).toBe(true);
    await page.reload();
    await page.locator("[data-pocket-get]").waitFor({ timeout: 30_000 });
    // PK-4: listed as Calls opens, without a press; the button asks again.
    await expect.poll(() => bar.locator('[role="status"]').textContent(), { timeout: 30_000 }).toMatch(/^4 of your recordings in the last 14 days\. 1 is under an address FocusTime doesn't know you by\. Pocket checked at \d+:\d\d [AP]M\.$/);
    await expect(page.locator("[data-pocket-get]").textContent()).resolves.toBe("Check Pocket again");
    // MC-4: the Pocket mark, drawn like Teams' (these calls had no transcript in Teams, so they leave the fold).
    await expect(pocketMark(page, "Proposal review with Jordan").textContent()).resolves.toBe("Pocket recording");
    await expect(pocketMark(page, "Harbor sprint planning").textContent()).resolves.toBe("Pocket recording");
    await expect(pocketMark(page, "Call with the carrier").textContent()).resolves.toBe("Pocket recording");
    await expect(page.getByText("Someone else's recording").count()).resolves.toBe(0);
    expect(await storage(page)).not.toMatch(/rec-demo|carrier|Sprint planning|Proposal review"/);
    expect(errors).toEqual([]);
  }, T);

  it("on the phone (390 x 844) the press and the setup's choices are at least 44 px", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    await openCalls(page);
    const get = page.locator("[data-pocket-get]");
    await get.waitFor({ timeout: 30_000 });
    expect((await get.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await get.click();
    const harbor = row(page, "Harbor sprint planning");
    await pocketMark(page, "Harbor sprint planning").waitFor({ timeout: 30_000 });
    await harbor.click();
    await page.locator("[data-pocket-part]").waitFor({ timeout: 30_000 });
    for (const l of await page.locator(".mtg-setup-source label").all()) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }, T);
  it("a calendar call it goes with: Use my Pocket recording preselected, who will see it, then the call says it was mine", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openCalls(page);
    await page.locator("[data-pocket-get]").click();
    await pocketMark(page, "Proposal review with Jordan").waitFor({ timeout: 30_000 });
    await row(page, "Proposal review with Jordan").click();
    const setup = page.locator(".mtg-setup");
    await expect(setup.locator('[data-source="pocket"]').isChecked()).resolves.toBe(true);
    await expect(setup.locator("[data-pocket-who]").textContent()).resolves.toMatch(/^The Cooptimizers on this call's invite will be able to read it\. Once it's in, the AI proposes updates from it if AI is on for this client\. Nothing goes to DevOps until you confirm\.$/);
    await expect(setup.locator("[data-pocket-part]").count()).resolves.toBe(0);
    await setup.locator("select").selectOption({ index: 1 });
    await setup.getByRole("button", { name: "Continue" }).click();
    await page.locator(".mtg-pocket-note").waitFor({ timeout: 60_000 });
    await expect(page.locator(".mtg-pocket-note").textContent()).resolves.toBe("From your Pocket recording. Speakers aren't named, and Pocket can mix them up.");
    expect(errors).toEqual([]);
  }, T);

  it("much longer than its call: the part during it by default, all of it as the other choice", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openCalls(page);
    await page.locator("[data-pocket-get]").click();
    await pocketMark(page, "Harbor sprint planning").waitFor({ timeout: 30_000 });
    await row(page, "Harbor sprint planning").click();
    const part = page.locator("[data-pocket-part]");
    await expect(part.locator("legend").textContent()).resolves.toBe("This recording is 2 h 15 min; the call was 1 h. Which part comes in?");
    await expect(part.getByLabel("Only the part during the call (5 minutes either side)").isChecked()).resolves.toBe(true);
    await expect(part.getByLabel("Bring in all of it").isChecked()).resolves.toBe(false);
    await page.locator(".mtg-setup select").selectOption({ index: 1 });
    await page.locator(".mtg-setup").getByRole("button", { name: "Continue" }).click();
    await page.locator(".mtg-pocket-note").waitFor({ timeout: 60_000 });
    const id = Number((await page.evaluate(() => location.hash)).split("/")[2]);
    const t = await call(page, "meeting.transcript", { occurrenceId: id });
    const text = JSON.stringify(t.data);
    expect(text).toMatch(/Let's plan the sprint/);
    expect(text).not.toMatch(/coffee|Lunch plans|Dana|Guest/);
    expect(errors).toEqual([]);
  }, T);

  it("a recording with no call: its own setup, a call only I see; a client call with no transcript offers it on its page", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openCalls(page);
    await page.locator("[data-pocket-get]").click();
    await row(page, "Call with the carrier").waitFor({ timeout: 30_000 });
    await row(page, "Call with the carrier").click();
    const add = page.locator("[data-pocket-add]");
    await expect(add.getByLabel("Name").inputValue()).resolves.toBe("Call with the carrier");
    await expect(add.locator("[data-pocket-who]").textContent()).resolves.toMatch(/^Only you will see it\. /);
    await add.getByLabel("Name").fill("Carrier labels call");
    await add.locator("select").selectOption({ index: 1 });
    await add.getByRole("button", { name: "Continue" }).click();
    await page.locator(".mtg-pocket-note").waitFor({ timeout: 60_000 });
    await expect(page.locator(".mtg-pocket-note").textContent()).resolves.toMatch(/^From your Pocket recording\./);
    await expect(page.locator(".calls-beside").textContent()).resolves.toMatch(/Carrier labels call/);
    // Last week's Northwind call ended with no transcript: its page offers my recording of it.
    await go(page, "#/calls");
    await page.locator("[data-pocket-get]").click();
    const nw = page.locator("[data-calls-list] [data-call-row]").filter({ hasText: "Pocket recording found" }).filter({ hasText: "Northwind" });
    await nw.first().waitFor({ timeout: 30_000 });
    await nw.first().click();
    const box = page.locator("[data-pocket-bring]");
    await box.waitFor({ timeout: 30_000 });
    await expect(box.locator("[data-pocket-who]").textContent()).resolves.toMatch(/^This call's reviewers and attendees will be able to read it\. /);
    // The upload card below doesn't also tell me to export from Pocket.
    await expect(page.getByText("Export the transcript from Pocket").count()).resolves.toBe(0);
    await box.getByRole("button", { name: "Bring it in" }).click();
    await page.locator(".mtg-pocket-note").waitFor({ timeout: 60_000 });
    await expect(box.count()).resolves.toBe(0);
    expect(await storage(page)).not.toMatch(/rec-demo|carrier/i);
    expect(errors).toEqual([]);
  }, T);

});
