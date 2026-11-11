// Browser tests (step 15.2): a throwaway FocusTime server in demo mode (fictional data, in-memory store, nothing
// fetched), its own XDG dirs and port, the clock pinned to Monday Nov 2, 2026 9:30 AM, the UI through Vite in the
// server (no build). Chromium from the system (playwright-core, already a dev dependency), or Playwright's WebKit
// behind a local TLS proxy. Never touches the real config, plan store, cache or the running service.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer as createHttps } from "node:https";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Locator, type Page } from "playwright-core";
import { onFreePort } from "../test/ports.ts";

export const CHROMIUM = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((p) => existsSync(p)) ?? null;
/**
 * Playwright's WebKit (Safari's engine), for the Safari checks: installed with `npx playwright-core install --with-deps
 * webkit` (CI installs the system packages with `install-deps` and keeps the browser and those packages in its cache,
 * keyed on the Playwright version). Its build needs Ubuntu's libraries; FOCUSTIME_TEST_WEBKIT=required makes a missing
 * one a failure.
 */
export const WEBKIT = existsSync(webkit.executablePath()) ? webkit.executablePath() : null;
export const NOW = "2026-11-02T09:30:00-05:00";
/** AS-1: Chromium's fake microphone, granted without a prompt (push-to-talk tests). */
export const FAKE_MIC = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];

/**
 * An https://localhost front for the server, for WebKit: it keeps no Secure cookie over http (Chromium does on
 * localhost), and the session cookies are __Host- (Secure). A self-signed certificate made for this run in the test's
 * temp dir (pages open with ignoreHTTPSErrors); requests and websocket upgrades pass through unchanged.
 */
