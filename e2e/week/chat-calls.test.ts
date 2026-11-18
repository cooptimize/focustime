// MC-2c: calls started in a client's chat, in Calls with their Teams transcript, in demo mode. Northwind's delivery chat
// has four earlier calls: one reviews cleanly, one comes without speaker names, one Microsoft refuses, and one with no
// transcript event that never shows. Each listed one is a row under its week: "Call in <chat>", its times, Transcript
// in Teams, From a chat, About Northwind; never in Needs you. Review reads it on the press; the refusal says so in plain
// words with the way on. At 390 by 844 every control on a row is at least 44 px. Clock: Thursday Nov 5, 2026 10:00 AM ET.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";

let h: Harness;
const T = 180_000;
const CHAT = "Call in Northwind Delivery Team (Cooptimize)";

describe.skipIf(!CHROMIUM)("MC-2c: calls started in a client's chat (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("three chat calls listed, the one with no transcript isn't; Review reads one; no speaker names; a refusal with the way on", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/calls"));
    await page.getByRole("heading", { name: "Calls", exact: true }).waitFor({ timeout: 30_000 });
    const chatRows = page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: CHAT }) });
    await expect.poll(() => chatRows.count(), { timeout: 30_000 }).toBe(3);
    // Never in Needs you.
    await expect(page.locator("[data-section='needs']").filter({ hasText: CHAT }).count()).resolves.toBe(0);
    const first = chatRows.first();
    await expect.poll(() => first.textContent(), { timeout: 30_000 }).toMatch(/to[\s\S]*From a chat[\s\S]*Transcript in Teams[\s\S]*About Northwind/);
    // No people count on a chat call.
    await expect(first.textContent()).resolves.not.toMatch(/\d+ (people|person)\b/);

    // Review the newest (yesterday's): its setup, then the transcript from Teams and the review.
    await first.locator("[data-call-row]").click();
    const setup = page.getByRole("region", { name: new RegExp(`^Review ${CHAT.replace(/[()]/g, "\\$&")}`) });
    await setup.waitFor({ timeout: 30_000 });
    await expect(setup.textContent()).resolves.toMatch(/From a chat/);
    await expect(setup.getByLabel("Which client is this call about?").locator("option:checked").textContent()).resolves.toMatch(/Northwind.*\(suggested\)/);
    await setup.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
    await expect.poll(() => page.getByText(/^Got the transcript from Teams/).count(), { timeout: 30_000 }).toBe(1);
    await expect(page.locator("[data-no-speakers]").count()).resolves.toBe(0);

    // The one without speaker names: read, and the review says so. The reviewed call is MC-2's kept call now: two left to review.
    await page.evaluate(() => (location.hash = "#/calls"));
    const toReview = page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: CHAT }) }).filter({ has: page.locator("[data-call-act='review']") });
    await expect.poll(() => toReview.count(), { timeout: 30_000 }).toBe(2);
    const unnamed = toReview.first();
    await unnamed.locator("[data-call-row]").click();
    const s2 = page.getByRole("region", { name: /^Review Call in Northwind/ });
    await s2.getByRole("button", { name: "Continue" }).click();
    await page.locator("[data-no-speakers]").waitFor({ timeout: 30_000 });
    await expect(page.locator("[data-no-speakers]").textContent()).resolves.toBe("Teams gave this transcript without speaker names.");

    // The one Microsoft refuses: its words, with the way on.
    await page.evaluate(() => (location.hash = "#/calls"));
    await expect.poll(() => toReview.count(), { timeout: 30_000 }).toBe(1);
    const refused = toReview.first();
    // Its end wasn't seen: its start alone.
    await expect(refused.locator(".calls-time").textContent()).resolves.not.toMatch(/ to /);
    await refused.locator("[data-call-row]").click();
    const s3 = page.getByRole("region", { name: /^Review Call in Northwind/ });
    await s3.getByRole("button", { name: "Continue" }).click();
    await expect.poll(() => page.getByText(/Teams lets the people who were on a call read it/).count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.getByText(/download the transcript from the call in the chat in Teams and upload it here/).count()).resolves.toBeGreaterThan(0);
    expect(errors).toEqual([]);
  }, T);

  it("Hide and Undo on a chat call; at 390 by 844 (the iPhone's 17 px root font) its row's controls are 44 px, nothing overflows", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => (location.hash = "#/calls"));
    await page.getByRole("heading", { name: "Calls", exact: true }).waitFor({ timeout: 30_000 });
    const chatRows = page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: CHAT }) }).filter({ has: page.locator("[data-call-act='hide']") });
    await expect.poll(() => chatRows.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    const row = chatRows.first();
    for (const c of await row.locator("button, select").all()) {
      if (!(await c.isVisible())) continue;
      const b = (await c.boundingBox())!;
      expect(b.height, await c.evaluate((e) => e.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
    }
    // No sideways scroll on the page, and no row's words run out of their box.
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
    const over = await row.evaluate((li) => [...li.querySelectorAll<HTMLElement>(".calls-time, .calls-name, .calls-source, .calls-about")].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className));
    expect(over).toEqual([]);
    // The page itself scrolls (no content stuck behind the bottom bar).
    await expect(page.evaluate(() => document.scrollingElement!.scrollHeight >= window.innerHeight)).resolves.toBe(true);
    const before = await chatRows.count();
    await row.locator("[data-call-act='hide']").click();
    await expect.poll(() => chatRows.count(), { timeout: 30_000 }).toBe(before - 1);
    await page.getByRole("button", { name: "Undo" }).first().click();
    await expect.poll(() => chatRows.count(), { timeout: 30_000 }).toBe(before);
  }, T);
});
