// A fake Microsoft Graph calendar for writer tests: events in memory, marker properties, and failure switches.
import { MARKER_PROP } from "./write.ts";

export const FAKE_WRITE_TOKEN = "FAKE-WRITE-TOKEN-77ab";
type Ev = { id: string; subject: string; body: string; start: string; end: string; showAs: string; isReminderOn: boolean; marker: string | null; transactionId: string | null };

export function fakeGraph(opts: { owner?: string } = {}) {
  const events = new Map<string, Ev>();
  const calls: { method: string; path: string; body: unknown; prefer: string | null; auth: string | null }[] = [];
  let n = 0;
  const sw = {
    /** The next request matching method gets this status (once). */
    failNext: null as null | { method: string; status: number },
    /** The next POST is applied but its response is lost (network error). */
    loseCreateResponse: false,
    /** PATCH is accepted but not applied (read-back mismatch). */
    ignorePatch: false,
  };
  const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const out = (e: Ev, withMarker: boolean) => ({
    id: e.id, subject: e.subject, start: { dateTime: e.start.replace(/Z$/, ".0000000"), timeZone: "UTC" }, end: { dateTime: e.end.replace(/Z$/, ".0000000"), timeZone: "UTC" },
    showAs: e.showAs, isReminderOn: e.isReminderOn, isCancelled: false,
    ...(withMarker ? { singleValueExtendedProperties: e.marker ? [{ id: MARKER_PROP, value: e.marker }] : [] } : {}),
  });
  const utc = (t: { dateTime: string }) => Temporal.Instant.from(`${t.dateTime}Z`).toString();
  /** Add an event Coopilot did not create (no marker), or one with someone else's marker. */
  function seed(e: Partial<Ev> & { start: string; end: string }) {
    const id = e.id ?? `EV${++n}`;
    events.set(id, { id, subject: "Someone's meeting", body: "", showAs: "busy", isReminderOn: true, marker: null, transactionId: null, ...e });
    return id;
  }
  const fetchFn = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const u = new URL(String(input));
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path: decodeURIComponent(u.pathname + u.search), body, prefer: headers.get("prefer"), auth: headers.get("authorization") });
    if (u.origin !== "https://graph.microsoft.com") throw new Error("unexpected host");
    if (sw.failNext && sw.failNext.method === method) {
      const s = sw.failNext.status;
      sw.failNext = null;
      return json(s, { error: { code: "Fail", message: `echo ${FAKE_WRITE_TOKEN}` } });
    }
    const path = u.pathname.replace("/v1.0/", "");
    const withMarker = (u.searchParams.get("$expand") ?? "").includes(MARKER_PROP);
    if (path === "me/calendar") return json(200, { name: "Calendar", owner: { name: "Tanner", address: opts.owner ?? "tanner@cooptimize.example" } });
    if (path === "me/events" && method === "GET") {
      const f = u.searchParams.get("$filter") ?? "";
      const m = /ep\/value eq '(.*)'\)$/.exec(f);
      if (!f.includes(MARKER_PROP) || !m) return json(400, {});
      return json(200, { value: [...events.values()].filter((e) => e.marker === m[1]!.replace(/''/g, "'")).map((e) => out(e, withMarker)) });
    }
    if (path === "me/events" && method === "POST") {
      const dup = body.transactionId ? [...events.values()].find((e) => e.transactionId === body.transactionId) : null;
      const id = dup?.id ?? `EV${++n}`;
      if (!dup) {
        const marker = (body.singleValueExtendedProperties ?? []).find((p: { id: string }) => p.id === MARKER_PROP)?.value ?? null;
        events.set(id, { id, subject: body.subject, body: body.body?.content ?? "", start: utc(body.start), end: utc(body.end), showAs: body.showAs ?? "busy", isReminderOn: body.isReminderOn ?? true, marker, transactionId: body.transactionId ?? null });
      }
      if (sw.loseCreateResponse) {
        sw.loseCreateResponse = false;
        throw new TypeError("fetch failed");
      }
      return json(201, out(events.get(id)!, false));
    }
    const id = decodeURIComponent(path.replace(/^me\/events\//, ""));
    const e = events.get(id);
    if (!e) return json(404, {});
    if (method === "GET") return json(200, out(e, withMarker));
    if (method === "PATCH") {
      if (!sw.ignorePatch) {
        if (body.subject !== undefined) e.subject = body.subject;
        if (body.body) e.body = body.body.content;
        if (body.start) e.start = utc(body.start);
        if (body.end) e.end = utc(body.end);
        if (body.showAs) e.showAs = body.showAs;
        if (body.isReminderOn !== undefined) e.isReminderOn = body.isReminderOn;
      }
      return json(200, out(e, false));
    }
    if (method === "DELETE") {
      events.delete(id);
      return json(204, null);
    }
    return json(405, {});
  };
  return { fetch: fetchFn as typeof fetch, events, calls, sw, seed };
}
