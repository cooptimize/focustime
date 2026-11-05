// The HTTP app (A2): guarded requests (server/guard.ts), sign-in routes, server-side sessions with a CSRF token on
// every state change, one action endpoint per signed-in person, and the UI. The same app serves the developer loop
// (http://localhost:<port>) and the hosted app.
import type { BuildInfo } from "./buildinfo.ts";
import { serviceWorkerSource, shellPaths, SW_PATH } from "./pwa.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import type { Logger } from "../log/logger.ts";
import type { AccountStore, Session } from "../store/accounts.ts";
import { DEMO_SESSION_MS, SESSION_MAX_MS } from "../store/accounts.ts";
import { checkRequest, REOPEN_PATH } from "./guard.ts";
import { AUTH_COOKIE, authCookie, clearAuthCookie, clearSessionCookies, CSRF_HEADER, readCookie, SESSION_COOKIE, sessionCookies } from "./auth/cookies.ts";
import { CONSENTS, SignInError, type Consent, type SignedIn, type SignInTokens } from "./auth/entra.ts";

/** What the sign-in routes need: Microsoft (null when not set up), Google, the demo, and what to do with a sign-in. */
export type SignInHooks = {
  microsoft: {
    start: (o?: { loginHint?: string; consent?: Consent }) => Promise<{ url: string; pending: { state: string; nonce: string; verifier: string } }>;
    finish: (callback: URL, pending: { state: string; nonce: string; verifier: string }) => Promise<{ user: SignedIn; tokens: SignInTokens }>;
  } | null;
  /** A validated Microsoft sign-in: records the person (and their tokens). The user id to start a session for, or why not. */
  signedIn: (user: SignedIn, tokens: SignInTokens) => Promise<{ userId: string } | { refused: SignInRefusal }>;
  /** Google Calendar for a signed-in person (optional). Null: not offered. */
  google?: {
    start: (userId: string) => Promise<{ url: string; pending: { state: string; nonce: string; verifier: string } }>;
    finish: (userId: string, callback: URL, pending: { state: string; nonce: string; verifier: string }) => Promise<"connected" | "failed">;
  } | null;
  /** "Try the demo": a fictional person's id, with their demo data ready. Null: no demo here. */
  demo: (() => Promise<string>) | null;
  /** A session ended (signed out): forget anything held for it (a demo's data). */
  ended?: (s: Session) => void;
};
export type SignInRefusal = "deleted" | "refused" | "guest";

export type AppOptions = {
  /** Where people reach FocusTime: the Host and Origin checks and every redirect. */
  publicUrl: string;
  /** S1 (D452): the running build, at /version (env, PR, short sha, build time; nothing else). */
  build?: BuildInfo;
  log: Logger;
  accounts: Pick<AccountStore, "sessions" | "authRequests">;
  auth: SignInHooks;
  /** The signed-in person's action context (or the demo session's). */
  ctx: (s: Session) => ActionContext | Promise<ActionContext>;
  /** Serve built files from here (production). */
  distDir?: string;
  /** Or hand UI requests to Vite (development). */
  devMiddleware?: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  /** Step 9: the view the launcher or a clicked notification asked for, taken once; null when none. */
  takeOpenRequest?: (s: Session) => Promise<string | null>;
  /** The developer loop: bring the app window up (the host's launcher); false when it can't. Not authentication. */
  reopen?: () => Promise<boolean>;
  /**
   * A3: the database's state for the page ("waking" while a paused Azure SQL database resumes). Read from memory,
   * never from the database, so a page whose call is waiting can ask; it says nothing about anyone.
   */
  dbStatus?: () => "ok" | "waking" | "unavailable";
  /** A4: every finished request, as a fixed route name, status and duration (App Insights in the hosted app). */
  onRequest?: (r: RequestRecord) => void;
};

/** A4: liveness and readiness for the platform's probes (no session, no database call). */
export const HEALTH_PATH = "/healthz";
export const READY_PATH = "/readyz";
/** S1 (D452): the running build; public like the health check (it holds no secret, hostname or user data). */
export const VERSION_PATH = "/version";

/** A finished request, for telemetry: never a path with ids, a query, a header or a body. */
export type RequestRecord = { method: string; route: string; status: number; durationMs: number };

