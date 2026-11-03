// Outlook via Microsoft Graph calendarView, delegated Calendars.ReadBasic, read-only. Step 12: an optional write side
// (Calendars.ReadWrite, its own token) for FocusTime's own timebox events only, through the write framework.
import type { OutlookConfig } from "../../config/schema.ts";
import type { Logger } from "../../log/logger.ts";
import { ForeignLinkError, getJson, PartialError } from "../calendar/http.ts";
import { createCalendarSource } from "../calendar/source.ts";
import { createOAuthClient, microsoftProvider, type Keyring } from "../oauth/oauth.ts";
import { weekRange } from "../when.ts";
import { normalizeGraphEvents, type GraphEvent } from "./normalize.ts";
import { createGraphWriter, type GraphWriter } from "./write.ts";
import { createPeopleReader, type PeopleReader } from "./people.ts";
import { createScheduleReader, type ScheduleReader } from "./schedule.ts";
import type { WriteAccess } from "../oauth/oauth.ts";

const API = "https://graph.microsoft.com/v1.0/";
export const GRAPH_SELECT = "subject,start,end,isAllDay,showAs,responseStatus,isCancelled";

export type CalendarDeps<C> = {
  config: C;
  fetch: typeof fetch;
  keyring: Keyring;
  openBrowser: (url: string) => Promise<void>;
  cacheDir: string;
  log: Logger;
  timeZone: string;
  now?: () => Temporal.Instant;
  timeoutMs?: number;
  signInTimeoutMs?: number;
};

export function createOutlookSource(deps: CalendarDeps<OutlookConfig>) {
  const timeoutMs = deps.timeoutMs ?? 20_000;
  const auth = createOAuthClient(microsoftProvider(deps.config), {
    fetch: deps.fetch, keyring: deps.keyring, openBrowser: deps.openBrowser, log: deps.log, timeoutMs,
    ...(deps.signInTimeoutMs ? { signInTimeoutMs: deps.signInTimeoutMs } : {}),
    ...(deps.now ? { now: () => deps.now!().epochMilliseconds } : {}),
  });

  async function fetchWeek(weekStart: string, token: string) {
    const range = weekRange(weekStart, deps.timeZone);
    const first = new URL(`${API}me/calendarView`);
    first.searchParams.set("startDateTime", range.start);
    first.searchParams.set("endDateTime", range.end);
    first.searchParams.set("$select", GRAPH_SELECT);
    first.searchParams.set("$top", "100");
    // Immutable ids (step 12): the same id the writer gets back, so FocusTime's own events are recognized.
    const headers = { prefer: `outlook.timezone="${deps.timeZone}", IdType="ImmutableId"` };
    const items: GraphEvent[] = [];
    let url: string | null = first.toString();
    let page = 0;
    while (url) {
      if (!url.startsWith(API)) {
        deps.log({ source: "outlook", op: "calendarview", kind: "foreign_next_link" });
        throw new ForeignLinkError("foreign");
      }
      const started = performance.now();
      let json: unknown;
      try {
        json = (await getJson(deps.fetch, url, token, headers, timeoutMs)).json;
      } catch (e) {
        deps.log({ source: "outlook", op: "calendarview", kind: e instanceof Error ? e.constructor.name : "error", ...("status" in (e as object) ? { status: (e as { status: number }).status } : {}) });
        if (page > 0) throw new PartialError("partial");
        throw e;
      }
      const body = json as { value?: GraphEvent[]; "@odata.nextLink"?: string };
      const value = Array.isArray(body.value) ? body.value : [];
      items.push(...value);
      deps.log({ source: "outlook", op: "calendarview", status: 200, durationMs: performance.now() - started, count: value.length });
      url = body["@odata.nextLink"] ?? null;
      page++;
    }
    const { events, skipped } = normalizeGraphEvents(items, deps.timeZone);
    if (skipped) deps.log({ source: "outlook", op: "normalize", kind: "skipped", count: skipped });
    return events;
  }

  const base = createCalendarSource({
    id: "outlook", label: "Outlook", connectAction: "connect_microsoft", auth, fetchWeek,
    cacheDir: deps.cacheDir, log: deps.log, timeZone: deps.timeZone, ...(deps.now ? { now: deps.now } : {}),
  });
  const writer = createGraphWriter({ fetch: deps.fetch, token: () => auth.accessToken("write"), invalidate: () => auth.invalidate(), log: deps.log, timeoutMs });
  const write: OutlookWrite = { access: () => auth.writeAccess(), writer };
  // Free/busy (step 13) on the read token: Calendars.ReadBasic covers getSchedule.
  const schedule = createScheduleReader({ fetch: deps.fetch, token: () => auth.accessToken(), invalidate: () => auth.invalidate(), log: deps.log, timeoutMs });
  // Who suggestions for follow-ups (step 13.5): attendees in a client's domain, on the read token.
  const people = createPeopleReader({ fetch: deps.fetch, token: () => auth.accessToken(), invalidate: () => auth.invalidate(), log: deps.log, timeoutMs });
  // Step 15.4: the same Microsoft sign-in is the app's identity and carries the Azure token.
  return { ...base, write, schedule, people, auth };
}

/** The write side: whether this sign-in may write, and the marker-checked writer. */
export type OutlookWrite = { access: () => Promise<WriteAccess>; writer: GraphWriter };
export type { PeopleReader, ScheduleReader };
