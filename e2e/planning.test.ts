// U4: Plan the week and Plan the day (browser, demo mode, clock pinned to Mon Nov 2, 9:30 AM). Behavior only: the fit
// said once per client, one amber line when musts are over, Needs stories, the Add list without listed items, pinning
// by drag onto a block chip; the type box (Enter a draft story under the chosen feature, Shift+Enter a note not in
// DevOps), the agenda folded on unselected blocks, a feature row can't be dropped on a block; the type scale and the
// word guards (U1 method).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { blockPicks, CHROMIUM, freshPage, openPlanDay, selectBlock, startDemo, weekClient, weekClientNames, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const D = "2026-11-02";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = async (page: Page, hash: string, sel: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForSelector(sel);
  await page.waitForTimeout(600);
};

/** The demo day as U1 to U4 have it: seven picks and a follow-up, committed, the first one done. */
async function seedDay(page: Page): Promise<void> {
  const fl = await call(page, "followups.list", {});
  const list = (fl.data?.open ?? fl.data?.followUps ?? fl.data ?? []) as { id: number; who: string }[];
  const jordan = list.find((f) => /Jordan/.test(f.who ?? ""));
  const adds: [string, string, Record<string, unknown>][] = [
    ["AM", "Cooptimize", { itemId: 4411, size: "M" }],
    ["AM", "Cooptimize", { itemId: 4412, size: "S" }],
    ["AM", "Cooptimize", { itemId: 4420, size: "S" }],
    ...(jordan ? ([["AM", "Cooptimize", { followUpId: jordan.id }]] as [string, string, Record<string, unknown>][]) : []),
    ["PM", "Northwind", { itemId: 1111, size: "M" }],
    ["PM", "Northwind", { itemId: 1112, size: "M" }],
    ["PM", "Northwind", { itemId: 1131, size: "S" }],
    ["PM", "Northwind", { intention: "Review the export spec with Dana", size: "S" }],
  ];
  const ids: number[] = [];
  for (const [half, clientKey, x] of adds) ids.push((await call(page, "pick.add", { date: D, half, clientKey, ...x })).data.pick.id);
  await call(page, "planday.commit", { date: D });
  await call(page, "pick.mark_done", { id: ids[0], done: true });
  await page.reload();
  await page.waitForSelector(".topbar");
}

/** U1's method: UI words on screen (the status bar counts, the top bar doesn't); titles and names don't, nor hidden hover controls. */
const uiWords = (page: Page) =>
  page.evaluate(() => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left < innerWidth && r.right > 0 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    };
    const TITLE = ".ev-title, .pr-title, .what, .ag-title, .feat-link, .pw-title, .pw-kids, .pd2-feat-name, .pd2-note, .day-allday-ev, .pw-cell-name, .pw-cell-right.pin, .pl-line-text, .pl-add-client, .pw-name, .pw-next-name, a, input, textarea";
    let n = 0;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let t: Node | null;
    while ((t = w.nextNode())) {
      const p = t.parentElement;
      if (!p || !vis(p) || p.closest(".topbar, script, style, svg, .brand-stage, [aria-hidden='true']") || (p.closest(TITLE) && !p.closest(".mode-switch"))) continue;
      n += (t.textContent ?? "").trim().split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
    }
    return n;
  });

/** Every visible text's font size and weight that is off the U3 scale (11, 12, 13, 15 px; 400, 500, 600). */
const offScale = (page: Page) =>
  page.evaluate(() => {
    const sizes = new Set(["11px", "12px", "13px", "15px"]);
    const weights = new Set(["400", "500", "600"]);
    const out: string[] = [];
    for (const e of document.querySelectorAll("body *")) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || !e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || e.closest(".brand-stage, svg, kbd")) continue;
      if (![...e.childNodes].some((x) => x.nodeType === 3 && (x.textContent ?? "").trim())) continue;
      const cs = getComputedStyle(e);
      if (!sizes.has(cs.fontSize) || !weights.has(cs.fontWeight)) out.push(`${cs.fontSize}/${cs.fontWeight} ${e.className} "${(e.textContent ?? "").trim().slice(0, 20)}"`);
    }
    return out;
  });

