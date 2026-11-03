// no-demo-leak: a real (not demo) session, signed in as a fake person with fake live sources (Dataverse and DevOps
// answering from test fakes, no calendars set up). Every screen and picker is read for the demo's names and the old
// sample meetings: none may show. Then each source fails in turn: the screen says so with its fix, never stand-in data.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { CSRF_COOKIE, SESSION_COOKIE } from "../server/auth/cookies.ts";
import { startTestApp } from "../server/test-app.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, FAKE_SECRET, fakeFetch, type Scenario } from "../sources/dataverse/test-fakes.ts";
import { DEMO_CLIENTS, DEMO_PEOPLE } from "../sources/demo/data.ts";
import { createDevOpsSource } from "../sources/devops/source.ts";
import { fakeDevOps } from "../sources/devops/test-fakes.ts";
import { createSnapshotStore } from "../host/local/snapshots.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { CHROMIUM } from "./harness.ts";

const T = 120_000;
const NOW = "2026-11-02T09:30:00-05:00";
const ROOT = resolve(import.meta.dirname, "..");
const ME = "e2e00000-0000-4000-8000-0000000000aa";
const text = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')
  .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`)
  .replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl);

/** What only the demo (or the old sample week) has: its clients, its people, the sample meetings. */
const DEMO_WORDS = [
  ...DEMO_CLIENTS.filter((c) => c.key !== "Cooptimize").flatMap((c) => [c.key, c.name]),
  ...DEMO_PEOPLE.map((p) => p.name),
  "Proseware sprint planning",
  "Adatum Power BI walkthrough",
  "Preschool drop-off",
  "Sample meetings",
  "Demo data",
];

/** A live-style context: the real dispatch over sources that read from the fakes. */
function liveContext(o: { dataverse?: Scenario; devopsDown?: boolean } = {}): ActionContext {
  const dir = mkdtempSync(join(tmpdir(), "ft-real-"));
  const dv = fakeFetch(o.dataverse ?? "ok");
  const ado = fakeDevOps({ contoso: o.devopsDown ? "offline" : "planweek", cooptimize: o.devopsDown ? "offline" : "agile" });
  const makeDataverse: ActionContext["makeDataverse"] = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, snapshots: createSnapshotStore(join(dir, "dv")), log: () => {} });
  let devops: ReturnType<typeof createDevOpsSource> | null = null;
  return {
    loadConfig: async () => ({ path: "/e2e/config.toml", parsed: parseConfig(text) }),
    makeDataverse,
    makeOutlook: () => {
      throw new Error("Outlook isn't set up here");
    },
    makeGoogle: () => {
      throw new Error("Google isn't set up here");
    },
    makeDevOps: (cfg, tz) => (devops ??= createDevOpsSource({ fetch: ado.fetch, log: () => {}, snapshots: createSnapshotStore(join(dir, "ado")), timeZone: tz, targets: (k) => makeDataverse(cfg, tz).devopsTargets(k) })),
    saveSystemUserId: async () => {},
    now: () => NOW,
    plan: createPlanStore({ path: join(dir, "plan.db"), now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") }),
  };
}

type Running = { url: string; close: () => Promise<void>; page: () => Promise<Page> };
let browser: Browser;
let vite: ViteDevServer;

async function start(ctx: ActionContext): Promise<Running> {
  const app = await startTestApp({ ctx, now: () => Temporal.Instant.from(NOW), extra: { devMiddleware: vite.middlewares } });
  const b = app.browser();
  const s = await b.signIn(ME);
  return {
    url: `${app.publicUrl}/?now=${encodeURIComponent(NOW)}`,
    close: app.close,
    page: async () => {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await context.addCookies([
        { name: SESSION_COOKIE, value: s.cookie, url: app.publicUrl.replace("http:", "https:"), secure: true, httpOnly: true, sameSite: "Lax" },
        { name: CSRF_COOKIE, value: s.csrf, url: app.publicUrl.replace("http:", "https:"), secure: true, sameSite: "Strict" },
      ]);
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("focustime.hint.flow", "dismissed"));
      return page;
    },
  };
}

/** Every demo word on the page (its text and its titles), with a little context. */
async function demoWordsOn(page: Page): Promise<string[]> {
  const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
  const titles = await page.locator("[title], [aria-label]").evaluateAll((els) => els.map((e) => `${e.getAttribute("title") ?? ""} ${e.getAttribute("aria-label") ?? ""}`));
  const all = [body, ...titles].join(" | ");
  return DEMO_WORDS.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(all)).map((w) => {
    const i = all.indexOf(w);
    return `${w}: …${all.slice(Math.max(0, i - 50), i + 50)}…`;
  });
}

const SCREENS: [string, string, string][] = [
  ["Today", "#/today", ".today-view"],
  ["Plan the day", "#/today/plan", ".pd2-status"],
  ["Check-in", "#/today/checkin", "main"],
  ["Close out", "#/today/closeout", "main"],
  ["Week", "#/week", ".week-head"],
  ["Plan the week", "#/week/plan/2026-11-02", ".pw-client, .pw-empty, .planweek"],
  ["Roadmap", "#/roadmap", ".rm-row, .dl-empty, .roadmap"],
  ["Plan ahead", "#/roadmap/ahead", ".pa-item, .pa-empty, .planahead, .roadmap"],
  ["Inbox", "#/inbox", "main"],
];

describe.skipIf(!CHROMIUM)("a real session never shows demo data (no-demo-leak)", () => {
  beforeAll(async () => {
    vite = await createServer({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "spa", logLevel: "silent" });
    browser = await chromium.launch({ executablePath: CHROMIUM!, args: ["--disable-gpu"] });
  }, T);
  afterAll(async () => {
    await browser?.close();
    await vite?.close();
  });

  it("the fake live sources answer as a real person's (the check below has something to look at)", async () => {
    const ctx = liveContext();
    const r = await dispatch(ctx, { action: "settings.load", input: {} });
    expect(r.ok).toBe(true);
    const keys = (r.ok ? (r.data as { clients: { key: string }[] }).clients : []).map((c) => c.key);
    expect(keys.length).toBeGreaterThan(0);
    // Only Dataverse's clients: none from the settings' colors alone (the fixture's T&W, Proseware, Adatum colors).
    expect(keys).not.toContain("Proseware");
  });

  it("every screen, the client panel, Settings > Clients and the capture client picker: no demo client, person or sample meeting", async () => {
    const app = await start(liveContext());
    try {
      const page = await app.page();
      await page.goto(app.url);
      await page.waitForSelector(".topbar", { timeout: 60_000 });
      const found: string[] = [];
      for (const [name, hash, ready] of SCREENS) {
        await page.evaluate((h) => (location.hash = h), hash);
        await page.locator(ready).first().waitFor({ timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(800);
        for (const w of await demoWordsOn(page)) found.push(`${name}: ${w}`);
        // Positive control: this is the fake person's live data (Dataverse's focus blocks), not an empty page.
        if (name === "Week") await expect(page.evaluate(() => document.body.innerText)).resolves.toMatch(/Adatum/);
      }
      // Plan the week's client panel (the detail panel) when there is a client line.
      await page.evaluate(() => (location.hash = "#/week/plan/2026-11-02"));
      const nameBtn = page.locator(".pw-name").first();
      if (await nameBtn.count()) {
        await nameBtn.click();
        await page.waitForTimeout(500);
        for (const w of await demoWordsOn(page)) found.push(`Client panel: ${w}`);
        await page.keyboard.press("Escape");
      }
      // Settings > Clients.
      await page.keyboard.press(",");
      await page.getByRole("tab", { name: /Clients/ }).or(page.getByRole("button", { name: /^Clients$/ })).first().click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);
      for (const w of await demoWordsOn(page)) found.push(`Settings > Clients: ${w}`);
      await page.keyboard.press("Escape");
      // The capture box's client picker.
      await page.evaluate(() => (location.hash = "#/today"));
      await page.keyboard.press("4");
      await page.waitForTimeout(800);
      for (const w of await demoWordsOn(page)) found.push(`Capture: ${w}`);
      expect(found).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);

  it("calendars that aren't set up say so with where to set them up; no stand-in meetings", async () => {
    const r = await dispatch(liveContext(), { action: "week.load", input: { weekStart: "2026-11-02" } });
    expect(r.ok).toBe(true);
    const sources = r.ok ? (r.data as { sources: { source: string; status: string; message?: string; fixAction?: string; itemCount: number; sample?: boolean }[] }).sources : [];
    for (const s of sources.filter((x) => x.source === "outlook" || x.source === "google")) {
      expect(s).toMatchObject({ status: "misconfigured", fixAction: "open_settings", itemCount: 0 });
      expect(s.message).toMatch(/isn't set up yet\. Set it up in Settings > Connections/);
      expect(s.sample).toBeFalsy();
    }
  });

  it("Dataverse down: the week says so with the fix, and shows no stand-in clients", async () => {
    const app = await start(liveContext({ dataverse: "network_down" }));
    try {
      const page = await app.page();
      await page.goto(app.url);
      await page.waitForSelector(".topbar", { timeout: 60_000 });
      await page.evaluate(() => (location.hash = "#/week"));
      await page.waitForTimeout(1500);
      const body = await page.evaluate(() => document.body.innerText);
      expect(body).toMatch(/Dataverse/);
      expect(body).toMatch(/Retry|Refresh|Settings|reach/i);
      expect(await demoWordsOn(page)).toEqual([]);
      // Settings > Clients explains instead of listing guesses.
      const s = await dispatch(liveContext({ dataverse: "network_down" }), { action: "settings.load", input: {} });
      const d = s.ok ? (s.data as { clients: { key: string }[]; dataverseProblem: string | null }) : null;
      // Only the internal client (always followed); nothing guessed for the rest.
      expect(d?.clients.map((c) => c.key)).toEqual(["Cooptimize"]);
      expect(d?.dataverseProblem).toMatch(/Couldn't read your clients from Dataverse.*Check Connections, then Refresh/);
    } finally {
      await app.close();
    }
  }, T);

  it("DevOps down: Plan the week says so per client, and offers no stand-in items", async () => {
    const app = await start(liveContext({ devopsDown: true }));
    try {
      const page = await app.page();
      await page.goto(app.url);
      await page.waitForSelector(".topbar", { timeout: 60_000 });
      await page.evaluate(() => (location.hash = "#/week/plan/2026-11-02"));
      await page.waitForTimeout(2000);
      const body = await page.evaluate(() => document.body.innerText);
      expect(body).toMatch(/DevOps/);
      expect(await demoWordsOn(page)).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
