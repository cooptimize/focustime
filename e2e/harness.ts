// Browser tests (step 15.2): a throwaway Coopilot server in demo mode (fictional data, in-memory store, nothing
// fetched), its own XDG dirs and port, the clock pinned to Monday Nov 2, 2026 9:30 AM, the UI through Vite in the
// server (no build). Chromium from the system (playwright-core, already a dev dependency). Never touches the real
// config, plan store, cache or the running service.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

export const CHROMIUM = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((p) => existsSync(p)) ?? null;
export const NOW = "2026-11-02T09:30:00-05:00";

const freePort = () =>
  new Promise<number>((ok, fail) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => (a && typeof a === "object" ? ok(a.port) : fail(new Error("no port"))));
    });
  });

export type Harness = { url: string; browser: Browser; stop: () => Promise<void> };

export async function startDemo(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "coopilot-e2e-"));
  const env = { ...process.env, XDG_CONFIG_HOME: join(dir, "config"), XDG_DATA_HOME: join(dir, "data"), XDG_CACHE_HOME: join(dir, "cache"), XDG_RUNTIME_DIR: join(dir, "run") };
  await mkdir(join(dir, "data", "coopilot"), { recursive: true });
  await writeFile(join(dir, "data", "coopilot", "demo-mode"), "on\n");
  const port = await freePort();
  const root = resolve(import.meta.dirname, "..");
  const child: ChildProcess = spawn(process.execPath, ["server/main.ts", "--dev", "--no-open", "--no-reopen", "--headless", "--port", String(port), "--clock", NOW], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout?.on("data", (b) => (out += b));
  child.stderr?.on("data", (b) => (out += b));
  const launch = join(dir, "run", "coopilot", "launch.json");
  for (let i = 0; i < 300 && !existsSync(launch); i++) {
    if (child.exitCode !== null) throw new Error(`server exited: ${out.slice(-500)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  const url = (JSON.parse(await readFile(launch, "utf8")) as { url: string }).url;
  const browser = await chromium.launch({ executablePath: CHROMIUM!, args: ["--disable-gpu"] });
  return {
    url: `${url}&now=${encodeURIComponent(NOW)}`,
    browser,
    stop: async () => {
      await browser.close().catch(() => {});
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 200));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** A fresh page on a fresh demo store (demo off and on again reseeds it). */
export async function freshPage(h: Harness, viewport = { width: 1920, height: 1080 }): Promise<{ page: Page; errors: string[] }> {
  const page = await h.browser.newPage({ viewport });
  const errors: string[] = [];
  // Vite's dev client reports its websocket (HMR is off in the server): not an app error.
  page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
  await page.goto(h.url);
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  for (const on of [false, true])
    await page.evaluate((on) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "demo.set", input: { on } }) }), on);
  await page.evaluate(() => {
    localStorage.setItem("coopilot.hint.flow", "dismissed");
    localStorage.setItem("coopilot.hint.picktime", "1");
  });
  await page.reload();
  await page.waitForSelector(".demo-tag", { timeout: 30_000 });
  // Step 17.5: a slow first load plays the opening over the app; tests start once it's gone.
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
  return { page, errors };
}

/** Opens Today › Plan on today (Monday): P from Today › Now (step 16.2). */
export async function openPlanDay(page: Page): Promise<void> {
  await page.keyboard.press("1");
  await page.keyboard.press("p");
  await page.waitForSelector(".pd2-left");
}

/** Selects a block in Plan the day by its client name. */
export async function selectBlock(page: Page, client: string): Promise<void> {
  await page.locator(".pd2-block .pd2-block-name", { hasText: client }).click();
  await page.locator(".pd2-right .pd2-pane-title", { hasText: client }).waitFor();
}

/** The titles of the picks in a block of the left pane. */
export const blockPicks = (page: Page, client: string) => page.locator(".pd2-block", { has: page.locator(".pd2-client", { hasText: client }) }).locator(".pd2-picks > li .pr-title").allTextContents();

/** Step 16.2: Settings is in the initials menu (Settings, Sign out). */
export async function openSettings(page: Page): Promise<void> {
  await page.locator(".person-chip").click();
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
}

/** U6: Plan the week has one client open at a time; open this one (its line's name) and return its card. */
export async function weekClient(page: Page, name: string) {
  const card = page.locator(`.pw-client[aria-label="${name}"]`);
  await page.locator(".pw-client").first().waitFor({ timeout: 20_000 });
  if (!(await card.count())) await page.locator(`.pw-line[aria-label="${name}"] .pl-line-name`).click();
  await card.waitFor();
  return card;
}

/** U6: the client names in Plan the week, in line order (the open one included). */
export const weekClientNames = (page: Page) => page.locator(".pw-lines > li").evaluateAll((els) => els.map((e) => e.querySelector(".pw-client")?.getAttribute("aria-label") ?? e.getAttribute("aria-label") ?? ""));

/** U6: a row on any client's list in Plan the week, opening clients in turn until one has it. */
export async function weekRow(page: Page, text: string) {
  const row = page.locator(".pw-client .pw-row", { hasText: text }).first();
  await page.locator(".pw-client").first().waitFor({ timeout: 20_000 });
  for (const name of await weekClientNames(page)) {
    await weekClient(page, name);
    if (await row.count()) return row;
  }
  throw new Error(`No row "${text}" in Plan the week`);
}
