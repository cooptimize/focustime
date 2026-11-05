// DM-1: the demo's Outlook calendar, one per demo session, in memory. The app's own Graph writer
// (sources/graph/write.ts) is handed this module's `fetch`, so a timebox put on Outlook, a help invite, a move of my own
// event and an RSVP go through the real preview, ownership and refusal rules, read back and undo, and nothing leaves
// FocusTime. The meetings are the demo's fictional ones (data.ts); my answers to them and FocusTime's own events live
// here. Only graph.microsoft.com/v1.0/me/... is answered; any other URL throws before anything happens.
import type { CalEvent } from "../../week/types.ts";
import { MARKER_PROP } from "../graph/write.ts";
import { demoOrganizer, demoOutlook } from "./data.ts";

const API = "https://graph.microsoft.com/v1.0/";
type Ev = {
  id: string; subject: string; start: string; end: string; showAs: string; isReminderOn: boolean; marker: string | null; isAllDay: boolean;
  isOrganizer: boolean; attendees: { address: string; name: string }[]; type: string; isOnlineMeeting: boolean; response: string; organizer: string | null; cancelled: boolean;
};

const graphTime = (iso: string) => ({ dateTime: Temporal.Instant.from(iso).toString({ smallestUnit: "second" }).replace(/Z$/, ""), timeZone: "UTC" });
const instantOf = (t: { dateTime?: string } | undefined) => (t?.dateTime ? Temporal.Instant.from(/[zZ]|[+-]\d\d:\d\d$/.test(t.dateTime) ? t.dateTime : `${t.dateTime}Z`).toString() : "");
const responseOf = (e: CalEvent) => (e.responseStatus === "tentative" ? "tentativelyAccepted" : e.responseStatus === "declined" ? "declined" : "accepted");
const RSVP: Record<string, string> = { accept: "accepted", tentativelyAccept: "tentativelyAccepted", decline: "declined" };
const graphId = (e: CalEvent) => e.id.replace(/^outlook:/, "");
const mondayOf = (d: Temporal.PlainDate) => d.subtract({ days: d.dayOfWeek - 1 });

export type DemoOutlook = ReturnType<typeof createDemoOutlook>;

