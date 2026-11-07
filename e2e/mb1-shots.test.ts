// MB-1: screenshots of the phone (390 and 360 px, 17 px root font as on an iPhone) and the desktop (1920), in demo
// mode, only when FOCUSTIME_SHOTS names a folder. MB1_TAG (before or after) prefixes each file, so the same run on
// main and on the branch gives the before and after sets in docs/ux/mb1/. Today's Now card in each state needs its own
// clock: before the day (8:00), in a block (9:30), in a meeting (11:15), between blocks (12:15, with Monday's hours
// split 9:00 to 12:00 and 1:00 to 5:00) and after the day (5:30 PM).
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

const T = 600_000;
const TAG = process.env.MB1_TAG ?? "after";
const MON = "2026-11-02";
const PHONES = [390, 360] as const;

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean }>;

/** A phone page signed in to the demo, with the iPhone's larger root font. */
export async function phonePage(h: Harness, width: number): Promise<Page> {
  const page = await h.browser.newPage({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, bypassCSP: true });
  await page.addInitScript(() => {
    localStorage.setItem("focustime.hint.flow", "dismissed");
    localStorage.setItem("focustime.hint.picktime", "1");
    document.addEventListener("DOMContentLoaded", () => {
      const st = document.createElement("style");
      st.textContent = "html{font-size:17px}";
      document.head.append(st);
    });
  });
  await page.goto(h.url);
  await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
  return page;
}

/** Today planned and confirmed: two to-dos in the morning (one with a long title), one in the afternoon. */
export async function planMonday(page: Page): Promise<void> {
  for (const p of [
    { half: "AM", clientKey: "Cooptimize", intention: "Write the migration notes for the customer export and share them with the delivery team", size: "M" },
    { half: "AM", clientKey: "Cooptimize", intention: "Review open pull requests", size: "S" },
    { half: "PM", clientKey: "Northwind", intention: "Prepare the data model review", size: "L" },
  ])
    await call(page, "pick.add", { date: MON, ...p });
  await call(page, "planday.commit", { date: MON });
}

async function at(page: Page, hash: string): Promise<void> {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
  await page.waitForSelector(".topbar");
  await page.waitForTimeout(900);
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${TAG}-${name}.png`, fullPage: true });

const STATES = [
  ["before-day", "08:00"],
  ["block", "09:30"],
  ["meeting", "11:15"],
  ["between", "12:15"],
  ["after-day", "17:30"],
] as const;

describe.skipIf(!CHROMIUM || !SHOTS)("MB-1 screenshots", () => {
  const hs: Harness[] = [];
  afterAll(async () => Promise.all(hs.map((h) => h.stop())));

  for (const [state, clock] of STATES)
    it(`Today on the phone: ${state}`, async () => {
      const h = await startDemo("chromium", {}, `${MON}T${clock}:00-05:00`);
      hs.push(h);
      for (const w of PHONES) {
        const page = await phonePage(h, w);
        if (state === "between") await call(page, "hours.set_day", { date: MON, segments: ["09:00-12:00", "13:00-17:00"] });
        await planMonday(page);
        await at(page, "#/today");
        await shot(page, `phone${w}-today-${state}`);
        await page.close();
      }
    }, T);

  it("the other phone screens and the desktop", async () => {
    const h = await startDemo("chromium");
    hs.push(h);
    for (const w of PHONES) {
      const page = await phonePage(h, w);
      await planMonday(page);
      await at(page, "#/week");
      await shot(page, `phone${w}-week-board`);
      const cardFold = page.locator(".card-agenda-fold").first();
      if (await cardFold.count()) {
        await cardFold.click();
        await page.waitForTimeout(300);
        await shot(page, `phone${w}-week-board-agenda-open`);
      }
      await at(page, `#/week/day/${MON}`);
      await shot(page, `phone${w}-week-day`);
      const fold = page.locator(".pd2-fold").first();
      if (await fold.count()) {
        await fold.click().catch(() => undefined);
        await page.waitForTimeout(300);
        await shot(page, `phone${w}-week-day-agenda-toggled`);
      }
      await at(page, "#/week/commit");
      await shot(page, `phone${w}-week-plan`);
      await at(page, "#/inbox/needs-you");
      await shot(page, `phone${w}-inbox`);
      await at(page, "#/ahead");
      await shot(page, `phone${w}-ahead`);
      await at(page, "#/today");
      const row = page.locator(".ph-todo-main").first();
      if (await row.count()) {
        await row.click({ position: { x: 60, y: 10 } }).catch(() => undefined);
        await page.waitForTimeout(400);
        await shot(page, `phone${w}-today-row-tapped`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
      }
      const dot = page.locator(".status-dot-btn");
      if (await dot.count()) {
        await dot.click();
        await page.waitForTimeout(300);
        await shot(page, `phone${w}-status-sheet`);
      }
      await page.close();
    }
    const { page } = await freshPage(h);
    await planMonday(page);
    for (const [name, hash] of [["today", "#/today"], ["week", "#/week"], ["inbox", "#/inbox/needs-you"], ["ahead", "#/ahead"]] as const) {
      await at(page, hash);
      await page.screenshot({ path: `${SHOTS}/${TAG}-desktop-${name}.png` });
    }
    await page.close();
  }, T);
});
