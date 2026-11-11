// MC-1: meeting capture through Microsoft Graph, delegated, read only.
// - My calendar (the sign-in's read token, Calendars.ReadWrite already granted): the recurring online meetings I'm
//   on, to register one (subject, organizer, recurrence, the join link, how many people are from outside
//   Cooptimize), a series' occurrences (/me/events/{id}/instances) with their Cooptimize attendees, and a pasted join
//   link's event in the next 5 weeks. Attendee addresses never leave this file except as matches against FocusTime
//   users; outside addresses are only counted.
// - Teams meetings (the "meetings" token: OnlineMeetings.Read and OnlineMeetingTranscript.Read.All, delegated, admin
//   consented): the online meeting of a registered join link, its transcripts, and one transcript's text/vtt.
//   Every one of these asks `allowed` first: only a registered, Automatic, home-tenant meeting passes; anything else
//   throws MeetingRefused before a request is sent.
// Logs carry the op, status, count and duration: never a subject, a link, an id, a person or transcript text.
import type { Logger } from "../../log/logger.ts";
import { HttpError, NetworkError } from "../calendar/http.ts";
import { AuthFailure } from "../oauth/oauth.ts";
import { joinKey } from "../../plan/meetings.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
/** The longest transcript read (a few hours of meeting is well under this). */
export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;

export class MeetingRefused extends Error {
  constructor() {
    super("FocusTime reads only registered meetings");
    this.name = "MeetingRefused";
  }
}

/**
 * MC-1c: what went wrong with a Graph meeting call, as one kind (logged, counted, and turned into plain words by the
 * caller), or null when the error isn't one of Graph's or the sign-in's:
 *   signin   signed out, the token was refused (401) or the sign-in needs an interactive step
 *   consent  Microsoft refused the permission (403)
 *   missing  not there (404)
 *   refused  Microsoft didn't accept the request (400 and other 4xx)
 *   busy     throttled, Microsoft down or unreachable (429, 5xx, network)
 *   setup    FocusTime's own Microsoft sign-in isn't set up here (keyring, config)
 */
export type GraphFailure = "signin" | "consent" | "missing" | "refused" | "busy" | "setup";
export function graphFailureOf(e: unknown): GraphFailure | null {
  if (e instanceof AuthFailure) return e.kind === "network" ? "busy" : e.kind === "misconfigured" || e.kind === "keyring" ? "setup" : "signin";
  if (e instanceof NetworkError) return "busy";
  if (e instanceof HttpError) return e.status === 401 ? "signin" : e.status === 403 ? "consent" : e.status === 404 ? "missing" : e.status === 429 || e.status >= 500 ? "busy" : "refused";
  return null;
}

export type MeetingGate = {
  /** True only for a join link or online meeting id of a registered, Automatic, home-tenant series. */
  allowed: (q: { joinUrl?: string; onlineMeetingId?: string }) => Promise<boolean>;
};

export type MeetingsDeps = {
  fetch: typeof fetch;
  /** The sign-in's calendar token. */
  calendarToken: () => Promise<string>;
  /** The meetings token (OnlineMeetings.Read, OnlineMeetingTranscript.Read.All). */
  meetingsToken: () => Promise<string>;
  invalidate: () => void;
  gate: MeetingGate;
  homeDomains: readonly string[];
  log: Logger;
  timeoutMs?: number;
};

/** A recurring online meeting on my calendar, as registration offers it. */
export type SeriesCandidate = {
  eventId: string;
  subject: string;
  organizerName: string | null;
  organizerEmail: string | null;
  joinUrl: string;
  weekday: number;
  start: string;
  minutes: number;
  zone: string;
  interval: number;
  /** People on the invite from outside Cooptimize: a count, never who. */
  outside: number;
  /** Cooptimize attendees' addresses (lowercase), for matching FocusTime users; never returned to the UI. */
  homeAttendees: string[];
};

export type SeriesInstance = { startAt: string; endAt: string; cancelled: boolean; homeAttendees: string[] };
export type TranscriptRef = { id: string; createdAt: string; endAt: string | null };

