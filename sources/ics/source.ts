// CAL-1: a person's calendar links as a calendar source. Read only: FocusTime never writes to these calendars. Each
// link is fetched at most every 15 minutes while FocusTime reads the week (like Outlook and Google, on use, not in the
// background; Refresh asks now), conditionally with ETag or Last-Modified, and its instances inside the kept window
// are stored. A week read takes them from the store, so a failing link shows its last good events with their age.
// The link never leaves the server: not in results, messages, logs or errors.
import type { Logger } from "../../log/logger.ts";
import type { CalendarLink, CalendarLinks, LinkKind, LinkMode, StoredInstance } from "../../store/calendar-links.ts";
import type { CalEvent, SourceResult } from "../../week/types.ts";
import { weekRange } from "../when.ts";
import { FAILURE_TEXT, fetchIcs, IcsFetchError, LINK_BROKEN, type IcsFailure, type IcsGet } from "./fetch.ts";
import { LinkError, normalizeLink, redactLink } from "./link.ts";
import { IcsParseError, parseIcs, type IcsInstance } from "./parse.ts";

/** About every 15 minutes (CAL-1). */
export const LINK_REFRESH_MS = 15 * 60_000;
/** The kept window: 8 weeks back, 26 ahead (Week's history, Plan ahead's 12 weeks, collaboration's look ahead). */
export const WINDOW_BACK_DAYS = 56;
export const WINDOW_AHEAD_DAYS = 182;

export type LinkSourceResult = SourceResult<CalEvent> & { link: NonNullable<SourceResult<CalEvent>["link"]> };

/** What the add dialog shows before saving. Never the link. */
export type LinkPreview = { host: string; upcoming: number; total: number };

export class LinkAddError extends Error {}

export const NAME_MAX = 60;
export const COLOR = /^#[0-9a-fA-F]{6}$/;

