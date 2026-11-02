// A fake Microsoft Graph calendar for writer tests: events in memory, marker properties, and failure switches.
import { MARKER_PROP } from "./write.ts";

export const FAKE_WRITE_TOKEN = "FAKE-WRITE-TOKEN-77ab";
type Ev = {
  id: string; subject: string; body: string; start: string; end: string; showAs: string; isReminderOn: boolean; marker: string | null; transactionId: string | null;
  // Step 13: who is on it, series or single, all-day, Teams.
  attendees?: { address: string; name: string }[]; isOrganizer?: boolean; type?: string; isAllDay?: boolean; online?: boolean;
  // Step 16: my response, the organizer, whether new times may be proposed, cancelled.
  response?: string; organizer?: { name: string; address: string }; allowNewTimeProposals?: boolean; isCancelled?: boolean;
};

export function fakeGraph(opts: { owner?: string } = {}) {
  const events = new Map<string, Ev>();
  const calls: { method: string; path: string; body: unknown; prefer: string | null; auth: string | null }[] = [];
  let n = 0;
  const sw = {
    /** The next request matching method gets this status (once). */
    failNext: null as null | { method: string; status: number },
    /** The next POST is applied but its response is lost (network error). */
    loseCreateResponse: false,
    /** Step 14.5: after the next write (POST, PATCH, DELETE) lands, this many GETs of an event fail at the network. */
    dropAfterWrite: 0,
    dropGets: 0,
    /** PATCH is accepted but not applied (read-back mismatch). */
    ignorePatch: false,
    /** Step 13: what getSchedule answers (the raw Graph body). */
    schedule: null as unknown,
    /** Step 16: a decline takes the meeting off the calendar (later GETs are 404). */
    declineRemoves: false,
    /** Step 16: a response is accepted (202) but not applied (read-back mismatch). */
    ignoreRsvp: false,
  };
  const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const out = (e: Ev, withMarker: boolean) => ({
    id: e.id, subject: e.subject, start: { dateTime: e.start.replace(/Z$/, ".0000000"), timeZone: "UTC" }, end: { dateTime: e.end.replace(/Z$/, ".0000000"), timeZone: "UTC" },
    showAs: e.showAs, isReminderOn: e.isReminderOn, isCancelled: e.isCancelled ?? false,
    responseStatus: { response: e.response ?? ((e.isOrganizer ?? true) ? "organizer" : "notResponded"), time: "0001-01-01T00:00:00Z" },
    organizer: { emailAddress: e.organizer ?? { name: "Tanner", address: "tanner@cooptimize.example" } }, allowNewTimeProposals: e.allowNewTimeProposals ?? true,
    isOrganizer: e.isOrganizer ?? true, attendees: (e.attendees ?? []).map((a) => ({ emailAddress: a, type: "required" })), type: e.type ?? "singleInstance", isAllDay: e.isAllDay ?? false,
    isOnlineMeeting: e.online ?? false, webLink: `https://outlook.office365.com/owa/?itemid=${encodeURIComponent(e.id)}&exvsurl=1&path=/calendar/item`,
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
    if (method !== "GET" && sw.dropAfterWrite > 0) {
      sw.dropGets = sw.dropAfterWrite;
      sw.dropAfterWrite = 0;
    }
    const path = u.pathname.replace("/v1.0/", "");
    const withMarker = (u.searchParams.get("$expand") ?? "").includes(MARKER_PROP);
    if (path === "me/calendar/getSchedule" && method === "POST") return json(200, sw.schedule ?? { value: [] });
    if (path === "me/calendarView" && method === "GET") {
      const a = Date.parse(u.searchParams.get("startDateTime")!), b = Date.parse(u.searchParams.get("endDateTime")!);
      return json(200, { value: [...events.values()].filter((e) => Date.parse(e.start) < b && Date.parse(e.end) > a).map((e) => out(e, withMarker)) });
    }
    if (/^me\/events\/[^/]+\/cancel$/.test(path) && method === "POST") {
      const cid = decodeURIComponent(path.split("/")[2]!);
      const e = events.get(cid);
      if (!e) return json(404, {});
      if (e.isOrganizer === false) return json(400, {});
      events.delete(cid);
      return json(202, null);
    }
    const rsvp = /^me\/events\/([^/]+)\/(accept|tentativelyAccept|decline)$/.exec(path);
    if (rsvp && method === "POST") {
      const e = events.get(decodeURIComponent(rsvp[1]!));
      if (!e) return json(404, {});
      if (e.isOrganizer !== false) return json(400, {});
      if (body?.proposedNewTime && (rsvp[2] === "accept" || e.allowNewTimeProposals === false || body.sendResponse === false)) return json(400, {});
      if (!sw.ignoreRsvp) {
        e.response = rsvp[2] === "accept" ? "accepted" : rsvp[2] === "decline" ? "declined" : "tentativelyAccepted";
        if (rsvp[2] === "decline" && sw.declineRemoves) events.delete(e.id);
      }
      return json(202, null);
    }
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
        events.set(id, {
          id, subject: body.subject, body: body.body?.content ?? "", start: utc(body.start), end: utc(body.end), showAs: body.showAs ?? "busy", isReminderOn: body.isReminderOn ?? true, marker, transactionId: body.transactionId ?? null,
          attendees: (body.attendees ?? []).map((x: { emailAddress: { address: string; name: string } }) => x.emailAddress), online: body.isOnlineMeeting === true,
        });
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
    if (method === "GET" && sw.dropGets > 0) {
      sw.dropGets--;
      throw new TypeError("fetch failed");
    }
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
      if (u.pathname.endsWith("/cancel")) return json(405, {});
      events.delete(id);
      return json(204, null);
    }
    return json(405, {});
  };
  return { fetch: fetchFn as typeof fetch, events, calls, sw, seed };
}
