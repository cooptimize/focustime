// PF-2 (C): data is compressed only for the named large reads, through the real server on the demo. A route or action
// not on the list is never compressed; nothing that carries a token, a session, a sign-in step or a key ever is, even
// if someone puts it on the list; a client's code is compressed for its one answer and nothing of it is kept.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { ACTIONS } from "../actions/registry.ts";
import { COMPRESSED_READS, dataWork, MIN_DATA_BYTES, NEVER_COMPRESSED, onCompressedList, writeJson } from "./compress-data.ts";
import { createDemoContext, seedDemo } from "./demo.ts";
import { startTestApp } from "./test-app.ts";

const NOW = "2026-11-02T13:30:00Z";
const REPO = "a1b2c3d4-0001-4000-8000-00000000a001";
let app: Awaited<ReturnType<typeof startTestApp>>;
let b: ReturnType<typeof app.browser>;
const saved = { fetch: globalThis.fetch, env: { ...process.env } };

beforeAll(async () => {
  globalThis.fetch = vi.fn(async () => {
    throw new Error("network call in demo mode");
  }) as never;
  const dirs = ["cfg", "data", "cache"].map((n) => mkdtempSync(join(tmpdir(), `pf2-${n}-`)));
  [process.env.XDG_CONFIG_HOME, process.env.XDG_DATA_HOME, process.env.XDG_CACHE_HOME] = dirs;
  const ctx: ActionContext = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} } });
  await seedDemo(ctx);
  app = await startTestApp({ ctx, auth: { demo: async () => "demo-person" } });
  b = app.browser();
  await b.signIn("demo-person", true);
});
afterAll(async () => {
  await app.close();
  globalThis.fetch = saved.fetch;
  process.env = { ...saved.env };
});

const decode = (r: { raw: Buffer; headers: Record<string, unknown> }) => (r.headers["content-encoding"] === "br" ? brotliDecompressSync(r.raw) : r.headers["content-encoding"] === "gzip" ? gunzipSync(r.raw) : r.raw).toString("utf8");

describe("the list", () => {
  it("names only registered actions, and none of a never-compressed kind", () => {
    const names = new Set<string>(ACTIONS.map((a) => a.name));
    for (const a of COMPRESSED_READS) {
      expect(names.has(a), a).toBe(true);
      expect(NEVER_COMPRESSED.filter((k) => k.test(a)).map((k) => k.kind), a).toEqual([]);
    }
  });

  // One test per kind: it fails if someone adds an action of that kind to the list, and the guard holds even if they do.
  for (const k of NEVER_COMPRESSED) {
    it(`never compresses ${k.kind}`, () => {
      expect(ACTIONS.some((a) => a.name === k.example), k.example).toBe(true);
      expect(k.test(k.example)).toBe(true);
      const onList = ACTIONS.filter((a) => k.test(a.name) && COMPRESSED_READS.has(a.name)).map((a) => a.name);
      expect(onList, `${k.kind} must never be on the list`).toEqual([]);
      (COMPRESSED_READS as Set<string>).add(k.example);
      try {
        expect(onCompressedList(k.example)).toBe(false);
      } finally {
        (COMPRESSED_READS as Set<string>).delete(k.example);
      }
    });
  }

  it("an action not on the list is never compressed, whatever it is", () => {
    for (const a of ACTIONS) expect(onCompressedList(a.name), a.name).toBe(COMPRESSED_READS.has(a.name));
    for (const x of [undefined, null, 1, {}, "", "week.load ", "WEEK.LOAD", "__proto__"]) expect(onCompressedList(x)).toBe(false);
  });
});

