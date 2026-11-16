// PF-2: the app's files, read and compressed once when the server starts, and answered from memory. Every file the
// UI build wrote is read here once (D3: never read again for a request; the build doesn't change while the server
// runs, the same reason the service worker's source is made once). A text file worth compressing gets its Brotli and
// gzip forms made here, before the server listens, so no request ever waits on or repeats compression. Fonts and
// images are already compressed and tiny files gain nothing: they are sent as they are.
//
// What a request gets: the best form its Accept-Encoding allows (Brotli, then gzip, then the plain file), with its
// length, its type, its cache line and "Vary: Accept-Encoding" on every file that has
// more than one form, so nothing between the app and the browser hands one browser another's form.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";

export const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
/** Text worth compressing. Fonts (woff2) and images (png) are compressed already. */
const TEXT = new Set([".html", ".js", ".css", ".svg", ".json", ".webmanifest"]);
/** Under this a file is sent as it is: the saving is smaller than a packet. */
export const MIN_COMPRESS_BYTES = 1024;
/**
 * Brotli 9 and gzip 9: on this build Brotli 9 takes about 0.15 s for every file together and is within 8% of Brotli 11,
 * which takes about 3 s (each server start, each test server): D-row "Brotli 9 at start".
 */
const BROTLI_QUALITY = 9;
const GZIP_LEVEL = 9;

export type Encoding = "br" | "gzip";
export type StaticFile = {
  type: string;
  cache: string;
  plain: Buffer;
  br?: Buffer;
  gzip?: Buffer;
};

/** PF-2 tests: how many times a file has been compressed in this process (the hashed files once each, at start). */
export const staticWork = { compressed: 0 };

const NO_STORE = "no-store";
const IMMUTABLE = "public, max-age=31536000, immutable";
const CHECK_EACH_TIME = "no-cache";

/** One file's forms, made once. */
export function makeStaticFile(path: string, plain: Buffer, cache: string): StaticFile {
  const ext = extname(path);
  const f: StaticFile = { type: TYPES[ext] ?? "application/octet-stream", cache, plain };
  if (TEXT.has(ext) && plain.length >= MIN_COMPRESS_BYTES) {
    staticWork.compressed++;
    const br = brotliCompressSync(plain, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT, [constants.BROTLI_PARAM_SIZE_HINT]: plain.length } });
    const gz = gzipSync(plain, { level: GZIP_LEVEL });
    // Kept only when it saves something worth a header.
    if (br.length < plain.length * 0.9) f.br = br;
    if (gz.length < plain.length * 0.9) f.gzip = gz;
  }
  return f;
}

/** Every file under the UI build, by its URL path ("/assets/x.js"), read and compressed once. */
export function loadStaticFiles(root: string): Map<string, StaticFile> {
  const out = new Map<string, StaticFile>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && !p.endsWith(".map")) {
        const url = `/${relative(root, p).split(sep).join("/")}`;
        const page = url === "/index.html";
        // Hashed build files (/assets/) never change; the page is never kept; the rest (public/) is checked each time.
        const cache = page ? NO_STORE : url.startsWith("/assets/") ? IMMUTABLE : CHECK_EACH_TIME;
        out.set(url, makeStaticFile(url, readFileSync(p), cache));
      }
    }
  };
  walk(root);
  return out;
}

/** The form to send for this Accept-Encoding: the highest q the browser gives, Brotli on a tie; null for plain. */
export function pickEncoding(accept: string | undefined, has: { br?: unknown; gzip?: unknown }): Encoding | null {
  if (!accept) return null;
  const q: Record<string, number> = {};
  for (const part of accept.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const v = qp ? Number(qp.slice(2)) : 1;
    q[name] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  }
  const of = (n: string) => q[n] ?? (n === "gzip" ? q["x-gzip"] : undefined) ?? q["*"] ?? 0;
  const br = has.br ? of("br") : 0;
  const gz = has.gzip ? of("gzip") : 0;
  if (br <= 0 && gz <= 0) return null;
  return br >= gz ? "br" : "gzip";
}

/** One file's answer: the chosen form with its length, type, cache line and Vary. */
export function sendStatic(req: IncomingMessage, res: ServerResponse, f: StaticFile): void {
  const varies = !!(f.br || f.gzip);
  const enc = pickEncoding(header(req, "accept-encoding"), f);
  const body = enc === "br" ? f.br! : enc === "gzip" ? f.gzip! : f.plain;
  const head: Record<string, string | number> = { "content-type": f.type, "cache-control": f.cache };
  if (varies) head.vary = "Accept-Encoding";
  const method = req.method ?? "GET";
  if (enc) head["content-encoding"] = enc;
  head["content-length"] = body.length;
  res.writeHead(200, head);
  res.end(method === "HEAD" ? undefined : body);
}

/** PF-2 (B): a file under /assets/ that this build doesn't have. Nothing worth keeping, and nothing kept. */
export function sendMissingFile(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "content-length": 0, "cache-control": NO_STORE });
  res.end();
}

function header(req: IncomingMessage, n: string): string | undefined {
  const v = req.headers[n];
  return Array.isArray(v) ? v.join(",") : v;
}
