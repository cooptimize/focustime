// Free/busy for the collaboration finder (step 13): Graph getSchedule, delegated, on my read token
// (Calendars.ReadBasic is its least privileged permission). The answer is parsed straight into availability:
// only scheduleId, availabilityView and workingHours are read (plan/collab.ts). Schedule items (subjects,
// locations) are never kept, logged or returned. Logs carry counts and status codes only.
import type { Logger } from "../../log/logger.ts";
import { parseSchedule, type Availability } from "../../plan/collab.ts";
import { HttpError, NetworkError } from "../calendar/http.ts";

const URL_ = "https://graph.microsoft.com/v1.0/me/calendar/getSchedule";
/** People per request (kept small; the docs give no limit). */
export const SCHEDULE_BATCH = 20;
export const SCHEDULE_INTERVAL = 15;

export type ScheduleDeps = { fetch: typeof fetch; token: () => Promise<string>; invalidate: () => void; log: Logger; timeoutMs?: number };

const utcBody = (iso: string) => ({ dateTime: Temporal.Instant.from(iso).toString({ smallestUnit: "second" }).replace(/Z$/, ""), timeZone: "UTC" });

export function createScheduleReader(d: ScheduleDeps) {
  async function once(emails: string[], startIso: string, endIso: string, zone: string, retried = false): Promise<Availability[]> {
    const token = await d.token();
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(URL_, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ schedules: emails, startTime: utcBody(startIso), endTime: utcBody(endIso), availabilityViewInterval: SCHEDULE_INTERVAL }),
        signal: AbortSignal.timeout(d.timeoutMs ?? 20_000),
      });
    } catch {
      d.log({ source: "outlook", op: "get_schedule", kind: "network" });
      throw new NetworkError("network");
    }
    d.log({ source: "outlook", op: "get_schedule", status: res.status, durationMs: performance.now() - started, count: emails.length });
    if (res.status === 401 && !retried) {
      await res.body?.cancel();
      d.invalidate();
      return once(emails, startIso, endIso, zone, true);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpError(res.status);
    }
    // Parsed at once; the raw answer goes out of scope here.
    return parseSchedule(await res.json().catch(() => null), startIso, endIso, SCHEDULE_INTERVAL, zone);
  }
  /** Availability for each address over [start, end), in batches. */
  /** `zone`: my time zone, assumed (9:00 to 5:00) for anyone who doesn't share working hours (step 13.5). */
  async function schedule(emails: readonly string[], startIso: string, endIso: string, zone = "UTC"): Promise<Availability[]> {
    const out: Availability[] = [];
    for (let i = 0; i < emails.length; i += SCHEDULE_BATCH) out.push(...(await once(emails.slice(i, i + SCHEDULE_BATCH), startIso, endIso, zone)));
    return out;
  }
  return { schedule };
}
export type ScheduleReader = ReturnType<typeof createScheduleReader>;
