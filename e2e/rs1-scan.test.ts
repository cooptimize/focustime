// RS-1 (a working tool, not a check): every control in view on every screen, grouped by tag and class, with the
// shape the browser gives it, written to RS1_SCAN as JSON. Nothing runs unless RS1_SCAN names a file.
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";
import { buildState, PS_CLOCK } from "./ps1-states.ts";
import { SECTIONS } from "../ui/settings/registry.ts";
const SECTION_IDS = SECTIONS.map((s) => s.id);

const OUT = process.env.RS1_SCAN ?? null;
const T = 900_000;
type Found = { key: string; n: number; h: number; w: number; radius: string; border: string; bg: string; pad: string; fs: string; text: string; screens: string[] };
const all = new Map<string, Found>();

const scan = (page: Page) =>
  page.evaluate(() => {
    const out: { key: string; h: number; w: number; radius: string; border: string; bg: string; pad: string; fs: string; text: string }[] = [];
    const clear = (c: string) => c === "rgba(0, 0, 0, 0)" || c === "transparent";
    for (const el of document.querySelectorAll<HTMLElement>("button, [role=button], [role=tab], [role=radio], [role=switch], input, select, textarea, [role=dialog], [role=menu], .popup-menu, summary")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || !el.checkVisibility()) continue;
      const cs = getComputedStyle(el);
      const kind = el instanceof HTMLInputElement ? `input[${el.type}]` : el.tagName.toLowerCase() + (el.getAttribute("role") && el.tagName !== "BUTTON" ? `[${el.getAttribute("role")}]` : "");
      const cls = String(el.className).trim().split(/\s+/).filter(Boolean).sort().join(".");
      const parent = el.parentElement ? String(el.parentElement.className).trim().split(/\s+/)[0] ?? "" : "";
      out.push({
        key: `${kind}${cls ? "." + cls : ` (in .${parent})`}`,
        h: Math.round(r.height), w: Math.round(r.width), radius: cs.borderTopLeftRadius,
        border: parseFloat(cs.borderTopWidth) > 0 && !clear(cs.borderTopColor) ? `${cs.borderTopWidth} ${cs.borderTopStyle}` : "none",
        bg: clear(cs.backgroundColor) ? "clear" : cs.backgroundColor, pad: `${cs.paddingTop} ${cs.paddingRight}`, fs: `${cs.fontSize}/${cs.fontWeight}`,
        text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
      });
    }
    return out;
  });
async function look(page: Page, screen: string) {
  for (const f of await scan(page)) {
    const was = all.get(f.key);
    if (was) {
      was.n++;
      if (!was.screens.includes(screen)) was.screens.push(screen);
    } else all.set(f.key, { ...f, n: 1, screens: [screen] });
  }
}
const go = async (page: Page, hash: string, wait = 1200) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(wait);
};
const esc = async (page: Page, n = 1) => {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
};
const tryDo = async (f: () => Promise<void>) => f().catch(() => {});

