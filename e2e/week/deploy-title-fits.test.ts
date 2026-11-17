// UC-2 (browser, demo mode): a deployment on Week's weekend column shows its client and its window on whole lines, its
// full title on hover and for a screen reader, at 1280, 1440 and 1920 and each text size. No word is broken in the
// middle and no line is half shown. On a weekday card a title that fits stays the title. Fictional data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 300_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Each deployment row on screen: what it shows, the words broken across lines, and whether anything is cut. */
const rows = (page: Page, scope: string) =>
  page.evaluate((sel) => {
    const out: { shown: string; form: string | null; label: string; hover: string | null; window: string; broken: string[]; clipped: boolean; cut: boolean; spare: number }[] = [];
    for (const li of document.querySelectorAll<HTMLElement>(`${sel} .pick-row`)) {
      const t = li.querySelector<HTMLElement>(".pr-title.dep");
      if (!t) continue;
      const dep = t.querySelector<HTMLElement>(".dep-title")!;
      const seen = [...t.querySelectorAll<HTMLElement>(".dep-client")].map((e) => e.textContent ?? "").join("") || [...dep.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("");
      // A word broken in the middle lays out as two boxes on two lines.
      const broken: string[] = [];
      const walker = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const host = n.parentElement!;
        if (host.closest(".sr-only, .dep-measure")) continue;
        const text = n.textContent ?? "";
        for (const m of text.matchAll(/\S+/g)) {
          const r = document.createRange();
          r.setStart(n, m.index!);
          r.setEnd(n, m.index! + m[0].length);
          const tops = new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
          if (tops.size > 1) broken.push(m[0]);
        }
      }
      const client = t.querySelector<HTMLElement>(".dep-client");
      out.push({
        shown: seen.trim(),
        form: dep.getAttribute("data-dep-title"),
        label: t.querySelector(".sr-only")?.textContent ?? [...dep.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(""),
        hover: dep.getAttribute("title"),
        window: li.querySelector(".deploy-window")?.textContent ?? "",
        broken,
        // A line half shown: the title's box holds more than it shows.
        clipped: t.scrollHeight > t.clientHeight + 1,
        // Cut with an ellipsis: the name's own text is wider than the box that shows it.
        // How much of the row's width the client's line leaves unused (the tick and icon don't sit beside it).
        spare: client ? li.getBoundingClientRect().width - client.getBoundingClientRect().width : 0,
        cut: !!client && (client.scrollWidth > client.clientWidth + 1 || (() => {
          const r = document.createRange();
          r.selectNodeContents(client);
          return r.getBoundingClientRect().width > client.clientWidth + 1;
        })()),
      });
    }
    return out;
  }, scope);

describe.skipIf(!CHROMIUM)("UC-2: a deployment reads well on Week's weekend column (browser, demo mode)", () => {
  let h: Harness;
  let page: Page;
  beforeAll(async () => {
    h = await startDemo();
    ({ page } = await freshPage(h, { width: 1280, height: 900 }));
    // Saturday: a made title (as the day menu now makes one) and a long typed one; Sunday: one with a long client name.
    expect((await call(page, "deploy.add", { clientKey: "Northwind", date: "2026-11-07", start: "09:00", end: "11:00", title: "Deployment - Northwind - Sat, Nov 7" })).ok).toBe(true);
    expect((await call(page, "deploy.add", { clientKey: "Harbor", date: "2026-11-07", start: "19:00", end: "21:00", title: "Release 4.2 to production with the new warehouse" })).ok).toBe(true);
    expect((await call(page, "deploy.add", { clientKey: "Atlas", date: "2026-11-08", start: "10:00", end: "12:30", title: "Deployment - Atlas - Sun, Nov 8" })).ok).toBe(true);
  }, T);
  afterAll(async () => h?.stop());

  it("shows the client and the window on whole lines, at 1280, 1440 and 1920 and each text size", async () => {
    for (const size of ["default", "large", "larger"] as const) {
      expect((await call(page, "ui.set_text_size", { size })).ok).toBe(true);
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.reload();
        await page.evaluate(() => (location.hash = "#/week"));
        const at = `${size} at ${width}`;
        await page.locator(".day-head").first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(600);
        // A window too narrow for every day folds some (WK-1); a folded weekend day is opened to be read, one at a time.
        const got: Awaited<ReturnType<typeof rows>> = [];
        if (await page.locator(".day.folded.weekend").count()) {
          for (const dow of ["Sat", "Sun"]) {
            const fold = page.locator(".day.folded.weekend", { hasText: dow });
            if (await fold.count()) await fold.locator("button").first().click();
            await page.locator(".day.weekend:not(.folded) .pr-title.dep").first().waitFor({ timeout: 10_000 });
            await page.waitForTimeout(300);
            got.push(...(await rows(page, ".day.weekend:not(.folded)")).filter((r) => !got.some((g) => g.label === r.label)));
          }
        } else {
          await page.locator(".day.weekend .pr-title.dep").first().waitFor({ timeout: 10_000 });
          got.push(...(await rows(page, ".day.weekend")));
        }
        expect(got, at).toHaveLength(3);
        for (const r of got) {
          expect(r.form, at).toBe("client");
          expect(["Northwind", "Harbor", "Atlas"], `${at}: ${r.shown}`).toContain(r.shown);
          expect(r.window, at).toMatch(/^\d{1,2}:\d{2}–\d{1,2}:\d{2}$/);
          expect(r.broken, `${at}: ${r.shown}`).toEqual([]);
          expect(r.clipped, `${at}: ${r.shown}`).toBe(false);
          expect(r.cut, `${at}: ${r.shown}`).toBe(false);
          // The client's line is the row's whole width, so a name is never squeezed beside the tick.
          expect(r.spare, `${at}: ${r.shown}`).toBeLessThan(24);
          // The full title for a screen reader and on hover.
          expect(r.hover, at).toContain(r.label);
        }
        expect(got.map((r) => r.label).sort(), at).toEqual(["Deployment - Atlas - Sun, Nov 8", "Deployment - Northwind - Sat, Nov 7", "Release 4.2 to production with the new warehouse"]);
      }
    }
    expect((await call(page, "ui.set_text_size", { size: "default" })).ok).toBe(true);
  }, T);

  it("on a weekday card a title that fits whole stays the title; one that doesn't shows the client, never a broken word", async () => {
    expect((await call(page, "deploy.add", { clientKey: "Northwind", date: "2026-11-03", start: "19:00", end: "20:00", title: "Hotfix" })).ok).toBe(true);
    expect((await call(page, "deploy.add", { clientKey: "Northwind", date: "2026-11-04", start: "19:00", end: "20:00", title: "Supercalifragilisticexpialidociousreleasecandidate" })).ok).toBe(true);
    for (const width of [1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await page.evaluate(() => (location.hash = "#/week"));
      await page.locator(".day:not(.weekend) .pr-title.dep").first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(300);
      const got = await rows(page, ".day:not(.weekend)");
      expect(got.map((r) => r.label).sort(), `${width}`).toEqual(["Hotfix", "Supercalifragilisticexpialidociousreleasecandidate"]);
      const short = got.find((r) => r.label === "Hotfix")!;
      expect(short.form, `${width}`).toBe("title");
      expect(short.shown).toBe("Hotfix");
      const long = got.find((r) => r.label.startsWith("Supercalifragilistic"))!;
      expect(long.form, `${width}`).toBe("client");
      expect(long.shown).toBe("Northwind");
      for (const r of got) expect(r.broken, `${width}: ${r.label}`).toEqual([]);
    }
  }, T);
});
