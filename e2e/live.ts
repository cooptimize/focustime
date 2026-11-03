// A real (not demo) session in the browser, on fake live sources (S1: shared by real-session.test.ts and
// setup.test.ts): Dataverse and DevOps answer from test fakes, Outlook only as far as a test gives it, the app on a
// free port (test/ports.ts) with Vite in it, and a signed-in browser context. Fictional data only.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import type { ActionContext } from "../actions/dispatch.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { createSnapshotStore } from "../host/local/snapshots.ts";
import { SETUP_STEPS } from "../plan/setup.ts";
import { CSRF_COOKIE, SESSION_COOKIE } from "../server/auth/cookies.ts";
import { startTestApp } from "../server/test-app.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, FAKE_SECRET, fakeFetch, type Scenario } from "../sources/dataverse/test-fakes.ts";
import { createDevOpsSource } from "../sources/devops/source.ts";
import { fakeDevOps } from "../sources/devops/test-fakes.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { CHROMIUM } from "./harness.ts";

export const T = 120_000;
export const NOW = "2026-11-02T09:30:00-05:00";
const ROOT = resolve(import.meta.dirname, "..");
export const ME = "e2e00000-0000-4000-8000-0000000000aa";
const TEXT = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')
  .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`)
  .replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl);

export type LiveOptions = {
  dataverse?: Scenario;
  devopsDown?: boolean;
  /** Setup already done (the default: tests of other screens don't see the flow). */
  setupDone?: boolean;
  /** Anything else the context needs (Outlook, the DevOps writer, write PATs). */
  extra?: Partial<ActionContext>;
};

/** A live-style context: the real dispatch over sources that read from the fakes, a fresh plan store, settings in memory. */
export async function liveContext(o: LiveOptions = {}): Promise<ActionContext> {
  const dir = mkdtempSync(join(tmpdir(), "ft-real-"));
  const dv = fakeFetch(o.dataverse ?? "ok");
  const ado = fakeDevOps({ contoso: o.devopsDown ? "offline" : "planweek", cooptimize: o.devopsDown ? "offline" : "agile" });
  const makeDataverse: ActionContext["makeDataverse"] = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, snapshots: createSnapshotStore(join(dir, "dv")), log: () => {} });
  let devops: ReturnType<typeof createDevOpsSource> | null = null;
  let text = TEXT;
  const plan = createPlanStore({ path: join(dir, "plan.db"), now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  if (o.setupDone !== false) for (const s of SETUP_STEPS) await plan.setSetupStep(s, "done");
  return {
    loadConfig: async () => ({ path: "/e2e/config.toml", parsed: parseConfig(text) }),
    writeConfig: async (edit) => {
      const next = edit(text);
      const parsed = parseConfig(next);
      if (!parsed.ok) return { ok: false, parsed };
      text = next;
      return { ok: true, parsed, backup: "/e2e/config.toml.bak" };
    },
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
    plan,
    ...o.extra,
  };
}

export type Live = { url: string; close: () => Promise<void>; page: () => Promise<Page> };
export type LiveBrowser = { browser: Browser; vite: ViteDevServer; start: (ctx: ActionContext) => Promise<Live>; close: () => Promise<void> };

/** Vite (no HMR) and Chromium for a test file; `start` serves one context to a signed-in browser context. */
export async function liveBrowser(): Promise<LiveBrowser> {
  const vite = await createServer({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "spa", logLevel: "silent" });
  const browser = await chromium.launch({ executablePath: CHROMIUM!, args: ["--disable-gpu"] });
  return {
    browser,
    vite,
    close: async () => {
      await browser.close().catch(() => {});
      await vite.close();
    },
    start: async (ctx) => {
      const app = await startTestApp({ ctx, now: () => Temporal.Instant.from(NOW), extra: { devMiddleware: vite.middlewares } });
      const s = await app.browser().signIn(ME);
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
    },
  };
}