export function createDemoOutlook(o: { now: () => string }) {
  /** FocusTime's own events and invites, and my own solo events (all made in this session). */
  const own = new Map<string, Ev>();
  /** My answers to the demo's meetings, by id. */
  const answers = new Map<string, { response: string; at: string }>();
  let next = 1;
  const seen: { method: string; path: string }[] = [];

  /** The demo's meetings in a range (timed only), as Graph events, with my answers applied. */
  const meetings = (fromIso: string, toIso: string): Ev[] => {
    const a = Temporal.Instant.from(fromIso), b = Temporal.Instant.from(toIso);
    const out = new Map<string, Ev>();
    for (let m = mondayOf(Temporal.PlainDate.from(fromIso.slice(0, 10))).subtract({ days: 7 }); Temporal.PlainDate.compare(m, Temporal.PlainDate.from(toIso.slice(0, 10))) <= 0; m = m.add({ days: 7 }))
      for (const e of demoOutlook(m.toString())) {
        if (e.allDay || Temporal.Instant.compare(Temporal.Instant.from(e.start), b) >= 0 || Temporal.Instant.compare(Temporal.Instant.from(e.end), a) <= 0) continue;
        const id = graphId(e);
        out.set(id, asEv(e));
      }
    return [...out.values()];
  };
  const asEv = (e: CalEvent): Ev => {
    const id = graphId(e);
    return {
      id, subject: e.title, start: Temporal.Instant.from(e.start).toString(), end: Temporal.Instant.from(e.end).toString(), showAs: e.showAs ?? "busy", isReminderOn: false, marker: null, isAllDay: false,
      isOrganizer: false, attendees: [1, 2, 3, 4].map((n) => ({ address: `attendee${n}@example.com`, name: `Attendee ${n}` })), type: "singleInstance", isOnlineMeeting: true,
      response: answers.get(id)?.response ?? responseOf(e), organizer: demoOrganizer(id), cancelled: false,
    };
  };
  /** One meeting by id (its date is in the id), or one of my own. */
  const find = (id: string): Ev | null => {
    const mine = own.get(id);
    if (mine) return mine;
    const date = /(\d{4}-\d{2}-\d{2})$/.exec(id)?.[1];
    return date ? (meetings(`${date}T00:00:00Z`, `${date}T23:59:59Z`).find((x) => x.id === id) ?? null) : null;
  };
  const raw = (e: Ev) => ({
    id: e.id, subject: e.subject, start: graphTime(e.start), end: graphTime(e.end), showAs: e.showAs, isReminderOn: e.isReminderOn, isCancelled: e.cancelled, isAllDay: e.isAllDay, isOrganizer: e.isOrganizer,
    attendees: e.attendees.map((x) => ({ emailAddress: { address: x.address, name: x.name }, type: "required" })), type: e.type, isOnlineMeeting: e.isOnlineMeeting, webLink: null,
    responseStatus: { response: e.response }, organizer: e.organizer ? { emailAddress: { name: e.organizer } } : { emailAddress: { name: "Alex Rivera" } }, allowNewTimeProposals: true,
    singleValueExtendedProperties: e.marker ? [{ id: MARKER_PROP, value: e.marker }] : [],
  });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = String(input instanceof Request ? input.url : input);
    if (!href.startsWith(`${API}me/`)) throw new TypeError("The demo's Outlook answers only its own calendar");
    const url = new URL(href);
    const method = (init?.method ?? "GET").toUpperCase();
    seen.push({ method, path: url.pathname });
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const path = url.pathname.replace(/^\/v1\.0\/me\//, "");
    if (path === "calendar") return json({ name: "Calendar", owner: { address: "you@example.com", name: "Alex Rivera" } });
    if (path === "calendarView") {
      const from = url.searchParams.get("startDateTime")!, to = url.searchParams.get("endDateTime")!;
      const a = Temporal.Instant.from(from), b = Temporal.Instant.from(to);
      const mine = [...own.values()].filter((e) => !e.cancelled && Temporal.Instant.compare(Temporal.Instant.from(e.start), b) < 0 && Temporal.Instant.compare(Temporal.Instant.from(e.end), a) > 0);
      return json({ value: [...meetings(from, to), ...mine].map(raw) });
    }
    if (path === "events" && method === "GET") {
      const marker = /ep\/value eq '((?:[^']|'')*)'/.exec(url.searchParams.get("$filter") ?? "")?.[1]?.replace(/''/g, "'");
      return json({ value: [...own.values()].filter((e) => !e.cancelled && e.marker === marker).map(raw) });
    }
    if (path === "events" && method === "POST") {
      const b = body!;
      const props = (b.singleValueExtendedProperties as { id: string; value: string }[] | undefined) ?? [];
      const attendees = ((b.attendees as { emailAddress: { address: string; name: string } }[] | undefined) ?? []).map((x) => ({ address: x.emailAddress.address.toLowerCase(), name: x.emailAddress.name }));
      const e: Ev = {
        id: `demo-ft-${next++}`, subject: String(b.subject ?? ""), start: instantOf(b.start as { dateTime?: string }), end: instantOf(b.end as { dateTime?: string }), showAs: String(b.showAs ?? "busy"), isReminderOn: b.isReminderOn === true,
        marker: props.find((p) => p.id === MARKER_PROP)?.value ?? null, isAllDay: false, isOrganizer: true, attendees, type: "singleInstance", isOnlineMeeting: b.isOnlineMeeting === true, response: "organizer", organizer: "Alex Rivera", cancelled: false,
      };
      own.set(e.id, e);
      return json(raw(e), 201);
    }
    const m = /^events\/([^/]+)(?:\/(cancel|accept|tentativelyAccept|decline))?$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      const e = find(id);
      if (!e || (e.cancelled && method !== "GET")) return json({ error: { code: "ErrorItemNotFound" } }, 404);
      if (method === "GET") return json(raw(e));
      if (m[2] === "cancel") {
        e.cancelled = true;
        return new Response(null, { status: 202 });
      }
      if (m[2]) {
        answers.set(id, { response: RSVP[m[2]]!, at: o.now() });
        return new Response(null, { status: 202 });
      }
      if (method === "PATCH") {
        if (!own.has(id)) return json({ error: { code: "ErrorAccessDenied" } }, 403);
        if (body?.subject !== undefined) e.subject = String(body.subject);
        if (body?.start) e.start = instantOf(body.start as { dateTime?: string });
        if (body?.end) e.end = instantOf(body.end as { dateTime?: string });
        if (body?.showAs !== undefined) e.showAs = String(body.showAs);
        if (body?.isReminderOn !== undefined) e.isReminderOn = body.isReminderOn === true;
        return json(raw(e));
      }
      if (method === "DELETE") {
        if (!own.has(id)) return json({ error: { code: "ErrorAccessDenied" } }, 403);
        own.delete(id);
        return new Response(null, { status: 204 });
      }
    }
    return json({ error: { code: "ErrorInvalidRequest", message: "The demo's Outlook doesn't have that" } }, 400);
  }) as typeof fetch;

  return {
    fetch: fetchFn,
    /** My answer to a demo meeting, when I gave one in this session ("accepted", "tentativelyAccepted", "declined"). */
    answer: (id: string) => answers.get(id)?.response ?? null,
    /** FocusTime's own events in this session, for the calendar's read (cancelled ones left out). */
    ownEvents: (): CalEvent[] => [...own.values()].filter((e) => !e.cancelled).map((e) => ({ id: `outlook:${e.id}`, source: "outlook", title: e.subject, start: e.start, end: e.end, allDay: false, showAs: (e.showAs || "busy") as NonNullable<CalEvent["showAs"]>, isPersonal: false, responseStatus: "organizer", ...(e.marker?.startsWith("tb-") ? { notMeeting: "timebox" as const } : e.attendees.length ? {} : { notMeeting: "solo" as const }) })),
    seen,
  };
}
