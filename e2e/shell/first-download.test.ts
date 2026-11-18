// Was e2e/pf1.test.ts (PF-1) until BT-1.
// PF-1 (browser, demo mode, the app built as a release is): the first download holds Day and Week; every other screen loads when it
// is first opened. Each one opens from a cold start by click, by key and by address with the keyboard focus where it
// landed before the split (FOCUS below was read from the build before it; PF1_PROBE=1 prints what a build does).
// While a screen's file arrives the screen before it stays, "Loading…" shows only past 300 ms and nothing moves. A
// release that replaced the file reloads the app once onto the screen asked for; a file that still can't be had says
// so with Retry; a screen's own error is not mistaken for either. Offline, what was opened stays usable, and the
// installed app keeps every split file. The page has no inline script or style and the policy header is unchanged.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserContext, Page } from "playwright-core";
import { CHROMIUM, startDemo, type Harness } from "../harness.ts";
import { CSP } from "../../server/app.ts";

const PROBE = !!process.env.PF1_PROBE;
/** The app as a release builds it (the run's shared build is made in test mode: no service worker, React's development build). */
let DIST = "";
const VIEW = { width: 1440, height: 900 };

/** What has the keyboard focus, in words that don't depend on the build: its tag, first classes and label. */
const focusOf = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return "body";
    const cls = typeof a.className === "string" && a.className.trim() ? "." + a.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const label = a.getAttribute("aria-label") ?? a.getAttribute("placeholder");
    return `${a.tagName.toLowerCase()}${cls}${label ? `[${label.slice(0, 40)}]` : ""}`;
  });

type Way = { how: "key" | "click" | "address"; run: (page: Page) => Promise<void> };
const key = (k: string): Way => ({ how: "key", run: (p) => p.keyboard.press(k) });
const click = (sel: string): Way => ({ how: "click", run: (p) => p.locator(sel).first().click() });
const address = (hash: string): Way => ({ how: "address", run: async () => undefined, ...{ hash } }) as Way & { hash: string };
const tab = (name: string) => `.view-tab:has-text("${name}")`;

