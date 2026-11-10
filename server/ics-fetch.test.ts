// CAL-1: the guarded getter. Its DNS check refuses a name with any private, loopback, link-local or metadata answer
// (checked at connect time, so a rebinding name can't slip through), and the body is capped. No network: a stand-in
// resolver and a stand-in https.request.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { request } from "node:https";
import { describe, expect, it } from "vitest";
import { IcsFetchError } from "../sources/ics/fetch.ts";
import { createIcsGet, guardedLookup } from "./ics-fetch.ts";

type Answer = { address: string; family: number };
const resolver = (answers: Record<string, Answer[]>) => (host: string, cb: (e: NodeJS.ErrnoException | null, a: Answer[]) => void) => cb(null, answers[host] ?? []);
const lookupOf = (answers: Record<string, Answer[]>, all = false) =>
  new Promise<unknown>((resolve, reject) => (guardedLookup(resolver(answers)) as unknown as (h: string, o: object, cb: (e: Error | null, a?: unknown) => void) => void)("cal.example.com", { all }, (e, a) => (e ? reject(e) : resolve(a))));

describe("guardedLookup (CAL-1)", () => {
  it("refuses a name that resolves to a private, loopback, link-local or metadata address, even among public ones", async () => {
    for (const bad of ["127.0.0.1", "10.0.0.8", "169.254.169.254", "192.168.1.1", "::1", "fd00::5", "::ffff:127.0.0.1"])
      await expect(lookupOf({ "cal.example.com": [{ address: "93.184.216.34", family: 4 }, { address: bad, family: bad.includes(":") ? 6 : 4 }] }), bad).rejects.toMatchObject({ code: "EFOCUSTIMEBLOCKED" });
    await expect(lookupOf({})).rejects.toMatchObject({ code: "EFOCUSTIMEBLOCKED" });
  });

  it("passes public answers through, one or all", async () => {
    const answers = { "cal.example.com": [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1::1", family: 6 }] };
    expect(await lookupOf(answers, true)).toEqual(answers["cal.example.com"]);
    expect(await lookupOf(answers, false)).toBe("93.184.216.34");
  });
});

/** A stand-in https.request: answers with the given status, headers and body chunks; records the options. */
function fakeRequest(r: { status: number; headers?: Record<string, string>; chunks?: string[] }) {
  const calls: { lookup: unknown }[] = [];
  const fn = ((_url: URL, opts: { lookup: unknown }, cb: (res: unknown) => void) => {
    calls.push({ lookup: opts.lookup });
    const req = Object.assign(new EventEmitter(), { end: () => {
      const res = Object.assign(new PassThrough(), { statusCode: r.status, headers: r.headers ?? {} });
      cb(res);
      for (const c of r.chunks ?? []) res.write(c);
      res.end();
      setImmediate(() => req.emit("close"));
    }, destroy: () => req.emit("close") });
    return req;
  }) as unknown as typeof request;
  return { fn, calls };
}

const limits = { timeoutMs: 5000, maxBytes: 1000 };
const kind = (p: Promise<unknown>) => p.then(() => null, (e) => (e instanceof IcsFetchError ? e.kind : String(e)));

describe("createIcsGet (CAL-1)", () => {
  it("connects through the guarded lookup and reads the body and validators", async () => {
    const f = fakeRequest({ status: 200, headers: { "content-type": "text/calendar", etag: '"v2"' }, chunks: ["BEGIN:VCALENDAR\r\n", "END:VCALENDAR\r\n"] });
    const r = await createIcsGet({ request: f.fn })(new URL("https://cal.example.com/a.ics"), {}, limits);
    expect(r).toMatchObject({ status: 200, etag: '"v2"', contentType: "text/calendar" });
    expect(r.body).toContain("BEGIN:VCALENDAR");
    expect(typeof f.calls[0]!.lookup).toBe("function");
  });

  it("refuses a response over the size cap, by its declared length or as it streams", async () => {
    const declared = fakeRequest({ status: 200, headers: { "content-length": "5000" }, chunks: ["x"] });
    expect(await kind(createIcsGet({ request: declared.fn })(new URL("https://cal.example.com/a.ics"), {}, limits))).toBe("too_large");
    const streamed = fakeRequest({ status: 200, chunks: ["x".repeat(600), "x".repeat(600)] });
    expect(await kind(createIcsGet({ request: streamed.fn })(new URL("https://cal.example.com/a.ics"), {}, limits))).toBe("too_large");
  });

  it("never sends a request to a blocked literal address or off https", async () => {
    const f = fakeRequest({ status: 200 });
    for (const u of ["https://127.0.0.1/a.ics", "https://169.254.169.254/a", "http://cal.example.com/a.ics", "https://localhost/a"]) expect(await kind(createIcsGet({ request: f.fn })(new URL(u), {}, limits)), u).toBe("blocked_address");
    expect(f.calls).toHaveLength(0);
  });

  it("returns redirects without following them", async () => {
    const f = fakeRequest({ status: 302, headers: { location: "https://169.254.169.254/" } });
    expect(await createIcsGet({ request: f.fn })(new URL("https://cal.example.com/a.ics"), {}, limits)).toMatchObject({ status: 302, location: "https://169.254.169.254/", body: null });
  });
});
