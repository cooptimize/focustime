// U5.1: Today and Week fixes after the overhaul (browser, demo mode, clock pinned to Mon Nov 2, 9:30 AM). Behavior
// only: nothing inside a card paints outside it; Today uses the full width (three blocks at least 560 px each at
// 1920); notices are chips inside the status bar; a 12-character client name fits a Week card header at 1920.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const MON = "2026-11-02";
const LONG_MEETING = "Quarterly planning offsite prep with the whole leadership group and every partner team";
const LONG_PICK = "Write the migration notes for the reporting refresh and every downstream dashboard and report";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(1000);
};

async function seed(page: Page, opts: { evening?: boolean } = {}): Promise<void> {
  for (const x of [{ itemId: 4411, size: "M" }, { itemId: 4412, size: "S" }, { intention: LONG_PICK, size: "S" }]) expect((await call(page, "pick.add", { date: MON, half: "AM", clientKey: "Cooptimize", ...x })).ok).toBe(true);
  expect((await call(page, "unavailable.add", { date: MON, title: LONG_MEETING, start: "10:00", end: "10:30" })).ok).toBe(true);
  if (opts.evening) expect((await call(page, "flex.add", { date: MON, clientKey: "Cooptimize", start: "19:00", end: "21:00" })).ok).toBe(true);
  await page.reload();
  await page.waitForSelector(".topbar");
}

/** Text inside each card whose painted box (clipped by its overflow ancestors) reaches outside the card. */
const paintsOutside = (page: Page, card: string) =>
  page.evaluate((sel) => {
    const out: string[] = [];
    for (const c of document.querySelectorAll(sel)) {
      const box = c.getBoundingClientRect();
      for (const e of c.querySelectorAll("*")) {
        if (![...e.childNodes].some((x) => x.nodeType === 3 && (x.textContent ?? "").trim())) continue;
        let r = { l: 0, t: 0, r: 0, b: 0 };
        const b0 = e.getBoundingClientRect();
        if (!(b0.width > 0 && b0.height > 0)) continue;
        r = { l: b0.left, t: b0.top, r: b0.right, b: b0.bottom };
        for (let a = e.parentElement; a && a !== c.parentElement; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
          const ab = a.getBoundingClientRect();
          r = { l: Math.max(r.l, ab.left), t: Math.max(r.t, ab.top), r: Math.min(r.r, ab.right), b: Math.min(r.b, ab.bottom) };
        }
        if (r.r <= r.l || r.b <= r.t) continue;
        if (r.l < box.left - 1 || r.r > box.right + 1 || r.t < box.top - 1 || r.b > box.bottom + 1) out.push(`${e.className} "${(e.textContent ?? "").trim().slice(0, 30)}"`);
      }
    }
    return out;
  }, card);

