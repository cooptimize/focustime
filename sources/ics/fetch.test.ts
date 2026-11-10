// CAL-1: one fetch through the guarded getter: redirects re-checked hop by hop, conditional requests, and only
// calendars accepted. A fake getter stands in for the network.
import { describe, expect, it } from "vitest";
import { anIcsCalendar, anIcsEvent } from "../../test/builders/ics.ts";
import { fetchIcs, IcsFetchError, type IcsGet, type IcsResponse } from "./fetch.ts";

const CAL = anIcsCalendar({ events: [anIcsEvent({ start: "20261103T150000Z", end: "20261103T160000Z" })] });
const res = (r: Partial<IcsResponse>): IcsResponse => ({ status: 200, location: null, etag: null, lastModified: null, contentType: "text/calendar", body: CAL, ...r });
const start = new URL("https://calendar.example.com/u/a/basic.ics");

function getter(answers: Record<string, IcsResponse>) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const get: IcsGet = async (url, headers) => {
    seen.push({ url: url.toString(), headers });
    const a = answers[url.toString()];
    if (!a) throw new Error(`unexpected ${url}`);
    return a;
  };
  return { get, seen };
}

const kind = async (p: Promise<unknown>) => p.then(() => null, (e) => (e instanceof IcsFetchError ? e.kind : String(e)));

describe("fetchIcs (CAL-1)", () => {
  it("follows a redirect to another public host", async () => {
    const g = getter({ [start.toString()]: res({ status: 301, location: "https://cdn.example.net/a.ics", body: null }), "https://cdn.example.net/a.ics": res({ etag: '"v1"' }) });
    const r = await fetchIcs(g.get, start);
    expect(r).toMatchObject({ kind: "ok", etag: '"v1"' });
    expect(g.seen.map((s) => s.url)).toEqual([start.toString(), "https://cdn.example.net/a.ics"]);
  });

  it("refuses a redirect to a private, loopback or metadata address, or off https", async () => {
    for (const to of ["https://169.254.169.254/latest/meta-data/", "https://127.0.0.1/a.ics", "https://localhost/a.ics", "https://[::1]/x", "https://10.0.0.5/a.ics"]) {
      const g = getter({ [start.toString()]: res({ status: 302, location: to, body: null }) });
      expect(await kind(fetchIcs(g.get, start)), to).toBe("blocked_address");
      expect(g.seen).toHaveLength(1);
    }
    const g = getter({ [start.toString()]: res({ status: 302, location: "http://calendar.example.com/a.ics", body: null }) });
    expect(await kind(fetchIcs(g.get, start))).toBe("bad_redirect");
  });

  it("stops after three redirects", async () => {
    const hop = (i: number) => `https://calendar.example.com/${i}.ics`;
    const g = getter({ [start.toString()]: res({ status: 302, location: hop(1), body: null }), [hop(1)]: res({ status: 302, location: hop(2), body: null }), [hop(2)]: res({ status: 302, location: hop(3), body: null }), [hop(3)]: res({ status: 302, location: hop(4), body: null }) });
    expect(await kind(fetchIcs(g.get, start))).toBe("too_many_redirects");
  });

  it("asks with If-None-Match (else If-Modified-Since) and reads 304 as unchanged", async () => {
    const g = getter({ [start.toString()]: res({ status: 304, body: null }) });
    expect(await fetchIcs(g.get, start, { etag: '"v1"', lastModified: "Mon, 02 Nov 2026 10:00:00 GMT" })).toEqual({ kind: "not_modified" });
    expect(g.seen[0]!.headers["if-none-match"]).toBe('"v1"');
    expect(g.seen[0]!.headers["if-modified-since"]).toBeUndefined();
    const g2 = getter({ [start.toString()]: res({ status: 304, body: null }) });
    await fetchIcs(g2.get, start, { etag: null, lastModified: "Mon, 02 Nov 2026 10:00:00 GMT" });
    expect(g2.seen[0]!.headers["if-modified-since"]).toBe("Mon, 02 Nov 2026 10:00:00 GMT");
  });

  it("refuses what isn't a calendar: an HTML sign-in page, JSON, or a generic type without a calendar in it", async () => {
    for (const r of [res({ contentType: "text/html; charset=utf-8", body: "<html>Sign in</html>" }), res({ contentType: "application/json", body: "{}" }), res({ contentType: "text/plain", body: "hello" }), res({ contentType: "text/html", body: CAL })]) {
      const g = getter({ [start.toString()]: r });
      expect(await kind(fetchIcs(g.get, start)), r.contentType!).toBe("not_calendar");
    }
    // A calendar served as a generic type is read.
    const g = getter({ [start.toString()]: res({ contentType: "application/octet-stream" }) });
    expect((await fetchIcs(g.get, start)).kind).toBe("ok");
  });

  it("names a link that stopped working (404, 410, 401, 403) and other errors by kind only", async () => {
    for (const [status, k] of [[404, "not_found"], [410, "not_found"], [401, "denied"], [403, "denied"], [500, "http"]] as const) {
      const g = getter({ [start.toString()]: res({ status, body: null }) });
      expect(await kind(fetchIcs(g.get, start))).toBe(k);
    }
  });
});
