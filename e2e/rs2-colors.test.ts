// RS-2 part B in a real browser, on the demo (Tuesday 9:30 AM: Monday is past, the rest of the week ahead): every client
// block card on Week and on Day is filled in its client's color at the timeline bands' strength (--client-tint over the
// surface) with the full 5 px client edge; a past one is lighter (60% of the tint) but never the plain surface, with the
// same full edge; in each theme. Measured from the computed styles against a probe drawn with the same tokens.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { PS_CLOCK } from "./ps1-states.ts";

const T = 240_000;
const THEMES = ["cooptimize-dark", "cooptimize-light", "neutral"] as const;

type Card = { label: string; past: boolean; fill: string; want: string; surface: string; edgeW: string; edge: string; client: string };
/** Each client card in `scope`: its fill and edge, and what they should be, from a probe inside it using the card's own --c. */
const cards = (page: Page, scope: string) =>
  page.evaluate((scope) => {
    const out: Card[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .half.card.focus:not(.pto-half)`)) {
      if (!el.getBoundingClientRect().width) continue;
      const past = el.classList.contains("past");
      const probe = document.createElement("div");
      el.append(probe);
      const read = (bg: string) => ((probe.style.background = bg), getComputedStyle(probe).backgroundColor);
      const want = read(`color-mix(in oklab, var(--c) ${past ? "calc(var(--client-tint) * 0.6)" : "var(--client-tint)"}, var(--surface))`);
      const surface = read("var(--surface)");
      const client = read("var(--c)");
      probe.remove();
      const cs = getComputedStyle(el);
      out.push({ label: el.getAttribute("aria-label") ?? el.querySelector(".card-client")?.textContent ?? "", past, fill: cs.backgroundColor, want, surface, edgeW: cs.borderLeftWidth, edge: cs.borderLeftColor, client });
    }
    return out;
  }, scope);

async function theme(page: Page, t: string) {
  await page.evaluate((x) => document.documentElement.setAttribute("data-theme", x), t);
  await page.emulateMedia({ colorScheme: t === "cooptimize-light" ? "light" : "dark" });
  await page.waitForTimeout(300);
}

describe.skipIf(!CHROMIUM)("RS-2: Week's blocks keep their client color (browser, demo)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, PS_CLOCK);
  }, T);
  afterAll(async () => h?.stop());

  for (const t of THEMES)
    it(`${t}: on Week and Day, client cards are filled in their color, past ones lighter but not plain, all with the full edge`, async () => {
      const { page, errors } = await freshPage(h, { width: 1920, height: 1080 });
      await theme(page, t);
      for (const [where, scope] of [["#/week", "main.grid"], ["#/day/2026-11-02", ".day-view"], ["#/day/2026-11-03", ".day-view"]] as const) {
        await page.evaluate((x) => (location.hash = x), where);
        await page.locator(`${scope} .half.card.focus`).first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(500);
        const all = await cards(page, scope);
        expect(all.length, `${where}: client cards`).toBeGreaterThan(0);
        if (where === "#/week") {
          expect(all.some((c) => c.past), "Week has past cards (Monday)").toBe(true);
          expect(all.some((c) => !c.past), "Week has cards ahead").toBe(true);
        }
        for (const c of all) {
          expect(c.fill, `${where} ${c.label}: fill`).toBe(c.want);
          expect(c.fill, `${where} ${c.label}: not the plain surface`).not.toBe(c.surface);
          expect(c.edgeW, `${where} ${c.label}: edge width`).toBe("5px");
          expect(c.edge, `${where} ${c.label}: edge color`).toBe(c.client);
        }
      }
      expect(errors).toEqual([]);
      await page.close();
    }, T);
});
