// QT-2: no over-planning words anywhere, on the demo at Wednesday Nov 4, 2:30 PM with Wednesday afternoon planned well
// past its free time. The midday check-in says the afternoon's free time once, gives each unfinished to-do its Move to…,
// and nothing in it is amber or says fits, doesn't fit or over. Asked "anything I should know about today?", the
// assistant names the day's meetings and free time and nothing about planning too much. Day, Week, the check-in and
// Close out are searched for the words (test/over-words.ts says what's left out and why).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { planWordsIn } from "../test/over-words.ts";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 180_000;
const WED = "2026-11-04";
let h: Harness;

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const);
const go = async (page: Page, hash: string, wait: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.locator(wait).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
};

describe.skipIf(!CHROMIUM)("QT-2: no over-planning words (browser, demo)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-04T14:30:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  it("the check-in shows free time and Move to… on each to-do, nothing amber; the assistant names the meetings and no over-planning", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    // Wednesday afternoon: three 4h to-dos on a block with less free time than that.
    for (const [title, size] of [["Draft the cutover checklist", "L"], ["Answer the pricing questions", "L"], ["Walk through the import errors", "L"]] as const) {
      const r = (await call(page, "pick.add", { date: WED, half: "PM", clientKey: "Northwind", intention: title, size })) as { ok: boolean };
      expect(r.ok).toBe(true);
    }
    await page.reload();
    await page.waitForSelector(".topbar", { timeout: 60_000 });

    await go(page, "#/today/checkin", "main.mode-checkin .today-block");
    const main = page.locator("main.mode-checkin");
    // The afternoon's free time, once, as a fact.
    const head = await main.locator(".today-head h1").innerText();
    expect(head).toMatch(/Midday check-in .*(\d+h( \d+m)?|\d+m) free (this afternoon|the rest of today)|No free time (this afternoon|the rest of today)/);
    expect((await main.innerText()).match(/ free (this afternoon|the rest of today)/g) ?? []).toHaveLength(1);
    // Each unfinished to-do on the afternoon block has its one Move to… (none is owed today, so none says Tonight).
    const pm = main.locator(".today-block", { has: page.getByText("Draft the cutover checklist") });
    const rows = pm.locator(".pick-row:not(.done)");
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
    for (const row of await rows.all()) await expect(row.locator(".ci-move").innerText()).resolves.toMatch(/^Move to .+$/);
    // No fit words and nothing amber in the check-in's blocks.
    expect(await page.locator(".pick-row.nofit, .pr-fit, .tb-line.watch").count()).toBe(0);
    const amber = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--watch)";
      document.body.appendChild(probe);
      const watch = getComputedStyle(probe).color;
      probe.remove();
      return [...document.querySelectorAll("main.mode-checkin .today-block *")]
        .filter((e) => !e.closest(".due-badge"))
        .filter((e) => { const s = getComputedStyle(e); return s.color === watch || s.borderTopColor === watch || s.borderLeftColor === watch; })
        .map((e) => `${e.tagName}.${e.className}`);
    });
    expect(amber).toEqual([]);
    expect(planWordsIn(await main.innerText())).toEqual([]);

    // The assistant, asked about today: the meetings and the free time, never that the day is over-planned.
    const panel = page.getByTestId("assistant-panel");
    await page.keyboard.press("Control+j");
    await panel.waitFor();
    const box = panel.getByRole("textbox", { name: "Ask the assistant" });
    const n = await panel.locator(".as-turn.assistant").count();
    await box.fill("Anything I should know about today?");
    await box.press("Enter");
    await expect.poll(() => panel.locator(".as-turn.assistant").count(), { timeout: 30_000 }).toBeGreaterThan(n);
    await page.waitForTimeout(400);
    const answer = await panel.locator(".as-turn.assistant").last().innerText();
    expect(answer).toMatch(/\b(\d+h|\d+ min) of meetings\b|\bno meetings\b/);
    expect(answer).toMatch(/free for focus/);
    expect(planWordsIn(answer)).toEqual([]);
    await page.keyboard.press("Escape");

    // Day, Week and Close out say none of the words either.
    for (const [hash, wait] of [["#/day", "main.day-view"], ["#/week", "main.grid"], ["#/today/closeout", ".closeout, main.mode-closeout"]] as const) {
      await go(page, hash, wait);
      expect(planWordsIn(await page.locator("main").first().innerText()), hash).toEqual([]);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  // With FOCUSTIME_SHOTS: the check-in and the assistant's answer at 1920, light and dark, and at Larger text.
  it.skipIf(!SHOTS)("screenshots: the check-in and the assistant's answer about today", async () => {
    for (const scheme of ["light", "dark"] as const) {
      const { page } = await freshPage(h, { width: 1920, height: 1080 });
      for (const [title, size] of [["Draft the cutover checklist", "L"], ["Answer the pricing questions", "L"], ["Walk through the import errors", "L"]] as const) await call(page, "pick.add", { date: WED, half: "PM", clientKey: "Northwind", intention: title, size });
      await page.reload();
      await page.waitForSelector(".topbar", { timeout: 60_000 });
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme === "light" ? "cooptimize-light" : "cooptimize-dark");
      await go(page, "#/today/checkin", "main.mode-checkin .today-block");
      await shotBoth(page, `qt2-checkin-${scheme}`);
      const panel = page.getByTestId("assistant-panel");
      await page.keyboard.press("Control+j");
      await panel.waitFor();
      const n = await panel.locator(".as-turn.assistant").count();
      await panel.getByRole("textbox", { name: "Ask the assistant" }).fill("Anything I should know about today?");
      await panel.getByRole("textbox", { name: "Ask the assistant" }).press("Enter");
      await expect.poll(() => panel.locator(".as-turn.assistant").count(), { timeout: 30_000 }).toBeGreaterThan(n);
      await page.waitForTimeout(400);
      await shotBoth(page, `qt2-ask-today-${scheme}`);
      await page.close();
    }
  }, T);
});
