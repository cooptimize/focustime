// U2, WD-2: Day in three states (browser, demo mode, clock pinned to Mon Nov 2, 9:30 AM). Behavior only: one Start
// focus (on the next to-do's row, on Week's block card), the chips line only when needed, risk with its reason,
// Check-in's counts and one move per to-do, fit never in the risk color, Close out's panel (no to-do twice, dropped as
// a count), Lumen absent, and the word count guard. The 3840 day timeline went in WD-2 (docs/ux/wd2/inventory.md).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const D = "2026-11-02";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(900);
};

/** The demo day as the U1 and U2 screenshots have it: seven picks, a follow-up, the first one done. */
async function seed(page: Page): Promise<number[]> {
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
  await call(page, "pick.mark_done", { id: ids[0], done: true });
  await page.reload();
  await page.waitForSelector(".day-view .half.card");
  return ids;
}

/** U1's method: UI words on screen (the status bar counts, the top bar doesn't), titles and names excluded; hidden hover controls aren't on screen. */
const uiWords = (page: Page) =>
  page.evaluate(() => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left < innerWidth && r.right > 0 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    };
    const TITLE = ".ev-title, .att-names, .att-who, .pr-title, .cf-title, .card-client, .what, .feat-link, .today-resume, .day-allday-ev, a, input, textarea";
    let n = 0;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let t: Node | null;
    while ((t = w.nextNode())) {
      const p = t.parentElement;
      if (!p || !vis(p) || p.closest(".topbar, script, style, svg, .brand-stage, .sr-only") || (p.closest(TITLE) && !p.closest(".mode-switch"))) continue;
      n += (t.textContent ?? "").trim().split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
    }
    return n;
  });

