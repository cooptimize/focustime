// PF-2: the app's files are compressed once when the server starts and answered in the form the browser accepts, with
// the right encoding and length, and the same bytes once decoded. Fonts, images and tiny files go as they are.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { pickEncoding, staticWork } from "./static-files.ts";
import { startTestApp } from "./test-app.ts";

let app: Awaited<ReturnType<typeof startTestApp>>;
let dist: string;
// A script and a page big enough to be worth compressing; the real build's are far larger.
const SCRIPT = Array.from({ length: 400 }, (_, i) => `export const value${i} = "FocusTime ${i}";`).join("\n");
const PAGE = `<!doctype html><title>FocusTime</title>${"<div class=row>Week</div>".repeat(80)}`;
const FONT = Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7919) % 256));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(3000, 1)]);
const MANIFEST = JSON.stringify({ name: "FocusTime", icons: Array.from({ length: 30 }, (_, i) => ({ src: `/icons/i${i}.png`, sizes: "192x192" })) });

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), "pf2-dist-"));
  mkdirSync(join(dist, "assets"));
  mkdirSync(join(dist, "icons"));
  writeFileSync(join(dist, "index.html"), PAGE);
  writeFileSync(join(dist, "assets", "main-abc.js"), SCRIPT);
  writeFileSync(join(dist, "assets", "tiny-abc.js"), "export {};");
  writeFileSync(join(dist, "assets", "empty-abc.js"), "");
  writeFileSync(join(dist, "assets", "plex-abc.woff2"), FONT);
  writeFileSync(join(dist, "icons", "focustime-192.png"), PNG);
  writeFileSync(join(dist, "manifest.webmanifest"), MANIFEST);
  app = await startTestApp({ ctx: () => ({}) as ActionContext, distDir: dist });
});
afterAll(async () => {
  await app.close();
  rmSync(dist, { recursive: true, force: true });
});

const get = (path: string, accept?: string, method = "GET", extra: Record<string, string> = {}) => app.browser().send(path, { ...(accept === undefined ? {} : { "accept-encoding": accept }), ...extra }, method);
const decode = (r: { raw: Buffer; headers: Record<string, unknown> }) => (r.headers["content-encoding"] === "br" ? brotliDecompressSync(r.raw) : r.headers["content-encoding"] === "gzip" ? gunzipSync(r.raw) : r.raw).toString("utf8");

describe("the app's files, compressed once (PF-2)", () => {
  for (const [accept, enc] of [
    ["br", "br"],
    ["gzip", "gzip"],
    ["gzip, deflate, br, zstd", "br"],
    ["br;q=0.5, gzip;q=1", "gzip"],
    ["br;q=0, gzip", "gzip"],
    ["*", "br"],
    ["identity", undefined],
    ["deflate", undefined],
    ["", undefined],
    [undefined, undefined],
  ] as const) {
    it(`Accept-Encoding ${accept === undefined ? "absent" : JSON.stringify(accept)}: ${enc ?? "the plain file"}, its length, the same content`, async () => {
      const r = await get("/assets/main-abc.js", accept);
      expect(r.status).toBe(200);
      expect(r.headers["content-encoding"]).toBe(enc);
      expect(r.headers["content-length"]).toBe(String(r.raw.length));
      expect(r.headers.vary).toBe("Accept-Encoding");
      expect(r.headers["content-type"]).toBe("text/javascript; charset=utf-8");
      expect(r.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(decode(r)).toBe(SCRIPT);
      if (enc) expect(r.raw.length).toBeLessThan(Buffer.byteLength(SCRIPT) / 2);
    });
  }

  it("the page is compressed too, and still never kept", async () => {
    for (const path of ["/", "/index.html", "/some/view"]) {
      const r = await get(path, "gzip, br");
      expect([r.status, r.headers["content-encoding"], r.headers["cache-control"], r.headers.vary]).toEqual([200, "br", "no-store", "Accept-Encoding"]);
      expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
      expect(decode(r)).toBe(PAGE);
    }
  });

  it("a HEAD request: the same headers and length, no body", async () => {
    const full = await get("/assets/main-abc.js", "br");
    const head = await get("/assets/main-abc.js", "br", "HEAD");
    expect(head.status).toBe(200);
    expect(head.raw.length).toBe(0);
    for (const h of ["content-encoding", "content-length", "content-type", "vary", "cache-control"]) expect(head.headers[h], h).toBe(full.headers[h]);
  });

  it("an empty file, a tiny file, a font and an image go as they are, with their length", async () => {
    for (const [path, body, type] of [
      ["/assets/empty-abc.js", Buffer.alloc(0), "text/javascript; charset=utf-8"],
      ["/assets/tiny-abc.js", Buffer.from("export {};"), "text/javascript; charset=utf-8"],
      ["/assets/plex-abc.woff2", FONT, "font/woff2"],
      ["/icons/focustime-192.png", PNG, "image/png"],
    ] as const) {
      const r = await get(path, "gzip, deflate, br, zstd");
      expect(r.status, path).toBe(200);
      expect(r.headers["content-encoding"], path).toBeUndefined();
      expect(r.headers.vary, path).toBeUndefined();
      expect(r.headers["content-type"], path).toBe(type);
      expect(r.headers["content-length"], path).toBe(String(body.length));
      expect(r.raw.equals(body), path).toBe(true);
    }
  });

  it("a file checked each time (the manifest, the worker) is compressed with its length", async () => {
    const m = await get("/manifest.webmanifest", "gzip");
    expect([m.headers["content-encoding"], m.headers["cache-control"], m.headers["content-type"]]).toEqual(["gzip", "no-cache", "application/manifest+json"]);
    expect(decode(m)).toBe(MANIFEST);
    const sw = await get("/sw.js", "br");
    expect([sw.status, sw.headers["content-encoding"], sw.headers["cache-control"], sw.headers["content-length"]]).toEqual([200, "br", "no-cache", String(sw.raw.length)]);
    expect(decode(sw)).toContain("focustime-shell-");
  });

  it("the files were compressed when the server started; requests do no compression work", async () => {
    const before = staticWork.compressed;
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) for (const p of ["/assets/main-abc.js", "/", "/manifest.webmanifest", "/sw.js"]) await get(p, i % 2 ? "gzip" : "br");
    expect(staticWork.compressed).toBe(before);
  });
});

describe("pickEncoding", () => {
  it("never picks a form the file doesn't have, nor one the browser refuses", () => {
    expect(pickEncoding("br", { gzip: 1 })).toBeNull();
    expect(pickEncoding("gzip, br", { gzip: 1 })).toBe("gzip");
    expect(pickEncoding("x-gzip", { br: 1, gzip: 1 })).toBe("gzip");
    expect(pickEncoding("*;q=0, br", { br: 1, gzip: 1 })).toBe("br");
    expect(pickEncoding("*;q=0", { br: 1, gzip: 1 })).toBeNull();
    expect(pickEncoding("BR;Q=1", { br: 1 })).toBe("br");
    expect(pickEncoding("br;q=nonsense, gzip", { br: 1, gzip: 1 })).toBe("gzip");
  });
});
