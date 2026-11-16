// NM-2: the before and after screenshots, one script for both so the pairs match. Only when NM2_SHOTS names a folder
// (screenshots/nm2/before or screenshots/nm2/after); nothing runs otherwise. Dark, at 1440x900 and on the phone: the command
// menu with "conversation" and with "request" typed, Admin › Clients' chats group, Settings › Client chats, the Admin
// section that held the conversation rules, the chat permission's note, a block card with a to-do's title hovered,
// and the phone's day bar. Demo data only. A shot that can't be reached is named in the log and skipped.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { PS_CLOCK } from "./ps1-states.ts";

const DIR = process.env.NM2_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const SIZES = [["1440", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const;

const go = async (page: Page, hash: string, wait = 900) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(wait);
};
async function shot(page: Page, name: string, size: string, run: () => Promise<void>) {
  try {
    await run();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${DIR}/${name}-${size}.png` });
  } catch (e) {
    missed.push(`${name} at ${size}: ${String((e as Error).message).split("\n")[0]}`);
  }
}
const scrollTo = (page: Page, sel: string) => page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "start" }), sel);
const closeAll = async (page: Page) => {
  for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");
};
async function menu(page: Page, typed: string) {
  await go(page, "#/day");
  await page.keyboard.press("Control+k");
  await page.locator("[role=dialog] input, .cmd input").first().waitFor({ timeout: 5000 });
  await page.keyboard.type(typed);
}

describe.skipIf(!CHROMIUM || !DIR)("NM-2 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    if (missed.length) console.log(`NM-2 shots not taken:\n${missed.join("\n")}`);
    for (const h of started) await h.stop();
  });

  it("commands, chats, rules, the permission note, a card's title and the day bar", async () => {
    const h = await startDemo("chromium", {}, PS_CLOCK);
    started.push(h);
    for (const [size, viewport] of SIZES) {
      const { page } = await freshPage(h, viewport);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-dark"));
      await shot(page, "menu-conversation", size, () => menu(page, "conversation"));
      await closeAll(page);
      await shot(page, "menu-request", size, () => menu(page, "request"));
      await closeAll(page);
      await shot(page, "admin-client-chats", size, async () => {
        await go(page, "#/settings/admin-clients", 1500);
        await page.locator(".dchat").first().waitFor({ timeout: 8000 });
        await scrollTo(page, ".dchat");
      });
      await shot(page, "settings-client-chats", size, async () => {
        await go(page, "#/settings/chats", 1500);
        await page.locator("[data-setting='chats-read']").first().waitFor({ timeout: 8000 });
      });
      await shot(page, "admin-chat-rules", size, async () => {
        await go(page, "#/settings/admin-conversations", 1500);
        await page.getByText(/Reading client chats/).first().waitFor({ timeout: 8000 });
        await page.evaluate(() => [...document.querySelectorAll("h3")].find((e) => /Reading client chats/.test(e.textContent ?? ""))?.scrollIntoView({ block: "center" }));
      });
      await shot(page, "permission-note", size, async () => {
        await go(page, "#/settings/connections/permissions", 1500);
        const row = page.getByText(/Chat\.Read\b/).first();
        await row.waitFor({ timeout: 8000 });
        await row.scrollIntoViewIfNeeded();
      });
      await closeAll(page);
      await shot(page, "card-title-hover", size, async () => {
        await go(page, "#/week", 1500);
        const t = page.locator("main .half.card li.pick-row .pr-title, main li.pick-row .pr-title").first();
        await t.waitFor({ timeout: 10_000 });
        await t.scrollIntoViewIfNeeded();
        await t.hover();
      });
      // The phone's day bar is Week's, one day at a time (WeekGrid's narrow layout).
      if (size === "phone")
        await shot(page, "day-bar", size, async () => {
          await go(page, "#/week", 1500);
          await page.locator("nav.daybar").first().waitFor({ timeout: 8000 });
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.mouse.move(1, 1);
        });
      await page.close();
    }
  }, T);
});