const WEEKDAY: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
const str = (v: unknown, max = 2000) => (typeof v === "string" && v.length <= max ? v : null);

type GraphAttendee = { emailAddress?: { address?: unknown } };
type GraphSeries = {
  id?: unknown;
  subject?: unknown;
  organizer?: { emailAddress?: { name?: unknown; address?: unknown } };
  attendees?: GraphAttendee[];
  onlineMeeting?: { joinUrl?: unknown } | null;
  start?: { dateTime?: unknown; timeZone?: unknown };
  end?: { dateTime?: unknown; timeZone?: unknown };
  originalStartTimeZone?: unknown;
  recurrence?: { pattern?: { type?: unknown; interval?: unknown; daysOfWeek?: unknown } } | null;
  type?: unknown;
  isOnlineMeeting?: unknown;
  seriesMasterId?: unknown;
  isCancelled?: unknown;
};

export function createMeetingsClient(d: MeetingsDeps) {
  const home = (addr: string) => {
    const dom = addr.split("@")[1]?.toLowerCase() ?? "";
    return d.homeDomains.some((h) => dom === h.toLowerCase() || dom.endsWith(`.${h.toLowerCase()}`));
  };

  async function request(op: string, url: string, token: () => Promise<string>, o: { accept?: string; text?: boolean; prefer?: string } = {}, retried = false): Promise<unknown> {
    const t = await token();
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, { headers: { accept: o.accept ?? "application/json", authorization: `Bearer ${t}`, ...(o.prefer ? { prefer: o.prefer } : {}) }, signal: AbortSignal.timeout(d.timeoutMs ?? 20_000) });
    } catch {
      d.log({ source: "outlook", op, kind: "network" });
      throw new NetworkError("network");
    }
    d.log({ source: "outlook", op, status: res.status, durationMs: performance.now() - started });
    if (res.status === 401 && !retried) {
      await res.body?.cancel();
      d.invalidate();
      return request(op, url, token, o, true);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpError(res.status);
    }
    if (!o.text) return res.json().catch(() => null);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_TRANSCRIPT_BYTES) {
      await res.body?.cancel();
      throw new HttpError(413);
    }
    const body = await res.text();
    if (body.length > MAX_TRANSCRIPT_BYTES) throw new HttpError(413);
    return body;
  }

  const homeAttendees = (as: GraphAttendee[] | undefined) =>
    [...new Set((as ?? []).map((a) => str(a.emailAddress?.address, 320)?.toLowerCase()).filter((x): x is string => !!x && home(x)))];
  const outsideCount = (as: GraphAttendee[] | undefined) => (as ?? []).map((a) => str(a.emailAddress?.address, 320)).filter((x): x is string => !!x && !home(x)).length;

  /** A series master as registration needs it, or null when it isn't a weekly online meeting. */
  function candidateOf(e: GraphSeries, zone: string): SeriesCandidate | null {
    const id = str(e.id, 1000);
    const joinUrl = str(e.onlineMeeting?.joinUrl, 4000);
    const p = e.recurrence?.pattern;
    const days = Array.isArray(p?.daysOfWeek) ? (p!.daysOfWeek as unknown[]).map((x) => WEEKDAY[String(x).toLowerCase()]).filter((x): x is number => !!x) : [];
    const start = str(e.start?.dateTime, 40);
    const end = str(e.end?.dateTime, 40);
    if (!id || !joinUrl || p?.type !== "weekly" || days.length !== 1 || !start || !end) return null;
    // Graph gives the times in the Prefer'd zone (the person's); the series' own pattern is the weekday and time there.
    const s = Temporal.PlainDateTime.from(start.replace(/(\.\d{3})\d*$/, "$1"));
    const f = Temporal.PlainDateTime.from(end.replace(/(\.\d{3})\d*$/, "$1"));
    const minutes = Math.round(s.until(f, { largestUnit: "minutes" }).minutes);
    if (minutes <= 0 || minutes > 600) return null;
    return {
      eventId: id,
      subject: str(e.subject, 400)?.trim() || "(No title)",
      organizerName: str(e.organizer?.emailAddress?.name, 200),
      organizerEmail: str(e.organizer?.emailAddress?.address, 320)?.toLowerCase() ?? null,
      joinUrl,
      weekday: days[0]!,
      start: s.toPlainTime().toString({ smallestUnit: "minute" }),
      minutes,
      zone,
      interval: Math.max(1, Math.min(4, Number(p?.interval) || 1)),
      outside: outsideCount(e.attendees),
      homeAttendees: homeAttendees(e.attendees),
    };
  }

  const SELECT = "id,subject,organizer,attendees,onlineMeeting,start,end,recurrence,isOnlineMeeting,type";

  return {
    /**
     * My recurring online meetings with someone from outside Cooptimize on them. MC-1c: Microsoft's docs don't say
     * `type` or `isOnlineMeeting` can be filtered on /me/events (checked Nov 11, 2026), and reading every event is slow,
     * so this reads the next 5 weeks of my calendar (`calendarView`, up to 500 occurrences), keeps the online ones that
     * belong to a series, and reads each series master once (at most 40), all filtered in code.
     */
    async seriesOnMyCalendar(zone: string, nowIso: string = new Date().toISOString()): Promise<SeriesCandidate[]> {
      const from = Temporal.Instant.from(nowIso);
      const to = from.add({ hours: 24 * 35 });
      const masters: string[] = [];
      let url: string | null = `${GRAPH}/me/calendarView?startDateTime=${from.toString()}&endDateTime=${to.toString()}&$select=id,seriesMasterId,type,isOnlineMeeting,onlineMeeting&$top=100`;
      for (let page = 0; url && page < 5; page++) {
        const j = (await request("meetings_series", url, d.calendarToken, { prefer: `outlook.timezone="${zone}"` })) as { value?: GraphSeries[]; "@odata.nextLink"?: unknown } | null;
        for (const e of j?.value ?? []) {
          const m = str(e.seriesMasterId, 1000);
          if (m && e.isOnlineMeeting !== false && str(e.onlineMeeting?.joinUrl, 4000) && !masters.includes(m)) masters.push(m);
        }
        const next = str(j?.["@odata.nextLink"], 4000);
        url = next && next.startsWith(`${GRAPH}/`) ? next : null;
      }
      const out: SeriesCandidate[] = [];
      for (const m of masters.slice(0, 40)) {
        const c = await this.series(m, zone);
        if (c && c.outside > 0) out.push(c);
      }
      return out;
    },

    /** One series master of mine by id (registration, and refreshing its pattern), or null. */
    async series(eventId: string, zone: string): Promise<SeriesCandidate | null> {
      const j = (await request("meetings_series_one", `${GRAPH}/me/events/${encodeURIComponent(eventId)}?$select=${SELECT}`, d.calendarToken, { prefer: `outlook.timezone="${zone}"` }).catch((e) => {
        if (e instanceof HttpError && e.status === 404) return null;
        throw e;
      })) as GraphSeries | null;
      return j ? candidateOf(j, zone) : null;
    },

    /** A pasted join link's series on my calendar (an event in the next 5 weeks with that link), or null. */
    async seriesByJoinUrl(joinUrl: string, zone: string, nowIso: string): Promise<SeriesCandidate | null> {
      const from = Temporal.Instant.from(nowIso);
      const to = from.add({ hours: 24 * 35 });
      let url: string | null = `${GRAPH}/me/calendarView?startDateTime=${from.toString()}&endDateTime=${to.toString()}&$select=id,onlineMeeting,seriesMasterId,type&$top=100`;
      for (let page = 0; url && page < 5; page++) {
        const j = (await request("meetings_find_link", url, d.calendarToken, { prefer: `outlook.timezone="${zone}"` })) as { value?: GraphSeries[]; "@odata.nextLink"?: unknown } | null;
        // MC-1c: the same link however it was copied (encoding, case, ?context=…).
        const hit = (j?.value ?? []).find((e) => { const u = str(e.onlineMeeting?.joinUrl, 4000); return !!u && joinKey(u) === joinKey(joinUrl); });
        if (hit) {
          const master = str(hit.seriesMasterId, 1000);
          return master ? this.series(master, zone) : null;
        }
        const next = str(j?.["@odata.nextLink"], 4000);
        url = next && next.startsWith(`${GRAPH}/`) ? next : null;
      }
      return null;
    },

    /** A series' occurrences between two instants on my calendar, with their Cooptimize attendees. */
    async instances(eventId: string, fromIso: string, toIso: string): Promise<SeriesInstance[]> {
      const j = (await request("meetings_instances", `${GRAPH}/me/events/${encodeURIComponent(eventId)}/instances?startDateTime=${fromIso}&endDateTime=${toIso}&$select=start,end,isCancelled,attendees&$top=50`, d.calendarToken, { prefer: 'outlook.timezone="UTC"' })) as { value?: GraphSeries[] } | null;
      const out: SeriesInstance[] = [];
      for (const e of j?.value ?? []) {
        const s = str(e.start?.dateTime, 40);
        const f = str(e.end?.dateTime, 40);
        if (!s || !f) continue;
        const at = (x: string) => Temporal.PlainDateTime.from(x.replace(/(\.\d{3})\d*$/, "$1")).toZonedDateTime("UTC").toInstant().toString();
        out.push({ startAt: at(s), endAt: at(f), cancelled: e.isCancelled === true, homeAttendees: homeAttendees(e.attendees) });
      }
      return out;
    },

    /** The online meeting of a registered join link (OnlineMeetings.Read); refused for anything not registered. */
    async onlineMeetingId(joinUrl: string): Promise<string | null> {
      if (!(await d.gate.allowed({ joinUrl }))) throw new MeetingRefused();
      const j = (await request("meetings_online", `${GRAPH}/me/onlineMeetings?$filter=${encodeURIComponent(`JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`)}&$select=id`, d.meetingsToken)) as { value?: { id?: unknown }[] } | null;
      return str(j?.value?.[0]?.id, 1000);
    },

    /** A registered meeting's transcripts, newest first (ids and times only). */
    async transcripts(onlineMeetingId: string): Promise<TranscriptRef[]> {
      if (!(await d.gate.allowed({ onlineMeetingId }))) throw new MeetingRefused();
      const j = (await request("meetings_transcripts", `${GRAPH}/me/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/transcripts?$select=id,createdDateTime,endDateTime`, d.meetingsToken)) as { value?: { id?: unknown; createdDateTime?: unknown; endDateTime?: unknown }[] } | null;
      return (j?.value ?? [])
        .map((t) => ({ id: str(t.id, 2000), createdAt: str(t.createdDateTime, 40), endAt: str(t.endDateTime, 40) }))
        .filter((t): t is TranscriptRef => !!t.id && !!t.createdAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    /** One transcript of a registered meeting as text/vtt (at most MAX_TRANSCRIPT_BYTES). Never logged. */
    async transcriptVtt(onlineMeetingId: string, transcriptId: string): Promise<string> {
      if (!(await d.gate.allowed({ onlineMeetingId }))) throw new MeetingRefused();
      return (await request("meetings_transcript", `${GRAPH}/me/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/transcripts/${encodeURIComponent(transcriptId)}/content?$format=text/vtt`, d.meetingsToken, { accept: "text/vtt", text: true })) as string;
    },
  };
}

export type MeetingsClient = ReturnType<typeof createMeetingsClient>;

/** The transcript of one occurrence: the newest one created between its start and 12 hours after its end. */
export function transcriptFor(refs: readonly TranscriptRef[], startAt: string, endAt: string): TranscriptRef | null {
  const s = Date.parse(startAt);
  const e = Date.parse(endAt) + 12 * 3_600_000;
  return refs.find((r) => Date.parse(r.createdAt) >= s - 15 * 60_000 && Date.parse(r.createdAt) <= e) ?? null;
}
