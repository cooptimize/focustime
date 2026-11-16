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

describe("a file checked each time is answered \"not changed\" when it hasn't changed (PF-2, D)", () => {
  it("the manifest: its tag back gives 304 with no body; another tag gives the file whole", async () => {
    const first = await get("/manifest.webmanifest", "br");
    const tag = first.headers.etag as string;
    expect(tag).toMatch(/^"[\w-]+-br"$/);
    const again = await get("/manifest.webmanifest", "br", "GET", { "if-none-match": tag });
    expect([again.status, again.raw.length, again.headers.etag, again.headers.vary, again.headers["cache-control"]]).toEqual([304, 0, tag, "Accept-Encoding", "no-cache"]);
    expect(again.headers["content-encoding"]).toBeUndefined();
    // The same content in another form (a browser that changed what it accepts) is still not changed.
    const plainTag = (await get("/manifest.webmanifest")).headers.etag as string;
    expect(plainTag).not.toBe(tag);
    const other = await get("/manifest.webmanifest", "gzip", "GET", { "if-none-match": plainTag });
    // Review 2: the 304 echoes the tag the cache sent, so it can match what it holds.
    expect([other.status, other.headers.etag]).toEqual([304, plainTag]);
    expect((await get("/manifest.webmanifest", "gzip", "GET", { "if-none-match": `W/${plainTag}` })).status).toBe(304);
    // A tag from an earlier release: sent whole.
    const changed = await get("/manifest.webmanifest", "gzip", "GET", { "if-none-match": '"an-earlier-release"' });
    expect(changed.status).toBe(200);
    expect(decode(changed)).toBe(MANIFEST);
  });

  it("the worker, an icon and a hashed file have tags too; the page has none (never kept)", async () => {
    for (const p of ["/sw.js", "/icons/focustime-192.png", "/assets/main-abc.js"]) {
      const r = await get(p, "br");
      expect(r.headers.etag, p).toBeTruthy();
      expect((await get(p, "br", "GET", { "if-none-match": r.headers.etag as string })).status, p).toBe(304);
    }
    const page = await get("/", "br");
    expect(page.headers.etag).toBeUndefined();
    expect((await get("/", "br", "GET", { "if-none-match": "*" })).status).toBe(200);
  });

  it("a changed file is sent whole: a new build's worker has a new tag", async () => {
    const d2 = mkdtempSync(join(tmpdir(), "pf2-dist2-"));
    writeFileSync(join(d2, "index.html"), PAGE);
    writeFileSync(join(d2, "manifest.webmanifest"), MANIFEST.replace("FocusTime", "FocusTime 2"));
    const other = await startTestApp({ ctx: () => ({}) as ActionContext, distDir: d2 });
    try {
      const old = (await get("/manifest.webmanifest", "br")).headers.etag as string;
      const r = await other.browser().send("/manifest.webmanifest", { "accept-encoding": "br", "if-none-match": old });
      expect(r.status).toBe(200);
      expect(decode(r)).toContain("FocusTime 2");
    } finally {
      await other.close();
      rmSync(d2, { recursive: true, force: true });
    }
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
    // Review 2: spaces around the name.
    expect(pickEncoding("br ; q=0, *", { br: 1, gzip: 1 })).toBe("gzip");
    expect(pickEncoding(" gzip ;q=1 ", { br: 1, gzip: 1 })).toBe("gzip");
  });
});
