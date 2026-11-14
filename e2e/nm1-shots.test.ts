// NM-1: the before and after screenshots, one script for both so the pairs match. Only when NM1_SHOTS names a folder
// (docs/ux/nm1/before or docs/ux/nm1/after); nothing runs otherwise. Dark, at 1440x900 and on the phone: Keyboard
// shortcuts, the Guide's Every key, each tab's tooltip, Settings' section list with Day and Week open, Settings ›
// Notifications, Admin's renamed rules, the phone's Backlog notice, the Focus screen, and Week on a catch-up day with
// no working hours. Demo data only. A shot that can't be reached is named in the log and skipped.
//
// A tab's tooltip is the browser's own (the button's title), which a screenshot can't catch: the shot draws each tab's
// title text in a caption under the bar, read from the page.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const DIR = process.env.NM1_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const SIZES = [["1440", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const;
/** A Friday morning: the demo person's catch-up day has no working hours. */
const FRIDAY = "2026-11-06T10:30:00-05:00";

const go = async (page: Page, hash: string, wait = 700) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(wait);
};
async function shot(page: Page, name: string, size: string, run: () => Promise<void>) {
  try {
    await run();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${DIR}/${name}-${size}.png` });
  } catch (e) {
    missed.push(`${name} at ${size}: ${String((e as Error).message).split("\n")[0]}`);
  }
}
const scrollTo = (page: Page, sel: string) => page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "start" }), sel);
/** The tabs' tooltips as a caption: each tab's title, as the browser would show it on hover. */
const tabTitles = (page: Page) =>
  page.evaluate(() => {
    const tabs = [...document.querySelectorAll<HTMLElement>(".view-tab, .phone-tabs button, nav button[aria-current], .tabbar button")].filter((b) => b.title);
    const box = document.createElement("div");
    box.id = "nm1-caption";
    box.style.cssText = "position:fixed;left:16px;right:16px;top:64px;z-index:99999;padding:12px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface, var(--bg));color:var(--text);font:var(--fs-3)/1.6 var(--font, sans-serif)";
    box.innerHTML = `<div style="font-weight:600">Each tab's tooltip (the button's title), as the browser shows it on hover</div>` + tabs.map((b) => `<div>"${b.title.replace(/</g, "&lt;")}"</div>`).join("");
    document.body.append(box);
    return tabs.length;
  });

describe.skipIf(!CHROMIUM || !DIR)("NM-1 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    if (missed.length) console.log(`NM-1 shots not taken:\n${missed.join("\n")}`);
    for (const h of started) await h.stop();
  });

  it("the words: keys, tooltips, Settings, Admin, the phone's notice, the Focus screen", async () => {
    const h = await startDemo();
    started.push(h);
    for (const [size, viewport] of SIZES) {
      const { page } = await freshPage(h, viewport);
      await page.emulateMedia({ colorScheme: "dark" });
      await shot(page, "keyboard-shortcuts", size, async () => {
        await go(page, "#/day");
        if (size === "phone") {
          await page.getByRole("button", { name: /^More/ }).first().click();
          await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).or(page.getByRole("button", { name: /Keyboard shortcuts/ })).first().click({ timeout: 4000 });
        } else {
          await page.keyboard.press("Control+k");
          await page.keyboard.type("Keyboard shortcuts");
          await page.keyboard.press("Enter");
        }
        await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor({ timeout: 5000 });
      });
      await shot(page, "keyboard-shortcuts-end", size, async () => {
        await page.evaluate(() => {
          const d = document.querySelector('[aria-label="Keyboard shortcuts"]');
          for (const el of [d, ...(d?.querySelectorAll("*") ?? [])]) if (el && el.scrollHeight > el.clientHeight + 40) (el as HTMLElement).scrollTop = 420;
        });
      });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await shot(page, "guide-every-key", size, async () => {
        await go(page, "#/guide/settings", 1200);
        await scrollTo(page, ".ga-keys");
      });
      await shot(page, "guide-every-key-end", size, async () => {
        await page.evaluate(() => {
          const rows = document.querySelectorAll(".ga-keys li, .ga-keys tr, .ga-keys > *");
          rows[Math.min(rows.length - 1, 12)]?.scrollIntoView({ block: "start" });
        });
      });
      await shot(page, "tab-tooltips", size, async () => {
        await go(page, "#/day");
        if (!(await tabTitles(page))) throw new Error("no tab has a title here");
      });
      await page.evaluate(() => document.getElementById("nm1-caption")?.remove());
      await shot(page, "settings-day-and-week", size, async () => {
        await go(page, "#/settings/planning", 1500);
      });
      await shot(page, "settings-day-and-week-nudges", size, async () => {
        await scrollTo(page, '[data-setting="readiness-nudges"]');
      });
      await shot(page, "settings-day-and-week-rituals", size, async () => {
        await scrollTo(page, '[data-setting="week-nudges"]');
      });
      await shot(page, "settings-notifications", size, async () => {
        await go(page, "#/settings/notifications", 1500);
        await scrollTo(page, '[data-setting="kinds"]');
      });
      await shot(page, "settings-notifications-kinds", size, async () => {
        await page.evaluate(() => [...document.querySelectorAll(".set-notify-group legend")].find((l) => /Other|Client chats/.test(l.textContent ?? ""))?.scrollIntoView({ block: "start" }));
      });
      await shot(page, "admin-organization", size, async () => {
        await go(page, "#/settings/admin-organization", 1800);
        await page.evaluate(() => [...document.querySelectorAll("label, .set-label, .adm-field, legend, span")].find((l) => /looks at the top N/.test(l.textContent ?? ""))?.scrollIntoView({ block: "center" }));
      });
      await shot(page, "admin-levels", size, async () => {
        await page.evaluate(() => [...document.querySelectorAll("th")].find((l) => /nudges/.test(l.textContent ?? ""))?.scrollIntoView({ block: "center" }));
      });
      await shot(page, "admin-client-counts", size, async () => {
        await go(page, "#/settings/admin-clients", 1800);
        // A client's rule for what Backlog's Needs attention counts: a group of switches named "<client>: what ... counts".
        const rule = page.locator('[role="group"][aria-label$=" counts"]').first();
        await rule.waitFor({ timeout: 8000 });
        await rule.evaluate((el) => el.scrollIntoView({ block: "center" }));
      });
      await shot(page, "backlog", size, async () => {
        await go(page, "#/ahead", 1800);
      });
      await shot(page, "focus-screen", size, async () => {
        await go(page, "#/focus", 1200);
      });
      await page.close();
    }
  }, T);

  it("Week and Day on a catch-up day with no working hours", async () => {
    const h = await startDemo("chromium", {}, FRIDAY);
    started.push(h);
    for (const [size, viewport] of SIZES) {
      const { page } = await freshPage(h, viewport);
      await page.emulateMedia({ colorScheme: "dark" });
      await shot(page, "week-catch-up-day", size, async () => {
        await go(page, "#/week", 1800);
        await page.evaluate(() => document.querySelector(".half.whole.catchup, .catchup")?.scrollIntoView({ block: "center", inline: "center" }));
      });
      await shot(page, "day-catch-up-day", size, async () => {
        await go(page, "#/day", 1500);
      });
      await page.close();
    }
  }, T);
});