describe.skipIf(!CHROMIUM)("Plan the week and Plan the day (U4)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Plan the week: the fit once per client, one amber line when musts are over, Needs stories, Add without listed items", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, `#/week/plan/${D}`, ".pw-client");
    for (const name of await weekClientNames(page)) {
      const card = await weekClient(page, name);
      const fit = (await card.locator(".pw-fit2").textContent())!;
      // Said once: in the card's header, and not again in the card or in the week grid (U1 had it twice).
      expect(((await card.innerText()).split(fit).length - 1), fit).toBe(1);
      await expect(page.locator(".pw-grid").innerText()).resolves.not.toContain(fit);
      // The right pane follows the open client and never offers what is on its list (Everything else opened too).
      await expect(page.locator(".pw-addpane .pl-add-client").textContent()).resolves.toBe(name);
      const rest = page.locator(".pw-addpane .pw-rest .pl-fold");
      if ((await rest.count()) && (await rest.getAttribute("aria-expanded")) === "false") await rest.click();
      const listed = (await card.locator(".pw-row .pl-title").allTextContents()).map((t) => t.replace("✓", "").trim());
      const offered = (await page.locator(".pw-addpane .pw-addrow .pw-title a").allTextContents()).map((t) => t.replace(/^#\d+\s+/, "").trim());
      for (const t of offered) expect(listed).not.toContain(t);
    }
    // Northwind's musts need 3 blocks and it has 2: exactly one amber line. Cooptimize fits: none.
    const northwind = await weekClient(page, "Northwind");
    await expect(northwind.locator(".pw-over").count()).resolves.toBe(1);
    await expect(northwind.locator(".pw-over").textContent()).resolves.toMatch(/^3 blocks of musts, 2 blocks free\. Move one to nice to have/);
    // A feature with no stories says so on its row, with the two ways forward.
    const supplier = northwind.locator(".pw-row", { hasText: "Supplier onboarding" });
    await expect(supplier.locator(".pw-needs").textContent()).resolves.toMatch(/Needs stories.*Draft stories.*Coop brief/);
    await expect((await weekClient(page, "Cooptimize")).locator(".pw-over").count()).resolves.toBe(0);
    // Not counted half-days are on hover over the blocks number, not a line of their own.
    await expect(page.getByText("Not counted:").count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Plan the week: dragging a must onto one of its client's cells in the week grid pins it there, the same pin as before", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, `#/week/plan/${D}`, ".pw-client");
    const row = (await weekClient(page, "Northwind")).locator(".pw-tier .pw-row:not(.nested)").first();
    const title = (await row.locator(".pw-open, .pl-title a").first().textContent())!.trim();
    await row.locator(".pl-handle").dragTo(page.locator('.pw-cell[aria-label^="Wed, Nov 4 afternoon"]'));
    const pinned = async () => {
      const st = (await call(page, "weekplan.load", { weekStart: D })).data as { plan: { features: { title: string; slots: { date: string; half: string }[] }[] } };
      return st.plan.features.find((f) => f.title === title)?.slots ?? [];
    };
    await expect.poll(pinned, { timeout: 10_000 }).toContainEqual(expect.objectContaining({ date: "2026-11-04", half: "PM" }));
    await expect.poll(() => row.locator(".pw-pin").textContent()).toContain("Wed PM");
    // The pinned must's title shows on its cell.
    await expect.poll(() => page.locator('.pw-cell[aria-label^="Wed, Nov 4 afternoon"] .pw-cell-right').textContent()).toContain(title.slice(0, 12));
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Plan the day: Enter makes a draft story under the chosen feature and plans it; Shift+Enter a note not in DevOps", async () => {
    const { page, errors } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Cooptimize");
    const feature = page.locator(".pd2-right .pd2-feature", { hasText: "Internal reporting refresh" });
    await feature.locator(".pd2-feat-name").click();
    await expect(feature.locator(".pd2-feat-name").getAttribute("aria-pressed")).resolves.toBe("true");
    const box = page.locator(".pd2-right .pd2-type input");
    await box.fill("Export the chart as PNG");
    await box.press("Enter");
    await expect.poll(() => blockPicks(page, "Cooptimize")).toContain("Export the chart as PNG");
    const st = (await call(page, "planday.start", { date: D })).data as { picks: { kind: string; title: string; draftId: number | null }[]; drafts: { id: number; title: string; parentItemId: number | null }[] };
    const pick = st.picks.find((p) => p.title === "Export the chart as PNG")!;
    expect(pick.kind).toBe("draft");
    expect(st.drafts.find((d) => d.id === pick.draftId)?.parentItemId).toBe(4410);
    await box.fill("Ask Sam about the logo");
    await box.press("Shift+Enter");
    const note = page.locator(".pd2-block.selected .pd2-picks > li", { hasText: "Ask Sam about the logo" });
    await expect.poll(() => note.count()).toBe(1);
    await expect(note.locator(".pr-note").textContent()).resolves.toContain("not in DevOps");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Plan the day: the agenda is open on the selected block only; a feature row can't be dropped on a block", async () => {
    const { page, errors } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Cooptimize");
    await expect(page.locator(".pd2-block.selected .pd-agenda").count()).resolves.toBe(1);
    await expect(page.locator(".pd2-block:not(.selected) .pd-agenda").count()).resolves.toBe(0);
    await expect(page.locator(".pd2-block:not(.selected) .pd2-fold").first().textContent()).resolves.toMatch(/Agenda · .*free/);
    await selectBlock(page, "Northwind");
    await expect(page.locator(".pd2-block.selected .pd-agenda").count()).resolves.toBe(1);
    await expect(page.locator(".pd2-block", { hasText: "Cooptimize" }).locator(".pd-agenda").count()).resolves.toBe(0);
    // Features aren't picks: their rows aren't draggable, and a drag from one adds nothing.
    await selectBlock(page, "Cooptimize");
    const feature = page.locator(".pd2-right .pd2-feature").first();
    await expect(feature.getAttribute("draggable")).resolves.toBeNull();
    await expect(feature.locator(".pd2-feat-head").getAttribute("draggable")).resolves.toBeNull();
    const before = await blockPicks(page, "Northwind");
    await feature.locator(".pd2-feat-head").dragTo(page.locator(".pd2-block", { hasText: "Northwind" }));
    await page.waitForTimeout(800);
    await expect(blockPicks(page, "Northwind")).resolves.toEqual(before);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("word guards on the demo data: Plan the week (next week) under 120, Plan the day under 100", async () => {
    const { page, errors } = await freshPage(h);
    await seedDay(page);
    await go(page, "#/week/plan/2026-11-09", ".pw-client");
    expect(await uiWords(page)).toBeLessThan(120);
    await go(page, `#/today/plan/${D}/AM`, ".pd2-left");
    expect(await uiWords(page)).toBeLessThan(100);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("type scale: Plan the week and Plan the day use only 11, 12, 13 and 15 px at 400, 500 and 600, at 1920 and 3840", async () => {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 1600 }]) {
      const { page, errors } = await freshPage(h, viewport);
      await seedDay(page);
      for (const [hash, sel] of [["#/week/plan/2026-11-09", ".pw-client"], [`#/week/plan/${D}`, ".pw-client"], [`#/today/plan/${D}/AM`, ".pd2-left"]] as const) {
        await go(page, hash, sel);
        expect(await offScale(page), hash).toEqual([]);
      }
      // And with the detail panel open on a feature.
      await go(page, `#/week/plan/${D}`, ".pw-client");
      await page.locator(".pw-open").first().click();
      await page.locator(".detail-panel").waitFor();
      expect(await offScale(page)).toEqual([]);
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 2 * T);
});
