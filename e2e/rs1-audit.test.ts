// RS-1: the PS-1 and PS-2 measurements (e2e/ps1-audit.ts) and the U5 text style count, taken on every screen the
// restyle touches and written as JSON, so the numbers before and after can be put side by side. Only when RS1_AUDIT
// names a file (docs/ux/rs1/audit-before.json or audit-after.json); nothing runs otherwise. Demo data only.
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";
import { clippedLines, smallTargets } from "./ps1-audit.ts";
import { buildState, PS_CLOCK } from "./ps1-states.ts";

const OUT = process.env.RS1_AUDIT ?? null;
const T = 900_000;
const SCOPE = "main, aside.block-panel, .page-head, .week-head, .day-head, .topbar, .settings";
type Row = { screen: string; smallTargets: number; clippedLines: number; textStyles: number; offScale: number; filledInHeader: number; small: string[]; clipped: string[]; styles: string[] };
const rows: Row[] = [];

/** Distinct text styles in view (size, weight, uppercase), the ones off the type scale, and the header's filled buttons. */
const styles = (page: Page) =>
  page.evaluate(() => {
    const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-base"));
    const sizes = new Set([base - 2, base - 1, base, base + 2].map((n) => `${n}px`));
    const seen = new Set<string>();
    let off = 0;
    for (const e of document.querySelectorAll("body *")) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      if (e.closest(".brand-stage, svg, kbd, .focus-count, .avatar-initials, [class^='brand-'], [class*=' brand-'], .lumen")) continue;
      if (![...e.childNodes].some((x) => x.nodeType === 3 && (x.textContent ?? "").trim())) continue;
      const cs = getComputedStyle(e);
      seen.add(`${cs.fontSize}/${cs.fontWeight}${cs.textTransform === "uppercase" ? "/caps" : ""}`);
      if (!sizes.has(cs.fontSize) || !["400", "500", "600"].includes(cs.fontWeight)) off++;
    }
    const probe = document.createElement("button");
    probe.style.background = "var(--action)";
    document.body.append(probe);
    const fill = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const filled = [...document.querySelectorAll<HTMLElement>(".page-head button, .week-head button, .day-head button, .ah-head button, .st-head button")].filter((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).backgroundColor === fill).length;
    return { textStyles: seen.size, offScale: off, filled, list: [...seen].sort() };
  });

async function measure(page: Page, screen: string, min: number) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const small = await smallTargets(page, SCOPE, min);
  const clipped = await clippedLines(page, "main, aside.block-panel, .settings");
  const s = await styles(page);
  rows.push({ screen, smallTargets: small.length, clippedLines: clipped.length, textStyles: s.textStyles, offScale: s.offScale, filledInHeader: s.filled, small: small.map((x) => `${x.what} ${x.w}x${x.h}`), clipped, styles: s.list });
}
const go = async (page: Page, hash: string, wait = 1200) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(wait);
};
const closePanel = async (page: Page) => {
  for (let i = 0; i < 2 && (await page.locator("aside.block-panel").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
};

describe.skipIf(!CHROMIUM || !OUT)("RS-1 audit numbers", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, PS_CLOCK);
  }, T);
  afterAll(async () => {
    if (OUT) writeFileSync(OUT, `${JSON.stringify(rows, null, 1)}\n`);
    await h?.stop();
  });

  for (const larger of [false, true])
    it(`a computer at 1440x900${larger ? ", Larger text" : ""}`, async () => {
      const { page } = await freshPage(h, { width: 1440, height: 900 }, { dayPanel: "default" });
      await buildState(page, "ordinary");
      if (larger) {
        await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
        await page.waitForTimeout(500);
      }
      const tag = larger ? " (Larger)" : "";
      await go(page, "#/week");
      await closePanel(page);
      await measure(page, `Week${tag}`, 28);
      await go(page, "#/day");
      await page.locator("aside.block-panel").waitFor({ timeout: 10_000 }).catch(() => {});
      await measure(page, `Day, cards and panel${tag}`, 28);
      await page.locator(".day-switch button", { hasText: "Timeline" }).first().click().catch(() => {});
      await page.waitForTimeout(700);
      await measure(page, `Day, timeline${tag}`, 28);
      await page.locator(".day-switch button", { hasText: "Cards" }).first().click().catch(() => {});
      await closePanel(page);
      await go(page, "#/backlog", 2500);
      await measure(page, `Backlog, grid${tag}`, 28);
      await go(page, "#/backlog/gantt", 2500);
      await measure(page, `Backlog, Gantt${tag}`, 28);
      await go(page, "#/status", 2500);
      await measure(page, `Status${tag}`, 28);
      for (const list of ["chats", "promises", "captures"]) {
        await go(page, `#/inbox/${list}`, 1500);
        await page.locator("li.ib4-row .ib4-row-head").first().click().catch(() => {});
        await page.waitForTimeout(700);
        await measure(page, `Inbox, ${list}${tag}`, 28);
      }
      await go(page, "#/settings/display", 1500);
      await measure(page, `Settings, Display${tag}`, 28);
      await go(page, "#/settings/admin-clients", 1500);
      await measure(page, `Admin, Clients${tag}`, 28);
      await page.close();
    }, T);

  it("the phone at 390x844", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    await buildState(page, "ordinary");
    await go(page, "#/day");
    await measure(page, "Phone, Day", 44);
    await go(page, "#/week");
    await measure(page, "Phone, Week", 44);
    await go(page, "#/inbox/promises", 1500);
    await measure(page, "Phone, Inbox", 44);
    await page.close();
  }, T);
});
