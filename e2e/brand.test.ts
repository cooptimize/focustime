// BR-1: the opening (the loader is the week mark alone, from the first paint) and the brand's places (browser, demo
// mode, clock pinned to Mon Nov 2, 9:30 AM). Timing, words, place, motion and what a key does; no colors or curves.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserContext, Page, Route } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Seen = { shownAt: number | null; goneAt: number | null; lit: boolean; overlays: string[] };
/** Records, from the first paint, when the loader first showed (its stage drawn at all), when it went, whether the
 *  mark lit up to move, and any overlay of the old kind. Times are performance.now() (from navigation). */
const WATCH = () => {
  const seen: Seen = { shownAt: null, goneAt: null, lit: false, overlays: [] };
  (window as unknown as { __seen: Seen }).__seen = seen;
  const tick = () => {
    const st = document.querySelector<HTMLElement>("#boot .brand-stage");
    if (st && seen.shownAt === null && Number(getComputedStyle(st).opacity) > 0) seen.shownAt = performance.now();
    if (!st && seen.goneAt === null && document.readyState !== "loading") seen.goneAt = performance.now();
    if (document.querySelector("#boot .week-loader.lit")) seen.lit = true;
    for (const sel of ["[data-close]", "[data-moment]", "[data-lumen]"]) if (document.querySelector(sel) && !seen.overlays.includes(sel)) seen.overlays.push(sel);
    if (performance.now() < 30_000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Seen }).__seen);

/** Every piece of text a sighted person can see right now (screen reader only text and hidden text left out). */
const visibleText = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = n.textContent?.trim();
      const el = n.parentElement;
      if (!text || !el || el.closest(".boot-say, script, style")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility !== "visible") continue;
      let o = 1;
      for (let a: Element | null = el; a; a = a.parentElement) o *= Number(getComputedStyle(a).opacity);
      if (o > 0) out.push(text);
    }
    return out;
  });

const isAction = (name: string) => (r: Route) => (r.request().postData() ?? "").includes(`"${name}"`);
/** Holds every request matching until `ms` after the first one. */
async function hold(ctx: BrowserContext, glob: string, match: (r: Route) => boolean, ms: number) {
  let until: number | null = null;
  await ctx.route(glob, async (route) => {
    if (match(route)) {
      until ??= Date.now() + ms;
      await new Promise((r) => setTimeout(r, Math.max(0, until! - Date.now())));
    }
    await route.continue();
  });
}

/** A context on a demo session (from `from`), the opening watched; `prefs` are kept locally as the app keeps them. */
async function signedIn(from: Page, opts: { reducedMotion?: "reduce"; colorScheme?: "dark" | "light"; prefs?: Record<string, string> } = {}) {
  const ctx = await h.browser.newContext({ viewport: { width: 1440, height: 900 }, ...(opts.reducedMotion ? { reducedMotion: opts.reducedMotion } : {}), ...(opts.colorScheme ? { colorScheme: opts.colorScheme } : {}) });
  await ctx.addCookies(await from.context().cookies());
  await ctx.addInitScript((p) => {
    for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v);
    localStorage.setItem("focustime.hint.flow", "dismissed");
    localStorage.setItem("focustime.day.panel", "closed");
  }, opts.prefs ?? {});
  await ctx.addInitScript(WATCH);
  return ctx;
}
const markBox = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector("#boot .week-loader")?.getBoundingClientRect();
    return r ? { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 } : null;
  });
const appUp = async (page: Page) => {
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector("#boot .brand-stage", { state: "detached", timeout: 60_000 });
};

/**
 * HK-1: opens Close out the way NV-1 does (Today's moment card, or its address) and waits for the panel itself: the
 * panel, then its day loaded (Done is disabled until then). Clicking Done straight after setting the hash timed out
 * under load (runs 41723654488, 41753874436, 41762272350) with no sign of which of the two hadn't happened.
 */
async function openCloseOut(page: Page): Promise<void> {
  await page.evaluate(() => (location.hash = "#/today/closeout"));
  const panel = page.getByRole("complementary", { name: "Close out" });
  await panel.waitFor();
  await panel.locator(".cp-body > *").first().waitFor();
  await page.waitForSelector(".closeout-panel .done-btn:enabled");
}

