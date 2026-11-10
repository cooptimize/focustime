// CAL-1: one fetch of a calendar link, through the guarded getter the server hands in (server/ics-fetch.ts checks
// every DNS answer at connect time and caps the time and size). Redirects are followed here, at most three, and every
// hop passes normalizeLink again. Conditional with ETag or Last-Modified when the server gave one. Errors carry a kind
// only: never the link, a body or a header.
import { ICS_MAX_BYTES, ICS_MAX_REDIRECTS, ICS_TIMEOUT_MS, LinkError, normalizeLink } from "./link.ts";
import { looksLikeCalendar } from "./parse.ts";

/** What the getter returns: never follows redirects itself. body is null for 3xx and 304. */
export type IcsResponse = { status: number; location: string | null; etag: string | null; lastModified: string | null; contentType: string | null; body: string | null };
/** The guarded GET (server/ics-fetch.ts; a fake in tests and the demo). Throws IcsFetchError. */
export type IcsGet = (url: URL, headers: Record<string, string>, limits: { timeoutMs: number; maxBytes: number }) => Promise<IcsResponse>;

export type IcsFailure =
  | "blocked_address"
  | "network"
  | "timeout"
  | "too_large"
  | "not_found"
  | "denied"
  | "http"
  | "too_many_redirects"
  | "bad_redirect"
  | "not_calendar"
  | "unreadable"
  | "demo";

export class IcsFetchError extends Error {
  readonly kind: IcsFailure;
  readonly status: number | null;
  constructor(kind: IcsFailure, status: number | null = null) {
    super(kind);
    this.kind = kind;
    this.status = status;
  }
}

/** The plain sentence for a failure (the source line, Settings, the add dialog). */
export const FAILURE_TEXT: Record<IcsFailure, string> = {
  blocked_address: "That link points to a private or internal network address, so FocusTime won't fetch it",
  network: "Couldn't reach the calendar's server",
  timeout: "The calendar's server took too long to answer",
  too_large: "The calendar is larger than 5 MB, so it wasn't read",
  not_found: "The link stopped working. Replace it?",
  denied: "The link stopped working. Replace it?",
  http: "The calendar's server returned an error",
  too_many_redirects: "The link redirected too many times",
  bad_redirect: "The link redirected somewhere FocusTime won't fetch",
  not_calendar: "That link doesn't return a calendar (an .ics file)",
  unreadable: "The calendar couldn't be read",
  demo: "In the demo only the sample links work, for example https://calendar.example.com/u/demo-family/basic.ics",
};

/** Whether this failure means the link itself is bad (Replace it), not a passing problem (Retry). */
export const LINK_BROKEN: ReadonlySet<IcsFailure> = new Set(["not_found", "denied", "not_calendar", "blocked_address", "bad_redirect"]);

export type IcsFetched = { kind: "not_modified" } | { kind: "ok"; text: string; etag: string | null; lastModified: string | null };

/** Content types a calendar may come as: text/calendar, or a generic type when the body is plainly a calendar. */
function acceptable(contentType: string | null, body: string): boolean {
  const t = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (t === "text/calendar") return true;
  if (t === "" || t === "application/octet-stream" || t === "text/plain" || t === "application/ics" || t === "text/x-vcalendar") return looksLikeCalendar(body);
  return false;
}

export async function fetchIcs(get: IcsGet, start: URL, prior: { etag: string | null; lastModified: string | null } = { etag: null, lastModified: null }): Promise<IcsFetched> {
  let url = start;
  const headers: Record<string, string> = { accept: "text/calendar, text/plain;q=0.5, */*;q=0.1", "user-agent": "FocusTime calendar link reader" };
  if (prior.etag) headers["if-none-match"] = prior.etag;
  else if (prior.lastModified) headers["if-modified-since"] = prior.lastModified;
  for (let hop = 0; ; hop++) {
    const r = await get(url, headers, { timeoutMs: ICS_TIMEOUT_MS, maxBytes: ICS_MAX_BYTES });
    if (r.status >= 300 && r.status < 400 && r.status !== 304) {
      if (hop >= ICS_MAX_REDIRECTS) throw new IcsFetchError("too_many_redirects");
      if (!r.location) throw new IcsFetchError("bad_redirect");
      try {
        url = normalizeLink(new URL(r.location, url).toString());
      } catch (e) {
        throw new IcsFetchError(e instanceof LinkError && e.problem === "blocked_host" ? "blocked_address" : "bad_redirect");
      }
      continue;
    }
    if (r.status === 304) return { kind: "not_modified" };
    if (r.status === 404 || r.status === 410) throw new IcsFetchError("not_found", r.status);
    if (r.status === 401 || r.status === 403) throw new IcsFetchError("denied", r.status);
    if (r.status < 200 || r.status >= 300) throw new IcsFetchError("http", r.status);
    const body = r.body ?? "";
    if (!acceptable(r.contentType, body)) throw new IcsFetchError("not_calendar");
    return { kind: "ok", text: body, etag: r.etag, lastModified: r.lastModified };
  }
}
