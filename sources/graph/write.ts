// Outlook writes (step 12) through Microsoft Graph, delegated Calendars.ReadWrite, for Coopilot's own events only.
// Every event Coopilot creates carries a marker: a single-value extended property with a stable id. Update and delete
// read the event first and refuse unless the marker is there and matches. Errors carry a kind and an HTTP status only,
// never bodies; the token is used only for the Authorization header to graph.microsoft.com.
import type { Logger } from "../../log/logger.ts";
import { HttpError, NetworkError } from "../calendar/http.ts";

const API = "https://graph.microsoft.com/v1.0/";
/** Coopilot's marker property: a fixed namespace GUID, named CoopilotId. Its value is the timebox's stable id. */
export const MARKER_PROP = "String {5b0f3c1e-8a2d-4e7f-9c41-6d2a8e0b7f13} Name CoopilotId";
/** All writer calls: times in UTC and immutable event ids (so ids survive moves between folders). */
export const WRITE_PREFER = 'outlook.timezone="UTC", IdType="ImmutableId"';
const SELECT = "subject,start,end,showAs,isReminderOn,isCancelled";
const expandMarker = `singleValueExtendedProperties($filter=id eq '${MARKER_PROP}')`;

/** The fields Coopilot writes. Start and end are UTC instants ("2026-11-03T14:00:00Z"). */
export type OutlookFields = { subject: string; body: string; start: string; end: string; showAs: "busy"; reminder: false };
/** What a read back shows (no body is read). Null when the event does not exist. */
export type OutlookEvent = { id: string; subject: string; start: string; end: string; showAs: string; isReminderOn: boolean; marker: string | null };
export type CalendarInfo = { name: string; owner: string };

/** The event isn't Coopilot's (no marker, or another timebox's). Nothing was changed. */
export class OwnershipError extends Error {
  constructor() {
    super("This Outlook event wasn't created by Coopilot, so Coopilot won't change it");
  }
}
/** The event is gone (deleted in Outlook). */
export class GoneError extends Error {}

type GraphRaw = { id?: unknown; subject?: unknown; start?: { dateTime?: unknown }; end?: { dateTime?: unknown }; showAs?: unknown; isReminderOn?: unknown; isCancelled?: unknown; singleValueExtendedProperties?: { id?: unknown; value?: unknown }[] };