/** Today's must pick (demo: Cooptimize's "Timesheet summary query" in the Monday AM block), done. */
/** CF-1: every to-do today done (the moment's rule): take the demo's off, then add one and tick it. */
async function allDoneToday(page: Page): Promise<void> {
  const st = await call(page, "planday.start", { date: "2026-11-02" });
  for (const p of st.data.picks as { id: number; status: string }[]) if (p.status === "planned" || p.status === "done") await call(page, "pick.remove", { id: p.id });
  const add = await call(page, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", itemId: 4411, size: "S" });
  expect(add.ok).toBe(true);
  const w = await call(page, "week.load", {});
  const pick = w.data.plan["2026-11-02"].picks.find((p: { itemId: number }) => p.itemId === 4411);
  expect((await call(page, "pick.mark_done", { id: pick.id, done: true })).ok).toBe(true);
}

describe.skipIf(!CHROMIUM)("BR-1: the loader is the week mark alone (browser, demo mode)", () => {
  let base: Page;
  beforeAll(async () => {
    h = await startDemo();
    ({ page: base } = await freshPage(h, { width: 1440, height: 900 }));
  }, 120_000);
  afterAll(async () => h?.stop());

  it("a fast load shows nothing before the app; a slow one shows the loader from 400 ms for at least 600 ms, then moves it into the top bar's mark", async () => {
    const fast = await signedIn(base);
    const p1 = await fast.newPage();
    await p1.goto(h.url);
    await appUp(p1);
    const s1 = await seen(p1);
    expect(s1.goneAt).not.toBeNull();
    if (s1.goneAt! < 400) expect(s1.shownAt).toBeNull(); // under 400 ms: nothing was shown
    await fast.close();

    const slow = await signedIn(base);
    await hold(slow, "**/api/action", isAction("week.load"), 1500);
    const p2 = await slow.newPage();
    await p2.goto(h.url);
    await appUp(p2);
    const s2 = await seen(p2);
    expect(s2.shownAt).not.toBeNull();
    expect(s2.shownAt!).toBeGreaterThanOrEqual(380);
    expect(s2.goneAt! - s2.shownAt!).toBeGreaterThanOrEqual(600);
    expect(s2.lit).toBe(true); // it finished a pass and moved
    expect(s2.overlays).toEqual([]);
    await slow.close();
  }, T);

  it("the move lands on the top bar's mark", async () => {
    const ctx = await signedIn(base);
    await hold(ctx, "**/api/action", isAction("week.load"), 1500);
    const page = await ctx.newPage();
    await page.goto(h.url);
    // Measured in the page, 380 ms after the mark lights up to move (the move is 400 ms).
    const [moved, mark] = await page.evaluate(
      () =>
        new Promise<({ x: number; y: number; width: number } | undefined)[]>((done) => {
          const look = () => {
            if (!document.querySelector("#boot .week-loader.lit")) return void requestAnimationFrame(look);
            setTimeout(() => done([document.querySelector("#boot .week-loader"), document.querySelector(".brand-home .week-mark")].map((e) => e?.getBoundingClientRect().toJSON())), 380);
          };
          look();
        }),
    );
    expect(moved && mark).toBeTruthy();
    expect(Math.abs(moved!.x - mark!.x)).toBeLessThan(4);
    expect(Math.abs(moved!.y - mark!.y)).toBeLessThan(4);
    expect(Math.abs(moved!.width - mark!.width)).toBeLessThan(4);
    await ctx.close();
  }, T);

  it("no words on screen before 8 seconds in any theme; after 8 seconds one line names what it still waits on; a screen reader hears loading, then ready", async () => {
    for (const [scheme, theme] of [["dark", "cooptimize-dark"], ["light", "cooptimize-light"], ["light", "neutral"], ["dark", "neutral"]] as const) {
      const long = scheme === "dark" && theme === "cooptimize-dark";
      const ctx = await signedIn(base, { colorScheme: scheme, prefs: { "focustime.theme": theme } });
      await hold(ctx, "**/api/action", isAction("week.load"), long ? 9500 : 1500);
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(h.url, { waitUntil: "commit" });
      await page.waitForTimeout(t0 + 1200 - Date.now());
      expect(await visibleText(page), theme).toEqual([]);
      await expect(page.locator("#boot .boot-say[role=status]").textContent()).resolves.toBe("Loading FocusTime");
      // The pass runs (in the built CSS too): eight blocks, each its own animation, and their opacities differ over time.
      expect(await page.evaluate(() => document.getAnimations().filter((a) => /^wl-\d$/.test((a as CSSAnimation).animationName) && a.playState === "running").length)).toBe(8);
      const o = () => page.evaluate(() => [...document.querySelectorAll("#boot .wl")].map((e) => Number(getComputedStyle(e).opacity)));
      const seenOpacities = new Set<number>();
      for (let i = 0; i < 6; i++) (await o()).forEach((v) => seenOpacities.add(Math.round(v * 10))), await page.waitForTimeout(110);
      expect(seenOpacities.size).toBeGreaterThan(2);
      if (long) {
        await page.waitForTimeout(t0 + 7400 - Date.now());
        expect(await visibleText(page)).toEqual([]);
        await page.waitForTimeout(t0 + 8700 - Date.now());
        expect(await visibleText(page)).toEqual(["Still waiting on Dataverse, Outlook and 2 more"]);
      }
      await appUp(page);
      await expect(page.locator("#boot .boot-say").textContent()).resolves.toBe("FocusTime is ready");
      await ctx.close();
    }
  }, 120_000);

  it("the mark is in the same place at the same size from the first paint through the loader, about 96 px wide", async () => {
    const boxes: Record<string, unknown> = {};
    for (const [name, glob, match] of [
      ["first paint", "**/assets/*.js", () => true], // the app's scripts (prefs.js is the head's own, and tiny)
      ["sign-in check", "**/api/action", isAction("auth.status")],
      ["loader", "**/api/action", isAction("week.load")],
    ] as const) {
      const ctx = await signedIn(base);
      await hold(ctx, glob, match, 2500);
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(h.url, { waitUntil: "commit" });
      await page.waitForTimeout(t0 + 1300 - Date.now());
      boxes[name] = await markBox(page);
      await ctx.close();
    }
    expect(boxes["first paint"]).toEqual({ x: 672, y: 428.4, w: 96, h: 43.2 });
    expect(boxes["sign-in check"]).toEqual(boxes["first paint"]);
    expect(boxes["loader"]).toEqual(boxes["first paint"]);
    // At the Larger text size it grows with the text, from the first paint.
    const big = await signedIn(base, { prefs: { "focustime.textSize": "larger" } });
    await hold(big, "**/assets/*.js", () => true, 2500);
    const bp = await big.newPage();
    const t1 = Date.now();
    await bp.goto(h.url, { waitUntil: "commit" });
    await bp.waitForTimeout(t1 + 1000 - Date.now());
    expect((await markBox(bp))?.w).toBeCloseTo(125.5, 0);
    await big.close();
  }, T);

  for (const how of ["system", "setting"] as const)
    it(`reduced motion (the ${how}): the mark holds still and the app appears with no movement`, async () => {
      // The setting is the person's (the server's), mirrored locally for the next opening.
      if (how === "setting") expect((await call(base, "ui.set_reduce_motion", { on: true })).ok).toBe(true);
      const ctx = await signedIn(base, how === "system" ? { reducedMotion: "reduce" } : { prefs: { "focustime.reduceMotion": "1" } });
      await hold(ctx, "**/api/action", isAction("week.load"), 2000);
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(h.url, { waitUntil: "commit" });
      await page.waitForTimeout(t0 + 1000 - Date.now());
      const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && (a as CSSAnimation).animationName !== "boot-show" && (a as CSSAnimation).animationName !== "boot-line").length);
      expect(running).toBe(0);
      await appUp(page);
      const s = await seen(page);
      expect(s.shownAt).not.toBeNull();
      expect(s.lit).toBe(false); // no pass to finish, no move
      if (how === "setting") expect((await call(base, "ui.set_reduce_motion", { on: false })).ok).toBe(true);
      await ctx.close();
    }, T);

  it("a click or a key while it finishes goes straight to the app, and the key does nothing else", async () => {
    for (const how of ["key", "click"] as const) {
      const ctx = await signedIn(base);
      await hold(ctx, "**/api/action", isAction("week.load"), 1500);
      const page = await ctx.newPage();
      await page.goto(h.url);
      await page.waitForSelector(".topbar", { timeout: 30_000 });
      expect(await page.locator("#boot .brand-stage").count()).toBe(1); // the app is ready, the loader still finishing
      const hash = await page.evaluate(() => location.hash);
      const t = Date.now();
      if (how === "key") await page.keyboard.press("2"); // Week's key: it must not switch
      else await page.mouse.click(720, 450);
      await page.waitForSelector("#boot .brand-stage", { state: "detached", timeout: 2000 });
      expect(Date.now() - t).toBeLessThan(400);
      expect(await page.evaluate(() => location.hash)).toBe(hash);
      await ctx.close();
    }
  }, T);

  it("a source failing at load: the app opens as fast and the status bar names it", async () => {
    const ctx = await signedIn(base);
    await ctx.route("**/api/action", async (route) => {
      if (!isAction("week.load")(route)) return route.continue();
      const r = await route.fetch();
      const j = await r.json();
      for (const s of j?.data?.sources ?? []) if (s.source === "outlook") Object.assign(s, { status: "unreachable", sample: false, message: "Outlook didn't answer" });
      return route.fulfill({ response: r, body: JSON.stringify(j) });
    });
    const page = await ctx.newPage();
    await page.goto(h.url);
    await appUp(page);
    expect((await seen(page)).goneAt!).toBeLessThan(1500);
    await expect(page.locator("footer.statusbar").textContent()).resolves.toContain("Outlook");
    await ctx.close();
  }, T);

  it("the sign-in screen finishes the loader too", async () => {
    const ctx = await h.browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).waitFor({ timeout: 30_000 });
    await page.waitForSelector("#boot .brand-stage", { state: "detached", timeout: 5000 });
    await ctx.close();
  }, T);

  it("the top bar's mark is the week and goes to Day", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator(".brand-home .week-mark").waitFor();
    await page.locator(".brand-home").click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/day");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Close out ends on Day with its done line and no overlay, even with every to-do done", async () => {
    const ctx = await signedIn(base);
    const page = await ctx.newPage();
    await page.goto(h.url);
    await appUp(page);
    await allDoneToday(page);
    await openCloseOut(page);
    await page.locator(".closeout-panel .done-btn").click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/day");
    await page.getByText("Closed out. Nice work.").first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(1500);
    expect((await seen(page)).overlays).toEqual([]);
    expect(await page.locator(".brand-stage, [data-close], [data-moment]").count()).toBe(0);
    await ctx.close();
  }, T);

  it("a reconnect in Settings shows its one plain line", async () => {
    const ctx = await signedIn(base);
    await ctx.route("**/api/action", async (route) => {
      const body = route.request().postData() ?? "";
      if (body.includes('"auth.connect_microsoft"')) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { status: "connected" } }) });
      if (!body.includes('"week.load"')) return route.continue();
      const r = await route.fetch();
      const j = await r.json();
      for (const s of j?.data?.sources ?? []) if (s.source === "outlook") Object.assign(s, { status: "auth_required", sample: false, fixAction: "connect_microsoft", cause: null, message: null });
      return route.fulfill({ response: r, body: JSON.stringify(j) });
    });
    const page = await ctx.newPage();
    await page.goto(h.url);
    await appUp(page);
    await page.evaluate(() => (location.hash = "#/settings/connections"));
    await page.locator("li.source button").filter({ hasText: /^Reconnect$/ }).first().click();
    const line = page.locator(".reconnect-line[role=status]");
    await expect.poll(() => line.textContent()).toBe("Outlook is connected again.");
    expect(await line.locator("svg").count()).toBe(0);
    await ctx.close();
  }, T);

  it("the first launch opens the app with no welcome overlay (and is still recorded)", async () => {
    const ctx = await h.browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(WATCH);
    const page = await ctx.newPage();
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 30_000 });
    await appUp(page);
    await page.waitForTimeout(2000);
    expect((await seen(page)).overlays).toEqual([]);
    expect(await page.getByText(/Welcome to FocusTime/).count()).toBe(0);
    await expect.poll(async () => (await call(page, "ui.first_launch", {})).data?.first).toBe(false);
    await ctx.close();
  }, T);

  it("the built app has nothing of Lumen: no element, asset, style, token or word for it", () => {
    const dist = process.env.FOCUSTIME_E2E_DIST;
    if (!dist || dist === "dev") return; // a Vite run has no build to search
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const text = walk(dist).filter((f) => /\.(js|css|html|svg|json|webmanifest)$/.test(f));
    expect(text.length).toBeGreaterThan(5);
    const hits = text.filter((f) => /lumen|mascot|\bbeam|--lime\b|headlight|bent-mark|mark-bent|lockup-horizontal|data-lumen|lumen-loading|unroll/i.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