async function tlsFront(dir: string, port: number, target: number): Promise<() => void> {
  const key = join(dir, "tls.key");
  const cert = join(dir, "tls.crt");
  if (!existsSync(cert)) execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  const server = createHttps({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    const up = request({ host: "127.0.0.1", port: target, method: req.method, path: req.url, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => res.destroy());
    req.pipe(up);
  });
  server.on("upgrade", (req, socket, head) => {
    const up = connect(target, "127.0.0.1", () => {
      const lines = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
      up.write(head);
      up.pipe(socket).on("error", () => up.destroy());
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", ok);
  });
  return () => server.close();
}

/**
 * A built UI registers the service worker (ui/pwa.ts, production only); Vite's dev UI never does. Every context the
 * tests open blocks it, so a built run behaves like the dev one and no test depends on a cached shell.
 */
function noServiceWorkers(b: Browser): Browser {
  const newContext = b.newContext.bind(b);
  const newPage = b.newPage.bind(b);
  b.newContext = (o = {}) => newContext({ serviceWorkers: "block", ...o });
  b.newPage = (o = {}) => newPage({ serviceWorkers: "block", ...o });
  return b;
}

/** `gone`: why the demo server isn't running any more, when the test didn't stop it (TX-1c). */
export type Harness = { url: string; browser: Browser; pid: number; gone: () => string | null; stop: () => Promise<void> };

/**
 * Starts a demo server in its own temp folder (XDG dirs) on a free port. The port is picked by the OS; if another test
 * takes it before the server listens (the server then exits with "already running on port"), it starts again on a new
 * one (test/ports.ts). WebKit's TLS front gets its port the same way; the server's public URL names that front.
 */
/** `clock` pins the server and the page to another instant than NOW (UI-B: a day mid-week). */
export async function startDemo(engine: "chromium" | "webkit" = "chromium", extraEnv: Record<string, string> = {}, clock: string = NOW, /** AS-1: extra Chromium flags (the fake microphone). */ browserArgs: string[] = [], /** UI-10: draw scrollbars (Playwright hides them in headless Chromium), to measure them. */ opts: { showScrollbars?: boolean } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "focustime-e2e-"));
  // A2: no sign-in is set up here; the sign-in page offers "Try the demo", which every test uses.
  await mkdir(join(dir, "data", "focustime"), { recursive: true });
  const root = resolve(import.meta.dirname, "..");
  const launch = join(dir, "run", "focustime", "launch.json");
  const startServer = async (port: number, front: number | null) => {
    const env = { ...process.env, ...(front ? { FOCUSTIME_PUBLIC_URL: `https://localhost:${front}` } : {}), FOCUSTIME_DEMO: "1", XDG_CONFIG_HOME: join(dir, "config"), XDG_DATA_HOME: join(dir, "data"), XDG_CACHE_HOME: join(dir, "cache"), XDG_RUNTIME_DIR: join(dir, "run"), ...extraEnv };
    // A UI built once for the whole run (test/e2e-build.ts) when there is one; Vite in the server otherwise.
    const built = process.env.FOCUSTIME_E2E_DIST && process.env.FOCUSTIME_E2E_DIST !== "dev" ? process.env.FOCUSTIME_E2E_DIST : null;
    if (built) Object.assign(env, { FOCUSTIME_DIST: built });
    // --port first (TX-1c): a cleanup elsewhere on the machine by pattern ("pkill -f 'server/main.ts --no-open ...'",
    // for a script's own servers) stopped every run's demo servers; see docs/technical/development.md.
    const child: ChildProcess = spawn(process.execPath, ["server/main.ts", "--port", String(port), ...(built ? [] : ["--dev"]), "--no-open", "--no-reopen", "--headless", "--clock", clock], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (b) => (out += b));
    child.stderr?.on("data", (b) => (out += b));
    for (let i = 0; i < 300 && !existsSync(launch); i++) {
      if (child.exitCode !== null) throw new Error(`server exited: ${out.slice(-500)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!existsSync(launch)) {
      child.kill("SIGTERM");
      throw new Error(`server did not start in 30 s: ${out.slice(-500)}`);
    }
    return { child, port, url: (JSON.parse(await readFile(launch, "utf8")) as { url: string }).url };
  };
  let closeFront = () => {};
  let server: Awaited<ReturnType<typeof startServer>>;
  if (engine === "webkit") {
    // The front's port first (the server's public URL names it), then the server, then the front on that port.
    ({ server, closeFront } = await onFreePort(async (front) => {
      const s = await onFreePort((port) => startServer(port, front));
      try {
        return { server: s, closeFront: await tlsFront(dir, front, s.port) };
      } catch (e) {
        s.child.kill("SIGTERM");
        await rm(launch, { force: true });
        throw e;
      }
    }));
  } else server = await onFreePort((port) => startServer(port, null));
  const launched = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: CHROMIUM!, args: ["--disable-gpu", ...browserArgs], ...(opts.showScrollbars ? { ignoreDefaultArgs: ["--hide-scrollbars"] } : {}) });
  const browser = noServiceWorkers(launched);
  let stopping = false;
  let gone: string | null = null;
  server.child.once("exit", (code, signal) => {
    if (!stopping) gone = `The demo server on port ${server.port} stopped during the test (exit code ${code}, signal ${signal}). Exit code 0 means it was sent SIGTERM from outside this test: look for a kill by pattern elsewhere on this machine (docs/technical/development.md).`;
  });
  return {
    url: `${server.url}?now=${encodeURIComponent(clock)}`,
    browser,
    pid: server.child.pid!,
    gone: () => gone,
    stop: async () => {
      stopping = true;
      await browser.close().catch(() => {});
      closeFront();
      server.child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 200));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** A fresh page in its own browser context: the sign-in page, then "Try the demo" (a new demo session, a fresh store). */
export async function freshPage(h: Harness, viewport = { width: 1920, height: 1080 }): Promise<{ page: Page; errors: string[] }> {
  const page = await h.browser.newPage({ viewport });
  const errors: string[] = [];
  // Vite's dev client reports its websocket (HMR is off in the server): not an app error.
  page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("focustime.hint.flow", "dismissed");
    localStorage.setItem("focustime.hint.picktime", "1");
  });
  if (h.gone()) throw new Error(h.gone()!);
  await page.goto(h.url);
  await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
  await page.waitForSelector(".demo-tag", { timeout: 30_000 });
  // Step 17.5: a slow first load plays the opening over the app; tests start once it's gone.
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
  return { page, errors };
}

/**
 * WD-1 review: the timeline is off by default (Cards). Tests about the hour rail turn it on for their session, then
 * reload so the page shows it.
 */
export async function timelineOn(page: Page, on = true): Promise<void> {
  const ok = await page.evaluate((v) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "ui.set_show_timelines", input: { show: v } }) }).then((r) => r.ok), on);
  if (!ok) throw new Error("couldn't set the timeline");
  const at = page.url();
  await page.reload();
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
  if (page.url() !== at) await page.goto(at);
}

/**
 * WD-1 review: Add work keeps To place folded to one line (open only from the notice's Review) and You sent at the
 * bottom folded. Opens both, once the panel has its sections.
 */
export async function unfoldAddWork(page: Page): Promise<void> {
  const panel = page.locator("aside.add-work-panel");
  await panel.locator(".aw-toplace-line, .aw-sends > .pl-fold").first().waitFor({ timeout: 30_000 });
  for (const sel of [".aw-toplace-line", ".aw-sends > .pl-fold"]) {
    const b = panel.locator(sel).first();
    if ((await b.count()) && (await b.getAttribute("aria-expanded")) === "false") await b.click();
  }
}

/**
 * Opens FocusTime in this page: the app if its context already has a session, else the sign-in page and "Try the
 * demo". Returns once the app is up (the opening may still be playing).
 */
export async function openApp(page: Page, h: Harness): Promise<void> {
  await page.goto(h.url);
  const demo = page.getByRole("button", { name: /Try the demo/ });
  // The app (or its opening) means a session; the sign-in page means none.
  await Promise.race([page.waitForSelector(".topbar, .brand-stage", { timeout: 60_000 }), demo.waitFor({ timeout: 60_000 })]);
  if (await demo.count()) await demo.click();
}

/** A new window on the same session (its cookies, nothing stored locally), like opening FocusTime again. */
export async function sameSession(h: Harness, page: Page, opts: Parameters<Browser["newContext"]>[0] = { viewport: { width: 1920, height: 1080 } }) {
  const ctx = await h.browser.newContext(opts);
  await ctx.addCookies(await page.context().cookies());
  return ctx;
}

/** WD-1: Week with the Add work panel on today's first block that can take work (P from anywhere but Ahead). */
export async function openPlanDay(page: Page): Promise<void> {
  await page.keyboard.press("2");
  await page.keyboard.press("p");
  await page.locator("aside.add-work-panel").waitFor();
}

/** WD-1: moves the open Add work panel to today's (Monday's) block for this client: a click on its card. */
export async function selectBlock(page: Page, client: string, date = "2026-11-02"): Promise<void> {
  await page.locator(`[data-drop^="${date}:"]`, { has: page.locator(".card-client", { hasText: client }) }).first().locator(".card-client").first().click();
  await page.locator("aside.add-work-panel .aw-title", { hasText: client }).waitFor();
}

/** WD-1: the titles of the to-dos on that client's Week card on a day (Monday by default). */
export const blockPicks = (page: Page, client: string, date = "2026-11-02") => page.locator(`[data-drop^="${date}:"]`, { has: page.locator(".card-client", { hasText: client }) }).locator(".pr-title").allTextContents();

/** Step 16.2: Settings is in the initials menu (Settings, Sign out). */
export async function openSettings(page: Page): Promise<void> {
  await page.locator(".person-chip").click();
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
}

/** ST-1: a Settings section from the rail, by its id (ui/settings/registry.ts); waits for its header. */
export async function settingsSection(page: Page, id: string): Promise<void> {
  await page.locator(`.ps-rail [data-settings-section="${id}"]`).first().click();
  await page.locator(`.ps-rail [data-settings-section="${id}"][aria-current="page"]`).first().waitFor();
}

/** ST-1: one client's own page in Settings › Clients (from its row). */
export async function settingsClient(page: Page, name: string): Promise<void> {
  await settingsSection(page, "clients");
  await page.locator(".set-client-row", { hasText: name }).first().click();
  await page.locator(".ps-head h2", { hasText: name }).waitFor();
}

/** UI-7: Inbox › Captures (the capture box, follow-ups and drafts): 5 (RF-1), then its segment in the Inbox's mode switch. */
export async function openCaptures(page: Page): Promise<void> {
  // IB-1: one Inbox with views; Captures and drafts holds the capture box, promises I added and drafts.
  await page.keyboard.press("5");
  await page.evaluate(() => (location.hash = "#/inbox/captures"));
  await page.locator(".ib-capture").waitFor();
}

/** IB-1: the Inbox on one view (needs-you, promises, waiting, in-progress, captures, teammates, done, chatter). */
export async function openInboxView(page: Page, slug: string): Promise<Locator> {
  await page.evaluate((s) => (location.hash = `#/inbox/${s}`), slug);
  const main = page.getByRole("main", { name: "Inbox" });
  await main.waitFor();
  return main;
}

/** IB-1: opens the row whose title matches in the Inbox list; returns the detail pane. */
export async function openInboxItem(page: Page, title: string | RegExp): Promise<Locator> {
  const row = page.locator(".ib-row", { has: page.locator(".ib-row-title", { hasText: title }) }).first();
  await row.waitFor();
  await row.click();
  const pane = page.locator(".ib-pane");
  await pane.locator(".ib-detail-title", { hasText: title }).first().waitFor();
  return pane;
}
