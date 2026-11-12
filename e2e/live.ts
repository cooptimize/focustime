// A real (not demo) session in the browser, on fake live sources (S1: shared by real-session.test.ts and
// setup.test.ts): Dataverse and DevOps answer from test fakes, Outlook only as far as a test gives it, the app on a
// free port (test/ports.ts) with Vite in it, and a signed-in browser context. Fictional data only.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
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
import { createOrgRuntime, type OrgRuntime } from "../actions/org.ts";
import { workTemplatesStoreOn } from "../store/work-templates-store.ts";
import { createAdminStore, FOCUSTIME, type AdminStore } from "../store/admin-store.ts";
import { sqliteDb } from "../test/db.ts";
import { createAdminCheck } from "../actions/admin.ts";
import type { AdminOps } from "../actions/admin-actions.ts";
import { createAdminOps } from "../server/admin-ops.ts";
import type { ClientChat } from "../plan/requests.ts";
import type { StatusRegistry } from "../actions/status-rows.ts";

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
  /** ADM-1: the team's settings, applied to this person's as the server does (shared between contexts in a test). */
  team?: LiveTeam;
  /** Whose settings these are, for their level (default ME). */
  userId?: string;
};

/** ADM-1: a team's settings and people in memory, as an admin would have set them. */
export type LiveTeam = { org: OrgRuntime; store: AdminStore; set: (scope: string, key: string, value: unknown) => Promise<void> };
/**
 * ADM-1: an admin console over a team, for e2e: `admins` is the break-glass list (change it to make someone an admin
 * or not; the next check reads it), `clients` the clients Admin › Clients lists, `chats` the registered client chats.
 */
export async function liveAdminOps(team: LiveTeam, o: { admins: string[]; clients?: string[]; chats?: () => Promise<ClientChat[]>; statusRows?: StatusRegistry }): Promise<AdminOps> {
  if (o.clients?.length) await team.store.replaceDirectory([], [], o.clients.map((clientKey) => ({ personId: ME, clientKey })));
  return createAdminOps({
    check: createAdminCheck({ groupId: null, breakGlass: o.admins, graph: async () => null, now: Date.now }),
    org: team.org,
    groupId: null,
    breakGlass: o.admins,
    tenantId: null,
    users: async () => [],
    personStore: () => ({ setupState: async () => ({}), devopsIdentities: async () => [] }),
    hasSecret: async () => false,
    chats: o.chats ?? (async () => []),
    ai: async () => ({ provider: "stub", keyConfigured: true }),
    appSpentMicros: async () => 0,
    feedback: async () => null,
    build: { env: "dev", sha: "e2e", pr: "", builtAt: null },
    directory: null,
    removePerson: async () => {},
    ...(o.statusRows ? { statusRows: o.statusRows } : {}),
    log: () => {},
  });
}

export function liveTeam(): LiveTeam {
  const store = createAdminStore(sqliteDb().conn, () => Temporal.Instant.from(NOW));
  const base = createOrgRuntime({ store, bootstrap: { model: "gpt-6-luna", appCapUsd: 100, inviteDomains: ["contoso.example"], feedback: null }, holdMs: 0 });
  // CV-3b: clientAccounts() fails closed, so the fake Dataverse's clients are active (I'm an Account Worker on each);
  // a test that lists its own clients (liveAdminOps) replaces them. Reads wait for this.
  const seeded = store.replaceDirectory([], [], ["Adatum", "T&W", "Litware Electronics"].map((clientKey) => ({ personId: ME, clientKey })));
  const after = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => (await seeded, f(...a));
  const org: OrgRuntime = { ...base, rules: after(base.rules), levels: after(base.levels), clientAccounts: after(base.clientAccounts), levelOf: after(base.levelOf), clientLeads: after(base.clientLeads), isClientLead: after(base.isClientLead), apply: after(base.apply) };
  return {
    org,
    store,
    set: async (scope, key, value) => {
      await store.setOrg({ scope, key, value, actor: FOCUSTIME, area: "test", target: scope });
      org.invalidate();
    },
  };
}

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
  const withTeam = async (t: string) => {
    const parsed = parseConfig(t);
    return parsed.ok && o.team ? { ...parsed, config: await o.team.org.apply(parsed.config, o.userId ?? ME) } : parsed;
  };
  return {
    loadConfig: async () => ({ path: "/e2e/config.toml", parsed: await withTeam(text) }),
    writeConfig: async (edit) => {
      const next = edit(text);
      const parsed = parseConfig(next);
      if (!parsed.ok) return { ok: false, parsed };
      text = next;
      const applied = await withTeam(next);
      return { ok: true, parsed: applied.ok ? applied : parsed, backup: "/e2e/config.toml.bak" };
    },
    ...(o.team ? { org: o.team.org } : {}),
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
    // TP-1: the team's work templates, in their own database (seeded on the first read).
    templates: workTemplatesStoreOn(sqliteDb().conn, () => NOW),
    ...o.extra,
  };
}

/**
 * HK-1: the app is up and the opening has finished. The opening plays over the app on a slow load and takes every key
 * to skip itself, so a key sent while it plays never reaches the app (break-down's Esc under load). Wait for this, not
 * just the top bar, before sending keys.
 */
export async function appReady(page: Page): Promise<void> {
  await page.locator(".topbar").waitFor();
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
}

export type Live = { url: string; close: () => Promise<void>; page: () => Promise<Page> };
export type LiveBrowser = { browser: Browser; vite: ViteDevServer | null; start: (ctx: ActionContext) => Promise<Live>; close: () => Promise<void> };

/**
 * Chromium for a test file and the UI it serves; `start` serves one context to a signed-in browser context. The UI is
 * the run's build (test/e2e-build.ts, FOCUSTIME_E2E_DIST) like the demo harness's, or Vite (no HMR) with
 * FOCUSTIME_E2E_DIST=dev. HK-1: these real-session tests (setup, admin, AI and the rest) still compiled the whole UI
 * through Vite on their first page; on CI's two cores that ate most of a step's 60 s and summed past the admin test's
 * 240 s. Service workers are blocked, as in the harness, so a built run never depends on a cached shell.
 */
export async function liveBrowser(): Promise<LiveBrowser> {
  const dist = process.env.FOCUSTIME_E2E_DIST && process.env.FOCUSTIME_E2E_DIST !== "dev" ? process.env.FOCUSTIME_E2E_DIST : null;
  const vite = dist ? null : await createServer({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "spa", logLevel: "silent" });
  const browser = await chromium.launch({ executablePath: CHROMIUM!, args: ["--disable-gpu"] });
  return {
    browser,
    vite,
    close: async () => {
      await browser.close().catch(() => {});
      await vite?.close();
    },
    start: async (ctx) => {
      const app = await startTestApp({ ctx, now: () => Temporal.Instant.from(NOW), ...(dist ? { distDir: dist } : {}), extra: vite ? { devMiddleware: vite.middlewares } : {} });
      const s = await app.browser().signIn(ME);
      const contexts = new Set<BrowserContext>();
      return {
        url: `${app.publicUrl}/?now=${encodeURIComponent(NOW)}`,
        // HK-3: the browser first, so its pages' timers stop before the server waits on their connections.
        close: async () => {
          await Promise.all([...contexts].map((c) => c.close().catch(() => {})));
          await app.close();
        },
        page: async () => {
          const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block" });
          contexts.add(context);
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