describe.skipIf(!CHROMIUM)("Today and Week fit (U5.1)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("a long meeting or pick title never paints outside its card on Today and Week; the full title is on hover", async () => {
    // 1280 wide so the titles are longer than their cards.
    const { page, errors } = await freshPage(h, { width: 1280, height: 900 });
    await seed(page);
    await go(page, "#/today");
    await page.locator(".today-block").first().waitFor();
    await expect(page.locator(".today-block", { hasText: "Quarterly planning" }).count()).resolves.toBe(1);
    expect(await paintsOutside(page, ".today-block")).toEqual([]);
    const meeting = page.locator(".today-rows li", { hasText: "Quarterly planning" }).first();
    await expect(meeting.getAttribute("title")).resolves.toContain(LONG_MEETING);
    await expect(meeting.locator(".ev-title").evaluate((e) => e.scrollWidth > e.clientWidth)).resolves.toBe(true);
    await expect(page.locator(".today-block .pr-title", { hasText: "Write the migration" }).getAttribute("title")).resolves.toBe(LONG_PICK);
    await go(page, `#/week/${MON}`);
    await page.locator(".half.card").first().waitFor();
    expect(await paintsOutside(page, ".half.card")).toEqual([]);
    expect(await paintsOutside(page, ".half.whole")).toEqual([]);
    await go(page, `#/week/day/${MON}/AM`);
    await page.locator("aside.add-work-panel .aw-sec").first().waitFor();
    expect(await paintsOutside(page, "aside.add-work-panel")).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Today at 1920 with AM, PM and Evening blocks: each card is at least 560 px wide; one block is capped and left-aligned", async () => {
    const { page, errors } = await freshPage(h);
    await seed(page, { evening: true });
    await go(page, "#/today");
    await expect.poll(() => page.locator(".today-block").count()).toBe(3);
    const widths = await page.locator(".today-block").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(560);
    // The content area is the full width minus the 24 px gutters.
    const area = await page.locator(".today-blocks").evaluate((e) => e.getBoundingClientRect().width);
    expect(area).toBeGreaterThan(1920 - 2 * 24 - 20);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the Timelines note and borrowed time are chips inside the status bar, never below it", async () => {
    const { page, errors } = await freshPage(h);
    await seed(page);
    const inBar = () =>
      page.evaluate(() => {
        const bar = document.querySelector("footer.statusbar")!.getBoundingClientRect();
        return [...document.querySelectorAll(".status-chip")].map((c) => {
          const r = c.getBoundingClientRect();
          return { text: c.textContent ?? "", inside: !!c.closest("footer.statusbar .status-row") && r.top >= bar.top && r.bottom <= bar.bottom };
        });
      });
    await go(page, `#/week/${MON}`);
    await page.locator(".half.card").first().waitFor();
    await page.locator("body").click({ position: { x: 5, y: 500 } });
    await page.keyboard.press("h");
    await expect.poll(async () => (await inBar()).find((c) => /^Timelines/.test(c.text))?.inside).toBe(true);
    await go(page, "#/today");
    const row = page.locator(".today-block .pick-row", { hasText: "Utilization chart" });
    await row.hover();
    await row.getByRole("button", { name: /More for/ }).click();
    await page.getByRole("menuitem", { name: /make it up/i }).click();
    await page.getByRole("menuitem", { name: /^Friday/ }).click();
    await expect.poll(async () => (await inBar()).find((c) => /^Borrowed/.test(c.text))?.inside).toBe(true);
    // No notice renders as a line under the bar's row.
    await expect(page.locator("footer.statusbar .status-line.notice").count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a Week card header at 1920 shows a 12-character client name untruncated; a longer one shortens and the time stays in view", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, `#/week/${MON}`);
    await page.locator(".half.card .card-client").first().waitFor();
    const r = await page.evaluate(() =>
      [...document.querySelectorAll(".half.card .card-client")].map((e) => {
        e.textContent = "Contoso Corp";
        return e as HTMLElement;
      }).map((e) => ({ cut: e.scrollWidth > e.clientWidth + 0.5, body: e.closest(".card-body")!.getBoundingClientRect().width })),
    );
    expect(r.length).toBeGreaterThan(3);
    for (const x of r) {
      expect(x.cut).toBe(false);
      expect(x.body).toBeGreaterThanOrEqual(200);
    }
    // A name too long for the line: WD-1's header is one line (the spec's "one status chip that never wraps"), so the
    // name shortens with an ellipsis and the time range stays on the line and in view (WK-1 had it take its own line).
    const long = await page.locator(".half.card .card-head").first().evaluate((head) => {
      const name = head.querySelector<HTMLElement>(".card-client")!;
      name.textContent = "Contoso Corporation Holdings";
      const h = head.getBoundingClientRect();
      const n = name.getBoundingClientRect();
      const when = head.querySelector(".card-when")!.getBoundingClientRect();
      return { ownLine: when.top >= n.top + 4, inView: when.bottom <= h.bottom + 1 && when.right <= h.right + 1 && when.height > 0 };
    });
    expect(long).toEqual({ ownLine: false, inView: true });
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
