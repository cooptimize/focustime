// U2: Today in three states (browser, demo mode, clock pinned to Mon Nov 2, 9:30 AM). Behavior only: one Start
// focus, the attention line only when needed, risk with its reason, Check-in's counts and one move per pick, fit never
// in the risk color, Close out's panel (no pick twice, dropped as a count), Lumen absent, and the word count guard.
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

/** The demo day as the U1 and U2 screenshots have it: seven picks, a follow-up, committed, the first one done. */
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
  await call(page, "planday.commit", { date: D });
  await call(page, "pick.mark_done", { id: ids[0], done: true });
  await page.reload();
  await page.waitForSelector(".today-block");
  return ids;
}

/** U1's method: UI words on screen (the status bar counts, the top bar doesn't), titles and names excluded; hidden hover controls aren't on screen. */
const uiWords = (page: Page) =>
  page.evaluate(() => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left < innerWidth && r.right > 0 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    };
    const TITLE = ".ev-title, .att-names, .att-who, .pr-title, .what, .feat-link, .today-resume, .day-allday-ev, a, input, textarea";
    let n = 0;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let t: Node | null;
    while ((t = w.nextNode())) {
      const p = t.parentElement;
      if (!p || !vis(p) || p.closest(".topbar, script, style, svg, .brand-stage") || (p.closest(TITLE) && !p.closest(".mode-switch"))) continue;
      n += (t.textContent ?? "").trim().split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
    }
    return n;
  });

describe.skipIf(!CHROMIUM)("Today: Now, Check-in and Close out (U2)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Now: one Start focus, at the top on the next pick; risk says why; at most 80 UI words on the demo day", async () => {
    const { page, errors } = await freshPage(h);
    await seed(page);
    // NV-1: the one Start focus is at the top, beside what's next; the card highlights the next pick.
    await expect(page.getByRole("button", { name: "Start focus" }).count()).resolves.toBe(1);
    await expect(page.locator(".phone-now").getByRole("button", { name: "Start focus" }).count()).resolves.toBe(1);
    await expect(page.locator(".phone-now .pn-pick").textContent()).resolves.toContain("Utilization chart");
    await expect(page.locator(".pick-row.next .pr-title").textContent()).resolves.toContain("Utilization chart");
    // No size chips on Today's rows.
    await expect(page.locator(".today-block .size-chip").count()).resolves.toBe(0);
    const risks = await page.locator(".today-block .status-pill.at_risk").allTextContents();
    expect(risks.length).toBeGreaterThan(0);
    for (const r of risks) expect(r).toMatch(/^At risk · \S/);
    expect(risks.join(" ")).toContain("Dentist 12:00");
    // 81: UI-B's now line adds its time ("9:30"); 95: DM-1's late promise in the urgent strip.
    expect(await uiWords(page)).toBeLessThanOrEqual(95);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the attention line is absent when healthy, and a failed source shows its age and Retry", async () => {
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
    await page.waitForSelector(".today-block");
    await page.waitForTimeout(500);
    await expect(page.locator(".attention").count()).resolves.toBe(0);
    fail = true;
    await page.reload();
    await page.waitForSelector(".attention");
    const chip = page.locator(".att-chip.source");
    await expect(chip.textContent()).resolves.toMatch(/Google.*from/);
    await expect(chip.getByRole("button", { name: "Retry" }).count()).resolves.toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Check-in: done picks are a count; each pick that doesn't fit has exactly one suggested move; fit is never the risk color", async () => {
    const { page, errors } = await freshPage(h);
    await seed(page);
    await go(page, "#/today/checkin");
    await page.waitForSelector("main.mode-checkin .today-block");
    await expect(page.locator("main.mode-checkin .pick-row.done").count()).resolves.toBe(0);
    await expect(page.locator(".today-block", { hasText: "Cooptimize" }).locator(".tb-count").textContent()).resolves.toBe("1 done");
    const nofit = page.locator(".pick-row.nofit");
    expect(await nofit.count()).toBeGreaterThan(0);
    for (const row of await nofit.all()) await expect(row.locator(".ci-move").count()).resolves.toBe(1);
    // The risk color, resolved, against every fit word, amber line and non-fitting row edge.
    const colors = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--risk)";
      document.body.appendChild(probe);
      const risk = getComputedStyle(probe).color;
      probe.remove();
      const used = [...document.querySelectorAll(".pr-fit, .tb-line, .ci-move")].map((e) => getComputedStyle(e).color);
      const edges = [...document.querySelectorAll(".pick-row.nofit")].map((e) => getComputedStyle(e).borderTopColor);
      return { risk, used: [...used, ...edges] };
    });
    expect(colors.used.length).toBeGreaterThan(0);
    expect(colors.used).not.toContain(colors.risk);
    // Done marks Check-in done and returns to Now.
    await page.locator("main.mode-checkin .done-btn").click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/today");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Close out: a panel over Today; no pick twice, dropped picks only as a count; no Lumen; Done closes the day", async () => {
    const { page, errors } = await freshPage(h);
    const ids = await seed(page);
    await call(page, "pick.remove", { id: ids[ids.length - 1] });
    await page.reload();
    await page.waitForSelector(".today-block");
    await go(page, "#/today/closeout");
    const panel = page.locator(".closeout-panel");
    await panel.waitFor();
    await expect.poll(() => panel.locator(".cp-numbers").textContent()).toMatch(/1\s*dropped/);
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

  it("3840: a day timeline beside the cards; a pick dropped on a free gap is timeboxed there", async () => {
    const { page, errors } = await freshPage(h, { width: 3840, height: 1600 });
    await seed(page);
    await page.waitForSelector(".day-timeline .dt-free");
    const gaps = await page.locator(".dt-free").count();
    await page.locator(".pick-row.next").dragTo(page.locator(".dt-free").first());
    await expect.poll(() => page.locator(".dt-box").count(), { timeout: 10_000 }).toBe(1);
    await expect(page.locator(".dt-box .ev-title").textContent()).resolves.toContain("Utilization chart");
    expect(await page.locator(".dt-free").count()).toBeGreaterThanOrEqual(gaps - 1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