/** Each screen: how it is opened, what shows it is drawn, and where the focus lands (the same for every way unless said). */
const SCREENS: { name: string; shown: string; ways: Way[]; focus: Record<string, string>; before?: (page: Page) => Promise<void> }[] = [
  { name: "Day", shown: "main.today-view", ways: [key("1"), click(tab("Day")), address("#/day")], focus: { key: "div.half.focus[Mon Nov 2 AM, Cooptimize, at risk]", click: "button.view-tab", address: "div.half.focus[Mon Nov 2 AM, Cooptimize, at risk]" } },
  { name: "Week", shown: "main.grid", ways: [key("2"), click(tab("Week")), address("#/week")], focus: { key: "div.half.focus[Mon Nov 2 AM, Cooptimize, at risk]", click: "div.half.focus[Mon Nov 2 AM, Cooptimize, at risk]", address: "div.half.focus[Mon Nov 2 AM, Cooptimize, at risk]" } },
  { name: "Backlog", shown: "main.ahead", ways: [key("3"), click(tab("Backlog")), address("#/backlog")], focus: { key: "h2", click: "h2", address: "h2" } },
  { name: "Backlog's Gantt", shown: "main.ahead-gantt", ways: [address("#/backlog/gantt")], focus: { address: "h2" } },
  { name: "Status", shown: "main.status-view", ways: [key("4"), click(tab("Status")), address("#/status")], focus: { key: "body", click: "button.view-tab", address: "body" } },
  { name: "Inbox", shown: "main.ib4", ways: [key("5"), click(tab("Inbox")), address("#/inbox")], focus: { key: "body", click: "button.view-tab", address: "body" } },
  { name: "Code", shown: "main.code-page", ways: [key("6"), click(tab("Code")), address("#/code")], focus: { key: "body", click: "button.view-tab", address: "body" } },
  { name: "Settings", shown: "main.panel-shell.settings", ways: [key(","), click(".demo-tag"), address("#/settings")], focus: { key: "h2", click: "button.sp-btn.main", address: "h2" } },
  { name: "Admin", shown: "main.panel-shell.settings", ways: [address("#/settings/admin-clients")], focus: { address: "h2" } },
  { name: "the story card", shown: '[role="dialog"][aria-labelledby="sc-title"]', ways: [click("main.ahead a[data-card]"), address("#/item/Cooptimize/4411")], focus: { click: "h2", address: "h2" }, before: async (p) => void (await p.keyboard.press("3"), await p.waitForSelector("main.ahead a[data-card]")) },
  { name: "the New form", shown: ".cap-dialog.new-form", ways: [key("Shift+N")], focus: { key: "input[What is this feature?]" } },
  { name: "Capture", shown: '[role="dialog"][aria-label="Quick capture"]', ways: [key("n"), click(".capture-btn"), address("#/capture")], focus: { key: "textarea.text-box[Quick capture]", click: "textarea.text-box[Quick capture]", address: "textarea.text-box[Quick capture]" } },
  { name: "the assistant", shown: "aside.assistant-panel", ways: [key("Control+j"), click(".assistant-btn")], focus: { key: "textarea.text-box[Ask the assistant]", click: "textarea.text-box[Ask the assistant]" } },
  { name: "the Focus screen", shown: "main.focus-screen", ways: [address("#/focus")], focus: { address: "button.focus-btn.primary" } },
  { name: "the check-in", shown: "main.today-view.mode-checkin", ways: [key("m"), address("#/day/checkin")], focus: { key: "body", address: "body" } },
  { name: "Close out", shown: "main.today-view.mode-closeout", ways: [key("e"), address("#/day/closeout")], focus: { key: "h2", address: "h2" } },
  { name: "the Guide", shown: 'main.panel-shell[aria-label="Guide"]', ways: [key("?"), address("#/guide")], focus: { key: "h2", address: "h2" } },
  { name: "the Technical docs", shown: "main.panel-shell.tech-docs", ways: [address("#/docs")], focus: { address: "h2" } },
];

type LineLog = { keys: { key: string; t: number }[]; line: { on: boolean; t: number }[]; status: number | null };
/** A page on the demo with a session; `metered` makes the browser report a data-saving connection (nothing is fetched in the background). */
async function session(h: Harness, opts: { metered?: boolean; serviceWorkers?: "allow" | "block" } = {}): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await h.browser.newContext({ viewport: VIEW, serviceWorkers: opts.serviceWorkers ?? "block" });
  if (opts.metered) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "connection", { configurable: true, get: () => ({ saveData: true, effectiveType: "4g" }) }));
  await ctx.addInitScript(() => {
    try {
      if (localStorage.getItem("focustime.day.panel") === null) localStorage.setItem("focustime.day.panel", "closed");
    } catch {
      /* about:blank has no storage */
    }
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(h.url);
  await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
  await usable(page);
  return { ctx, page, errors };
}
async function usable(page: Page): Promise<void> {
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 60_000 });
}
/** The app opened again from nothing at an address (a cold start: every script is asked for again). */
async function cold(page: Page, h: Harness, hash: string): Promise<void> {
  await page.goto("about:blank");
  await page.goto(h.url + hash);
  await usable(page);
}