describe.skipIf(!CHROMIUM || !OUT)("RS-1 scan", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, PS_CLOCK);
  }, T);
  afterAll(async () => {
    if (OUT) writeFileSync(OUT, `${JSON.stringify([...all.values()].sort((a, b) => a.key.localeCompare(b.key)), null, 1)}\n`);
    await h?.stop();
  });

  it("a computer", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 }, { dayPanel: "default" });
    await buildState(page, "ordinary");
    await go(page, "#/week");
    await look(page, "week");
    await tryDo(async () => {
      const card = page.locator("main .half.focus").first();
      await card.hover();
      await card.locator(".card-more button").first().click({ timeout: 3000 });
      await look(page, "block menu");
      await esc(page, 2);
    });
    await go(page, "#/day");
    await page.locator("aside.block-panel").waitFor({ timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => { for (const f of document.querySelectorAll<HTMLButtonElement>("aside.block-panel .pl-fold[aria-expanded=false]")) f.click(); });
    await page.waitForTimeout(600);
    await look(page, "day+panel");
    await tryDo(async () => {
      await page.locator(".day-switch button", { hasText: "Timeline" }).first().click();
      await page.waitForTimeout(700);
      await look(page, "timeline");
      await page.locator(".day-switch button", { hasText: "Cards" }).first().click();
    });
    await esc(page, 2);
    await go(page, "#/backlog", 2500);
    await look(page, "backlog");
    await tryDo(async () => {
      await page.getByRole("button", { name: "Filter" }).first().click({ timeout: 3000 });
      await page.waitForTimeout(400);
      await look(page, "backlog filter");
      await esc(page);
    });
    await tryDo(async () => {
      await page.locator(".ah-new").click({ timeout: 3000 });
      await page.locator("#nf-title").waitFor({ timeout: 8000 });
      await look(page, "new form");
      await esc(page, 3);
    });
    await go(page, "#/backlog/gantt", 2500);
    await look(page, "gantt");
    await go(page, "#/status", 2500);
    await look(page, "status");
    await tryDo(async () => {
      await page.getByRole("button", { name: "Edit", exact: true }).first().click({ timeout: 3000 });
      await page.waitForTimeout(800);
      await look(page, "status edit");
    });
    for (const list of ["chats", "promises", "captures"]) {
      await go(page, `#/inbox/${list}`, 1500);
      await tryDo(async () => page.locator("li.ib4-row .ib4-row-head").first().click({ timeout: 3000 }));
      await page.waitForTimeout(700);
      await look(page, `inbox ${list}`);
    }
    for (const s of SECTION_IDS.filter((x) => x !== "client")) {
      await go(page, `#/settings/${s}`, 900);
      await look(page, `settings ${s}`);
    }
    await esc(page);
    await go(page, "#/code/Northwind/a1b2c3d4-0001-4000-8000-00000000a001/%2Fsql%2Fdbo%2FViews%2FvSales.sql", 2500);
    await look(page, "code");
    await go(page, "#/item/Northwind/1111", 2000);
    await look(page, "story card");
    await tryDo(async () => {
      await page.getByRole("dialog", { name: /#1111/ }).getByRole("button", { name: "Edit", exact: true }).click({ timeout: 3000 });
      await page.waitForTimeout(800);
      await look(page, "story card edit");
    });
    await esc(page, 3);
    for (const [hash, name] of [["#/meetings", "meetings"], ["#/patterns", "patterns"], ["#/guide", "guide"], ["#/docs", "docs"], ["#/week/team", "team"]] as const) {
      await go(page, hash, 1500);
      await look(page, name);
      await esc(page);
    }
    await go(page, "#/day");
    await tryDo(async () => {
      await page.keyboard.press("n");
      await page.locator(".cap-dialog").waitFor({ timeout: 5000 });
      await look(page, "capture");
      await esc(page, 2);
    });
    await tryDo(async () => {
      await page.keyboard.press("Control+k");
      await page.locator(".command-menu").waitFor({ timeout: 5000 });
      await look(page, "command menu");
      await esc(page);
    });
    await tryDo(async () => {
      await page.locator(".top-more").click({ timeout: 3000 });
      await look(page, "more menu");
      await esc(page, 2);
    });
    await tryDo(async () => {
      await page.locator(".person-chip").click({ timeout: 3000 });
      await look(page, "person menu");
      await esc(page, 2);
    });
    await tryDo(async () => {
      await page.locator(".top-btn.timer-btn").click({ timeout: 3000 });
      await page.getByRole("menuitem").first().click({ timeout: 3000 });
      await go(page, "#/focus", 1200);
      await look(page, "focus");
      await esc(page);
    });
    await go(page, "#/day/checkin", 1200);
    await look(page, "checkin");
    await go(page, "#/day/closeout", 1200);
    await look(page, "closeout");
    await page.close();
  }, T);

  it("the phone", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    await buildState(page, "ordinary");
    await go(page, "#/day");
    await look(page, "phone day");
    await tryDo(async () => {
      await page.locator("main .half.focus .card-head").first().click({ position: { x: 4, y: 4 }, timeout: 3000 });
      await page.waitForTimeout(800);
      await look(page, "phone block");
      await esc(page, 2);
    });
    await go(page, "#/week");
    await look(page, "phone week");
    await go(page, "#/inbox/promises", 1500);
    await tryDo(async () => page.locator("li.ib4-row .ib4-row-head").first().click({ timeout: 3000 }));
    await page.waitForTimeout(600);
    await look(page, "phone inbox");
    await page.close();
  }, T);
});
