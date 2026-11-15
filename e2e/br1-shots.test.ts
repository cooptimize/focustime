// BR-1: the before and after screenshots, one script for both so the pairs match. Only when BR1_SHOTS names a folder
// (docs/ux/br1/before or docs/ux/br1/after); nothing runs otherwise. Demo data only. The opening as frames on a slow
// load (first paint, the plain loading state, the loader mid-pass, the line at 8 seconds, the move to the top bar, the
// app), sign-in, About, the Guide's Start here, a tour's last card, the Guide's footer, an empty state, the end of
// Close out and Settings after a reconnect; dark and light at 1440x900, and the phone's loader. It also times the
// opening, fast and slow, and writes the times to timings.json. A shot that can't be reached is named in the log.
import { writeFileSync } from "node:fs";
import { afterAll, describe, it } from "vitest";
import type { BrowserContext, Page, Route } from "playwright-core";
import { CHROMIUM, freshPage, openApp, startDemo, type Harness } from "./harness.ts";

const DIR = process.env.BR1_SHOTS ?? null;
const T = 1_800_000;
const missed: string[] = [];
const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const THEMES = [["dark", "cooptimize-dark"], ["light", "cooptimize-light"]] as const;
/** BR1_ONLY=reconnect (or opening, screens, timings, phone) runs only that part, to retake one set. */
const ONLY = process.env.BR1_ONLY ?? null;
const part = (p: string) => !ONLY || ONLY.split(",").includes(p);

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shot(page: Page, name: string, run: () => Promise<void>, settle = 350) {
  try {
    await run();
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}
const go = async (page: Page, hash: string, wait = 900) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(wait);
};
/** Waits until the opening is over: the overlay gone and the top bar up. */
const opened = async (page: Page) => {
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 60_000 });
};

/** A context on the demo session `from`, with the theme stored locally (so the first paint has it) and system scheme. */
async function themed(h: Harness, from: Page, theme: (typeof THEMES)[number], viewport = DESK): Promise<BrowserContext> {
  const ctx = await h.browser.newContext({ viewport, colorScheme: theme[0] });
  await ctx.addCookies(await from.context().cookies());
  await ctx.addInitScript((t) => {
    localStorage.setItem("focustime.theme", t);
    localStorage.setItem("focustime.hint.flow", "dismissed");
    localStorage.setItem("focustime.hint.picktime", "1");
    localStorage.setItem("focustime.day.panel", "closed");
  }, theme[1]);
  return ctx;
}

/** Holds every request matching `match` until `ms` after the first one. */
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
const isAction = (name: string) => (r: Route) => (r.request().postData() ?? "").includes(`"${name}"`);

/** The opening on a slow load, as frames: first paint (the scripts held), the plain loading state (sign-in status held),
 *  then the week held for 10 s: the loader at 1.2 and 1.6 s, the line at 8.6 s, the move as it happens, then the app. */
async function openingFrames(h: Harness, from: Page, theme: (typeof THEMES)[number], viewport: typeof DESK, tag: string, full: boolean) {
  const at = async (page: Page, name: string, ms: number, t0: number) => {
    await page.waitForTimeout(Math.max(0, t0 + ms - Date.now()));
    await page.screenshot({ path: `${DIR}/${name}.png` }).catch((e) => missed.push(`${name}: ${String(e).split("\n")[0]}`));
  };
  if (full) {
    // 1. First paint: the page's scripts held 3 s.
    const c1 = await themed(h, from, theme, viewport);
    await hold(c1, "**/*.{js,ts,tsx}", () => true, 3000);
    const p1 = await c1.newPage();
    const t1 = Date.now();
    await p1.goto(h.url, { waitUntil: "commit" });
    await at(p1, `opening-1-first-paint-${tag}`, 1000, t1);
    await c1.close();
    // 2. The plain loading state: the sign-in status held 3 s.
    const c2 = await themed(h, from, theme, viewport);
    await hold(c2, "**/api/action", isAction("auth.status"), 3000);
    const p2 = await c2.newPage();
    const t2 = Date.now();
    await p2.goto(h.url, { waitUntil: "commit" });
    await at(p2, `opening-2-loading-${tag}`, 1500, t2);
    await c2.close();
  }
  // 3. The week held 10 s.
  const c3 = await themed(h, from, theme, viewport);
  await hold(c3, "**/api/action", isAction("week.load"), 10_000);
  const p3 = await c3.newPage();
  const t3 = Date.now();
  await p3.goto(h.url, { waitUntil: "commit" });
  await at(p3, `opening-3-loader-${tag}`, 1200, t3);
  if (full) {
    await at(p3, `opening-3b-loader-${tag}`, 1600, t3);
    await at(p3, `opening-4-eight-seconds-${tag}`, 8600, t3);
    // The move: frames every 100 ms or so from just before the release until the app is up.
    await p3.waitForTimeout(Math.max(0, t3 + 9_900 - Date.now()));
    for (let n = 0; n < 30; n++) {
      await p3.screenshot({ path: `${DIR}/opening-5-move-${tag}-${String(n).padStart(2, "0")}.png` });
      if (!(await p3.locator(".brand-stage").count())) break;
      await p3.waitForTimeout(60);
    }
    await opened(p3);
    await p3.waitForTimeout(600);
    await p3.screenshot({ path: `${DIR}/opening-6-app-${tag}.png` });
  }
  await c3.close();
}