/** A request's route as a fixed name (telemetry never sees the path itself). */
export function routeClass(path: string): string {
  if (path === "/api/action") return "/api/action";
  if (path.startsWith("/api/")) return path.replace(/[^a-z/-]/gi, "").slice(0, 40);
  if (path.startsWith("/auth/")) return path.split("/").slice(0, 4).join("/").replace(/[^a-z/-]/gi, "");
  if (path.startsWith("/assets/")) return "/assets";
  return "/ (page)";
}

/** A3: the database's state, without a session (the session lookup itself waits while the database wakes). */
export const DB_STATUS_PATH = "/api/db-status";

/** An API call without a live session: the page shows the sign-in screen. */
export const SIGNED_OUT_CODE = "signed_out";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

export const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

function baseHeaders(res: ServerResponse, csp: boolean, https: boolean) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (https) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (csp) res.setHeader("Content-Security-Policy", CSP);
}

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const same = (a: string | undefined, b: string) => {
  if (a === undefined) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createApp(opts: AppOptions) {
  let lastReopen = 0;
  /** P1: the service worker's source, made once per process (the build doesn't change while it runs). */
  let sw: string | null = null;
  const https = opts.publicUrl.startsWith("https://");
  const json = (res: ServerResponse, status: number, body: unknown, cookies: string[] = []) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...(cookies.length ? { "set-cookie": cookies } : {}) });
    res.end(JSON.stringify(body));
  };
  const redirect = (res: ServerResponse, to: string, cookies: string[] = []) => {
    res.writeHead(302, { location: to, "cache-control": "no-store", ...(cookies.length ? { "set-cookie": cookies } : {}) });
    res.end();
  };
  /** Back to the app, with why a sign-in didn't complete (the sign-in screen words it). */
  const signInFailed = (res: ServerResponse, reason: string) => redirect(res, `/?signin=${encodeURIComponent(reason)}`, [clearAuthCookie()]);
  const startSession = async (userId: string, demo: boolean) => {
    const s = (await opts.accounts.sessions.create(userId, { demo }));
    return sessionCookies(s.cookie, s.csrf, Math.floor((demo ? DEMO_SESSION_MS : SESSION_MAX_MS) / 1000));
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", opts.publicUrl);
    const method = req.method ?? "GET";
    const header = (n: string) => {
      const v = req.headers[n];
      return Array.isArray(v) ? v[0] : v;
    };
    baseHeaders(res, !!opts.distDir, https);

    // A4: the platform's probes (liveness and readiness). Before the Host check: a probe calls the replica's own
    // address. Never a database call, so probes don't keep a serverless database awake.
    if (url.pathname === HEALTH_PATH || url.pathname === READY_PATH || url.pathname === VERSION_PATH) {
      if (method !== "GET" && method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" });
        return res.end();
      }
      if (url.pathname === VERSION_PATH) return json(res, 200, opts.build ?? { env: "local", pr: "none", sha: "unknown", builtAt: null });
      return json(res, 200, { status: "ok" });
    }
    if (opts.onRequest) {
      const started = performance.now();
      res.on("finish", () => opts.onRequest!({ method, route: routeClass(url.pathname), status: res.statusCode, durationMs: performance.now() - started }));
    }

    const g = checkRequest({ method, path: url.pathname, search: url.search, host: header("host"), origin: header("origin"), secFetchSite: header("sec-fetch-site"), secFetchMode: header("sec-fetch-mode") }, { publicUrl: opts.publicUrl });
    if (g.action === "deny") {
      opts.log({ source: "server", op: "denied", status: g.status, kind: g.reason.replace(/\s+/g, "_").toLowerCase() });
      if (url.pathname.startsWith("/api/")) return json(res, 403, { ok: false, status: 403, code: "forbidden", error: "Forbidden" });
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Forbidden");
    }
    if (g.action === "redirect") return redirect(res, g.location);

    const cookieHeader = header("cookie");
    const session = () => opts.accounts.sessions.resolve(readCookie(cookieHeader, SESSION_COOKIE));
    /** A state change: a live session and its CSRF token in the X-CSRF header. */
    const changeAllowed = (s: Session | null): s is Session => !!s && opts.accounts.sessions.csrfOk(s, header(CSRF_HEADER));

    // ---- Sign-in ----
    if (url.pathname === "/auth/microsoft/login" && method === "GET") {
      if (!opts.auth.microsoft) return signInFailed(res, "misconfigured");
      try {
        const hint = url.searchParams.get("hint");
        // AP-1 (D490): an incremental consent (?consent=chat_read) for the person signed in now; it comes back to them.
        const asked = url.searchParams.get("consent");
        const consent = asked && Object.hasOwn(CONSENTS, asked) ? (asked as Consent) : null;
        const s = consent ? await session() : null;
        if (consent && (!s || s.demo)) return redirect(res, "/#/settings/clients");
        const { url: to, pending } = await opts.auth.microsoft.start({ ...(hint && hint.length < 256 ? { loginHint: hint } : {}), ...(consent ? { consent } : {}) });
        await opts.accounts.authRequests.put("microsoft", pending, s?.userId ?? null);
        return redirect(res, to, [authCookie(pending.state)]);
      } catch (e) {
        return signInFailed(res, e instanceof SignInError ? e.reason : "unavailable");
      }
    }
    if (url.pathname === "/auth/microsoft/callback" && method === "GET") {
      if (!opts.auth.microsoft) return signInFailed(res, "misconfigured");
      // The state must be the one this browser started (its auth cookie) and one the server is waiting for.
      const state = url.searchParams.get("state");
      if (!state || !same(readCookie(cookieHeader, AUTH_COOKIE), state)) return signInFailed(res, "expired");
      const pending = (await opts.accounts.authRequests.take("microsoft", state));
      if (!pending) return signInFailed(res, "expired");
      try {
        const done = await opts.auth.microsoft.finish(url, pending);
        const r = await opts.auth.signedIn(done.user, done.tokens);
        if ("refused" in r) return signInFailed(res, r.refused);
        // A fresh session id at sign-in (never one the browser brought).
        await opts.accounts.sessions.end(readCookie(cookieHeader, SESSION_COOKIE));
        // AP-1: a consent started from Settings goes back there (it was for this person: a session started it).
        return redirect(res, pending.userId && pending.userId === r.userId ? "/?allowed=chat_read#/settings/clients" : "/", [...(await startSession(r.userId, false)), clearAuthCookie()]);
      } catch (e) {
        return signInFailed(res, e instanceof SignInError ? e.reason : "invalid");
      }
    }
    if (url.pathname === "/auth/google/login" && method === "GET") {
      const s = (await session());
      if (!s || s.demo || !opts.auth.google) return redirect(res, "/#/settings/connections");
      try {
        const { url: to, pending } = await opts.auth.google.start(s.userId);
        await opts.accounts.authRequests.put("google", pending, s.userId);
        return redirect(res, to, [authCookie(pending.state)]);
      } catch {
        return redirect(res, "/?google=failed#/settings/connections", [clearAuthCookie()]);
      }
    }
    if (url.pathname === "/auth/google/callback" && method === "GET") {
      const s = (await session());
      const state = url.searchParams.get("state");
      const pending = state && same(readCookie(cookieHeader, AUTH_COOKIE), state) ? await opts.accounts.authRequests.take("google", state) : null;
      // The person who started it must be the one it comes back to.
      if (!s || !opts.auth.google || !pending || pending.userId !== s.userId) return redirect(res, "/?google=expired#/settings/connections", [clearAuthCookie()]);
      const r = await opts.auth.google.finish(s.userId, url, pending).catch(() => "failed" as const);
      return redirect(res, `/?google=${r}#/settings/connections`, [clearAuthCookie()]);
    }
    if (url.pathname === "/auth/demo" && method === "POST") {
      if (!opts.auth.demo) return json(res, 404, { ok: false, status: 404, error: "The demo isn't available here" });
      const userId = await opts.auth.demo();
      // The demo replaces whatever session this browser had (sign in again for your own data).
      const before = (await session());
      await opts.accounts.sessions.end(readCookie(cookieHeader, SESSION_COOKIE));
      if (before) opts.auth.ended?.(before);
      opts.log({ source: "auth", op: "demo", kind: "started" });
      return json(res, 200, { ok: true, data: { status: "demo" } }, (await startSession(userId, true)));
    }
    if (url.pathname === "/auth/logout" && method === "POST") {
      const s = (await session());
      // Without a live session there is nothing to end; the cookies are cleared either way.
      if (s && !changeAllowed(s)) return json(res, 403, { ok: false, status: 403, code: "csrf", error: "Forbidden" });
      await opts.accounts.sessions.end(readCookie(cookieHeader, SESSION_COOKIE));
      if (s) {
        opts.auth.ended?.(s);
        opts.log({ source: "auth", op: "sign_out", kind: s.demo ? "demo" : "signed_out" });
      }
      return json(res, 200, { ok: true, data: { status: "signed_out" } }, clearSessionCookies());
    }
    if (url.pathname.startsWith("/auth/")) {
      res.writeHead(404);
      return res.end();
    }

    // ---- API ----
    if (url.pathname === DB_STATUS_PATH) {
      // POST, as every /api call (the guard wants a same-origin Origin, which a browser sends on a POST).
      if (method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        return res.end();
      }
      return json(res, 200, { status: opts.dbStatus?.() ?? "ok" });
    }
    if (url.pathname === REOPEN_PATH) {
      // The developer loop's "bring the window up": opens nothing but FocusTime's own window, at most every 5 seconds.
      if (method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        return res.end();
      }
      const now = Date.now();
      const ok = !!opts.reopen && now - lastReopen > 5000 && (lastReopen = now) > 0 && (await opts.reopen().catch(() => false));
      opts.log({ source: "server", op: "reopen", kind: ok ? "opened" : "unavailable" });
      return json(res, ok ? 202 : 503, { opened: ok });
    }
    if (url.pathname.startsWith("/api/")) {
      if (method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        return res.end();
      }
      const s = (await session());
      if (!s) return json(res, 401, { ok: false, status: 401, code: SIGNED_OUT_CODE, error: "Sign in to continue" }, clearSessionCookies());
      if (!changeAllowed(s)) {
        opts.log({ source: "server", op: "denied", status: 403, kind: "csrf" });
        return json(res, 403, { ok: false, status: 403, code: "csrf", error: "This page is out of date. Reload it" });
      }
      if (url.pathname === "/api/action") {
        if (!(header("content-type") ?? "").startsWith("application/json")) {
          res.writeHead(415);
          return res.end();
        }
        const started = performance.now();
        let out: Awaited<ReturnType<typeof dispatch>>;
        try {
          const body = JSON.parse(await readBody(req)) as { action?: unknown; input?: unknown };
          out = await dispatch(await opts.ctx(s), { action: body.action, input: body.input });
        } catch {
          out = { ok: false, status: 400, error: "bad request" };
        }
        const status = out.ok ? 200 : out.status;
        opts.log({ source: "server", op: typeof out === "object" && out.ok ? "action" : "action_rejected", status, durationMs: performance.now() - started });
        return json(res, status, out);
      }
      // The view the launcher or a clicked notification asked for, taken once.
      if (url.pathname === "/api/open-request") return json(res, 200, { view: (await opts.takeOpenRequest?.(s).catch(() => null)) ?? null });
      res.writeHead(404);
      return res.end();
    }

    if (opts.devMiddleware) {
      return opts.devMiddleware(req, res, () => {
        res.writeHead(404);
        res.end();
      });
    }
    // P1: the service worker, for this build (never in the dev UI, where Vite serves changing files).
    if (url.pathname === SW_PATH && (method === "GET" || method === "HEAD")) {
      sw ??= serviceWorkerSource(opts.build?.sha ?? "unknown", shellPaths(opts.distDir!));
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
      return res.end(method === "HEAD" ? undefined : sw);
    }
    return serveStatic(opts.distDir!, url.pathname, res);
  };

  return createServer((req, res) => {
    handler(req, res).catch(() => {
      opts.log({ source: "server", op: "error", status: 500 });
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}

async function serveStatic(root: string, pathname: string, res: ServerResponse): Promise<ServerResponse> {
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  } catch {
    res.writeHead(400);
    return res.end();
  }
  let file = join(root, rel);
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(403);
    return res.end();
  }
  const isFile = await stat(file).then((s) => s.isFile()).catch(() => false);
  if (!isFile) file = join(root, "index.html");
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const body = await readFile(file);
  // Hashed build files (/assets/) never change; the page, the manifest and the icons (public/) are checked each time.
  const hashed = rel.startsWith(`assets${sep}`) || rel.startsWith("assets/");
  res.writeHead(200, { "content-type": type, "cache-control": file.endsWith("index.html") ? "no-store" : hashed && isFile ? "public, max-age=31536000, immutable" : "no-cache" });
  return res.end(body);
}