describe("large reads on the list, through the server (PF-2)", () => {
  for (const [action, input] of [
    ["week.load", { weekStart: "2026-11-02" }],
    ["ahead.load", {}],
    ["status.load", {}],
    ["inbox.list", {}],
    ["code.kinds", { clientKey: "Northwind" }],
  ] as const) {
    it(`${action}: Brotli or gzip as accepted, plain otherwise, the same content decoded, with its length and Vary`, async () => {
      const plain = await b.action(action, input, { "accept-encoding": "identity" });
      expect(plain.status).toBe(200);
      expect(plain.headers["content-encoding"]).toBeUndefined();
      expect(plain.headers.vary).toBe("Accept-Encoding");
      expect(plain.headers["content-length"]).toBe(String(plain.raw.length));
      expect(plain.raw.length).toBeGreaterThanOrEqual(MIN_DATA_BYTES);
      for (const [accept, enc] of [
        ["gzip, deflate, br, zstd", "br"],
        ["gzip", "gzip"],
      ] as const) {
        const r = await b.action(action, input, { "accept-encoding": accept });
        expect([r.status, r.headers["content-encoding"], r.headers.vary, r.headers["cache-control"]]).toEqual([200, enc, "Accept-Encoding", "no-store"]);
        expect(r.headers["content-length"]).toBe(String(r.raw.length));
        expect(r.raw.length).toBeLessThan(plain.raw.length);
        expect(JSON.parse(decode(r))).toEqual(JSON.parse(plain.body));
      }
    });
  }

  it("a short answer on the list goes plain, still saying it varies", async () => {
    const r = await b.action("code.file", { clientKey: "Northwind", repoId: REPO, path: "/README.md" }, { "accept-encoding": "br" });
    expect(r.status).toBe(200);
    if (r.raw.length < MIN_DATA_BYTES) expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.headers.vary).toBe("Accept-Encoding");
  });

  it("a read off the list is never compressed, however large", async () => {
    const r = await b.action("settings.load", {}, { "accept-encoding": "br, gzip" });
    expect(r.status).toBe(200);
    expect(r.raw.length).toBeGreaterThan(MIN_DATA_BYTES);
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.headers.vary).toBeUndefined();
    for (const action of ["auth.status", "push.status", "devops.write_status", "calendar_link.list", "setup.load", "planday.start"]) {
      const x = await b.action(action, {}, { "accept-encoding": "br, gzip" });
      expect(x.headers["content-encoding"], action).toBeUndefined();
    }
  });

  it("no route but an action on the list is compressed: sign-in, the demo, sign-out, health, version, the database state, activity", async () => {
    const accept = { "accept-encoding": "br, gzip", origin: `http://localhost:${app.port}` };
    const fresh = app.browser();
    const demo = await fresh.send("/auth/demo", accept, "POST");
    expect(demo.headers["set-cookie"]).toBeTruthy();
    expect(demo.headers["content-encoding"]).toBeUndefined();
    for (const path of ["/healthz", "/readyz", "/version", "/auth/microsoft/login", "/auth/nothing"]) {
      const r = await fresh.send(path, accept);
      expect(r.headers["content-encoding"], path).toBeUndefined();
    }
    for (const path of ["/api/db-status", "/api/activity", "/api/open-request", "/api/nothing"]) {
      const r = await fresh.post(path, {}, accept);
      expect(r.headers["content-encoding"], path).toBeUndefined();
    }
    const out = await fresh.post("/auth/logout", {}, accept);
    expect(out.headers["set-cookie"]).toBeTruthy();
    expect(out.headers["content-encoding"]).toBeUndefined();
  });
});