/** Graph's UTC "2026-11-03T14:00:00.0000000" as an instant string. */
const utc = (s: unknown) => (typeof s === "string" ? Temporal.Instant.from(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`).toString() : "");
export function fromGraph(r: GraphRaw): OutlookEvent | null {
  if (typeof r.id !== "string" || r.isCancelled === true) return null;
  const m = (r.singleValueExtendedProperties ?? []).find((p) => typeof p.id === "string" && p.id.toLowerCase() === MARKER_PROP.toLowerCase());
  return {
    id: r.id,
    subject: typeof r.subject === "string" ? r.subject : "",
    start: utc(r.start?.dateTime),
    end: utc(r.end?.dateTime),
    showAs: typeof r.showAs === "string" ? r.showAs : "",
    isReminderOn: r.isReminderOn === true,
    marker: typeof m?.value === "string" ? m.value : null,
  };
}

/** Graph's dateTimeTimeZone in UTC for an instant. */
const toGraphTime = (iso: string) => ({ dateTime: Temporal.Instant.from(iso).toString({ smallestUnit: "second" }).replace(/Z$/, ""), timeZone: "UTC" });

/** The POST body: Busy, no attendees, no reminder, plain-text body, the marker. */
export function createBody(f: OutlookFields, marker: string, transactionId: string) {
  return {
    subject: f.subject,
    body: { contentType: "text", content: f.body },
    start: toGraphTime(f.start),
    end: toGraphTime(f.end),
    showAs: f.showAs,
    isReminderOn: false,
    attendees: [],
    transactionId,
    singleValueExtendedProperties: [{ id: MARKER_PROP, value: marker }],
  };
}
/** A PATCH body: only what changed among the fields Coopilot owns. */
export function patchBody(before: OutlookFields, after: OutlookFields) {
  const out: Record<string, unknown> = {};
  if (before.subject !== after.subject) out.subject = after.subject;
  if (before.body !== after.body) out.body = { contentType: "text", content: after.body };
  if (!sameInstant(before.start, after.start)) out.start = toGraphTime(after.start);
  if (!sameInstant(before.end, after.end)) out.end = toGraphTime(after.end);
  if (before.showAs !== after.showAs) out.showAs = after.showAs;
  return out;
}
export const sameInstant = (a: string, b: string) => !!a && !!b && Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b)) === 0;

/** Does the event read back as written? The fields Coopilot sets, compared one by one (the body is not read). */
export function matches(e: OutlookEvent | null, f: OutlookFields, marker: string): { ok: boolean; differs: string[] } {
  if (!e) return { ok: false, differs: ["event not found"] };
  const differs: string[] = [];
  if (e.marker !== marker) differs.push("marker");
  if (e.subject !== f.subject) differs.push("title");
  if (!sameInstant(e.start, f.start)) differs.push("start");
  if (!sameInstant(e.end, f.end)) differs.push("end");
  if (e.showAs.toLowerCase() !== f.showAs) differs.push("show as");
  if (e.isReminderOn) differs.push("reminder");
  return { ok: !differs.length, differs };
}

export type GraphWriterDeps = { fetch: typeof fetch; token: () => Promise<string>; invalidate: () => void; log: Logger; timeoutMs?: number };

export function createGraphWriter(d: GraphWriterDeps) {
  const timeoutMs = d.timeoutMs ?? 20_000;

  async function send(op: string, method: string, url: string, body?: unknown, retried = false): Promise<{ status: number; json: unknown }> {
    if (!url.startsWith(API)) throw new Error("refusing a non-Graph URL");
    const token = await d.token();
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, {
        method,
        headers: { accept: "application/json", authorization: `Bearer ${token}`, prefer: WRITE_PREFER, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      d.log({ source: "outlook", op, kind: "network" });
      throw new NetworkError("network");
    }
    d.log({ source: "outlook", op, status: res.status, durationMs: performance.now() - started });
    if (res.status === 401 && !retried) {
      await res.body?.cancel();
      d.invalidate();
      return send(op, method, url, body, true);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpError(res.status);
    }
    if (res.status === 204) return { status: 204, json: null };
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  /** The default calendar's name and owner, for the preview. */
  async function calendar(): Promise<CalendarInfo> {
    const { json } = await send("write_calendar", "GET", `${API}me/calendar?$select=name,owner`);
    const j = json as { name?: unknown; owner?: { address?: unknown; name?: unknown } };
    return { name: typeof j?.name === "string" ? j.name : "Calendar", owner: typeof j?.owner?.address === "string" ? j.owner.address : typeof j?.owner?.name === "string" ? j.owner.name : "" };
  }

  /** One event with its marker, or null when it no longer exists. */
  async function get(id: string): Promise<OutlookEvent | null> {
    const u = new URL(`${API}me/events/${encodeURIComponent(id)}`);
    u.searchParams.set("$select", SELECT);
    u.searchParams.set("$expand", expandMarker);
    try {
      return fromGraph((await send("write_get", "GET", u.toString())).json as GraphRaw);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  /** The live event carrying this marker value, if any (how retries avoid duplicates). */
  async function findByMarker(marker: string): Promise<OutlookEvent | null> {
    const u = new URL(`${API}me/events`);
    u.searchParams.set("$filter", `singleValueExtendedProperties/Any(ep: ep/id eq '${MARKER_PROP}' and ep/value eq '${marker.replace(/'/g, "''")}')`);
    u.searchParams.set("$select", SELECT);
    u.searchParams.set("$expand", expandMarker);
    u.searchParams.set("$top", "5");
    const { json } = await send("write_find", "GET", u.toString());
    const value = Array.isArray((json as { value?: unknown })?.value) ? ((json as { value: GraphRaw[] }).value) : [];
    return value.map(fromGraph).find((e) => e?.marker === marker) ?? null;
  }

  /** The marked event, read first; refuses (OwnershipError) when the marker is missing or another one. */
  async function owned(id: string, marker: string): Promise<OutlookEvent> {
    const e = await get(id);
    if (!e) throw new GoneError("gone");
    if (e.marker !== marker) {
      d.log({ source: "outlook", op: "write_refused", kind: "not_coopilot" });
      throw new OwnershipError();
    }
    return e;
  }

  /**
   * Create once: an existing event with this marker is returned instead of a second one (idempotent retry), then a
   * POST carrying the marker and a transaction id.
   */
  async function create(f: OutlookFields, marker: string, transactionId: string): Promise<{ id: string; existed: boolean }> {
    const found = await findByMarker(marker);
    if (found) return { id: found.id, existed: true };
    const { json } = await send("write_create", "POST", `${API}me/events`, createBody(f, marker, transactionId));
    const id = (json as { id?: unknown })?.id;
    if (typeof id !== "string") throw new HttpError(502);
    return { id, existed: false };
  }

  /** Change a marked event to `after`; returns the event as it was (the audit log's prior values). */
  async function update(id: string, marker: string, after: OutlookFields, bodyChanged: boolean): Promise<OutlookEvent> {
    const was = await owned(id, marker);
    const patch = patchBody({ subject: was.subject, body: bodyChanged ? "" : after.body, start: was.start, end: was.end, showAs: was.showAs.toLowerCase() as "busy", reminder: false }, after);
    if (was.isReminderOn) patch.isReminderOn = false;
    if (Object.keys(patch).length) await send("write_update", "PATCH", `${API}me/events/${encodeURIComponent(id)}`, patch);
    return was;
  }

  /** Delete a marked event; already gone counts as done. */
  async function remove(id: string, marker: string): Promise<void> {
    try {
      await owned(id, marker);
    } catch (e) {
      if (e instanceof GoneError) return;
      throw e;
    }
    try {
      await send("write_delete", "DELETE", `${API}me/events/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return;
      throw e;
    }
  }

  return { calendar, get, findByMarker, create, update, remove };
}
export type GraphWriter = ReturnType<typeof createGraphWriter>;
