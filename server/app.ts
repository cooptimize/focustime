// The local HTTP host: 127.0.0.1 only, guarded requests, one action endpoint, and the UI.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import type { Logger } from "../log/logger.ts";
import { checkRequest } from "./guard.ts";

export type AppOptions = {
  port: number;
  token: string;
  /** The action context, or a getter (step 15: the live or the demo one, D272). */
  ctx: ActionContext | (() => ActionContext);
  log: Logger;
  /** Serve built files from here (production). */
  distDir?: string;
  /** Or hand UI requests to Vite (development). */
  devMiddleware?: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  /** Step 9: the view coopilot-open asked for (e.g. "capture"), taken once; null when none. */
  takeOpenRequest?: () => Promise<string | null>;
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

const SESSION_PAGE = `<!doctype html><meta charset="utf-8"><title>Coopilot</title>
<body style="font:16px system-ui;padding:40px;max-width:640px">
<h1 style="font-size:20px">Coopilot needs a fresh launch link</h1>
<p>This page is protected by a token that changes every time Coopilot starts. Start it again with <code>npm start</code> (it opens the window for you), or open the link in the launch file it reports.</p>`;

function baseHeaders(res: ServerResponse, csp: boolean) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (csp) res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
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

export function createApp(opts: AppOptions) {
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://placeholder");
    const header = (n: string) => {
      const v = req.headers[n];
      return Array.isArray(v) ? v[0] : v;
    };
    baseHeaders(res, !!opts.distDir);

    const g = checkRequest(
      { method: req.method ?? "GET", path: url.pathname, search: url.search, host: header("host"), origin: header("origin"), secFetchSite: header("sec-fetch-site"), cookie: header("cookie") },
      { port: opts.port, token: opts.token },
    );
    if (g.action === "deny") {
      opts.log({ source: "server", op: "denied", status: g.status, kind: g.reason.replace(/\s+/g, "_").toLowerCase() });
      if (g.status === 401 && (req.method ?? "GET") === "GET" && !url.pathname.startsWith("/api/")) {
        res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(SESSION_PAGE);
      }
      res.writeHead(g.status, { "content-type": "text/plain; charset=utf-8" });
      return res.end(g.status === 401 ? "Session expired: restart Coopilot" : "Forbidden");
    }
    if (g.action === "redirect") {
      res.writeHead(302, { location: g.location, "set-cookie": g.setCookie, "cache-control": "no-store" });
      return res.end();
    }

    if (url.pathname === "/api/action") {
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        return res.end();
      }
      if (!(header("content-type") ?? "").startsWith("application/json")) {
        res.writeHead(415);
        return res.end();
      }
      const started = performance.now();
      let out: Awaited<ReturnType<typeof dispatch>>;
      try {
        const body = JSON.parse(await readBody(req)) as { action?: unknown; input?: unknown };
        out = await dispatch(typeof opts.ctx === "function" ? opts.ctx() : opts.ctx, { action: body.action, input: body.input });
      } catch {
        out = { ok: false, status: 400, error: "bad request" };
      }
      const status = out.ok ? 200 : out.status;
      opts.log({ source: "server", op: typeof out === "object" && out.ok ? "action" : "action_rejected", status, durationMs: performance.now() - started });
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify(out));
    }
    // The launcher's one-shot request (coopilot-open --capture). Guarded like actions; POST so a link can't take it.
    if (url.pathname === "/api/open-request") {
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        return res.end();
      }
      const view = (await opts.takeOpenRequest?.().catch(() => null)) ?? null;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ view }));
    }
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(404);
      return res.end();
    }

    if (opts.devMiddleware) {
      return opts.devMiddleware(req, res, () => {
        res.writeHead(404);
        res.end();
      });
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
  res.writeHead(200, { "content-type": type, "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable" });
  return res.end(body);
}