describe.skipIf(!CHROMIUM)("PF-1: the first download, split by screen (browser, demo mode, built app)", () => {
  let h: Harness;
  beforeAll(async () => {
    DIST = mkdtempSync(join(tmpdir(), "focustime-pf1-dist-"));
    const root = resolve(import.meta.dirname, "../..");
    const env = { node: process.env.NODE_ENV, dist: process.env.FOCUSTIME_E2E_DIST };
    process.env.NODE_ENV = "production";
    try {
      await build({ root, configFile: join(root, "vite.config.ts"), mode: "production", logLevel: "error", build: { outDir: DIST, emptyOutDir: true } });
      process.env.FOCUSTIME_E2E_DIST = DIST;
      h = await startDemo();
    } finally {
      process.env.NODE_ENV = env.node;
      if (env.dist === undefined) delete process.env.FOCUSTIME_E2E_DIST;
      else process.env.FOCUSTIME_E2E_DIST = env.dist;
    }
  }, 180_000);
  afterAll(async () => {
    await h?.stop();
    if (DIST) rmSync(DIST, { recursive: true, force: true });
  });

  it("every tab and screen opens from a cold start by click, by key and by address, with the focus where it lands today", async () => {
    const { ctx, page, errors } = await session(h);
    const seen: string[] = [];
    for (const s of SCREENS) {
      for (const w of s.ways) {
        const hash = (w as Way & { hash?: string }).hash;
        await cold(page, h, hash ?? "#/day");
        if (!hash) {
          await s.before?.(page);
          await w.run(page);
        }
        await page.waitForSelector(s.shown, { timeout: 30_000 }).catch(() => {
          throw new Error(`${s.name} didn't open by ${w.how}`);
        });
        await page.waitForTimeout(350);
        const focus = await focusOf(page);
        seen.push(`${s.name} | ${w.how} | ${focus}`);
        if (!PROBE) expect(`${s.name} by ${w.how}: ${focus}`).toBe(`${s.name} by ${w.how}: ${s.focus[w.how]}`);
      }
    }
    if (PROBE) process.stderr.write(seen.join("\n") + "\n");
    expect(errors).toEqual([]);
    await ctx.close();
  }, 600_000);

  it("the first screen asks for no other screen's file; the others are fetched in the background, or on a data-saving connection only on hover, focus or the key", async () => {
    const lazy = /\/assets\/(Ahead|Status|InboxPage|Code|StoryCard|Capture|Assistant|Checkin|CloseOut|FocusScreen|NewItem|DraftEditor|Settings|Guide|Tour|TechDocs|shared|guide-text)-[^/]+\.js$/;
    // An ordinary connection: nothing before the first screen is usable, then the tabs' files without being asked.
    const a = await session(h);
    const asked: string[] = [];
    // The moment Day is drawn, on the page's own clock.
    await a.ctx.addInitScript(() => {
      const seen = () => document.querySelector("main.today-view") && ((window as unknown as { pf1Day?: number }).pf1Day ??= performance.now());
      new MutationObserver(seen).observe(document, { childList: true, subtree: true });
    });
    await a.page.goto("about:blank");
    // Listening from here: the session's first page may still have been fetching in the background.
    a.page.on("request", (r) => lazy.test(r.url()) && asked.push(r.url().replace(/.*\/assets\//, "").replace(/-.*/, "")));
    await a.page.goto(h.url + "#/day");
    await usable(a.page);
    await expect.poll(() => ["Ahead", "Status", "InboxPage", "Code", "Capture", "Settings"].every((n) => asked.includes(n)), { timeout: 30_000 }).toBe(true);
    const early = await a.page.evaluate(() => {
      const day = (window as unknown as { pf1Day?: number }).pf1Day ?? 0;
      return { day, before: performance.getEntriesByType("resource").filter((r) => /\/assets\/(?!main-|index-|boot-|rolldown-runtime-)[^/]+\.js$/.test(r.name) && r.startTime < day).map((r) => r.name.replace(/.*\/assets\//, "")) };
    });
    expect(early.day).toBeGreaterThan(0);
    expect(early.before, "asked for before Day was drawn").toEqual([]);
    // In the tabs' order.
    expect(asked.filter((n) => ["Ahead", "Status", "InboxPage", "Code"].includes(n))).toEqual(["Ahead", "Status", "InboxPage", "Code"]);
    expect(asked, "the Guide and the Technical docs wait to be opened").not.toContain("TechDocs");
    // Each file once.
    expect(asked.filter((n, i) => asked.indexOf(n) !== i), "asked for twice").toEqual([]);
    await a.ctx.close();

    // A data-saving connection: nothing until a tab is pointed at.
    const b = await session(h, { metered: true });
    const asked2: string[] = [];
    await b.page.goto("about:blank");
    b.page.on("request", (r) => lazy.test(r.url()) && asked2.push(r.url().replace(/.*\/assets\//, "").replace(/-.*/, "")));
    await cold(b.page, h, "#/day");
    await b.page.waitForTimeout(2500);
    expect(asked2).toEqual([]);
    await b.page.locator(tab("Status")).hover();
    await expect.poll(() => asked2.includes("Status")).toBe(true);
    await b.page.locator(tab("Inbox")).focus();
    await expect.poll(() => asked2.includes("InboxPage")).toBe(true);
    expect(asked2).not.toContain("Ahead");
    await b.page.keyboard.press("3");
    await b.page.waitForSelector("main.ahead");
    expect(asked2).toContain("Ahead");
    await b.ctx.close();
  }, 180_000);

  it("a slow file: the screen before it stays, Loading shows only past the delay, and nothing moves", async () => {
    const { ctx, page, errors } = await session(h, { metered: true });
    // FT-1: one route, set before any page below fetches a screen and never added or removed while one is open (see the
    // release test). `slow` names the file held back and what lets it go.
    let slow: { file: string; held: Promise<void> } | null = null;
    const holdBack = (file: string) => {
      let go: () => void = () => {};
      slow = { file, held: new Promise<void>((r) => (go = r)) };
      return go;
    };
    await page.route("**/assets/*.js", async (route) => {
      const s = slow;
      if (s && route.request().url().includes(`/assets/${s.file}-`)) await s.held;
      await route.fallback();
    });
    // FT-1: each key pressed and each time the line came or went, on the page's own clock, so "past 300 ms" is read
    // where it happens and not by when this process gets to look.
    await page.addInitScript(() => {
      const log: LineLog = { keys: [], line: [], status: null };
      (window as unknown as { __lineLog: LineLog }).__lineLog = log;
      addEventListener("keydown", (e) => log.keys.push({ key: e.key, t: performance.now() }), true);
      let on = false;
      new MutationObserver(() => {
        const now = !!document.querySelector(".screen-line");
        if (now !== on) (on = now), log.line.push({ on, t: performance.now() });
        if (log.status === null && document.querySelector("main.status-view")) log.status = performance.now();
      }).observe(document, { childList: true, subtree: true });
    });
    const lineLog = () => page.evaluate(() => (window as unknown as { __lineLog: LineLog }).__lineLog);
    /** After the last press of `key`: how long until the line first showed (null if it didn't), on the page's clock. */
    const lineAfter = async (key: string) => {
      const log = await lineLog();
      const at = log.keys.filter((k) => k.key === key).at(-1)!.t;
      const shown = log.line.find((l) => l.on && l.t >= at);
      return { line: shown ? shown.t - at : null, status: log.status === null ? null : log.status - at };
    };
    const release = holdBack("Ahead");
    await cold(page, h, "#/day");
    const box = async (sel: string) => JSON.stringify(await page.locator(sel).first().boundingBox());
    const before = { top: await box(".topbar"), day: await box("main.today-view"), tabs: await box(".views") };
    await page.keyboard.press("3");
    // At once: Day is still there and its tab still the current one (the file is held, so this can't change yet).
    await page.waitForTimeout(120);
    expect(await page.locator("main.today-view").count()).toBe(1);
    expect(await page.locator('.view-tab[aria-current="page"]').textContent()).toContain("Day");
    // Past 300 ms, and not before: the line, said to screen readers too; Day is where it was.
    const line = page.locator(".screen-line");
    await line.waitFor({ timeout: 5000 });
    expect((await lineAfter("3")).line).toBeGreaterThanOrEqual(299);
    expect(await line.textContent()).toBe("Loading…");
    expect(await line.getAttribute("role")).toBe("status");
    expect({ top: await box(".topbar"), day: await box("main.today-view"), tabs: await box(".views") }).toEqual(before);
    expect(await page.locator("main.ahead").count()).toBe(0);
    // Day still answers while it waits.
    expect(await page.locator("main.today-view").getAttribute("inert")).toBeNull();
    // The file arrives: Backlog, and the line is gone.
    release();
    await page.waitForSelector("main.ahead");
    expect(await page.locator(".screen-line").count()).toBe(0);
    expect(await page.locator("main.today-view").count()).toBe(0);
    expect(await page.evaluate(() => location.hash)).toBe("#/backlog");
    expect(await box(".topbar")).toBe(before.top);

    // A fast file never shows the line: Status (not held) drawn inside the delay means no line; drawn later (a busy
    // machine), the line may show, but only past the delay.
    await page.keyboard.press("4");
    await page.waitForSelector("main.status-view");
    // Read once the page's own clock is past the delay with Status drawn: no line can come after that.
    await page.waitForFunction(() => {
      const log = (window as unknown as { __lineLog: LineLog }).__lineLog;
      const key = log.keys.filter((k) => k.key === "4").at(-1);
      return !!key && log.status !== null && performance.now() - key.t >= 320;
    }, null, { polling: "raf" });
    const fast = await lineAfter("4");
    expect(fast.status).not.toBeNull();
    if (fast.status! < 300) expect(fast.line, `Status drawn after ${Math.round(fast.status!)} ms`).toBeNull();
    else if (fast.line !== null) {
      // A busy machine: the line only past the delay, only while Status wasn't drawn yet, and gone once it was.
      expect(fast.line).toBeGreaterThanOrEqual(299);
      expect(fast.status!, "the line showed after Status was drawn").toBeGreaterThanOrEqual(fast.line);
      expect(await page.locator(".screen-line").count()).toBe(0);
    }

    // A dialog the same way: Capture's file is slow, the screen stays, Esc takes the ask back.
    const let2 = holdBack("Capture");
    await page.keyboard.press("n");
    await line.waitFor({ timeout: 5000 });
    expect(await page.locator("main.status-view").count()).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".screen-line").count()).toBe(0);
    let2();
    await page.waitForTimeout(300);
    expect(await page.getByRole("dialog", { name: "Quick capture" }).count()).toBe(0);
    await page.keyboard.press("n");
    await page.getByRole("dialog", { name: "Quick capture" }).waitFor();
    await page.keyboard.press("Escape");

    // N and typing at once while the file is slow: nothing typed is lost, and none of it runs as a shortcut on the
    // screen behind (the w, the 3 and the e would each have gone somewhere).
    const let3 = holdBack("Capture");
    await cold(page, h, "#/week");
    await page.keyboard.press("n");
    await page.keyboard.type("Call Dana about the w3 export", { delay: 15 });
    expect(await page.locator("main.grid").count()).toBe(1);
    expect(await page.evaluate(() => location.hash)).toBe("#/week");
    let3();
    const cap = page.getByRole("dialog", { name: "Quick capture" });
    await cap.waitFor();
    const capBox = cap.getByRole("textbox", { name: "Quick capture" });
    await expect.poll(() => capBox.inputValue()).toBe("Call Dana about the w3 export");
    await page.keyboard.type(" today");
    expect(await capBox.inputValue()).toBe("Call Dana about the w3 export today");
    expect(errors).toEqual([]);
    await ctx.close();
  }, 180_000);

  it("a release replaced a screen's file: one reload onto the screen asked for; a file truly missing says so with Retry; a screen's own error is neither", async () => {
    // PF-2: the server answers a file it no longer has with "not found" (nothing worth keeping, nothing kept). An older
    // server answered with the page itself, which is not a script: both are covered below.
    const html = await (await fetch(h.url)).text();
    const asPage = { status: 200, contentType: "text/html", body: html };
    const gone404 = await fetch(new URL("/assets/Ahead-no-such-build.js", h.url));
    expect([gone404.status, gone404.headers.get("cache-control"), await gone404.text()]).toEqual([404, "no-store", ""]);
    const asMissing = { status: 404, contentType: "text/plain; charset=utf-8", headers: { "cache-control": "no-store" }, body: "" };
    const { ctx, page, errors } = await session(h, { metered: true });
    // FT-1: what the server sends for a screen's file is decided by one route, set before any page below fetches a
    // screen, and never added or removed while a page is open. A route added to a page already open let that page's
    // next screen file through now and then under load: Chromium fetched the real file and Playwright saw no request
    // (docs/open-questions.md, FT-1). `serve` says what the file answers. The old page is told by the page itself (a
    // mark set after the cold start, which a reload clears), not by counting load events: the new page can ask for the
    // file before Playwright reports its load.
    // FT-1: the page counts its own documents (an init script runs at the start of each, before the app's scripts), so
    // a reload is counted before the new page can draw anything; Playwright's load event could come after that.
    await page.addInitScript(() => {
      try {
        if (location.protocol.startsWith("http")) sessionStorage.setItem("ft1Loads", String(Number(sessionStorage.getItem("ft1Loads") ?? 0) + 1));
      } catch {}
    });
    const loads = () => page.evaluate(() => Number(sessionStorage.getItem("ft1Loads") ?? 0));
    let at = 0;
    const reloads = async () => (await loads()) - at;
    type Answer = { status: number; contentType: string; headers?: Record<string, string>; body: string };
    let serve: { file: string; answer: Answer; oldPageOnly: boolean } | null = null;
    await page.route("**/assets/*.js", async (route) => {
      const file = /\/assets\/([A-Za-z]+)-[^/]*\.js$/.exec(route.request().url())?.[1];
      if (!serve || file !== serve.file) return route.fallback();
      if (serve.oldPageOnly && !(await route.request().frame().evaluate(() => "__ft1Old" in window).catch(() => false))) return route.fallback();
      return route.fulfill(serve.answer);
    });
    /** The app opened from nothing, with the release already in place for the file named (so no fetch can beat it). */
    const coldWith = async (hash: string, s: typeof serve) => {
      serve = s;
      await cold(page, h, hash);
      await page.evaluate(() => void Object.assign(window, { __ft1Old: true }));
      at = await loads();
    };

    // The old page's file is gone; after the reload the new page's file is there.
    await coldWith("#/day", { file: "Ahead", answer: asMissing, oldPageOnly: true });
    await page.keyboard.press("3");
    await page.waitForSelector("main.ahead", { timeout: 30_000 });
    expect(await reloads()).toBe(1);
    expect(await page.evaluate(() => location.hash)).toBe("#/backlog");
    expect(await page.locator(".screen-line").count()).toBe(0);

    // Capture asked for across a release: the reload opens it again.
    await coldWith("#/week", { file: "Capture", answer: asPage, oldPageOnly: true });
    await page.keyboard.press("n");
    await page.getByRole("dialog", { name: "Quick capture" }).waitFor({ timeout: 30_000 });
    expect(await reloads()).toBe(1);
    expect(await page.locator("main.grid").count()).toBe(1);
    await page.keyboard.press("Escape");

    // Truly missing: one reload, never a second, then the line with Retry over a screen that works.
    await coldWith("#/day", { file: "Status", answer: asMissing, oldPageOnly: false });
    await page.keyboard.press("4");
    const failed = page.locator(".screen-line.failed");
    await failed.waitFor({ timeout: 30_000 });
    expect(await reloads()).toBe(1);
    expect(await failed.textContent()).toBe("This screen didn't load. Retry");
    expect(await failed.getAttribute("role")).toBe("alert");
    expect(await page.locator("main.today-view").count()).toBe(1);
    expect(await page.locator(".topbar").count()).toBe(1);
    await page.waitForTimeout(1500);
    expect(await reloads(), "no reload loop").toBe(1);
    // Another tab still opens, and the line goes with the ask.
    await page.keyboard.press("2");
    await page.waitForSelector("main.grid");
    expect(await page.locator(".screen-line").count()).toBe(0);
    // Asked again while still missing: the line, with no reload this time.
    await page.keyboard.press("4");
    await failed.waitFor({ timeout: 30_000 });
    expect(await reloads()).toBe(1);
    // Retry while it is still missing: one more reload for that press, then the line again, and no loop.
    await failed.getByRole("button", { name: "Retry" }).click();
    await expect.poll(reloads, { timeout: 30_000 }).toBe(2);
    await failed.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    expect(await reloads()).toBe(2);
    // Retry once it is back: the screen (this browser remembers the failed file, so Retry's reload fetches it fresh).
    serve = null;
    await failed.getByRole("button", { name: "Retry" }).click();
    await page.waitForSelector("main.status-view", { timeout: 30_000 });
    expect(await page.locator(".screen-line").count()).toBe(0);
    expect(await page.evaluate(() => location.hash)).toBe("#/status");
    expect(errors).toEqual([]);

    // The screen's own code throws: no reload, no "didn't load" line; the error is reported as any other is.
    await coldWith("#/day", { file: "InboxPage", answer: { status: 200, contentType: "text/javascript", body: 'throw new Error("pf1 boom");' }, oldPageOnly: false });
    await page.keyboard.press("5");
    await expect.poll(() => errors.some((e) => e.includes("pf1 boom")), { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(800);
    expect(await reloads()).toBe(0);
    expect(await page.locator(".screen-line.failed").count()).toBe(0);
    expect(await page.locator("main.today-view").count()).toBe(1);
    await ctx.close();
  }, 240_000);

  it("a release after a screen's file was fetched in the background: the screen opens from the copy the page holds, with no reload and no request", async () => {
    // FT-1, STEP 0.4: the page keeps the module it fetched (the same build as the rest of the open app), so the
    // release doesn't reach this page until it is next opened or reloaded. That is what it should do: the screen and
    // the app around it stay one build.
    const asMissing = { status: 404, contentType: "text/plain; charset=utf-8", headers: { "cache-control": "no-store" }, body: "" };
    const { ctx, page, errors } = await session(h);
    let released = false;
    const asked: string[] = [];
    await page.route("**/assets/*.js", (route) => {
      if (!/\/assets\/Ahead-/.test(route.request().url())) return route.fallback();
      asked.push(released ? "after" : "before");
      return released ? route.fulfill(asMissing) : route.fallback();
    });
    await cold(page, h, "#/day");
    // This document, marked: a reload would be a new one without the mark.
    await page.evaluate(() => void Object.assign(window, { __ft1Doc: true }));
    // The background fetching is done (ui/screens.ts says so on the page), Backlog's file among it.
    await page.waitForSelector("html[data-screens=in]", { timeout: 60_000 });
    expect(asked).toEqual(["before"]);
    released = true;
    await page.keyboard.press("3");
    await page.waitForSelector("main.ahead", { timeout: 30_000 });
    expect(await page.locator(".screen-line").count()).toBe(0);
    expect(await page.evaluate(() => "__ft1Doc" in window), "no reload").toBe(true);
    expect(asked, "the file isn't asked for again").toEqual(["before"]);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it("offline: Day and Week open, a tab opened earlier opens, one never fetched says it needs a connection; the installed app keeps every split file", async () => {
    // In a browser tab with no worker, on a data-saving connection (so nothing was fetched ahead).
    const a = await session(h, { metered: true });
    await cold(a.page, h, "#/day");
    await a.page.keyboard.press("5");
    await a.page.waitForSelector("main.ib4");
    await a.page.keyboard.press("1");
    await a.page.waitForSelector("main.today-view");
    await a.ctx.setOffline(true);
    await a.page.keyboard.press("2");
    await a.page.waitForSelector("main.grid");
    await a.page.keyboard.press("1");
    await a.page.waitForSelector("main.today-view");
    await a.page.keyboard.press("5");
    await a.page.waitForSelector("main.ib4");
    await a.page.keyboard.press("4");
    const failed = a.page.locator(".screen-line.failed");
    await failed.waitFor({ timeout: 30_000 });
    expect(await failed.textContent()).toBe("This screen needs a connection the first time it opens. Retry");
    // The app's own line says it is offline, once.
    expect(await a.page.locator(".offline-line").textContent()).toBe("You're offline. FocusTime needs a connection.");
    expect(await a.page.locator("main.ib4").count()).toBe(1);
    // At a phone's width the line wraps inside the screen and Retry can be reached.
    await a.page.setViewportSize({ width: 390, height: 844 });
    // The phone's layout draws the line again: wait for its box itself, not only for the line (VM-4: it raced in CI).
    let box: { x: number; width: number } | null = null;
    await expect.poll(async () => (box = await failed.boundingBox()) !== null, { timeout: 10_000 }).toBe(true);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    let retry: { x: number; width: number } | null = null;
    await expect.poll(async () => (retry = await failed.getByRole("button", { name: "Retry" }).boundingBox()) !== null, { timeout: 10_000 }).toBe(true);
    retry = retry!;
    expect(retry.x + retry.width).toBeLessThanOrEqual(390);
    await a.page.setViewportSize(VIEW);
    await failed.waitFor();
    // Back online, Retry opens it; nothing reloaded.
    await a.ctx.setOffline(false);
    await failed.getByRole("button", { name: "Retry" }).click();
    await a.page.waitForSelector("main.status-view", { timeout: 30_000 });
    await a.ctx.close();

    // Installed (the service worker in charge): every file the build wrote is kept, the split files among them, in
    // one cache named for the build; a tab never opened opens offline.
    const b = await session(h, { metered: true, serviceWorkers: "allow" });
    await b.page.evaluate(() => navigator.serviceWorker.ready);
    const kept = async () => b.page.evaluate(async () => Object.fromEntries(await Promise.all((await caches.keys()).map(async (k) => [k, (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)] as const))));
    await expect.poll(async () => Object.values(await kept()).flat().length, { timeout: 60_000 }).toBeGreaterThan(30);
    const caches1 = await kept();
    expect(Object.keys(caches1).length, "one cache, one release").toBe(1);
    const files = Object.values(caches1)[0]!;
    for (const n of ["main", "shared", "Ahead", "Status", "InboxPage", "Code", "StoryCard", "Capture", "Assistant", "Checkin", "CloseOut", "FocusScreen", "NewItem", "DraftEditor", "Settings", "Guide", "TechDocs"])
      expect(files.some((f) => new RegExp(`^/assets/${n}-[^/]+\\.js$`).test(f)), `${n}'s file is kept`).toBe(true);
    // Never anything but the app's own files.
    expect(files.filter((f) => /^\/(api|auth|media)\//.test(f))).toEqual([]);
    await b.page.reload();
    await usable(b.page);
    expect(await b.page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await b.ctx.setOffline(true);
    await b.page.keyboard.press("2");
    await b.page.waitForSelector("main.grid");
    await b.page.keyboard.press("4");
    await b.page.waitForSelector("main.status-view", { timeout: 30_000 });
    expect(await b.page.locator(".screen-line.failed").count()).toBe(0);
    await b.ctx.close();
  }, 240_000);

  it("the built page has no inline script or style, and the policy header is unchanged", async () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    expect(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? []).toEqual([]);
    expect(html.match(/<style\b/g) ?? []).toEqual([]);
    expect(html.match(/\sstyle="/g) ?? []).toEqual([]);
    expect(html.match(/\son[a-z]+="/g) ?? []).toEqual([]);
    const res = await fetch(h.url);
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(CSP).toBe("default-src 'self'; img-src 'self' data: blob:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    // Opening screens that bring their own styles breaks no rule of the policy.
    const { ctx, page } = await session(h);
    const broken: string[] = [];
    page.on("console", (m) => /Content Security Policy/i.test(m.text()) && broken.push(m.text()));
    for (const k of ["3", "5", "6", ",", "Escape", "?"]) (await page.keyboard.press(k), await page.waitForTimeout(400));
    expect(broken).toEqual([]);
    await ctx.close();
    expect(existsSync(join(DIST, "index.html"))).toBe(true);
  }, 120_000);
});
