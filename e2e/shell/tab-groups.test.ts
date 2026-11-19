// TB-1 (browser, demo mode): the tabs in three groups, Day Week Backlog | Inbox Calls | Status Code, with a faint
// divider between groups that is decoration only and gives way first when the bar is tight; Status after Calls; keys
// 1 to 7 follow the bar; the command menu, the legend and the tooltips agree; addresses and the stored last place are
// unchanged. Demo data only (fictional); each clock or env is its own throwaway server.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 240_000;
const SEVEN = ["Day", "Week", "Backlog", "Inbox", "Calls", "Status", "Code"];
const SIX = SEVEN.slice(0, 6);
const hash = (page: Page) => page.evaluate(() => location.hash);

/** As for a person who may not read code: Code's client list comes back empty, so the bar has six tabs (RB-6). */
const withoutCode = (page: Page) =>
  page.route("**/api/action", async (route) => {
    if ((JSON.parse(route.request().postData() ?? "{}") as { action?: string }).action !== "code.clients") return route.continue();
    const res = await route.fetch();
    const empty = (v: unknown): unknown => (Array.isArray(v) ? v.map(empty) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "clients" && Array.isArray(x) ? [] : empty(x)])) : v);
    await route.fulfill({ response: res, json: empty(await res.json()) });
  });

async function open(h: Harness, tabs: 6 | 7, viewport = { width: 1440, height: 900 }) {
  const r = await freshPage(h, viewport, tabs === 6 ? { before: withoutCode } : {});
  await r.page.evaluate(() => (location.hash = "#/week"));
  await r.page.locator(".topbar .view-tab").first().waitFor({ timeout: 60_000 });
  await r.page.waitForFunction((n) => document.querySelectorAll(".topbar .view-tab").length === n, tabs, { timeout: 30_000 });
  return r;
}

/** The bar left to right: each tab's word, "|" for a divider whose line shows, "_" for one that has given way. */
const bar = (page: Page) =>
  page.locator("nav.views").evaluate((nav) =>
    [...nav.children].map((e) => {
      if (e.classList.contains("tab-divider")) return getComputedStyle(e.firstElementChild!).display === "none" ? "_" : "|";
      return [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join("");
    }),
  );

/** The bar's fit: one line, nothing scrolled or clipped, and each divider's line shown only while it has its full room. */
const fit = (page: Page) =>
  page.evaluate(() => {
    const top = document.querySelector<HTMLElement>(".app > .topbar")!;
    const kids = [...top.children].filter((e) => e.getBoundingClientRect().width > 0);
    const mids = kids.map((e) => e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2);
    const dividers = [...top.querySelectorAll<HTMLElement>(".tab-divider")].map((d) => {
      const em = parseFloat(getComputedStyle(d).fontSize);
      return { full: d.getBoundingClientRect().width >= 1.2 * em, line: getComputedStyle(d.firstElementChild!).display !== "none" };
    });
    return {
      wraps: Math.max(...mids) - Math.min(...mids) > 4,
      over: top.scrollWidth - top.clientWidth,
      cut: [...top.querySelectorAll<HTMLElement>(".view-tab, .top-btn, .vm-chip, .brand")].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className),
      lineWithoutRoom: dividers.filter((d) => d.line && !d.full).length,
      roomWithoutLine: dividers.filter((d) => !d.line && d.full).length,
      linesShown: dividers.filter((d) => d.line).length,
    };
  });