describe.skipIf(!CHROMIUM)("Today: Now, Check-in and Close out (U2)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Day: one Start focus, on the next to-do's row; nothing above the blocks but the strip, the chips and the moment card; risk says why; the word count", async () => {
    const { page, errors } = await freshPage(h);
    await seed(page);
    // WD-2: the one Start focus is on the next to-do's row on its card (no "what's next" card above the blocks).
    await expect(page.getByRole("button", { name: "Start focus" }).count()).resolves.toBe(1);
    await expect(page.locator(".pick-row.next").getByRole("button", { name: "Start focus" }).count()).resolves.toBe(1);
    await expect(page.locator(".pick-row.next .pr-title").textContent()).resolves.toContain("Utilization chart");
    expect(await page.locator(".phone-now, .this-week, .today-other").count()).toBe(0);
    // Above the blocks, in order: the urgent strip, the chips, then (when one is current) the moment card.
    const above = await page.evaluate(() => {
      const cards = document.querySelector(".day-cards")!;
      return [...document.querySelectorAll(".day-view > *")].filter((e) => e !== cards && !e.matches("header, .fading, [hidden]") && (e.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING) && (e as HTMLElement).offsetHeight > 0).map((e) => (e.matches(".urgent-strip") ? "urgent" : e.matches(".day-chips") || e.querySelector(".attention") ? "chips" : e.matches(".moment-card, .moment-done") ? "moment" : e.className));
    });
    expect(above.filter((x) => x !== "moment")).toEqual(["urgent", "chips"]);
    // The card's one status chip; its reason is in the tooltip.
    const risks = page.locator(".day-view .half.card .status-pill.at_risk");
    expect(await risks.count()).toBeGreaterThan(0);
    for (const r of await risks.allTextContents()) expect(r).toBe("At risk");
    expect((await risks.evaluateAll((els) => els.map((e) => e.getAttribute("title")))).join(" ")).toContain("Dentist 12:00");
    // 81: UI-B's now line adds its time ("9:30"); 95: DM-1's late promise in the urgent strip; 98: QF-1's Timebox my day beside the plan.
    // 113: IB-1 slice 4's strip reads the Inbox, capped at 3 lines (two late promises and Priya's Must on the demo day)
    // plus "N more in Inbox"; before, it was the late promise and SW-1's one sends line.
    // 114: TY-1's Timeline switch. 118: DV-2's "DevOps checked just now" in the status bar. PS-1: words only a
    // screen reader gets (.sr-only, the promise a due chip is about) aren't on screen.
    expect(await uiWords(page)).toBeLessThanOrEqual(118);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the attention line is absent when healthy, and a failed source shows only in the status bar, with its age and Retry (RF-1)", async () => {
    const { page, errors } = await freshPage(h);
    await call(page, "vm.dismiss_prompt", {});
    let fail = false;
    await page.route("**/api/action", async (route) => {
      const res = await route.fetch();
      if (!(route.request().postData() ?? "").includes('"week.load"')) return route.fulfill({ response: res });
      const j = await res.json();
      if (j?.data) {
        j.data.followUps = [];
        j.data.expiring = [];
        if (fail) j.data.sources = j.data.sources.map((s: { source: string }) => (s.source === "google" ? { ...s, status: "unreachable", fromCache: true, cause: "network", message: "Can't reach Google", fetchedAt: "2026-11-02T13:02:00Z" } : s));
      }
      return route.fulfill({ response: res, json: j });
    });
    await page.reload();
    await page.waitForSelector(".day-view .half.card");
    await page.waitForTimeout(500);
    await expect(page.locator(".attention").count()).resolves.toBe(0);
    fail = true;
    await page.reload();
    // RF-1: no strip on Day; the status bar has the line, its saved data's time and Retry.
    const line = page.locator("footer.statusbar .status-line", { hasText: "Google" });
    await line.waitFor();
    await expect(line.textContent()).resolves.toMatch(/Showing data saved/);
    await expect(line.getByRole("button", { name: "Retry" }).count()).resolves.toBe(1);
    await expect(page.locator(".attention, .att-chip.source").count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    // A request still in flight when the page closes would reject inside the handler ("Fetch response has been
    // disposed"): stop routing and let pending handlers finish first.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.close();
  }, T);

  it("Check-in: done picks are a count; every unfinished to-do has exactly one move; no fit words, nothing in the risk color", async () => {
    const { page, errors } = await freshPage(h);
    await seed(page);
    await go(page, "#/today/checkin");
    await page.waitForSelector("main.mode-checkin .today-block");
    await expect(page.locator("main.mode-checkin .pick-row.done").count()).resolves.toBe(0);
    await expect(page.locator(".today-block", { hasText: "Cooptimize" }).locator(".tb-count").textContent()).resolves.toBe("1 done");
    // QT-2: no "fits" or "doesn't fit", no dashed amber edge; each unfinished to-do has its one move.
    expect(await page.locator(".pick-row.nofit, .pr-fit").count()).toBe(0);
    const rows = page.locator("main.mode-checkin .today-block .pick-row:not(.done)");
    expect(await rows.count()).toBeGreaterThan(0);
    for (const row of await rows.all()) await expect(row.locator(".ci-move").count()).resolves.toBe(1);
    // The risk color, resolved, against every line and move button.
    const colors = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--risk)";
      document.body.appendChild(probe);
      const risk = getComputedStyle(probe).color;
      probe.remove();
      return { risk, used: [...document.querySelectorAll(".tb-line, .ci-move")].map((e) => getComputedStyle(e).color) };
    });
    expect(colors.used.length).toBeGreaterThan(0);
    expect(colors.used).not.toContain(colors.risk);
    // Done marks Check-in done and returns to Now.
    await page.locator("main.mode-checkin .done-btn").click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/day");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Close out: a panel over Today; no pick twice, a to-do taken off today is gone (CF-1); no Lumen; Done closes the day", async () => {
    const { page, errors } = await freshPage(h);
    const ids = await seed(page);
    await call(page, "pick.remove", { id: ids[ids.length - 1] });
    await page.reload();
    await page.waitForSelector(".day-view .half.card");
    await go(page, "#/today/closeout");
    const panel = page.locator(".closeout-panel");
    await panel.waitFor();
    await expect.poll(() => panel.locator(".cp-numbers").textContent()).toMatch(/0\s*dropped/);
    await expect(page.locator(".pick-row.dropped").count()).resolves.toBe(0);
    const titles = await page.locator("main .pick-row .pr-title").allTextContents();
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).not.toContain("Review the export spec with Dana");
    await expect(page.locator("main .lumen, main [data-lumen]").count()).resolves.toBe(0);
    await expect(panel.locator(".cap-box").count()).resolves.toBe(0);
    await panel.locator(".done-btn").click();
    await expect.poll(async () => (await call(page, "closeout.load", { date: D })).data.closedOutAt, { timeout: 10_000 }).not.toBeNull();
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