export function createLinkCalendars(d: { store: CalendarLinks; get: IcsGet; log: Logger; timeZone: () => string; now: () => Temporal.Instant }) {
  const inflight = new Map<string, Promise<void>>();

  const window = () => {
    const n = d.now();
    return { start: n.subtract({ hours: 24 * WINDOW_BACK_DAYS }), end: n.add({ hours: 24 * WINDOW_AHEAD_DAYS }) };
  };

  /** Fetch and parse a link (add, replace, refresh). Throws LinkAddError with a plain sentence. */
  async function read(url: URL, titles: boolean, prior?: { etag: string | null; lastModified: string | null }) {
    const started = performance.now();
    try {
      const r = await fetchIcs(d.get, url, prior);
      if (r.kind === "not_modified") {
        d.log({ source: "ics", op: "fetch", status: 304, durationMs: performance.now() - started });
        return { kind: "not_modified" as const };
      }
      const events = parseIcs(r.text, { window: window(), timeZone: d.timeZone(), titles });
      d.log({ source: "ics", op: "fetch", status: 200, durationMs: performance.now() - started, count: events.length });
      return { kind: "ok" as const, events, etag: r.etag, lastModified: r.lastModified };
    } catch (e) {
      const kind: IcsFailure = e instanceof IcsFetchError ? e.kind : e instanceof IcsParseError ? (e.message === "not a calendar" ? "not_calendar" : "unreadable") : "unreadable";
      d.log({ source: "ics", op: "fetch", kind, ...(e instanceof IcsFetchError && e.status ? { status: e.status } : {}) });
      throw new IcsFetchError(kind, e instanceof IcsFetchError ? e.status : null);
    }
  }

  const upcoming = (events: IcsInstance[]) => {
    const n = d.now();
    return events.filter((e) => Temporal.Instant.compare(Temporal.Instant.from(e.endUtc), n) > 0).length;
  };

  function parseLink(input: unknown): URL {
    if (typeof input !== "string") throw new LinkAddError("Paste the calendar's link");
    try {
      return normalizeLink(input);
    } catch (e) {
      throw new LinkAddError(e instanceof LinkError ? e.message : "That isn't a link");
    }
  }

  async function fetchFor(url: URL, titles: boolean) {
    try {
      const r = await read(url, titles);
      if (r.kind !== "ok") throw new IcsFetchError("unreadable");
      return r;
    } catch (e) {
      throw new LinkAddError(e instanceof IcsFetchError ? FAILURE_TEXT[e.kind].replace(" Replace it?", "") : "The calendar couldn't be read");
    }
  }

  /** One link's refresh, never two at once; failures are recorded, never thrown. */
  function refreshOne(link: CalendarLink): Promise<void> {
    const running = inflight.get(link.id);
    if (running) return running;
    const p = (async () => {
      let url: URL;
      try {
        url = normalizeLink(await d.store.url(link.id));
      } catch {
        await d.store.recordFetch(link.id, { failure: "unreadable" });
        return;
      }
      try {
        const r = await read(url, link.mode === "titles", await d.store.validators(link.id));
        await d.store.recordFetch(link.id, r.kind === "not_modified" ? { events: null } : { events: r.events, etag: r.etag, lastModified: r.lastModified });
      } catch (e) {
        await d.store.recordFetch(link.id, { failure: e instanceof IcsFetchError ? e.kind : "unreadable" });
      }
    })().finally(() => inflight.delete(link.id));
    inflight.set(link.id, p);
    return p;
  }

  const due = (l: CalendarLink, force: boolean) => force || !l.checkedAt || d.now().since(Temporal.Instant.from(l.checkedAt)).total("milliseconds") >= LINK_REFRESH_MS;

  const zoned = (iso: string | null) => (iso ? Temporal.Instant.from(iso).toZonedDateTimeISO(d.timeZone()).toString({ timeZoneName: "never", smallestUnit: "second" }) : null);

  function toEvent(e: StoredInstance, l: CalendarLink): CalEvent {
    const title = l.mode === "titles" && e.title ? e.title : e.showAs === "free" ? "Free" : "Busy";
    return { id: `ics:${l.id}:${e.key}`, source: "ics", title, start: e.start, end: e.end, allDay: e.allDay, showAs: e.showAs, isPersonal: l.kind === "personal", calendar: { name: l.name, color: l.color } };
  }

  function resultOf(l: CalendarLink, items: CalEvent[]): LinkSourceResult {
    const broken = !!l.failure && LINK_BROKEN.has(l.failure as IcsFailure);
    const link = { id: l.id, name: l.name, color: l.color, kind: l.kind, mode: l.mode, broken };
    const base = { source: "ics" as const, fetchedAt: zoned(l.fetchedAt), items, link };
    if (!l.failure) return { ...base, status: "ok", fromCache: false };
    const text = FAILURE_TEXT[l.failure as IcsFailure] ?? "The calendar couldn't be read";
    const status = l.failure === "network" || l.failure === "timeout" ? "unreachable" : "error";
    return { ...base, status, fromCache: !!l.fetchedAt, message: text, ...(broken ? { fixAction: "open_settings" as const } : {}) };
  }

  return {
    list: () => d.store.list(),

    /** Check a link before saving: "Found N upcoming events". */
    async preview(input: unknown): Promise<LinkPreview> {
      const url = parseLink(input);
      const r = await fetchFor(url, false);
      return { host: redactLink(url), upcoming: upcoming(r.events), total: r.events.length };
    },

    async add(input: { url: unknown; name: string; color: string; mode: LinkMode; kind: LinkKind }): Promise<CalendarLink> {
      const url = parseLink(input.url);
      const r = await fetchFor(url, input.mode === "titles");
      const link = await d.store.add({ name: input.name, color: input.color, mode: input.mode, kind: input.kind, host: url.hostname, url: url.toString(), etag: r.etag, lastModified: r.lastModified }, r.events);
      d.log({ source: "ics", op: "link_add", count: r.events.length });
      return link;
    },

    async replace(id: string, input: unknown): Promise<CalendarLink> {
      const cur = await d.store.get(id);
      if (!cur) throw new LinkAddError("That calendar link isn't there any more");
      const url = parseLink(input);
      const r = await fetchFor(url, cur.mode === "titles");
      await d.store.replaceUrl(id, { host: url.hostname, url: url.toString(), etag: r.etag, lastModified: r.lastModified }, r.events);
      d.log({ source: "ics", op: "link_replace", count: r.events.length });
      return (await d.store.get(id))!;
    },

    async update(id: string, p: Partial<{ name: string; color: string; mode: LinkMode; kind: LinkKind }>): Promise<CalendarLink | null> {
      const cur = await d.store.get(id);
      if (!cur) return null;
      await d.store.update(id, p);
      const next = (await d.store.get(id))!;
      // Show titles needs the titles: read the feed again now.
      if (cur.mode === "busy" && next.mode === "titles") await refreshOne(next);
      return d.store.get(id);
    },

    async remove(id: string): Promise<boolean> {
      const ok = await d.store.remove(id);
      if (ok) d.log({ source: "ics", op: "link_remove" });
      return ok;
    },

    /** Refresh the due links (all with force), then every link's events for the week. */
    async load(weekStart: string, opts: { refresh?: boolean } = {}): Promise<LinkSourceResult[]> {
      const links = await d.store.list();
      if (!links.length) return [];
      await Promise.all(links.filter((l) => due(l, !!opts.refresh)).map(refreshOne));
      const fresh = await d.store.list();
      const tz = d.timeZone();
      const r = weekRange(weekStart, tz);
      // A day of slack each side for all-day events whose UTC bounds were set in another zone.
      const from = Temporal.Instant.from(r.start).subtract({ hours: 24 }).toString();
      const to = Temporal.Instant.from(r.end).add({ hours: 24 }).toString();
      const events = await d.store.eventsBetween(from, to);
      return fresh.map((l) => resultOf(l, events.filter((e) => e.linkId === l.id).map((e) => toEvent(e, l))));
    },
  };
}

export type LinkCalendars = ReturnType<typeof createLinkCalendars>;
