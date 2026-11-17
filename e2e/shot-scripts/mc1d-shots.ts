// MC-1d: the before and after screenshots, one script for both. Only when MC1D_SHOTS names a folder; nothing runs
// otherwise. Dark, demo data only, the computer at 1920 and the phone at 390. The failed state is drawn by answering the
// page's own meeting.mine and meeting.review with that state (the demo's AI never fails); nothing else is changed.
// Clock: Mon Nov 2, 2026 3:00 PM ET, just after the demo's 1:00 PM Northwind weekly status call.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.MC1D_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shot(page: Page, name: string, run: () => Promise<void>, el?: () => ReturnType<Page["locator"]>) {
  try {
    await run();
    await page.waitForTimeout(500);
    if (el) await el().screenshot({ path: `${DIR}/${name}.png` });
    else await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

/** Answer meeting.mine and meeting.review as if the call's AI step had failed (the shot of that state only). */
const failed = async (page: Page) =>
  page.route("**/api/action", async (route) => {
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action !== "meeting.mine" && body?.action !== "meeting.review") return route.continue();
    const res = await route.fetch();
    const j = await res.json();
    const fail = (o: Record<string, unknown>) => ({ ...o, state: "failed", open: 0, proposals: 0, retryAt: null, aiOutcome: "provider@2/3", aiMessage: "The AI step failed: the AI service couldn't answer. The call was sent in 3 parts and part 2 failed, so nothing was proposed: a reviewer never confirms from half a call.", aiNext: "FocusTime tried again 3 times and stopped. A reviewer can Propose again." });
    if (body.action === "meeting.mine") j.data.occurrences = j.data.occurrences.map(fail);
    else (j.data.occurrence = fail(j.data.occurrence)), (j.data.proposals = []);
    await route.fulfill({ response: res, json: j });
  });

describe.skipIf(!CHROMIUM || !DIR)("MC-1d screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    for (const h of started) await h.stop();
  });

  it("the call from its meeting, its page, the transcript and the failed state", async () => {
    const h = await startDemo("chromium", {}, "2026-11-02T15:00:00-05:00");
    started.push(h);
    const open = async (width: number, height: number, before?: (p: Page) => Promise<unknown>) => {
      const { page } = await freshPage(h, { width, height }, before ? { before } : {});
      await call(page, "ui.set_theme", { theme: "cooptimize-dark" });
      await page.reload();
      await page.waitForSelector(".demo-tag", { timeout: 30_000 }).catch(() => undefined);
      return page;
    };
    const go = async (page: Page, hash: string) => {
      await page.evaluate((x) => (location.hash = x), hash);
      await page.waitForTimeout(1500);
    };
    const page = await open(1920, 1080);
    const id = (await call(page, "meeting.mine", {})).data?.occurrences?.[0]?.id ?? 0;
    // Day, Timeline: the call's meeting with its mark, then its menu.
    await call(page, "ui.set_today_timeline", { show: true });
    await shot(page, "1-day-timeline", async () => { await page.reload(); await go(page, "#/today"); await page.locator(".today-tl .tt-block").nth(1).scrollIntoViewIfNeeded(); }, () => page.locator(".today-tl .tt-block").nth(1));
    await shot(page, "2-day-meeting-menu", async () => {
      const ev = page.locator(".today-tl .event", { hasText: "Northwind weekly status" }).first();
      await ev.locator(".ev-time").click();
      await page.locator(".popup-menu").waitFor({ timeout: 5000 });
    });
    await page.keyboard.press("Escape");
    // Day, Cards.
    await call(page, "ui.set_today_timeline", { show: false });
    await shot(page, "3-day-cards", async () => {
      await page.reload();
      await go(page, "#/today");
      const card = page.locator('.day-view [data-drop="2026-11-02:PM"]');
      await card.locator(".card-agenda-fold").click({ timeout: 5000 }).catch(() => undefined);
    }, () => page.locator('.day-view [data-drop="2026-11-02:PM"]'));
    // Week.
    await shot(page, "4-week", async () => { await go(page, "#/week"); });
    // The page, the Transcript, the jump.
    await shot(page, "5-call-page", async () => { await go(page, `#/meetings/${id}`); });
    await shot(page, "6-transcript", async () => { await go(page, `#/meetings/${id}/transcript`); });
    await shot(page, "7-transcript-filter", async () => { await page.getByRole("searchbox", { name: "Filter the transcript" }).fill("statement", { timeout: 5000 }); });
    await shot(page, "8-show-in-transcript", async () => {
      await go(page, `#/meetings/${id}`);
      await page.locator(".mtg-prop").nth(1).getByRole("button", { name: /^Show in transcript/ }).click({ timeout: 5000 });
      await page.waitForTimeout(800);
    });
    // More, with Client calls.
    await shot(page, "9-more-menu", async () => {
      await go(page, "#/today");
      await page.getByRole("button", { name: "More" }).first().click({ timeout: 5000 });
      await page.locator(".popup-menu").waitFor({ timeout: 5000 });
    });
    await page.close();
    // The failed state with Propose again, on the page and on its meeting.
    const f = await open(1920, 1080, failed);
    await shot(f, "10-failed-page", async () => { await go(f, `#/meetings/${id}`); });
    await call(f, "ui.set_today_timeline", { show: true });
    await shot(f, "11-failed-mark", async () => { await f.reload(); await go(f, "#/today"); }, () => f.locator(".today-tl .event", { hasText: "Northwind weekly status" }).first());
    await f.close();
    // The phone: the mark on Week's card list, the page and the transcript.
    const p = await open(390, 844);
    await shot(p, "12-phone-week-mark", async () => {
      await go(p, "#/week");
      const marked = p.locator(".half", { has: p.locator(".card-calls .call-mark") }).first();
      const drop = await marked.getAttribute("data-drop", { timeout: 5000 });
      const card = p.locator(`[data-drop="${drop}"]`);
      await card.locator(".card-agenda-fold").click({ timeout: 5000 }).catch(() => undefined);
      await card.scrollIntoViewIfNeeded();
    });
    await shot(p, "13-phone-page", async () => { await go(p, `#/meetings/${id}`); });
    await shot(p, "14-phone-transcript", async () => { await go(p, `#/meetings/${id}/transcript`); });
    await p.close();
  }, T);
});
