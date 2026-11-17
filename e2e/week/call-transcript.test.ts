// MC-1d: the call's Transcript view in demo mode. Every line with its speaker and time, the lines a proposal rests on
// marked, a filter, and Show in transcript from a proposal landing on its line; each an address. MC-1e: and from a
// marked line back to its proposal. Nothing of the
// transcript is kept in the browser's storage or the installed app's caches after the view closes. An attendee who isn't
// a reviewer can read it but gets no Propose again or Upload. Clock: Thu Nov 5, 2026 10:00 AM ET (the call was Monday).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

let h: Harness;
const T = 120_000;

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>;
const open = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
};
/** Everything the page keeps: local and session storage, IndexedDB's names, and every cached response's text. */
const kept = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
    if (indexedDB.databases) out.push(JSON.stringify(await indexedDB.databases()));
    if ("caches" in self) for (const k of await caches.keys()) for (const r of await (await caches.open(k)).matchAll()) out.push(await r.clone().text().catch(() => ""));
    return out.join("\n");
  });

describe.skipIf(!CHROMIUM)("a call's transcript (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("every line, the marked lines, the filter and the jump; nothing kept after closing", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/week"));
    const mine = (await call(page, "meeting.mine", {})).data;
    const id = mine.occurrences[0].id as number;
    await open(page, `#/meetings/${id}`);
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
    await page.locator(".mtg-switch").getByRole("button", { name: /Transcript/ }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/meetings/${id}/transcript`);
    const lines = page.locator(".mtg-lines li");
    // The transcript loads when the view opens.
    await lines.first().waitFor({ timeout: 30_000 });
    await expect.poll(() => lines.count()).toBe(12);
    await expect(lines.first().textContent()).resolves.toMatch(/^\d+:\d\d (AM|PM)\s*Alex Rivera\s*Morning everyone/);
    await expect.poll(() => page.locator(".mtg-lines li.marked").count()).toBeGreaterThan(0);
    // The filter: words or a name.
    const filter = page.getByRole("searchbox", { name: "Filter the transcript" });
    await filter.fill("statement");
    await expect.poll(() => lines.count()).toBe(4);
    await expect(page.locator(".mtg-tr-bar [role=status]").textContent()).resolves.toBe("4 of 12 lines");
    await filter.fill("Priya");
    await expect.poll(() => lines.count()).toBe(3);
    await filter.fill("nothing like this");
    await expect(page.locator(".mtg-tr-bar [role=status]").textContent()).resolves.toBe('No line has "nothing like this"');
    // MC-1e: from a line to its proposal: the row in view and focused.
    await filter.fill("reporting area");
    const toProposal = page.locator(".mtg-lines li.marked").first().getByRole("button", { name: /^Go to the proposal/ });
    await toProposal.click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(new RegExp(`^#/meetings/${id}/proposal/\\d+$`));
    await expect.poll(() => page.evaluate(() => document.activeElement?.querySelector<HTMLInputElement>("input:not([type=checkbox])")?.value)).toBe("Accountant reporting area");
    await page.locator(".mtg-switch").getByRole("button", { name: /Transcript/ }).click();
    await lines.first().waitFor({ timeout: 30_000 });
    // Show in transcript from a proposal: the Transcript view at its first line, focused.
    await page.locator(".mtg-switch").getByRole("button", { name: /Proposals/ }).click();
    const jump = page.locator(".mtg-prop").first().getByRole("button", { name: /^Show in transcript/ });
    await jump.click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(new RegExp(`^#/meetings/${id}/transcript/\\d+$`));
    const n = Number((await page.evaluate(() => location.hash)).split("/").pop());
    await page.locator(`#mtg-line-${n}`).waitFor({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(`mtg-line-${n}`);
    await expect(page.locator(`#mtg-line-${n}`).getAttribute("class")).resolves.toMatch(/marked/);
    // The address opens there directly too.
    await open(page, `#/meetings/${id}/transcript/${n}`);
    await page.locator(`#mtg-line-${n}`).waitFor({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(`mtg-line-${n}`);
    // Close it: nothing of the transcript is kept by the browser.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const all = await kept(page);
    for (const words of ["Morning everyone", "monthly statement", "three sample statements"]) expect(all).not.toContain(words);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("an attendee who isn't a reviewer reads it, with no Propose again or Upload", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/week"));
    const mine = (await call(page, "meeting.mine", {})).data;
    const s = mine.meetings[0];
    const priya = s.reviewers.find((r: { name: string }) => r.name === "Priya Shah").id as string;
    expect((await call(page, "meeting.update", { seriesId: s.id, reviewers: [priya] })).ok).toBe(true);
    const id = mine.occurrences[0].id as number;
    await open(page, `#/meetings/${id}/transcript`);
    await page.locator(".mtg-lines li").first().waitFor({ timeout: 30_000 });
    await expect.poll(() => page.locator(".mtg-lines li").count()).toBe(12);
    await page.locator(".mtg-switch").getByRole("button", { name: /Proposals/ }).click();
    await page.locator(".mtg-prop").first().waitFor();
    await expect(page.getByRole("button", { name: "Propose again" }).count()).resolves.toBe(0);
    await expect(page.getByText("Upload a transcript").count()).resolves.toBe(0);
    expect((await call(page, "meeting.rerun", { occurrenceId: id })).ok).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