describe("a client's code is compressed for its one answer and nothing of it is kept (PF-2, the Code rules)", () => {
  /** A response that hands its body to a socket, like Node's: end(chunk, cb) calls cb once it has been written. */
  function fakeRes() {
    const sink = new PassThrough().resume();
    const got: { head?: Record<string, unknown>; status?: number; body?: Buffer; written?: Buffer } = {};
    const res = {
      writeHead: (status: number, head: Record<string, unknown>) => ((got.status = status), (got.head = head), res),
      end: (chunk: Buffer, cb?: () => void) => {
        got.body = chunk;
        got.written = Buffer.from(chunk);
        sink.end(chunk, cb);
        return res;
      },
    };
    return { res: res as unknown as ServerResponse, got, done: new Promise<void>((r) => sink.on("finish", () => setImmediate(r))) };
  }
  const req = (accept: string) => ({ headers: { "accept-encoding": accept } }) as unknown as IncomingMessage;
  const FILE = { ok: true, data: { path: "/src/Orders.sql", text: Array.from({ length: 200 }, (_, i) => `SELECT ${i} AS line_${i} FROM dbo.Orders;`).join("\n") } };

  it("the answer is compressed and its compressed copy is zeroed once written; the server keeps no copy", async () => {
    const before = dataWork.compressed;
    const { res, got, done } = fakeRes();
    const sent = writeJson(req("br"), res, 200, FILE, [], "code.file");
    await sent;
    await done;
    expect(got.head!["content-encoding"]).toBe("br");
    expect(got.head!["cache-control"]).toBe("no-store");
    expect(JSON.parse(brotliDecompressSync(got.written!).toString())).toEqual(FILE);
    expect(dataWork.compressed).toBe(before + 1);
    // What was handed to the socket is zeroed after it was written: no copy of the code stays in the server's memory.
    expect(got.body!.every((x) => x === 0)).toBe(true);
    // The module holds nothing but counts.
    expect(Object.keys(dataWork).sort()).toEqual(["compressed", "lastMs"]);
  });

  it("through the server: Code's listing is compressed, no-store, and a second read compresses again (nothing reused)", async () => {
    const before = dataWork.compressed;
    const one = await b.action("code.kinds", { clientKey: "Northwind" }, { "accept-encoding": "br" });
    const two = await b.action("code.kinds", { clientKey: "Northwind" }, { "accept-encoding": "br" });
    expect([one.headers["content-encoding"], one.headers["cache-control"]]).toEqual(["br", "no-store"]);
    expect(decode(one)).toBe(decode(two));
    expect(dataWork.compressed).toBe(before + 2);
  });

  it("another read's compressed answer is left as it is", async () => {
    const { res, got, done } = fakeRes();
    await writeJson(req("gzip"), res, 200, { ok: true, data: { rows: Array.from({ length: 100 }, (_, i) => ({ i, title: `Story ${i}` })) } }, [], "week.load");
    await done;
    expect(got.head!["content-encoding"]).toBe("gzip");
    expect(got.body!.equals(got.written!)).toBe(true);
  });
});

describe("the time compression adds", () => {
  it("the largest read (a 1 MB file) takes well under a tenth of a second", async () => {
    const text = Array.from({ length: 25_000 }, (_, i) => `    var value${i} = compute(${i}, "row ${i % 97}");`).join("\n").slice(0, 1_000_000);
    const { res, done } = (() => {
      const sink = new PassThrough().resume();
      const r = { writeHead: () => r, end: (c: Buffer, cb?: () => void) => (sink.end(c, cb), r) };
      return { res: r as unknown as ServerResponse, done: new Promise<void>((ok) => sink.on("finish", () => ok())) };
    })();
    await writeJson({ headers: { "accept-encoding": "br" } } as unknown as IncomingMessage, res, 200, { ok: true, data: { text } }, [], "code.file");
    await done;
    expect(dataWork.lastMs).toBeLessThan(100);
  });
});

describe("a streamed answer still streams (PF-2)", () => {
  it("the Teams bot's endpoint writes its own answer in pieces, never compressed", async () => {
    const { TEAMS_BOT_PATH } = await import("./guard.ts");
    const pieces: number[] = [];
    const s = await startTestApp({
      ctx: () => ({}) as ActionContext,
      extra: {
        teams: async (_req, res) => {
          res.writeHead(200, { "content-type": "text/plain" });
          for (let i = 0; i < 3; i++) {
            res.write(`piece ${i}\n`.repeat(400));
            pieces.push(i);
            await new Promise((r) => setTimeout(r, 20));
          }
          res.end();
        },
      },
    });
    try {
      const r = await s.browser().send(TEAMS_BOT_PATH, { "accept-encoding": "br, gzip", "content-type": "application/json" }, "POST", "{}");
      expect(r.status).toBe(200);
      expect(r.headers["content-encoding"]).toBeUndefined();
      expect(r.headers["transfer-encoding"]).toBe("chunked");
      expect(r.body).toContain("piece 2");
      expect(pieces).toEqual([0, 1, 2]);
    } finally {
      await s.close();
    }
  });
});
