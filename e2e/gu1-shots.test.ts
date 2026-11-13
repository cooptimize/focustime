// GU-1: the before and after screenshots of the Guide, one script for both so the pairs match. Only when GU1_SHOTS
// names a folder (docs/ux/gu1/before or docs/ux/gu1/after); nothing runs otherwise. Every section, top and scrolled,
// dark and light, at 1440x900 and on the phone; each try-it; every tour's every step. Demo data only. A shot that
// can't be reached is named in the log and skipped.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SECTIONS } from "../ui/guide/sections.ts";
import { TOURS } from "../ui/guide/tours.ts";

const DIR = process.env.GU1_SHOTS ?? null;
const T = 900_000;
const THEMES = ["dark", "light"] as const;
const missed: string[] = [];

async function themed(page: Page, theme: (typeof THEMES)[number]) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
  await page.waitForTimeout(200);
}
const section = async (page: Page, id: string) => {
  await page.evaluate((x) => (location.hash = `#/guide/${x}`), id);
  await page.locator("main.guide .guide-body").first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
};
const scrollBody = (page: Page, to: "top" | "end") =>
  page.evaluate((to) => {
    for (const el of document.querySelectorAll<HTMLElement>("main.guide .ps-body, main.guide .ps-main, main.guide")) el.scrollTop = to === "top" ? 0 : el.scrollHeight;
    window.scrollTo(0, to === "top" ? 0 : document.body.scrollHeight);
  }, to);

describe.skipIf(!CHROMIUM || !DIR)("GU-1 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    if (missed.length) console.log(`GU-1 shots not taken:\n${missed.join("\n")}`);
    await h?.stop();
  });

  for (const [name, viewport] of [["1440", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const)
    it(`every section at ${name}, top and scrolled, dark and light`, async () => {
      const { page } = await freshPage(h, viewport);
      for (const s of SECTIONS) {
        try {
          await section(page, s.id);
          for (const theme of THEMES) {
            await themed(page, theme);
            await scrollBody(page, "top");
            await page.waitForTimeout(200);
            await page.screenshot({ path: `${DIR}/${s.id}-${name}-top-${theme}.png` });
            // Scrolled: the folded questions as they sit at the end of the section.
            await scrollBody(page, "end");
            await page.waitForTimeout(250);
            await page.screenshot({ path: `${DIR}/${s.id}-${name}-end-${theme}.png` });
          }
          await themed(page, "dark");
        } catch (e) {
          missed.push(`${s.id} at ${name}: ${String((e as Error).message).split("\n")[0]}`);
        }
      }
      await page.close();
    }, T);

  it("each try-it and the Guide's small examples, dark and light", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    for (const s of SECTIONS) {
      await section(page, s.id);
      const tries = page.locator("main.guide [data-try], main.guide .gu-urgent, main.guide .try-urgent");
      for (let i = 0; i < (await tries.count()); i++) {
        const el = tries.nth(i);
        const id = (await el.getAttribute("data-try")) ?? `urgent-${i}`;
        for (const theme of THEMES) {
          await themed(page, theme);
          await el.scrollIntoViewIfNeeded();
          await page.waitForTimeout(700);
          await el.screenshot({ path: `${DIR}/try-${s.id}-${id}-${theme}.png` }).catch((e) => missed.push(`try ${id}: ${String(e.message).split("\n")[0]}`));
        }
        await themed(page, "dark");
      }
    }
    await page.close();
  }, T);

  for (const t of TOURS)
    it(`the ${t.id} tour, every step, at 1440 and on the phone`, async () => {
      for (const [name, viewport] of [["1440", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
        const { page } = await freshPage(h, viewport);
        try {
          await page.evaluate((x) => (location.hash = `#/guide/tour/${x}`), t.id);
          const anyway = page.getByRole("button", { name: "Open anyway" });
          if (name === "phone" && (await anyway.waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false))) await anyway.click();
          const card = page.locator(".tour-card");
          await card.locator(".tour-count").waitFor({ timeout: 30_000 });
          for (let n = 1; n < 12; n++) {
            await page.waitForTimeout(700);
            await page.screenshot({ path: `${DIR}/tour-${t.id}-${name}-${String(n).padStart(2, "0")}.png` });
            if (!(await card.locator(".tour-count").count())) break;
            await page.keyboard.press("ArrowRight");
          }
        } catch (e) {
          missed.push(`tour ${t.id} at ${name}: ${String((e as Error).message).split("\n")[0]}`);
        }
        await page.close();
      }
    }, T);
});
