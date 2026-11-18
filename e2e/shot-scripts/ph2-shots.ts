// PH-2: the before and after screenshots, one script for both (before: FOCUSTIME_E2E_DIST names the base commit's
// build). Only when PH2_SHOTS names a folder; nothing runs otherwise. Demo data only (a fictional person), on a phone at
// 390 by 844 and 360 by 640 with the iPhone's 17 px root font: dark, plus Week and the Inbox in light, plus Week at the
// largest Text size. Clock: Tue Nov 3, 2026 10:30 AM ET, the morning block under way, Monday past.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, startDemo, type Harness } from "../harness.ts";
import { call, phonePage } from "../mb1-helpers.ts";

const DIR = process.env.PH2_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const MON = "2026-11-02";
const TUE = "2026-11-03";
const WED = "2026-11-04";

async function shot(page: Page, name: string, run: () => Promise<void>, light = false) {
  try {
    await run();
    if (light) await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-light"));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/${name}${light ? "-light" : ""}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  } finally {
    if (light) await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-dark"));
  }
}
async function go(page: Page, hash: string) {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function plan(page: Page) {
  const add = async (p: Record<string, unknown>, done = false) => {
    const r = (await call(page, "pick.add", p)) as unknown as { data?: { pick?: { id: number } } };
    if (done && r.data?.pick) await call(page, "pick.mark_done", { id: r.data.pick.id, done: true });
  };
  await add({ date: TUE, half: "AM", clientKey: "Cooptimize", intention: "Answer the sizing question", size: "S" });
  await add({ date: TUE, half: "AM", clientKey: "Cooptimize", intention: "Tidy the export notes", size: "M" });
  await add({ date: TUE, half: "PM", clientKey: "Northwind", intention: "Draft the load test plan", size: "L" });
  await add({ date: WED, half: "AM", clientKey: "Cooptimize", intention: "Check the overnight load" });
}

describe.skipIf(!CHROMIUM || !DIR)("PH-2 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-03T10:30:00-05:00");
  }, 120_000);
  afterAll(async () => {
    await h?.stop();
    if (missed.length) console.log(`PH-2 shots missed:\n${missed.join("\n")}`);
  });

  it("takes them", async () => {
    const page = await phonePage(h, 390);
    await plan(page);
    for (const [w, ht] of [[390, 844], [360, 640]] as const) {
      await page.setViewportSize({ width: w, height: ht });
      const s = `${w}x${ht}`;
      await shot(page, `${s}/01-week`, () => go(page, "#/week"));
      if (w === 390) {
        await shot(page, `${s}/01-week`, () => go(page, "#/week"), true);
        await shot(page, `${s}/01-week-larger`, async () => {
          await call(page, "ui.set_text_size", { size: "larger" });
          await go(page, "#/week");
        });
        await call(page, "ui.set_text_size", { size: "default" });
      }
      await shot(page, `${s}/03-another-day`, () => go(page, `#/day/${WED}`));
      await shot(page, `${s}/04-past-day`, () => go(page, `#/day/${MON}`));
      await shot(page, `${s}/05-today`, () => go(page, "#/day"));
      await shot(page, `${s}/05-today-scrolled`, async () => {
        await go(page, "#/day");
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.locator("main.day-view").evaluate((m) => (m.scrollTop = m.scrollHeight));
      });
      await shot(page, `${s}/06-todo-sheet`, async () => {
        await go(page, `#/day/${WED}`);
        await page.getByRole("button", { name: /Check the overnight load/ }).first().click();
        await page.getByRole("dialog").first().waitFor({ timeout: 10_000 });
      });
      await page.keyboard.press("Escape");
      await shot(page, `${s}/07-inbox`, () => go(page, "#/inbox"));
      if (w === 390) await shot(page, `${s}/07-inbox`, () => go(page, "#/inbox"), true);
      await shot(page, `${s}/08-inbox-suggestion`, async () => {
        await go(page, "#/inbox");
        const next = page.locator(".io-card.suggestion");
        if (await page.locator(".io").count()) {
          for (let i = 0; i < 8 && !(await next.count()); i++) await page.getByRole("button", { name: "Next", exact: true }).click();
        } else await go(page, "#/inbox/chats");
      });
      await shot(page, `${s}/09-inbox-more`, async () => {
        await go(page, "#/inbox");
        await page.getByRole("button", { name: /^More/ }).first().click();
      });
      await shot(page, `${s}/11-inbox-lists`, () => go(page, "#/inbox/promises"));
      if (w === 390) await shot(page, `${s}/11-inbox-lists`, () => go(page, "#/inbox/promises"), true);
    }
    // The full week: an evening deployment on Wednesday and a to-do on Saturday (Thursday is the demo's day off).
    await call(page, "deploy.add", { clientKey: "Northwind", date: WED, start: "19:00", end: "21:00", title: "Deployment - Northwind - Wed, Nov 4" });
    await call(page, "pick.add", { date: "2026-11-07", half: "AM", clientKey: "Cooptimize", intention: "Check the weekend backup" });
    for (const [w, ht] of [[390, 844], [360, 640]] as const) {
      await page.setViewportSize({ width: w, height: ht });
      await shot(page, `${w}x${ht}/02-week-full`, () => go(page, "#/week"));
      await shot(page, `${w}x${ht}/02-week-next`, () => go(page, "#/week/2026-11-09"));
    }
    // The end of the Inbox: everything that needs me dealt with (Dismiss and Done, the actions with Undo).
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, "390x844/10-inbox-end", async () => {
      await go(page, "#/inbox");
      for (let i = 0; i < 12 && (await page.locator(".io-card").count()); i++) {
        const b = page.locator(".io-acts").getByRole("button", { name: /^(Dismiss|Done|Not needed)$/ }).first();
        if (await b.count()) await b.click();
        else {
          await page.getByRole("button", { name: /^More/ }).first().click();
          await page.locator(".io-acts").getByRole("button", { name: /^(Dismiss|Done|Not needed)$/ }).first().click();
        }
        await page.waitForTimeout(700);
      }
    });
  }, T);
});