/** From navigation to the app being usable (the overlay gone, the top bar up), with the week held `ms` (0: fast). */
async function timeOpening(h: Harness, from: Page, ms: number): Promise<number> {
  const ctx = await themed(h, from, THEMES[0]);
  if (ms) await hold(ctx, "**/api/action", isAction("week.load"), ms);
  await ctx.addInitScript(() => {
    const w = window as unknown as { __usable?: number };
    new MutationObserver(() => {
      if (w.__usable === undefined && document.querySelector(".topbar") && !document.querySelector(".brand-stage")) w.__usable = performance.now();
      else if (document.querySelector(".brand-stage")) w.__usable = undefined;
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  const page = await ctx.newPage();
  await page.goto(h.url);
  await opened(page);
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => (window as unknown as { __usable?: number }).__usable ?? -1);
  await ctx.close();
  return Math.round(t);
}

describe.skipIf(!CHROMIUM || !DIR)("BR-1 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    if (missed.length) console.log(`BR-1 shots not taken:\n${missed.join("\n")}`);
    if (DIR) writeFileSync(`${DIR}/missed.txt`, missed.join("\n") + "\n");
    for (const h of started) await h.stop();
  });

  it("the opening, the screens that held Lumen, and the opening's times", async () => {
    const h = await startDemo();
    started.push(h);
    const { page: base } = await freshPage(h, DESK);

    // The opening's times: fast (nothing held) and slow (the week held 1.5 s and 3 s), three runs each.
    const times: Record<string, number[]> = { fast: [], slow1500: [], slow3000: [] };
    for (let n = 0; n < (part("timings") ? 3 : 0); n++) {
      times.fast!.push(await timeOpening(h, base, 0));
      times.slow1500!.push(await timeOpening(h, base, 1500));
      times.slow3000!.push(await timeOpening(h, base, 3000));
    }
    if (part("timings")) writeFileSync(`${DIR}/timings.json`, JSON.stringify(times, null, 2) + "\n");

    for (const theme of THEMES) {
      const tag = theme[0];
      expectOk(await call(base, "ui.set_theme", { theme: theme[1] }));
      if (part("opening")) await openingFrames(h, base, theme, DESK, tag, true);
      if (part("screens")) await screens(h, base, theme);
      if (part("reconnect")) await reconnect(h, base, theme);
    }
    expectOk(await call(base, "ui.set_theme", { theme: "cooptimize-dark" }));
    // The phone's loader, dark.
    if (part("phone")) await openingFrames(h, base, THEMES[0], PHONE, "phone", false);
  }, T);
});

