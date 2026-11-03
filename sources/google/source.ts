// Google Calendar events.list on the configured calendars (primary by default), read-only.
import type { GoogleConfig } from "../../config/schema.ts";
import type { CalEvent } from "../../week/types.ts";
import { getJson, HttpError, PartialError } from "../calendar/http.ts";
import { createCalendarSource, FetchFailure } from "../calendar/source.ts";
import type { CalendarDeps } from "../graph/source.ts";
import { createOAuthClient, googleProvider } from "../oauth/oauth.ts";
import { weekRange } from "../when.ts";
import { normalizeGoogleEvents, type GoogleEvent } from "./normalize.ts";

export const GOOGLE_FIELDS = "nextPageToken,items(id,status,summary,transparency,start,end,attendees(self,responseStatus))";

export function createGoogleSource(deps: CalendarDeps<GoogleConfig>) {
  const timeoutMs = deps.timeoutMs ?? 20_000;
  const auth = createOAuthClient(googleProvider(deps.config), {
    fetch: deps.fetch, keyring: deps.keyring, openBrowser: deps.openBrowser, log: deps.log, timeoutMs,
    ...(deps.loopback ? { loopback: deps.loopback } : {}),
    ...(deps.signInTimeoutMs ? { signInTimeoutMs: deps.signInTimeoutMs } : {}),
    ...(deps.now ? { now: () => deps.now!().epochMilliseconds } : {}),
  });

  async function fetchWeek(weekStart: string, token: string): Promise<CalEvent[]> {
    const range = weekRange(weekStart, deps.timeZone);
    const events: CalEvent[] = [];
    let requests = 0;
    for (const cal of deps.config.calendars) {
      let pageToken: string | null = null;
      do {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events`);
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("timeMin", range.start);
        url.searchParams.set("timeMax", range.end);
        url.searchParams.set("maxResults", "250");
        url.searchParams.set("fields", GOOGLE_FIELDS);
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const started = performance.now();
        let json: unknown;
        try {
          json = (await getJson(deps.fetch, url.toString(), token, {}, timeoutMs)).json;
        } catch (e) {
          deps.log({ source: "google", op: "events", kind: e instanceof Error ? e.constructor.name : "error", ...(e instanceof HttpError ? { status: e.status } : {}) });
          if (e instanceof HttpError && e.status === 404) throw new FetchFailure("misconfigured", "Google calendar not found: check google.calendars in config", "open_settings");
          if (requests > 0 && !(e instanceof HttpError && e.status === 401)) throw new PartialError("partial");
          throw e;
        }
        requests++;
        const body = json as { items?: GoogleEvent[]; nextPageToken?: string };
        const items = Array.isArray(body.items) ? body.items : [];
        events.push(...normalizeGoogleEvents(items, cal));
        deps.log({ source: "google", op: "events", status: 200, durationMs: performance.now() - started, count: items.length });
        pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : null;
      } while (pageToken);
    }
    return events;
  }

  return createCalendarSource({
    id: "google", label: "Google", connectAction: "connect_google", auth, fetchWeek,
    snapshots: deps.snapshots, log: deps.log, timeZone: deps.timeZone, ...(deps.now ? { now: deps.now } : {}),
  });
}