describe.skipIf(!CHROMIUM)("TB-1: tabs in three groups, Status after Calls", () => {
  let h: Harness;
  // As people see it: no Dev or Local mark (the developer loop's Local mark is wider; the fit tests below cover Dev).
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_ENV: "prod" });
  }, T);
  afterAll(async () => h?.stop());

  it("the bar reads Day Week Backlog | Inbox Calls | Status Code, and with six tabs Status alone after the second divider", async () => {
    const seven = await open(h, 7);
    expect(await bar(seven.page)).toEqual(["Day", "Week", "Backlog", "|", "Inbox", "Calls", "|", "Status", "Code"]);
    // The dividers are about as tall as a tab's word and drawn in the dividers' color, the same in dark and light.
    for (const theme of ["cooptimize-dark", "cooptimize-light"]) {
      await seven.page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      const look = await seven.page.evaluate(() => {
        const i = document.querySelector<HTMLElement>(".tab-divider > i")!;
        const word = document.querySelector<HTMLElement>(".view-tab")!;
        const probe = document.createElement("span");
        probe.style.color = "var(--border)";
        document.body.append(probe);
        const border = getComputedStyle(probe).color;
        probe.remove();
        return { h: i.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(word).fontSize), w: i.getBoundingClientRect().width, bg: getComputedStyle(i).backgroundColor, border };
      });
      expect(look.w, theme).toBe(1);
      expect(look.h / look.fs, theme).toBeGreaterThan(1);
      expect(look.h / look.fs, theme).toBeLessThan(1.6);
      expect(look.bg, theme).toBe(look.border);
    }
    // The gap between groups is plainly wider than between two tabs in a group.
    const gaps = await seven.page.evaluate(() => {
      const tabs = [...document.querySelectorAll<HTMLElement>("nav.views .view-tab")].map((t) => t.getBoundingClientRect());
      return { inGroup: tabs[1]!.left - tabs[0]!.right, between: tabs[3]!.left - tabs[2]!.right };
    });
    expect(gaps.between).toBeGreaterThanOrEqual(gaps.inGroup + 12);
    expect(seven.errors).toEqual([]);
    await seven.page.close();

    const six = await open(h, 6);
    expect(await bar(six.page)).toEqual(["Day", "Week", "Backlog", "|", "Inbox", "Calls", "|", "Status"]);
    await six.page.close();
  }, T);

  it("keys 1 to 7 open the tabs in the bar's order; T and L as before; each tooltip says its key; with six tabs 7 does nothing", async () => {
    const { page, errors } = await open(h, 7);
    await page.locator(".topbar .view-tab .status-mark").first().waitFor({ timeout: 8_000 }).catch(() => undefined);
    const tips = await page.locator(".topbar .view-tab").evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
    tips.forEach((t, i) => expect(t, t).toMatch(new RegExp(`\\. Press ${i + 1}$`)));
    expect(tips[5]).toMatch(/^Status/);
    const current = () => page.locator(".topbar .view-tab[aria-current=page]").evaluate((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join(""));
    for (const [k, name] of [["1", "Day"], ["2", "Week"], ["3", "Backlog"], ["4", "Inbox"], ["5", "Calls"], ["6", "Status"], ["7", "Code"], ["t", "Day"], ["l", "Inbox"], ["T", "Day"], ["L", "Inbox"]] as const) {
      await page.locator("body").click({ position: { x: 5, y: 400 } }).catch(() => undefined);
      await page.keyboard.press(k);
      await expect.poll(current, { timeout: 30_000, message: k }).toBe(name);
    }
    // The key legend lists the tabs in the bar's order with the same keys.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("keyboard shortcuts");
    await page.keyboard.press("Enter");
    const legend = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await legend.waitFor();
    const pairs = await legend.locator("dl.key-list dt").evaluateAll((dts) => dts.map((dt) => ({ keys: [...dt.querySelectorAll("kbd")].map((k) => k.textContent ?? ""), does: dt.nextElementSibling?.textContent ?? "" })));
    const tabRows = pairs.filter((p) => /^[1-7]$/.test(p.keys[0] ?? ""));
    expect(tabRows.map((p) => p.keys[0])).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(tabRows.map((p) => p.does.split(":")[0])).toEqual(SEVEN);
    expect(tabRows.map((p) => p.keys.slice(1).join(""))).toEqual(["T", "", "", "L", "", "", ""]);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();

    const six = await open(h, 6);
    await six.page.locator("body").click({ position: { x: 5, y: 400 } });
    await six.page.keyboard.press("6");
    await expect.poll(() => hash(six.page)).toBe("#/status");
    await six.page.keyboard.press("7");
    await six.page.waitForTimeout(400);
    expect(await hash(six.page)).toBe("#/status");
    await six.page.close();
  }, T);

  it("a screen reader hears one list of tabs in the bar's order with no divider; Tab never stops on a divider", async () => {
    const { page } = await open(h, 7);
    const snap = await page.locator("nav.views").ariaSnapshot();
    expect(snap).not.toMatch(/separator|divider/i);
    const names = [...snap.matchAll(/- button "([A-Za-z]+)/g)].map((m) => m[1]);
    expect(names).toEqual(SEVEN);
    for (const d of await page.locator(".tab-divider").all()) {
      expect(await d.getAttribute("aria-hidden")).toBe("true");
      expect(await d.getAttribute("tabindex")).toBeNull();
    }
    // Tab from the first tab walks the seven tabs and then leaves the list.
    await page.locator(".topbar .view-tab").first().focus();
    const stops: string[] = [];
    for (let i = 0; i < 7; i++) {
      stops.push(await page.evaluate(() => document.activeElement!.className));
      await page.keyboard.press("Tab");
    }
    expect(stops).toEqual(Array(7).fill("view-tab"));
    expect(await page.evaluate(() => document.activeElement!.closest("nav.views") === null)).toBe(true);
    await page.close();
  }, T);

  it("the command menu lists the tabs in the bar's order, with no dividers or group names", async () => {
    const { page } = await open(h, 7);
    await page.keyboard.press("Control+k");
    const menu = page.getByRole("dialog", { name: "Command menu" });
    await menu.waitFor();
    const items = await menu.getByRole("menuitem").evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
    const at = (re: RegExp) => items.findIndex((t) => re.test(t));
    const order = [/^Day ?1$/, /^Week ?2$/, /^Backlog: every client's DevOps in rank order, Grid ?3$/, /^Inbox: from chats, promises, captures ?4$/, /^Calls ?5$/, /^Status: this week's feature updates for Monday's report ?6$/, /^Code ?7$/].map(at);
    expect(order.every((i) => i >= 0), items.slice(0, 40).join("\n")).toBe(true);
    // One run, in the bar's order, first in the menu (under Views).
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await page.keyboard.press("Escape");
    await page.close();
  }, T);

  it("every address that opened a tab still opens it, and the stored last place reopens it after a reload", async () => {
    const { page, errors } = await open(h, 7);
    const current = () => page.locator(".topbar .view-tab[aria-current=page]").evaluate((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join(""));
    for (const [address, name] of [["#/day", "Day"], ["#/today", "Day"], ["#/week", "Week"], ["#/backlog", "Backlog"], ["#/backlog/gantt", "Backlog"], ["#/ahead", "Backlog"], ["#/roadmap", "Backlog"], ["#/inbox", "Inbox"], ["#/inbox/promises", "Inbox"], ["#/calls", "Calls"], ["#/meetings", "Calls"], ["#/status", "Status"], ["#/week/status", "Status"], ["#/code", "Code"]] as const) {
      await page.evaluate((a) => (location.hash = a), address);
      await expect.poll(current, { timeout: 30_000, message: address }).toBe(name);
    }
    // The stored last place: a new window at an address that names no place (the hosted app's #/capture) opens over
    // the tab last open, as capture-address.test.ts checks for Week.
    for (const [address, name] of [["#/status", "Status"], ["#/calls", "Calls"], ["#/inbox", "Inbox"]] as const) {
      await page.evaluate((a) => (location.hash = a), address);
      await expect.poll(current, { timeout: 30_000 }).toBe(name);
      await page.waitForTimeout(300);
      await page.goto(new URL("/healthz", h.url).href);
      await page.goto(`${h.url}#/capture`);
      await page.locator(".cap-box textarea[aria-label='Quick capture']").waitFor({ timeout: 30_000 });
      await expect.poll(current, { timeout: 30_000, message: `last place ${address}` }).toBe(name);
      await page.keyboard.press("Escape");
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Inbox's and Calls' counts and Status's mark sit in their tabs as on main", async () => {
    const { page } = await open(h, 7);
    const tab = (n: string) => page.locator("nav.views .view-tab", { hasText: n });
    await expect.poll(() => tab("Inbox").locator(".count").count(), { timeout: 30_000 }).toBe(1);
    await expect(tab("Inbox").locator(".count").getAttribute("aria-label")).resolves.toMatch(/^\d+ need you$/);
    await expect.poll(() => tab("Calls").locator(".count").getAttribute("aria-label"), { timeout: 30_000 }).toBe("1 needs you");
    expect(await tab("Status").locator(".count").count()).toBe(0);
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("TB-1: the bar fits on one line everywhere; the dividers give way first", () => {
  for (const env of ["dev", "prod"] as const) {
    describe(env === "dev" ? "with the Dev mark" : "without the Dev mark", () => {
      let h: Harness;
      beforeAll(async () => {
        h = await startDemo("chromium", { FOCUSTIME_ENV: env });
      }, T);
      afterAll(async () => h?.stop());

      for (const tabs of [7, 6] as const) {
        it(`${tabs} tabs at 1280, 1366, 1440 and 1920, at each Text size`, async () => {
          const { page } = await open(h, tabs, { width: 1920, height: 900 });
          const bad: string[] = [];
          for (const width of [1280, 1366, 1440, 1920]) {
            await page.setViewportSize({ width, height: 900 });
            for (const size of [null, "large", "larger"]) {
              await page.evaluate((s) => (s ? document.documentElement.setAttribute("data-text-size", s) : document.documentElement.removeAttribute("data-text-size")), size);
              await page.waitForTimeout(150);
              const at = `${width} ${size ?? "default"}`;
              const f = await fit(page);
              if (f.wraps || f.over > 0 || f.cut.length || f.lineWithoutRoom || f.roomWithoutLine) bad.push(`${at}: ${JSON.stringify(f)}`);
              // The order holds, with or without the dividers' lines.
              expect((await bar(page)).filter((x) => x !== "|" && x !== "_"), at).toEqual(tabs === 7 ? SEVEN : SIX);
              if (width === 1920 && size === null) expect(f.linesShown, at).toBe(2);
            }
          }
          expect(bad).toEqual([]);
          await page.close();
        }, T);
      }
    });
  }
});