async function screens(h: Harness, base: Page, theme: (typeof THEMES)[number]) {
      const tag = theme[0];
      // Sign-in: no session.
      const signed = await h.browser.newContext({ viewport: DESK, colorScheme: tag });
      await signed.addInitScript((t) => localStorage.setItem("focustime.theme", t), theme[1]);
      const sp = await signed.newPage();
      await shot(sp, `signin-${tag}`, async () => {
        await sp.goto(h.url);
        await sp.getByRole("button", { name: /Try the demo/ }).waitFor({ timeout: 30_000 });
      });
      await signed.close();

      const ctx = await themed(h, base, theme);
      const page = await ctx.newPage();
      await openApp(page, h);
      await opened(page);
      await shot(page, `about-${tag}`, () => go(page, "#/settings/about", 1200));
      await shot(page, `guide-start-here-${tag}`, async () => {
        await go(page, "#/guide", 1500);
        await page.locator(".gs").waitFor({ timeout: 8000 });
      }, 1800);
      await shot(page, `guide-footer-${tag}`, async () => {
        await page.locator(".guide-footer").scrollIntoViewIfNeeded({ timeout: 8000 });
      });
      await shot(page, `tour-end-${tag}`, async () => {
        await go(page, "#/guide/tour/today", 1500);
        await page.locator(".tour-card").waitFor({ timeout: 15_000 });
        for (let n = 0; n < 25 && !(await page.locator(".tour-card.end").count()); n++) {
          await page.keyboard.press("ArrowRight");
          await page.waitForTimeout(250);
        }
        await page.locator(".tour-card.end").waitFor({ timeout: 5000 });
      }, 800);
      await page.keyboard.press("Escape");
      await shot(page, `empty-inbox-done-${tag}`, () => go(page, "#/inbox/done", 1500));
      // The end of Close out with every to-do today done (the moment before, Day after).
      await shot(page, `closeout-end-${tag}`, async () => {
        await go(page, "#/day", 800);
        const st = await call(page, "planday.start", { date: "2026-11-02" });
        for (const p of st.data.picks as { id: number; status: string }[]) if (p.status === "planned" || p.status === "done") await call(page, "pick.remove", { id: p.id });
        const add = await call(page, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", itemId: 4411, size: "S" });
        const w = await call(page, "week.load", {});
        const pick = w.data.plan["2026-11-02"].picks.find((p: { itemId: number }) => p.itemId === 4411);
        if (add.ok && pick) await call(page, "pick.mark_done", { id: pick.id, done: true });
        await page.reload();
        await opened(page);
        await go(page, "#/today/closeout", 1500);
        await page.waitForSelector(".closeout-panel .done-btn:enabled", { timeout: 15_000 });
        await page.locator(".closeout-panel .done-btn").click();
        // Before BR-1 the moment's line; after, Day itself.
        await Promise.race([page.getByText("All done. See you tomorrow.").waitFor({ timeout: 8000 }), page.waitForTimeout(2500)]);
        await page.waitForTimeout(900);
      }, 0);
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 15_000 }).catch(() => {});
      await ctx.close();
}

async function reconnect(h: Harness, base: Page, theme: (typeof THEMES)[number]) {
      const tag = theme[0];
      // Settings after a reconnect: Outlook down on load, then its Connect answered "connected".
      const rc = await themed(h, base, theme);
      await rc.route("**/api/action", async (route) => {
        const body = route.request().postData() ?? "";
        if (body.includes('"auth.connect_microsoft"')) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { status: "connected" } }) });
        if (body.includes('"week.load"')) {
          const r = await route.fetch();
          const j = await r.json();
          for (const s of j?.data?.sources ?? []) if (s.source === "outlook") Object.assign(s, { status: "auth_required", sample: false, fixAction: "connect_microsoft", cause: null, message: null });
          return route.fulfill({ response: r, body: JSON.stringify(j) });
        }
        return route.continue();
      });
      const rp = await rc.newPage();
      await shot(rp, `settings-reconnect-${tag}`, async () => {
        await openApp(rp, h);
        await opened(rp);
        await go(rp, "#/settings/connections", 1500);
        const btn = rp.locator("li.source button").filter({ hasText: /^(Reconnect|Connect)$/ }).first();
        await btn.click({ timeout: 8000 });
        await rp.getByText(/is connected again/).waitFor({ timeout: 8000 });
        await rp.getByText(/is connected again/).scrollIntoViewIfNeeded();
      }, 300);
      await rc.close();
}

function expectOk(r: { ok: boolean }) {
  if (!r.ok) missed.push(`an action failed: ${JSON.stringify(r).slice(0, 200)}`);
}
